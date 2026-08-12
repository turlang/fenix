import { RealtimeEventType } from '../../../../packages/realtime-session-gateway/src/index.js';

function text(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sendJson(socket, event) {
  if (socket.readyState !== 1) return false;
  socket.send(JSON.stringify(event));
  return true;
}

export function registerRealtimeRoutes(app, { gateway, allowOrigin = () => true }) {
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
    }
  }, (socket, request) => {
    const query = request.query ?? {};
    const sessionId = text(query.sessionId);
    const clientId = text(query.clientId, 120);
    let peer = null;

    try {
      peer = gateway.openPeer({
        sessionId,
        clientId,
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

    // O listener precisa ser anexado durante a execução síncrona do handler.
    socket.on('message', (raw) => {
      void peer.receive(raw).catch((error) => {
        request.log.warn({
          code: error?.code,
          message: error?.message,
          sessionId,
          clientId
        }, 'Comando realtime rejeitado');
        gateway.sendError(sessionId, clientId, error);
      });
    });

    socket.on('close', () => peer.disconnect());
    socket.on('error', (error) => {
      request.log.warn({ message: error.message, sessionId, clientId }, 'WebSocket encerrado com erro');
      peer.disconnect();
    });
  });
}
