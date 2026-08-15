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

export const VisionSense = Object.freeze({
  NORMAL: 'normal',
  DARKVISION: 'darkvision',
  LOW_LIGHT: 'low-light',
  BLINDSIGHT: 'blindsight',
  TREMORSENSE: 'tremorsense'
});

const MOVEMENT_MODES = new Set(Object.values(MovementMode));
const VISION_SENSES = new Set(Object.values(VisionSense));

function boundedText(value, max = 120, fallback = '') {
  return String(value ?? fallback).trim().slice(0, max);
}

function finiteNonNegative(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function finitePositive(value, fallback, min = 0.1, max = 1000) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeUnit(value, fallback = SceneDistanceUnit.METER) {
  return value === SceneDistanceUnit.FOOT ? SceneDistanceUnit.FOOT : fallback;
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

export function normalizeVisionProfile(input = {}) {
  const defaultUnit = normalizeUnit(input.unit, SceneDistanceUnit.METER);
  const senses = {};
  const rawSenses = input.senses && typeof input.senses === 'object' ? input.senses : {};

  for (const sense of VISION_SENSES) {
    const raw = rawSenses[sense];
    if (raw == null) continue;
    if (typeof raw === 'number') {
      senses[sense] = Object.freeze({ distance: finiteNonNegative(raw), unit: defaultUnit, enabled: raw > 0 });
      continue;
    }
    const unit = normalizeUnit(raw?.unit, defaultUnit);
    const distance = finiteNonNegative(raw?.distance ?? raw?.range, 0);
    senses[sense] = Object.freeze({
      distance,
      unit,
      enabled: raw?.enabled !== false && distance > 0
    });
  }

  if (!senses[VisionSense.NORMAL]) {
    const legacyDistance = finiteNonNegative(input.distance ?? input.range ?? input.normalRange, 0);
    senses[VisionSense.NORMAL] = Object.freeze({
      distance: legacyDistance,
      unit: defaultUnit,
      enabled: input.enabled !== false && legacyDistance > 0
    });
  }

  const preferredSenseRaw = boundedText(input.preferredSense ?? input.mode, 40).toLowerCase();
  const preferredSense = VISION_SENSES.has(preferredSenseRaw)
    ? preferredSenseRaw
    : VisionSense.NORMAL;

  return Object.freeze({
    enabled: input.enabled !== false,
    eyeHeight: finitePositive(input.eyeHeight, 1.6, 0.1, 20),
    preferredSense,
    senses: Object.freeze(senses),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });
}

export function effectiveVisionRange({ profile, sceneScale, sense = null } = {}) {
  const normalized = normalizeVisionProfile(profile);
  const selectedSense = VISION_SENSES.has(sense) ? sense : normalized.preferredSense;
  const selected = normalized.senses[selectedSense] ?? normalized.senses[VisionSense.NORMAL];
  const scale = normalizeSceneScale(sceneScale);
  if (!normalized.enabled || !selected?.enabled || selected.distance <= 0) {
    return Object.freeze({ sense: selectedSense, distance: 0, unit: scale.unit, cells: 0 });
  }
  const distance = convertDistance(selected.distance, selected.unit, scale.unit);
  return Object.freeze({
    sense: selectedSense,
    distance,
    unit: scale.unit,
    cells: distanceToCells(distance, scale, { rounding: 'none' })
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
      return normalizeVisionProfile(resolveVisionProfile(input));
    },
    resolveTokenFootprint: typeof resolveTokenFootprint === 'function'
      ? (input) => Object.freeze({ ...(resolveTokenFootprint(input) ?? {}) })
      : null
  });
}

export function createGenericRpgSystemAdapter({ id = 'generic', version = '1' } = {}) {
  return createRpgSystemAdapter({
    id,
    version,
    resolveMovementProfile({ sheet = {} } = {}) {
      return sheet.movement ?? { unit: 'm', defaultMode: MovementMode.WALK, speeds: { walk: 9 } };
    },
    resolveVisionProfile({ sheet = {} } = {}) {
      return sheet.vision ?? {
        unit: 'm',
        eyeHeight: Number(sheet.height) > 0 ? Math.max(0.1, Number(sheet.height) * 0.9) : 1.6,
        senses: { normal: 12 }
      };
    },
    resolveTokenFootprint({ sheet = {} } = {}) {
      return sheet.footprint ?? { widthCells: 1, heightCells: 1 };
    }
  });
}
