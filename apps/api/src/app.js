import Fastify from 'fastify';
import { ENGINE_VERSION } from '../../../packages/core/src/index.js';
import { isOriginAllowed } from '../../../packages/config/src/index.js';
import { createSessionController } from './http/session-controller.js';
import { registerSessionRoutes } from './http/register-session-routes.js';

export function createApiApp({ config, sessionService, narrator, audioNarrationService }) {
  if (!config) throw new TypeError('config é obrigatório.');
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');

  const app = Fastify({
    logger: true,
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy
  });

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (request.method === 'OPTIONS') return reply.code(204).send();
  });

  app.get('/health', { logLevel: 'silent' }, async () => ({
    status: 'ok',
    service: 'mestre-orc-engine',
    version: ENGINE_VERSION,
    ai: narrator ? 'groq' : 'not-configured',
    narrativeMemory: 'persistent-file',
    audio: audioNarrationService?.enabled ? audioNarrationService.mode : 'disabled',
    runtime: sessionService.getStatus()
  }));

  const controller = createSessionController({ sessionService });
  registerSessionRoutes(app, { controller });

  app.setErrorHandler((error, request, reply) => {
    const status = Number(error.statusCode) || 500;
    request.log.error({ err: error, requestId: request.id }, 'Falha na requisição');
    reply.code(status).send({
      code: error.code || (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST'),
      message: status >= 500 && config.isProduction ? 'Erro interno do servidor.' : error.message,
      requestId: request.id
    });
  });

  return app;
}
