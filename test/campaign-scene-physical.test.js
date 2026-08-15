import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../packages/campaign-scene-service/src/index.js';

function fakeAssetStorage() {
  const files = new Map();
  return {
    async saveImage({ campaignId, fileName, mimeType, dataBase64 }) {
      const id = 'asset-map-1';
      files.set(`${campaignId}:${id}`, Buffer.from(dataBase64, 'base64'));
      return { id, fileName, mimeType, size: files.get(`${campaignId}:${id}`).length, width: 1200, height: 800 };
    },
    async read({ campaignId, assetId }) { return files.get(`${campaignId}:${assetId}`); },
    async delete({ campaignId, assetId }) { files.delete(`${campaignId}:${assetId}`); }
  };
}

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Cena Física' });
  const service = new CampaignSceneService({
    campaignService,
    repository,
    assetStorage: fakeAssetStorage(),
    now: () => Date.parse('2026-08-15T00:30:00Z')
  });
  const asset = await service.uploadMap({
    campaignId: campaign.id,
    userId: 'gm-1',
    fileName: 'templo.webp',
    mimeType: 'image/webp',
    dataBase64: Buffer.from('map').toString('base64')
  });
  const created = await service.createScene({
    campaignId: campaign.id,
    userId: 'gm-1',
    name: 'Templo',
    assetId: asset.id,
    width: 1200,
    height: 800,
    gridSize: 60
  });
  return { repository, campaignService, campaign, service, sceneId: created.scene.id };
}

async function addPlayer(repository, campaignService, campaignId) {
  const campaign = campaignService.getRaw(campaignId);
  campaign.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-1', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaignId);
    stored.members = structuredClone(campaign.members);
  });
  campaignService.refreshFromRepository();
}

test('cena nova nasce com elevação desativada e regiões vazias', async () => {
  const { campaign, service } = await fixture();
  const scene = service.list({ campaignId: campaign.id, userId: 'gm-1' }).scenes[0];
  assert.equal(scene.elevation.enabled, false);
  assert.equal(scene.elevation.unit, 'm');
  assert.deepEqual(scene.regions, []);
});

test('Mestre persiste níveis, paredes com altura e regiões de piso/escada/rampa', async () => {
  const { repository, campaign, service, sceneId } = await fixture();

  await service.updateElevation({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    elevation: {
      enabled: true,
      unit: 'm',
      levelHeight: 3,
      verticalStep: 1,
      defaultWallBottom: 0,
      defaultWallTop: 3,
      levels: [
        { id: 'ground', name: 'Térreo', elevation: 0 },
        { id: 'upper', name: 'Superior', elevation: 3 }
      ]
    }
  });

  await service.updateWalls({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    walls: [{
      id: 'wall-low', kind: 'wall', a: { x: 100, y: 100 }, b: { x: 500, y: 100 },
      bottomElevation: 0, topElevation: 3
    }]
  });

  const updated = await service.updateRegions({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    regions: [
      {
        id: 'floor-ground', name: 'Térreo', kind: 'floor', baseElevation: 0,
        points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 500 }, { x: 0, y: 500 }]
      },
      {
        id: 'stairs-up', name: 'Escada', kind: 'stairs', baseElevation: 0, targetElevation: 3,
        points: [{ x: 500, y: 100 }, { x: 700, y: 100 }, { x: 700, y: 300 }, { x: 500, y: 300 }],
        axis: { start: { x: 500, y: 200 }, end: { x: 700, y: 200 } }
      },
      {
        id: 'ramp-up', name: 'Rampa', kind: 'ramp', baseElevation: 0, targetElevation: 3,
        points: [{ x: 700, y: 100 }, { x: 900, y: 100 }, { x: 900, y: 300 }, { x: 700, y: 300 }],
        axis: { start: { x: 700, y: 200 }, end: { x: 900, y: 200 } }
      }
    ]
  });

  assert.equal(updated.scene.elevation.enabled, true);
  assert.equal(updated.scene.elevation.levels.length, 2);
  assert.equal(updated.scene.regions.length, 3);
  assert.equal(updated.scene.regions[1].kind, 'stairs');
  assert.equal(updated.scene.regions[2].kind, 'ramp');

  const persisted = repository.snapshot().campaigns.find((item) => item.id === campaign.id).scenes[0];
  assert.equal(persisted.elevation.enabled, true);
  assert.equal(persisted.walls[0].bottomElevation, 0);
  assert.equal(persisted.walls[0].topElevation, 3);
  assert.equal(persisted.regions[1].targetElevation, 3);
});

test('jogador não pode alterar elevação nem regiões físicas', async () => {
  const { repository, campaignService, campaign, service, sceneId } = await fixture();
  await addPlayer(repository, campaignService, campaign.id);

  await assert.rejects(
    () => service.updateElevation({ campaignId: campaign.id, userId: 'player-1', sceneId, elevation: { enabled: true } }),
    (error) => error?.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error?.statusCode === 403
  );
  await assert.rejects(
    () => service.updateRegions({ campaignId: campaign.id, userId: 'player-1', sceneId, regions: [] }),
    (error) => error?.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error?.statusCode === 403
  );
});
