import { wallBlocksVision } from '../../scene-geometry/src/index.js';
import { wallContainsElevation } from '../../scene-elevation/src/index.js';
import { effectiveVisionRange, normalizeVisionProfile } from '../../rpg-rules-contract/src/index.js';
import { normalizeSceneScale } from '../../scene-scale/src/index.js';

const EPSILON = 1e-6;
const DEFAULT_RAY_STEPS = 96;
const MAX_EXPLORED_CELLS = 20_000;

function visionError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedPoint(input = {}) {
  return { x: finite(input.x), y: finite(input.y) };
}

function blockingSegments(walls = [], sceneWidth, sceneHeight) {
  const width = Math.max(1, finite(sceneWidth, 1));
  const height = Math.max(1, finite(sceneHeight, 1));
  const segments = (Array.isArray(walls) ? walls : [])
    .filter((wall) => wallBlocksVision(wall))
    .map((wall) => ({ a: normalizedPoint(wall.a), b: normalizedPoint(wall.b), wall }));
  segments.push(
    { a: { x: 0, y: 0 }, b: { x: width, y: 0 }, boundary: true },
    { a: { x: width, y: 0 }, b: { x: width, y: height }, boundary: true },
    { a: { x: width, y: height }, b: { x: 0, y: height }, boundary: true },
    { a: { x: 0, y: height }, b: { x: 0, y: 0 }, boundary: true }
  );
  return segments;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function raySegmentDistance(origin, direction, segment) {
  const sx = segment.b.x - segment.a.x;
  const sy = segment.b.y - segment.a.y;
  const ox = segment.a.x - origin.x;
  const oy = segment.a.y - origin.y;
  const denominator = cross(direction.x, direction.y, sx, sy);
  if (Math.abs(denominator) < EPSILON) return null;
  const t = cross(ox, oy, sx, sy) / denominator;
  const u = cross(ox, oy, direction.x, direction.y) / denominator;
  if (t <= 0.0001 || u < -EPSILON || u > 1 + EPSILON) return null;
  return t;
}

function angleFor(origin, point) {
  return Math.atan2(point.y - origin.y, point.x - origin.x);
}

function uniqueSortedAngles(angles) {
  const sorted = [...angles].sort((a, b) => a - b);
  const result = [];
  for (const angle of sorted) {
    if (!result.length || Math.abs(angle - result[result.length - 1]) > 1e-7) result.push(angle);
  }
  return result;
}

function lineElevationAtDistance(originElevation, targetElevation, hitDistance, totalDistance) {
  if (totalDistance <= EPSILON) return originElevation;
  const ratio = clamp(hitDistance / totalDistance, 0, 1);
  return originElevation + (targetElevation - originElevation) * ratio;
}

export function normalizeSceneFog(input = {}) {
  const exploredOpacity = clamp(finite(input.exploredOpacity, 0.55), 0, 0.95);
  const unexploredOpacity = clamp(finite(input.unexploredOpacity, 0.94), exploredOpacity, 1);
  return Object.freeze({
    enabled: input.enabled === true,
    // Compatibilidade de leitura com cenas antigas. Novos fluxos devem fornecer visionProfile.
    visionRangeCells: Math.round(clamp(finite(input.visionRangeCells, 8), 1, 60)),
    exploredOpacity: Math.round(exploredOpacity * 100) / 100,
    unexploredOpacity: Math.round(unexploredOpacity * 100) / 100
  });
}

export function normalizeExploredCells(input, { maxCells = MAX_EXPLORED_CELLS } = {}) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input)) throw visionError('exploredCells precisa ser uma lista.', 'SCENE_FOG_EXPLORED_INVALID');
  const limit = Math.max(1, Math.min(MAX_EXPLORED_CELLS, Number(maxCells) || MAX_EXPLORED_CELLS));
  const unique = new Set();
  for (const value of input) {
    const key = String(value ?? '').trim();
    if (!/^-?\d+:-?\d+$/.test(key)) continue;
    unique.add(key);
    if (unique.size > limit) {
      throw visionError(`Exploração excede ${limit} células por personagem.`, 'SCENE_FOG_EXPLORED_LIMIT', 413);
    }
  }
  return Object.freeze([...unique].sort());
}

export function mergeExploredCells(existing, discovered, options = {}) {
  return normalizeExploredCells([
    ...normalizeExploredCells(existing, options),
    ...normalizeExploredCells(discovered, options)
  ], options);
}

export function resolveVisionForScene({ visionProfile, sceneScale, grid = {}, legacyVisionRangeCells = 8 } = {}) {
  if (visionProfile) {
    const scale = normalizeSceneScale(sceneScale ?? {});
    const profile = normalizeVisionProfile(visionProfile);
    const resolved = effectiveVisionRange({ profile, sceneScale: scale });
    return Object.freeze({
      profile,
      sense: resolved.sense,
      distance: resolved.distance,
      unit: resolved.unit,
      cells: resolved.cells,
      pixels: resolved.cells * Math.max(1, finite(grid.size, 70)),
      source: 'actor-sheet'
    });
  }
  const cells = Math.round(clamp(finite(legacyVisionRangeCells, 8), 1, 60));
  return Object.freeze({
    profile: normalizeVisionProfile({ unit: 'm', eyeHeight: 1.6, senses: { normal: cells * 1.5 } }),
    sense: 'normal',
    distance: cells * 1.5,
    unit: 'm',
    cells,
    pixels: cells * Math.max(1, finite(grid.size, 70)),
    source: 'legacy-fog'
  });
}

export function hasLineOfSight(originInput, targetInput, walls = [], {
  maxDistance = Number.POSITIVE_INFINITY,
  originElevation = 0,
  targetElevation = originElevation,
  elevationEnabled = false
} = {}) {
  const origin = normalizedPoint(originInput);
  const target = normalizedPoint(targetInput);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON) return true;
  if (Number.isFinite(maxDistance) && distance > maxDistance + EPSILON) return false;
  const direction = { x: dx / distance, y: dy / distance };
  for (const wall of Array.isArray(walls) ? walls : []) {
    if (!wallBlocksVision(wall)) continue;
    const segment = { a: normalizedPoint(wall.a), b: normalizedPoint(wall.b) };
    const hit = raySegmentDistance(origin, direction, segment);
    if (hit == null || hit >= distance - 0.001) continue;
    if (elevationEnabled) {
      const rayElevation = lineElevationAtDistance(
        finite(originElevation),
        finite(targetElevation, originElevation),
        hit,
        distance
      );
      if (!wallContainsElevation(wall, rayElevation, { enabled: true })) continue;
    }
    return false;
  }
  return true;
}

export function computeVisibilityPolygon({
  origin: originInput,
  walls = [],
  sceneWidth,
  sceneHeight,
  maxDistance = Number.POSITIVE_INFINITY,
  raySteps = DEFAULT_RAY_STEPS,
  eyeElevation = 0,
  elevationEnabled = false
} = {}) {
  const width = Math.max(1, finite(sceneWidth, 1));
  const height = Math.max(1, finite(sceneHeight, 1));
  const origin = {
    x: clamp(finite(originInput?.x), 0, width),
    y: clamp(finite(originInput?.y), 0, height)
  };
  const fallbackDistance = Math.hypot(width, height) * 2;
  const radius = Number.isFinite(maxDistance) ? Math.max(1, finite(maxDistance, 1)) : fallbackDistance;
  const segments = blockingSegments(walls, width, height);
  const angles = new Set();
  const epsilonAngle = 0.00001;

  for (const segment of segments) {
    for (const point of [segment.a, segment.b]) {
      const angle = angleFor(origin, point);
      angles.add(angle - epsilonAngle);
      angles.add(angle);
      angles.add(angle + epsilonAngle);
    }
  }

  const steps = Math.max(24, Math.min(360, Math.round(finite(raySteps, DEFAULT_RAY_STEPS))));
  for (let index = 0; index < steps; index += 1) {
    angles.add(-Math.PI + (index / steps) * Math.PI * 2);
  }

  return Object.freeze(uniqueSortedAngles(angles).map((angle) => {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    let nearest = radius;
    for (const segment of segments) {
      const hit = raySegmentDistance(origin, direction, segment);
      if (hit == null || hit >= nearest) continue;
      if (elevationEnabled && !segment.boundary
        && !wallContainsElevation(segment.wall, eyeElevation, { enabled: true })) continue;
      nearest = hit;
    }
    return Object.freeze({
      x: Math.round(clamp(origin.x + direction.x * nearest, 0, width) * 100) / 100,
      y: Math.round(clamp(origin.y + direction.y * nearest, 0, height) * 100) / 100
    });
  }));
}

export function visibleGridCells({
  origin: originInput,
  walls = [],
  grid = {},
  sceneWidth,
  sceneHeight,
  visionProfile = null,
  sceneScale = null,
  visionRangeCells = 8,
  originElevation = 0,
  elevationEnabled = false
} = {}) {
  const width = Math.max(1, finite(sceneWidth, 1));
  const height = Math.max(1, finite(sceneHeight, 1));
  const size = Math.max(1, finite(grid.size, 70));
  const offsetX = finite(grid.offsetX);
  const offsetY = finite(grid.offsetY);
  const resolvedVision = resolveVisionForScene({
    visionProfile,
    sceneScale,
    grid,
    legacyVisionRangeCells: visionRangeCells
  });
  const rangeCells = Math.max(0, Math.ceil(resolvedVision.cells));
  const maxDistance = resolvedVision.pixels;
  if (!resolvedVision.profile.enabled || maxDistance <= 0) return Object.freeze([]);
  const origin = normalizedPoint(originInput);
  const eyeElevation = finite(originElevation) + finite(resolvedVision.profile.eyeHeight, 1.6);
  const originCol = Math.floor((origin.x - offsetX) / size);
  const originRow = Math.floor((origin.y - offsetY) / size);
  const keys = [];

  for (let row = originRow - rangeCells; row <= originRow + rangeCells; row += 1) {
    for (let col = originCol - rangeCells; col <= originCol + rangeCells; col += 1) {
      const center = {
        x: offsetX + (col + 0.5) * size,
        y: offsetY + (row + 0.5) * size
      };
      if (center.x < 0 || center.y < 0 || center.x > width || center.y > height) continue;
      if (Math.hypot(center.x - origin.x, center.y - origin.y) > maxDistance + size * 0.75) continue;
      if (hasLineOfSight(origin, center, walls, {
        maxDistance: maxDistance + size * 0.75,
        originElevation: eyeElevation,
        targetElevation: finite(originElevation),
        elevationEnabled
      })) {
        keys.push(`${col}:${row}`);
      }
    }
  }

  return normalizeExploredCells(keys);
}

export function cellKeyToRect(key, grid = {}) {
  const [colText, rowText] = String(key ?? '').split(':');
  const col = Number(colText);
  const row = Number(rowText);
  if (!Number.isInteger(col) || !Number.isInteger(row)) return null;
  const size = Math.max(1, finite(grid.size, 70));
  const offsetX = finite(grid.offsetX);
  const offsetY = finite(grid.offsetY);
  return Object.freeze({
    x: offsetX + col * size,
    y: offsetY + row * size,
    width: size,
    height: size
  });
}
