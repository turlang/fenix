import {
  normalizeSceneElevation,
  normalizeSceneRegions,
  resolveGroundElevation
} from '../../../packages/scene-elevation/src/index.js';

export function previewGroundElevation(scene, token, fallbackElevation = 0) {
  const config = normalizeSceneElevation(scene?.elevation ?? {});
  if (!config.enabled || token?.movementMode !== 'ground') return null;
  const regions = normalizeSceneRegions(scene?.regions ?? [], {
    sceneWidth: scene?.width,
    sceneHeight: scene?.height
  });
  if (!regions.length) return null;
  return resolveGroundElevation({
    regions,
    point: token,
    fallbackElevation
  });
}
