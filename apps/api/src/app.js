import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { ENGINE_VERSION } from '../../../packages/core/src/index.js';
import { isOriginAllowed } from '../../../packages/config/src/index.js';
import { createSessionController } from './http/session-controller.js';
import { registerSessionRoutes } from './http/register-session-routes.js';
import { registerAuthRoutes } from './http/register-auth-routes.js';
import { registerCampaignRoutes } from './http/register-campaign-routes.js';
import { createSessionRequestAuthorizer } from './http/session-authorizer.js';
import { registerRealtimeRoutes } from './realtime/register-realtime-routes.js';

export async function createApiApp({
  config,
  sessionService,
  narrator,
  audioNarrationService,
  realtimeGateway = null,
  authService = null,
  campaignService = null
}) {
  if (!config) throw new TypeError('config é obrigatório.');
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');

  const app = Fastify({
    logger: true,
    bodyLimit: config.bodyLimit,
    trustProxy: config.trustProxy
  });

  if (realtimeGateway) {
    await app.register(websocket, {
      options: {
        maxPayload: 64 * 1024,
        perMessageDeflate: false
      }
    });
  }

  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Access-Control-Allow-Credentials', 'true');
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
    persistence: campaignService ? 'campaign-file' : 'disabled',
    auth: authService ? 'opaque-session' : 'disabled',
    audio: audioNarrationService?.enabled ? audioNarrationService.mode : 'disabled',
    realtime: realtimeGateway ? 'websocket' : 'disabled',
    runtime: sessionService.getStatus()
  }));

  if (authService && campaignService) {
    registerAuthRoutes(app, { authService, campaignService, config });
    registerCampaignRoutes(app, { authService, campaignService, config });
  }

  if (realtimeGateway) {
    registerRealtimeRoutes(app, {
      gateway: realtimeGateway,
      allowOrigin: (origin) => isOriginAllowed(origin, config.allowedOrigins)
    });
  }

  const authorizeRequest = authService && campaignService
    ? createSessionRequestAuthorizer({
        authService,
        campaignService,
        sessionService,
        allowLegacy: config.allowLegacySessionHttp
      })
    : undefined;
  const controller = createSessionController({ sessionService, authorizeRequest });
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
