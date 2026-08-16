function nowIso() {
  return new Date().toISOString();
}

function mergeToken(tokens, token) {
  const next = [...tokens];
  const index = next.findIndex((item) => item.id === token.id);
  if (index >= 0) next[index] = { ...next[index], ...token };
  else next.push(token);
  return next;
}

export function createTimelineEntry({
  type,
  title,
  text,
  audio = null,
  roomId = null,
  actorId = null,
  sourceEventId = null,
  createdAt = null
} = {}) {
  const normalizedText = String(text ?? '').trim();
  if (!normalizedText) throw new TypeError('Timeline entry precisa de texto.');
  return Object.freeze({
    id: sourceEventId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceEventId,
    type: String(type || 'NARRATION'),
    title: String(title || 'Narração'),
    text: normalizedText,
    audio,
    audioState: audio ? 'audio-ready' : 'text-ready',
    roomId,
    actorId,
    createdAt: createdAt || nowIso()
  });
}

export function createInitialSessionState() {
  return {
    connection: 'disconnected',
    realtime: 'disconnected',
    engineState: 'IDLE',
    sessionId: null,
    sceneId: null,
    scene: null,
    revision: 0,
    presence: [],
    tokens: [],
    busy: false,
    error: null,
    selectedActorId: null,
    lastRoomId: null,
    timeline: []
  };
}

export function sessionReducer(state, action) {
  switch (action.type) {
    case 'ENGINE_STATUS':
      return {
        ...state,
        connection: 'connected',
        engineState: action.payload?.state ?? 'IDLE',
        sessionId: action.payload?.sessionId ?? null,
        sceneId: action.payload?.sceneId ?? null,
        error: null
      };
    case 'REQUEST_BEGIN':
      return { ...state, busy: true, error: null };
    case 'REQUEST_END':
      return { ...state, busy: false };
    case 'SESSION_STARTED':
      return {
        ...state,
        busy: false,
        connection: 'connected',
        engineState: action.payload?.state ?? 'COLLECTING_ACTIONS',
        sessionId: action.payload?.sessionId ?? state.sessionId,
        error: null,
        timeline: action.entry ? [...state.timeline, action.entry] : state.timeline
      };
    case 'SESSION_ENDED':
      return {
        ...state,
        busy: false,
        realtime: 'disconnected',
        engineState: action.payload?.state ?? 'ENDED',
        sessionId: null,
        lastRoomId: null,
        presence: []
      };
    case 'TIMELINE_APPEND': {
      if (action.entry?.sourceEventId && state.timeline.some((entry) => entry.sourceEventId === action.entry.sourceEventId)) {
        return { ...state, busy: false, engineState: action.engineState ?? state.engineState };
      }
      return {
        ...state,
        busy: false,
        engineState: action.engineState ?? state.engineState,
        lastRoomId: action.roomId ?? state.lastRoomId,
        timeline: [...state.timeline, action.entry]
      };
    }
    case 'REALTIME_CONNECTION':
      return { ...state, realtime: action.status, error: action.error ?? state.error };
    case 'REALTIME_SYNC':
      return {
        ...state,
        realtime: 'connected',
        revision: Number(action.payload?.revision) || 0,
        scene: action.payload?.scene ?? state.scene,
        sceneId: action.payload?.scene?.id ?? state.sceneId,
        presence: Array.isArray(action.payload?.presence) ? action.payload.presence : state.presence,
        tokens: Array.isArray(action.payload?.tokens) ? action.payload.tokens : state.tokens
      };
    case 'REALTIME_PRESENCE':
      return {
        ...state,
        presence: Array.isArray(action.presence) ? action.presence : state.presence
      };
    case 'REALTIME_TOKEN':
      return {
        ...state,
        revision: Number(action.revision) || state.revision,
        tokens: action.token ? mergeToken(state.tokens, action.token) : state.tokens
      };
    case 'REALTIME_SCENE':
      return {
        ...state,
        revision: Number(action.revision) || state.revision,
        scene: action.scene ?? state.scene,
        sceneId: action.scene?.id ?? state.sceneId
      };
    case 'SELECT_ACTOR':
      return { ...state, selectedActorId: action.actorId ?? state.selectedActorId };
    case 'CONNECTION_ERROR':
      return {
        ...state,
        busy: false,
        connection: action.disconnected ? 'disconnected' : state.connection,
        error: action.error ?? 'Falha inesperada.'
      };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}
