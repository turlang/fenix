import { requireAuthenticatedRequest } from './register-auth-routes.js';

function sendError(reply, error, fallback = 'ROLL_TABLE_REQUEST_FAILED') {
  return reply.code(Number(error?.statusCode) || 400).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar RollTable.'
  });
}

export function registerRollTableRoutes(app, { authService, rollTableService }) {
  if (!app || !authService || !rollTableService) throw new TypeError('app, authService e rollTableService são obrigatórios.');

  app.get('/v1/campaigns/:campaignId/roll-tables', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { rollTables: rollTableService.list({ campaignId: request.params.campaignId, userId: authenticated.user.id }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId/roll-tables/:rollTableId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { rollTable: rollTableService.get({ campaignId: request.params.campaignId, userId: authenticated.user.id, rollTableId: request.params.rollTableId }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns/:campaignId/roll-tables/:rollTableId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { rollTable: await rollTableService.update({
        campaignId: request.params.campaignId,
        userId: authenticated.user.id,
        rollTableId: request.params.rollTableId,
        input: request.body ?? {}
      }) };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
