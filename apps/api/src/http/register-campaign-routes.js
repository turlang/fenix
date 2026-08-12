import {
  requireAuthenticatedRequest,
  serializeAuthSessionCookie
} from './register-auth-routes.js';

function sendError(reply, error, fallback = 'CAMPAIGN_REQUEST_FAILED') {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || fallback,
    message: error?.message || 'Falha ao processar campanha.'
  });
}

export function registerCampaignRoutes(app, { authService, campaignService, config }) {
  if (!app || !authService || !campaignService || !config) {
    throw new TypeError('app, authService, campaignService e config são obrigatórios.');
  }

  app.get('/v1/campaigns', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return { campaigns: campaignService.listForUser(authenticated.user.id) };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const campaign = await campaignService.createCampaign({
        ownerUserId: authenticated.user.id,
        title: request.body?.title,
        systemId: request.body?.systemId
      });
      return { campaign };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.get('/v1/campaigns/:campaignId', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        campaign: campaignService.getForUser(request.params.campaignId, authenticated.user.id)
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });

  app.post('/v1/campaigns/:campaignId/invites', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const created = await campaignService.createInvite({
        campaignId: request.params.campaignId,
        createdByUserId: authenticated.user.id,
        actorId: request.body?.actorId
      });
      return created;
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_INVITE_CREATE_FAILED');
    }
  });

  app.post('/v1/invites/inspect', async (request, reply) => {
    try {
      return { invite: campaignService.inspectInvite(request.body?.token) };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_INVITE_INVALID');
    }
  });

  app.post('/v1/invites/accept', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      const campaign = await campaignService.acceptInvite({
        token: request.body?.token,
        userId: authenticated.user.id
      });
      return { campaign };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_INVITE_ACCEPT_FAILED');
    }
  });

  app.post('/v1/invites/register', async (request, reply) => {
    try {
      campaignService.inspectInvite(request.body?.token);
      const user = await authService.createUser({
        email: request.body?.email,
        displayName: request.body?.displayName,
        password: request.body?.password
      });
      const campaign = await campaignService.acceptInvite({
        token: request.body?.token,
        userId: user.id
      });
      const session = await authService.createSession(user.id);
      reply.header('Set-Cookie', serializeAuthSessionCookie(session.token, {
        expiresAt: session.expiresAt,
        secure: config.isProduction
      }));
      return { user: session.user, campaign };
    } catch (error) {
      return sendError(reply, error, 'CAMPAIGN_INVITE_REGISTER_FAILED');
    }
  });
}
