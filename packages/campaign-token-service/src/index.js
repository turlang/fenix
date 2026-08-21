import { normalizeTokenRuntime } from '../../token-entity/src/index.js';

function tokenError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function ensureSceneTokens(scene) {
  if (!Array.isArray(scene.tokens)) scene.tokens = [];
  return scene.tokens;
}

function actorFor(campaign, actorId) {
  return (Array.isArray(campaign.actors) ? campaign.actors : [])
    .find((actor) => actor.id === String(actorId)) ?? null;
}

function sceneFor(campaign, sceneId) {
  return (Array.isArray(campaign.scenes) ? campaign.scenes : [])
    .find((scene) => scene.id === String(sceneId)) ?? null;
}

function footprintValue(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function actorFootprint(actor, stored = null) {
  const source = actor?.sheet?.footprint ?? stored?.footprint ?? {};
  return Object.freeze({
    widthCells: footprintValue(source.widthCells, 1),
    heightCells: footprintValue(source.heightCells, 1)
  });
}

function publicToken(stored, actor = null) {
  const token = normalizeTokenRuntime(stored);
  return Object.freeze({
    ...token,
    sceneId: stored.sceneId ?? null,
    size: Number(stored.size) > 0 ? Number(stored.size) : 80,
    height: Number(stored.height) > 0 ? Number(stored.height) : undefined,
    footprint: actorFootprint(actor, stored),
    movementMode: stored.movementMode ?? 'ground',
    createdAt: stored.createdAt ?? null,
    updatedAt: stored.updatedAt ?? null
  });
}

export class CampaignTokenService {
  constructor({ campaignService, repository, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.now = now;
  }

  list({ campaignId, userId, sceneId } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    const scene = sceneFor(campaign, sceneId);
    if (!scene) throw tokenError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const tokens = ensureSceneTokens(scene).map((stored) => publicToken(stored, actorFor(campaign, stored.actorId)));
    if (membership.role === 'gm') return tokens;
    return tokens.filter((token) => {
      if (token.actorId === membership.actorId) return true;
      return token.visible !== false && token.hidden !== true;
    });
  }

  listRuntimeForScene({ campaignId, sceneId } = {}) {
    const campaign = this.campaignService.getRaw(campaignId);
    if (!campaign) throw tokenError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    const scene = sceneFor(campaign, sceneId);
    if (!scene) throw tokenError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    return ensureSceneTokens(scene).map((stored) => publicToken(stored, actorFor(campaign, stored.actorId)));
  }

  async upsert({ campaignId, userId, sceneId, token } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    return this.#persist({ campaign, sceneId, token });
  }

  async persistRuntimeToken({ campaignId, sceneId, token } = {}) {
    const campaign = this.campaignService.getRaw(campaignId);
    if (!campaign) throw tokenError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    return this.#persist({ campaign, sceneId, token });
  }

  async #persist({ campaign, sceneId, token }) {
    const scene = sceneFor(campaign, sceneId);
    if (!scene) throw tokenError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const requested = normalizeTokenRuntime(token ?? {});
    const actor = actorFor(campaign, requested.actorId);
    if (!actor) {
      throw tokenError('Token precisa estar associado a um Ator persistente da campanha.', 'CAMPAIGN_TOKEN_ACTOR_NOT_FOUND', 409);
    }

    const now = new Date(this.now()).toISOString();
    const tokens = ensureSceneTokens(scene);
    const existing = tokens.find((item) => (item.tokenId ?? item.id) === requested.tokenId) ?? null;
    const normalized = normalizeTokenRuntime({
      ...requested,
      actorId: actor.id,
      sheetId: actor.sheetId,
      systemId: actor.systemId,
      name: actor.name,
      image: actor.image ?? requested.image ?? null
    });
    const stored = {
      ...structuredClone(normalized),
      sceneId: scene.id,
      size: Number(token?.size) > 0 ? Number(token.size) : (Number(existing?.size) > 0 ? Number(existing.size) : 80),
      height: Number(token?.height) > 0 ? Number(token.height) : existing?.height,
      footprint: structuredClone(actorFootprint(actor, existing)),
      movementMode: text(token?.movementMode ?? existing?.movementMode, 40) || 'ground',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existing) Object.assign(existing, stored);
    else tokens.push(stored);
    scene.updatedAt = now;
    campaign.updatedAt = now;

    await this.repository.mutate((draft) => {
      const storedCampaign = draft.campaigns.find((item) => item.id === campaign.id);
      if (!storedCampaign) throw tokenError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      const storedScene = sceneFor(storedCampaign, scene.id);
      if (!storedScene) throw tokenError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
      const storedTokens = ensureSceneTokens(storedScene);
      const index = storedTokens.findIndex((item) => (item.tokenId ?? item.id) === normalized.tokenId);
      if (index >= 0) storedTokens[index] = structuredClone(stored);
      else storedTokens.push(structuredClone(stored));
      storedScene.updatedAt = now;
      storedCampaign.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return publicToken(stored, actor);
  }
}
