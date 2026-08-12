import { randomUUID } from 'node:crypto';

function sceneError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function dimension(value, fallback, { min = 64, max = 20000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function publicAsset(asset) {
  return asset ? Object.freeze({ ...asset }) : null;
}

function publicScene(scene, assets = []) {
  const asset = assets.find((item) => item.id === scene.backgroundAssetId) ?? null;
  return Object.freeze({
    id: scene.id,
    name: scene.name,
    description: scene.description ?? '',
    width: scene.width,
    height: scene.height,
    grid: structuredClone(scene.grid),
    backgroundAssetId: scene.backgroundAssetId ?? null,
    backgroundAsset: publicAsset(asset),
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt
  });
}

function ensureCollections(campaign) {
  if (!Array.isArray(campaign.assets)) campaign.assets = [];
  if (!Array.isArray(campaign.scenes)) campaign.scenes = [];
  if (campaign.activeSceneId === undefined) campaign.activeSceneId = null;
  return campaign;
}

export class CampaignSceneService {
  constructor({ campaignService, repository, assetStorage, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    if (!assetStorage) throw new TypeError('assetStorage é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.assetStorage = assetStorage;
    this.now = now;
  }

  list({ campaignId, userId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId);
    ensureCollections(campaign);
    return {
      activeSceneId: campaign.activeSceneId ?? campaign.scenes[0]?.id ?? null,
      scenes: campaign.scenes.map((scene) => publicScene(scene, campaign.assets)),
      assets: campaign.assets.map(publicAsset)
    };
  }

  async uploadMap({ campaignId, userId, fileName, mimeType, dataBase64 } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const stored = await this.assetStorage.saveImage({
      campaignId: campaign.id,
      fileName,
      mimeType,
      dataBase64
    });
    const now = new Date(this.now()).toISOString();
    const asset = {
      ...stored,
      kind: 'map-background',
      createdAt: now,
      createdByUserId: String(userId)
    };
    try {
      campaign.assets.push(asset);
      campaign.updatedAt = now;
      await this.#persistCampaign(campaign);
      return publicAsset(asset);
    } catch (error) {
      campaign.assets = campaign.assets.filter((item) => item.id !== asset.id);
      await this.assetStorage.delete({ campaignId: campaign.id, assetId: asset.id }).catch(() => undefined);
      throw error;
    }
  }

  async readAsset({ campaignId, userId, assetId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId);
    ensureCollections(campaign);
    const asset = campaign.assets.find((item) => item.id === String(assetId));
    if (!asset) throw sceneError('Asset não encontrado nesta campanha.', 'CAMPAIGN_ASSET_NOT_FOUND', 404);
    const buffer = await this.assetStorage.read({ campaignId: campaign.id, assetId: asset.id });
    return { asset: publicAsset(asset), buffer };
  }

  async createScene({ campaignId, userId, name, description = '', assetId, width, height, gridSize = 70 } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const asset = campaign.assets.find((item) => item.id === String(assetId));
    if (!asset) throw sceneError('Envie um mapa válido antes de criar a cena.', 'CAMPAIGN_SCENE_ASSET_REQUIRED', 400);
    const sceneName = text(name, 160);
    if (sceneName.length < 2) throw sceneError('Nome da cena é obrigatório.', 'CAMPAIGN_SCENE_NAME_REQUIRED');
    const now = new Date(this.now()).toISOString();
    const scene = {
      id: randomUUID(),
      name: sceneName,
      description: text(description, 4000),
      width: dimension(width, 1600),
      height: dimension(height, 1000),
      backgroundAssetId: asset.id,
      grid: {
        size: dimension(gridSize, 70, { min: 8, max: 500 }),
        type: 'square'
      },
      createdAt: now,
      updatedAt: now
    };
    campaign.scenes.push(scene);
    if (!campaign.activeSceneId) campaign.activeSceneId = scene.id;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets),
      activeSceneId: campaign.activeSceneId
    };
  }

  async activateScene({ campaignId, userId, sceneId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    campaign.activeSceneId = scene.id;
    campaign.updatedAt = new Date(this.now()).toISOString();
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets),
      activeSceneId: scene.id
    };
  }

  async #persistCampaign(campaign) {
    await this.repository.mutate((draft) => {
      const index = draft.campaigns.findIndex((item) => item.id === campaign.id);
      if (index < 0) throw sceneError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      draft.campaigns[index] = structuredClone(campaign);
    });
  }
}
