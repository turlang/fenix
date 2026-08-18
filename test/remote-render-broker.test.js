import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignActorService } from '../packages/campaign-actor-service/src/index.js';
import { CampaignTokenService } from '../packages/campaign-token-service/src/index.js';
import { RenderNodeGateway, createHttpRenderNode } from '../packages/render-node-gateway/src/index.js';
import { RemoteRenderBrokerService } from '../packages/remote-render-broker/src/index.js';

async function fixture() {
  const repository = new InMemoryFenixRepository();
  await repository.initialize();
  const campaignService = new CampaignService({ repository });
  await campaignService.initialize();
  const campaign = await campaignService.createCampaign({ ownerUserId: 'gm-1', title: 'First Person Cloud', systemId: 'dnd5e' });

  await repository.mutate((draft) => {
    const stored = draft.campaigns.find((item) => item.id === campaign.id);
    stored.scenes = [{ id: 'scene-1', name: 'Cripta', width: 1200, height: 800, tokens: [] }];
    stored.activeSceneId = 'scene-1';
    stored.members.push({ userId: 'player-1', role: 'player', actorId: 'actor-ayla', joinedAt: new Date().toISOString() });
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
    sheet: { height: 1.72, vision: { eyeHeight: 1.58, senses: { normal: { distance: 12, unit: 'm', enabled: true } } } }
  });
  await actorService.upsert({
    campaignId: campaign.id,
    userId: 'gm-1',
    actorId: 'actor-dorian',
    sheetId: 'sheet-dorian',
    systemId: 'dnd5e',
    name: 'Dorian',
    sheet: { height: 1.85 }
  });

  const tokenService = new CampaignTokenService({ campaignService, repository });
  await tokenService.persistRuntimeToken({
    campaignId: campaign.id,
    sceneId: 'scene-1',
    token: { tokenId: 'token-ayla', id: 'token-ayla', actorId: 'actor-ayla', x: 100, y: 120, elevation: 0, size: 70 }
  });
  await tokenService.persistRuntimeToken({
    campaignId: campaign.id,
    sceneId: 'scene-1',
    token: { tokenId: 'token-dorian', id: 'token-dorian', actorId: 'actor-dorian', x: 200, y: 220, elevation: 0, size: 70 }
  });

  const lifecycle = { created: [], ended: [] };
  const renderGateway = new RenderNodeGateway({ logger: { warn() {} } });
  renderGateway.register({
    id: 'gpu-render-01',
    region: 'br-1',
    priority: 10,
    health: async () => ({ ok: true, available: true }),
    createSession: async (request) => {
      lifecycle.created.push(request);
      return {
        renderSessionId: `render-${request.actorId}`,
        signallingUrl: `wss://stream.example/${request.actorId}`,
        renderer: 'unreal-pixel-streaming',
        expiresAt: '2026-08-18T03:00:00Z'
      };
    },
    endSession: async ({ renderSessionId }) => lifecycle.ended.push(renderSessionId)
  });

  const broker = new RemoteRenderBrokerService({ campaignService, actorService, tokenService, renderGateway, now: () => Date.parse('2026-08-18T02:30:00Z') });
  return { repository, campaignService, actorService, tokenService, campaign, renderGateway, broker, lifecycle };
}

test('GM cria sessão First Person para token persistente e recebe somente descritor público', async () => {
  const { campaign, broker, lifecycle } = await fixture();
  const result = await broker.create({
    campaignId: campaign.id,
    userId: 'gm-1',
    sceneId: 'scene-1',
    actorId: 'actor-ayla',
    tokenId: 'token-ayla',
    targetFps: 60
  });

  assert.equal(result.renderSessionId, 'render-actor-ayla');
  assert.equal(result.actorId, 'actor-ayla');
  assert.equal(result.tokenId, 'token-ayla');
  assert.equal(result.descriptor.transport, 'webrtc');
  assert.equal(result.descriptor.renderer, 'unreal-pixel-streaming');
  assert.equal(Object.hasOwn(result, 'nodeId'), false);
  assert.equal(Object.hasOwn(result.descriptor, 'authToken'), false);
  assert.equal(Object.hasOwn(result.descriptor, 'baseUrl'), false);
  assert.equal(lifecycle.created[0].renderMode, 'cloud');
  assert.equal(lifecycle.created[0].viewMode, 'first-person');
});

test('jogador pode abrir primeira pessoa apenas para o próprio ator', async () => {
  const { campaign, broker } = await fixture();
  const own = await broker.create({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId: 'scene-1',
    actorId: 'actor-ayla',
    tokenId: 'token-ayla'
  });
  assert.equal(own.actorId, 'actor-ayla');

  await assert.rejects(
    () => broker.create({
      campaignId: campaign.id,
      userId: 'player-1',
      sceneId: 'scene-1',
      actorId: 'actor-dorian',
      tokenId: 'token-dorian'
    }),
    (error) => error?.code === 'FENIX_RENDER_ACTOR_FORBIDDEN' && error?.statusCode === 403
  );
});

test('broker rejeita token que não corresponde ao ator solicitado', async () => {
  const { campaign, broker } = await fixture();
  await assert.rejects(
    () => broker.create({
      campaignId: campaign.id,
      userId: 'gm-1',
      sceneId: 'scene-1',
      actorId: 'actor-ayla',
      tokenId: 'token-dorian'
    }),
    (error) => error?.code === 'FENIX_RENDER_TOKEN_ACTOR_MISMATCH' && error?.statusCode === 409
  );
});

test('encerrar sessão libera o Render Node e remove a sessão do broker', async () => {
  const { campaign, broker, lifecycle } = await fixture();
  const created = await broker.create({
    campaignId: campaign.id,
    userId: 'player-1',
    sceneId: 'scene-1',
    actorId: 'actor-ayla',
    tokenId: 'token-ayla'
  });
  const ended = await broker.end({
    campaignId: campaign.id,
    userId: 'player-1',
    renderSessionId: created.renderSessionId
  });
  assert.deepEqual(ended, { renderSessionId: 'render-actor-ayla', ended: true });
  assert.deepEqual(lifecycle.ended, ['render-actor-ayla']);
  assert.throws(
    () => broker.get({ campaignId: campaign.id, userId: 'player-1', renderSessionId: created.renderSessionId }),
    (error) => error?.code === 'FENIX_RENDER_SESSION_NOT_FOUND'
  );
});

test('HTTP Render Node usa credencial interna no App Server e implementa health/create/delete', async () => {
  const calls = [];
  const node = createHttpRenderNode({
    id: 'render-http-01',
    baseUrl: 'http://gpu-render.internal:9000',
    authToken: 'internal-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, method: options.method, authorization: options.headers.Authorization, body: options.body });
      if (String(url).endsWith('/health')) {
        return { ok: true, status: 200, async json() { return { status: 'ok', available: true }; } };
      }
      if (options.method === 'POST') {
        return { ok: true, status: 201, async json() { return { renderSessionId: 'render-http', signallingUrl: 'wss://public-stream/session/render-http' }; } };
      }
      return { ok: true, status: 200, async json() { return { ended: true }; } };
    }
  });

  assert.deepEqual(await node.health(), { ok: true, available: true });
  const created = await node.createSession({ campaignId: 'c1', sceneId: 's1', actorId: 'a1' });
  assert.equal(created.renderSessionId, 'render-http');
  await node.endSession({ renderSessionId: 'render-http' });

  assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'DELETE']);
  assert.ok(calls.every((call) => call.authorization === 'Bearer internal-secret'));
  assert.equal(calls[1].url, 'http://gpu-render.internal:9000/v1/render-sessions');
  assert.equal(calls[2].url, 'http://gpu-render.internal:9000/v1/render-sessions/render-http');
});
