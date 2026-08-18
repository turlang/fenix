import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { RenderSessionRegistry } from '../apps/render-node/src/session-registry.js';
import { ProcessRenderRuntimeLauncher } from '../apps/render-node/src/runtime-launcher.js';

const ROOT = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, ROOT), 'utf8');

function renderRequest() {
  return {
    campaignId: 'campaign-1',
    sceneId: 'scene-1',
    actorId: 'actor-1',
    tokenId: 'token-1',
    targetFps: 60,
    maxWidth: 1280,
    maxHeight: 720
  };
}

function launcherRecord() {
  return {
    renderSessionId: 'render-native-1',
    runtimeManifest: { schema: 'fenix.3d-runtime-manifest', version: 1 },
    runtimeAccessToken: 'runtime-evidence-secret-token-0001',
    request: {
      ...renderRequest(),
      sessionId: 'game-session-1',
      runtimeControl: {
        controlId: 'control-1',
        inputUrl: 'https://app.example.test/v1/runtime-control/control-1',
        accessToken: 'runtime-control-secret-token-0001'
      }
    }
  };
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.pid = 9876;
    this.exitCode = null;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    this.exitCode = 0;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

test('RenderSessionRegistry records native evidence and rejects spoofed identity', () => {
  const registry = new RenderSessionRegistry({
    playerUrlTemplate: 'https://stream.example.test/?streamerId={renderSessionId}'
  });
  const record = registry.create(renderRequest());

  assert.equal(registry.runtimeStatus(record.renderSessionId).stage, 'starting');
  assert.throws(
    () => registry.reportRuntime(record.renderSessionId, { stage: 'booting', actorId: 'spoofed-actor' }),
    (error) => error?.code === 'FENIX_RENDER_RUNTIME_IDENTITY_MISMATCH'
  );

  registry.reportRuntime(record.renderSessionId, {
    stage: 'manifest-ready',
    ...renderRequest(),
    manifestSchema: 'fenix.3d-runtime-manifest',
    manifestVersion: 1
  });
  const ready = registry.reportRuntime(record.renderSessionId, {
    stage: 'ready',
    ...renderRequest(),
    manifestSchema: 'fenix.3d-runtime-manifest',
    manifestVersion: 1,
    worldBuilt: true,
    controlConfigured: true
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.worldBuilt, true);
  assert.equal(ready.controlConfigured, true);
  assert.equal(ready.manifest.schema, 'fenix.3d-runtime-manifest');
  assert.equal(registry.status().runtimeReadySessions, 1);

  registry.delete(record.renderSessionId);
  assert.equal(registry.runtimeStatus(record.renderSessionId), null);
});

test('process launcher waits for native evidence before Pixel Streaming readiness', async () => {
  const child = new FakeChild();
  let spawned = null;
  const probes = [];
  const launcher = new ProcessRenderRuntimeLauncher({
    command: 'Fenix3D.exe',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    bootstrapBaseUrl: 'http://127.0.0.1:9000',
    runtimeStatusBaseUrl: 'http://127.0.0.1:9000',
    requireRuntimeEvidence: true,
    runtimeEvidenceTimeoutMs: 500,
    runtimeEvidenceIntervalMs: 100,
    readyUrlTemplate: 'https://stream.example.test/?streamerId={renderSessionId}',
    startupGraceMs: 100,
    readyTimeoutMs: 500,
    readyIntervalMs: 100,
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return child;
    },
    fetchImpl: async (url, options = {}) => {
      probes.push(String(url));
      if (String(url).includes('/v1/runtime/status/')) {
        assert.match(String(options.headers?.Authorization), /^Bearer runtime-evidence-secret/);
        return {
          status: 200,
          async json() {
            return {
              stage: 'ready', ready: true, failed: false,
              worldBuilt: true, controlConfigured: true,
              manifest: { schema: 'fenix.3d-runtime-manifest', version: 1 },
              reportedAt: new Date().toISOString()
            };
          }
        };
      }
      return { status: 200 };
    },
    logger: { info() {} }
  });

  const entry = await launcher.start(launcherRecord());
  assert.ok(probes[0].includes('/v1/runtime/status/render-native-1'));
  assert.ok(probes.some((url) => url.includes('stream.example.test')));
  assert.equal(entry.runtimeEvidence.stage, 'ready');
  assert.equal(entry.runtimeEvidence.worldBuilt, true);
  assert.equal(entry.runtimeEvidence.controlConfigured, true);
  assert.equal(spawned.options.env.FENIX_RUNTIME_STATUS_URL, 'http://127.0.0.1:9000/v1/runtime/status/render-native-1');
  assert.equal(spawned.options.env.FENIX_RUNTIME_STATUS_TOKEN, 'runtime-evidence-secret-token-0001');
  assert.equal(spawned.options.env.FENIX_RUNTIME_CONTROL_ID, 'control-1');
  await launcher.stop('render-native-1');
});

test('Fenix3D native client reports ordered bootstrap evidence and never receives admin bearer', async () => {
  const [statusHeader, statusSource, gameMode, launcher, smoke, envExample] = await Promise.all([
    source('apps/fenix3d-unreal/Source/Fenix3D/Public/FenixRuntimeStatusClient.h'),
    source('apps/fenix3d-unreal/Source/Fenix3D/Private/FenixRuntimeStatusClient.cpp'),
    source('apps/fenix3d-unreal/Source/Fenix3D/Private/FenixRuntimeGameMode.cpp'),
    source('apps/render-node/src/runtime-launcher.js'),
    source('scripts/fenix3d-render-smoke.mjs'),
    source('deploy/gpu-node/fenix3d-gpu.env.example')
  ]);

  assert.match(statusHeader, /PendingBodies/);
  assert.match(statusSource, /ReportBooting/);
  assert.match(statusSource, /manifest-ready/);
  assert.match(statusSource, /Report\(TEXT\("ready"\)/);
  assert.match(statusSource, /PumpQueue/);
  assert.match(gameMode, /ReportManifestReady/);
  assert.match(gameMode, /ReportReady/);
  assert.match(launcher, /FENIX_RUNTIME_STATUS_TOKEN/);
  assert.doesNotMatch(launcher, /FENIX_RENDER_NODE_TOKEN:\s*record/);
  assert.match(smoke, /runtime-status/);
  assert.match(smoke, /fenix\.3d-runtime-manifest/);
  assert.match(envExample, /FENIX_RENDER_RUNTIME_EVIDENCE_REQUIRED=true/);
});
