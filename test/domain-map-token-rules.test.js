import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cellsToDistance,
  distanceToCells,
  normalizeSceneScale
} from '../packages/scene-scale/src/index.js';
import {
  normalizeTokenEntity,
  normalizeTokenPlacement,
  normalizeTokenRuntime,
  tokenBelongsToActor
} from '../packages/token-entity/src/index.js';
import {
  MovementMode,
  createRpgSystemAdapter,
  movementBudgetInCells
} from '../packages/rpg-rules-contract/src/index.js';

test('scene scale defaults to 1.5m per cell without making RPG rules part of the map', () => {
  const scale = normalizeSceneScale({});
  assert.deepEqual(scale, { distancePerCell: 1.5, unit: 'm' });
  assert.equal(cellsToDistance(6, scale), 9);
  assert.equal(distanceToCells(9, scale), 6);
});

test('token entity is separate from placement and keeps legacy actorId compatibility', () => {
  const entity = normalizeTokenEntity({
    id: 'token-ayla-01',
    actorId: 'actor-ayla',
    sheetId: 'sheet-ayla-dnd5e',
    systemId: 'dnd5e',
    name: 'Ayla'
  });
  const placement = normalizeTokenPlacement({
    tokenId: entity.tokenId,
    sceneId: 'scene-templo',
    x: 120,
    y: 240,
    elevation: 3
  });
  const runtime = normalizeTokenRuntime({ entity, placement });

  assert.equal(runtime.id, 'token-ayla-01');
  assert.equal(runtime.actorId, 'actor-ayla');
  assert.equal(runtime.sheetId, 'sheet-ayla-dnd5e');
  assert.equal(runtime.x, 120);
  assert.equal(runtime.elevation, 3);
  assert.equal(tokenBelongsToActor(runtime, 'actor-ayla'), true);
  assert.equal(tokenBelongsToActor(runtime, 'actor-dorian'), false);

  const legacy = normalizeTokenEntity({ id: 'hero-ayla', name: 'Ayla' });
  assert.equal(legacy.actorId, 'hero-ayla');
  assert.equal(legacy.sheetId, 'hero-ayla');
});

test('RPG system adapter resolves movement and map only converts it to cells', () => {
  const adapter = createRpgSystemAdapter({
    id: 'example-system',
    resolveMovementProfile: ({ sheet }) => ({
      unit: 'm',
      defaultMode: MovementMode.WALK,
      speeds: {
        walk: sheet.walk,
        run: sheet.run,
        swim: sheet.swim,
        fly: sheet.fly
      }
    }),
    resolveVisionProfile: ({ sheet }) => ({ range: sheet.vision })
  });

  const profile = adapter.resolveMovementProfile({
    sheet: { walk: 9, run: 18, swim: 4.5, fly: 0, vision: 18 }
  });
  const scale = { distancePerCell: 1.5, unit: 'm' };

  assert.equal(movementBudgetInCells({ profile, mode: 'walk', sceneScale: scale }).cells, 6);
  assert.equal(movementBudgetInCells({ profile, mode: 'run', sceneScale: scale }).cells, 12);
  assert.equal(movementBudgetInCells({ profile, mode: 'swim', sceneScale: scale }).cells, 3);
  assert.equal(movementBudgetInCells({ profile, mode: 'fly', sceneScale: scale }).cells, 0);
});

test('movement distances can be authored in feet while scene scale remains physical', () => {
  const budget = movementBudgetInCells({
    profile: {
      unit: 'ft',
      speeds: { walk: 30 }
    },
    mode: 'walk',
    sceneScale: { distancePerCell: 5, unit: 'ft' }
  });
  assert.equal(budget.cells, 6);
  assert.equal(budget.distance, 30);
  assert.equal(budget.unit, 'ft');
});
