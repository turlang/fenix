import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRenderNodeConfig } from '../apps/render-node/src/config.js';
import { RenderSessionRegistry } from '../apps/render-node/src/session-registry.js';
import { createRenderNodeHandler } from '../apps/render-node/src/app.js';

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

async function withRenderServer(config, registry, run, runtimeLauncher = null) {
  const server = createServer(createRenderNodeHandler({ config, registry, runtimeLauncher }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function internalHeaders() {
  return { authorization: 'Bearer internal-secret', 'content-type': 'application/json' };
}

function processConfig(overrides = {}) {
  return createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'internal-secret',
    FENIX_RENDER_NODE_ID: 'gpu-process-01',
    FENIX_RENDER_NODE_REGION: 'br-1',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}',
    FENIX_RENDER_SIGNALLING_URL_TEMPLATE: 'wss://stream.example/signalling/{renderSessionId}',
    FENIX_RENDER_RUNTIME_MODE: 'process',
    FENIX_RENDER_RUNTIME_COMMAND: '/trusted/Fenix3D',
    FENIX_RENDER_STREAMER_URL_TEMPLATE: 'ws://127.0.0.1:8888',
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
  assert.equal(config.runtimeMode, 'external');
  assert.equal(config.authToken, 'internal-secret');
});

test('process mode requires server-side command and streamer URL', () => {
  const missing = createRenderNodeConfig({
    FENIX_RENDER_RUNTIME_MODE: 'process',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });
  assert.equal(missing.runtimeMode, 'process');
  assert.equal(missing.runtimeConfigured, false);

  const configured = processConfig();
  assert.equal(configured.runtimeConfigured, true);
  assert.equal(configured.runtimeCommand, '/trusted/Fenix3D');
  assert.equal(configured.streamerUrlTemplate, 'ws://127.0.0.1:8888');
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

test('registry expires abandoned sessions by TTL and triggers runtime cleanup', async () => {
  let now = Date.parse('2026-08-18T03:00:00Z');
  const expired = [];
  const registry = configuredRegistry({
    sessionTtlMs: 60_000,
    now: () => now,
    onExpire: async (record) => expired.push(record.renderSessionId)
  });
  const first = registry.create(renderRequest());
  assert.ok(registry.get(first.renderSessionId));
  now += 60_001;
  assert.equal(registry.get(first.renderSessionId), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(expired, [first.renderSessionId]);
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

  await withRenderServer(config, registry, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/health`);
    assert.equal(unauthorized.status, 401);

    const health = await fetch(`${baseUrl}/health`, { headers: internalHeaders() });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).available, true);

    const created = await fetch(`${baseUrl}/v1/render-sessions`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(renderRequest())
    });
    assert.equal(created.status, 201);
    const descriptor = await created.json();
    assert.ok(descriptor.renderSessionId);
    assert.equal(descriptor.transport, 'webrtc');
    assert.match(descriptor.playerUrl, /^https:/);
    assert.equal(Object.hasOwn(descriptor, 'authToken'), false);

    const fetched = await fetch(`${baseUrl}/v1/render-sessions/${descriptor.renderSessionId}`, { headers: internalHeaders() });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).renderSessionId, descriptor.renderSessionId);

    const ended = await fetch(`${baseUrl}/v1/render-sessions/${descriptor.renderSessionId}`, {
      method: 'DELETE',
      headers: internalHeaders()
    });
    assert.equal(ended.status, 200);
    assert.equal((await ended.json()).ended, true);
  });
});

test('process mode starts runtime before returning allocation and stops it on DELETE', async () => {
  const registry = configuredRegistry();
  const config = processConfig();
  const calls = { start: [], stop: [] };
  const launcher = {
    enabled: true,
    list: () => calls.start.map((id) => ({ renderSessionId: id })),
    async start(record) { calls.start.push(record.renderSessionId); },
    async stop(renderSessionId) { calls.stop.push(renderSessionId); return true; }
  };

  await withRenderServer(config, registry, async (baseUrl) => {
    const created = await fetch(`${baseUrl}/v1/render-sessions`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(renderRequest())
    });
    assert.equal(created.status, 201);
    const descriptor = await created.json();
    assert.deepEqual(calls.start, [descriptor.renderSessionId]);
    assert.equal(registry.size, 1);

    const ended = await fetch(`${baseUrl}/v1/render-sessions/${descriptor.renderSessionId}`, {
      method: 'DELETE',
      headers: internalHeaders()
    });
    assert.equal(ended.status, 200);
    assert.deepEqual(calls.stop, [descriptor.renderSessionId]);
    assert.equal(registry.size, 0);
  }, launcher);
});

test('process mode rolls back allocation when runtime fails during startup', async () => {
  const registry = configuredRegistry();
  const config = processConfig();
  const launcher = {
    enabled: true,
    list: () => [],
    async start() {
      const error = new Error('Unreal exited');
      error.code = 'FENIX_RENDER_RUNTIME_EARLY_EXIT';
      error.statusCode = 503;
      throw error;
    },
    async stop() { return true; }
  };

  await withRenderServer(config, registry, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/render-sessions`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(renderRequest())
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FENIX_RENDER_RUNTIME_EARLY_EXIT');
    assert.equal(registry.size, 0);
  }, launcher);
});

test('process mode fails closed when launcher is missing', async () => {
  const registry = configuredRegistry();
  const config = processConfig();

  await withRenderServer(config, registry, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`, { headers: internalHeaders() });
    const status = await health.json();
    assert.equal(status.available, false);
    assert.equal(status.status, 'degraded');

    const response = await fetch(`${baseUrl}/v1/render-sessions`, {
      method: 'POST',
      headers: internalHeaders(),
      body: JSON.stringify(renderRequest())
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'FENIX_RENDER_RUNTIME_LAUNCHER_NOT_CONFIGURED');
    assert.equal(registry.size, 0);
  });
});

test('public health is opt-in and never exposes the internal token', async () => {
  const registry = configuredRegistry();
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'secret-never-public',
    FENIX_RENDER_NODE_PUBLIC_HEALTH: 'true',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });

  await withRenderServer(config, registry, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).includes('secret-never-public'), false);
  });
});
