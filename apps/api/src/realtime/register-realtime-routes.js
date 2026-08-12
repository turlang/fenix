import { RealtimeEventType } from '../../../../packages/realtime-session-gateway/src/index.js';
import { readAuthSessionToken } from '../http/register-auth-routes.js';

function text(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sendJson(socket, event) {
  if (socket.readyState !== 1) return false;
  socket.send(JSON.stringify(event));
  return true;
}

function ownerChangedPayload(route) {
  return {
    code: 'RUNTIME_OWNER_CHANGED',
    message: 'O owner do runtime mudou durante o roteamento realtime.',
    ownerId: route?.ownerId ?? null,
    ownerUrl: route?.ownerUrl ?? null,
    generation: route?.generation ?? null
  };
}

function isOwnershipFailure(error) {
  return ['RUNTIME_LEASE_LOST', 'RUNTIME_OWNER_CHANGED', 'SESSION_NOT_ACTIVE'].includes(error?.code);
}

export function registerRealtimeRoutes(app, {
  gateway,
  allowOrigin = () => true,
  ownerRouter = null,
  proxyWebSocket = null
}) {
  if (!app) throw new TypeError('app é obrigatório.');
  if (!gateway) throw new TypeError('gateway é obrigatório.');

  app.get('/v1/realtime', {
    websocket: true,
    preValidation: async (request, reply) => {
      const origin = request.headers.origin;
      if (origin && !allowOrigin(origin)) {
        return reply.code(403).send({
          code: 'REALTIME_ORIGIN_FORBIDDEN',
          message: 'Origem não autorizada para o canal realtime.'
        });
      }
      if (!ownerRouter) return;

      try {
        const path = String(request.raw?.url ?? request.url ?? '/v1/realtime');
        const routeContext = ownerRouter.verifyIncomingRequest({
          headers: request.headers,
          method: request.method,
          path,
          body: null
        });
        const route = await ownerRouter.resolve({ sessionId: text(request.query?.sessionId) });
        request.fenixRuntimeRoute = { routeContext, route };

        if (routeContext.routed) {
          const generationChanged = route.mode === 'local' && Number(route.generation) !== Number(routeContext.generation);
          if (route.mode === 'remote' || generationChanged) {
            return reply.code(409).send(ownerChangedPayload(route));
          }
        } else if (route.mode === 'remote' && typeof proxyWebSocket !== 'function') {
          return reply.code(503).send({
            code: 'RUNTIME_ROUTING_NOT_CONFIGURED',
            message: 'Proxy WebSocket para o owner não está configurado.'
          });
        }
      } catch (error) {
        return reply.code(Number(error?.statusCode) || 500).send({
          code: error?.code || 'RUNTIME_ROUTING_FAILED',
          message: error?.message || 'Falha ao resolver owner realtime.'
        });
      }
    }
  }, (socket, request) => {
    const query = request.query ?? {};
    const sessionId = text(query.sessionId);
    const clientId = text(query.clientId, 120);
    const route = request.fenixRuntimeRoute?.route ?? null;

    if (route?.mode === 'remote') {
      proxyWebSocket({ socket, request, route, sessionId, clientId });
      return;
    }

    let peer = null;
    try {
      peer = gateway.openPeer({
        sessionId,
        clientId,
        authToken: readAuthSessionToken(request),
        // Campos abaixo existem apenas para o authorizer de desenvolvimento/testes.
        userId: text(query.userId, 120) || clientId,
        displayName: text(query.name, 120),
        role: text(query.role, 20),
        actorId: text(query.actorId, 200) || null,
        send: (event) => sendJson(socket, event),
        close: (code, reason) => socket.close(code, reason)
      });
    } catch (error) {
      sendJson(socket, {
        type: RealtimeEventType.ERROR,
        payload: {
          code: error?.code || 'REALTIME_CONNECTION_REJECTED',
          message: error?.message || 'Conexão realtime recusada.',
          status: Number(error?.statusCode) || 400
        }
      });
      socket.close(1008, 'Realtime connection rejected');
      return;
    }

    socket.on('message', (raw) => {
      void peer.receive(raw).catch((error) => {
        request.log.warn({
          code: error?.code,
          message: error?.message,
          sessionId,
          clientId
        }, 'Comando realtime rejeitado');
        gateway.sendError(sessionId, clientId, error);
        if (isOwnershipFailure(error) && socket.readyState < 2) {
          socket.close(1012, 'Runtime owner changed');
        }
      });
    });

    socket.on('close', () => peer.disconnect());
    socket.on('error', (error) => {
      request.log.warn({ message: error.message, sessionId, clientId }, 'WebSocket encerrado com erro');
      peer.disconnect();
    });
  });
}
