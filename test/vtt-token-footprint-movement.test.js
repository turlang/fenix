import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignActorService } from '../packages/campaign-actor-service/src/index.js';
import { CampaignTokenService } from '../packages/campaign-token-service/src/index.js';
import { requestedTokenFromKeyboard } from '../apps/fenix-vtt/lib/token-input-movement.js';

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Footprint tático', systemId: 'generic' });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.scenes = [{ id: 'scene-a', name: 'Arena', width: 1000, height: 1000, tokens: [] }];
    stored.activeSceneId = 'scene-a';
  });
  campaignService.refreshFromRepository();
  const actorService = new CampaignActorService({ campaignService, repository });
  const tokenService = new CampaignTokenService({ campaignService, repository });
  return { campaign, actorService, tokenService };
}

async function createToken({ campaign, actorService, tokenService, actorId, footprint }) {
  const actor = await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-1',
    actorId,
    name: actorId,
    sheet: { footprint }
  });
  const token = await tokenService.upsert({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId: 'scene-a',
    token: { id: `token-${actorId}`, tokenId: `token-${actorId}`, actorId, x: 100, y: 100, size: 70 }
  });
  return { actor, token };
}

test('Small ou maior permanece com passo de uma célula', async () => {
  const fixtureState = await fixture();
  const { actor, token } = await createToken({
    ...fixtureState,
    actorId: 'small-hero',
    footprint: { widthCells: 1, heightCells: 1 }
  });

  assert.deepEqual(actor.resolved.footprint, { widthCells: 1, heightCells: 1 });
  assert.deepEqual(token.footprint, { widthCells: 1, heightCells: 1 });
  const moved = requestedTokenFromKeyboard(token, 'd', { gridSize: 70 });
  assert.equal(moved.x, 170);
  assert.equal(moved.y, 100);
});

test('Tiny/Miúdo preserva footprint de meia célula e usa passo proporcional', async () => {
  const fixtureState = await fixture();
  const { actor, token } = await createToken({
    ...fixtureState,
    actorId: 'tiny-familiar',
    footprint: { widthCells: 0.5, heightCells: 0.5 }
  });

  assert.deepEqual(actor.sheet.footprint, { widthCells: 0.5, heightCells: 0.5 });
  assert.deepEqual(actor.resolved.footprint, { widthCells: 0.5, heightCells: 0.5 });
  assert.deepEqual(token.footprint, { widthCells: 0.5, heightCells: 0.5 });
  const moved = requestedTokenFromKeyboard(token, 'ArrowDown', { gridSize: 70 });
  assert.equal(moved.x, 100);
  assert.equal(moved.y, 135);
});
