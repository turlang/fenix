import { computeVisibilityPolygon, hasLineOfSight } from '../../scene-vision/src/index.js';
import { normalizeElevationValue } from '../../scene-elevation/src/index.js';

const MAX_LIGHT_SOURCES = 128;
const DEFAULT_COLOR = '#f2c66f';

function lightingError(message, code, statusCode = 400) {
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

function text(value, max = 160) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function color(value) {
  const candidate = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toLowerCase() : DEFAULT_COLOR;
}

function sourceId(value, idFactory) {
  const candidate = text(value, 120);
  if (candidate) return candidate;
  const generated = typeof idFactory === 'function' ? text(idFactory(), 120) : '';
  if (!generated) throw lightingError('Fonte de luz sem id.', 'SCENE_LIGHT_ID_REQUIRED');
  return generated;
}

export function normalizeLightSource(input = {}, {
  sceneWidth = 20_000,
  sceneHeight = 20_000,
  idFactory = null
} = {}) {
  const width = Math.max(1, finite(sceneWidth, 20_000));
  const height = Math.max(1, finite(sceneHeight, 20_000));
  return Object.freeze({
    id: sourceId(input.id, idFactory),
    name: text(input.name, 120) || 'Luz',
    enabled: input.enabled !== false,
    x: Math.round(clamp(finite(input.x), 0, width) * 100) / 100,
    y: Math.round(clamp(finite(input.y), 0, height) * 100) / 100,
    elevation: normalizeElevationValue(input.elevation, 0),
    radiusCells: Math.round(clamp(finite(input.radiusCells, 6), 1, 60)),
    intensity: Math.round(clamp(finite(input.intensity, 1), 0.1, 1) * 100) / 100,
    color: color(input.color),
    attachedTokenId: text(input.attachedTokenId, 200) || null
  });
}

export function normalizeSceneLighting(input = {}, options = {}) {
  const rawSources = input.sources == null ? [] : input.sources;
  if (!Array.isArray(rawSources)) throw lightingError('lighting.sources precisa ser uma lista.', 'SCENE_LIGHT_SOURCES_INVALID');
  if (rawSources.length > MAX_LIGHT_SOURCES) {
    throw lightingError(`Uma cena aceita no máximo ${MAX_LIGHT_SOURCES} fontes de luz.`, 'SCENE_LIGHT_SOURCE_LIMIT', 413);
  }
  const seen = new Set();
  const sources = rawSources.map((source) => {
    const normalized = normalizeLightSource(source, options);
    if (seen.has(normalized.id)) throw lightingError('IDs de fontes de luz duplicados.', 'SCENE_LIGHT_ID_CONFLICT');
    seen.add(normalized.id);
    return normalized;
  });
  return Object.freeze({
    enabled: input.enabled === true,
    darkness: Math.round(clamp(finite(input.darkness, 0.78), 0, 0.98) * 100) / 100,
    sources: Object.freeze(sources)
  });
}

export function resolveLightOrigin(source, tokens = []) {
  if (source?.attachedTokenId) {
    const token = (Array.isArray(tokens) ? tokens : []).find((item) => item?.id === source.attachedTokenId);
    if (token) return Object.freeze({
      x: finite(token.x),
      y: finite(token.y),
      elevation: normalizeElevationValue(token.elevation, source?.elevation ?? 0)
    });
  }
  return Object.freeze({
    x: finite(source?.x),
    y: finite(source?.y),
    elevation: normalizeElevationValue(source?.elevation, 0)
  });
}

export function computeSceneLightPolygons({
  lighting: lightingInput = {},
  walls = [],
  grid = {},
  sceneWidth,
  sceneHeight,
  tokens = [],
  verticalEnabled = false
} = {}) {
  const lighting = normalizeSceneLighting(lightingInput, { sceneWidth, sceneHeight, idFactory: () => 'preview-light' });
  if (!lighting.enabled) return Object.freeze([]);
  const gridSize = Math.max(1, finite(grid.size, 70));
  return Object.freeze(lighting.sources.filter((source) => source.enabled).map((source) => {
    const origin = resolveLightOrigin(source, tokens);
    const radius = source.radiusCells * gridSize;
    const polygon = computeVisibilityPolygon({
      origin,
      walls,
      sceneWidth,
      sceneHeight,
      maxDistance: radius,
      verticalEnabled,
      elevation: origin.elevation
    });
    return Object.freeze({
      source,
      origin,
      radius,
      polygon
    });
  }));
}

export function lightContributionAtPoint({
  source,
  point,
  tokens = [],
  walls = [],
  grid = {},
  verticalEnabled = false,
  pointElevation = 0
} = {}) {
  if (!source?.enabled) return 0;
  const origin = resolveLightOrigin(source, tokens);
  const gridSize = Math.max(1, finite(grid.size, 70));
  const radius = Math.max(1, finite(source.radiusCells, 6) * gridSize);
  const dx = finite(point?.x) - origin.x;
  const dy = finite(point?.y) - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > radius) return 0;
  if (!hasLineOfSight(origin, point, walls, {
    maxDistance: radius,
    verticalEnabled,
    originElevation: origin.elevation,
    targetElevation: pointElevation
  })) return 0;
  const falloff = 1 - distance / radius;
  return Math.round(clamp(falloff * finite(source.intensity, 1), 0, 1) * 1000) / 1000;
}
