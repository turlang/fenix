import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignActorService } from '../packages/campaign-actor-service/src/index.js';
import { CampaignExplorationService } from '../packages/campaign-exploration-service/src/index.js';
import { AuthoritativeRealtimeSessionHub } from '../packages/authoritative-token-runtime/src/index.js';

const gm = Object.freeze({ clientId: 'gm-1', userId: 'gm-user', role: 'gm', actorId: null });
const player = Object.freeze({ clientId: 'player-1', userId: 'player-user', role: 'player', actorId: 'hero-ayla' });

async function createCampaignVisionFixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({
    ownerUserId: 'gm-user',
    title: 'Visão autoritativa',
    systemId: 'generic'
  });
  const actorService = new CampaignActorService({ campaignService, repository });

  await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-user',
    actorId: 'short-sight',
    name: 'Curta',
    sheet: {
      height: 1.7,
      movement: { unit: 'm', speeds: { walk: 9 }, defaultMode: 'walk' },
      vision: { unit: 'm', eyeHeight: 1.5, senses: { normal: 3 } }
    }
  });
  await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-user',
    actorId: 'long-sight',
    name: 'Longa',
    sheet: {
      height: 1.9,
      movement: { unit: 'm', speeds: { walk: 9 }, defaultMode: 'walk' },
      vision: { unit: 'm', eyeHeight: 1.7, senses: { normal: 12 } }
    }
  });

  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.scenes = [{
      id: 'scene-vision',
      name: 'Salão',
      width: 1000,
      height: 1000,
      scale: { distancePerCell: 1.5, unit: 'm' },
      grid: { size: 50, offsetX: 0, offsetY: 0, visible: true },
      walls: [],
      elevation: { enabled: false, unit: 'm' },
      fog: {
        enabled: true,
        visionRangeCells: 60,
        exploredOpacity: 0.55,
        unexploredOpacity: 0.94,
        exploredByActor: {}
      },
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }];
    stored.activeSceneId = 'scene-vision';
  });
  campaignService.refreshFromRepository();

  return {
    repository,
    campaignService,
    actorService,
    explorationService: new CampaignExplorationService({ campaignService, actorService, repository }),
    campaignId: campaign.id
  };
}

test('exploração usa alcance da ficha e ignora alcance global exagerado do Fog', async () => {
  const fixture = await createCampaignVisionFixture();
  const short = await fixture.explorationService.record({
    campaignId: fixture.campaignId,
    userId: 'gm-user',
    sceneId: 'scene-vision',
    actorId: 'short-sight',
    x: 500,
    y: 500
  });
  const long = await fixture.explorationService.record({
    campaignId: fixture.campaignId,
    userId: 'gm-user',
    sceneId: 'scene-vision',
    actorId: 'long-sight',
    x: 500,
    y: 500
  });

  assert.equal(short.visionSource, 'actor-sheet');
  assert.equal(long.visionSource, 'actor-sheet');
  assert.ok(short.discoveredCells.length > 0);
  assert.ok(long.discoveredCells.length > short.discoveredCells.length);
  assert.ok(short.discoveredCells.length < 100, '3m não pode herdar o alcance legado de 60 células');
});

test('runtime reaplica ficha do servidor e rejeita spoof visual do navegador', () => {
  const hub = new AuthoritativeRealtimeSessionHub({
    resolveActorRuntime: ({ actorId }) => actorId === 'hero-ayla' ? {
      sheetId: 'sheet-server',
      systemId: 'dnd5e',
      height: 1.65,
      vision: { unit: 'm', eyeHeight: 1.5, preferredSense: 'darkvision', senses: { normal: 12, darkvision: 18 } }
    } : null
  });
  hub.applySceneUpdate('session-1', gm, {
    id: 'scene-1',
    name: 'Cripta',
    width: 600,
    height: 400,
    grid: { size: 50 },
    walls: [],
    lighting: { enabled: false, sources: [] },
    elevation: { enabled: false },
    regions: []
  });

  const seeded = hub.applyTokenMove('session-1', gm, {
    token: {
      id: 'token-ayla',
      actorId: 'hero-ayla',
      sheetId: 'sheet-forged',
      systemId: 'forged-system',
      height: 19,
      vision: { unit: 'm', senses: { normal: 999 } },
      x: 100,
      y: 100
    }
  });
  assert.equal(seeded.token.sheetId, 'sheet-server');
  assert.equal(seeded.token.systemId, 'dnd5e');
  assert.equal(seeded.token.height, 1.65);
  assert.equal(seeded.token.vision.preferredSense, 'darkvision');
  assert.equal(seeded.token.vision.senses.darkvision.distance, 18);

  const moved = hub.applyTokenMove('session-1', player, {
    token: {
      id: 'token-ayla',
      x: 140,
      y: 100,
      height: 20,
      vision: { unit: 'm', senses: { normal: 5000 } }
    }
  });
  assert.equal(moved.token.height, 1.65);
  assert.equal(moved.token.vision.senses.darkvision.distance, 18);
});

test('composition root e overlay usam a mesma autoridade de visão', async () => {
  const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  const overlay = await readFile(new URL('../apps/fenix-vtt/components/fog-of-war-overlay.jsx', import.meta.url), 'utf8');
  const fogCss = await readFile(new URL('../apps/fenix-vtt/app/fog-of-war.css', import.meta.url), 'utf8');

  assert.match(server, /CampaignActorService/);
  assert.match(server, /CampaignExplorationService/);
  assert.match(server, /resolveActorRuntime/);
  assert.match(server, /explorationService\.record/);
  assert.match(server, /actorService,/);

  assert.match(overlay, /token\.actorId === actorId/);
  assert.match(overlay, /visionProfile: actorToken\.vision \?\? null/);
  assert.match(overlay, /resolveVisionForScene/);
  assert.match(overlay, /originElevation: actorToken\.elevation \?\? 0/);
  assert.match(overlay, /elevationEnabled: scene\.elevation\?\.enabled === true/);

  assert.match(fogCss, /Ficha \+ Sistema RPG/);
  assert.match(fogCss, /label:nth-of-type\(2\)/);
});
