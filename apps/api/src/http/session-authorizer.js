import { readAuthSessionToken } from './register-auth-routes.js';

function authorizationError(message, code, statusCode = 403) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function requestedCampaignId(request, body = {}) {
  return String(
    body.campaignId
    ?? body.snapshot?.metadata?.campaignId
    ?? request.query?.campaignId
    ?? ''
  ).trim();
}

export function createSessionRequestAuthorizer({
  authService,
  campaignService,
  sessionService,
  allowLegacy = false
} = {}) {
  if (!authService || !campaignService || !sessionService) {
    throw new TypeError('authService, campaignService e sessionService são obrigatórios.');
  }

  return async (request, operation) => {
    const body = request.body ?? {};
    const rawToken = readAuthSessionToken(request);
    const authenticated = authService.authenticateToken(rawToken);

    if (!authenticated) {
      if (allowLegacy) return body;
      throw authorizationError('Autenticação obrigatória.', 'AUTH_REQUIRED', 401);
    }

    const campaignId = requestedCampaignId(request, body);
    if (!campaignId) throw authorizationError('campaignId é obrigatório.', 'CAMPAIGN_REQUIRED', 400);

    if (operation === 'start') {
      campaignService.requireRole(campaignId, authenticated.user.id, 'gm');
      return { ...body, campaignId };
    }

    const { membership } = campaignService.requireRole(campaignId, authenticated.user.id);
    const status = sessionService.getStatus({ campaignId });

    if (operation === 'status') {
      return { campaignId };
    }

    if (!status.sessionId) throw authorizationError('Não existe sessão ativa nesta campanha.', 'SESSION_NOT_ACTIVE', 409);

    if (operation === 'end' && membership.role !== 'gm') {
      throw authorizationError('Somente o mestre pode encerrar a sessão.', 'SESSION_END_FORBIDDEN', 403);
    }

    if (operation === 'action' && membership.role === 'player') {
      return { ...body, campaignId, sessionId: status.sessionId, actorId: membership.actorId };
    }

    return { ...body, campaignId, sessionId: status.sessionId };
  };
}
