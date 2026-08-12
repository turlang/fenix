const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 12000;
const CONFIGURED_BASE_URL = process.env.NEXT_PUBLIC_FENIX_API_URL || DEFAULT_BASE_URL;

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

export class FenixApiError extends Error {
  constructor(message, { status = 0, code = 'FENIX_API_ERROR', retryAfter = null, cause = null } = {}) {
    super(message, { cause });
    this.name = 'FenixApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function resolveFenixApiBaseUrl(env = null) {
  return trimTrailingSlash(env?.NEXT_PUBLIC_FENIX_API_URL || CONFIGURED_BASE_URL);
}

async function readPayload(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json')) return response.json();
  const text = await response.text();
  return text ? { message: text } : {};
}

export class FenixApiClient {
  constructor({ baseUrl = resolveFenixApiBaseUrl(), fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl deve ser uma função.');
    this.baseUrl = trimTrailingSlash(baseUrl);
    this.fetchImpl = fetchImpl;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  }

  async request(path, { method = 'GET', body = undefined } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await readPayload(response);
      if (!response.ok) {
        throw new FenixApiError(payload?.message || `Engine respondeu HTTP ${response.status}.`, {
          status: response.status,
          code: payload?.code || 'FENIX_API_ERROR',
          retryAfter: payload?.retryAfter ?? null
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof FenixApiError) throw error;
      if (error?.name === 'AbortError') {
        throw new FenixApiError('O Engine não respondeu dentro do tempo limite.', {
          code: 'FENIX_API_TIMEOUT',
          cause: error
        });
      }
      throw new FenixApiError('Não foi possível conectar ao Fênix Engine.', {
        code: 'FENIX_API_UNREACHABLE',
        cause: error
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  health() { return this.request('/health'); }
  authStatus() { return this.request('/v1/auth/status'); }
  me() { return this.request('/v1/auth/me'); }
  bootstrap(input) { return this.request('/v1/auth/bootstrap', { method: 'POST', body: input }); }
  login(input) { return this.request('/v1/auth/login', { method: 'POST', body: input }); }
  logout() { return this.request('/v1/auth/logout', { method: 'POST' }); }

  listCampaigns() { return this.request('/v1/campaigns'); }
  getCampaign(campaignId) { return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}`); }
  createCampaign(input) { return this.request('/v1/campaigns', { method: 'POST', body: input }); }
  createInvite(campaignId, actorId) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/invites`, {
      method: 'POST',
      body: { actorId }
    });
  }
  inspectInvite(token) { return this.request('/v1/invites/inspect', { method: 'POST', body: { token } }); }
  acceptInvite(token) { return this.request('/v1/invites/accept', { method: 'POST', body: { token } }); }
  registerInvite(input) { return this.request('/v1/invites/register', { method: 'POST', body: input }); }

  status() { return this.request('/v1/session/status'); }
  start(snapshot, campaignId = null) {
    return this.request('/v1/session/start', { method: 'POST', body: { snapshot, campaignId } });
  }
  action({ content, actorId = null, messageId = null } = {}) {
    return this.request('/v1/session/action', {
      method: 'POST',
      body: { content, actorId, messageId }
    });
  }
  roomEntry(event) { return this.request('/v1/session/room-entry', { method: 'POST', body: event }); }
  end() { return this.request('/v1/session/end', { method: 'POST' }); }
}

export function createFenixApiClient(options) {
  return new FenixApiClient(options);
}
