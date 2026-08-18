import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderNodeConfig } from '../apps/render-node/src/config.js';
import { RenderSessionRegistry } from '../apps/render-node/src/session-registry.js';
import { createRenderNodeApp } from '../apps/render-node/src/app.js';

function renderRequest(actorId = 'actor-1', tokenId = 'token-1') {
  return {
    campaignId: 'campaign-1',
    sessionId: 'session-1',
    sceneId: 'scene-1',
    actorId,
    tokenId,
    preferredCodecs: ['av1', 'h264'],
    targetFps: 60,
    maxWidth: 1920,
    maxHeight: 1080
  };
}

function configuredRegistry(overrides = {}) {
  return new RenderSessionRegistry({
    nodeId: 'gpu-01',
    region: 'br-1',
    capacity: 2,
    sessionTtlMs: 60_000,
    renderer: 'unreal-pixel-streaming',
    playerUrlTemplate: 'https://stream.example/player/{renderSessionId}?actor={actorId}&scene={sceneId}',
    signallingUrlTemplate: 'wss://stream.example/signalling/{renderSessionId}',
    ...overrides
  });
}

test('Render Node config separates internal API from public Pixel Streaming URLs', () => {
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_HOST: '127.0.0.1',
    FENIX_RENDER_NODE_PORT: '9100',
    FENIX_RENDER_NODE_ID: 'gpu-br-01',
    FENIX_RENDER_NODE_REGION: 'br-south',
    FENIX_RENDER_NODE_TOKEN: 'internal-secret',
    FENIX_RENDER_NODE_CAPACITY: '4',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}',
    FENIX_RENDER_SIGNALLING_URL_TEMPLATE: 'wss://stream.example/signal/{renderSessionId}'
  });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 9100);
  assert.equal(config.capacity, 4);
  assert.equal(config.runtimeConfigured, true);
  assert.equal(config.authToken, 'internal-secret');
});

test('registry creates safe public descriptor and reuses the same active actor/token allocation', () => {
  const registry = configuredRegistry();
  const first = registry.create(renderRequest());
  const second = registry.create(renderRequest());

  assert.equal(first.renderSessionId, second.renderSessionId);
  assert.equal(first.descriptor.transport, 'webrtc');
  assert.match(first.descriptor.playerUrl, /^https:\/\/stream\.example\/player\//);
  assert.match(first.descriptor.playerUrl, /actor=actor-1/);
  assert.match(first.descriptor.signallingUrl, /^wss:\/\/stream\.example\/signalling\//);
  assert.equal(registry.size, 1);
  assert.equal(registry.availableSlots, 1);
});

test('registry enforces GPU capacity and frees a slot on delete', () => {
  const registry = configuredRegistry({ capacity: 1 });
  const first = registry.create(renderRequest());
  assert.throws(
    () => registry.create(renderRequest('actor-2', 'token-2')),
    (error) => error?.code === 'FENIX_RENDER_NODE_AT_CAPACITY' && error?.statusCode === 429
  );
  assert.equal(registry.delete(first.renderSessionId), true);
  const second = registry.create(renderRequest('actor-2', 'token-2'));
  assert.equal(second.request.actorId, 'actor-2');
});

test('registry expires abandoned sessions by TTL', () => {
  let now = Date.parse('2026-08-18T03:00:00Z');
  const registry = configuredRegistry({ sessionTtlMs: 60_000, now: () => now });
  const first = registry.create(renderRequest());
  assert.ok(registry.get(first.renderSessionId));
  now += 60_001;
  assert.equal(registry.get(first.renderSessionId), null);
  assert.equal(registry.availableSlots, 2);
});

test('registry refuses allocations until a real 3D/player endpoint is configured', () => {
  const registry = new RenderSessionRegistry({ nodeId: 'gpu-empty', capacity: 2 });
  assert.equal(registry.status().available, false);
  assert.throws(
    () => registry.create(renderRequest()),
    (error) => error?.code === 'FENIX_RENDER_RUNTIME_NOT_CONFIGURED' && error?.statusCode === 503
  );
});

test('internal HTTP API requires Bearer and returns the exact broker-compatible contract', async () => {
  const registry = configuredRegistry();
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'internal-secret',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });
  const app = createRenderNodeApp({ config, registry, logger: false });
  try {
    const unauthorized = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(unauthorized.statusCode, 401);

    const health = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { authorization: 'Bearer internal-secret' }
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().available, true);

    const created = await app.inject({
      method: 'POST',
      url: '/v1/render-sessions',
      headers: { authorization: 'Bearer internal-secret' },
      payload: renderRequest()
    });
    assert.equal(created.statusCode, 201);
    const descriptor = created.json();
    assert.ok(descriptor.renderSessionId);
    assert.equal(descriptor.transport, 'webrtc');
    assert.match(descriptor.playerUrl, /^https:/);
    assert.equal(Object.hasOwn(descriptor, 'authToken'), false);

    const fetched = await app.inject({
      method: 'GET',
      url: `/v1/render-sessions/${descriptor.renderSessionId}`,
      headers: { authorization: 'Bearer internal-secret' }
    });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().renderSessionId, descriptor.renderSessionId);

    const ended = await app.inject({
      method: 'DELETE',
      url: `/v1/render-sessions/${descriptor.renderSessionId}`,
      headers: { authorization: 'Bearer internal-secret' }
    });
    assert.equal(ended.statusCode, 200);
    assert.equal(ended.json().ended, true);
  } finally {
    await app.close();
  }
});

test('public health is opt-in and never exposes the internal token', async () => {
  const registry = configuredRegistry();
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'secret-never-public',
    FENIX_RENDER_NODE_PUBLIC_HEALTH: 'true',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });
  const app = createRenderNodeApp({ config, registry, logger: false });
  try {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes('secret-never-public'), false);
  } finally {
    await app.close();
  }
});
