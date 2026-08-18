import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachRuntimeSceneEntities,
  createRuntimeSceneEntities
} from '../packages/render-runtime-control/src/runtime-scene-sync.js';

const ROOT = new URL('../', import.meta.url);
const unreal = (path) => new URL(`apps/fenix3d-unreal/${path}`, ROOT);
const source = (url) => readFile(url, 'utf8');

test('runtime scene sync publishes server-owned token transforms for the 3D thin client', () => {
  const entities = createRuntimeSceneEntities([
    { tokenId: 'token-a', actorId: 'actor-a', x: 10, y: 20, elevation: 1.5, rotation: 90, visible: true },
    { id: 'token-b', actorId: 'actor-b', x: 30, y: 40, hidden: true }
  ]);

  assert.equal(entities.length, 2);
  assert.deepEqual(entities[0], {
    tokenId: 'token-a', actorId: 'actor-a', x: 10, y: 20,
    elevation: 1.5, rotation: 90, visible: true, movementMode: 'ground'
  });
  assert.equal(entities[1].visible, false);
  const sync = attachRuntimeSceneEntities({ schema: 'fenix.3d-runtime-state-sync' }, { tokens: entities });
  assert.equal(sync.entities.length, 2);
});

test('Unreal WorldBuilder updates non-viewer tokens without becoming collision authority', async () => {
  const cpp = await source(unreal('Source/Fenix3D/Private/FenixWorldBuilder.cpp'));
  const header = await source(unreal('Source/Fenix3D/Public/FenixWorldBuilder.h'));

  assert.match(header, /ApplySceneSync/);
  assert.match(header, /RuntimeEntityActors/);
  assert.match(cpp, /SceneStateToRuntimeLocation/);
  assert.match(cpp, /SetActorLocationAndRotation/);
  assert.match(cpp, /ECollisionEnabled::NoCollision/);
  assert.match(cpp, /Fenix\.Door/);
  assert.match(cpp, /Region\.Kind == TEXT\("stairs"\)/);
  assert.doesNotMatch(cpp, /AddMovementInput|CharacterMovement|resolveTokenMovement/);
});

test('viewer reconciliation is smoothed while authoritative collision remains visible', async () => {
  const pawn = await source(unreal('Source/Fenix3D/Private/FenixFirstPersonPawn.cpp'));
  const gameMode = await source(unreal('Source/Fenix3D/Private/FenixRuntimeGameMode.cpp'));

  assert.match(pawn, /VInterpTo/);
  assert.match(pawn, /RInterpTo/);
  assert.match(pawn, /bCollisionBlocked/);
  assert.match(pawn, /OnCollisionFeedback\.Broadcast/);
  assert.doesNotMatch(pawn, /AddMovementInput|UFloatingPawnMovement|UCharacterMovementComponent/);
  assert.match(gameMode, /ApplySceneSync/);
  assert.match(gameMode, /HandleCollisionFeedback/);
});

test('Runtime Control parses authoritative entity list returned by Core', async () => {
  const client = await source(unreal('Source/Fenix3D/Private/FenixRuntimeControlClient.cpp'));
  const types = await source(unreal('Source/Fenix3D/Public/FenixRuntimeTypes.h'));
  const server = await source(new URL('packages/render-runtime-control/src/index.js', ROOT));

  assert.match(client, /ChildArray\(Result, TEXT\("entities"\)\)/);
  assert.match(types, /TArray<FFenixRuntimeEntityState> Entities/);
  assert.match(server, /attachRuntimeSceneEntities/);
  assert.match(server, /realtimeHub\.getSnapshot/);
});
