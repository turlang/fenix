import { convertDistance, normalizeSceneScale } from '../../scene-scale/src/index.js';
import { normalizePlayerInputIntent } from '../../render-stream-contract/src/index.js';

function adapterError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function rounded(value, precision = 1000) {
  return Math.round(finite(value) * precision) / precision;
}

function clone(value, fallback) {
  return structuredClone(value == null ? fallback : value);
}

function ensureBootstrap(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw adapterError('World Bootstrap é obrigatório.', 'FENIX_3D_BOOTSTRAP_REQUIRED');
  }
  if (input.schema !== 'fenix.render-world-bootstrap' || Number(input.version) !== 1) {
    throw adapterError('World Bootstrap incompatível.', 'FENIX_3D_BOOTSTRAP_UNSUPPORTED');
  }
  return input;
}

function distanceToMeters(value, unit) {
  return convertDistance(finite(value), unit === 'ft' ? 'ft' : 'm', 'm');
}

function elevationUnit(bootstrap) {
  const candidate = bootstrap.scene?.physical?.elevation?.unit;
  return candidate === 'ft' ? 'ft' : bootstrap.scene?.grid?.scale?.unit === 'ft' ? 'ft' : 'm';
}

function sceneScale(bootstrap) {
  return normalizeSceneScale(bootstrap.scene?.grid?.scale ?? {});
}

function runtimeCentimetersPerPixel(bootstrap) {
  const scale = sceneScale(bootstrap);
  const gridSize = Math.max(1, finite(bootstrap.scene?.grid?.size, 70));
  return distanceToMeters(scale.distancePerCell, scale.unit) * 100 / gridSize;
}

function toRuntimePoint(point = {}, bootstrap, elevation = 0) {
  const cmPerPixel = runtimeCentimetersPerPixel(bootstrap);
  const zUnit = elevationUnit(bootstrap);
  return Object.freeze({
    x: rounded(finite(point.x) * cmPerPixel),
    // O canvas Fênix cresce para baixo. O runtime 3D usa Y positivo para cima no plano do mapa.
    y: rounded(-finite(point.y) * cmPerPixel),
    z: rounded(distanceToMeters(elevation, zUnit) * 100)
  });
}

function runtimeElevationCm(value, bootstrap) {
  return rounded(distanceToMeters(value, elevationUnit(bootstrap)) * 100);
}

function wallVerticalRange(wall, bootstrap) {
  const config = bootstrap.scene?.physical?.elevation ?? {};
  const enabled = config.enabled === true;
  let bottom = finite(wall?.bottomElevation, finite(config.defaultWallBottom, 0));
  let top = finite(wall?.topElevation, finite(config.defaultWallTop, bottom + finite(config.levelHeight, 3)));

  // O contrato 2D legado usa -1000/+10000 como faixa infinita. No mundo 3D isso
  // vira a parede física padrão da cena, não um objeto de quilômetros de altura.
  if (!enabled || bottom <= -999 || top >= 9999) {
    bottom = finite(config.defaultWallBottom, 0);
    top = finite(config.defaultWallTop, bottom + finite(config.levelHeight, 3));
  }
  if (top <= bottom) top = bottom + Math.max(0.1, finite(config.levelHeight, 3));
  return Object.freeze({ bottom, top });
}

function runtimeWall(wall, bootstrap, index) {
  const vertical = wallVerticalRange(wall, bootstrap);
  const kind = wall?.kind === 'door' ? 'door' : 'wall';
  const doorState = kind === 'door' ? text(wall?.doorState, 40) || 'closed' : null;
  const open = kind === 'door' && doorState === 'open';
  return Object.freeze({
    id: text(wall?.id, 120) || `wall-${index + 1}`,
    kind,
    doorState,
    blocksMovement: !open,
    blocksVision: !open,
    a: toRuntimePoint(wall?.a ?? {}, bootstrap, vertical.bottom),
    b: toRuntimePoint(wall?.b ?? {}, bootstrap, vertical.bottom),
    bottomZ: runtimeElevationCm(vertical.bottom, bootstrap),
    topZ: runtimeElevationCm(vertical.top, bootstrap),
    heightCm: rounded(runtimeElevationCm(vertical.top - vertical.bottom, bootstrap)),
    recommendedThicknessCm: 10
  });
}

function runtimeRegion(region, bootstrap, index) {
  const kind = ['floor', 'stairs', 'ramp'].includes(region?.kind) ? region.kind : 'floor';
  const baseElevation = finite(region?.baseElevation, 0);
  const targetElevation = finite(region?.targetElevation, baseElevation);
  const points = (Array.isArray(region?.points) ? region.points : [])
    .map((point) => toRuntimePoint(point, bootstrap, baseElevation));
  const axis = region?.axis ? Object.freeze({
    start: toRuntimePoint(region.axis.start ?? {}, bootstrap, baseElevation),
    end: toRuntimePoint(region.axis.end ?? {}, bootstrap, targetElevation)
  }) : null;
  return Object.freeze({
    id: text(region?.id, 120) || `region-${index + 1}`,
    name: text(region?.name, 200) || `Region ${index + 1}`,
    kind,
    enabled: region?.enabled !== false,
    priority: Math.round(finite(region?.priority, 0)),
    baseZ: runtimeElevationCm(baseElevation, bootstrap),
    targetZ: runtimeElevationCm(targetElevation, bootstrap),
    points: Object.freeze(points),
    axis
  });
}

function runtimeLevel(level, bootstrap, index) {
  const elevation = finite(level?.elevation, 0);
  return Object.freeze({
    id: text(level?.id, 120) || `level-${index + 1}`,
    name: text(level?.name, 160) || `Level ${index + 1}`,
    elevationCm: runtimeElevationCm(elevation, bootstrap)
  });
}

function tokenHeightCm(token, bootstrap) {
  const height = Math.max(0.1, finite(token?.height, 1.8));
  // Token/Actor height is authored in metres in the Actor contract.
  return rounded(height * 100);
}

function runtimeToken(token, bootstrap, viewerTokenId) {
  const tokenId = text(token?.tokenId ?? token?.id);
  const cmPerPixel = runtimeCentimetersPerPixel(bootstrap);
  const location = toRuntimePoint(token, bootstrap, finite(token?.elevation, 0));
  return Object.freeze({
    tokenId,
    actorId: text(token?.actorId) || null,
    sheetId: text(token?.sheetId) || null,
    systemId: text(token?.systemId, 120) || null,
    name: text(token?.name, 200) || tokenId,
    kind: text(token?.kind, 60) || 'character',
    image: text(token?.image, 2000) || null,
    viewer: tokenId === viewerTokenId,
    visible: token?.visible !== false && token?.hidden !== true,
    transform: Object.freeze({
      location,
      sceneRotationDegrees: rounded(finite(token?.rotation, 0)),
      scale: Object.freeze({ x: 1, y: 1, z: 1 })
    }),
    dimensions: Object.freeze({
      footprintCm: rounded(Math.max(1, finite(token?.size, 80)) * cmPerPixel),
      heightCm: tokenHeightCm(token, bootstrap)
    }),
    movementMode: text(token?.movementMode, 40) || 'ground'
  });
}

function runtimeLight(source, bootstrap, tokens) {
  const cmPerPixel = runtimeCentimetersPerPixel(bootstrap);
  const attached = source?.attachedTokenId
    ? tokens.find((token) => token.tokenId === source.attachedTokenId) ?? null
    : null;
  const origin = attached?.transform?.location ?? toRuntimePoint(source, bootstrap, 0);
  const gridSize = Math.max(1, finite(bootstrap.scene?.grid?.size, 70));
  return Object.freeze({
    id: text(source?.id, 120),
    name: text(source?.name, 160) || 'Light',
    enabled: source?.enabled !== false,
    color: /^#[0-9a-fA-F]{6}$/.test(String(source?.color ?? '')) ? String(source.color).toLowerCase() : '#f2c66f',
    intensity: clamp(finite(source?.intensity, 1), 0, 1),
    radiusCm: rounded(Math.max(0, finite(source?.radiusCells, 6)) * gridSize * cmPerPixel),
    attachedTokenId: text(source?.attachedTokenId) || null,
    location: origin
  });
}

function runtimeCamera(bootstrap) {
  const camera = bootstrap.viewer?.camera ?? {};
  const token = bootstrap.viewer?.token ?? {};
  return Object.freeze({
    mode: 'first-person',
    location: toRuntimePoint({ x: camera.sceneX, y: camera.sceneY }, bootstrap, finite(camera.elevation, 0)),
    sceneRotationDegrees: rounded(finite(token.rotation, 0)),
    pitchDegrees: 0,
    fovDegrees: 90,
    eyeHeightCm: rounded(distanceToMeters(camera.eyeHeight, camera.unit === 'ft' ? 'ft' : 'm') * 100),
    preferredSense: text(camera.preferredSense, 60) || 'normal',
    visionDistanceCm: rounded(distanceToMeters(camera.visionDistance, camera.unit === 'ft' ? 'ft' : 'm') * 100)
  });
}

export function createFenix3dRuntimeManifest(bootstrapInput = {}) {
  const bootstrap = ensureBootstrap(bootstrapInput);
  const viewerTokenId = text(bootstrap.viewer?.token?.tokenId ?? bootstrap.viewer?.token?.id);
  if (!viewerTokenId) throw adapterError('Viewer token ausente.', 'FENIX_3D_VIEWER_TOKEN_REQUIRED');

  const walls = (Array.isArray(bootstrap.scene?.physical?.walls) ? bootstrap.scene.physical.walls : [])
    .map((wall, index) => runtimeWall(wall, bootstrap, index));
  const regions = (Array.isArray(bootstrap.scene?.physical?.regions) ? bootstrap.scene.physical.regions : [])
    .map((region, index) => runtimeRegion(region, bootstrap, index));
  const levels = (Array.isArray(bootstrap.scene?.physical?.elevation?.levels) ? bootstrap.scene.physical.elevation.levels : [])
    .map((level, index) => runtimeLevel(level, bootstrap, index));
  const tokens = (Array.isArray(bootstrap.tokens) ? bootstrap.tokens : [])
    .filter((token) => text(token?.tokenId ?? token?.id))
    .map((token) => runtimeToken(token, bootstrap, viewerTokenId));
  if (!tokens.some((token) => token.tokenId === viewerTokenId)) {
    tokens.push(runtimeToken(bootstrap.viewer.token, bootstrap, viewerTokenId));
  }
  const lighting = bootstrap.scene?.physical?.lighting ?? {};
  const lights = (Array.isArray(lighting.sources) ? lighting.sources : [])
    .map((source) => runtimeLight(source, bootstrap, tokens));

  const cmPerPixel = runtimeCentimetersPerPixel(bootstrap);
  return Object.freeze({
    schema: 'fenix.3d-runtime-manifest',
    version: 1,
    sourceBootstrapVersion: Number(bootstrap.version),
    createdAt: new Date(bootstrap.createdAt ?? Date.now()).toISOString(),
    campaign: Object.freeze(clone(bootstrap.campaign, {})),
    scene: Object.freeze({
      id: text(bootstrap.scene?.id),
      name: text(bootstrap.scene?.name, 300),
      dimensions: Object.freeze({
        widthPx: Math.max(1, finite(bootstrap.scene?.width, 1)),
        heightPx: Math.max(1, finite(bootstrap.scene?.height, 1)),
        widthCm: rounded(Math.max(1, finite(bootstrap.scene?.width, 1)) * cmPerPixel),
        heightCm: rounded(Math.max(1, finite(bootstrap.scene?.height, 1)) * cmPerPixel)
      }),
      units: Object.freeze({
        runtime: 'cm',
        scene: sceneScale(bootstrap).unit,
        centimetersPerPixel: rounded(cmPerPixel, 100000)
      }),
      coordinateSystem: Object.freeze({
        handedness: 'left',
        x: 'scene-right',
        y: 'scene-up-inverted-from-canvas',
        z: 'elevation-up'
      }),
      backgroundAssetId: text(bootstrap.scene?.backgroundAssetId) || null,
      darkness: clamp(finite(lighting.darkness, 0), 0, 1),
      lightingEnabled: lighting.enabled === true
    }),
    geometry: Object.freeze({
      walls: Object.freeze(walls),
      regions: Object.freeze(regions),
      levels: Object.freeze(levels)
    }),
    lights: Object.freeze(lights),
    entities: Object.freeze(tokens),
    viewer: Object.freeze({
      actorId: text(bootstrap.viewer?.actor?.actorId),
      tokenId: viewerTokenId,
      sheetId: text(bootstrap.viewer?.actor?.sheetId) || null,
      systemId: text(bootstrap.viewer?.actor?.systemId, 120) || 'generic',
      movement: Object.freeze(clone(bootstrap.viewer?.actor?.movement, {})),
      vision: Object.freeze(clone(bootstrap.viewer?.actor?.vision, {})),
      camera: runtimeCamera(bootstrap)
    }),
    fog: Object.freeze({
      enabled: bootstrap.scene?.fog?.enabled === true,
      exploredCells: Object.freeze([...(Array.isArray(bootstrap.scene?.fog?.exploredCells) ? bootstrap.scene.fog.exploredCells : [])])
    })
  });
}

const FORBIDDEN_INPUT_KEYS = new Set([
  'x', 'y', 'z', 'position', 'location', 'coordinates', 'transform',
  'teleport', 'elevation', 'actorId', 'tokenId', 'sceneId', 'campaignId'
]);

function rejectAuthoritativeFields(input) {
  for (const key of FORBIDDEN_INPUT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(input ?? {}, key)) {
      throw adapterError(`Runtime input não pode definir ${key}.`, 'FENIX_3D_INPUT_AUTHORITY_VIOLATION', 403);
    }
  }
}

export function normalizeFenix3dRuntimeInput(input = {}) {
  rejectAuthoritativeFields(input);
  const renderSessionId = text(input.renderSessionId);
  if (!renderSessionId) throw adapterError('renderSessionId é obrigatório.', 'FENIX_3D_RENDER_SESSION_REQUIRED');
  const intent = normalizePlayerInputIntent(input.intent ?? input);
  const sequence = Math.max(0, Math.floor(Number(input.sequence ?? intent.sequence) || 0));
  const clientTimeMs = Number.isFinite(Number(input.clientTimeMs)) ? Math.max(0, Number(input.clientTimeMs)) : null;
  return Object.freeze({
    schema: 'fenix.3d-runtime-input',
    version: 1,
    renderSessionId,
    sequence,
    clientTimeMs,
    intent: Object.freeze({ ...intent, sequence })
  });
}

export function projectRuntimeMovementIntent({ token, scene, input, yawDegrees = null } = {}) {
  const normalized = normalizeFenix3dRuntimeInput(input);
  if (normalized.intent.type !== 'move') {
    throw adapterError('Somente input move pode ser projetado em deslocamento.', 'FENIX_3D_MOVE_INTENT_REQUIRED');
  }
  const gridSize = Math.max(1, finite(scene?.grid?.size, 70));
  const stepPixels = gridSize * (normalized.intent.run ? 1 : 0.2);
  const forward = clamp(finite(normalized.intent.forward), -1, 1);
  const strafe = clamp(finite(normalized.intent.strafe), -1, 1);
  const magnitude = Math.hypot(forward, strafe);
  const normalizedForward = magnitude > 1 ? forward / magnitude : forward;
  const normalizedStrafe = magnitude > 1 ? strafe / magnitude : strafe;
  const yaw = finite(yawDegrees, finite(token?.rotation, 0));
  const radians = yaw * Math.PI / 180;

  // Forward 0° acompanha o eixo -Y do canvas (norte visual). Strafe positivo vai para a direita.
  const dx = (Math.sin(radians) * normalizedForward + Math.cos(radians) * normalizedStrafe) * stepPixels;
  const dy = (-Math.cos(radians) * normalizedForward + Math.sin(radians) * normalizedStrafe) * stepPixels;
  return Object.freeze({
    token: Object.freeze({
      ...clone(token, {}),
      x: rounded(finite(token?.x) + dx),
      y: rounded(finite(token?.y) + dy),
      rotation: rounded(yaw)
    }),
    requestedDelta: Object.freeze({ x: rounded(dx), y: rounded(dy) }),
    authoritative: false,
    sequence: normalized.sequence
  });
}

export function createFenix3dRuntimeStateSync({ renderSessionId, revision, token, collision = null, vertical = null } = {}) {
  const id = text(renderSessionId);
  if (!id) throw adapterError('renderSessionId é obrigatório.', 'FENIX_3D_RENDER_SESSION_REQUIRED');
  const tokenId = text(token?.tokenId ?? token?.id);
  if (!tokenId) throw adapterError('Token autoritativo é obrigatório.', 'FENIX_3D_SYNC_TOKEN_REQUIRED');
  return Object.freeze({
    schema: 'fenix.3d-runtime-state-sync',
    version: 1,
    renderSessionId: id,
    revision: Math.max(0, Math.floor(Number(revision) || 0)),
    token: Object.freeze({
      tokenId,
      actorId: text(token?.actorId) || null,
      x: finite(token?.x),
      y: finite(token?.y),
      elevation: finite(token?.elevation),
      rotation: finite(token?.rotation),
      movementMode: text(token?.movementMode, 40) || 'ground'
    }),
    collision: collision ? Object.freeze(clone(collision, {})) : null,
    vertical: vertical ? Object.freeze(clone(vertical, {})) : null
  });
}
