import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { AuthService } from '../packages/auth-service/src/index.js';
import {
  CampaignService,
  createAuthenticatedPeerAuthorizer
} from '../packages/campaign-service/src/index.js';

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const authService = new AuthService({ repository, logger: {} });
  await authService.initialize();
  const campaignService = new CampaignService({ repository, authService, logger: {} });
  await campaignService.initialize();
  return { repository, authService, campaignService };
}

test('senha e tokens reutilizáveis não são persistidos em texto puro', async () => {
  const { repository, authService, campaignService } = await fixture();
  const password = 'Senha-Muito-Segura-2026';
  const owner = await authService.bootstrapOwner({
    email: 'mestre@example.com',
    displayName: 'Mestre Evandro',
    password
  });
  const authSession = await authService.createSession(owner.id);
  const campaign = await campaignService.createCampaign({
    ownerUserId: owner.id,
    title: 'Ecos de Amn'
  });
  const invite = await campaignService.createInvite({
    campaignId: campaign.id,
    createdByUserId: owner.id,
    actorId: 'hero-ayla'
  });

  const serialized = JSON.stringify(repository.snapshot());
  assert.equal(serialized.includes(password), false);
  assert.equal(serialized.includes(authSession.token), false);
  assert.equal(serialized.includes(invite.token), false);
  assert.match(serialized, /"algorithm":"scrypt"/);
  assert.match(serialized, /"tokenHash":/);
});

test('bootstrap concorrente permite somente um primeiro usuário', async () => {
  const { repository, authService } = await fixture();
  const attempts = await Promise.allSettled([
    authService.bootstrapOwner({
      email: 'first@example.com',
      displayName: 'Primeiro Mestre',
      password: 'Senha-Primeiro-2026'
    }),
    authService.bootstrapOwner({
      email: 'second@example.com',
      displayName: 'Segundo Mestre',
      password: 'Senha-Segundo-2026'
    })
  ]);
  assert.equal(attempts.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((item) => item.status === 'rejected').length, 1);
  assert.equal(repository.snapshot().users.length, 1);
});

test('convite é one-time e fixa actorId do jogador no servidor', async () => {
  const { authService, campaignService } = await fixture();
  const owner = await authService.bootstrapOwner({
    email: 'gm@example.com',
    displayName: 'Mestre',
    password: 'Senha-GM-Segura-2026'
  });
  const player = await authService.createUser({
    email: 'player@example.com',
    displayName: 'Jogadora',
    password: 'Senha-Player-Segura-2026'
  });
  const campaign = await campaignService.createCampaign({ ownerUserId: owner.id, title: 'Sombras Sobre Amn' });
  const created = await campaignService.createInvite({
    campaignId: campaign.id,
    createdByUserId: owner.id,
    actorId: 'hero-ayla'
  });

  const inspected = campaignService.inspectInvite(created.token);
  assert.equal(inspected.actorId, 'hero-ayla');
  const accepted = await campaignService.acceptInvite({ token: created.token, userId: player.id });
  assert.equal(accepted.membership.role, 'player');
  assert.equal(accepted.membership.actorId, 'hero-ayla');
  await assert.rejects(
    () => campaignService.acceptInvite({ token: created.token, userId: player.id }),
    (error) => error.code === 'CAMPAIGN_INVITE_INVALID'
  );
});

test('WebSocket autenticado ignora tentativa de elevar role ou trocar actorId pela URL', async () => {
  const { authService, campaignService } = await fixture();
  const owner = await authService.bootstrapOwner({
    email: 'gm2@example.com',
    displayName: 'Mestre',
    password: 'Senha-GM-Segura-2026'
  });
  const player = await authService.createUser({
    email: 'player2@example.com',
    displayName: 'Jogadora',
    password: 'Senha-Player-Segura-2026'
  });
  const campaign = await campaignService.createCampaign({ ownerUserId: owner.id, title: 'Campanha Segura' });
  const invite = await campaignService.createInvite({
    campaignId: campaign.id,
    createdByUserId: owner.id,
    actorId: 'hero-ayla'
  });
  await campaignService.acceptInvite({ token: invite.token, userId: player.id });
  await campaignService.setActiveSession(campaign.id, {
    sessionId: 'session-secure',
    snapshot: { activeScene: { id: 'scene-1', name: 'Cena' } }
  });

  const playerSession = await authService.createSession(player.id);
  const gmSession = await authService.createSession(owner.id);
  const authorize = createAuthenticatedPeerAuthorizer({ authService, campaignService });

  const playerIdentity = authorize({
    sessionId: 'session-secure',
    authToken: playerSession.token,
    clientId: 'client-player',
    role: 'gm',
    actorId: 'npc-warden',
    displayName: 'Hacker'
  });
  assert.equal(playerIdentity.role, 'player');
  assert.equal(playerIdentity.actorId, 'hero-ayla');
  assert.equal(playerIdentity.userId, player.id);
  assert.equal(playerIdentity.displayName, 'Jogadora');

  const gmIdentity = authorize({
    sessionId: 'session-secure',
    authToken: gmSession.token,
    clientId: 'client-gm',
    role: 'player',
    actorId: 'hero-ayla'
  });
  assert.equal(gmIdentity.role, 'gm');
  assert.equal(gmIdentity.actorId, null);
});
