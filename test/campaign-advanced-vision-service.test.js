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
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Vision Test' });
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
    name: 'Galeria',
    assetId: asset.id,
    width: 420,
    height: 280,
    gridSize: 70
  });
  const raw = campaignService.getRaw(campaign.id);
  raw.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-ayla', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    draft.campaigns.find((item) => item.id === campaign.id).members = structuredClone(raw.members);
  });
  campaignService.refreshFromRepository();
  return { campaign, service, sceneId: created.scene.id };
}

test('Mestre persiste perfil individual de visão e jogador recebe o perfil', async () => {
  const { campaign, service, sceneId } = await fixture();
  const configured = await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    visionRangeCells: 2,
    visionProfiles: {
      'hero-ayla': {
        mode: 'darkvision',
        rangeCells: 5,
        elevation: 2.5,
        personalLight: { enabled: true, radiusCells: 4, intensity: 0.8, color: '#ffaa55' }
      }
    }
  });

  assert.equal(configured.scene.visionProfiles['hero-ayla'].mode, 'darkvision');
  assert.equal(configured.scene.visionProfiles['hero-ayla'].rangeCells, 5);
  assert.equal(configured.scene.visionProfiles['hero-ayla'].elevation, 2.5);
  assert.equal(configured.scene.visionProfiles['hero-ayla'].personalLight.enabled, true);

  const playerScene = service.list({ campaignId: campaign.id, userId: 'player-1' }).scenes[0];
  assert.equal(playerScene.visionProfiles['hero-ayla'].mode, 'darkvision');
});

test('exploração usa alcance individual do personagem em vez do alcance global do Fog', async () => {
  const { campaign, service, sceneId } = await fixture();
  await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    visionRangeCells: 1,
    visionProfiles: {
      'hero-ayla': { mode: 'infravision', rangeCells: 5 }
    }
  });

  const explored = await service.recordExploration({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId,
    actorId: 'hero-ayla',
    x: 70,
    y: 105
  });

  assert.equal(explored.changed, true);
  assert.ok(explored.discoveredCells.includes('0:3'), 'alcance individual maior deve revelar célula distante ainda dentro do LOS');
});

test('jogador não pode alterar perfis porque a atualização continua GM-only', async () => {
  const { campaign, service, sceneId } = await fixture();
  await assert.rejects(
    () => service.updateFog({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId,
      visionProfiles: { 'hero-ayla': { mode: 'darkvision', rangeCells: 60 } }
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
