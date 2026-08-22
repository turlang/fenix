const MODULE_ID = 'mestre-orc';
const DEFAULT_API_URL = 'http://localhost:3001';
const SUPPORTED_ENTITY_TYPES = new Set(['Actor', 'Item', 'RollTable']);
const UUID_PATTERN = /(?:@UUID\[([^\]]+)\]|data-(?:entity-)?uuid=["']([^"']+)["'])/gi;
const REQUIRED_LIVE_ENTITY_TYPES = Object.freeze(['Actor', 'Item', 'RollTable']);

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function majorVersion(value) {
  const match = clean(value, 100).match(/^(\d+)/);
  return match ? Number(match[1]) : null;
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

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection.contents)) return [...collection.contents];
  if (typeof collection.values === 'function') return [...collection.values()];
  try { return [...collection]; }
  catch { return []; }
}

function liveCandidatesForType(type) {
  if (type === 'Actor') return collectionValues(globalThis.game?.actors);
  if (type === 'RollTable') return collectionValues(globalThis.game?.tables);
  if (type === 'Item') {
    const worldItems = collectionValues(globalThis.game?.items);
    if (worldItems.length) return worldItems;
    const embedded = [];
    for (const actor of collectionValues(globalThis.game?.actors)) {
      embedded.push(...collectionValues(actor?.items));
    }
    return embedded;
  }
  return [];
}

function liveCompatibilityEvidence({ generatedAt, resolvedTypes = [], journalHasPages = false } = {}) {
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
      journalEntry: true,
      journalEntryPage: documentCapability('JournalEntryPage') || journalHasPages === true,
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

export async function probeFoundryWorldEntities({
  requiredEntityTypes = REQUIRED_LIVE_ENTITY_TYPES,
  fromUuidImpl = null
} = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error('Somente o Mestre pode executar o probe de entidades do Foundry.');
  const resolveUuid = fromUuidImpl ?? globalThis.foundry?.utils?.fromUuid ?? globalThis.fromUuid;
  if (typeof resolveUuid !== 'function') throw new Error('fromUuid() não está disponível nesta versão do Foundry.');

  const types = [...new Set((requiredEntityTypes ?? []).map((value) => clean(value, 100)).filter(Boolean))];
  const evidence = [];

  for (const type of types) {
    const candidates = liveCandidatesForType(type);
    const candidate = candidates.find((document) => documentType(document) === type && clean(document?.uuid, 500))
      ?? candidates.find((document) => clean(document?.uuid, 500))
      ?? null;
    const uuid = clean(candidate?.uuid, 500) || null;
    const resolved = uuid ? await safeResolve(resolveUuid, uuid) : null;
    const resolvedType = resolved ? documentType(resolved) : null;
    evidence.push(Object.freeze({
      type,
      available: Boolean(candidate),
      uuid,
      name: clean(candidate?.name, 200) || null,
      resolved: Boolean(resolved && resolvedType === type),
      resolvedType
    }));
  }

  return Object.freeze(evidence);
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
    compatibility: liveCompatibilityEvidence({ generatedAt, resolvedTypes, journalHasPages: Array.isArray(journal.pages) }),
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

async function postFoundryEnvelope({ campaignId, adventureId, apiUrl, envelope, fetchImpl }) {
  const campaign = clean(campaignId, 200);
  const adventure = clean(adventureId, 200);
  if (!campaign || !adventure) throw new Error('campaignId e adventureId do Fênix são obrigatórios.');
  if (typeof fetchImpl !== 'function') throw new Error('fetch() não está disponível para sincronização.');
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
  const envelope = await resolveFoundryContentPackage({ rootUuid, maxEntities, maxDepth });
  return postFoundryEnvelope({ campaignId, adventureId, apiUrl, envelope, fetchImpl });
}

export function evaluateFoundryLiveValidation(envelope, {
  foundryMajor = 13,
  systemId = 'dnd5e',
  systemMajor = 5,
  requiredEntityTypes = REQUIRED_LIVE_ENTITY_TYPES,
  liveEntityEvidence = []
} = {}) {
  const source = envelope?.source ?? {};
  const compatibility = envelope?.compatibility ?? {};
  const capabilities = compatibility.capabilities ?? {};
  const resolution = envelope?.resolution ?? {};
  const crawlTypes = new Set(Array.isArray(resolution.resolvedEntityTypes) ? resolution.resolvedEntityTypes : []);
  const liveEvidence = Array.isArray(liveEntityEvidence) ? liveEntityEvidence : [];
  const liveTypes = new Set(liveEvidence.filter((entry) => entry?.resolved === true).map((entry) => clean(entry.resolvedType ?? entry.type, 100)).filter(Boolean));
  const observedTypes = new Set([...crawlTypes, ...liveTypes]);
  const missingUuids = Array.isArray(resolution.missingUuids) ? resolution.missingUuids : [];
  const requiredTypes = [...new Set((requiredEntityTypes ?? []).map((value) => clean(value, 100)).filter(Boolean))];
  const missingTypes = requiredTypes.filter((type) => !observedTypes.has(type));
  const expectedSystemId = clean(systemId, 100).toLowerCase();

  const checks = [
    {
      id: 'foundry-version',
      ok: majorVersion(source.coreVersion ?? compatibility.coreVersion) === Number(foundryMajor),
      detail: `Foundry ${source.coreVersion ?? compatibility.coreVersion ?? 'desconhecido'}; alvo major ${foundryMajor}.`
    },
    {
      id: 'system-id',
      ok: clean(source.systemId ?? compatibility.systemId, 100).toLowerCase() === expectedSystemId,
      detail: `Sistema ${source.systemId ?? compatibility.systemId ?? 'desconhecido'}; alvo ${expectedSystemId}.`
    },
    {
      id: 'system-version',
      ok: majorVersion(source.systemVersion ?? compatibility.systemVersion) === Number(systemMajor),
      detail: `Versão do sistema ${source.systemVersion ?? compatibility.systemVersion ?? 'desconhecida'}; alvo major ${systemMajor}.`
    },
    {
      id: 'bridge-capabilities',
      ok: ['fromUuid', 'journalEntry', 'journalEntryPage', 'actor', 'item', 'rollTable'].every((key) => capabilities[key] === true),
      detail: 'Bridge expõe fromUuid, Journal, Actor, Item e RollTable no runtime real.'
    },
    {
      id: 'bounded-resolution',
      ok: resolution.bounded === true,
      detail: 'Crawl do Journal permanece limitado por quantidade e profundidade.'
    },
    {
      id: 'required-entity-types',
      ok: missingTypes.length === 0,
      detail: missingTypes.length
        ? `Tipos ainda não observados no crawl ou probe live: ${missingTypes.join(', ')}.`
        : `Tipos observados no runtime real: ${requiredTypes.join(', ')}.`
    },
    {
      id: 'uuid-resolution',
      ok: missingUuids.length === 0,
      detail: missingUuids.length ? `${missingUuids.length} UUID(s) explícito(s) não resolvido(s).` : 'Todos os UUIDs explícitos percorridos foram resolvidos.'
    }
  ].map((check) => Object.freeze(check));

  return Object.freeze({
    schema: 'fenix.foundry-physical-validation-report',
    version: 1,
    generatedAt: new Date().toISOString(),
    target: Object.freeze({ foundryMajor, systemId: expectedSystemId, systemMajor }),
    runtime: Object.freeze({
      coreVersion: source.coreVersion ?? compatibility.coreVersion ?? null,
      systemId: source.systemId ?? compatibility.systemId ?? null,
      systemVersion: source.systemVersion ?? compatibility.systemVersion ?? null,
      worldId: source.worldId ?? null
    }),
    bridge: Object.freeze({
      rootUuid: envelope?.rootUuid ?? null,
      resolvedEntityTypes: Object.freeze([...crawlTypes].sort()),
      observedEntityTypes: Object.freeze([...observedTypes].sort()),
      liveEntityEvidence: Object.freeze(liveEvidence.map((entry) => Object.freeze({ ...entry }))),
      resolvedCount: Array.isArray(resolution.resolvedUuids) ? resolution.resolvedUuids.length : 0,
      missingUuids: Object.freeze([...missingUuids]),
      bounded: resolution.bounded === true,
      maxEntities: resolution.maxEntities ?? null,
      maxDepth: resolution.maxDepth ?? null
    }),
    automatedChecks: Object.freeze(checks),
    automatedPassed: checks.every((check) => check.ok),
    sync: Object.freeze({ attempted: false, ok: null, detail: 'Sync Fênix não solicitado neste relatório.' }),
    manualChecks: Object.freeze([
      'Revisar no Fênix uma alteração ou conflito vindo do Foundry.',
      'Promover pelo menos uma entidade importada para entidade nativa.',
      'Editar a entidade nativa e depois alterar novamente a fonte para provar conflito fail-closed.',
      'Remover a entidade na fonte e confirmar que o conteúdo nativo é preservado.'
    ]),
    physicalValidationConfirmed: false
  });
}

export async function runFoundryLiveValidation({
  rootUuid,
  campaignId = null,
  adventureId = null,
  apiUrl = DEFAULT_API_URL,
  maxEntities = 64,
  maxDepth = 2,
  foundryMajor = 13,
  systemId = 'dnd5e',
  systemMajor = 5,
  requiredEntityTypes = REQUIRED_LIVE_ENTITY_TYPES,
  fetchImpl = globalThis.fetch
} = {}) {
  if (!globalThis.game?.user?.isGM) throw new Error('Somente o Mestre pode executar a validação física do Bridge.');
  const envelope = await resolveFoundryContentPackage({ rootUuid, maxEntities, maxDepth });
  const liveEntityEvidence = await probeFoundryWorldEntities({ requiredEntityTypes });
  const baseReport = evaluateFoundryLiveValidation(envelope, {
    foundryMajor,
    systemId,
    systemMajor,
    requiredEntityTypes,
    liveEntityEvidence
  });
  const shouldSync = Boolean(clean(campaignId, 200) && clean(adventureId, 200));
  let sync = baseReport.sync;

  if (shouldSync) {
    try {
      const result = await postFoundryEnvelope({ campaignId, adventureId, apiUrl, envelope, fetchImpl });
      sync = Object.freeze({
        attempted: true,
        ok: true,
        detail: 'Envelope Bridge v3 aceito pelo Fênix.',
        result
      });
    } catch (error) {
      sync = Object.freeze({
        attempted: true,
        ok: false,
        detail: clean(error?.message ?? error, 1000) || 'Falha desconhecida ao sincronizar com o Fênix.'
      });
    }
  }

  const report = Object.freeze({ ...baseReport, sync });
  console.group('[Mestre Orc][Content Sync] Validação física v1.7');
  console.table(report.automatedChecks.map(({ id, ok, detail }) => ({ check: id, ok, detail })));
  console.table(report.bridge.liveEntityEvidence.map(({ type, available, uuid, name, resolved, resolvedType }) => ({ type, available, resolved, resolvedType, name, uuid })));
  console.log('Relatório completo:', report);
  console.log('Validação física concluída?', report.physicalValidationConfirmed, '— os passos manuais ainda precisam ser confirmados pelo Mestre.');
  console.groupEnd();
  return report;
}

function exposeBridgeApi() {
  if (!globalThis.game?.user?.isGM) return;
  const module = globalThis.game?.modules?.get?.(MODULE_ID);
  if (!module) return;
  module.api = {
    ...(module.api ?? {}),
    resolveContentPackage: resolveFoundryContentPackage,
    syncContent: syncFoundryContentToFenix,
    probeWorldEntities: probeFoundryWorldEntities,
    runLiveValidation: runFoundryLiveValidation
  };
  console.log('[Mestre Orc][Content Sync] Bridge v3 disponível: resolveContentPackage(), syncContent(), probeWorldEntities() e runLiveValidation().');
}

if (globalThis.Hooks?.once) globalThis.Hooks.once('ready', exposeBridgeApi);
