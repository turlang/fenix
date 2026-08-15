import { normalizeSceneWalls } from '../../scene-geometry/src/index.js';
import {
  mergeExploredCells,
  normalizeExploredCells,
  normalizeSceneFog,
  visibleGridCells
} from '../../scene-vision/src/index.js';

function explorationError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function normalizeExploredByActor(input = {}) {
  const result = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  for (const [rawActorId, cells] of Object.entries(input)) {
    const actorId = text(rawActorId, 200);
    if (!actorId) continue;
    result[actorId] = [...normalizeExploredCells(cells)];
  }
  return result;
}

export class CampaignExplorationService {
  constructor({ campaignService, actorService, repository, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!actorService) throw new TypeError('actorService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.campaignService = campaignService;
    this.actorService = actorService;
    this.repository = repository;
    this.now = now;
  }

  async recordExploration({ campaignId, userId, sceneId, actorId, x, y, elevation = 0 } = {}) {
    const { membership } = this.campaignService.requireRole(campaignId, userId);
    const normalizedActorId = text(actorId, 200);
    if (!normalizedActorId) {
      throw explorationError('actorId é obrigatório para explorar o fog.', 'CAMPAIGN_FOG_ACTOR_REQUIRED');
    }
    if (membership.role !== 'gm' && membership.actorId !== normalizedActorId) {
      throw explorationError('Jogador só pode explorar com o próprio personagem.', 'CAMPAIGN_FOG_ACTOR_FORBIDDEN', 403);
    }

    let resolvedActor = null;
    try {
      resolvedActor = this.actorService.get({
        campaignId,
        userId,
        actorId: normalizedActorId
      });
    } catch (error) {
      if (error?.code !== 'CAMPAIGN_ACTOR_NOT_FOUND') throw error;
    }
    const visionProfile = resolvedActor?.resolved?.vision ?? null;

    const result = await this.repository.mutate((draft) => {
      const campaign = draft.campaigns.find((item) => item.id === String(campaignId));
      if (!campaign) throw explorationError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      const scene = (campaign.scenes ?? []).find((item) => item.id === String(sceneId));
      if (!scene) throw explorationError('Cena não encontrada.', 'CAMPAIGN_SCENE_NOT_FOUND', 404);

      const fogConfig = normalizeSceneFog(scene.fog ?? {});
      const exploredByActor = normalizeExploredByActor(scene.fog?.exploredByActor);
      if (!fogConfig.enabled) {
        return { changed: false, discoveredCells: [], totalExploredCells: exploredByActor[normalizedActorId]?.length ?? 0 };
      }

      const discoveredCells = visibleGridCells({
        origin: { x, y },
        walls: normalizeSceneWalls(scene.walls ?? [], {
          sceneWidth: scene.width,
          sceneHeight: scene.height
        }),
        grid: scene.grid ?? {},
        sceneWidth: scene.width,
        sceneHeight: scene.height,
        visionProfile,
        sceneScale: scene.scale ?? null,
        visionRangeCells: fogConfig.visionRangeCells,
        originElevation: elevation,
        elevationEnabled: scene.elevation?.enabled === true
      });

      const previous = exploredByActor[normalizedActorId] ?? [];
      const merged = mergeExploredCells(previous, discoveredCells);
      const changed = merged.length !== previous.length;
      exploredByActor[normalizedActorId] = [...merged];
      scene.fog = { ...fogConfig, exploredByActor };
      if (changed) {
        const now = new Date(this.now()).toISOString();
        scene.updatedAt = now;
        campaign.updatedAt = now;
      }
      return {
        changed,
        discoveredCells: [...discoveredCells],
        totalExploredCells: merged.length,
        visionSource: visionProfile ? 'actor-sheet' : 'legacy-fog'
      };
    });

    this.campaignService.refreshFromRepository();
    return result;
  }

  record(input = {}) {
    return this.recordExploration(input);
  }
}
