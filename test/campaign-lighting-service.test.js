import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../packages/campaign-scene-service/src/index.js';

function fakeAssetStorage() {
  return {
    async saveImage({ campaignId, fileName, mimeType, dataBase64 }) {
      return { id: `asset-${campaignId}`, fileName, mimeType, size: Buffer.from(dataBase64, 'base64').length };
    },
    async saveImageBuffer() { throw new Error('unused'); },
    async read() { return Buffer.from('map'); },
    async delete() {}
  };
}

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Lighting Test' });
  const service = new CampaignSceneService({ campaignService, repository, assetStorage: fakeAssetStorage() });
  const asset = await service.uploadMap({
    campaignId: campaign.id,
    userId: 'gm-1',
    fileName: 'map.webp',
    mimeType: 'image/webp',
    dataBase64: Buffer.from('map').toString('base64')
  });
  const created = await service.createScene({
    campaignId: campaign.id,
    userId: 'gm-1',
    name: 'Templo',
    assetId: asset.id,
    width: 700,
    height: 490,
    gridSize: 70
  });

  const raw = campaignService.getRaw(campaign.id);
  raw.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-ayla', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    draft.campaigns.find((item) => item.id === campaign.id).members = structuredClone(raw.members);
  });
  campaignService.refreshFromRepository();
  return { repository, campaignService, campaign, service, sceneId: created.scene.id };
}

test('Mestre persiste iluminação normalizada e catálogo expõe as fontes', async () => {
  const { campaign, service, sceneId } = await fixture();
  const result = await service.updateLighting({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    darkness: 0.84,
    sources: [{
      id: 'torch-1', name: 'Tocha de Ayla', x: 140, y: 210,
      radiusCells: 7, intensity: 0.9, color: '#ffbb55', attachedTokenId: 'hero-ayla'
    }]
  });
  assert.equal(result.scene.lighting.enabled, true);
  assert.equal(result.scene.lighting.darkness, 0.84);
  assert.equal(result.scene.lighting.sources[0].id, 'torch-1');
  assert.equal(result.scene.lighting.sources[0].attachedTokenId, 'hero-ayla');

  const playerScene = service.list({ campaignId: campaign.id, userId: 'player-1' }).scenes[0];
  assert.deepEqual(playerScene.lighting.sources[0], result.scene.lighting.sources[0]);
});

test('jogador não pode alterar iluminação da cena', async () => {
  const { campaign, service, sceneId } = await fixture();
  await assert.rejects(
    () => service.updateLighting({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId,
      enabled: true,
      sources: []
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});

test('cena nova começa com iluminação desativada e configuração segura', async () => {
  const { campaign, service } = await fixture();
  const scene = service.list({ campaignId: campaign.id, userId: 'gm-1' }).scenes[0];
  assert.equal(scene.lighting.enabled, false);
  assert.equal(scene.lighting.darkness, 0.78);
  assert.deepEqual(scene.lighting.sources, []);
});
