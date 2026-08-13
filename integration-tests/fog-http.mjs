import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfig } from '../packages/config/src/index.js';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { LocalAssetStorage } from '../packages/asset-storage/src/index.js';
import { AuthService } from '../packages/auth-service/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../packages/campaign-scene-service/src/index.js';
import { createApiApp } from '../apps/api/src/app.js';

function cookieFrom(response) {
  const value = response.headers['set-cookie'];
  assert.ok(value, 'resposta deve emitir cookie de sessão');
  return String(value).split(';')[0];
}

const assetRoot = await mkdtemp(join(tmpdir(), 'fenix-fog-http-'));
const repository = new InMemoryFenixRepository();
await repository.initialize();
const authService = new AuthService({ repository, logger: {} });
await authService.initialize();
const campaignService = new CampaignService({ repository, authService, logger: {} });
await campaignService.initialize();
const assetStorage = new LocalAssetStorage({ rootDir: assetRoot, maxBytes: 1024 * 1024 });
await assetStorage.initialize();
const sceneService = new CampaignSceneService({ campaignService, repository, assetStorage });
const sessionService = {
  getStatus: () => ({ state: 'IDLE', sessionId: null }),
  start: async () => ({ state: 'COLLECTING_ACTIONS', sessionId: 's-1' }),
  processAction: async () => ({ state: 'COLLECTING_ACTIONS' }),
  describeRoom: async () => ({ state: 'COLLECTING_ACTIONS' }),
  end: async () => ({ state: 'ENDED' })
};
const app = await createApiApp({
  config: createConfig({ NODE_ENV: 'test', PORT: '3001' }),
  sessionService,
  narrator: null,
  audioNarrationService: null,
  authService,
  campaignService,
  sceneService
});

try {
  await app.ready();
  const bootstrap = await app.inject({
    method: 'POST',
    url: '/v1/auth/bootstrap',
    payload: { displayName: 'Mestre', email: 'gm-fog@example.com', password: 'Senha-Fog-Segura-2026' }
  });
  assert.equal(bootstrap.statusCode, 200);
  const gmCookie = cookieFrom(bootstrap);

  const createdCampaign = await app.inject({
    method: 'POST', url: '/v1/campaigns', headers: { cookie: gmCookie }, payload: { title: 'Fog HTTP' }
  });
  assert.equal(createdCampaign.statusCode, 200);
  const campaign = createdCampaign.json().campaign;

  const uploaded = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/assets`,
    headers: { cookie: gmCookie },
    payload: {
      fileName: 'map.webp',
      mimeType: 'image/webp',
      dataBase64: Buffer.from('fog-map').toString('base64')
    }
  });
  assert.equal(uploaded.statusCode, 200);
  const asset = uploaded.json().asset;

  const createdScene = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/scenes`,
    headers: { cookie: gmCookie },
    payload: { name: 'Cripta Fog', assetId: asset.id, width: 700, height: 560, gridSize: 70 }
  });
  assert.equal(createdScene.statusCode, 200);
  const scene = createdScene.json().scene;

  const configured = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/scenes/${scene.id}/fog`,
    headers: { cookie: gmCookie },
    payload: {
      enabled: true,
      visionRangeCells: 10,
      exploredOpacity: 0.45,
      unexploredOpacity: 0.95,
      visionProfiles: {
        'hero-ayla': { mode: 'darkvision', rangeCells: 8, elevation: 4, height: 1.8, movementMode: 'flying' }
      },
      sceneElevation: {
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
      }
    }
  });
  assert.equal(configured.statusCode, 200);
  assert.deepEqual(configured.json().scene.fog, {
    enabled: true,
    visionRangeCells: 10,
    exploredOpacity: 0.45,
    unexploredOpacity: 0.95,
    exploredByActor: {}
  });
  assert.equal(configured.json().scene.elevation.enabled, true);
  assert.equal(configured.json().scene.elevation.verticalStep, 1);
  assert.equal(configured.json().scene.elevation.levels[1].name, 'Ponte');
  assert.equal(configured.json().scene.visionProfiles['hero-ayla'].movementMode, 'flying');
  assert.equal(configured.json().scene.visionProfiles['hero-ayla'].elevation, 4);

  const invite = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/invites`,
    headers: { cookie: gmCookie },
    payload: { actorId: 'hero-ayla' }
  });
  assert.equal(invite.statusCode, 200);

  const registration = await app.inject({
    method: 'POST',
    url: '/v1/invites/register',
    payload: {
      token: invite.json().token,
      displayName: 'Ayla',
      email: 'ayla-fog@example.com',
      password: 'Senha-Ayla-Fog-2026'
    }
  });
  assert.equal(registration.statusCode, 200);
  const playerCookie = cookieFrom(registration);

  const forbidden = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/scenes/${scene.id}/fog`,
    headers: { cookie: playerCookie },
    payload: {
      enabled: false,
      sceneElevation: { enabled: false },
      visionProfiles: { 'hero-ayla': { elevation: 999, movementMode: 'flying' } }
    }
  });
  assert.equal(forbidden.statusCode, 403);

  const playerCatalog = await app.inject({
    method: 'GET',
    url: `/v1/campaigns/${campaign.id}/scenes`,
    headers: { cookie: playerCookie }
  });
  assert.equal(playerCatalog.statusCode, 200);
  const playerScene = playerCatalog.json().scenes[0];
  const playerFog = playerScene.fog;
  assert.equal(playerFog.enabled, true);
  assert.ok(Array.isArray(playerFog.exploredCells));
  assert.equal('exploredByActor' in playerFog, false);
  assert.equal(playerScene.elevation.enabled, true);
  assert.equal(playerScene.visionProfiles['hero-ayla'].elevation, 4, 'tentativa do jogador não pode alterar Z persistido');

  console.log('Fog + elevation HTTP integration OK');
} finally {
  await app.close();
  await rm(assetRoot, { recursive: true, force: true });
}
