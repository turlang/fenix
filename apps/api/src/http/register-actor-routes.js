import { requireAuthenticatedRequest } from './register-auth-routes.js';

function sendError(reply, error, fallback = 'CAMPAIGN_ACTOR_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar ator/ficha.'
  });
}

export function registerActorRoutes(app, { authService, actorService }) {
  if (!app || !authService || !actorService) {
    throw new TypeError('app, authService e actorService são obrigatórios.');
  }

  app.get('/v1/campaigns/:campaignId/actors', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        actors: actorService.list({
          campaignId: request.params.campaignId,
          userId: authenticated.user.id
        })
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId/actors/:actorId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        actor: actorService.get({
          campaignId: request.params.campaignId,
          userId: authenticated.user.id,
          actorId: request.params.actorId
        })
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns/:campaignId/actors/:actorId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const actor = await actorService.upsert({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        actorId: request.params.actorId,
        sheetId: request.body?.sheetId,
        systemId: request.body?.systemId,
        name: request.body?.name,
        kind: request.body?.kind,
        image: request.body?.image,
        sheet: request.body?.sheet ?? {}
      });
      return { actor };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_ACTOR_UPDATE_FAILED');
    }
  });
}
