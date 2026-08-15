export const SceneDistanceUnit = Object.freeze({
  METER: 'm',
  FOOT: 'ft'
});

function finitePositive(value, fallback, { min = 0.01, max = 100000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeUnit(value) {
  return value === SceneDistanceUnit.FOOT ? SceneDistanceUnit.FOOT : SceneDistanceUnit.METER;
}

export function normalizeSceneScale(input = {}) {
  const source = input?.scale && typeof input.scale === 'object' ? input.scale : input;
  return Object.freeze({
    distancePerCell: finitePositive(source?.distancePerCell, 1.5, { min: 0.01, max: 10000 }),
    unit: normalizeUnit(source?.unit ?? source?.distanceUnit)
  });
}

export function convertDistance(value, fromUnit, toUnit) {
  const distance = Number(value);
  if (!Number.isFinite(distance)) throw new TypeError('Distância precisa ser numérica.');
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (from === to) return distance;
  if (from === SceneDistanceUnit.FOOT && to === SceneDistanceUnit.METER) return distance * 0.3048;
  return distance / 0.3048;
}

export function cellsToDistance(cells, scaleInput = {}) {
  const scale = normalizeSceneScale(scaleInput);
  const count = Number(cells);
  if (!Number.isFinite(count)) throw new TypeError('Quantidade de células precisa ser numérica.');
  return count * scale.distancePerCell;
}

export function distanceToCells(distance, scaleInput = {}, { rounding = 'none' } = {}) {
  const scale = normalizeSceneScale(scaleInput);
  const value = Number(distance);
  if (!Number.isFinite(value)) throw new TypeError('Distância precisa ser numérica.');
  const cells = value / scale.distancePerCell;
  if (rounding === 'floor') return Math.floor(cells);
  if (rounding === 'ceil') return Math.ceil(cells);
  if (rounding === 'round') return Math.round(cells);
  return cells;
}
