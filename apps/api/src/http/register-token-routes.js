import { requireAuthenticatedRequest } from './register-auth-routes.js';

function sendError(reply, error, fallback = 'CAMPAIGN_TOKEN_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar token da cena.'
  });
}

export function registerTokenRoutes(app, { authService, tokenService }) {
  if (!app || !authService || !tokenService) {
    throw new TypeError('app, authService e tokenService são obrigatórios.');
  }

  app.get('/v1/campaigns/:campaignId/scenes/:sceneId/tokens', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        tokens: tokenService.list({
          campaignId: request.params.campaignId,
          userId: authenticated.user.id,
          sceneId: request.params.sceneId
        })
      };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_TOKEN_LIST_FAILED');
    }
  });

  app.post('/v1/campaigns/:campaignId/scenes/:sceneId/tokens', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const token = await tokenService.upsert({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        sceneId: request.params.sceneId,
        token: request.body?.token ?? request.body
      });
      return { token };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_TOKEN_UPDATE_FAILED');
    }
  });
}
