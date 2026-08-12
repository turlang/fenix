import {
  normalizeGameSnapshot,
  normalizePlayerActionEvent,
  normalizeRoomEnteredEvent
} from '../../vtt-contracts/src/index.js';

function withStandaloneMetadata(snapshot) {
  return Object.freeze({
    ...snapshot,
    metadata: Object.freeze({
      ...(snapshot.metadata ?? {}),
      source: 'fenix-standalone'
    })
  });
}

export class InMemoryStandaloneStateStore {
  constructor(initialSnapshot = {}) {
    this.snapshot = normalizeGameSnapshot(initialSnapshot);
  }

  async readSnapshot() {
    return this.snapshot;
  }

  async writeSnapshot(nextSnapshot) {
    this.snapshot = normalizeGameSnapshot(nextSnapshot ?? {});
    return this.snapshot;
  }
}

export class StandaloneVttAdapter {
  constructor({ store = null, initialSnapshot = {}, logger = console } = {}) {
    this.store = store ?? new InMemoryStandaloneStateStore(initialSnapshot);
    if (typeof this.store.readSnapshot !== 'function' || typeof this.store.writeSnapshot !== 'function') {
      throw new TypeError('store deve implementar readSnapshot() e writeSnapshot().');
    }
    this.logger = logger;
  }

  async sync() {
    const raw = await this.store.readSnapshot();
    const snapshot = withStandaloneMetadata(normalizeGameSnapshot(raw));
    if (!snapshot.activeScene) throw new Error('Nenhuma cena ativa foi definida no VTT standalone.');
    this.logger.info?.('[Fênix][StandaloneAdapter] snapshot sincronizado', {
      sceneId: snapshot.activeScene?.id ?? null,
      actors: snapshot.visibleActors.length
    });
    return snapshot;
  }

  async setSnapshot(nextSnapshot) {
    const normalized = withStandaloneMetadata(normalizeGameSnapshot(nextSnapshot));
    await this.store.writeSnapshot(normalized);
    return normalized;
  }

  async setActiveScene(scene, patch = {}) {
    const current = normalizeGameSnapshot(await this.store.readSnapshot());
    return this.setSnapshot({
      ...current,
      ...patch,
      activeScene: scene
    });
  }

  createPlayerAction(input) {
    return normalizePlayerActionEvent(input);
  }

  createRoomEntered(input) {
    return normalizeRoomEnteredEvent(input);
  }
}

export function createStandaloneVttAdapter(options) {
  return new StandaloneVttAdapter(options);
}
