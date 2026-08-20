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

export async function resolveFoundryContentPackage({
  rootUuid,
  maxEntities = 64,
  maxDepth = 2,
  fromUuidImpl = null
} = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error('Somente o Mestre pode sincronizar conteúdo do Foundry.');
  const resolveUuid = fromUuidImpl
    ?? globalThis.foundry?.utils?.fromUuid
    ?? globalThis.fromUuid;
  if (typeof resolveUuid !== 'function') throw new Error('fromUuid() não está disponível nesta versão do Foundry.');
  const root = clean(rootUuid, 500);
  if (!root) throw new Error('UUID raiz é obrigatório para sincronização.');

  const rootDocument = await resolveUuid(root);
  if (!rootDocument) throw new Error(`Documento Foundry não encontrado: ${root}`);
  const rootType = documentType(rootDocument);
  const journalDocument = rootType === 'JournalEntryPage' ? rootDocument.parent : rootDocument;
  if (documentType(journalDocument) !== 'JournalEntry') throw new Error('O UUID raiz deve apontar para JournalEntry ou JournalEntryPage.');
  const journal = serializeDocument(journalDocument);
  if (!journal) throw new Error('Não foi possível serializar o JournalEntry raiz.');

  const entities = [];
  const resolvedUuids = [];
  const missingUuids = [];
  const visited = new Set([clean(journalDocument.uuid, 500)]);
  const queue = referencesFrom(journal).map((uuid) => ({ uuid, depth: 1 }));

  while (queue.length && entities.length < Math.max(1, Math.min(256, Number(maxEntities) || 64))) {
    const { uuid, depth } = queue.shift();
    if (!uuid || visited.has(uuid) || depth > Math.max(0, Math.min(4, Number(maxDepth) || 2))) continue;
    visited.add(uuid);
    const document = await resolveUuid(uuid).catch?.(() => null) ?? await resolveUuid(uuid);
    if (!document) {
      missingUuids.push(uuid);
      continue;
    }
    resolvedUuids.push(uuid);
    const type = documentType(document);
    const serialized = serializeDocument(document);
    if (!serialized) continue;
    if (SUPPORTED_ENTITY_TYPES.has(type)) {
      entities.push(serialized);
      if (depth < maxDepth) {
        for (const nestedUuid of referencesFrom(serialized)) queue.push({ uuid: nestedUuid, depth: depth + 1 });
      }
    }
  }

  return Object.freeze({
    schema: 'fenix.bridge-content-sync',
    version: 2,
    source: Object.freeze({
      adapter: 'foundry',
      worldId: clean(globalThis.game?.world?.id, 200) || null,
      systemId: clean(globalThis.game?.system?.id, 200) || null,
      systemVersion: clean(globalThis.game?.system?.version, 100) || null,
      coreVersion: clean(globalThis.game?.version ?? globalThis.game?.release?.version, 100) || null,
      generatedAt: new Date().toISOString()
    }),
    rootUuid: root,
    journal,
    entities: Object.freeze(entities),
    resolution: Object.freeze({
      resolvedUuids: Object.freeze(resolvedUuids),
      missingUuids: Object.freeze(missingUuids),
      bounded: true,
      maxEntities: Math.max(1, Math.min(256, Number(maxEntities) || 64)),
      maxDepth: Math.max(0, Math.min(4, Number(maxDepth) || 2))
    }),
    policy: Object.freeze({
      gmOnly: true,
      sourceUuidIsIdentity: true,
      executableContentAllowed: false,
      recursiveUnboundedCrawlAllowed: false
    })
  });
}
