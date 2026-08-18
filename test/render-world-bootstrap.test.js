import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderWorldBootstrap } from '../packages/render-world-bootstrap/src/index.js';
import { RemoteRenderBrokerService } from '../packages/remote-render-broker/src/index.js';

function actor() {
  return {
    id: 'actor-ayla',
    actorId: 'actor-ayla',
    sheetId: 'sheet-ayla',
    systemId: 'dnd5e',
    name: 'Ayla',
    kind: 'character',
    sheet: {
      height: 1.72,
      vision: { eyeHeight: 1.58 }
    },
    resolved: {
      movement: { defaultMode: 'walk', speeds: { walk: { distance: 9, unit: 'm' } } },
      vision: {
        enabled: true,
        eyeHeight: 1.58,
        preferredSense: 'darkvision',
        senses: {
          normal: { distance: 12, unit: 'm', enabled: true },
          darkvision: { distance: 18, unit: 'm', enabled: true }
        }
      },
      footprint: { widthCells: 1, heightCells: 1 }
    }
  };
}

function viewerToken() {
  return {
    id: 'token-ayla',
    tokenId: 'token-ayla',
    actorId: 'actor-ayla',
    sheetId: 'sheet-ayla',
    systemId: 'dnd5e',
    name: 'Ayla',
    x: 350,
    y: 420,
    elevation: 3,
    size: 70,
    visible: true,
    movementMode: 'ground'
  };
}

function scene() {
  return {
    id: 'scene-crypt',
    name: 'Cripta',
    width: 1400,
    height: 980,
    backgroundAssetId: 'asset-map',
    grid: { size: 70, type: 'square', offsetX: 0, offsetY: 0, visible: true },
    walls: [{ id: 'wall-1', a: { x: 0, y: 0 }, b: { x: 1400, y: 0 } }],
    lighting: { enabled: true, darkness: 0.7, sources: [] },
    elevation: { enabled: true, unit: 'm', levels: [{ id: 'ground', elevation: 0 }] },
    regions: [],
    fog: {
      enabled: true,
      exploredOpacity: 0.45,
      unexploredOpacity: 1,
      exploredByActor: {
        'actor-ayla': ['1:1', '1:2'],
        'actor-dorian': ['9:9']
      }
    }
  };
}

test('World Bootstrap derives First Person camera from persistent token and Actor vision', () => {
  const bootstrap = createRenderWorldBootstrap({
    campaign: { id: 'campaign-1', title: 'Ecos', systemId: 'dnd5e' },
    scene: scene(),
    actor: actor(),
    viewerToken: viewerToken(),
    visibleTokens: [viewerToken()],
    createdAt: '2026-08-18T04:00:00Z'
  });

  assert.equal(bootstrap.schema, 'fenix.render-world-bootstrap');
  assert.equal(bootstrap.version, 1);
  assert.equal(bootstrap.scene.grid.scale.distancePerCell, 1.5);
  assert.equal(bootstrap.scene.grid.scale.unit, 'm');
  assert.equal(bootstrap.scene.physical.distancePerPixel, 1.5 / 70);
  assert.equal(bootstrap.viewer.camera.sceneX, 350);
  assert.equal(bootstrap.viewer.camera.sceneY, 420);
  assert.equal(bootstrap.viewer.camera.groundElevation, 3);
  assert.equal(bootstrap.viewer.camera.eyeHeight, 1.58);
  assert.equal(bootstrap.viewer.camera.elevation, 4.58);
  assert.equal(bootstrap.viewer.camera.preferredSense, 'darkvision');
  assert.equal(bootstrap.viewer.camera.visionDistance, 18);
  assert.equal(bootstrap.viewer.camera.visionCells, 12);
});

test('World Bootstrap carries only the viewer exploration memory supplied to the renderer', () => {
  const bootstrap = createRenderWorldBootstrap({
    campaign: { id: 'campaign-1', title: 'Ecos', systemId: 'dnd5e' },
    scene: scene(),
    actor: actor(),
    viewerToken: viewerToken(),
    visibleTokens: [viewerToken()]
  });

  assert.deepEqual(bootstrap.scene.fog.exploredCells, ['1:1', '1:2']);
  assert.equal(JSON.stringify(bootstrap).includes('9:9'), false);
  assert.equal(JSON.stringify(bootstrap).includes('actor-dorian'), false);
});

test('broker creates the bootstrap server-side and sends it only to the Render Gateway', async () => {
  const campaign = {
    id: 'campaign-1',
    title: 'Ecos',
    systemId: 'dnd5e',
    scenes: [scene()]
  };
  let renderRequest = null;
  const broker = new RemoteRenderBrokerService({
    campaignService: {
      requireRole() { return { campaign, membership: { role: 'player', actorId: 'actor-ayla' } }; }
    },
    actorService: {
      get() { return actor(); }
    },
    tokenService: {
      listRuntimeForScene() { return [viewerToken()]; },
      list() { return [viewerToken()]; }
    },
    renderGateway: {
      list() { return [{ id: 'gpu-1' }]; },
      async createSession(input) {
        renderRequest = input;
        return {
          nodeId: 'gpu-1',
          descriptor: {
            renderSessionId: 'render-1',
            transport: 'webrtc',
            playerUrl: 'https://stream.example/render-1',
            signallingUrl: 'wss://stream.example/render-1',
            renderer: 'unreal-pixel-streaming'
          }
        };
      },
      async endSession() { return true; }
    },
    now: () => Date.parse('2026-08-18T04:00:00Z')
  });

  const result = await broker.create({
    campaignId: 'campaign-1',
    userId: 'player-1',
    sceneId: 'scene-crypt',
    actorId: 'actor-ayla',
    tokenId: 'token-ayla'
  });

  assert.equal(renderRequest.worldBootstrap.schema, 'fenix.render-world-bootstrap');
  assert.equal(renderRequest.worldBootstrap.viewer.actor.actorId, 'actor-ayla');
  assert.equal(renderRequest.worldBootstrap.viewer.token.tokenId, 'token-ayla');
  assert.equal(Object.hasOwn(result, 'worldBootstrap'), false);
  assert.equal(Object.hasOwn(result.descriptor, 'worldBootstrap'), false);
});

test('bootstrap rejects a viewer token linked to another Actor', () => {
  assert.throws(
    () => createRenderWorldBootstrap({
      campaign: { id: 'campaign-1' },
      scene: scene(),
      actor: actor(),
      viewerToken: { ...viewerToken(), actorId: 'actor-other' }
    }),
    (error) => error?.code === 'FENIX_BOOTSTRAP_TOKEN_ACTOR_MISMATCH'
  );
});
