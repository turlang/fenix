import { requireAuthenticatedRequest } from './register-auth-routes.js';

function sendError(reply, error) {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || 'FENIX_RENDER_REQUEST_FAILED',
    message: error?.message || 'Falha ao processar sessão de render.'
  });
}

export function registerRenderRoutes(app, { authService, renderBrokerService }) {
  if (!app || !authService || !renderBrokerService) {
    throw new TypeError('app, authService e renderBrokerService são obrigatórios.');
  }

  app.post('/v1/campaigns/:campaignId/render-sessions', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const session = await renderBrokerService.create({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        sceneId: request.body?.sceneId,
        actorId: request.body?.actorId,
        tokenId: request.body?.tokenId,
        sessionId: request.body?.sessionId,
        preferredCodecs: request.body?.preferredCodecs,
        targetFps: request.body?.targetFps,
        maxWidth: request.body?.maxWidth,
        maxHeight: request.body?.maxHeight
      });
      return reply.code(201).send({ session });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId/render-sessions/:renderSessionId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        session: renderBrokerService.get({
          campaignId: request.params.campaignId,
          userId: authenticated.user.id,
          renderSessionId: request.params.renderSessionId
        })
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.delete('/v1/campaigns/:campaignId/render-sessions/:renderSessionId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return await renderBrokerService.end({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        renderSessionId: request.params.renderSessionId
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
