import {
  createRemoteRenderSessionRequest,
  createRenderSessionDescriptor
} from '../../render-stream-contract/src/index.js';

function gatewayError(message, code, cause = null, statusCode = 503) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function normalizeNode(node) {
  if (!node?.id || typeof node.createSession !== 'function') {
    throw gatewayError('Render Node inválido.', 'FENIX_RENDER_NODE_INVALID', null, 400);
  }
  return Object.freeze({
    ...node,
    id: String(node.id).trim(),
    region: String(node.region ?? '').trim() || null,
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : 100
  });
}

export class RenderNodeGateway {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.nodes = new Map();
    this.activeSessions = new Map();
  }

  register(node) {
    const normalized = normalizeNode(node);
    if (this.nodes.has(normalized.id)) throw gatewayError('Render Node já registrado.', 'FENIX_RENDER_NODE_DUPLICATE', null, 409);
    this.nodes.set(normalized.id, normalized);
    return normalized;
  }

  list() {
    return [...this.nodes.values()].map(({ id, region, priority }) => ({ id, region, priority }));
  }

  async createSession(input = {}) {
    const request = createRemoteRenderSessionRequest(input);
    const candidates = [...this.nodes.values()].sort((a, b) => a.priority - b.priority);
    let lastError = null;

    for (const node of candidates) {
      try {
        if (typeof node.health === 'function') {
          const health = await node.health({ request });
          if (health === false || health?.ok === false || health?.available === false) continue;
        }
        const result = await node.createSession(request);
        const descriptor = createRenderSessionDescriptor({
          ...result,
          region: result?.region ?? node.region,
          renderer: result?.renderer ?? node.id
        });
        this.activeSessions.set(descriptor.renderSessionId, { nodeId: node.id, request, descriptor });
        return Object.freeze({ request, nodeId: node.id, descriptor });
      } catch (error) {
        lastError = error;
        this.logger.warn?.('[Fênix][Render Gateway] node falhou', { nodeId: node.id, message: error?.message });
      }
    }

    throw gatewayError('Nenhum Render Node GPU disponível.', 'FENIX_RENDER_NODE_UNAVAILABLE', lastError, 503);
  }

  getSession(renderSessionId) {
    return this.activeSessions.get(String(renderSessionId)) ?? null;
  }

  async endSession(renderSessionId) {
    const id = String(renderSessionId ?? '').trim();
    const active = this.activeSessions.get(id);
    if (!active) return false;
    const node = this.nodes.get(active.nodeId);
    try {
      await node?.endSession?.({ renderSessionId: id, request: active.request, descriptor: active.descriptor });
    } finally {
      this.activeSessions.delete(id);
    }
    return true;
  }
}

export function createHttpRenderNode({
  id,
  baseUrl,
  authToken = '',
  region = null,
  priority = 100,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!id) throw gatewayError('id do Render Node é obrigatório.', 'FENIX_RENDER_NODE_ID_REQUIRED', null, 400);
  if (!baseUrl) throw gatewayError('baseUrl do Render Node é obrigatório.', 'FENIX_RENDER_NODE_URL_REQUIRED', null, 400);
  if (typeof fetchImpl !== 'function') throw gatewayError('fetch indisponível.', 'FENIX_RENDER_NODE_FETCH_REQUIRED', null, 500);
  const root = String(baseUrl).replace(/\/$/, '');

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 10_000));
    try {
      const response = await fetchImpl(`${root}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          ...(options.headers ?? {})
        },
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw gatewayError(payload?.message || `Render Node respondeu HTTP ${response.status}.`, 'FENIX_RENDER_NODE_HTTP_ERROR', null, response.status);
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw gatewayError('Render Node excedeu o timeout.', 'FENIX_RENDER_NODE_TIMEOUT', error, 504);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    id: String(id).trim(),
    region: region ? String(region).trim() : null,
    priority,
    async health() {
      try {
        const payload = await request('/health', { method: 'GET' });
        return { ok: payload?.status !== 'error', available: payload?.available !== false };
      } catch {
        return { ok: false, available: false };
      }
    },
    async createSession(renderRequest) {
      return request('/v1/render-sessions', {
        method: 'POST',
        body: JSON.stringify(renderRequest)
      });
    },
    async endSession({ renderSessionId }) {
      return request(`/v1/render-sessions/${encodeURIComponent(renderSessionId)}`, { method: 'DELETE' });
    }
  });
}
