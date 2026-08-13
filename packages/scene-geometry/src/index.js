const MAX_COORDINATE = 1_000_000;
const MAX_WALLS = 2_000;
const MIN_ELEVATION = -1000;
const MAX_ELEVATION = 10000;

export const SceneWallKind = Object.freeze({
  WALL: 'wall',
  DOOR: 'door'
});

export const SceneDoorState = Object.freeze({
  OPEN: 'open',
  CLOSED: 'closed',
  LOCKED: 'locked'
});

const DOOR_STATES = new Set(Object.values(SceneDoorState));

function geometryError(message, code, statusCode = 400) {
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

function normalizePoint(input = {}, { width = MAX_COORDINATE, height = MAX_COORDINATE } = {}) {
  const x = clamp(finite(input.x), 0, Math.max(1, finite(width, MAX_COORDINATE)));
  const y = clamp(finite(input.y), 0, Math.max(1, finite(height, MAX_COORDINATE)));
  return Object.freeze({
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100
  });
}

function normalizeElevation(value, fallback) {
  return Math.round(clamp(finite(value, fallback), MIN_ELEVATION, MAX_ELEVATION) * 100) / 100;
}

function normalizeId(value, idFactory) {
  const candidate = String(value ?? '').trim().slice(0, 120);
  if (candidate) return candidate;
  const generated = typeof idFactory === 'function' ? String(idFactory() ?? '').trim().slice(0, 120) : '';
  if (!generated) throw geometryError('Segmento de parede sem id.', 'SCENE_WALL_ID_REQUIRED');
  return generated;
}

export function normalizeSceneWall(input = {}, {
  sceneWidth = MAX_COORDINATE,
  sceneHeight = MAX_COORDINATE,
  idFactory = null
} = {}) {
  const kind = input.kind === SceneWallKind.DOOR ? SceneWallKind.DOOR : SceneWallKind.WALL;
  const a = normalizePoint(input.a ?? { x: input.x1, y: input.y1 }, { width: sceneWidth, height: sceneHeight });
  const b = normalizePoint(input.b ?? { x: input.x2, y: input.y2 }, { width: sceneWidth, height: sceneHeight });
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 2) throw geometryError('Parede precisa ter pelo menos 2 px.', 'SCENE_WALL_TOO_SHORT');

  let doorState = null;
  if (kind === SceneWallKind.DOOR) {
    doorState = DOOR_STATES.has(input.doorState) ? input.doorState : SceneDoorState.CLOSED;
  }

  const rawBottom = input.bottomElevation ?? input.elevationBottom;
  const rawTop = input.topElevation ?? input.elevationTop;
  const first = normalizeElevation(rawBottom, MIN_ELEVATION);
  const second = normalizeElevation(rawTop, MAX_ELEVATION);
  const bottomElevation = Math.min(first, second);
  const topElevation = Math.max(first, second);
  if (topElevation - bottomElevation < 0.1) {
    throw geometryError('Faixa vertical da parede precisa ter pelo menos 0,1 unidade.', 'SCENE_WALL_VERTICAL_SPAN_TOO_SMALL');
  }

  return Object.freeze({
    id: normalizeId(input.id, idFactory),
    kind,
    a,
    b,
    doorState,
    bottomElevation,
    topElevation
  });
}

export function normalizeSceneWalls(input, options = {}) {
  if (input == null) return Object.freeze([]);
  if (!Array.isArray(input)) throw geometryError('walls precisa ser uma lista.', 'SCENE_WALLS_INVALID');
  if (input.length > MAX_WALLS) {
    throw geometryError(`Uma cena aceita no máximo ${MAX_WALLS} segmentos.`, 'SCENE_WALL_LIMIT_EXCEEDED', 413);
  }
  const seen = new Set();
  const walls = input.map((wall) => {
    const normalized = normalizeSceneWall(wall, options);
    if (seen.has(normalized.id)) throw geometryError('IDs de parede duplicados.', 'SCENE_WALL_ID_CONFLICT');
    seen.add(normalized.id);
    return normalized;
  });
  return Object.freeze(walls);
}

export function wallBlocksMovement(wall = {}) {
  return wall.kind !== SceneWallKind.DOOR || wall.doorState !== SceneDoorState.OPEN;
}

export function wallBlocksVision(wall = {}) {
  return wall.kind !== SceneWallKind.DOOR || wall.doorState !== SceneDoorState.OPEN;
}

export function pointToWallDistance(point = {}, wall = {}) {
  const px = finite(point.x);
  const py = finite(point.y);
  const ax = finite(wall.a?.x ?? wall.x1);
  const ay = finite(wall.a?.y ?? wall.y1);
  const bx = finite(wall.b?.x ?? wall.x2);
  const by = finite(wall.b?.y ?? wall.y2);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function snapScenePoint(point = {}, grid = {}) {
  const size = Math.max(1, finite(grid.size, 70));
  const offsetX = finite(grid.offsetX);
  const offsetY = finite(grid.offsetY);
  return Object.freeze({
    x: offsetX + Math.round((finite(point.x) - offsetX) / size) * size,
    y: offsetY + Math.round((finite(point.y) - offsetY) / size) * size
  });
}

export function cycleDoorState(value) {
  if (value === SceneDoorState.CLOSED) return SceneDoorState.OPEN;
  if (value === SceneDoorState.OPEN) return SceneDoorState.LOCKED;
  return SceneDoorState.CLOSED;
}
