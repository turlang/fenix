import test from 'node:test';
import assert from 'node:assert/strict';
import { MovementMode, movementBudgetInCells, normalizeMovementProfile } from '../packages/rpg-rules-contract/src/index.js';
import { normalizeSceneScale } from '../packages/scene-scale/src/index.js';
import {
  SceneRegionKind,
  TokenMovementMode,
  clampFlyingElevation,
  normalizeSceneElevation,
  normalizeSceneRegions,
  resolveGroundElevation
} from '../packages/scene-elevation/src/index.js';

test('sistema resolve deslocamento e cena apenas converte distância física em células', () => {
  const scale = normalizeSceneScale({ distancePerCell: 1.5, unit: 'm' });
  const profile = normalizeMovementProfile({
    unit: 'm',
    defaultMode: MovementMode.WALK,
    speeds: {
      walk: 9,
      run: 18,
      swim: 4.5,
      fly: 18
    }
  });

  assert.equal(movementBudgetInCells({ profile, mode: MovementMode.WALK, sceneScale: scale }).cells, 6);
  assert.equal(movementBudgetInCells({ profile, mode: MovementMode.RUN, sceneScale: scale }).cells, 12);
  assert.equal(movementBudgetInCells({ profile, mode: MovementMode.SWIM, sceneScale: scale }).cells, 3);
  assert.equal(movementBudgetInCells({ profile, mode: MovementMode.FLY, sceneScale: scale }).cells, 12);
});

test('piso e rampa resolvem Z terrestre sem alterar a regra de movimento do sistema', () => {
  const regions = normalizeSceneRegions([{
    id: 'stairs-a',
    kind: SceneRegionKind.STAIRS,
    points: [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 60 },
      { x: 0, y: 60 }
    ],
    baseElevation: 0,
    targetElevation: 3,
    axis: { start: { x: 0, y: 30 }, end: { x: 120, y: 30 } }
  }], { sceneWidth: 500, sceneHeight: 500 });

  assert.equal(resolveGroundElevation({ regions, point: { x: 60, y: 30 } }).elevation, 1.5);
  assert.equal(resolveGroundElevation({ regions, point: { x: 100, y: 30 } }).elevation, 2.5);
});

test('voo mantém autoridade vertical independente da superfície terrestre', () => {
  const elevation = normalizeSceneElevation({ enabled: true, verticalStep: 1, levelHeight: 3 });
  const movementMode = TokenMovementMode.FLYING;

  assert.equal(movementMode, 'flying');
  assert.equal(clampFlyingElevation({ previousElevation: 2, requestedElevation: 20, verticalStep: elevation.verticalStep }), 3);
  assert.equal(clampFlyingElevation({ previousElevation: 3, requestedElevation: -20, verticalStep: elevation.verticalStep }), 2);
});
