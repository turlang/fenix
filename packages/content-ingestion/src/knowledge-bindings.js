import { buildMestreKnowledgeContext } from './index.js';
import { retrieveBoundEntityKnowledge } from './foundry-entity-graph.js';

function clean(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function resolveAcceptedSceneBinding(model, { sceneId, regionId = null } = {}) {
  const scene = clean(sceneId, 200);
  const region = clean(regionId, 200) || null;
  if (!scene) return null;
  const bindings = (model?.bindings?.sceneRegions ?? []).filter((binding) => binding?.reviewed && String(binding.sceneId) === scene);
  if (!bindings.length) return null;
  const exact = region ? bindings.find((binding) => String(binding.regionId ?? '') === region) : null;
  const sceneWide = bindings.find((binding) => !binding.regionId) ?? null;
  return exact ?? sceneWide;
}

function entityText(entity) {
  const facts = Object.entries(entity.facts ?? {}).filter(([, value]) => value != null).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ');
  return [entity.name, entity.kind, entity.text, facts].filter(Boolean).join(' — ');
}

export function buildBoundAdventureKnowledgeContext(model, {
  sceneId,
  regionId = null,
  query = '',
  visibility = 'gm',
  language = null,
  revealedSecretIds = [],
  revealedEntityUuids = [],
  chunkLimit = 8,
  entityLimit = 12
} = {}) {
  const binding = resolveAcceptedSceneBinding(model, { sceneId, regionId });
  if (!binding) return null;
  const selectedLanguage = language ?? model.language?.target ?? model.language?.source ?? 'und';
  const base = buildMestreKnowledgeContext(model, {
    sectionId: binding.sectionId,
    query,
    visibility,
    language: selectedLanguage,
    revealedSecretIds,
    limit: chunkLimit
  });
  const entities = retrieveBoundEntityKnowledge(model, {
    sectionId: binding.sectionId,
    query,
    visibility,
    revealedEntityUuids,
    limit: entityLimit
  });
  const entityBlock = entities.map((entity) => `[Entidade · ${entity.sourceUuid}] ${entityText(entity)}`).join('\n\n');
  return Object.freeze({
    ...base,
    version: 2,
    binding: Object.freeze({
      id: binding.id,
      sectionId: binding.sectionId,
      sectionTitle: binding.sectionTitle,
      sceneId: binding.sceneId,
      regionId: binding.regionId ?? null,
      reviewed: true
    }),
    entities,
    text: [base.text, entityBlock].filter(Boolean).join('\n\n')
  });
}

export class CampaignAdventureKnowledgeResolver {
  constructor({ store, logger = console } = {}) {
    if (!store) throw new TypeError('store semântico é obrigatório.');
    this.store = store;
    this.logger = logger;
  }

  async #findBound(campaignId, sceneId, regionId = null) {
    const summaries = await this.store.listModels(campaignId);
    const candidates = [];
    for (const summary of summaries) {
      const model = await this.store.getModel(campaignId, summary.id);
      const binding = resolveAcceptedSceneBinding(model, { sceneId, regionId });
      if (!binding) continue;
      candidates.push({ model, binding, exactRegion: Boolean(regionId && binding.regionId === regionId) });
    }
    candidates.sort((a, b) => Number(b.exactRegion) - Number(a.exactRegion) || Number(b.binding.confidence ?? 0) - Number(a.binding.confidence ?? 0));
    return candidates[0] ?? null;
  }

  async resolveRoomEntry({ campaignId, sceneId, regionId = null, language = 'pt-BR', revealedSecretIds = [], revealedEntityUuids = [] } = {}) {
    if (!campaignId || !sceneId) return null;
    const found = await this.#findBound(campaignId, sceneId, regionId);
    if (!found) return null;
    // Room entry must load the whole reviewed Area. Query filtering here could hide an NPC
    // merely because the room name does not occur in the NPC description.
    const player = buildBoundAdventureKnowledgeContext(found.model, {
      sceneId, regionId, query: '', visibility: 'player', language, revealedSecretIds, revealedEntityUuids
    });
    const gm = buildBoundAdventureKnowledgeContext(found.model, {
      sceneId, regionId, query: '', visibility: 'gm', language, revealedSecretIds, revealedEntityUuids
    });
    const readAloud = player?.chunks?.find((chunk) => chunk.type === 'read-aloud' && clean(chunk.text, 5000));
    return Object.freeze({
      adventureId: found.model.id,
      binding: gm?.binding ?? player?.binding ?? null,
      playerContext: player,
      gmContext: gm,
      source: readAloud ? Object.freeze({
        canonicalAnchor: true,
        text: clean(readAloud.text, 5000),
        type: 'ADVENTURE_KNOWLEDGE',
        extractionMode: 'BOUND_SEMANTIC_ADVENTURE_READ_ALOUD'
      }) : null
    });
  }

  async resolveAction({ campaignId, sceneId, regionId = null, query = '', language = 'pt-BR', revealedSecretIds = [], revealedEntityUuids = [] } = {}) {
    if (!campaignId || !sceneId) return null;
    const found = await this.#findBound(campaignId, sceneId, regionId);
    if (!found) return null;
    return buildBoundAdventureKnowledgeContext(found.model, {
      sceneId,
      regionId,
      query,
      visibility: 'gm',
      language,
      revealedSecretIds,
      revealedEntityUuids
    });
  }
}
