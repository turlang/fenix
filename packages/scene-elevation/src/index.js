const MIN_ELEVATION = -1000;
const MAX_ELEVATION = 10000;
const MAX_LEVELS = 32;
const EPSILON = 0.0001;

export const TokenMovementMode = Object.freeze({
  GROUND: 'ground',
  FLYING: 'flying'
});

function elevationError(message, code, statusCode = 400) {
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

function rounded(value) {
  return Math.round(value * 100) / 100;
}

function text(value, max = 120) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export function normalizeElevationValue(value, fallback = 0) {
  return rounded(clamp(finite(value, fallback), MIN_ELEVATION, MAX_ELEVATION));
}

export function normalizeElevationLevel(input = {}, index = 0) {
  const elevation = normalizeElevationValue(input.elevation, index * 3);
  const id = text(input.id, 80) || `level-${index + 1}`;
  const name = text(input.name, 120) || (index === 0 ? 'Térreo' : `Nível ${index + 1}`);
  return Object.freeze({ id, name, elevation });
}

export function normalizeElevationLevels(input = [{ id: 'ground', name: 'Térreo', elevation: 0 }]) {
  const raw = input == null ? [] : input;
  if (!Array.isArray(raw)) throw elevationError('elevation.levels precisa ser uma lista.', 'SCENE_ELEVATION_LEVELS_INVALID');
  if (raw.length > MAX_LEVELS) {
    throw elevationError(`Uma cena aceita no máximo ${MAX_LEVELS} níveis.`, 'SCENE_ELEVATION_LEVEL_LIMIT', 413);
  }
  const seen = new Set();
  const levels = (raw.length ? raw : [{ id: 'ground', name: 'Térreo', elevation: 0 }]).map((level, index) => {
    const normalized = normalizeElevationLevel(level, index);
    if (seen.has(normalized.id)) throw elevationError('IDs de níveis duplicados.', 'SCENE_ELEVATION_LEVEL_ID_CONFLICT');
    seen.add(normalized.id);
    return normalized;
  }).sort((a, b) => a.elevation - b.elevation || a.id.localeCompare(b.id));
  return Object.freeze(levels);
}

export function normalizeSceneElevation(input = {}) {
  const levelHeight = rounded(clamp(finite(input.levelHeight, 3), 0.5, 100));
  const verticalStep = rounded(clamp(finite(input.verticalStep, Math.min(1, levelHeight)), 0.25, levelHeight));
  const defaultWallBottom = normalizeElevationValue(input.defaultWallBottom, 0);
  const defaultWallTopCandidate = normalizeElevationValue(input.defaultWallTop, defaultWallBottom + levelHeight);
  const defaultWallTop = Math.max(defaultWallBottom + 0.1, defaultWallTopCandidate);
  return Object.freeze({
    enabled: input.enabled === true,
    unit: text(input.unit, 12) || 'm',
    levelHeight,
    verticalStep,
    defaultWallBottom,
    defaultWallTop: rounded(defaultWallTop),
    levels: normalizeElevationLevels(input.levels)
  });
}

export function normalizeTokenVerticalProfile(input = {}) {
  const requestedMode = String(input.movementMode ?? TokenMovementMode.GROUND).trim().toLowerCase();
  return Object.freeze({
    elevation: normalizeElevationValue(input.elevation, 0),
    height: rounded(clamp(finite(input.height, 1.8), 0.2, 20)),
    movementMode: requestedMode === TokenMovementMode.FLYING ? TokenMovementMode.FLYING : TokenMovementMode.GROUND
  });
}

export function verticalBand(bottom, top = bottom) {
  const first = normalizeElevationValue(bottom, 0);
  const second = normalizeElevationValue(top, first);
  return Object.freeze({
    bottom: Math.min(first, second),
    top: Math.max(first, second)
  });
}

export function tokenVerticalBand({ elevation = 0, height = 1.8 } = {}) {
  const bottom = normalizeElevationValue(elevation, 0);
  const normalizedHeight = rounded(clamp(finite(height, 1.8), 0.2, 20));
  return Object.freeze({ bottom, top: rounded(bottom + normalizedHeight) });
}

export function wallVerticalBand(wall = {}) {
  const bottom = normalizeElevationValue(wall.bottomElevation, MIN_ELEVATION);
  const top = normalizeElevationValue(wall.topElevation, MAX_ELEVATION);
  return Object.freeze({ bottom: Math.min(bottom, top), top: Math.max(bottom, top) });
}

export function verticalBandsOverlap(first = {}, second = {}) {
  const a = verticalBand(first.bottom, first.top);
  const b = verticalBand(second.bottom, second.top);
  return a.top > b.bottom + EPSILON && a.bottom < b.top - EPSILON;
}

export function wallIntersectsVerticalBand(wall, band, { enabled = true } = {}) {
  if (!enabled) return true;
  return verticalBandsOverlap(wallVerticalBand(wall), band);
}

export function wallContainsElevation(wall, elevation, { enabled = true } = {}) {
  if (!enabled) return true;
  const band = wallVerticalBand(wall);
  const value = normalizeElevationValue(elevation, 0);
  return value > band.bottom + EPSILON && value < band.top - EPSILON;
}

export function eyeElevation(profile = {}, tokenElevation = undefined) {
  const vertical = normalizeTokenVerticalProfile({
    ...profile,
    elevation: tokenElevation ?? profile.elevation
  });
  return rounded(vertical.elevation + vertical.height * 0.9);
}

export function levelForElevation(sceneElevationInput, elevation) {
  const config = normalizeSceneElevation(sceneElevationInput);
  const value = normalizeElevationValue(elevation, 0);
  let best = config.levels[0] ?? null;
  let distance = Number.POSITIVE_INFINITY;
  for (const level of config.levels) {
    const next = Math.abs(level.elevation - value);
    if (next < distance) {
      distance = next;
      best = level;
    }
  }
  return best;
}

export function clampFlyingElevation({ previousElevation, requestedElevation, baseElevation = 0, verticalStep = 1 } = {}) {
  const previous = normalizeElevationValue(previousElevation, baseElevation);
  const requested = normalizeElevationValue(requestedElevation, previous);
  const step = Math.max(0.25, finite(verticalStep, 1));
  return normalizeElevationValue(clamp(requested, previous - step, previous + step), previous);
}
