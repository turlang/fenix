import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import { createRenderNodeConfig } from '../apps/render-node/src/config.js';
import { RenderSessionRegistry } from '../apps/render-node/src/session-registry.js';
import { createRenderNodeHandler } from '../apps/render-node/src/app.js';
import { ProcessRenderRuntimeLauncher } from '../apps/render-node/src/runtime-launcher.js';

function bootstrap() {
  return {
    schema: 'fenix.render-world-bootstrap',
    version: 1,
    campaign: { id: 'campaign-1', systemId: 'dnd5e' },
    scene: { id: 'scene-1', grid: { size: 70, scale: { distancePerCell: 1.5, unit: 'm' } } },
    viewer: {
      actor: { actorId: 'actor-1', sheetId: 'sheet-1', systemId: 'dnd5e' },
      token: { tokenId: 'token-1', actorId: 'actor-1', x: 100, y: 120, elevation: 0 },
      camera: { sceneX: 100, sceneY: 120, elevation: 1.6, unit: 'm' }
    },
    tokens: []
  };
}

function request() {
  return {
    campaignId: 'campaign-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    worldBootstrap: bootstrap()
  };
}

function registry() {
  return new RenderSessionRegistry({
    playerUrlTemplate: 'https://stream.example/player/{renderSessionId}',
    signallingUrlTemplate: 'wss://stream.example/signalling/{renderSessionId}'
  });
}

async function withServer(config, renderRegistry, run) {
  const server = createServer(createRenderNodeHandler({ config, registry: renderRegistry }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 2001;
    this.exitCode = null;
  }

  kill(signal) {
    queueMicrotask(() => {
      if (this.exitCode == null) {
        this.exitCode = 0;
        this.emit('exit', 0, signal);
      }
    });
    return true;
  }
}

test('Render Node stores bootstrap privately and descriptor never exposes runtime token or world snapshot', () => {
  const renderRegistry = registry();
  const record = renderRegistry.create(request());
  assert.equal(record.request.worldBootstrap.schema, 'fenix.render-world-bootstrap');
  assert.ok(record.runtimeAccessToken.length >= 32);
  assert.equal(Object.hasOwn(record.descriptor, 'runtimeAccessToken'), false);
  assert.equal(Object.hasOwn(record.descriptor, 'worldBootstrap'), false);
});

test('runtime bootstrap endpoint accepts only the scoped per-session token', async () => {
  const renderRegistry = registry();
  const record = renderRegistry.create(request());
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'admin-node-secret',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });

  await withServer(config, renderRegistry, async (baseUrl) => {
    const path = `${baseUrl}/v1/runtime/bootstrap/${record.renderSessionId}`;

    const anonymous = await fetch(path);
    assert.equal(anonymous.status, 401);

    const admin = await fetch(path, { headers: { authorization: 'Bearer admin-node-secret' } });
    assert.equal(admin.status, 401, 'admin Bearer não substitui a credencial efêmera do runtime');

    const runtime = await fetch(path, { headers: { authorization: `Bearer ${record.runtimeAccessToken}` } });
    assert.equal(runtime.status, 200);
    const payload = await runtime.json();
    assert.equal(payload.schema, 'fenix.render-world-bootstrap');
    assert.equal(payload.viewer.actor.actorId, 'actor-1');
    assert.equal(JSON.stringify(payload).includes(record.runtimeAccessToken), false);
  });
});

test('bootstrap credential stops working as soon as the render session is removed', async () => {
  const renderRegistry = registry();
  const record = renderRegistry.create(request());
  const config = createRenderNodeConfig({
    FENIX_RENDER_NODE_TOKEN: 'admin-node-secret',
    FENIX_RENDER_PLAYER_URL_TEMPLATE: 'https://stream.example/player/{renderSessionId}'
  });
  renderRegistry.delete(record.renderSessionId);

  await withServer(config, renderRegistry, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/runtime/bootstrap/${record.renderSessionId}`, {
      headers: { authorization: `Bearer ${record.runtimeAccessToken}` }
    });
    assert.equal(response.status, 404);
  });
});

test('process launcher receives bootstrap URL and scoped token only through server-controlled environment', async () => {
  const renderRegistry = registry();
  const record = renderRegistry.create(request());
  const child = new FakeChild();
  let spawnOptions = null;
  const launcher = new ProcessRenderRuntimeLauncher({
    command: '/trusted/Fenix3D',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    bootstrapBaseUrl: 'http://127.0.0.1:9000',
    startupGraceMs: 100,
    logger: { info() {} },
    spawnImpl(_command, _args, options) {
      spawnOptions = options;
      return child;
    }
  });

  await launcher.start(record);
  assert.equal(
    spawnOptions.env.FENIX_WORLD_BOOTSTRAP_URL,
    `http://127.0.0.1:9000/v1/runtime/bootstrap/${record.renderSessionId}`
  );
  assert.equal(spawnOptions.env.FENIX_WORLD_BOOTSTRAP_TOKEN, record.runtimeAccessToken);
  assert.equal(spawnOptions.shell, false);
  assert.equal(spawnOptions.env.FENIX_WORLD_BOOTSTRAP_TOKEN === 'admin-node-secret', false);
  await launcher.stopAll();
});

test('render node config defaults runtime bootstrap URL to loopback on its own port', () => {
  const config = createRenderNodeConfig({ FENIX_RENDER_NODE_PORT: '9123' });
  assert.equal(config.runtimeBootstrapBaseUrl, 'http://127.0.0.1:9123');
});
