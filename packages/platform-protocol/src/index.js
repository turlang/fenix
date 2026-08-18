const MAX_ID = 200;

function text(value, max = MAX_ID) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function protocolError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const PlatformViewMode = Object.freeze({
  TOP: 'top',
  FIRST_PERSON: 'first-person'
});

export const PlatformRenderMode = Object.freeze({
  LOCAL: 'local',
  CLOUD: 'cloud',
  AUTO: 'auto'
});

export const PlatformTarget = Object.freeze({
  FENIX: 'fenix-vtt',
  FOUNDRY: 'foundry-vtt',
  GENERIC: 'generic-vtt'
});

export const PlatformEventType = Object.freeze({
  SCENE_CHANGED: 'SCENE_CHANGED',
  TOKEN_MOVED: 'TOKEN_MOVED',
  TOKEN_SELECTED: 'TOKEN_SELECTED',
  ACTION_SUBMITTED: 'ACTION_SUBMITTED',
  CHAT_MESSAGE: 'CHAT_MESSAGE',
  VIEW_MODE_CHANGED: 'VIEW_MODE_CHANGED',
  RENDER_SESSION_REQUESTED: 'RENDER_SESSION_REQUESTED',
  RENDER_SESSION_READY: 'RENDER_SESSION_READY',
  RENDER_SESSION_ENDED: 'RENDER_SESSION_ENDED'
});

const EVENT_TYPES = new Set(Object.values(PlatformEventType));
const VIEW_MODES = new Set(Object.values(PlatformViewMode));
const RENDER_MODES = new Set(Object.values(PlatformRenderMode));

export function normalizePlatformEvent(input = {}) {
  const type = text(input.type, 80).toUpperCase();
  if (!EVENT_TYPES.has(type)) throw protocolError('Tipo de evento da plataforma inválido.', 'FENIX_PLATFORM_EVENT_TYPE_INVALID');
  const campaignId = text(input.campaignId);
  if (!campaignId) throw protocolError('campaignId é obrigatório.', 'FENIX_PLATFORM_CAMPAIGN_REQUIRED');

  return Object.freeze({
    version: 1,
    id: text(input.id) || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    campaignId,
    sessionId: text(input.sessionId) || null,
    sceneId: text(input.sceneId) || null,
    tokenId: text(input.tokenId) || null,
    actorId: text(input.actorId) || null,
    source: text(input.source, 120) || PlatformTarget.FENIX,
    occurredAt: input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
    payload: input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? structuredClone(input.payload)
      : {}
  });
}

export function normalizeViewRequest(input = {}) {
  const viewMode = text(input.viewMode, 40).toLowerCase() || PlatformViewMode.TOP;
  const renderMode = text(input.renderMode, 40).toLowerCase() || PlatformRenderMode.AUTO;
  if (!VIEW_MODES.has(viewMode)) throw protocolError('Modo de visão inválido.', 'FENIX_VIEW_MODE_INVALID');
  if (!RENDER_MODES.has(renderMode)) throw protocolError('Modo de renderização inválido.', 'FENIX_RENDER_MODE_INVALID');
  if (viewMode === PlatformViewMode.FIRST_PERSON && !text(input.actorId)) {
    throw protocolError('Primeira pessoa exige actorId.', 'FENIX_FIRST_PERSON_ACTOR_REQUIRED');
  }

  return Object.freeze({
    viewMode,
    renderMode,
    actorId: text(input.actorId) || null,
    tokenId: text(input.tokenId) || null,
    sceneId: text(input.sceneId) || null
  });
}

export function createPlatformCapabilities(input = {}) {
  const viewModes = [...new Set((input.viewModes ?? [PlatformViewMode.TOP]).filter((mode) => VIEW_MODES.has(mode)))];
  const renderModes = [...new Set((input.renderModes ?? [PlatformRenderMode.LOCAL]).filter((mode) => RENDER_MODES.has(mode)))];
  return Object.freeze({
    target: text(input.target, 120) || PlatformTarget.GENERIC,
    viewModes: Object.freeze(viewModes),
    renderModes: Object.freeze(renderModes),
    supportsSceneSync: input.supportsSceneSync !== false,
    supportsTokenSync: input.supportsTokenSync !== false,
    supportsChat: input.supportsChat !== false,
    supportsFirstPerson: viewModes.includes(PlatformViewMode.FIRST_PERSON),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });
}
