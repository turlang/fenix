import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignActorService } from '../packages/campaign-actor-service/src/index.js';
import { CampaignTokenService } from '../packages/campaign-token-service/src/index.js';
import {
  AuthoritativeRealtimeSessionGateway,
  AuthoritativeRealtimeSessionHub
} from '../packages/authoritative-token-runtime/src/index.js';

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({
    ownerUserId: 'gm-1',
    title: 'Tokens persistentes',
    systemId: 'dnd5e'
  });
  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.scenes = [
      { id: 'scene-a', name: 'Pátio', width: 1200, height: 800, tokens: [] },
      { id: 'scene-b', name: 'Torre', width: 900, height: 900, tokens: [] }
    ];
    stored.activeSceneId = 'scene-a';
  });
  campaignService.refreshFromRepository();
  const actorService = new CampaignActorService({ campaignService, repository });
  await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-1',
    actorId: 'actor-ayla',
    sheetId: 'sheet-ayla',
    systemId: 'dnd5e',
    name: 'Ayla',
    sheet: {
      height: 1.72,
      movement: { speeds: { walk: { distance: 9, unit: 'm' } } },
      vision: { eyeHeight: 1.58, senses: { normal: { distance: 12, unit: 'm', enabled: true } } }
    }
  });
  const tokenService = new CampaignTokenService({
    campaignService,
    repository,
    now: () => Date.parse('2026-08-16T04:00:00Z')
  });
  return { repository, campaignService, actorService, tokenService, campaign };
}

test('token de cena persiste identidade e posição fora do snapshot temporário da sessão', async () => {
  const { repository, campaignService, tokenService, campaign } = await fixture();
  const persisted = await tokenService.persistRuntimeToken({
    campaignId: campaign.id,
    sceneId: 'scene-a',
    token: {
      id: 'token-ayla-main',
      tokenId: 'token-ayla-main',
      actorId: 'actor-ayla',
      sheetId: 'sheet-spoof',
      systemId: 'spoof-system',
      name: 'Nome falso',
      x: 315,
      y: 470,
      elevation: 4.5,
      size: 72,
      movementMode: 'ground',
      visible: true
    }
  });

  assert.equal(persisted.tokenId, 'token-ayla-main');
  assert.equal(persisted.actorId, 'actor-ayla');
  assert.equal(persisted.sheetId, 'sheet-ayla');
  assert.equal(persisted.systemId, 'dnd5e');
  assert.equal(persisted.name, 'Ayla');
  assert.equal(persisted.x, 315);
  assert.equal(persisted.y, 470);
  assert.equal(persisted.elevation, 4.5);

  await campaignService.setActiveSession(campaign.id, {
    sessionId: 'session-temp',
    snapshot: { activeScene: { id: 'scene-a' } }
  });
  await campaignService.saveRealtimeSnapshot('session-temp', {
    sessionId: 'session-temp',
    scene: { id: 'scene-a' },
    tokens: [{ id: 'ephemeral' }]
  });
  await campaignService.clearActiveSessionBySessionId('session-temp');
  await campaignService.clearRealtimeSnapshot('session-temp');

  const reloadedCampaignService = new CampaignService({ repository });
  await reloadedCampaignService.initialize();
  const reloadedTokenService = new CampaignTokenService({
    campaignService: reloadedCampaignService,
    repository
  });
  const tokens = reloadedTokenService.listRuntimeForScene({ campaignId: campaign.id, sceneId: 'scene-a' });
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].tokenId, 'token-ayla-main');
  assert.equal(tokens[0].x, 315);
  assert.equal(tokens[0].elevation, 4.5);
  assert.equal(reloadedCampaignService.loadRealtimeSnapshot('session-temp'), null);
});

test('Hub hidrata tokens da cena e remove tokens fantasmas ao trocar de mapa', async () => {
  const sceneTokens = new Map([
    ['scene-a', [{ id: 'token-a', tokenId: 'token-a', actorId: 'actor-a', sheetId: 'sheet-a', systemId: 'generic', x: 100, y: 120, elevation: 0, size: 70 }]],
    ['scene-b', [{ id: 'token-b', tokenId: 'token-b', actorId: 'actor-b', sheetId: 'sheet-b', systemId: 'generic', x: 500, y: 520, elevation: 3, size: 70 }]]
  ]);
  const hub = new AuthoritativeRealtimeSessionHub({
    resolveSceneTokens: ({ sceneId }) => sceneTokens.get(sceneId) ?? []
  });
  const events = [];
  const identity = { clientId: 'gm-client', userId: 'gm-1', displayName: 'GM', role: 'gm', actorId: null };
  hub.connect({ sessionId: 'session-1', identity, send: (event) => events.push(event) });

  hub.applySceneUpdate('session-1', identity, { id: 'scene-a', name: 'A', width: 800, height: 800 });
  assert.deepEqual(hub.getSnapshot('session-1').tokens.map((token) => token.tokenId), ['token-a']);

  hub.applySceneUpdate('session-1', identity, { id: 'scene-b', name: 'B', width: 800, height: 800 });
  const snapshot = hub.getSnapshot('session-1');
  assert.deepEqual(snapshot.tokens.map((token) => token.tokenId), ['token-b']);
  assert.equal(snapshot.tokens.some((token) => token.tokenId === 'token-a'), false);

  const lastSync = events.filter((event) => event.type === 'STATE_SYNC').at(-1);
  assert.deepEqual(lastSync.payload.tokens.map((token) => token.tokenId), ['token-b']);
});

test('Gateway persiste movimento autoritativo do token na cena antes de concluir comando', async () => {
  const persisted = [];
  const hub = new AuthoritativeRealtimeSessionHub({
    resolveActorRuntime: ({ actorId }) => actorId === 'actor-ayla'
      ? { sheetId: 'sheet-ayla', systemId: 'dnd5e', height: 1.72 }
      : null,
    resolveSceneTokens: () => []
  });
  const identity = { clientId: 'gm-client', userId: 'gm-1', displayName: 'GM', role: 'gm', actorId: null };
  hub.applySceneUpdate('session-1', identity, { id: 'scene-a', name: 'A', width: 800, height: 800 });

  const gateway = new AuthoritativeRealtimeSessionGateway({
    hub,
    sessionService: {
      getStatus: () => ({ state: 'COLLECTING_ACTIONS' }),
      processAction: async () => ({}),
      describeRoom: async () => ({})
    },
    authorizePeer: () => identity,
    persistSceneToken: async (entry) => persisted.push(structuredClone(entry))
  });

  const moved = await gateway.handleCommand('session-1', identity, {
    type: 'TOKEN_MOVE',
    commandId: 'move-1',
    payload: {
      token: {
        id: 'token-ayla-main',
        tokenId: 'token-ayla-main',
        actorId: 'actor-ayla',
        sheetId: 'spoof',
        systemId: 'spoof',
        x: 240,
        y: 260,
        elevation: 0,
        size: 70
      }
    }
  });

  assert.equal(moved.token.actorId, 'actor-ayla');
  assert.equal(moved.token.sheetId, 'sheet-ayla');
  assert.equal(moved.token.systemId, 'dnd5e');
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].sceneId, 'scene-a');
  assert.equal(persisted[0].token.x, moved.token.x);
  assert.equal(persisted[0].token.y, moved.token.y);
});
