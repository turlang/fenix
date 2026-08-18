import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PlatformEventType,
  PlatformRenderMode,
  PlatformTarget,
  PlatformViewMode,
  createPlatformCapabilities,
  normalizePlatformEvent,
  normalizeViewRequest
} from '../packages/platform-protocol/src/index.js';
import { createVttBridgeAdapter, VttBridgeRegistry } from '../packages/vtt-bridge-sdk/src/index.js';
import {
  PlayerInputType,
  RenderTransport,
  createRemoteRenderSessionRequest,
  normalizePlayerInputIntent
} from '../packages/render-stream-contract/src/index.js';
import { RenderNodeGateway } from '../packages/render-node-gateway/src/index.js';
import {
  AiInferenceGateway,
  AiLocality,
  AiRoutingPolicy,
  createOpenAICompatibleTextProvider
} from '../packages/ai-inference-gateway/src/index.js';

const baseEvent = {
  type: PlatformEventType.TOKEN_MOVED,
  campaignId: 'campaign-1',
  sceneId: 'scene-1',
  tokenId: 'token-1',
  actorId: 'actor-1',
  payload: { x: 10, y: 20, elevation: 3 }
};

test('protocolo comum normaliza eventos vindos do Fênix ou VTT externo', () => {
  const event = normalizePlatformEvent({ ...baseEvent, source: PlatformTarget.FOUNDRY });
  assert.equal(event.version, 1);
  assert.equal(event.source, PlatformTarget.FOUNDRY);
  assert.equal(event.type, PlatformEventType.TOKEN_MOVED);
  assert.equal(event.actorId, 'actor-1');
  assert.deepEqual(event.payload, { x: 10, y: 20, elevation: 3 });
});

test('Bridge SDK traduz um evento externo sem acoplar o Core ao VTT de origem', () => {
  const adapter = createVttBridgeAdapter({
    id: 'foundry-example',
    target: PlatformTarget.FOUNDRY,
    capabilities: { viewModes: [PlatformViewMode.TOP] },
    toFenixEvent(external) {
      return {
        type: PlatformEventType.TOKEN_MOVED,
        campaignId: external.world,
        sceneId: external.scene,
        tokenId: external.token,
        actorId: external.actor,
        payload: { x: external.x, y: external.y, elevation: external.z }
      };
    },
    fromFenixEvent(event) {
      return { kind: event.type, token: event.tokenId, payload: event.payload };
    }
  });
  const registry = new VttBridgeRegistry();
  registry.register(adapter);
  const fenixEvent = adapter.ingest({ world: 'campaign-1', scene: 'scene-1', token: 'token-1', actor: 'actor-1', x: 4, y: 8, z: 0 });
  assert.equal(fenixEvent.source, PlatformTarget.FOUNDRY);
  assert.equal(fenixEvent.payload.x, 4);
  assert.equal(registry.list()[0].capabilities.supportsFirstPerson, false);
  assert.equal(adapter.emit(fenixEvent).token, 'token-1');
});

test('primeira pessoa cloud exige ator e usa WebRTC sem depender de GPU local', () => {
  assert.throws(
    () => normalizeViewRequest({ viewMode: PlatformViewMode.FIRST_PERSON, renderMode: PlatformRenderMode.CLOUD }),
    (error) => error?.code === 'FENIX_FIRST_PERSON_ACTOR_REQUIRED'
  );
  const request = createRemoteRenderSessionRequest({
    campaignId: 'campaign-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1'
  });
  assert.equal(request.viewMode, PlatformViewMode.FIRST_PERSON);
  assert.equal(request.renderMode, PlatformRenderMode.CLOUD);
  assert.equal(request.transport, RenderTransport.WEBRTC);
});

test('input remoto envia intenção e não coordenadas autoritativas de teleport', () => {
  const intent = normalizePlayerInputIntent({
    type: PlayerInputType.MOVE,
    forward: 1,
    strafe: -0.5,
    run: true,
    x: 999999,
    y: 999999
  });
  assert.deepEqual(intent, { type: 'move', forward: 1, strafe: -0.5, run: true, sequence: 0 });
  assert.equal(Object.hasOwn(intent, 'x'), false);
  assert.equal(Object.hasOwn(intent, 'y'), false);
});

test('Render Gateway escolhe node GPU saudável e devolve descritor WebRTC', async () => {
  const gateway = new RenderNodeGateway({ logger: { warn() {} } });
  gateway.register({ id: 'gpu-busy', priority: 1, health: async () => ({ available: false }), createSession: async () => ({}) });
  gateway.register({
    id: 'gpu-render-01',
    region: 'br-1',
    priority: 10,
    health: async () => ({ ok: true, available: true }),
    createSession: async () => ({
      renderSessionId: 'render-1',
      signallingUrl: 'wss://render.internal/session/render-1',
      renderer: 'unreal-pixel-streaming'
    })
  });
  const result = await gateway.createSession({ campaignId: 'campaign-1', sceneId: 'scene-1', actorId: 'actor-1' });
  assert.equal(result.nodeId, 'gpu-render-01');
  assert.equal(result.descriptor.transport, 'webrtc');
  assert.equal(result.descriptor.renderer, 'unreal-pixel-streaming');
});

test('AI Gateway prioriza LLM local e pode cair para cloud quando política permite', async () => {
  const gateway = new AiInferenceGateway({ policy: AiRoutingPolicy.LOCAL_PREFERRED, logger: { warn() {} } });
  gateway.register({ id: 'local-llm', locality: AiLocality.LOCAL, generateText: async () => { throw new Error('GPU ocupada'); } });
  gateway.register({ id: 'cloud-fallback', locality: AiLocality.CLOUD, generateText: async () => 'resposta cloud' });
  const result = await gateway.generateText({ prompt: 'narre' });
  assert.equal(result.content, 'resposta cloud');
  assert.equal(result.locality, AiLocality.CLOUD);
});

test('AI Gateway local-only nunca envia a requisição para cloud', async () => {
  let cloudCalls = 0;
  const gateway = new AiInferenceGateway({ policy: AiRoutingPolicy.LOCAL_ONLY, logger: { warn() {} } });
  gateway.register({ id: 'local-llm', locality: AiLocality.LOCAL, generateText: async () => { throw new Error('offline'); } });
  gateway.register({ id: 'cloud', locality: AiLocality.CLOUD, generateText: async () => { cloudCalls += 1; return 'não deveria'; } });
  await assert.rejects(() => gateway.generateText({ prompt: 'teste' }), (error) => error?.code === 'FENIX_AI_ALL_PROVIDERS_FAILED');
  assert.equal(cloudCalls, 0);
});

test('provider OpenAI-compatible permite conectar servidor local sem dependência de vendor', async () => {
  let requestedUrl = null;
  const provider = createOpenAICompatibleTextProvider({
    baseUrl: 'http://gpu-ai.internal:8000/v1',
    model: 'local-model',
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'local-model');
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: 'narrativa local' } }] };
        }
      };
    }
  });
  assert.equal(await provider.generateText({ prompt: 'cena' }), 'narrativa local');
  assert.equal(requestedUrl, 'http://gpu-ai.internal:8000/v1/chat/completions');
  assert.equal(provider.locality, AiLocality.LOCAL);
});

test('capabilities permitem Top View e First Person como projeções do mesmo mundo', () => {
  const capabilities = createPlatformCapabilities({
    target: PlatformTarget.FENIX,
    viewModes: [PlatformViewMode.TOP, PlatformViewMode.FIRST_PERSON],
    renderModes: [PlatformRenderMode.LOCAL, PlatformRenderMode.CLOUD, PlatformRenderMode.AUTO]
  });
  assert.equal(capabilities.supportsFirstPerson, true);
  assert.deepEqual(capabilities.viewModes, ['top', 'first-person']);
});
