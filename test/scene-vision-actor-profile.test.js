import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLineOfSight,
  resolveVisionForScene,
  visibleGridCells
} from '../packages/scene-vision/src/index.js';

const wall = Object.freeze({
  id: 'wall-low',
  kind: 'wall',
  a: { x: 150, y: 0 },
  b: { x: 150, y: 300 },
  bottomElevation: 0,
  topElevation: 3
});

test('dois atores na mesma cena podem ter alcances diferentes', () => {
  const grid = { size: 50, offsetX: 0, offsetY: 0 };
  const scale = { distancePerCell: 1.5, unit: 'm' };
  const near = resolveVisionForScene({
    visionProfile: { unit: 'm', eyeHeight: 1.6, senses: { normal: 6 } },
    sceneScale: scale,
    grid
  });
  const far = resolveVisionForScene({
    visionProfile: { unit: 'm', eyeHeight: 1.6, senses: { normal: 18 } },
    sceneScale: scale,
    grid
  });

  assert.equal(near.cells, 4);
  assert.equal(far.cells, 12);
  assert.equal(near.source, 'actor-sheet');
  assert.equal(far.source, 'actor-sheet');
});

test('linha de visão usa altura dos olhos contra faixa vertical da parede', () => {
  assert.equal(hasLineOfSight(
    { x: 50, y: 100 },
    { x: 250, y: 100 },
    [wall],
    { elevationEnabled: true, originElevation: 1.6, targetElevation: 1.6 }
  ), false);

  assert.equal(hasLineOfSight(
    { x: 50, y: 100 },
    { x: 250, y: 100 },
    [wall],
    { elevationEnabled: true, originElevation: 4.6, targetElevation: 4.6 }
  ), true);
});

test('células visíveis usam perfil da ficha e elevação do ator', () => {
  const common = {
    origin: { x: 75, y: 125 },
    walls: [wall],
    grid: { size: 50, offsetX: 0, offsetY: 0 },
    sceneWidth: 400,
    sceneHeight: 300,
    sceneScale: { distancePerCell: 1.5, unit: 'm' },
    visionProfile: { unit: 'm', eyeHeight: 1.6, senses: { normal: 12 } },
    elevationEnabled: true
  };

  const ground = visibleGridCells({ ...common, originElevation: 0 });
  const flying = visibleGridCells({ ...common, originElevation: 4 });
  assert.ok(flying.length > ground.length, `${flying.length} deve superar ${ground.length}`);
});

test('fallback legado continua disponível durante migração', () => {
  const resolved = resolveVisionForScene({ grid: { size: 70 }, legacyVisionRangeCells: 8 });
  assert.equal(resolved.source, 'legacy-fog');
  assert.equal(resolved.cells, 8);
});
