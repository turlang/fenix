import {
  SceneDistanceUnit,
  convertDistance,
  distanceToCells,
  normalizeSceneScale
} from '../../scene-scale/src/index.js';

export const MovementMode = Object.freeze({
  WALK: 'walk',
  RUN: 'run',
  MARCH: 'march',
  SWIM: 'swim',
  FLY: 'fly',
  CLIMB: 'climb',
  BURROW: 'burrow'
});

const MOVEMENT_MODES = new Set(Object.values(MovementMode));

function boundedText(value, max = 120, fallback = '') {
  return String(value ?? fallback).trim().slice(0, max);
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function normalizeMovementMode(value, fallback = MovementMode.WALK) {
  const mode = boundedText(value, 40).toLowerCase();
  return MOVEMENT_MODES.has(mode) ? mode : fallback;
}

export function normalizeMovementProfile(input = {}) {
  const defaultUnit = input.unit === SceneDistanceUnit.FOOT ? SceneDistanceUnit.FOOT : SceneDistanceUnit.METER;
  const speeds = {};
  for (const mode of MOVEMENT_MODES) {
    const raw = input.speeds?.[mode];
    if (raw == null) continue;
    if (typeof raw === 'number') {
      speeds[mode] = Object.freeze({ distance: finiteNonNegative(raw), unit: defaultUnit });
      continue;
    }
    speeds[mode] = Object.freeze({
      distance: finiteNonNegative(raw?.distance),
      unit: raw?.unit === SceneDistanceUnit.FOOT ? SceneDistanceUnit.FOOT : SceneDistanceUnit.METER
    });
  }
  return Object.freeze({
    speeds: Object.freeze(speeds),
    defaultMode: normalizeMovementMode(input.defaultMode),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });
}

export function movementBudgetInCells({ profile, mode, sceneScale, rounding = 'none' } = {}) {
  const normalizedProfile = normalizeMovementProfile(profile);
  const selectedMode = normalizeMovementMode(mode, normalizedProfile.defaultMode);
  const speed = normalizedProfile.speeds[selectedMode];
  if (!speed) return Object.freeze({ mode: selectedMode, distance: 0, unit: normalizeSceneScale(sceneScale).unit, cells: 0 });

  const scale = normalizeSceneScale(sceneScale);
  const distance = convertDistance(speed.distance, speed.unit, scale.unit);
  return Object.freeze({
    mode: selectedMode,
    distance,
    unit: scale.unit,
    cells: distanceToCells(distance, scale, { rounding })
  });
}

export function createRpgSystemAdapter({
  id,
  version = '1',
  resolveMovementProfile,
  resolveVisionProfile,
  resolveTokenFootprint = null
} = {}) {
  const systemId = boundedText(id, 120);
  if (!systemId) throw new TypeError('id do sistema é obrigatório.');
  if (typeof resolveMovementProfile !== 'function') {
    throw new TypeError('resolveMovementProfile é obrigatório.');
  }
  if (typeof resolveVisionProfile !== 'function') {
    throw new TypeError('resolveVisionProfile é obrigatório.');
  }

  return Object.freeze({
    id: systemId,
    version: boundedText(version, 40, '1') || '1',
    resolveMovementProfile(input) {
      return normalizeMovementProfile(resolveMovementProfile(input));
    },
    resolveVisionProfile(input) {
      const result = resolveVisionProfile(input) ?? {};
      return Object.freeze({ ...result });
    },
    resolveTokenFootprint: typeof resolveTokenFootprint === 'function'
      ? (input) => Object.freeze({ ...(resolveTokenFootprint(input) ?? {}) })
      : null
  });
}
