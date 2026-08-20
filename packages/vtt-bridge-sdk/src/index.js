import {
  PlatformTarget,
  createPlatformCapabilities,
  normalizePlatformEvent
} from '../../platform-protocol/src/index.js';

function bridgeError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createVttBridgeAdapter({
  id,
  target = PlatformTarget.GENERIC,
  capabilities = {},
  toFenixEvent,
  fromFenixEvent
} = {}) {
  if (!String(id ?? '').trim()) throw bridgeError('Bridge precisa de id.', 'FENIX_BRIDGE_ID_REQUIRED');
  if (typeof toFenixEvent !== 'function') throw bridgeError('Bridge precisa de toFenixEvent().', 'FENIX_BRIDGE_INGRESS_REQUIRED');
  if (typeof fromFenixEvent !== 'function') throw bridgeError('Bridge precisa de fromFenixEvent().', 'FENIX_BRIDGE_EGRESS_REQUIRED');
  const normalizedCapabilities = createPlatformCapabilities({ target, ...capabilities });
  return Object.freeze({
    id: String(id).trim(),
    target,
    capabilities: normalizedCapabilities,
    ingest(externalEvent, context = {}) {
      const translated = toFenixEvent(externalEvent, context);
      return normalizePlatformEvent({ ...translated, source: translated?.source ?? target });
    },
    emit(fenixEvent, context = {}) {
      const normalized = normalizePlatformEvent(fenixEvent);
      return fromFenixEvent(normalized, context);
    }
  });
}

export class VttBridgeRegistry {
  constructor() { this.adapters = new Map(); }
  register(adapter) {
    if (!adapter?.id || typeof adapter.ingest !== 'function' || typeof adapter.emit !== 'function') throw bridgeError('Adapter de VTT inválido.', 'FENIX_BRIDGE_INVALID');
    if (this.adapters.has(adapter.id)) throw bridgeError('Bridge já registrado.', 'FENIX_BRIDGE_DUPLICATE');
    this.adapters.set(adapter.id, adapter);
    return adapter;
  }
  get(id) { return this.adapters.get(String(id)) ?? null; }
  list() {
    return [...this.adapters.values()].map((adapter) => ({ id: adapter.id, target: adapter.target, capabilities: adapter.capabilities }));
  }
}

function clean(value, max = 300) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function createContentSyncEnvelope({
  source = 'foundry',
  worldId = null,
  systemId = null,
  systemVersion = null,
  coreVersion = null,
  journal,
  entities = [],
  generatedAt = new Date().toISOString()
} = {}) {
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)) throw bridgeError('Content Sync exige JournalEntry raiz.', 'FENIX_BRIDGE_CONTENT_JOURNAL_REQUIRED');
  if (!Array.isArray(entities)) throw bridgeError('entities deve ser uma lista.', 'FENIX_BRIDGE_CONTENT_ENTITIES_INVALID');
  return Object.freeze({
    schema: 'fenix.bridge-content-sync',
    version: 1,
    source: Object.freeze({
      adapter: clean(source, 100) || 'foundry',
      worldId: clean(worldId, 200) || null,
      systemId: clean(systemId, 200) || null,
      systemVersion: clean(systemVersion, 100) || null,
      coreVersion: clean(coreVersion, 100) || null,
      generatedAt: clean(generatedAt, 100)
    }),
    journal,
    entities: Object.freeze([...entities]),
    policy: Object.freeze({ sourceUuidIsIdentity: true, differentialSyncReady: true, executableContentAllowed: false })
  });
}
