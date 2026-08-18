import { randomBytes, randomUUID } from 'node:crypto';
import {
  createRemoteRenderSessionRequest,
  createRenderSessionDescriptor
} from '../../../packages/render-stream-contract/src/index.js';
import { createFenix3dRuntimeManifest } from '../../../packages/render-runtime-adapter/src/index.js';

const RUNTIME_STAGES = new Set(['booting', 'manifest-ready', 'control-ready', 'ready', 'failed']);

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

function text(value, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function runtimeIdentity(record) {
  return Object.freeze({
    campaignId: record.request.campaignId,
    sceneId: record.request.sceneId,
    actorId: record.request.actorId,
    tokenId: record.request.tokenId ?? null
  });
}

function assertIdentity(record, input = {}) {
  const expected = runtimeIdentity(record);
  for (const [key, value] of Object.entries(expected)) {
    const incoming = input[key];
    if (incoming == null || incoming === '') continue;
    if (String(incoming) !== String(value ?? '')) {
      throw registryError(`Runtime report não corresponde a ${key} da sessão.`, 'FENIX_RENDER_RUNTIME_IDENTITY_MISMATCH', 409);
    }
  }
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
    this.runtimeReports = new Map();
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
    this.expire();
    const runtimeReadySessions = [...this.runtimeReports.values()].filter((report) => report.ready === true).length;
    return Object.freeze({
      nodeId: this.nodeId,
      region: this.region,
      renderer: this.renderer,
      configured: this.configured,
      capacity: this.capacity,
      activeSessions: this.sessions.size,
      runtimeReadySessions,
      availableSlots: Math.max(0, this.capacity - this.sessions.size),
      available: this.configured && this.sessions.size < this.capacity
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

    let runtimeManifest = null;
    if (request.worldBootstrap) {
      runtimeManifest = createFenix3dRuntimeManifest(request.worldBootstrap);
    }

    const record = Object.freeze({
      renderSessionId,
      key,
      request,
      descriptor,
      runtimeManifest,
      runtimeAccessToken,
      createdAt: new Date(createdAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString()
    });
    this.sessions.set(renderSessionId, record);
    this.byKey.set(key, renderSessionId);
    this.runtimeReports.set(renderSessionId, Object.freeze({
      renderSessionId,
      stage: 'starting',
      ready: false,
      failed: false,
      identity: runtimeIdentity(record),
      manifest: null,
      worldBuilt: false,
      controlConfigured: false,
      message: null,
      reportedAt: null,
      history: Object.freeze([])
    }));
    return record;
  }

  get(renderSessionId) {
    this.expire();
    return this.sessions.get(String(renderSessionId)) ?? null;
  }

  reportRuntime(renderSessionId, input = {}) {
    const id = String(renderSessionId ?? '');
    const record = this.get(id);
    if (!record) throw registryError('Sessão de render não encontrada.', 'FENIX_RENDER_SESSION_NOT_FOUND', 404);
    assertIdentity(record, input);

    const stage = text(input.stage, 40).toLowerCase();
    if (!RUNTIME_STAGES.has(stage)) {
      throw registryError('Stage de runtime inválido.', 'FENIX_RENDER_RUNTIME_STAGE_INVALID', 400);
    }

    const previous = this.runtimeReports.get(id);
    const event = Object.freeze({
      stage,
      reportedAt: new Date(this.now()).toISOString(),
      message: text(input.message, 500) || null
    });
    const history = [...(previous?.history ?? []), event].slice(-16);
    const manifestSchema = text(input.manifestSchema, 120) || previous?.manifest?.schema || null;
    const manifestVersion = Number.isFinite(Number(input.manifestVersion))
      ? Number(input.manifestVersion)
      : previous?.manifest?.version ?? null;
    const report = Object.freeze({
      renderSessionId: id,
      stage,
      ready: stage === 'ready',
      failed: stage === 'failed',
      identity: runtimeIdentity(record),
      manifest: manifestSchema ? Object.freeze({ schema: manifestSchema, version: manifestVersion }) : null,
      worldBuilt: input.worldBuilt === true || previous?.worldBuilt === true,
      controlConfigured: input.controlConfigured === true || previous?.controlConfigured === true,
      message: event.message,
      reportedAt: event.reportedAt,
      history: Object.freeze(history)
    });
    this.runtimeReports.set(id, report);
    return report;
  }

  runtimeStatus(renderSessionId) {
    const id = String(renderSessionId ?? '');
    const record = this.get(id);
    if (!record) return null;
    return this.runtimeReports.get(id) ?? null;
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
    this.runtimeReports.delete(record.renderSessionId);
    if (this.byKey.get(record.key) === record.renderSessionId) this.byKey.delete(record.key);
  }
}
