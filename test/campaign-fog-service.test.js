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
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'Fog Test' });
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
    name: 'Cripta',
    assetId: asset.id,
    width: 420,
    height: 280,
    gridSize: 70
  });
  await service.updateWalls({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId: created.scene.id,
    walls: [{ id: 'wall-1', kind: 'wall', a: { x: 140, y: 0 }, b: { x: 140, y: 280 } }]
  });

  const raw = campaignService.getRaw(campaign.id);
  raw.members.push({ userId: 'player-1', role: 'player', actorId: 'hero-ayla', joinedAt: new Date().toISOString() });
  await repository.mutate((draft) => {
    draft.campaigns.find((item) => item.id === campaign.id).members = structuredClone(raw.members);
  });
  campaignService.refreshFromRepository();
  return { repository, campaignService, campaign, service, sceneId: created.scene.id };
}

async function exploreFixture(service, campaignId, sceneId) {
  await service.updateFog({ campaignId, userId: 'gm-1', sceneId, enabled: true });
  return service.recordExploration({
    campaignId,
    userId: 'player-1',
    sceneId,
    actorId: 'hero-ayla',
    x: 70,
    y: 105
  });
}

test('Fog persiste configuração, exploração por ator e mantém histórico privado para jogador', async () => {
  const { campaign, service, sceneId } = await fixture();
  const configured = await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    enabled: true,
    visionRangeCells: 4,
    exploredOpacity: 0.5,
    unexploredOpacity: 0.95
  });
  assert.equal(configured.scene.fog.enabled, true);
  assert.equal(configured.scene.fog.visionRangeCells, 4);

  const explored = await service.recordExploration({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId,
    actorId: 'hero-ayla',
    x: 70,
    y: 105
  });
  assert.equal(explored.changed, true);
  assert.ok(explored.totalExploredCells > 0);

  const playerScene = service.list({ campaignId: campaign.id, userId: 'player-1' }).scenes[0];
  assert.ok(Array.isArray(playerScene.fog.exploredCells));
  assert.equal('exploredByActor' in playerScene.fog, false);
  assert.equal(playerScene.fog.exploredCells.includes('2:1'), false, 'parede não deve revelar célula atrás dela');

  const gmScene = service.list({ campaignId: campaign.id, userId: 'gm-1' }).scenes[0];
  assert.ok(Array.isArray(gmScene.fog.exploredByActor['hero-ayla']));
});

test('jogador não configura Fog nem registra exploração para outro personagem', async () => {
  const { campaign, service, sceneId } = await fixture();
  await assert.rejects(
    () => service.updateFog({ campaignId: campaign.id, userId: 'player-1', sceneId, enabled: true }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
  await assert.rejects(
    () => service.recordExploration({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId,
      actorId: 'hero-dorian',
      x: 70,
      y: 105
    }),
    (error) => error.code === 'CAMPAIGN_FOG_ACTOR_FORBIDDEN' && error.statusCode === 403
  );
});

test('reset do Fog limpa exploração persistida', async () => {
  const { campaign, service, sceneId } = await fixture();
  await exploreFixture(service, campaign.id, sceneId);
  const reset = await service.updateFog({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    resetExploration: true
  });
  assert.deepEqual(reset.scene.fog.exploredByActor, {});
});

test('alterar geometria da grade limpa exploração; ocultar grade preserva memória', async () => {
  const { campaign, service, sceneId } = await fixture();
  await exploreFixture(service, campaign.id, sceneId);

  const visibilityOnly = await service.updateGrid({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    visible: false
  });
  assert.ok(visibilityOnly.scene.fog.exploredByActor['hero-ayla']?.length > 0);

  const recalibrated = await service.updateGrid({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId,
    size: 68,
    offsetX: 4,
    offsetY: -2
  });
  assert.deepEqual(recalibrated.scene.fog.exploredByActor, {});
});
