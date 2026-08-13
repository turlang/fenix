import { wallBlocksVision } from '../../scene-geometry/src/index.js';

const EPSILON = 1e-6;
const DEFAULT_RAY_STEPS = 96;
const MAX_EXPLORED_CELLS = 20_000;
const DEFAULT_PERSONAL_LIGHT_COLOR = '#f2c66f';

export const TokenVisionMode = Object.freeze({
  NORMAL: 'normal',
  DARKVISION: 'darkvision',
  INFRAVISION: 'infravision'
});

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

function normalizedColor(value) {
  const candidate = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : DEFAULT_PERSONAL_LIGHT_COLOR;
}

function normalizedActorId(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
}

function blockingSegments(walls = [], sceneWidth, sceneHeight) {
  const width = Math.max(1, finite(sceneWidth, 1));
  const height = Math.max(1, finite(sceneHeight, 1));
  const segments = (Array.isArray(walls) ? walls : [])
    .filter((wall) => wallBlocksVision(wall))
    .map((wall) => ({ a: normalizedPoint(wall.a), b: normalizedPoint(wall.b) }));
  segments.push(
    { a: { x: 0, y: 0 }, b: { x: width, y: 0 } },
    { a: { x: width, y: 0 }, b: { x: width, y: height } },
    { a: { x: width, y: height }, b: { x: 0, y: height } },
    { a: { x: 0, y: height }, b: { x: 0, y: 0 } }
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

export function normalizeTokenVisionProfile(input = {}, { defaultRangeCells = 8 } = {}) {
  const requestedMode = String(input.mode ?? TokenVisionMode.NORMAL).trim().toLowerCase();
  const mode = Object.values(TokenVisionMode).includes(requestedMode)
    ? requestedMode
    : TokenVisionMode.NORMAL;
  const personalLight = input.personalLight && typeof input.personalLight === 'object'
    ? input.personalLight
    : {};
  return Object.freeze({
    mode,
    rangeCells: Math.round(clamp(finite(input.rangeCells, defaultRangeCells), 1, 60)),
    elevation: Math.round(clamp(finite(input.elevation, 0), -1000, 10000) * 100) / 100,
    personalLight: Object.freeze({
      enabled: personalLight.enabled === true,
      radiusCells: Math.round(clamp(finite(personalLight.radiusCells, 4), 1, 60)),
      intensity: Math.round(clamp(finite(personalLight.intensity, 0.85), 0.1, 1) * 100) / 100,
      color: normalizedColor(personalLight.color)
    })
  });
}

export function normalizeTokenVisionProfiles(input = {}, { defaultRangeCells = 8 } = {}) {
  if (input == null) return Object.freeze({});
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw visionError('visionProfiles precisa ser um objeto por actorId.', 'SCENE_VISION_PROFILES_INVALID');
  }
  const entries = Object.entries(input);
  if (entries.length > 256) {
    throw visionError('Uma cena aceita no máximo 256 perfis de visão.', 'SCENE_VISION_PROFILE_LIMIT', 413);
  }
  const normalized = {};
  for (const [rawActorId, profile] of entries) {
    const actorId = normalizedActorId(rawActorId);
    if (!actorId) continue;
    normalized[actorId] = normalizeTokenVisionProfile(profile, { defaultRangeCells });
  }
  return Object.freeze(normalized);
}

export function resolveTokenVisionProfile({ scene = null, actorId = null, fallbackRangeCells = 8 } = {}) {
  const id = normalizedActorId(actorId);
  const profile = id && scene?.visionProfiles && typeof scene.visionProfiles === 'object'
    ? scene.visionProfiles[id]
    : null;
  return normalizeTokenVisionProfile(profile ?? {}, { defaultRangeCells: fallbackRangeCells });
}

export function tokenVisionTint(mode) {
  if (mode === TokenVisionMode.DARKVISION) {
    return Object.freeze({ color: '#a9b6c8', opacity: 0.16, darknessBypass: 0.78 });
  }
  if (mode === TokenVisionMode.INFRAVISION) {
    return Object.freeze({ color: '#ff7043', opacity: 0.2, darknessBypass: 0.88 });
  }
  return Object.freeze({ color: '#ffffff', opacity: 0, darknessBypass: 0 });
}

export function normalizeSceneFog(input = {}) {
  const exploredOpacity = clamp(finite(input.exploredOpacity, 0.55), 0, 0.95);
  const unexploredOpacity = clamp(finite(input.unexploredOpacity, 0.94), exploredOpacity, 1);
  return Object.freeze({
    enabled: input.enabled === true,
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

export function hasLineOfSight(originInput, targetInput, walls = [], { maxDistance = Number.POSITIVE_INFINITY } = {}) {
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
    if (hit != null && hit < distance - 0.001) return false;
  }
  return true;
}

export function computeVisibilityPolygon({
  origin: originInput,
  walls = [],
  sceneWidth,
  sceneHeight,
  maxDistance = Number.POSITIVE_INFINITY,
  raySteps = DEFAULT_RAY_STEPS
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
      if (hit != null && hit < nearest) nearest = hit;
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
  visionRangeCells = 8
} = {}) {
  const width = Math.max(1, finite(sceneWidth, 1));
  const height = Math.max(1, finite(sceneHeight, 1));
  const size = Math.max(1, finite(grid.size, 70));
  const offsetX = finite(grid.offsetX);
  const offsetY = finite(grid.offsetY);
  const rangeCells = Math.round(clamp(finite(visionRangeCells, 8), 1, 60));
  const maxDistance = rangeCells * size;
  const origin = normalizedPoint(originInput);
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
      if (hasLineOfSight(origin, center, walls, { maxDistance: maxDistance + size * 0.75 })) {
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
