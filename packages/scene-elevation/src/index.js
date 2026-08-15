const MIN_ELEVATION = -1000;
const MAX_ELEVATION = 10000;
const MAX_LEVELS = 32;
const MAX_REGIONS = 128;
const MAX_REGION_POINTS = 64;
const EPSILON = 0.0001;

export const TokenMovementMode = Object.freeze({
  GROUND: 'ground',
  FLYING: 'flying'
});

export const SceneRegionKind = Object.freeze({
  FLOOR: 'floor',
  STAIRS: 'stairs',
  RAMP: 'ramp'
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
  if (raw.length > MAX_LEVELS) throw elevationError(`Uma cena aceita no máximo ${MAX_LEVELS} níveis.`, 'SCENE_ELEVATION_LEVEL_LIMIT', 413);
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
  return Object.freeze({ bottom: Math.min(first, second), top: Math.max(first, second) });
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
  const vertical = normalizeTokenVerticalProfile({ ...profile, elevation: tokenElevation ?? profile.elevation });
  return rounded(vertical.elevation + vertical.height * 0.9);
}

export function levelForElevation(sceneElevationInput, elevation) {
  const config = normalizeSceneElevation(sceneElevationInput);
  const value = normalizeElevationValue(elevation, 0);
  let best = config.levels[0] ?? null;
  let distance = Number.POSITIVE_INFINITY;
  for (const level of config.levels) {
    const next = Math.abs(level.elevation - value);
    if (next < distance) { distance = next; best = level; }
  }
  return best;
}

export function clampFlyingElevation({ previousElevation, requestedElevation, baseElevation = 0, verticalStep = 1 } = {}) {
  const previous = normalizeElevationValue(previousElevation, baseElevation);
  const requested = normalizeElevationValue(requestedElevation, previous);
  const step = Math.max(0.25, finite(verticalStep, 1));
  return normalizeElevationValue(clamp(requested, previous - step, previous + step), previous);
}

function normalizeRegionKind(value) {
  const kind = String(value ?? '').trim().toLowerCase();
  if (kind === SceneRegionKind.STAIRS) return SceneRegionKind.STAIRS;
  if (kind === SceneRegionKind.RAMP) return SceneRegionKind.RAMP;
  return SceneRegionKind.FLOOR;
}

function normalizeRegionPoint(input = {}, { sceneWidth = 1_000_000, sceneHeight = 1_000_000 } = {}) {
  return Object.freeze({
    x: rounded(clamp(finite(input.x), 0, Math.max(1, finite(sceneWidth, 1_000_000)))),
    y: rounded(clamp(finite(input.y), 0, Math.max(1, finite(sceneHeight, 1_000_000))))
  });
}

export function polygonArea(points = []) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += finite(current?.x) * finite(next?.y) - finite(next?.x) * finite(current?.y);
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(point, polygon = []) {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  const x = finite(point?.x);
  const y = finite(point?.y);
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = finite(polygon[i]?.x); const yi = finite(polygon[i]?.y);
    const xj = finite(polygon[j]?.x); const yj = finite(polygon[j]?.y);
    const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / ((yj - yi) || EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function normalizeSceneRegion(input = {}, index = 0, options = {}) {
  const rawPoints = input.points == null ? [] : input.points;
  if (!Array.isArray(rawPoints)) throw elevationError('region.points precisa ser uma lista.', 'SCENE_REGION_POINTS_INVALID');
  if (rawPoints.length < 3) throw elevationError('Região precisa de pelo menos 3 pontos.', 'SCENE_REGION_TOO_SMALL');
  if (rawPoints.length > MAX_REGION_POINTS) throw elevationError(`Região aceita no máximo ${MAX_REGION_POINTS} pontos.`, 'SCENE_REGION_POINT_LIMIT', 413);
  const points = rawPoints.map((point) => normalizeRegionPoint(point, options));
  if (polygonArea(points) < 1) throw elevationError('Polígono da região não possui área útil.', 'SCENE_REGION_DEGENERATE');
  const kind = normalizeRegionKind(input.kind);
  const baseElevation = normalizeElevationValue(input.baseElevation ?? input.elevation, 0);
  let axis = null;
  if (kind !== SceneRegionKind.FLOOR) {
    const start = normalizeRegionPoint(input.axis?.start ?? points[0], options);
    const end = normalizeRegionPoint(input.axis?.end ?? points[1], options);
    if (Math.hypot(end.x - start.x, end.y - start.y) < 1) throw elevationError('Eixo da escada/rampa precisa ter pelo menos 1px.', 'SCENE_REGION_AXIS_TOO_SHORT');
    axis = Object.freeze({ start, end });
  }
  return Object.freeze({
    id: text(input.id, 100) || options.idFactory?.() || `region-${index + 1}`,
    name: text(input.name, 160) || `Região ${index + 1}`,
    kind,
    enabled: input.enabled !== false,
    priority: Math.round(clamp(finite(input.priority, 0), -100, 100)),
    points: Object.freeze(points),
    baseElevation,
    targetElevation: kind === SceneRegionKind.FLOOR ? baseElevation : normalizeElevationValue(input.targetElevation, baseElevation),
    axis
  });
}

export function normalizeSceneRegions(input = [], options = {}) {
  const raw = input == null ? [] : input;
  if (!Array.isArray(raw)) throw elevationError('scene.regions precisa ser uma lista.', 'SCENE_REGIONS_INVALID');
  if (raw.length > MAX_REGIONS) throw elevationError(`Cena aceita no máximo ${MAX_REGIONS} regiões.`, 'SCENE_REGION_LIMIT', 413);
  const seen = new Set();
  const regions = raw.map((region, index) => {
    const normalized = normalizeSceneRegion(region, index, options);
    if (seen.has(normalized.id)) throw elevationError('IDs de regiões duplicados.', 'SCENE_REGION_ID_CONFLICT');
    seen.add(normalized.id);
    return normalized;
  });
  return Object.freeze(regions);
}

export function regionProgress(region, point) {
  if (!region?.axis) return 0;
  const { start, end } = region.axis;
  const dx = end.x - start.x; const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return 0;
  return clamp(((finite(point?.x) - start.x) * dx + (finite(point?.y) - start.y) * dy) / lengthSquared, 0, 1);
}

export function regionElevationAtPoint(region, point) {
  if (!region) return null;
  if (region.kind === SceneRegionKind.FLOOR) return normalizeElevationValue(region.baseElevation, 0);
  const progress = regionProgress(region, point);
  return normalizeElevationValue(region.baseElevation + (region.targetElevation - region.baseElevation) * progress, region.baseElevation);
}

export function regionAtPoint(regions = [], point) {
  const matches = (Array.isArray(regions) ? regions : [])
    .filter((region) => region?.enabled !== false && pointInPolygon(point, region?.points ?? []))
    .map((region) => ({ region, area: polygonArea(region.points) }))
    .sort((first, second) => second.region.priority - first.region.priority || first.area - second.area || first.region.id.localeCompare(second.region.id));
  return matches[0]?.region ?? null;
}

export function resolveGroundElevation({ regions = [], point, fallbackElevation = 0 } = {}) {
  const region = regionAtPoint(regions, point);
  if (!region) return Object.freeze({ elevation: normalizeElevationValue(fallbackElevation, 0), regionId: null, regionKind: null, automatic: false, progress: null });
  return Object.freeze({
    elevation: regionElevationAtPoint(region, point),
    regionId: region.id,
    regionKind: region.kind,
    automatic: true,
    progress: region.kind === SceneRegionKind.FLOOR ? null : rounded(regionProgress(region, point))
  });
}

export function resolveGroundTransition({ regions = [], from, to, fallbackElevation = 0 } = {}) {
  const fromResolved = resolveGroundElevation({ regions, point: from, fallbackElevation });
  const toResolved = resolveGroundElevation({ regions, point: to, fallbackElevation: fromResolved.elevation });
  return Object.freeze({
    from: fromResolved,
    to: toResolved,
    changedRegion: fromResolved.regionId !== toResolved.regionId,
    changedElevation: Math.abs(fromResolved.elevation - toResolved.elevation) > EPSILON
  });
}
