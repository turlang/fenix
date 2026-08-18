import test from 'node:test';
import assert from 'node:assert/strict';
import { AuthoritativeRealtimeSessionHub } from '../packages/authoritative-token-runtime/src/index.js';
import { createAuthoritativeRuntimeInputHandler } from '../packages/render-runtime-control/src/index.js';

function fixture() {
  const persisted = [];
  const explored = [];
  const actions = [];
  const hub = new AuthoritativeRealtimeSessionHub({ logger: { warn() {} } });
  hub.hydrateSession('session-1', {
    revision: 3,
    scene: {
      id: 'scene-1',
      name: 'Cripta',
      width: 700,
      height: 560,
      grid: { size: 70, type: 'square' },
      walls: [],
      elevation: { enabled: false },
      regions: [],
      lighting: { enabled: false, sources: [] }
    },
    tokens: [{
      tokenId: 'token-1',
      id: 'token-1',
      actorId: 'actor-1',
      sheetId: 'sheet-1',
      systemId: 'generic',
      x: 100,
      y: 120,
      elevation: 0,
      rotation: 0,
      size: 70,
      height: 1.8,
      visible: true
    }]
  });

  const sessionService = {
    async assertOwnership({ sessionId }) {
      assert.equal(sessionId, 'session-1');
      return { campaignId: 'campaign-1', sessionId: 'session-1' };
    },
    getStatus() {
      return { state: 'COLLECTING_ACTIONS', sessionId: 'session-1', campaignId: 'campaign-1' };
    },
    async processAction(payload) {
      actions.push(payload);
      return { narration: 'A ação foi recebida.' };
    },
    async describeRoom() {
      return null;
    }
  };
  const campaignService = {
    findCampaignBySessionId(sessionId) {
      return sessionId === 'session-1' ? { id: 'campaign-1' } : null;
    }
  };
  const tokenService = {
    async persistRuntimeToken(payload) {
      persisted.push(payload);
      return payload.token;
    }
  };
  const explorationService = {
    async recordExploration(payload) {
      explored.push(payload);
      return payload;
    }
  };
  const handler = createAuthoritativeRuntimeInputHandler({
    sessionService,
    realtimeHub: hub,
    campaignService,
    tokenService,
    explorationService,
    logger: { warn() {} }
  });
  const record = {
    renderSessionId: 'render-1',
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    requestedByUserId: 'player-1'
  };
  return { hub, handler, record, persisted, explored, actions };
}

test('3D move becomes a requested step and Core returns the authoritative token state', async () => {
  const { hub, handler, record, persisted, explored } = fixture();
  const result = await handler({
    record,
    controlId: 'control-1',
    yawDegrees: 0,
    input: {
      renderSessionId: 'render-1',
      sequence: 1,
      intent: { type: 'move', forward: 1, strafe: 0, run: false }
    }
  });

  assert.equal(result.schema, 'fenix.3d-runtime-state-sync');
  assert.equal(result.token.tokenId, 'token-1');
  assert.equal(result.token.x, 100);
  assert.equal(result.token.y, 106);
  assert.equal(result.revision, 4);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].token.y, 106);
  assert.equal(explored.length, 1);
  assert.equal(explored[0].actorId, 'actor-1');
  assert.equal(hub.getSnapshot('session-1').tokens[0].y, 106);
});

test('3D look can rotate the own token but cannot replace actor identity', async () => {
  const { handler, record } = fixture();
  const result = await handler({
    record,
    controlId: 'control-1',
    yawDegrees: 90,
    input: {
      renderSessionId: 'render-1',
      sequence: 2,
      intent: { type: 'look', yaw: 90, pitch: -8 }
    }
  });
  assert.equal(result.token.actorId, 'actor-1');
  assert.equal(result.token.rotation, 90);
  assert.equal(result.token.x, 100);
  assert.equal(result.token.y, 120);
});

test('3D action routes through the session runtime using the actor fixed by the broker', async () => {
  const { handler, record, actions } = fixture();
  const result = await handler({
    record,
    controlId: 'control-1',
    input: {
      renderSessionId: 'render-1',
      sequence: 3,
      intent: { type: 'action', action: 'Examino a porta.', targetId: 'door-1' }
    }
  });
  assert.equal(result.schema, 'fenix.3d-runtime-action-result');
  assert.equal(result.accepted, true);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actorId, 'actor-1');
  assert.equal(actions[0].sessionId, 'session-1');
  assert.match(actions[0].content, /Examino a porta/);
});

test('runtime control fails closed if active scene or authoritative token no longer matches', async () => {
  const { hub, handler, record } = fixture();
  hub.hydrateSession('session-1', {
    scene: { id: 'scene-2', width: 700, height: 560, grid: { size: 70 }, walls: [] },
    tokens: [{ tokenId: 'token-1', actorId: 'actor-1', x: 100, y: 120, size: 70 }]
  });
  await assert.rejects(
    () => handler({
      record,
      controlId: 'control-1',
      input: { renderSessionId: 'render-1', sequence: 4, intent: { type: 'move', forward: 1, strafe: 0 } }
    }),
    (error) => error?.code === 'FENIX_3D_RUNTIME_SCENE_STALE' && error?.statusCode === 409
  );
});
