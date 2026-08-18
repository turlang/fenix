import { convertDistance, normalizeSceneScale } from '../../scene-scale/src/index.js';
import { effectiveVisionRange } from '../../rpg-rules-contract/src/index.js';

function bootstrapError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clone(value, fallback) {
  if (value == null) return structuredClone(fallback);
  return structuredClone(value);
}

function viewerExploration(scene, actorId) {
  const fog = scene?.fog ?? {};
  if (Array.isArray(fog.exploredCells)) return [...fog.exploredCells];
  const byActor = fog.exploredByActor && typeof fog.exploredByActor === 'object'
    ? fog.exploredByActor
    : {};
  return Array.isArray(byActor[actorId]) ? [...byActor[actorId]] : [];
}

function publicToken(token) {
  return Object.freeze({
    tokenId: text(token?.tokenId ?? token?.id),
    actorId: text(token?.actorId) || null,
    sheetId: text(token?.sheetId) || null,
    systemId: text(token?.systemId, 120) || null,
    kind: text(token?.kind, 60) || 'character',
    name: text(token?.name, 200) || text(token?.tokenId ?? token?.id),
    image: text(token?.image, 2000) || null,
    x: finite(token?.x),
    y: finite(token?.y),
    elevation: finite(token?.elevation),
    rotation: finite(token?.rotation),
    size: Math.max(1, finite(token?.size, 80)),
    height: Math.max(0.1, finite(token?.height, 1.8)),
    visible: token?.visible !== false,
    hidden: token?.hidden === true,
    movementMode: text(token?.movementMode, 40) || 'ground'
  });
}

export function createRenderWorldBootstrap({
  campaign,
  scene,
  actor,
  viewerToken,
  visibleTokens = [],
  createdAt = new Date().toISOString()
} = {}) {
  const campaignId = text(campaign?.id);
  const sceneId = text(scene?.id);
  const actorId = text(actor?.id ?? actor?.actorId);
  const tokenId = text(viewerToken?.tokenId ?? viewerToken?.id);
  if (!campaignId) throw bootstrapError('campaign é obrigatório.', 'FENIX_BOOTSTRAP_CAMPAIGN_REQUIRED');
  if (!sceneId) throw bootstrapError('scene é obrigatória.', 'FENIX_BOOTSTRAP_SCENE_REQUIRED');
  if (!actorId) throw bootstrapError('actor é obrigatório.', 'FENIX_BOOTSTRAP_ACTOR_REQUIRED');
  if (!tokenId) throw bootstrapError('viewerToken é obrigatório.', 'FENIX_BOOTSTRAP_TOKEN_REQUIRED');
  if (text(viewerToken?.actorId) !== actorId) {
    throw bootstrapError('viewerToken não pertence ao actor.', 'FENIX_BOOTSTRAP_TOKEN_ACTOR_MISMATCH');
  }

  const grid = scene.grid ?? {};
  const scale = normalizeSceneScale(scene.scale ?? grid);
  const gridSize = Math.max(1, finite(grid.size, 70));
  const eyeHeightMeters = Math.max(0.1, finite(actor?.resolved?.vision?.eyeHeight ?? actor?.sheet?.vision?.eyeHeight, 1.6));
  const eyeHeight = convertDistance(eyeHeightMeters, 'm', scale.unit);
  const tokenElevation = finite(viewerToken.elevation, 0);
  const vision = actor?.resolved?.vision ?? actor?.sheet?.vision ?? {};
  const effectiveVision = effectiveVisionRange({ profile: vision, sceneScale: scale });
  const tokens = (Array.isArray(visibleTokens) ? visibleTokens : [])
    .filter((token) => text(token?.tokenId ?? token?.id))
    .map(publicToken);
  if (!tokens.some((token) => token.tokenId === tokenId)) tokens.push(publicToken(viewerToken));

  return Object.freeze({
    schema: 'fenix.render-world-bootstrap',
    version: 1,
    createdAt: new Date(createdAt).toISOString(),
    campaign: Object.freeze({
      id: campaignId,
      title: text(campaign?.title, 300) || campaignId,
      systemId: text(campaign?.systemId, 120) || text(actor?.systemId, 120) || 'generic'
    }),
    scene: Object.freeze({
      id: sceneId,
      name: text(scene?.name, 300) || sceneId,
      width: Math.max(1, finite(scene?.width, 1)),
      height: Math.max(1, finite(scene?.height, 1)),
      backgroundAssetId: text(scene?.backgroundAssetId) || null,
      grid: Object.freeze({
        size: gridSize,
        type: text(grid.type, 40) || 'square',
        offsetX: finite(grid.offsetX),
        offsetY: finite(grid.offsetY),
        scale
      }),
      physical: Object.freeze({
        distancePerPixel: scale.distancePerCell / gridSize,
        unit: scale.unit,
        walls: Object.freeze(clone(scene?.walls, [])),
        lighting: Object.freeze(clone(scene?.lighting, { enabled: false, darkness: 0, sources: [] })),
        elevation: Object.freeze(clone(scene?.elevation, { enabled: false, unit: scale.unit, levels: [] })),
        regions: Object.freeze(clone(scene?.regions, []))
      }),
      fog: Object.freeze({
        enabled: scene?.fog?.enabled === true,
        exploredOpacity: finite(scene?.fog?.exploredOpacity, 0.45),
        unexploredOpacity: finite(scene?.fog?.unexploredOpacity, 1),
        exploredCells: Object.freeze(viewerExploration(scene, actorId))
      })
    }),
    viewer: Object.freeze({
      actor: Object.freeze({
        actorId,
        sheetId: text(actor?.sheetId) || null,
        systemId: text(actor?.systemId, 120) || 'generic',
        name: text(actor?.name, 200) || actorId,
        kind: text(actor?.kind, 60) || 'character',
        height: Math.max(0.1, finite(actor?.sheet?.height, 1.8)),
        movement: Object.freeze(clone(actor?.resolved?.movement, {})),
        vision: Object.freeze(clone(vision, {})),
        footprint: Object.freeze(clone(actor?.resolved?.footprint, { widthCells: 1, heightCells: 1 }))
      }),
      token: publicToken({ ...viewerToken, height: viewerToken?.height ?? actor?.sheet?.height }),
      camera: Object.freeze({
        sceneX: finite(viewerToken.x),
        sceneY: finite(viewerToken.y),
        groundElevation: tokenElevation,
        eyeHeight,
        elevation: tokenElevation + eyeHeight,
        unit: scale.unit,
        preferredSense: effectiveVision.sense,
        visionDistance: effectiveVision.distance,
        visionCells: effectiveVision.cells
      })
    }),
    tokens: Object.freeze(tokens)
  });
}
