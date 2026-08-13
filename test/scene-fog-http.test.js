import test from 'node:test';
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
  return String(response.headers['set-cookie']).split(';')[0];
}

test('endpoint de Fog é GM-only e devolve configuração normalizada', async () => {
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
    const asset = uploaded.json().asset;
    const createdScene = await app.inject({
      method: 'POST',
      url: `/v1/campaigns/${campaign.id}/scenes`,
      headers: { cookie: gmCookie },
      payload: { name: 'Cripta Fog', assetId: asset.id, width: 700, height: 560, gridSize: 70 }
    });
    const scene = createdScene.json().scene;

    const configured = await app.inject({
      method: 'POST',
      url: `/v1/campaigns/${campaign.id}/scenes/${scene.id}/fog`,
      headers: { cookie: gmCookie },
      payload: { enabled: true, visionRangeCells: 10, exploredOpacity: 0.45, unexploredOpacity: 0.95 }
    });
    assert.equal(configured.statusCode, 200);
    assert.deepEqual(configured.json().scene.fog, {
      enabled: true,
      visionRangeCells: 10,
      exploredOpacity: 0.45,
      unexploredOpacity: 0.95,
      exploredByActor: {}
    });

    const invite = await app.inject({
      method: 'POST',
      url: `/v1/campaigns/${campaign.id}/invites`,
      headers: { cookie: gmCookie },
      payload: { actorId: 'hero-ayla' }
    });
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
    const playerCookie = cookieFrom(registration);

    const forbidden = await app.inject({
      method: 'POST',
      url: `/v1/campaigns/${campaign.id}/scenes/${scene.id}/fog`,
      headers: { cookie: playerCookie },
      payload: { enabled: false }
    });
    assert.equal(forbidden.statusCode, 403);

    const playerCatalog = await app.inject({
      method: 'GET',
      url: `/v1/campaigns/${campaign.id}/scenes`,
      headers: { cookie: playerCookie }
    });
    assert.equal(playerCatalog.statusCode, 200);
    assert.ok(Array.isArray(playerCatalog.json().scenes[0].fog.exploredCells));
    assert.equal('exploredByActor' in playerCatalog.json().scenes[0].fog, false);
  } finally {
    await app.close();
    await rm(assetRoot, { recursive: true, force: true });
  }
});
