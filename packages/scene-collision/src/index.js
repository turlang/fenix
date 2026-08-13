import { pointToWallDistance, wallBlocksMovement } from '../../scene-geometry/src/index.js';

const EPSILON = 0.001;
const MAX_SWEEP_STEPS = 2_000;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function point(input = {}) {
  return { x: finite(input.x), y: finite(input.y) };
}

function tokenRadius(tokenSize, padding = 1) {
  const size = Math.max(1, finite(tokenSize, 70));
  return Math.max(1, size / 2 + Math.max(0, finite(padding, 1)));
}

function clampCenter(input, sceneWidth, sceneHeight, radius) {
  const width = Math.max(radius * 2, finite(sceneWidth, radius * 2));
  const height = Math.max(radius * 2, finite(sceneHeight, radius * 2));
  return {
    x: clamp(finite(input.x), radius, Math.max(radius, width - radius)),
    y: clamp(finite(input.y), radius, Math.max(radius, height - radius))
  };
}

function blockersAt(position, walls, radius) {
  const matches = [];
  for (const wall of Array.isArray(walls) ? walls : []) {
    if (!wallBlocksMovement(wall)) continue;
    if (pointToWallDistance(position, wall) <= radius + EPSILON) matches.push(wall);
  }
  return matches;
}

function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function resolveTokenMovement({
  from: fromInput = null,
  to: toInput,
  walls = [],
  sceneWidth,
  sceneHeight,
  tokenSize = 70,
  padding = 1
} = {}) {
  const radius = tokenRadius(tokenSize, padding);
  const target = clampCenter(point(toInput), sceneWidth, sceneHeight, radius);
  const boundaryAdjusted = Math.abs(target.x - finite(toInput?.x)) > EPSILON
    || Math.abs(target.y - finite(toInput?.y)) > EPSILON;

  if (!fromInput) {
    return Object.freeze({
      position: Object.freeze(target),
      requested: Object.freeze(point(toInput)),
      blocked: boundaryAdjusted,
      boundaryAdjusted,
      wallId: null,
      fraction: 1,
      radius
    });
  }

  const start = clampCenter(point(fromInput), sceneWidth, sceneHeight, radius);
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON) {
    return Object.freeze({
      position: Object.freeze(start),
      requested: Object.freeze(point(toInput)),
      blocked: boundaryAdjusted,
      boundaryAdjusted,
      wallId: null,
      fraction: 1,
      radius
    });
  }

  const initialBlockers = new Set(blockersAt(start, walls, radius).map((wall) => wall.id));
  const stepLength = Math.max(1, radius * 0.3);
  const steps = Math.min(MAX_SWEEP_STEPS, Math.max(1, Math.ceil(distance / stepLength)));
  let previous = start;
  let previousT = 0;

  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const candidate = lerp(start, target, t);
    const collisions = blockersAt(candidate, walls, radius).filter((wall) => {
      if (!initialBlockers.has(wall.id)) return true;
      const previousDistance = pointToWallDistance(previous, wall);
      const nextDistance = pointToWallDistance(candidate, wall);
      return nextDistance + EPSILON < previousDistance;
    });
    if (!collisions.length) {
      previous = candidate;
      previousT = t;
      continue;
    }

    let low = previousT;
    let high = t;
    let safe = previous;
    for (let iteration = 0; iteration < 14; iteration += 1) {
      const mid = (low + high) / 2;
      const probe = lerp(start, target, mid);
      const blocked = blockersAt(probe, walls, radius).some((wall) => {
        if (!initialBlockers.has(wall.id)) return true;
        return pointToWallDistance(probe, wall) + EPSILON < pointToWallDistance(start, wall);
      });
      if (blocked) high = mid;
      else {
        low = mid;
        safe = probe;
      }
    }

    return Object.freeze({
      position: Object.freeze({ x: Math.round(safe.x * 100) / 100, y: Math.round(safe.y * 100) / 100 }),
      requested: Object.freeze(point(toInput)),
      blocked: true,
      boundaryAdjusted,
      wallId: collisions[0]?.id ?? null,
      fraction: Math.round(low * 10_000) / 10_000,
      radius
    });
  }

  return Object.freeze({
    position: Object.freeze({ x: Math.round(target.x * 100) / 100, y: Math.round(target.y * 100) / 100 }),
    requested: Object.freeze(point(toInput)),
    blocked: boundaryAdjusted,
    boundaryAdjusted,
    wallId: null,
    fraction: 1,
    radius
  });
}
