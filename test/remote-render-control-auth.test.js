import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteRenderBrokerService } from '../packages/remote-render-broker/src/index.js';

function fixture() {
  const internalRequests = [];
  const handledInputs = [];
  const campaign = {
    id: 'campaign-1',
    title: 'Cripta',
    systemId: 'generic',
    scenes: [{
      id: 'scene-1',
      name: 'Cripta',
      width: 700,
      height: 560,
      grid: { size: 70, distancePerCell: 1.5, unit: 'm' },
      walls: [],
      regions: [],
      elevation: { enabled: false, unit: 'm', levels: [] },
      lighting: { enabled: false, sources: [] },
      fog: { enabled: false, exploredByActor: {} }
    }]
  };
  const token = {
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
  };
  const actor = {
    id: 'actor-1',
    actorId: 'actor-1',
    sheetId: 'sheet-1',
    systemId: 'generic',
    name: 'Ayla',
    sheet: { height: 1.8, vision: { eyeHeight: 1.6, senses: { normal: 12 } } },
    resolved: {
      movement: { speeds: { walk: { distance: 9, unit: 'm' } }, defaultMode: 'walk' },
      vision: { eyeHeight: 1.6, senses: { normal: { distance: 12, unit: 'm', enabled: true } }, preferredSense: 'normal' },
      footprint: { widthCells: 1, heightCells: 1 }
    }
  };
  const campaignService = {
    requireRole(campaignId, userId) {
      assert.equal(campaignId, 'campaign-1');
      return { campaign, membership: { userId, role: 'player', actorId: 'actor-1' } };
    }
  };
  const actorService = { get: () => actor };
  const tokenService = {
    listRuntimeForScene: () => [token],
    list: () => [token]
  };
  const renderGateway = {
    list: () => [{ id: 'gpu-1' }],
    async createSession(request) {
      internalRequests.push(request);
      return {
        nodeId: 'gpu-1',
        descriptor: {
          renderSessionId: 'render-1',
          transport: 'webrtc',
          playerUrl: 'https://stream.example/player/render-1',
          signallingUrl: 'wss://stream.example/signalling/render-1',
          renderer: 'unreal-pixel-streaming',
          region: 'br-1'
        }
      };
    },
    async endSession() {
      return { ended: true };
    }
  };
  const broker = new RemoteRenderBrokerService({
    campaignService,
    actorService,
    tokenService,
    renderGateway,
    runtimeControlBaseUrl: 'https://api.internal.example',
    runtimeInputHandler: async (payload) => {
      handledInputs.push(payload);
      return { accepted: true, sequence: payload.input.sequence };
    },
    now: () => Date.parse('2026-08-18T12:00:00Z')
  });
  return { broker, internalRequests, handledInputs };
}

test('broker sends scoped control credential only through the internal Render Node request', async () => {
  const { broker, internalRequests } = fixture();
  const publicSession = await broker.create({
    campaignId: 'campaign-1',
    userId: 'player-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    sessionId: 'session-1'
  });

  assert.equal(internalRequests.length, 1);
  const control = internalRequests[0].runtimeControl;
  assert.ok(control.controlId);
  assert.match(control.inputUrl, /^https:\/\/api\.internal\.example\/v1\/runtime\/render-control\//);
  assert.ok(control.accessToken.length >= 32);
  assert.equal(JSON.stringify(publicSession).includes(control.controlId), false);
  assert.equal(JSON.stringify(publicSession).includes(control.accessToken), false);
  assert.equal(Object.hasOwn(publicSession.descriptor, 'runtimeControl'), false);
});

test('runtime control rejects wrong secret and accepts the scoped secret with monotonic sequence', async () => {
  const { broker, internalRequests, handledInputs } = fixture();
  await broker.create({
    campaignId: 'campaign-1',
    userId: 'player-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    sessionId: 'session-1'
  });
  const control = internalRequests[0].runtimeControl;

  await assert.rejects(
    () => broker.handleRuntimeInput({
      controlId: control.controlId,
      accessToken: 'wrong-secret-that-is-long-enough',
      input: { sequence: 1, intent: { type: 'move', forward: 1, strafe: 0 } }
    }),
    (error) => error?.code === 'FENIX_RENDER_CONTROL_UNAUTHORIZED' && error?.statusCode === 401
  );

  const accepted = await broker.handleRuntimeInput({
    controlId: control.controlId,
    accessToken: control.accessToken,
    input: { sequence: 1, intent: { type: 'move', forward: 1, strafe: 0 } }
  });
  assert.equal(accepted.accepted, true);
  assert.equal(handledInputs.length, 1);
  assert.equal(handledInputs[0].record.actorId, 'actor-1');
  assert.equal(handledInputs[0].input.renderSessionId, 'render-1');

  await assert.rejects(
    () => broker.handleRuntimeInput({
      controlId: control.controlId,
      accessToken: control.accessToken,
      input: { sequence: 1, intent: { type: 'move', forward: 1, strafe: 0 } }
    }),
    (error) => error?.code === 'FENIX_RENDER_CONTROL_SEQUENCE_REJECTED' && error?.statusCode === 409
  );
});

test('ending render session revokes its runtime control channel', async () => {
  const { broker, internalRequests } = fixture();
  const created = await broker.create({
    campaignId: 'campaign-1',
    userId: 'player-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    sessionId: 'session-1'
  });
  const control = internalRequests[0].runtimeControl;
  await broker.end({ campaignId: 'campaign-1', userId: 'player-1', renderSessionId: created.renderSessionId });

  await assert.rejects(
    () => broker.handleRuntimeInput({
      controlId: control.controlId,
      accessToken: control.accessToken,
      input: { sequence: 2, intent: { type: 'move', forward: 1, strafe: 0 } }
    }),
    (error) => error?.code === 'FENIX_RENDER_CONTROL_NOT_FOUND' && error?.statusCode === 404
  );
});
