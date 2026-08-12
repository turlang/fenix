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

async function createServiceFixture(title = 'Teste de Mapas') {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title });
  const service = new CampaignSceneService({
    campaignService,
    repository,
    assetStorage: fakeAssetStorage(),
    now: () => Date.parse('2026-08-12T20:00:00Z')
  });
  return { repository, campaignService, campaign, service };
}

async function createMapScene(service, campaignId) {
  const asset = await service.uploadMap({
    campaignId,
    userId: 'gm-1',
    fileName: 'dungeon.webp',
    mimeType: 'image/webp',
    dataBase64: Buffer.from('map-bytes').toString('base64')
  });
  return service.createScene({
    campaignId,
    userId: 'gm-1',
    name: 'Ruínas do Norte',
    description: 'Um salão de pedra iluminado por duas tochas.',
    assetId: asset.id,
    width: 2048,
    height: 1536,
    gridSize: 80
  });
}

test('CampaignSceneService persiste asset, cria cena e ativa cena da campanha', async () => {
  const { repository, campaign, service } = await createServiceFixture();
  const created = await createMapScene(service, campaign.id);
  assert.equal(created.scene.name, 'Ruínas do Norte');
  assert.equal(created.activeSceneId, created.scene.id);
  assert.equal(created.scene.grid.size, 80);
  assert.equal(created.scene.grid.offsetX, 0);
  assert.equal(created.scene.grid.offsetY, 0);
  assert.equal(created.scene.grid.visible, true);

  const catalog = service.list({ campaignId: campaign.id, userId: 'gm-1' });
  assert.equal(catalog.scenes.length, 1);
  assert.equal(catalog.activeSceneId, created.scene.id);

  const saved = repository.snapshot().campaigns.find((item) => item.id === campaign.id);
  assert.equal(saved.scenes[0].name, 'Ruínas do Norte');
  assert.equal(saved.assets[0].id, created.scene.backgroundAssetId);
});

test('CampaignSceneService persiste tamanho, offset e visibilidade da grade calibrada', async () => {
  const { repository, campaign, service } = await createServiceFixture('Calibração');
  const created = await createMapScene(service, campaign.id);
  const updated = await service.updateGrid({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId: created.scene.id,
    size: 72,
    offsetX: -13.5,
    offsetY: 22.25,
    visible: false
  });

  assert.deepEqual(updated.scene.grid, {
    size: 72,
    type: 'square',
    offsetX: -13.5,
    offsetY: 22.25,
    visible: false
  });
  const persisted = repository.snapshot().campaigns.find((item) => item.id === campaign.id).scenes[0];
  assert.deepEqual(persisted.grid, updated.scene.grid);
});

test('CampaignSceneService bloqueia criação e calibração de cena por jogador', async () => {
  const { repository, campaignService, campaign, service } = await createServiceFixture('Permissões');
  const created = await createMapScene(service, campaign.id);
  const raw = campaignService.getRaw(campaign.id);
  raw.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-1', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.members = structuredClone(raw.members);
  });
  campaignService.refreshFromRepository();

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

  await assert.rejects(
    () => service.updateGrid({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId: created.scene.id,
      size: 60
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
