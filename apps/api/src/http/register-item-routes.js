import { requireAuthenticatedRequest } from './register-auth-routes.js';

function sendError(reply, error, fallback = 'CAMPAIGN_ITEM_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar item.'
  });
}

export function registerItemRoutes(app, { authService, itemService }) {
  if (!app || !authService || !itemService) throw new TypeError('app, authService e itemService são obrigatórios.');

  app.get('/v1/campaigns/:campaignId/items', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { items: itemService.list({ campaignId: request.params.campaignId, userId: authenticated.user.id }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId/items/:itemId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { item: itemService.get({ campaignId: request.params.campaignId, userId: authenticated.user.id, itemId: request.params.itemId }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns/:campaignId/items/:itemId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const item = await itemService.update({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        itemId: request.params.itemId,
        input: request.body ?? {}
      });
      return { item };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_ITEM_UPDATE_FAILED');
    }
  });
}
