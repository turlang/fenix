import { resolveTokenMovement } from '../../../packages/scene-collision/src/index.js';

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

  const collision = resolveTokenMovement({
    from: previousToken,
    to: requestedToken,
    walls: ignoreWalls ? [] : (scene.walls ?? []),
    sceneWidth: scene.width,
    sceneHeight: scene.height,
    tokenSize: requestedToken.size ?? previousToken.size
  });

  return {
    token: {
      ...requestedToken,
      x: collision.position.x,
      y: collision.position.y
    },
    collision: {
      ...collision,
      ignoredWalls: ignoreWalls === true
    }
  };
}
