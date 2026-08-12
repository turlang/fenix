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

const assetRoot = await mkdtemp(join(tmpdir(), 'fenix-http-assets-'));
const repository = new InMemoryFenixRepository();
await repository.initialize();
const authService = new AuthService({ repository, logger: {} });
await authService.initialize();
const campaignService = new CampaignService({ repository, authService, logger: {} });
await campaignService.initialize();
const assetStorage = new LocalAssetStorage({ rootDir: assetRoot, maxBytes: 1024 * 1024 });
await assetStorage.initialize();
const sceneService = new CampaignSceneService({ campaignService, repository, assetStorage });

let sessionStartCalls = 0;
const sessionService = {
  getStatus() { return { state: 'IDLE', sessionId: null, sceneId: null, campaignId: null }; },
  async start() { sessionStartCalls += 1; return { state: 'COLLECTING_ACTIONS', sessionId: 'fake-session' }; },
  async processAction() { return { state: 'COLLECTING_ACTIONS' }; },
  async describeRoom() { return { state: 'COLLECTING_ACTIONS' }; },
  async end() { return { state: 'ENDED', sessionId: null }; }
};
const config = createConfig({
  NODE_ENV: 'production',
  PORT: '3001',
  CORS_ALLOWED_ORIGINS: 'https://fenix.example.com',
  FENIX_ALLOW_LEGACY_SESSION_HTTP: 'false',
  FENIX_AUTH_COOKIE_SAME_SITE: 'None'
});
const app = await createApiApp({
  config,
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
    payload: {
      displayName: 'Mestre',
      email: 'gm@example.com',
      password: 'Senha-GM-Segura-2026'
    }
  });
  assert.equal(bootstrap.statusCode, 200);
  const gmCookie = cookieFrom(bootstrap);
  assert.match(bootstrap.headers['set-cookie'], /HttpOnly/);
  assert.match(bootstrap.headers['set-cookie'], /SameSite=None/);
  assert.match(bootstrap.headers['set-cookie'], /Secure/);

  const secondBootstrap = await app.inject({
    method: 'POST',
    url: '/v1/auth/bootstrap',
    payload: {
      displayName: 'Outro',
      email: 'other@example.com',
      password: 'Outra-Senha-Segura-2026'
    }
  });
  assert.equal(secondBootstrap.statusCode, 409);

  const unauthorizedCampaign = await app.inject({ method: 'GET', url: '/v1/campaigns' });
  assert.equal(unauthorizedCampaign.statusCode, 401);

  const createdCampaign = await app.inject({
    method: 'POST',
    url: '/v1/campaigns',
    headers: { cookie: gmCookie },
    payload: { title: 'Ecos de Amn' }
  });
  assert.equal(createdCampaign.statusCode, 200);
  const campaign = createdCampaign.json().campaign;
  assert.equal(campaign.membership.role, 'gm');

  const mapBytes = Buffer.from('fake-map-image');
  const uploadedMap = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/assets`,
    headers: { cookie: gmCookie },
    payload: {
      fileName: 'templo.webp',
      mimeType: 'image/webp',
      dataBase64: mapBytes.toString('base64')
    }
  });
  assert.equal(uploadedMap.statusCode, 200);
  const asset = uploadedMap.json().asset;
  assert.equal(asset.mimeType, 'image/webp');

  const createdScene = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/scenes`,
    headers: { cookie: gmCookie },
    payload: {
      name: 'Templo em Ruínas',
      description: 'Um templo de pedra com altar quebrado e duas colunas.',
      assetId: asset.id,
      width: 1920,
      height: 1080,
      gridSize: 70
    }
  });
  assert.equal(createdScene.statusCode, 200);
  const scene = createdScene.json().scene;
  assert.equal(scene.backgroundAssetId, asset.id);

  const readAsset = await app.inject({
    method: 'GET',
    url: `/v1/campaigns/${campaign.id}/assets/${asset.id}`,
    headers: { cookie: gmCookie }
  });
  assert.equal(readAsset.statusCode, 200);
  assert.equal(readAsset.headers['content-type'], 'image/webp');
  assert.equal(readAsset.rawPayload.toString(), mapBytes.toString());

  const sceneCatalog = await app.inject({
    method: 'GET',
    url: `/v1/campaigns/${campaign.id}/scenes`,
    headers: { cookie: gmCookie }
  });
  assert.equal(sceneCatalog.statusCode, 200);
  assert.equal(sceneCatalog.json().scenes[0].name, 'Templo em Ruínas');
  assert.equal(sceneCatalog.json().activeSceneId, scene.id);

  const inviteResponse = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/invites`,
    headers: { cookie: gmCookie },
    payload: { actorId: 'hero-ayla' }
  });
  assert.equal(inviteResponse.statusCode, 200);
  const inviteToken = inviteResponse.json().token;
  assert.ok(inviteToken);
  assert.equal(JSON.stringify(repository.snapshot()).includes(inviteToken), false);

  const playerRegistration = await app.inject({
    method: 'POST',
    url: '/v1/invites/register',
    payload: {
      token: inviteToken,
      displayName: 'Jogadora',
      email: 'player@example.com',
      password: 'Senha-Player-Segura-2026'
    }
  });
  assert.equal(playerRegistration.statusCode, 200);
  const playerCookie = cookieFrom(playerRegistration);
  assert.equal(playerRegistration.json().campaign.membership.role, 'player');
  assert.equal(playerRegistration.json().campaign.membership.actorId, 'hero-ayla');

  const playerSceneCatalog = await app.inject({
    method: 'GET',
    url: `/v1/campaigns/${campaign.id}/scenes`,
    headers: { cookie: playerCookie }
  });
  assert.equal(playerSceneCatalog.statusCode, 200);
  assert.equal(playerSceneCatalog.json().scenes.length, 1);

  const playerMapUpload = await app.inject({
    method: 'POST',
    url: `/v1/campaigns/${campaign.id}/assets`,
    headers: { cookie: playerCookie },
    payload: {
      fileName: 'nao-autorizado.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('x').toString('base64')
    }
  });
  assert.equal(playerMapUpload.statusCode, 403);

  const inviteReplay = await app.inject({
    method: 'POST',
    url: '/v1/invites/register',
    payload: {
      token: inviteToken,
      displayName: 'Atacante',
      email: 'attacker@example.com',
      password: 'Senha-Attacker-Segura-2026'
    }
  });
  assert.equal(inviteReplay.statusCode, 404);

  const playerCampaigns = await app.inject({
    method: 'GET',
    url: '/v1/campaigns',
    headers: { cookie: playerCookie }
  });
  assert.equal(playerCampaigns.statusCode, 200);
  assert.equal(playerCampaigns.json().campaigns[0].membership.actorId, 'hero-ayla');

  const unauthenticatedStart = await app.inject({
    method: 'POST',
    url: '/v1/session/start',
    payload: { campaignId: campaign.id, snapshot: { activeScene: { id: 'scene-1' } } }
  });
  assert.equal(unauthenticatedStart.statusCode, 401);
  assert.equal(sessionStartCalls, 0);

  const playerStart = await app.inject({
    method: 'POST',
    url: '/v1/session/start',
    headers: { cookie: playerCookie },
    payload: { campaignId: campaign.id, snapshot: { activeScene: { id: 'scene-1' } } }
  });
  assert.equal(playerStart.statusCode, 403);
  assert.equal(sessionStartCalls, 0);

  console.log('Auth + campaign + scene HTTP integration OK');
} finally {
  await app.close();
  await rm(assetRoot, { recursive: true, force: true });
}
