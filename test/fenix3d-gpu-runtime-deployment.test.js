import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRenderNodeConfig } from '../apps/render-node/src/config.js';
import {
  ProcessRenderRuntimeLauncher,
  createUnrealPixelStreamingArgs
} from '../apps/render-node/src/runtime-launcher.js';

const ROOT = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), 'utf8');

function record() {
  return {
    renderSessionId: 'render-123',
    runtimeManifest: null,
    runtimeAccessToken: 'runtime-secret',
    request: {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-1',
      actorId: 'actor-1',
      tokenId: 'token-1',
      targetFps: 60,
      maxWidth: 1280,
      maxHeight: 720,
      runtimeControl: null
    }
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 4242;
    this.exitCode = null;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    if (signal === 'SIGTERM' || signal === 'SIGKILL') {
      this.exitCode = signal === 'SIGTERM' ? 0 : 1;
      queueMicrotask(() => this.emit('exit', this.exitCode, signal));
    }
    return true;
  }
}

test('Unreal launcher scopes each Pixel Streaming process to renderSessionId and requested resolution', () => {
  const args = createUnrealPixelStreamingArgs(record(), {
    streamerUrlTemplate: 'ws://127.0.0.1:8888'
  });

  assert.ok(args.includes('-PixelStreamingID=render-123'));
  assert.ok(args.includes('-PixelStreamingURL=ws://127.0.0.1:8888/'));
  assert.ok(args.includes('-ResX=1280'));
  assert.ok(args.includes('-ResY=720'));
  assert.ok(args.includes('-PixelStreamingWebRTCMaxFps=60'));
});

test('Render Node config validates HTTP readiness template without exposing arbitrary protocols', () => {
  const valid = createRenderNodeConfig({
    FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE: 'https://stream.example.test/?streamerId={renderSessionId}'
  });
  const invalid = createRenderNodeConfig({
    FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE: 'file:///tmp/{renderSessionId}'
  });

  assert.equal(valid.runtimeReadyUrlTemplate, 'https://stream.example.test/?streamerId={renderSessionId}');
  assert.equal(invalid.runtimeReadyUrlTemplate, '');
});

test('process launcher waits for Pixel Streaming readiness before registering active process', async () => {
  const child = new FakeChild();
  let probes = 0;
  const launcher = new ProcessRenderRuntimeLauncher({
    command: 'Fenix3D.exe',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    readyUrlTemplate: 'https://stream.example.test/?streamerId={renderSessionId}',
    startupGraceMs: 100,
    readyTimeoutMs: 500,
    readyIntervalMs: 100,
    stopTimeoutMs: 500,
    spawnImpl: () => child,
    fetchImpl: async (url) => {
      probes += 1;
      assert.match(String(url), /render-123/);
      return { status: 200 };
    },
    logger: { info() {} }
  });

  const entry = await launcher.start(record());
  assert.equal(probes, 1);
  assert.equal(entry.child, child);
  assert.ok(entry.readyAt);
  assert.equal(launcher.list().length, 1);
  await launcher.stop('render-123');
  assert.equal(launcher.list().length, 0);
});

test('readiness timeout terminates the spawned runtime instead of leaking a GPU process', async () => {
  const child = new FakeChild();
  const launcher = new ProcessRenderRuntimeLauncher({
    command: 'Fenix3D.exe',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    readyUrlTemplate: 'https://stream.example.test/?streamerId={renderSessionId}',
    startupGraceMs: 100,
    readyTimeoutMs: 500,
    readyIntervalMs: 100,
    spawnImpl: () => child,
    fetchImpl: async () => { throw new Error('not-ready'); },
    logger: { info() {} }
  });

  await assert.rejects(
    launcher.start(record()),
    (error) => error?.code === 'FENIX_RENDER_RUNTIME_READY_TIMEOUT'
  );
  assert.ok(child.kills.includes('SIGTERM'));
  assert.equal(launcher.list().length, 0);
});

test('GPU deployment includes packaged build, preflight, Windows launcher and self-hosted native workflow', async () => {
  const [packageScript, preflight, powershell, workflow, envExample] = await Promise.all([
    source('scripts/fenix3d-package-runtime.mjs'),
    source('scripts/fenix3d-gpu-preflight.mjs'),
    source('deploy/gpu-node/start-fenix-gpu-node.ps1'),
    source('.github/workflows/fenix3d-native.yml'),
    source('deploy/gpu-node/fenix3d-gpu.env.example')
  ]);

  assert.match(packageScript, /BuildCookRun/);
  assert.match(packageScript, /-cook/);
  assert.match(packageScript, /-stage/);
  assert.match(packageScript, /-pak/);
  assert.match(packageScript, /Fenix3D\\\.exe|Fenix3D\.exe/);
  assert.match(preflight, /nvidia-smi/);
  assert.match(preflight, /FENIX_UNREAL_ENGINE_ROOT/);
  assert.match(powershell, /fenix3d-gpu-preflight\.mjs/);
  assert.match(workflow, /self-hosted/);
  assert.match(envExample, /FENIX_RENDER_RUNTIME_MODE=process/);
  assert.match(envExample, /FENIX_RENDER_STREAMER_URL_TEMPLATE/);
  assert.match(envExample, /FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE/);
});
