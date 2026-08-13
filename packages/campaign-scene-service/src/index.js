import { randomUUID } from 'node:crypto';
import { normalizeSceneWalls } from '../../scene-geometry/src/index.js';
import { normalizeSceneLighting } from '../../scene-lighting/src/index.js';
import {
  mergeExploredCells,
  normalizeExploredCells,
  normalizeSceneFog,
  normalizeTokenVisionProfile,
  normalizeTokenVisionProfiles,
  visibleGridCells
} from '../../scene-vision/src/index.js';

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

function coordinate(value, fallback = 0, { min = -20000, max = 20000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 100) / 100));
}

function normalizeGrid(grid = {}) {
  return {
    size: dimension(grid.size, 70, { min: 8, max: 500 }),
    type: 'square',
    offsetX: coordinate(grid.offsetX, 0),
    offsetY: coordinate(grid.offsetY, 0),
    visible: grid.visible !== false
  };
}

function sceneWalls(scene) {
  return normalizeSceneWalls(scene.walls ?? [], {
    sceneWidth: scene.width,
    sceneHeight: scene.height
  });
}

function normalizeExploredByActor(input = {}) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [actorId, cells] of Object.entries(input)) {
    const id = text(actorId, 200);
    if (!id) continue;
    result[id] = [...normalizeExploredCells(cells)];
  }
  return result;
}

function ensureSceneFog(scene) {
  const config = normalizeSceneFog(scene.fog ?? {});
  const exploredByActor = normalizeExploredByActor(scene.fog?.exploredByActor);
  scene.fog = {
    ...config,
    exploredByActor
  };
  return scene.fog;
}

function ensureSceneLighting(scene) {
  scene.lighting = structuredClone(normalizeSceneLighting(scene.lighting ?? {}, {
    sceneWidth: scene.width,
    sceneHeight: scene.height,
    idFactory: randomUUID
  }));
  return scene.lighting;
}

function ensureSceneVisionProfiles(scene) {
  const fog = ensureSceneFog(scene);
  scene.visionProfiles = structuredClone(normalizeTokenVisionProfiles(scene.visionProfiles ?? {}, {
    defaultRangeCells: fog.visionRangeCells
  }));
  return scene.visionProfiles;
}

function publicFog(scene, membership = null) {
  const fog = ensureSceneFog(scene);
  const base = {
    enabled: fog.enabled,
    visionRangeCells: fog.visionRangeCells,
    exploredOpacity: fog.exploredOpacity,
    unexploredOpacity: fog.unexploredOpacity
  };
  if (membership?.role === 'gm') {
    return Object.freeze({
      ...base,
      exploredByActor: Object.freeze(Object.fromEntries(
        Object.entries(fog.exploredByActor).map(([actorId, cells]) => [actorId, Object.freeze([...cells])])
      ))
    });
  }
  const actorId = text(membership?.actorId, 200);
  return Object.freeze({
    ...base,
    exploredCells: Object.freeze([...(fog.exploredByActor[actorId] ?? [])])
  });
}

function publicLighting(scene) {
  const lighting = ensureSceneLighting(scene);
  return Object.freeze({
    enabled: lighting.enabled,
    darkness: lighting.darkness,
    sources: Object.freeze(lighting.sources.map((source) => Object.freeze({ ...source })))
  });
}

function publicVisionProfiles(scene) {
  const profiles = ensureSceneVisionProfiles(scene);
  return Object.freeze(Object.fromEntries(
    Object.entries(profiles).map(([actorId, profile]) => [actorId, Object.freeze({
      ...profile,
      personalLight: Object.freeze({ ...profile.personalLight })
    })])
  ));
}

function publicAsset(asset) {
  return asset ? Object.freeze({ ...asset }) : null;
}

function publicScene(scene, assets = [], membership = null) {
  const asset = assets.find((item) => item.id === scene.backgroundAssetId) ?? null;
  return Object.freeze({
    id: scene.id,
    name: scene.name,
    description: scene.description ?? '',
    width: scene.width,
    height: scene.height,
    grid: Object.freeze(normalizeGrid(scene.grid)),
    walls: sceneWalls(scene),
    fog: publicFog(scene, membership),
    lighting: publicLighting(scene),
    visionProfiles: publicVisionProfiles(scene),
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
  for (const scene of campaign.scenes) {
    scene.grid = normalizeGrid(scene.grid);
    if (!Array.isArray(scene.walls)) scene.walls = [];
    ensureSceneFog(scene);
    ensureSceneLighting(scene);
    ensureSceneVisionProfiles(scene);
  }
  return campaign;
}

export class CampaignSceneService {
  constructor({ campaignService, repository, assetStorage, remoteMapImporter = null, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    if (!assetStorage) throw new TypeError('assetStorage é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.assetStorage = assetStorage;
    this.remoteMapImporter = remoteMapImporter;
    this.now = now;
  }

  list({ campaignId, userId } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    ensureCollections(campaign);
    return {
      activeSceneId: campaign.activeSceneId ?? campaign.scenes[0]?.id ?? null,
      scenes: campaign.scenes.map((scene) => publicScene(scene, campaign.assets, membership)),
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
    return this.#registerAsset(campaign, userId, stored, { sourceType: 'upload' });
  }

  async importMapUrl({ campaignId, userId, url } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    if (!this.remoteMapImporter) {
      throw sceneError('Importação de mapa por URL não está disponível neste Engine.', 'REMOTE_MAP_IMPORT_UNAVAILABLE', 503);
    }
    const imported = await this.remoteMapImporter.importUrl(url);
    const stored = await this.assetStorage.saveImageBuffer({
      campaignId: campaign.id,
      fileName: imported.fileName,
      mimeType: imported.mimeType,
      buffer: imported.buffer
    });
    return this.#registerAsset(campaign, userId, stored, {
      sourceType: 'remote-import',
      sourceHost: imported.sourceHost,
      width: imported.width,
      height: imported.height
    });
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
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
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
      width: dimension(width, asset.width ?? 1600),
      height: dimension(height, asset.height ?? 1000),
      backgroundAssetId: asset.id,
      grid: normalizeGrid({ size: gridSize }),
      walls: [],
      fog: {
        ...normalizeSceneFog({ enabled: false }),
        exploredByActor: {}
      },
      lighting: {
        ...normalizeSceneLighting({ enabled: false, darkness: 0.78, sources: [] })
      },
      visionProfiles: {},
      createdAt: now,
      updatedAt: now
    };
    campaign.scenes.push(scene);
    if (!campaign.activeSceneId) campaign.activeSceneId = scene.id;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: campaign.activeSceneId
    };
  }

  async updateGrid({ campaignId, userId, sceneId, size, offsetX, offsetY, visible } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const previousGrid = normalizeGrid(scene.grid);
    const nextGrid = normalizeGrid({
      ...scene.grid,
      size: size ?? scene.grid?.size,
      offsetX: offsetX ?? scene.grid?.offsetX,
      offsetY: offsetY ?? scene.grid?.offsetY,
      visible: visible ?? scene.grid?.visible
    });
    const gridGeometryChanged = previousGrid.size !== nextGrid.size
      || previousGrid.offsetX !== nextGrid.offsetX
      || previousGrid.offsetY !== nextGrid.offsetY;
    scene.grid = nextGrid;
    if (gridGeometryChanged) ensureSceneFog(scene).exploredByActor = {};
    const now = new Date(this.now()).toISOString();
    scene.updatedAt = now;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: campaign.activeSceneId
    };
  }

  async updateWalls({ campaignId, userId, sceneId, walls } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const normalized = normalizeSceneWalls(walls, {
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      idFactory: randomUUID
    });
    const now = new Date(this.now()).toISOString();
    scene.walls = normalized.map((wall) => structuredClone(wall));
    scene.updatedAt = now;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: campaign.activeSceneId
    };
  }

  async updateFog({
    campaignId,
    userId,
    sceneId,
    enabled,
    visionRangeCells,
    exploredOpacity,
    unexploredOpacity,
    visionProfiles,
    resetExploration = false
  } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const current = ensureSceneFog(scene);
    const config = normalizeSceneFog({
      enabled: enabled ?? current.enabled,
      visionRangeCells: visionRangeCells ?? current.visionRangeCells,
      exploredOpacity: exploredOpacity ?? current.exploredOpacity,
      unexploredOpacity: unexploredOpacity ?? current.unexploredOpacity
    });
    const now = new Date(this.now()).toISOString();
    scene.fog = {
      ...config,
      exploredByActor: resetExploration ? {} : normalizeExploredByActor(current.exploredByActor)
    };
    if (visionProfiles !== undefined) {
      scene.visionProfiles = structuredClone(normalizeTokenVisionProfiles(visionProfiles, {
        defaultRangeCells: config.visionRangeCells
      }));
    } else {
      ensureSceneVisionProfiles(scene);
    }
    scene.updatedAt = now;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: campaign.activeSceneId
    };
  }

  async updateLighting({ campaignId, userId, sceneId, enabled, darkness, sources } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const current = ensureSceneLighting(scene);
    const next = normalizeSceneLighting({
      enabled: enabled ?? current.enabled,
      darkness: darkness ?? current.darkness,
      sources: sources ?? current.sources
    }, {
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      idFactory: randomUUID
    });
    const now = new Date(this.now()).toISOString();
    scene.lighting = structuredClone(next);
    scene.updatedAt = now;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: campaign.activeSceneId
    };
  }

  async recordExploration({ campaignId, userId, sceneId, actorId, x, y } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    const actor = text(actorId, 200);
    if (!actor) throw sceneError('actorId é obrigatório para explorar o fog.', 'CAMPAIGN_FOG_ACTOR_REQUIRED');
    if (membership.role !== 'gm' && membership.actorId !== actor) {
      throw sceneError('Jogador só pode explorar com o próprio personagem.', 'CAMPAIGN_FOG_ACTOR_FORBIDDEN', 403);
    }
    const fog = ensureSceneFog(scene);
    if (!fog.enabled) return { changed: false, discoveredCells: [], totalExploredCells: 0 };

    const visionProfile = normalizeTokenVisionProfile(ensureSceneVisionProfiles(scene)[actor] ?? {}, {
      defaultRangeCells: fog.visionRangeCells
    });
    const discoveredCells = visibleGridCells({
      origin: { x, y },
      walls: sceneWalls(scene),
      grid: scene.grid,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      visionRangeCells: visionProfile.rangeCells
    });
    const previous = fog.exploredByActor[actor] ?? [];
    const merged = mergeExploredCells(previous, discoveredCells);
    if (merged.length === previous.length) {
      return { changed: false, discoveredCells: [...discoveredCells], totalExploredCells: merged.length };
    }

    fog.exploredByActor[actor] = [...merged];
    const now = new Date(this.now()).toISOString();
    scene.updatedAt = now;
    campaign.updatedAt = now;
    await this.#persistCampaign(campaign);
    return {
      changed: true,
      discoveredCells: [...discoveredCells],
      totalExploredCells: merged.length
    };
  }

  async activateScene({ campaignId, userId, sceneId } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId, 'gm');
    ensureCollections(campaign);
    const scene = campaign.scenes.find((item) => item.id === String(sceneId));
    if (!scene) throw sceneError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);
    campaign.activeSceneId = scene.id;
    campaign.updatedAt = new Date(this.now()).toISOString();
    await this.#persistCampaign(campaign);
    return {
      scene: publicScene(scene, campaign.assets, membership),
      activeSceneId: scene.id
    };
  }

  async #registerAsset(campaign, userId, stored, metadata = {}) {
    const now = new Date(this.now()).toISOString();
    const asset = {
      ...stored,
      kind: 'map-background',
      ...metadata,
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

  async #persistCampaign(campaign) {
    await this.repository.mutate((draft) => {
      const index = draft.campaigns.findIndex((item) => item.id === campaign.id);
      if (index < 0) throw sceneError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      draft.campaigns[index] = structuredClone(campaign);
    });
  }
}
