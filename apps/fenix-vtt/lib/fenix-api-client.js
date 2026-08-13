const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT_MS = 12000;
const CONFIGURED_BASE_URL = process.env.NEXT_PUBLIC_FENIX_API_URL || DEFAULT_BASE_URL;

function trimTrailingSlash(value) {
  return String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

function randomCommandId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return globalThis.btoa(binary);
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
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS);
  }

  async request(path, { method = 'GET', body = undefined, timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
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

  listScenes(campaignId) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes`);
  }

  async uploadMapAsset(campaignId, file) {
    if (!file?.arrayBuffer) throw new TypeError('Selecione um arquivo de mapa válido.');
    const buffer = await file.arrayBuffer();
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/assets`, {
      method: 'POST',
      timeoutMs: Math.max(this.timeoutMs, 60000),
      body: {
        fileName: file.name,
        mimeType: file.type,
        dataBase64: arrayBufferToBase64(buffer)
      }
    });
  }

  importMapUrl(campaignId, url) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/assets/import-url`, {
      method: 'POST',
      timeoutMs: Math.max(this.timeoutMs, 60000),
      body: { url }
    });
  }

  createScene(campaignId, input) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes`, {
      method: 'POST',
      body: input
    });
  }

  updateSceneGrid(campaignId, sceneId, grid) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}/grid`, {
      method: 'POST',
      body: grid
    });
  }

  updateSceneWalls(campaignId, sceneId, walls) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}/walls`, {
      method: 'POST',
      body: { walls }
    });
  }

  updateSceneFog(campaignId, sceneId, fog) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}/fog`, {
      method: 'POST',
      body: fog
    });
  }

  updateSceneLighting(campaignId, sceneId, lighting) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}/lighting`, {
      method: 'POST',
      body: lighting
    });
  }

  activateScene(campaignId, sceneId) {
    return this.request(`/v1/campaigns/${encodeURIComponent(campaignId)}/scenes/${encodeURIComponent(sceneId)}/activate`, {
      method: 'POST'
    });
  }

  assetUrl(campaignId, assetId) {
    return `${this.baseUrl}/v1/campaigns/${encodeURIComponent(campaignId)}/assets/${encodeURIComponent(assetId)}`;
  }

  status(campaignId = null) {
    const suffix = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    return this.request(`/v1/session/status${suffix}`);
  }
  start(snapshot, campaignId = null, commandId = randomCommandId()) {
    return this.request('/v1/session/start', { method: 'POST', body: { snapshot, campaignId, commandId } });
  }
  action({ content, actorId = null, messageId = null, commandId = null, campaignId = null } = {}) {
    const id = commandId || messageId || randomCommandId();
    return this.request('/v1/session/action', {
      method: 'POST',
      body: { content, actorId, messageId: messageId || id, commandId: id, campaignId }
    });
  }
  roomEntry(event, campaignId = null, commandId = randomCommandId()) {
    return this.request('/v1/session/room-entry', {
      method: 'POST',
      body: { ...event, campaignId: event?.campaignId ?? campaignId, commandId: event?.commandId ?? commandId }
    });
  }
  end(campaignId = null, commandId = randomCommandId()) {
    return this.request('/v1/session/end', { method: 'POST', body: { campaignId, commandId } });
  }
}

export function createFenixApiClient(options) {
  return new FenixApiClient(options);
}
