export const VttEventType = Object.freeze({
  PLAYER_ACTION: 'PLAYER_ACTION',
  ROOM_ENTERED: 'ROOM_ENTERED'
});

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function optionalString(value, maxLength = 500) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function requiredString(value, field, maxLength = 500) {
  const normalized = optionalString(value, maxLength);
  if (!normalized) throw new TypeError(`${field} é obrigatório.`);
  return normalized;
}

export function normalizeGameSnapshot(input = {}) {
  const source = asObject(input);
  const activeScene = source.activeScene ?? source.scene ?? null;
  return Object.freeze({
    activeScene: activeScene ? { ...asObject(activeScene) } : null,
    campaign: source.campaign ? { ...asObject(source.campaign) } : null,
    visibleActors: Array.isArray(source.visibleActors ?? source.actors)
      ? [...(source.visibleActors ?? source.actors)]
      : [],
    sceneJournal: source.sceneJournal ?? source.journal ?? null,
    system: source.system ? { ...asObject(source.system) } : null,
    metadata: source.metadata ? { ...asObject(source.metadata) } : null
  });
}

export function normalizePlayerActionEvent(input = {}) {
  const source = asObject(input);
  return Object.freeze({
    type: VttEventType.PLAYER_ACTION,
    content: requiredString(source.content, 'content', 4000),
    actorId: optionalString(source.actorId, 200),
    messageId: optionalString(source.messageId, 200),
    createdAt: optionalString(source.createdAt, 100) ?? new Date().toISOString()
  });
}

export function normalizeRoomEnteredEvent(input = {}) {
  const source = asObject(input);
  const room = asObject(source.room);
  const canonicalSource = asObject(source.source);
  return Object.freeze({
    type: VttEventType.ROOM_ENTERED,
    room: Object.freeze({
      id: requiredString(room.id, 'room.id', 200),
      name: requiredString(room.name, 'room.name', 300)
    }),
    source: Object.freeze({
      canonicalAnchor: Boolean(canonicalSource.canonicalAnchor),
      text: requiredString(canonicalSource.text, 'source.text', 5000),
      type: optionalString(canonicalSource.type, 100) ?? 'ROOM_READ_ALOUD',
      extractionMode: optionalString(canonicalSource.extractionMode, 100)
    }),
    scene: source.scene ? { ...asObject(source.scene) } : null,
    campaign: source.campaign ? { ...asObject(source.campaign) } : null,
    visibleActors: Array.isArray(source.visibleActors) ? [...source.visibleActors] : []
  });
}

export function assertVttContextPort(port) {
  if (!port || typeof port.sync !== 'function') {
    throw new TypeError('contextPort deve implementar sync().');
  }
  return port;
}

export function assertNarrationOutputPort(port) {
  if (!port || typeof port.publishNarration !== 'function') {
    throw new TypeError('narrationOutput deve implementar publishNarration().');
  }
  return port;
}

export function createSnapshotContextPort(initial = {}) {
  let snapshot = normalizeGameSnapshot(initial);
  return {
    setSnapshot(next) {
      snapshot = normalizeGameSnapshot(next ?? {});
    },
    async sync() {
      if (!snapshot.activeScene) throw new Error('Nenhuma cena ativa foi fornecida ao Engine.');
      return snapshot;
    }
  };
}
