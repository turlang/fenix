function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value, fallback = null) {
  if (value == null) return fallback;
  return structuredClone(value);
}

function sourceSystem(node, explicit = null) {
  return clean(explicit ?? node?.sourceSystemId ?? node?.metadata?.systemId, 120) || 'unknown';
}

function mappingEvidence({ mapperId, targetSystemId, sourceSystemId, warnings = [], mappedFields = [], unmappedFields = [] } = {}) {
  return Object.freeze({
    schema: 'fenix.system-native-mapping',
    version: 1,
    mapperId: clean(mapperId, 120) || 'generic',
    targetSystemId: clean(targetSystemId, 120) || 'generic',
    sourceSystemId: clean(sourceSystemId, 120) || 'unknown',
    warnings: Object.freeze(warnings.map((item) => clean(item, 300)).filter(Boolean)),
    mappedFields: Object.freeze(mappedFields.map((item) => clean(item, 120)).filter(Boolean)),
    unmappedFields: Object.freeze(unmappedFields.map((item) => clean(item, 120)).filter(Boolean))
  });
}

function movementFromFacts(facts = {}, unit = 'ft') {
  const source = facts.movement && typeof facts.movement === 'object' ? facts.movement : {};
  const speeds = {};
  for (const mode of ['walk', 'fly', 'swim', 'climb', 'burrow']) {
    const value = numeric(source[mode]);
    if (value != null && value >= 0) speeds[mode] = value;
  }
  return Object.keys(speeds).length
    ? Object.freeze({ unit, speeds: Object.freeze(speeds), defaultMode: speeds.walk != null ? 'walk' : Object.keys(speeds)[0] })
    : Object.freeze({});
}

function visionFromFacts(facts = {}, unit = 'ft') {
  const raw = facts.senses && typeof facts.senses === 'object' ? facts.senses : {};
  const aliases = {
    normal: ['normal', 'sight'],
    darkvision: ['darkvision'],
    blindsight: ['blindsight'],
    tremorsense: ['tremorsense'],
    'low-light': ['lowLight', 'low-light']
  };
  const senses = {};
  for (const [target, keys] of Object.entries(aliases)) {
    for (const key of keys) {
      const value = numeric(raw[key]);
      if (value != null && value >= 0) {
        senses[target] = value;
        break;
      }
    }
  }
  return Object.keys(senses).length ? Object.freeze({ unit, senses: Object.freeze(senses) }) : Object.freeze({});
}

function normalizeRollTableData(facts = {}) {
  return Object.freeze({
    formula: clean(facts.formula, 120) || null,
    replacement: facts.replacement !== false,
    results: Object.freeze((Array.isArray(facts.results) ? facts.results : []).slice(0, 1000).map((entry) => Object.freeze({ ...clone(entry, {}) })))
  });
}

export function createSystemNativeMappingAdapter({ id, targetSystemId = 'generic', sourceSystems = ['*'], mapActor, mapItem, mapRollTable = null } = {}) {
  const mapperId = clean(id, 120);
  if (!mapperId) throw new TypeError('id do mapper é obrigatório.');
  if (typeof mapActor !== 'function' || typeof mapItem !== 'function') throw new TypeError('mapActor e mapItem são obrigatórios.');
  const acceptedSources = new Set((sourceSystems ?? ['*']).map((item) => clean(item, 120)).filter(Boolean));
  return Object.freeze({
    id: mapperId,
    targetSystemId: clean(targetSystemId, 120) || 'generic',
    supports(sourceSystemId = 'unknown') {
      return acceptedSources.has('*') || acceptedSources.has(clean(sourceSystemId, 120));
    },
    mapActor(input) { return mapActor(input); },
    mapItem(input) { return mapItem(input); },
    mapRollTable: typeof mapRollTable === 'function' ? (input) => mapRollTable(input) : null
  });
}

export const genericSystemNativeMapper = createSystemNativeMappingAdapter({
  id: 'fenix-generic-import-v1',
  targetSystemId: 'generic',
  sourceSystems: ['*'],
  mapActor({ node, targetSystemId = 'generic', sourceSystemId = 'unknown', actorType = 'npc' } = {}) {
    const facts = clone(node?.facts, {}) ?? {};
    const attributes = {};
    for (const key of ['hp', 'ac', 'cr', 'type']) {
      if (facts[key] != null) attributes[key === 'type' ? 'creatureType' : key] = clone(facts[key]);
    }
    return Object.freeze({
      kind: clean(actorType, 60) || 'npc',
      sheet: Object.freeze({
        movement: movementFromFacts(facts, 'ft'),
        vision: visionFromFacts(facts, 'ft'),
        attributes: Object.freeze(attributes)
      }),
      mapping: mappingEvidence({
        mapperId: 'fenix-generic-import-v1', targetSystemId, sourceSystemId,
        warnings: ['Mapeamento genérico: regras específicas do sistema não foram inferidas.'],
        mappedFields: Object.keys(attributes).map((key) => `attributes.${key}`)
      })
    });
  },
  mapItem({ node, targetSystemId = 'generic', sourceSystemId = 'unknown' } = {}) {
    return Object.freeze({
      kind: clean(node?.kind, 60) || 'item',
      data: Object.freeze({ text: clean(node?.text, 6000), facts: Object.freeze({ ...(clone(node?.facts, {}) ?? {}) }), sourceSubtype: node?.subtype ?? null }),
      mapping: mappingEvidence({
        mapperId: 'fenix-generic-import-v1', targetSystemId, sourceSystemId,
        warnings: ['Mapeamento genérico: o conteúdo foi preservado sem inventar regras específicas.'],
        mappedFields: ['text', 'facts']
      })
    });
  },
  mapRollTable({ node, targetSystemId = 'generic', sourceSystemId = 'unknown' } = {}) {
    const data = normalizeRollTableData(node?.facts ?? {});
    return Object.freeze({
      data,
      mapping: mappingEvidence({
        mapperId: 'fenix-generic-import-v1', targetSystemId, sourceSystemId,
        warnings: ['RollTable preservada como dados; interpretação de resultados continua fora do importador.'],
        mappedFields: ['formula', 'replacement', 'results']
      })
    });
  }
});

export const dnd5eSystemNativeMapper = createSystemNativeMappingAdapter({
  id: 'fenix-dnd5e-import-v1',
  targetSystemId: 'dnd5e',
  sourceSystems: ['dnd5e', 'unknown'],
  mapActor({ node, targetSystemId = 'dnd5e', sourceSystemId = 'dnd5e', actorType = 'npc' } = {}) {
    const facts = clone(node?.facts, {}) ?? {};
    const attributes = {};
    const mappedFields = [];
    if (facts.hp != null) { attributes.hp = clone(facts.hp); mappedFields.push('attributes.hp'); }
    if (facts.ac != null) { attributes.ac = clone(facts.ac); mappedFields.push('attributes.ac'); }
    if (facts.cr != null) { attributes.cr = clone(facts.cr); mappedFields.push('attributes.cr'); }
    if (facts.type != null) { attributes.creatureType = clone(facts.type); mappedFields.push('attributes.creatureType'); }
    const movement = movementFromFacts(facts, 'ft');
    const vision = visionFromFacts(facts, 'ft');
    if (Object.keys(movement).length) mappedFields.push('movement');
    if (Object.keys(vision).length) mappedFields.push('vision');
    return Object.freeze({
      kind: clean(actorType, 60) || 'npc',
      sheet: Object.freeze({ movement, vision, attributes: Object.freeze(attributes) }),
      mapping: mappingEvidence({ mapperId: 'fenix-dnd5e-import-v1', targetSystemId, sourceSystemId, mappedFields })
    });
  },
  mapItem({ node, targetSystemId = 'dnd5e', sourceSystemId = 'dnd5e' } = {}) {
    const facts = clone(node?.facts, {}) ?? {};
    const data = {
      text: clean(node?.text, 6000),
      facts: Object.freeze({ ...facts }),
      sourceSubtype: node?.subtype ?? null
    };
    const mappedFields = ['text', 'facts'];
    for (const key of ['level', 'school', 'activation', 'range', 'target', 'duration', 'uses', 'damage', 'save', 'components', 'materials', 'preparation', 'quantity', 'weight', 'price', 'itemType']) {
      if (facts[key] == null) continue;
      data[key] = clone(facts[key]);
      mappedFields.push(key);
    }
    return Object.freeze({
      kind: clean(node?.kind, 60) || 'item',
      data: Object.freeze(data),
      mapping: mappingEvidence({ mapperId: 'fenix-dnd5e-import-v1', targetSystemId, sourceSystemId, mappedFields })
    });
  },
  mapRollTable({ node, targetSystemId = 'dnd5e', sourceSystemId = 'dnd5e' } = {}) {
    const data = normalizeRollTableData(node?.facts ?? {});
    return Object.freeze({
      data,
      mapping: mappingEvidence({
        mapperId: 'fenix-dnd5e-import-v1', targetSystemId, sourceSystemId,
        mappedFields: ['formula', 'replacement', 'results'],
        warnings: ['A tabela é importada como conteúdo nativo; rolagem e regras de resultado permanecem no sistema/runtime.']
      })
    });
  }
});

export function createSystemNativeMappingRegistry(adapters = [dnd5eSystemNativeMapper], { fallback = genericSystemNativeMapper } = {}) {
  const list = [...adapters];
  return Object.freeze({
    resolve({ targetSystemId = 'generic', sourceSystemId = 'unknown' } = {}) {
      const target = clean(targetSystemId, 120) || 'generic';
      const source = clean(sourceSystemId, 120) || 'unknown';
      return list.find((adapter) => adapter.targetSystemId === target && adapter.supports(source)) ?? fallback;
    },
    mapActor({ node, targetSystemId = 'generic', sourceSystemId = null, actorType = 'npc' } = {}) {
      const source = sourceSystem(node, sourceSystemId);
      const mapper = this.resolve({ targetSystemId, sourceSystemId: source });
      return mapper.mapActor({ node, targetSystemId, sourceSystemId: source, actorType });
    },
    mapItem({ node, targetSystemId = 'generic', sourceSystemId = null } = {}) {
      const source = sourceSystem(node, sourceSystemId);
      const mapper = this.resolve({ targetSystemId, sourceSystemId: source });
      return mapper.mapItem({ node, targetSystemId, sourceSystemId: source });
    },
    mapRollTable({ node, targetSystemId = 'generic', sourceSystemId = null } = {}) {
      const source = sourceSystem(node, sourceSystemId);
      const mapper = this.resolve({ targetSystemId, sourceSystemId: source });
      const handler = mapper.mapRollTable ?? fallback.mapRollTable;
      if (typeof handler !== 'function') throw new TypeError('Mapper não oferece suporte a RollTable.');
      return handler({ node, targetSystemId, sourceSystemId: source });
    }
  });
}

export const defaultSystemNativeMappingRegistry = createSystemNativeMappingRegistry();
