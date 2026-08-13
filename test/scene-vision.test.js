import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneDoorState, SceneWallKind } from '../packages/scene-geometry/src/index.js';
import {
  computeVisibilityPolygon,
  hasLineOfSight,
  mergeExploredCells,
  normalizeSceneFog,
  visibleGridCells
} from '../packages/scene-vision/src/index.js';

function verticalBarrier(kind = SceneWallKind.WALL, doorState = null, overrides = {}) {
  return {
    id: 'barrier-1',
    kind,
    doorState,
    a: { x: 140, y: 0 },
    b: { x: 140, y: 280 },
    ...overrides
  };
}

test('LOS é bloqueado por parede e porta fechada, mas atravessa porta aberta', () => {
  const origin = { x: 70, y: 105 };
  const target = { x: 210, y: 105 };
  assert.equal(hasLineOfSight(origin, target, [verticalBarrier()]), false);
  assert.equal(hasLineOfSight(origin, target, [verticalBarrier(SceneWallKind.DOOR, SceneDoorState.CLOSED)]), false);
  assert.equal(hasLineOfSight(origin, target, [verticalBarrier(SceneWallKind.DOOR, SceneDoorState.LOCKED)]), false);
  assert.equal(hasLineOfSight(origin, target, [verticalBarrier(SceneWallKind.DOOR, SceneDoorState.OPEN)]), true);
});

test('células exploradas respeitam paredes e alcance configurado', () => {
  const cells = visibleGridCells({
    origin: { x: 70, y: 105 },
    walls: [verticalBarrier()],
    grid: { size: 70, offsetX: 0, offsetY: 0 },
    sceneWidth: 420,
    sceneHeight: 280,
    visionRangeCells: 4
  });
  assert.ok(cells.includes('0:1'));
  assert.ok(cells.includes('1:1'));
  assert.equal(cells.includes('2:1'), false);
  assert.equal(cells.includes('3:1'), false);
});

test('visibility polygon é limitado pelo alcance e pelo primeiro obstáculo', () => {
  const origin = { x: 70, y: 140 };
  const polygon = computeVisibilityPolygon({
    origin,
    walls: [verticalBarrier()],
    sceneWidth: 420,
    sceneHeight: 280,
    maxDistance: 210,
    raySteps: 48
  });
  assert.ok(polygon.length >= 48);
  assert.ok(polygon.every((point) => Math.hypot(point.x - origin.x, point.y - origin.y) <= 210.01));
  const eastMost = Math.max(...polygon.filter((point) => Math.abs(point.y - origin.y) < 3).map((point) => point.x));
  assert.ok(eastMost <= 140.1);
});

test('LOS vertical enxerga acima de uma parede finita mas continua bloqueado na mesma altura', () => {
  const wall = verticalBarrier(SceneWallKind.WALL, null, { bottomElevation: 0, topElevation: 3 });
  const origin = { x: 70, y: 105 };
  const target = { x: 210, y: 105 };
  assert.equal(hasLineOfSight(origin, target, [wall], {
    verticalEnabled: true,
    originElevation: 1,
    targetElevation: 1
  }), false);
  assert.equal(hasLineOfSight(origin, target, [wall], {
    verticalEnabled: true,
    originElevation: 5,
    targetElevation: 5
  }), true);
});

test('raio vertical interpolado é bloqueado quando cruza a faixa da parede durante a descida', () => {
  const wall = verticalBarrier(SceneWallKind.WALL, null, { bottomElevation: 0, topElevation: 3 });
  assert.equal(hasLineOfSight(
    { x: 70, y: 105 },
    { x: 210, y: 105 },
    [wall],
    {
      verticalEnabled: true,
      originElevation: 5,
      targetElevation: 0
    }
  ), false, 'no cruzamento x=140 o raio está em Z=2.5 e deve ser ocluído');
});

test('visibility polygon em Z acima do topo não é recortado pela parede finita', () => {
  const origin = { x: 70, y: 140 };
  const wall = verticalBarrier(SceneWallKind.WALL, null, { bottomElevation: 0, topElevation: 3 });
  const polygon = computeVisibilityPolygon({
    origin,
    walls: [wall],
    sceneWidth: 420,
    sceneHeight: 280,
    maxDistance: 210,
    raySteps: 48,
    verticalEnabled: true,
    elevation: 5
  });
  const eastMost = Math.max(...polygon.filter((point) => Math.abs(point.y - origin.y) < 4).map((point) => point.x));
  assert.ok(eastMost > 140.1, `visão em Z=5 deveria passar sobre parede Z=0..3: ${eastMost}`);
});

test('Fog em elevação alta descobre células atrás de parede baixa', () => {
  const wall = verticalBarrier(SceneWallKind.WALL, null, { bottomElevation: 0, topElevation: 3 });
  const cells = visibleGridCells({
    origin: { x: 70, y: 105 },
    walls: [wall],
    grid: { size: 70, offsetX: 0, offsetY: 0 },
    sceneWidth: 420,
    sceneHeight: 280,
    visionRangeCells: 4,
    verticalEnabled: true,
    originElevation: 5,
    targetElevation: 5
  });
  assert.ok(cells.includes('2:1'));
  assert.ok(cells.includes('3:1'));
});

test('configuração do Fog é normalizada e exploração é deduplicada', () => {
  assert.deepEqual(normalizeSceneFog({
    enabled: true,
    visionRangeCells: 999,
    exploredOpacity: 0.8,
    unexploredOpacity: 0.2
  }), {
    enabled: true,
    visionRangeCells: 60,
    exploredOpacity: 0.8,
    unexploredOpacity: 0.8
  });
  assert.deepEqual([...mergeExploredCells(['1:1', '2:1'], ['2:1', '3:1'])], ['1:1', '2:1', '3:1']);
});
