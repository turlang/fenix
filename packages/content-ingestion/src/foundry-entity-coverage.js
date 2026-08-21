function clean(value, max = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? structuredClone(value) : null;
}

function explicitUuid(entity) {
  return clean(entity?.uuid ?? entity?._stats?.uuid ?? entity?.flags?.core?.sourceId, 600) || null;
}

function entityId(entity) {
  return clean(entity?._id ?? entity?.id, 200) || null;
}

function entityDocumentName(entity) {
  const explicit = clean(entity?.documentName ?? entity?._stats?.documentName, 100);
  if (explicit) return explicit;
  const uuid = explicitUuid(entity);
  const prefix = uuid?.split('.')[0];
  if (['Actor', 'Item', 'RollTable'].includes(prefix)) return prefix;
  if (Array.isArray(entity?.results)) return 'RollTable';
  if (Array.isArray(entity?.items) || ['npc', 'character', 'vehicle'].includes(clean(entity?.type, 100).toLowerCase())) return 'Actor';
  return 'Item';
}

function sourceUuid(entity, parentUuid = null, documentName = null) {
  const explicit = explicitUuid(entity);
  if (explicit) return explicit;
  const id = entityId(entity);
  const type = documentName ?? entityDocumentName(entity);
  if (!id) return null;
  if (parentUuid && type === 'Item') return `${parentUuid}.Item.${id}`;
  return `${type}.${id}`;
}

function indexEntities(packageInput) {
  const index = new Map();
  const add = (entity, parentUuid = null, forcedDocument = null) => {
    if (!entity || typeof entity !== 'object') return;
    const documentName = forcedDocument ?? entityDocumentName(entity);
    const uuid = sourceUuid(entity, parentUuid, documentName);
    if (!uuid) return;
    index.set(uuid, entity);
    if (documentName === 'Actor') {
      for (const item of Array.isArray(entity.items) ? entity.items.slice(0, 500) : []) add(item, uuid, 'Item');
    }
  };
  for (const entity of packageInput?.entities ?? []) add(entity);
  return index;
}

function normalizeRollResults(entity) {
  return Object.freeze((Array.isArray(entity?.results) ? entity.results : []).slice(0, 1000).map((result, index) => Object.freeze({
    id: clean(result?._id ?? result?.id, 200) || `result-${index + 1}`,
    range: Array.isArray(result?.range)
      ? Object.freeze(result.range.slice(0, 2).map(numberOrNull).filter((value) => value != null))
      : null,
    weight: numberOrNull(result?.weight),
    text: clean(result?.text, 2000) || null,
    documentUuid: clean(result?.documentUuid ?? result?.uuid, 600) || null,
    drawn: result?.drawn === true,
    type: numberOrNull(result?.type)
  })));
}

function enrichedFacts(node, entity) {
  const current = { ...(node?.facts ?? {}) };
  const system = entity?.system && typeof entity.system === 'object' ? entity.system : {};
  if (node.kind === 'roll-table') {
    return Object.freeze({
      ...current,
      formula: clean(entity?.formula ?? current.formula, 120) || null,
      replacement: entity?.replacement !== false,
      results: normalizeRollResults(entity)
    });
  }
  if (!['item', 'spell'].includes(node.kind)) return Object.freeze(current);
  const expanded = {
    ...current,
    itemType: clean(entity?.type, 100) || null,
    quantity: numberOrNull(system.quantity ?? current.quantity),
    weight: numberOrNull(system.weight),
    price: cloneObject(system.price),
    activation: cloneObject(system.activation ?? current.activation),
    range: cloneObject(system.range ?? current.range),
    target: cloneObject(system.target),
    duration: cloneObject(system.duration ?? current.duration),
    uses: cloneObject(system.uses),
    damage: cloneObject(system.damage),
    save: cloneObject(system.save),
    properties: Array.isArray(system.properties)
      ? Object.freeze(system.properties.slice(0, 100).map((value) => clean(value, 100)).filter(Boolean))
      : cloneObject(system.properties),
    level: numberOrNull(system.level ?? current.level),
    school: clean(system.school ?? current.school, 100) || null,
    components: cloneObject(system.components),
    materials: cloneObject(system.materials),
    preparation: cloneObject(system.preparation)
  };
  return Object.freeze(Object.fromEntries(Object.entries(expanded).filter(([, value]) => value != null)));
}

export function enrichFoundryEntityGraph(graph, packageInput) {
  if (graph?.schema !== 'fenix.foundry-entity-graph') return graph;
  const entityIndex = indexEntities(packageInput);
  const nodes = graph.nodes.map((node) => {
    const entity = entityIndex.get(node.sourceUuid);
    if (!entity) return node;
    return Object.freeze({ ...node, facts: enrichedFacts(node, entity) });
  });
  const stats = Object.freeze({
    ...graph.stats,
    rollTableResults: nodes.filter((node) => node.kind === 'roll-table').reduce((sum, node) => sum + (node.facts?.results?.length ?? 0), 0),
    enrichedItems: nodes.filter((node) => ['item', 'spell'].includes(node.kind)).length
  });
  return Object.freeze({ ...graph, version: Math.max(2, Number(graph.version) || 1), nodes: Object.freeze(nodes), stats });
}
