import { readAuthSessionToken } from './register-auth-routes.js';

function authorizationError(message, code, statusCode = 403) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
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

    if (operation === 'status') return body;

    if (operation === 'start') {
      const campaignId = String(body.campaignId ?? body.snapshot?.metadata?.campaignId ?? '').trim();
      if (!campaignId) throw authorizationError('campaignId é obrigatório.', 'CAMPAIGN_REQUIRED', 400);
      campaignService.requireRole(campaignId, authenticated.user.id, 'gm');
      return { ...body, campaignId };
    }

    const sessionId = sessionService.getStatus().sessionId;
    if (!sessionId) throw authorizationError('Não existe sessão ativa.', 'SESSION_NOT_ACTIVE', 409);
    const { membership } = campaignService.resolveMembershipForSession(sessionId, authenticated.user.id);

    if (operation === 'end' && membership.role !== 'gm') {
      throw authorizationError('Somente o mestre pode encerrar a sessão.', 'SESSION_END_FORBIDDEN', 403);
    }

    if (operation === 'action' && membership.role === 'player') {
      return { ...body, actorId: membership.actorId };
    }

    return body;
  };
}
