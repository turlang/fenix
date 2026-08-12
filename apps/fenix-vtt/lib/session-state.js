function nowIso() {
  return new Date().toISOString();
}

export function createTimelineEntry({ type, title, text, audio = null, roomId = null, actorId = null } = {}) {
  const normalizedText = String(text ?? '').trim();
  if (!normalizedText) throw new TypeError('Timeline entry precisa de texto.');
  return Object.freeze({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type: String(type || 'NARRATION'),
    title: String(title || 'Narração'),
    text: normalizedText,
    audio,
    audioState: audio ? 'audio-ready' : 'text-ready',
    roomId,
    actorId,
    createdAt: nowIso()
  });
}

export function createInitialSessionState() {
  return {
    connection: 'disconnected',
    engineState: 'IDLE',
    sessionId: null,
    sceneId: null,
    busy: false,
    error: null,
    selectedActorId: 'hero-ayla',
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
        engineState: action.payload?.state ?? 'ENDED',
        sessionId: null,
        lastRoomId: null
      };
    case 'TIMELINE_APPEND':
      return {
        ...state,
        busy: false,
        engineState: action.engineState ?? state.engineState,
        lastRoomId: action.roomId ?? state.lastRoomId,
        timeline: [...state.timeline, action.entry]
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
