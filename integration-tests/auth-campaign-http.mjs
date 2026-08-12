import assert from 'node:assert/strict';
import { createConfig } from '../packages/config/src/index.js';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { AuthService } from '../packages/auth-service/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { createApiApp } from '../apps/api/src/app.js';

function cookieFrom(response) {
  const value = response.headers['set-cookie'];
  assert.ok(value, 'resposta deve emitir cookie de sessão');
  return String(value).split(';')[0];
}

const repository = new InMemoryFenixRepository();
await repository.initialize();
const authService = new AuthService({ repository, logger: {} });
await authService.initialize();
const campaignService = new CampaignService({ repository, authService, logger: {} });
await campaignService.initialize();

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
  campaignService
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

  console.log('Auth + campaign HTTP integration OK');
} finally {
  await app.close();
}
