const COOKIE_NAME = 'fenix_session';

function parseSessionToken(request) {
  const header = String(request.headers.cookie ?? '');
  for (const chunk of header.split(';')) {
    const [rawKey, ...rest] = chunk.split('=');
    if (rawKey?.trim() !== COOKIE_NAME) continue;
    const value = rest.join('=').trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}

function sessionCookie(token, { expiresAt = null, secure = false, clear = false } = {}) {
  const parts = [
    `${COOKIE_NAME}=${clear ? '' : encodeURIComponent(String(token ?? ''))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax'
  ];
  if (secure) parts.push('Secure');
  if (clear) {
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  } else if (expiresAt) {
    const expires = new Date(expiresAt);
    if (!Number.isNaN(expires.getTime())) parts.push(`Expires=${expires.toUTCString()}`);
  }
  return parts.join('; ');
}

function sendAuthError(reply, error) {
  const status = Number(error?.statusCode) || 400;
  return reply.code(status).send({
    code: error?.code || 'AUTH_REQUEST_FAILED',
    message: error?.message || 'Falha de autenticação.'
  });
}

export function requireAuthenticatedRequest(authService, request) {
  return authService.requireToken(parseSessionToken(request));
}

export function registerAuthRoutes(app, { authService, campaignService, config }) {
  if (!app || !authService || !campaignService || !config) {
    throw new TypeError('app, authService, campaignService e config são obrigatórios.');
  }

  app.get('/v1/auth/status', async () => ({
    bootstrapRequired: !authService.hasUsers()
  }));

  app.get('/v1/auth/me', async (request, reply) => {
    try {
      const authenticated = requireAuthenticatedRequest(authService, request);
      return {
        user: authenticated.user,
        campaigns: campaignService.listForUser(authenticated.user.id)
      };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/bootstrap', async (request, reply) => {
    try {
      const user = await authService.bootstrapOwner(request.body ?? {});
      const session = await authService.createSession(user.id);
      reply.header('Set-Cookie', sessionCookie(session.token, {
        expiresAt: session.expiresAt,
        secure: config.isProduction
      }));
      return { user: session.user, bootstrap: true };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    try {
      const session = await authService.login(request.body ?? {});
      reply.header('Set-Cookie', sessionCookie(session.token, {
        expiresAt: session.expiresAt,
        secure: config.isProduction
      }));
      return { user: session.user };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    try {
      const token = parseSessionToken(request);
      await authService.logout(token);
      reply.header('Set-Cookie', sessionCookie('', { clear: true, secure: config.isProduction }));
      return { authenticated: false };
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });
}

export function readAuthSessionToken(request) {
  return parseSessionToken(request);
}
