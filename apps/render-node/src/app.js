import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function errorPayload(error) {
  return {
    code: error?.code || 'FENIX_RENDER_NODE_ERROR',
    message: error?.message || 'Falha no Render Node.'
  };
}

export function createRenderNodeApp({ config, registry, logger = true } = {}) {
  if (!config) throw new TypeError('config é obrigatório.');
  if (!registry) throw new TypeError('registry é obrigatório.');
  const app = Fastify({ logger });

  function requireInternalAuth(request, reply) {
    if (request.url === '/health' && config.allowUnauthenticatedHealth) return true;
    if (!config.authToken) {
      reply.code(503).send({ code: 'FENIX_RENDER_NODE_AUTH_NOT_CONFIGURED', message: 'Token interno do Render Node não configurado.' });
      return false;
    }
    if (!safeEqual(bearerToken(request), config.authToken)) {
      reply.code(401).send({ code: 'FENIX_RENDER_NODE_UNAUTHORIZED', message: 'Credencial interna inválida.' });
      return false;
    }
    return true;
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!requireInternalAuth(request, reply)) return reply;
  });

  app.get('/health', async () => {
    const status = registry.status();
    return {
      status: status.configured ? 'ok' : 'degraded',
      service: 'fenix-render-node',
      nodeId: status.nodeId,
      region: status.region,
      renderer: status.renderer,
      configured: status.configured,
      capacity: status.capacity,
      activeSessions: status.activeSessions,
      availableSlots: status.availableSlots,
      available: status.available
    };
  });

  app.post('/v1/render-sessions', async (request, reply) => {
    try {
      const record = registry.create(request.body ?? {});
      return reply.code(201).send(record.descriptor);
    } catch (error) {
      return reply.code(Number(error?.statusCode) || 400).send(errorPayload(error));
    }
  });

  app.get('/v1/render-sessions/:renderSessionId', async (request, reply) => {
    const record = registry.get(request.params.renderSessionId);
    if (!record) return reply.code(404).send({ code: 'FENIX_RENDER_SESSION_NOT_FOUND', message: 'Sessão de render não encontrada.' });
    return record.descriptor;
  });

  app.delete('/v1/render-sessions/:renderSessionId', async (request, reply) => {
    const ended = registry.delete(request.params.renderSessionId);
    if (!ended) return reply.code(404).send({ code: 'FENIX_RENDER_SESSION_NOT_FOUND', message: 'Sessão de render não encontrada.' });
    return { renderSessionId: request.params.renderSessionId, ended: true };
  });

  return app;
}
