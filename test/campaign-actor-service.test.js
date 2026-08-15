import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignActorService } from '../packages/campaign-actor-service/src/index.js';

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Visão por Ficha' });
  const actorService = new CampaignActorService({
    repository,
    campaignService,
    now: () => Date.parse('2026-08-15T01:00:00Z')
  });
  return { repository, campaignService, campaign, actorService };
}

async function addPlayer(repository, campaignService, campaignId, actorId = 'hero-ayla') {
  const campaign = campaignService.getRaw(campaignId);
  campaign.members.push({ userId: 'player-1', role: 'player', actorId, joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaignId);
    stored.members = structuredClone(campaign.members);
  });
  campaignService.refreshFromRepository();
}

test('Mestre persiste ficha e sistema separados do token', async () => {
  const { repository, campaign, actorService } = await fixture();
  const actor = await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-1',
    actorId: 'hero-ayla',
    sheetId: 'sheet-ayla-dnd5e',
    systemId: 'dnd5e',
    name: 'Ayla',
    sheet: {
      height: 1.72,
      movement: { unit: 'm', speeds: { walk: 9, swim: 4.5 }, defaultMode: 'walk' },
      vision: { unit: 'm', eyeHeight: 1.58, senses: { normal: 9, darkvision: 18 } }
    }
  });

  assert.equal(actor.actorId, 'hero-ayla');
  assert.equal(actor.sheetId, 'sheet-ayla-dnd5e');
  assert.equal(actor.systemId, 'dnd5e');
  assert.equal(actor.resolved.vision.senses.darkvision.distance, 18);
  assert.equal(actor.resolved.movement.speeds.walk.distance, 9);

  const persisted = repository.snapshot().campaigns.find((item) => item.id === campaign.id).actors[0];
  assert.equal(persisted.id, 'hero-ayla');
  assert.equal(persisted.sheetId, 'sheet-ayla-dnd5e');
  assert.equal(persisted.sheet.vision.senses.normal.distance, 9);
});

test('jogador consulta somente a própria ficha', async () => {
  const { repository, campaignService, campaign, actorService } = await fixture();
  await actorService.upsert({ campaignId: campaign.id, userId: 'gm-1', actorId: 'hero-ayla', name: 'Ayla', sheet: { vision: { unit: 'm', senses: { normal: 9 } } } });
  await actorService.upsert({ campaignId: campaign.id, userId: 'gm-1', actorId: 'hero-dorian', name: 'Dorian', sheet: { vision: { unit: 'm', senses: { normal: 18 } } } });
  await addPlayer(repository, campaignService, campaign.id, 'hero-ayla');

  const visible = actorService.list({ campaignId: campaign.id, userId: 'player-1' });
  assert.deepEqual(visible.map((actor) => actor.id), ['hero-ayla']);
  assert.throws(
    () => actorService.get({ campaignId: campaign.id, userId: 'player-1', actorId: 'hero-dorian' }),
    (error) => error?.code === 'CAMPAIGN_ACTOR_FORBIDDEN' && error?.statusCode === 403
  );
});

test('jogador não altera ficha; atualização permanece GM-only', async () => {
  const { repository, campaignService, campaign, actorService } = await fixture();
  await addPlayer(repository, campaignService, campaign.id, 'hero-ayla');

  await assert.rejects(
    () => actorService.upsert({ campaignId: campaign.id, userId: 'player-1', actorId: 'hero-ayla', sheet: { vision: { senses: { normal: 999 } } } }),
    (error) => error?.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error?.statusCode === 403
  );
});
