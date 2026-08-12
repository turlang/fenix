import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SceneDoorState,
  SceneWallKind,
  cycleDoorState,
  normalizeSceneWalls,
  pointToWallDistance,
  snapScenePoint,
  wallBlocksMovement,
  wallBlocksVision
} from '../packages/scene-geometry/src/index.js';

test('scene geometry normaliza paredes e portas dentro dos limites da cena', () => {
  const walls = normalizeSceneWalls([
    { id: 'wall-1', kind: 'wall', a: { x: -5, y: 10 }, b: { x: 200, y: 10 } },
    { id: 'door-1', kind: 'door', doorState: 'locked', a: { x: 20, y: 30 }, b: { x: 80, y: 30 } }
  ], { sceneWidth: 100, sceneHeight: 80 });

  assert.equal(walls[0].kind, SceneWallKind.WALL);
  assert.deepEqual(walls[0].a, { x: 0, y: 10 });
  assert.deepEqual(walls[0].b, { x: 100, y: 10 });
  assert.equal(walls[1].doorState, SceneDoorState.LOCKED);
});

test('porta aberta não bloqueia visão/movimento e demais segmentos bloqueiam', () => {
  const openDoor = { kind: SceneWallKind.DOOR, doorState: SceneDoorState.OPEN };
  const closedDoor = { kind: SceneWallKind.DOOR, doorState: SceneDoorState.CLOSED };
  const wall = { kind: SceneWallKind.WALL };
  assert.equal(wallBlocksMovement(openDoor), false);
  assert.equal(wallBlocksVision(openDoor), false);
  assert.equal(wallBlocksMovement(closedDoor), true);
  assert.equal(wallBlocksVision(closedDoor), true);
  assert.equal(wallBlocksMovement(wall), true);
});

test('snap, distância e ciclo de porta são determinísticos', () => {
  assert.deepEqual(snapScenePoint({ x: 74, y: 133 }, { size: 70, offsetX: 5, offsetY: -5 }), { x: 75, y: 135 });
  assert.equal(pointToWallDistance({ x: 50, y: 10 }, { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }), 10);
  assert.equal(cycleDoorState(SceneDoorState.CLOSED), SceneDoorState.OPEN);
  assert.equal(cycleDoorState(SceneDoorState.OPEN), SceneDoorState.LOCKED);
  assert.equal(cycleDoorState(SceneDoorState.LOCKED), SceneDoorState.CLOSED);
});

test('scene geometry rejeita segmento curto, ids duplicados e payload excessivo', () => {
  assert.throws(
    () => normalizeSceneWalls([{ id: 'x', a: { x: 1, y: 1 }, b: { x: 1.5, y: 1.5 } }]),
    (error) => error.code === 'SCENE_WALL_TOO_SHORT'
  );
  assert.throws(
    () => normalizeSceneWalls([
      { id: 'same', a: { x: 0, y: 0 }, b: { x: 10, y: 0 } },
      { id: 'same', a: { x: 0, y: 10 }, b: { x: 10, y: 10 } }
    ]),
    (error) => error.code === 'SCENE_WALL_ID_CONFLICT'
  );
  assert.throws(
    () => normalizeSceneWalls(Array.from({ length: 2001 }, (_, index) => ({
      id: `w-${index}`,
      a: { x: index, y: 0 },
      b: { x: index + 2, y: 0 }
    }))),
    (error) => error.code === 'SCENE_WALL_LIMIT_EXCEEDED' && error.statusCode === 413
  );
});
