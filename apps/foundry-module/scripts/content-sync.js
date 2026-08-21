const MODULE_ID = 'mestre-orc';
const DEFAULT_API_URL = 'http://localhost:3001';
const SUPPORTED_ENTITY_TYPES = new Set(['Actor', 'Item', 'RollTable']);
const UUID_PATTERN = /(?:@UUID\[([^\]]+)\]|data-(?:entity-)?uuid=["']([^"']+)["'])/gi;

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function serializeDocument(document) {
  const raw = typeof document?.toObject === 'function'
    ? document.toObject(false)
    : typeof document?.toJSON === 'function'
      ? document.toJSON()
      : null;
  if (!raw || typeof raw !== 'object') return null;
  return { ...raw, uuid: clean(document.uuid ?? raw.uuid, 500) || undefined };
}

function referencesFrom(value, maximum = 128) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  const found = [];
  const seen = new Set();
  let match;
  UUID_PATTERN.lastIndex = 0;
  while ((match = UUID_PATTERN.exec(text)) && found.length < maximum) {
    const uuid = clean(match[1] || match[2], 500);
    if (!uuid || uuid.startsWith('.') || seen.has(uuid)) continue;
    seen.add(uuid);
    found.push(uuid);
  }
  return found;
}

function documentType(document) {
  return clean(document?.documentName ?? document?.constructor?.metadata?.name ?? document?.constructor?.name, 100);
}

function documentCapability(type) {
  return Boolean(globalThis.CONFIG?.[type]?.documentClass || globalThis.foundry?.documents?.[type]);
}

function liveCompatibilityEvidence({ generatedAt, resolvedTypes = [] } = {}) {
  const coreVersion = clean(globalThis.game?.version ?? globalThis.game?.release?.version, 100) || null;
  const systemId = clean(globalThis.game?.system?.id, 200) || null;
  const systemVersion = clean(globalThis.game?.system?.version, 100) || null;
  const resolved = new Set(resolvedTypes);
  return Object.freeze({
    schema: 'fenix.foundry-live-evidence',
    version: 1,
    generatedAt,
    coreVersion,
    systemId,
    systemVersion,
    capabilities: Object.freeze({
      fromUuid: true,
      journalEntry: documentCapability('JournalEntry') || true,
      journalEntryPage: documentCapability('JournalEntryPage') || true,
      actor: documentCapability('Actor') || resolved.has('Actor'),
      item: documentCapability('Item') || resolved.has('Item'),
      rollTable: documentCapability('RollTable') || resolved.has('RollTable')
    }),
    checks: Object.freeze([
      Object.freeze({ id: 'fromUuid', ok: true, detail: 'fromUuid() disponível no runtime.' }),
      Object.freeze({ id: 'journalResolved', ok: true, detail: 'JournalEntry raiz resolvido por UUID.' }),
      Object.freeze({ id: 'journalSerialized', ok: true, detail: 'JournalEntry serializado sem executar conteúdo HTML.' }),
      Object.freeze({ id: 'entityTraversalBounded', ok: true, detail: 'Crawl limitado por profundidade e quantidade.' })
    ])
  });
}

async function safeResolve(resolveUuid, uuid) {
  try { return await resolveUuid(uuid); }
  catch { return null; }
}

export async function resolveFoundryContentPackage({
  rootUuid,
  maxEntities = 64,
  maxDepth = 2,
  fromUuidImpl = null
} = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error('Somente o Mestre pode sincronizar conteúdo do Foundry.');
  const resolveUuid = fromUuidImpl ?? globalThis.foundry?.utils?.fromUuid ?? globalThis.fromUuid;
  if (typeof resolveUuid !== 'function') throw new Error('fromUuid() não está disponível nesta versão do Foundry.');
  const root = clean(rootUuid, 500);
  if (!root) throw new Error('UUID raiz é obrigatório para sincronização.');

  const rootDocument = await safeResolve(resolveUuid, root);
  if (!rootDocument) throw new Error(`Documento Foundry não encontrado: ${root}`);
  const rootType = documentType(rootDocument);
  const journalDocument = rootType === 'JournalEntryPage' ? rootDocument.parent : rootDocument;
  if (documentType(journalDocument) !== 'JournalEntry') throw new Error('O UUID raiz deve apontar para JournalEntry ou JournalEntryPage.');
  const journal = serializeDocument(journalDocument);
  if (!journal) throw new Error('Não foi possível serializar o JournalEntry raiz.');

  const entityLimit = Math.max(1, Math.min(256, Number(maxEntities) || 64));
  const depthLimit = Math.max(0, Math.min(4, Number(maxDepth) || 2));
  const entities = [];
  const resolvedUuids = [];
  const missingUuids = [];
  const resolvedTypes = [];
  const visited = new Set([clean(journalDocument.uuid, 500)]);
  const queue = referencesFrom(journal).map((uuid) => ({ uuid, depth: 1 }));

  while (queue.length && entities.length < entityLimit) {
    const { uuid, depth } = queue.shift();
    if (!uuid || visited.has(uuid) || depth > depthLimit) continue;
    visited.add(uuid);
    const document = await safeResolve(resolveUuid, uuid);
    if (!document) {
      missingUuids.push(uuid);
      continue;
    }
    resolvedUuids.push(uuid);
    const type = documentType(document);
    resolvedTypes.push(type);
    const serialized = serializeDocument(document);
    if (!serialized) continue;
    if (SUPPORTED_ENTITY_TYPES.has(type)) {
      entities.push(serialized);
      if (depth < depthLimit) {
        for (const nestedUuid of referencesFrom(serialized)) queue.push({ uuid: nestedUuid, depth: depth + 1 });
      }
    }
  }

  const generatedAt = new Date().toISOString();
  return Object.freeze({
    schema: 'fenix.bridge-content-sync',
    version: 3,
    source: Object.freeze({
      adapter: 'foundry',
      worldId: clean(globalThis.game?.world?.id, 200) || null,
      systemId: clean(globalThis.game?.system?.id, 200) || null,
      systemVersion: clean(globalThis.game?.system?.version, 100) || null,
      coreVersion: clean(globalThis.game?.version ?? globalThis.game?.release?.version, 100) || null,
      generatedAt
    }),
    compatibility: liveCompatibilityEvidence({ generatedAt, resolvedTypes }),
    rootUuid: root,
    journal,
    entities: Object.freeze(entities),
    resolution: Object.freeze({
      resolvedUuids: Object.freeze(resolvedUuids),
      missingUuids: Object.freeze(missingUuids),
      resolvedEntityTypes: Object.freeze([...new Set(resolvedTypes)].sort()),
      bounded: true,
      maxEntities: entityLimit,
      maxDepth: depthLimit
    }),
    policy: Object.freeze({
      gmOnly: true,
      sourceUuidIsIdentity: true,
      executableContentAllowed: false,
      recursiveUnboundedCrawlAllowed: false,
      localOverwriteAllowedWithoutReview: false
    })
  });
}

export async function syncFoundryContentToFenix({
  campaignId,
  adventureId,
  rootUuid,
  apiUrl = DEFAULT_API_URL,
  maxEntities = 64,
  maxDepth = 2,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error('Somente o Mestre pode sincronizar conteúdo do Foundry.');
  const campaign = clean(campaignId, 200);
  const adventure = clean(adventureId, 200);
  if (!campaign || !adventure) throw new Error('campaignId e adventureId do Fênix são obrigatórios.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch() não está disponível para sincronização.');
  const envelope = await resolveFoundryContentPackage({ rootUuid, maxEntities, maxDepth });
  const response = await fetchImpl(`${String(apiUrl || DEFAULT_API_URL).replace(/\/+$/, '')}/v1/campaigns/${encodeURIComponent(campaign)}/content/${encodeURIComponent(adventure)}/sync-foundry`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ envelope })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Fênix respondeu HTTP ${response.status}.`);
  return payload;
}

function exposeBridgeApi() {
  if (!globalThis.game?.user?.isGM) return;
  const module = globalThis.game?.modules?.get?.(MODULE_ID);
  if (!module) return;
  module.api = {
    ...(module.api ?? {}),
    resolveContentPackage: resolveFoundryContentPackage,
    syncContent: syncFoundryContentToFenix
  };
  console.log('[Mestre Orc][Content Sync] Bridge v3 disponível em game.modules.get("mestre-orc").api.syncContent().');
}

if (globalThis.Hooks?.once) globalThis.Hooks.once('ready', exposeBridgeApi);
