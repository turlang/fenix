import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createFenix3dRuntimeManifest,
  createFenix3dRuntimeStateSync,
  normalizeFenix3dRuntimeInput,
  projectRuntimeMovementIntent
} from '../packages/render-runtime-adapter/src/index.js';

function bootstrap() {
  return {
    schema: 'fenix.render-world-bootstrap',
    version: 1,
    createdAt: '2026-08-18T12:00:00.000Z',
    campaign: { id: 'campaign-1', title: 'Cripta', systemId: 'dnd5e' },
    scene: {
      id: 'scene-1',
      name: 'Cripta Baixa',
      width: 700,
      height: 560,
      grid: {
        size: 70,
        type: 'square',
        scale: { distancePerCell: 1.5, unit: 'm' }
      },
      physical: {
        walls: [
          { id: 'wall-1', kind: 'wall', a: { x: 0, y: 70 }, b: { x: 140, y: 70 }, bottomElevation: -1000, topElevation: 10000 },
          { id: 'door-1', kind: 'door', doorState: 'open', a: { x: 140, y: 70 }, b: { x: 210, y: 70 }, bottomElevation: 0, topElevation: 3 }
        ],
        elevation: {
          enabled: true,
          unit: 'm',
          levelHeight: 3,
          defaultWallBottom: 0,
          defaultWallTop: 3,
          levels: [{ id: 'ground', name: 'Térreo', elevation: 0 }, { id: 'upper', name: 'Superior', elevation: 3 }]
        },
        regions: [{
          id: 'stairs-1',
          name: 'Escada',
          kind: 'stairs',
          enabled: true,
          points: [{ x: 210, y: 70 }, { x: 280, y: 70 }, { x: 280, y: 140 }, { x: 210, y: 140 }],
          baseElevation: 0,
          targetElevation: 3,
          axis: { start: { x: 210, y: 105 }, end: { x: 280, y: 105 } }
        }],
        lighting: {
          enabled: true,
          darkness: 0.7,
          sources: [{ id: 'light-1', name: 'Tocha', enabled: true, x: 140, y: 140, radiusCells: 4, intensity: 0.8, color: '#ffaa55' }]
        }
      },
      fog: { enabled: true, exploredCells: ['1:1', '1:2'] }
    },
    viewer: {
      actor: {
        actorId: 'actor-1',
        sheetId: 'sheet-1',
        systemId: 'dnd5e',
        movement: { speeds: { walk: { distance: 9, unit: 'm' } }, defaultMode: 'walk' },
        vision: { eyeHeight: 1.6, senses: { normal: { distance: 12, unit: 'm', enabled: true } } }
      },
      token: { tokenId: 'token-1', actorId: 'actor-1', x: 70, y: 140, elevation: 0, rotation: 0, size: 70, height: 1.72 },
      camera: { sceneX: 70, sceneY: 140, groundElevation: 0, eyeHeight: 1.6, elevation: 1.6, unit: 'm', preferredSense: 'normal', visionDistance: 12 }
    },
    tokens: [
      { tokenId: 'token-1', actorId: 'actor-1', x: 70, y: 140, elevation: 0, rotation: 0, size: 70, height: 1.72 },
      { tokenId: 'token-2', actorId: 'actor-2', x: 210, y: 210, elevation: 3, rotation: 90, size: 70, height: 1.85 }
    ]
  };
}

test('3D manifest converts the 1.5m grid to Unreal-friendly centimetres without changing Core authority', () => {
  const manifest = createFenix3dRuntimeManifest(bootstrap());
  assert.equal(manifest.schema, 'fenix.3d-runtime-manifest');
  assert.equal(manifest.scene.units.runtime, 'cm');
  assert.ok(Math.abs(manifest.scene.units.centimetersPerPixel - (150 / 70)) < 0.00001);
  assert.deepEqual(manifest.viewer.camera.location, { x: 150, y: -300, z: 160 });
  assert.equal(manifest.viewer.camera.eyeHeightCm, 160);
  assert.equal(manifest.viewer.camera.visionDistanceCm, 1200);
  assert.equal(manifest.entities.find((token) => token.tokenId === 'token-1').dimensions.heightCm, 172);
  assert.equal(manifest.entities.find((token) => token.tokenId === 'token-2').transform.location.z, 300);
});

test('walls doors levels stairs and lights become explicit runtime entities', () => {
  const manifest = createFenix3dRuntimeManifest(bootstrap());
  const wall = manifest.geometry.walls.find((item) => item.id === 'wall-1');
  const door = manifest.geometry.walls.find((item) => item.id === 'door-1');
  assert.equal(wall.bottomZ, 0);
  assert.equal(wall.topZ, 300, 'legacy infinite wall becomes the configured physical wall height');
  assert.equal(door.kind, 'door');
  assert.equal(door.blocksMovement, false);
  assert.equal(door.blocksVision, false);
  assert.equal(manifest.geometry.levels[1].elevationCm, 300);
  assert.equal(manifest.geometry.regions[0].kind, 'stairs');
  assert.equal(manifest.geometry.regions[0].targetZ, 300);
  assert.equal(manifest.lights[0].radiusCm, 600);
});

test('runtime input rejects teleport coordinates and accepts only semantic intent', () => {
  assert.throws(
    () => normalizeFenix3dRuntimeInput({ renderSessionId: 'render-1', type: 'move', forward: 1, x: 9999 }),
    (error) => error?.code === 'FENIX_3D_INPUT_AUTHORITY_VIOLATION' && error?.statusCode === 403
  );
  assert.throws(
    () => normalizeFenix3dRuntimeInput({ renderSessionId: 'render-1', intent: { type: 'move', forward: 1, position: { x: 1, y: 2 } } }),
    (error) => error?.code === 'FENIX_3D_INPUT_AUTHORITY_VIOLATION'
  );
  const normalized = normalizeFenix3dRuntimeInput({
    renderSessionId: 'render-1',
    sequence: 4,
    intent: { type: 'move', forward: 1, strafe: 0, run: false }
  });
  assert.equal(normalized.intent.type, 'move');
  assert.equal(normalized.intent.forward, 1);
  assert.equal(normalized.sequence, 4);
});

test('movement intent projects only a requested step and never marks it authoritative', () => {
  const projected = projectRuntimeMovementIntent({
    token: { tokenId: 'token-1', actorId: 'actor-1', x: 100, y: 120, rotation: 0 },
    scene: { grid: { size: 70 } },
    input: { renderSessionId: 'render-1', sequence: 1, intent: { type: 'move', forward: 1, strafe: 0 } },
    yawDegrees: 0
  });
  assert.equal(projected.token.x, 100);
  assert.equal(projected.token.y, 106);
  assert.equal(projected.authoritative, false);
  assert.deepEqual(projected.requestedDelta, { x: 0, y: -14 });

  const run = projectRuntimeMovementIntent({
    token: { tokenId: 'token-1', actorId: 'actor-1', x: 100, y: 120, rotation: 0 },
    scene: { grid: { size: 70 } },
    input: { renderSessionId: 'render-1', sequence: 2, intent: { type: 'move', forward: 1, strafe: 0, run: true } }
  });
  assert.equal(run.token.y, 50);
});

test('authoritative sync sent back to runtime contains accepted token state and collision result', () => {
  const sync = createFenix3dRuntimeStateSync({
    renderSessionId: 'render-1',
    revision: 12,
    token: { tokenId: 'token-1', actorId: 'actor-1', x: 100, y: 110, elevation: 0, rotation: 45 },
    collision: { blocked: true, wallId: 'wall-1' },
    vertical: { elevation: 0, source: 'ground' }
  });
  assert.equal(sync.schema, 'fenix.3d-runtime-state-sync');
  assert.equal(sync.revision, 12);
  assert.equal(sync.token.rotation, 45);
  assert.equal(sync.collision.wallId, 'wall-1');
});
