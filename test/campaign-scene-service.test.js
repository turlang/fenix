import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../packages/campaign-scene-service/src/index.js';

function fakeAssetStorage() {
  const files = new Map();
  return {
    async saveImage({ campaignId, assetId = 'asset-map-1', fileName, mimeType, dataBase64 }) {
      const buffer = Buffer.from(dataBase64, 'base64');
      files.set(`${campaignId}:${assetId}`, buffer);
      return { id: assetId, fileName, mimeType, size: buffer.length };
    },
    async read({ campaignId, assetId }) {
      const value = files.get(`${campaignId}:${assetId}`);
      if (!value) throw new Error('missing');
      return value;
    },
    async delete({ campaignId, assetId }) {
      files.delete(`${campaignId}:${assetId}`);
    }
  };
}

test('CampaignSceneService persiste asset, cria cena e ativa cena da campanha', async () => {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Teste de Mapas' });
  const service = new CampaignSceneService({
    campaignService,
    repository,
    assetStorage: fakeAssetStorage(),
    now: () => Date.parse('2026-08-12T20:00:00Z')
  });

  const asset = await service.uploadMap({
    campaignId: campaign.id,
    userId: 'gm-1',
    fileName: 'dungeon.webp',
    mimeType: 'image/webp',
    dataBase64: Buffer.from('map-bytes').toString('base64')
  });
  assert.equal(asset.kind, 'map-background');

  const created = await service.createScene({
    campaignId: campaign.id,
    userId: 'gm-1',
    name: 'Ruínas do Norte',
    description: 'Um salão de pedra iluminado por duas tochas.',
    assetId: asset.id,
    width: 2048,
    height: 1536,
    gridSize: 80
  });
  assert.equal(created.scene.name, 'Ruínas do Norte');
  assert.equal(created.scene.backgroundAssetId, asset.id);
  assert.equal(created.activeSceneId, created.scene.id);

  const catalog = service.list({ campaignId: campaign.id, userId: 'gm-1' });
  assert.equal(catalog.scenes.length, 1);
  assert.equal(catalog.scenes[0].grid.size, 80);
  assert.equal(catalog.activeSceneId, created.scene.id);

  const saved = repository.snapshot().campaigns.find((item) => item.id === campaign.id);
  assert.equal(saved.scenes[0].name, 'Ruínas do Norte');
  assert.equal(saved.assets[0].id, asset.id);
});

test('CampaignSceneService bloqueia criação de cena por jogador', async () => {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Permissões' });
  const raw = campaignService.getRaw(campaign.id);
  raw.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-1', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.members = structuredClone(raw.members);
  });

  const service = new CampaignSceneService({
    campaignService,
    repository,
    assetStorage: fakeAssetStorage()
  });

  await assert.rejects(
    () => service.uploadMap({
      campaignId: campaign.id,
      userId: 'player-1',
      fileName: 'map.png',
      mimeType: 'image/png',
      dataBase64: Buffer.from('map').toString('base64')
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
