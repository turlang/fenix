import crypto from 'node:crypto';

function clean(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function stripHtml(value) {
  return clean(String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'"), 12000);
}

function asPayload(input) {
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    try { return JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input); }
    catch {
      const error = new Error('Pacote JSON do Foundry não pôde ser lido.');
      error.code = 'FENIX_FOUNDRY_PACKAGE_PARSE_FAILED';
      throw error;
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const error = new Error('Pacote Foundry inválido.');
    error.code = 'FENIX_FOUNDRY_PACKAGE_INVALID';
    throw error;
  }
  return input;
}

export function normalizeFoundryPackage(input) {
  const payload = asPayload(input);
  const journal = payload.journal ?? payload.journalEntry ?? payload.adventure ?? (Array.isArray(payload.pages) ? payload : null);
  if (!journal) {
    const error = new Error('Pacote Foundry precisa conter um JournalEntry raiz.');
    error.code = 'FENIX_FOUNDRY_PACKAGE_JOURNAL_REQUIRED';
    throw error;
  }
  const entities = [
    ...(Array.isArray(payload.entities) ? payload.entities : []),
    ...(Array.isArray(payload.actors) ? payload.actors : []),
    ...(Array.isArray(payload.items) ? payload.items : []),
    ...(Array.isArray(payload.rollTables) ? payload.rollTables : []),
    ...(Array.isArray(payload.tables) ? payload.tables : [])
  ];
  return Object.freeze({ journal, entities: Object.freeze(entities), raw: payload });
}

function uuidPrefix(value) {
  return clean(value, 600).split('.')[0] || null;
}

function documentName(entity) {
  const explicit = clean(entity?.documentName ?? entity?._stats?.documentName, 100);
  if (explicit) return explicit;
  const prefix = uuidPrefix(entity?.uuid ?? entity?._stats?.uuid ?? entity?.flags?.core?.sourceId);
  if (['Actor', 'Item', 'RollTable'].includes(prefix)) return prefix;
  if (Array.isArray(entity?.results)) return 'RollTable';
  if (Array.isArray(entity?.items) || ['npc', 'character', 'vehicle'].includes(clean(entity?.type, 100).toLowerCase())) return 'Actor';
  return 'Item';
}

function entityUuid(entity, { parentUuid = null, document = null } = {}) {
  const explicit = clean(entity?.uuid ?? entity?._stats?.uuid ?? entity?.flags?.core?.sourceId, 600);
  if (explicit) return explicit;
  const id = clean(entity?._id ?? entity?.id, 200);
  const type = document ?? documentName(entity);
  if (!id) return null;
  if (parentUuid && type === 'Item') return `${parentUuid}.Item.${id}`;
  return `${type}.${id}`;
}

function normalizeOwnership(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [key, level] of Object.entries(source)) {
    const number = Number(level);
    if (Number.isFinite(number)) normalized[clean(key, 200)] = number;
  }
  return Object.freeze(normalized);
}

function description(entity) {
  const candidates = [
    entity?.system?.description?.value,
    entity?.system?.description,
    entity?.system?.details?.biography?.value,
    entity?.system?.details?.biography,
    entity?.system?.details?.description,
    entity?.description,
    entity?.text?.content,
    entity?.system?.chatFlavor
  ];
  return stripHtml(candidates.find((value) => typeof value === 'string' && value.trim()) ?? '');
}

function compactFacts(entity, docName) {
  const system = entity?.system && typeof entity.system === 'object' ? entity.system : {};
  if (docName === 'Actor') {
    return Object.freeze({
      hp: system.attributes?.hp ? { value: Number(system.attributes.hp.value) || 0, max: Number(system.attributes.hp.max) || 0 } : null,
      ac: Number(system.attributes?.ac?.value ?? system.attributes?.ac) || null,
      movement: system.attributes?.movement && typeof system.attributes.movement === 'object' ? structuredClone(system.attributes.movement) : null,
      cr: system.details?.cr ?? null,
      type: system.details?.type?.value ?? system.details?.type ?? null
    });
  }
  if (docName === 'RollTable') {
    return Object.freeze({ formula: clean(entity?.formula, 100) || null, replacement: entity?.replacement !== false });
  }
  return Object.freeze({
    level: Number.isFinite(Number(system.level)) ? Number(system.level) : null,
    school: clean(system.school, 100) || null,
    activation: system.activation && typeof system.activation === 'object' ? structuredClone(system.activation) : null,
    range: system.range && typeof system.range === 'object' ? structuredClone(system.range) : null,
    duration: system.duration && typeof system.duration === 'object' ? structuredClone(system.duration) : null,
    quantity: Number.isFinite(Number(system.quantity)) ? Number(system.quantity) : null
  });
}

function nodeKind(entity, docName) {
  const subtype = clean(entity?.type, 100).toLowerCase();
  if (docName === 'Actor') return subtype === 'npc' ? 'npc' : subtype === 'vehicle' ? 'actor' : 'actor';
  if (docName === 'RollTable') return 'roll-table';
  if (docName === 'Item' && subtype === 'spell') return 'spell';
  return 'item';
}

function collectRefs(value, { depth = 0, found = new Set(), limit = 200 } = {}) {
  if (found.size >= limit || depth > 5 || value == null) return found;
  if (typeof value === 'string') {
    for (const match of value.matchAll(/@UUID\[([^\]]+)\]/g)) {
      const uuid = clean(match[1], 600);
      if (uuid) found.add(uuid);
      if (found.size >= limit) break;
    }
    return found;
  }
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 100)) collectRefs(entry, { depth: depth + 1, found, limit });
    return found;
  }
  if (typeof value === 'object') {
    const direct = clean(value.uuid ?? value.documentUuid ?? value.sourceUuid, 600);
    if (/^(?:Actor|Item|RollTable|JournalEntry|Compendium)\./.test(direct)) found.add(direct);
    for (const [key, entry] of Object.entries(value).slice(0, 150)) {
      if (['img', 'texture', 'flags'].includes(key) && depth > 2) continue;
      collectRefs(entry, { depth: depth + 1, found, limit });
    }
  }
  return found;
}

function normalizedNode(entity, options = {}) {
  const docName = options.documentName ?? documentName(entity);
  const sourceUuid = entityUuid(entity, { parentUuid: options.parentUuid, document: docName });
  if (!sourceUuid) return null;
  const sourceId = clean(entity?._id ?? entity?.id, 200) || sourceUuid.split('.').at(-1);
  const subtype = clean(entity?.type, 100) || null;
  const name = clean(entity?.name, 500) || `${docName} ${sourceId}`;
  const selectedForHash = {
    sourceUuid,
    documentName: docName,
    subtype,
    name,
    system: entity?.system ?? null,
    results: entity?.results ?? null,
    ownership: entity?.ownership ?? null
  };
  return Object.freeze({
    id: stableId('foundry-entity', sourceUuid),
    sourceUuid,
    sourceId,
    sourceHash: contentHash(selectedForHash),
    documentName: docName,
    kind: nodeKind(entity, docName),
    subtype,
    name,
    visibility: 'gm',
    ownership: normalizeOwnership(entity?.ownership),
    text: description(entity),
    facts: compactFacts(entity, docName),
    references: Object.freeze([...collectRefs(entity)].filter((uuid) => uuid !== sourceUuid)),
    revision: Object.freeze({ state: 'new', previousHash: null })
  });
}

function addEdge(edges, seen, from, to, relation, source = null) {
  if (!from || !to) return;
  const key = `${from}\u241f${to}\u241f${relation}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(Object.freeze({ id: stableId('foundry-edge', key), from, to, relation, source }));
}

function graphWithRevisions(graph, previousGraph = null) {
  if (!previousGraph?.nodes?.length) return graph;
  const previous = new Map(previousGraph.nodes.map((node) => [node.sourceUuid, node]));
  const nodes = graph.nodes.map((node) => {
    const before = previous.get(node.sourceUuid);
    const state = !before ? 'new' : before.sourceHash === node.sourceHash ? 'unchanged' : 'changed';
    return Object.freeze({ ...node, revision: Object.freeze({ state, previousHash: before?.sourceHash ?? null }) });
  });
  const removed = [...previous.values()].filter((node) => !nodes.some((next) => next.sourceUuid === node.sourceUuid)).map((node) => node.sourceUuid);
  return Object.freeze({ ...graph, nodes: Object.freeze(nodes), revision: Object.freeze({ removedSourceUuids: Object.freeze(removed) }) });
}

export function buildFoundryEntityGraph(model, packageInput, { previousGraph = null } = {}) {
  if (model?.schema !== 'fenix.adventure-model') throw new TypeError('Adventure Model inválido.');
  const pkg = normalizeFoundryPackage(packageInput);
  const nodesByUuid = new Map();
  const embeddedRelations = [];

  const addEntity = (entity, options = {}) => {
    const node = normalizedNode(entity, options);
    if (!node) return null;
    const existing = nodesByUuid.get(node.sourceUuid);
    if (!existing || existing.sourceHash !== node.sourceHash) nodesByUuid.set(node.sourceUuid, node);
    if (options.parentUuid) embeddedRelations.push({ parentUuid: options.parentUuid, childUuid: node.sourceUuid });
    if (documentName(entity) === 'Actor') {
      for (const item of Array.isArray(entity?.items) ? entity.items : []) addEntity(item, { parentUuid: node.sourceUuid, documentName: 'Item' });
    }
    return node;
  };

  for (const entity of pkg.entities) addEntity(entity);
  const nodes = [...nodesByUuid.values()].sort((a, b) => a.sourceUuid.localeCompare(b.sourceUuid));
  const byUuid = new Map(nodes.map((node) => [node.sourceUuid, node]));
  const edges = [];
  const edgeSeen = new Set();

  for (const relation of embeddedRelations) {
    const parent = byUuid.get(relation.parentUuid);
    const child = byUuid.get(relation.childUuid);
    addEdge(edges, edgeSeen, parent?.id, child?.id, 'contains');
  }

  for (const node of nodes) {
    for (const uuid of node.references) addEdge(edges, edgeSeen, node.id, byUuid.get(uuid)?.id, 'references', { sourceUuid: node.sourceUuid });
  }

  for (const entity of pkg.entities) {
    if (documentName(entity) !== 'RollTable') continue;
    const table = byUuid.get(entityUuid(entity, { document: 'RollTable' }));
    for (const result of Array.isArray(entity?.results) ? entity.results : []) {
      const uuid = clean(result?.documentUuid ?? result?.uuid, 600);
      if (uuid) addEdge(edges, edgeSeen, table?.id, byUuid.get(uuid)?.id, 'table-result', { resultId: clean(result?._id ?? result?.id, 200) || null });
    }
  }

  const sectionsByPage = new Map();
  for (const section of model.sections ?? []) {
    const pageUuid = clean(section?.source?.pageUuid, 600);
    if (!pageUuid) continue;
    if (!sectionsByPage.has(pageUuid)) sectionsByPage.set(pageUuid, []);
    sectionsByPage.get(pageUuid).push(section);
  }
  for (const ref of model.foundry?.references ?? []) {
    const target = byUuid.get(ref.uuid);
    if (!target) continue;
    for (const section of sectionsByPage.get(ref.pageUuid) ?? []) {
      addEdge(edges, edgeSeen, `section:${section.id}`, target.id, 'mentions', { pageUuid: ref.pageUuid, label: ref.label ?? null });
    }
  }

  const base = Object.freeze({
    schema: 'fenix.foundry-entity-graph',
    version: 1,
    adventureId: model.id,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    policy: Object.freeze({ failClosedForPlayers: true, sourceUuidIsIdentity: true, physicalAuthority: false }),
    stats: Object.freeze({ nodes: nodes.length, edges: edges.length, actors: nodes.filter((n) => ['actor', 'npc'].includes(n.kind)).length, items: nodes.filter((n) => n.kind === 'item').length, spells: nodes.filter((n) => n.kind === 'spell').length, rollTables: nodes.filter((n) => n.kind === 'roll-table').length })
  });
  return graphWithRevisions(base, previousGraph);
}

export function reconcileFoundryEntityGraph(nextGraph, previousGraph = null) {
  return graphWithRevisions(nextGraph, previousGraph);
}

export function retrieveBoundEntityKnowledge(model, { sectionId = null, query = '', visibility = 'gm', revealedEntityUuids = [], limit = 12 } = {}) {
  const graph = model?.entityGraph;
  if (graph?.schema !== 'fenix.foundry-entity-graph') return Object.freeze([]);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const allowedIds = new Set();
  const frontier = [];
  if (sectionId) {
    for (const edge of graph.edges) {
      if (edge.from === `section:${sectionId}` && edge.to) { allowedIds.add(edge.to); frontier.push(edge.to); }
    }
    for (const id of [...frontier]) {
      for (const edge of graph.edges) if (edge.from === id && ['contains', 'references', 'table-result'].includes(edge.relation) && edge.to) allowedIds.add(edge.to);
    }
  } else {
    for (const node of graph.nodes) allowedIds.add(node.id);
  }
  const revealed = new Set(revealedEntityUuids);
  const q = clean(query, 1000).toLowerCase();
  const scored = [];
  for (const id of allowedIds) {
    const node = byId.get(id);
    if (!node) continue;
    const allowed = visibility === 'gm' || node.visibility === 'player' || revealed.has(node.sourceUuid);
    if (!allowed) continue;
    const haystack = `${node.name} ${node.kind} ${node.subtype ?? ''} ${node.text}`.toLowerCase();
    const score = q ? q.split(/\s+/).filter(Boolean).reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) : 1;
    if (q && score === 0) continue;
    scored.push({ node, score });
  }
  scored.sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name));
  return Object.freeze(scored.slice(0, Math.max(1, Number(limit) || 12)).map(({ node, score }) => Object.freeze({
    id: node.id,
    sourceUuid: node.sourceUuid,
    kind: node.kind,
    name: node.name,
    text: node.text,
    facts: node.facts,
    score
  })));
}
