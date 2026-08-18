import { randomBytes, randomUUID } from 'node:crypto';
import {
  createRemoteRenderSessionRequest,
  createRenderSessionDescriptor
} from '../../../packages/render-stream-contract/src/index.js';

function registryError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function fillTemplate(template, values) {
  let result = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, encodeURIComponent(String(value ?? '')));
  }
  return result;
}

function sessionKey(request) {
  return [request.campaignId, request.sceneId, request.actorId, request.tokenId].join(':');
}

export class RenderSessionRegistry {
  constructor({
    nodeId = 'render-node-01',
    region = null,
    capacity = 2,
    sessionTtlMs = 30 * 60 * 1000,
    renderer = 'unreal-pixel-streaming',
    playerUrlTemplate = '',
    signallingUrlTemplate = '',
    onExpire = null,
    now = () => Date.now()
  } = {}) {
    this.nodeId = String(nodeId);
    this.region = region ? String(region) : null;
    this.capacity = Math.max(1, Number(capacity) || 2);
    this.sessionTtlMs = Math.max(60_000, Number(sessionTtlMs) || 30 * 60 * 1000);
    this.renderer = String(renderer || 'unreal-pixel-streaming');
    this.playerUrlTemplate = String(playerUrlTemplate || '');
    this.signallingUrlTemplate = String(signallingUrlTemplate || '');
    this.onExpire = typeof onExpire === 'function' ? onExpire : null;
    this.now = now;
    this.sessions = new Map();
    this.byKey = new Map();
  }

  get configured() {
    return Boolean(this.playerUrlTemplate);
  }

  get size() {
    this.expire();
    return this.sessions.size;
  }

  get availableSlots() {
    return Math.max(0, this.capacity - this.size);
  }

  status() {
    return Object.freeze({
      nodeId: this.nodeId,
      region: this.region,
      renderer: this.renderer,
      configured: this.configured,
      capacity: this.capacity,
      activeSessions: this.size,
      availableSlots: this.availableSlots,
      available: this.configured && this.availableSlots > 0
    });
  }

  create(input = {}) {
    if (!this.configured) {
      throw registryError('Runtime 3D/Pixel Streaming não configurado neste Render Node.', 'FENIX_RENDER_RUNTIME_NOT_CONFIGURED', 503);
    }
    const request = createRemoteRenderSessionRequest(input);
    this.expire();
    const key = sessionKey(request);
    const existingId = this.byKey.get(key);
    const existing = existingId ? this.sessions.get(existingId) : null;
    if (existing) return existing;
    if (this.sessions.size >= this.capacity) {
      throw registryError('Render Node atingiu a capacidade de sessões simultâneas.', 'FENIX_RENDER_NODE_AT_CAPACITY', 429);
    }

    const renderSessionId = randomUUID();
    const runtimeAccessToken = randomBytes(32).toString('base64url');
    const createdAtMs = this.now();
    const expiresAtMs = createdAtMs + this.sessionTtlMs;
    const values = {
      renderSessionId,
      campaignId: request.campaignId,
      sessionId: request.sessionId ?? '',
      sceneId: request.sceneId,
      actorId: request.actorId,
      tokenId: request.tokenId ?? ''
    };
    const descriptor = createRenderSessionDescriptor({
      renderSessionId,
      status: 'ready',
      playerUrl: fillTemplate(this.playerUrlTemplate, values),
      signallingUrl: this.signallingUrlTemplate ? fillTemplate(this.signallingUrlTemplate, values) : null,
      expiresAt: new Date(expiresAtMs).toISOString(),
      renderer: this.renderer,
      region: this.region
    });
    if (!descriptor.playerUrl) {
      throw registryError('Player URL gerada pelo Render Node é inválida.', 'FENIX_RENDER_PLAYER_URL_INVALID', 500);
    }

    const record = Object.freeze({
      renderSessionId,
      key,
      request,
      descriptor,
      runtimeAccessToken,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
    this.sessions.set(renderSessionId, record);
    this.byKey.set(key, renderSessionId);
    return record;
  }

  get(renderSessionId) {
    this.expire();
    return this.sessions.get(String(renderSessionId)) ?? null;
  }

  delete(renderSessionId) {
    const id = String(renderSessionId ?? '');
    const record = this.sessions.get(id);
    if (!record) return false;
    this.#remove(record);
    return true;
  }

  expire() {
    const now = this.now();
    let removed = 0;
    for (const record of [...this.sessions.values()]) {
      if (Date.parse(record.expiresAt) > now) continue;
      this.#remove(record);
      removed += 1;
      if (this.onExpire) {
        Promise.resolve()
          .then(() => this.onExpire(record))
          .catch(() => undefined);
      }
    }
    return removed;
  }

  #remove(record) {
    this.sessions.delete(record.renderSessionId);
    if (this.byKey.get(record.key) === record.renderSessionId) this.byKey.delete(record.key);
  }
}
