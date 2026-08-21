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

function normalizedFootprintCells(value) {
  const cells = Number(value);
  if (!Number.isFinite(cells) || cells <= 0) return 1;
  // Pequeno ou maior sempre avança uma célula por comando.
  // Footprints abaixo de 1 (ex.: Tiny/Miúdo = 0,5) mantêm passo proporcional.
  return Math.min(1, Math.max(0.25, cells));
}

export function tokenKeyboardFootprintCells(token = {}) {
  const width = Number(token?.footprint?.widthCells);
  const height = Number(token?.footprint?.heightCells);
  const candidates = [width, height].filter((value) => Number.isFinite(value) && value > 0);
  if (!candidates.length) return 1;
  return normalizedFootprintCells(Math.min(...candidates));
}

export function keyboardMovementStep(gridSize, { footprintCells = 1 } = {}) {
  const size = Math.max(8, Number(gridSize) || 70);
  return size * normalizedFootprintCells(footprintCells);
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

export function requestedTokenFromKeyboard(token, key, { gridSize = 70, footprintCells = null } = {}) {
  const direction = movementDirectionForKey(key);
  if (!direction || !token) return null;
  const footprint = footprintCells == null ? tokenKeyboardFootprintCells(token) : footprintCells;
  const step = keyboardMovementStep(gridSize, { footprintCells: footprint });
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
