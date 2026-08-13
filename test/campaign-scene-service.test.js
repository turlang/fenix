import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../packages/campaign-scene-service/src/index.js';

function fakeAssetStorage() {
  const files = new Map();
  async function saveBuffer({ campaignId, assetId = 'asset-map-1', fileName, mimeType, buffer }) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
    files.set(`${campaignId}:${assetId}`, bytes);
    return { id: assetId, fileName, mimeType, size: bytes.length };
  }
  return {
    async saveImage({ campaignId, assetId = 'asset-map-1', fileName, mimeType, dataBase64 }) {
      return saveBuffer({ campaignId, assetId, fileName, mimeType, buffer: Buffer.from(dataBase64, 'base64') });
    },
    saveImageBuffer: saveBuffer,
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

async function createServiceFixture(title = 'Teste de Mapas', { remoteMapImporter = null } = {}) {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title });
  const service = new CampaignSceneService({
    campaignService,
    repository,
    assetStorage: fakeAssetStorage(),
    remoteMapImporter,
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
  assert.deepEqual(created.scene.walls, []);

  const catalog = service.list({ campaignId: campaign.id, userId: 'gm-1' });
  assert.equal(catalog.scenes.length, 1);
  assert.equal(catalog.activeSceneId, created.scene.id);

  const saved = repository.snapshot().campaigns.find((item) => item.id === campaign.id);
  assert.equal(saved.scenes[0].name, 'Ruínas do Norte');
  assert.equal(saved.assets[0].id, created.scene.backgroundAssetId);
});

test('CampaignSceneService importa mapa remoto como asset local sem persistir URL completa', async () => {
  const remoteMapImporter = {
    async importUrl(url) {
      assert.equal(url, 'https://cdn.example.com/maps/templo.png?token=segredo');
      return {
        buffer: Buffer.from('remote-map'),
        mimeType: 'image/png',
        fileName: 'templo.png',
        width: 2400,
        height: 1600,
        sourceHost: 'cdn.example.com'
      };
    }
  };
  const { repository, campaign, service } = await createServiceFixture('Import URL', { remoteMapImporter });
  const asset = await service.importMapUrl({
    campaignId: campaign.id,
    userId: 'gm-1',
    url: 'https://cdn.example.com/maps/templo.png?token=segredo'
  });
  assert.equal(asset.sourceType, 'remote-import');
  assert.equal(asset.sourceHost, 'cdn.example.com');
  assert.equal(asset.width, 2400);
  assert.equal(asset.height, 1600);
  assert.equal(JSON.stringify(repository.snapshot()).includes('token=segredo'), false);

  const scene = await service.createScene({
    campaignId: campaign.id,
    userId: 'gm-1',
    name: 'Templo Remoto',
    description: 'Mapa importado por URL.',
    assetId: asset.id,
    gridSize: 70
  });
  assert.equal(scene.scene.width, 2400);
  assert.equal(scene.scene.height, 1600);
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

test('CampaignSceneService persiste paredes e portas normalizadas na cena', async () => {
  const { repository, campaign, service } = await createServiceFixture('Paredes');
  const created = await createMapScene(service, campaign.id);
  const updated = await service.updateWalls({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId: created.scene.id,
    walls: [
      { id: 'wall-1', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
      { id: 'door-1', kind: 'door', doorState: 'locked', a: { x: 400, y: 0 }, b: { x: 480, y: 0 } }
    ]
  });

  assert.equal(updated.scene.walls.length, 2);
  assert.equal(updated.scene.walls[0].kind, 'wall');
  assert.equal(updated.scene.walls[1].kind, 'door');
  assert.equal(updated.scene.walls[1].doorState, 'locked');
  const persisted = repository.snapshot().campaigns.find((item) => item.id === campaign.id).scenes[0];
  assert.deepEqual(persisted.walls, updated.scene.walls);
});

test('CampaignSceneService bloqueia criação, importação, calibração e paredes por jogador', async () => {
  const remoteMapImporter = { async importUrl() { throw new Error('não deveria executar'); } };
  const { repository, campaignService, campaign, service } = await createServiceFixture('Permissões', { remoteMapImporter });
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
    () => service.importMapUrl({
      campaignId: campaign.id,
      userId: 'player-1',
      url: 'https://example.com/map.png'
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

  await assert.rejects(
    () => service.updateWalls({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId: created.scene.id,
      walls: [{ id: 'forbidden', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
