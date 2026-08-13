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

function sceneElevation(enabled = true) {
  return {
    enabled,
    unit: 'm',
    levelHeight: 3,
    verticalStep: 1,
    defaultWallBottom: 0,
    defaultWallTop: 3,
    levels: [
      { id: 'ground', name: 'Térreo', elevation: 0 },
      { id: 'bridge', name: 'Ponte', elevation: 4 }
    ]
  };
}

test('Mestre persiste perfil individual de visão, voo e níveis; jogador recebe o estado público', async () => {
  const { campaign, service, sceneId } = await fixture();
  const configured = await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    visionRangeCells: 2,
    sceneElevation: sceneElevation(true),
    visionProfiles: {
      'hero-ayla': {
        mode: 'darkvision',
        rangeCells: 5,
        elevation: 4,
        height: 1.8,
        movementMode: 'flying',
        personalLight: { enabled: true, radiusCells: 4, intensity: 0.8, color: '#ffaa55' }
      }
    }
  });

  assert.equal(configured.scene.visionProfiles['hero-ayla'].mode, 'darkvision');
  assert.equal(configured.scene.visionProfiles['hero-ayla'].rangeCells, 5);
  assert.equal(configured.scene.visionProfiles['hero-ayla'].elevation, 4);
  assert.equal(configured.scene.visionProfiles['hero-ayla'].height, 1.8);
  assert.equal(configured.scene.visionProfiles['hero-ayla'].movementMode, 'flying');
  assert.equal(configured.scene.visionProfiles['hero-ayla'].personalLight.enabled, true);
  assert.equal(configured.scene.elevation.enabled, true);
  assert.equal(configured.scene.elevation.levels[1].name, 'Ponte');

  const playerScene = service.list({ campaignId: campaign.id, userId: 'player-1' }).scenes[0];
  assert.equal(playerScene.visionProfiles['hero-ayla'].mode, 'darkvision');
  assert.equal(playerScene.elevation.enabled, true);
});

test('resolver interno entrega perfil e configuração vertical autoritativos para o realtime', async () => {
  const { campaign, service, sceneId } = await fixture();
  await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    sceneElevation: sceneElevation(true),
    visionProfiles: {
      'hero-ayla': { elevation: 4, height: 2, movementMode: 'flying', rangeCells: 6 }
    }
  });
  const vertical = service.resolveRuntimeVerticalState({ campaignId: campaign.id, sceneId, actorId: 'hero-ayla' });
  assert.equal(vertical.sceneElevation.enabled, true);
  assert.equal(vertical.sceneElevation.verticalStep, 1);
  assert.equal(vertical.profile.elevation, 4);
  assert.equal(vertical.profile.height, 2);
  assert.equal(vertical.profile.movementMode, 'flying');
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

test('exploração vertical usa Z autoritativo e enxerga sobre parede baixa', async () => {
  const { campaign, service, sceneId } = await fixture();
  await service.updateWalls({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    walls: [{
      id: 'low-wall', kind: 'wall',
      a: { x: 140, y: 0 }, b: { x: 140, y: 280 },
      bottomElevation: 0, topElevation: 3
    }]
  });
  await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    visionRangeCells: 4,
    sceneElevation: sceneElevation(true),
    visionProfiles: {
      'hero-ayla': { mode: 'normal', rangeCells: 4, elevation: 4, height: 1.8, movementMode: 'ground' }
    },
    resetExploration: true
  });
  const high = await service.recordExploration({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId,
    actorId: 'hero-ayla',
    x: 70,
    y: 105,
    elevation: 4
  });
  assert.ok(high.discoveredCells.includes('2:1'), 'olhos acima do topo devem revelar além da parede baixa');

  await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    visionProfiles: {
      'hero-ayla': { mode: 'normal', rangeCells: 4, elevation: 0, height: 1.8, movementMode: 'ground' }
    },
    resetExploration: true
  });
  const low = await service.recordExploration({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId,
    actorId: 'hero-ayla',
    x: 70,
    y: 105,
    elevation: 0
  });
  assert.equal(low.discoveredCells.includes('2:1'), false, 'no térreo a mesma parede deve ocluir a exploração');
});

test('jogador não pode alterar perfis nem configuração de níveis porque updateFog continua GM-only', async () => {
  const { campaign, service, sceneId } = await fixture();
  await assert.rejects(
    () => service.updateFog({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId,
      sceneElevation: sceneElevation(false),
      visionProfiles: { 'hero-ayla': { mode: 'darkvision', rangeCells: 60, elevation: 999, movementMode: 'flying' } }
    }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
