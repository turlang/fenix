import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SceneRegionKind,
  TokenMovementMode,
  clampFlyingElevation,
  eyeElevation,
  levelForElevation,
  normalizeSceneElevation,
  normalizeSceneRegions,
  normalizeTokenVerticalProfile,
  pointInPolygon,
  regionElevationAtPoint,
  resolveGroundElevation,
  tokenVerticalBand,
  verticalBandsOverlap,
  wallContainsElevation,
  wallIntersectsVerticalBand
} from '../packages/scene-elevation/src/index.js';

test('configuração vertical normaliza níveis, passo e faixa padrão de paredes', () => {
  const config = normalizeSceneElevation({
    enabled: true,
    unit: 'm',
    levelHeight: 3,
    verticalStep: 1,
    defaultWallBottom: 0,
    defaultWallTop: 3,
    levels: [
      { id: 'ground', name: 'Térreo', elevation: 0 },
      { id: 'bridge', name: 'Ponte', elevation: 4 }
    ]
  });
  assert.equal(config.enabled, true);
  assert.equal(config.levels.length, 2);
  assert.equal(levelForElevation(config, 3.7).id, 'bridge');
});

test('perfil vertical distingue solo e voo e calcula altura dos olhos', () => {
  const flying = normalizeTokenVerticalProfile({ elevation: 4, height: 2, movementMode: 'flying' });
  const ground = normalizeTokenVerticalProfile({ movementMode: 'invalid' });
  assert.equal(flying.movementMode, TokenMovementMode.FLYING);
  assert.equal(ground.movementMode, TokenMovementMode.GROUND);
  assert.equal(eyeElevation(flying), 5.8);
});

test('faixas verticais só se bloqueiam quando realmente se sobrepõem', () => {
  const wall = { bottomElevation: 0, topElevation: 3 };
  assert.equal(wallIntersectsVerticalBand(wall, tokenVerticalBand({ elevation: 0, height: 1.8 })), true);
  assert.equal(wallIntersectsVerticalBand(wall, tokenVerticalBand({ elevation: 3, height: 1.8 })), false);
  assert.equal(wallContainsElevation(wall, 1.5), true);
  assert.equal(wallContainsElevation(wall, 5), false);
  assert.equal(verticalBandsOverlap({ bottom: 0, top: 2 }, { bottom: 2, top: 4 }), false);
});

test('voo limita a alteração de Z a um passo por comando', () => {
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: 50, verticalStep: 1 }), 5);
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: -50, verticalStep: 1 }), 3);
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: 4.5, verticalStep: 1 }), 4.5);
});

const regionPoints = Object.freeze([
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 }
]);

test('região de piso fixa Z e reconhece ponto interno', () => {
  const [floor] = normalizeSceneRegions([{
    id: 'floor-0',
    name: 'Térreo',
    kind: SceneRegionKind.FLOOR,
    points: regionPoints,
    baseElevation: 0
  }], { sceneWidth: 300, sceneHeight: 200 });
  assert.equal(pointInPolygon({ x: 50, y: 50 }, floor.points), true);
  assert.equal(pointInPolygon({ x: 150, y: 50 }, floor.points), false);
  assert.equal(regionElevationAtPoint(floor, { x: 50, y: 50 }), 0);
});

test('rampa interpola Z entre início e fim', () => {
  const [ramp] = normalizeSceneRegions([{
    id: 'ramp-0',
    kind: SceneRegionKind.RAMP,
    points: regionPoints,
    baseElevation: 0,
    targetElevation: 4,
    axis: { start: { x: 0, y: 50 }, end: { x: 100, y: 50 } }
  }], { sceneWidth: 300, sceneHeight: 200 });
  assert.equal(regionElevationAtPoint(ramp, { x: 0, y: 50 }), 0);
  assert.equal(regionElevationAtPoint(ramp, { x: 50, y: 50 }), 2);
  assert.equal(regionElevationAtPoint(ramp, { x: 100, y: 50 }), 4);
});

test('prioridade escolhe região sobreposta para elevação automática', () => {
  const regions = normalizeSceneRegions([
    { id: 'base', kind: 'floor', priority: 0, points: regionPoints, baseElevation: 0 },
    { id: 'top', kind: 'floor', priority: 10, points: regionPoints, baseElevation: 7 }
  ], { sceneWidth: 300, sceneHeight: 200 });
  const result = resolveGroundElevation({ regions, point: { x: 50, y: 50 }, fallbackElevation: 0 });
  assert.equal(result.regionId, 'top');
  assert.equal(result.elevation, 7);
});
