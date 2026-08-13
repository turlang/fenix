import { resolveTokenMovement } from '../../../packages/scene-collision/src/index.js';
import { normalizeSceneElevation } from '../../../packages/scene-elevation/src/index.js';
import { normalizeTokenVisionProfile } from '../../../packages/scene-vision/src/index.js';

const DIRECTIONS = Object.freeze({
  w: Object.freeze({ x: 0, y: -1 }),
  arrowup: Object.freeze({ x: 0, y: -1 }),
  s: Object.freeze({ x: 0, y: 1 }),
  arrowdown: Object.freeze({ x: 0, y: 1 }),
  a: Object.freeze({ x: -1, y: 0 }),
  arrowleft: Object.freeze({ x: -1, y: 0 }),
  d: Object.freeze({ x: 1, y: 0 }),
  arrowright: Object.freeze({ x: 1, y: 0 })
});

export function movementDirectionForKey(key) {
  return DIRECTIONS[String(key ?? '').toLowerCase()] ?? null;
}

export function keyboardMovementStep(gridSize, { fullCell = false } = {}) {
  const size = Math.max(8, Number(gridSize) || 70);
  return Math.max(4, size * (fullCell ? 1 : 0.2));
}

export function isEditableKeyboardTarget(target) {
  const tagName = String(target?.tagName ?? '').toLowerCase();
  return Boolean(
    target?.isContentEditable
    || tagName === 'input'
    || tagName === 'textarea'
    || tagName === 'select'
    || tagName === 'button'
  );
}

export function requestedTokenFromKeyboard(token, key, { gridSize = 70, fullCell = false } = {}) {
  const direction = movementDirectionForKey(key);
  if (!direction || !token) return null;
  const step = keyboardMovementStep(gridSize, { fullCell });
  return {
    ...token,
    x: Number(token.x) + direction.x * step,
    y: Number(token.y) + direction.y * step
  };
}

export function resolveClientTokenMovement({
  previousToken,
  requestedToken,
  scene,
  ignoreWalls = false
} = {}) {
  if (!requestedToken) return null;
  if (!previousToken || !scene) return { token: { ...requestedToken }, collision: null };

  const profile = normalizeTokenVisionProfile(scene.visionProfiles?.[requestedToken.id] ?? {}, {
    defaultRangeCells: Number(scene.fog?.visionRangeCells) || 8
  });
  const elevationConfig = normalizeSceneElevation(scene.elevation ?? {});
  const tokenElevation = Number.isFinite(Number(requestedToken.elevation))
    ? Number(requestedToken.elevation)
    : Number.isFinite(Number(previousToken.elevation)) ? Number(previousToken.elevation) : profile.elevation;
  const tokenHeight = Number.isFinite(Number(requestedToken.height))
    ? Number(requestedToken.height)
    : Number.isFinite(Number(previousToken.height)) ? Number(previousToken.height) : profile.height;

  const collision = resolveTokenMovement({
    from: previousToken,
    to: requestedToken,
    walls: ignoreWalls ? [] : (scene.walls ?? []),
    sceneWidth: scene.width,
    sceneHeight: scene.height,
    tokenSize: requestedToken.size ?? previousToken.size,
    verticalEnabled: elevationConfig.enabled,
    tokenElevation,
    tokenHeight
  });

  return {
    token: {
      ...requestedToken,
      elevation: tokenElevation,
      height: tokenHeight,
      movementMode: requestedToken.movementMode ?? previousToken.movementMode ?? profile.movementMode,
      x: collision.position.x,
      y: collision.position.y
    },
    collision: {
      ...collision,
      ignoredWalls: ignoreWalls === true
    }
  };
}
