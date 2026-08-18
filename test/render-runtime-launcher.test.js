import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  ProcessRenderRuntimeLauncher,
  createUnrealPixelStreamingArgs
} from '../apps/render-node/src/runtime-launcher.js';

function record(overrides = {}) {
  return {
    renderSessionId: 'render-1',
    request: {
      campaignId: 'campaign-1',
      sessionId: 'session-1',
      sceneId: 'scene-1',
      actorId: 'actor-1',
      tokenId: 'token-1',
      targetFps: 60,
      maxWidth: 1920,
      maxHeight: 1080,
      ...overrides
    }
  };
}

class FakeChild extends EventEmitter {
  constructor(pid = 1001) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.kills = [];
  }

  kill(signal) {
    this.kills.push(signal);
    if (signal === 'SIGTERM') {
      queueMicrotask(() => {
        if (this.exitCode == null) {
          this.exitCode = 0;
          this.emit('exit', 0, signal);
        }
      });
    }
    return true;
  }
}

test('Unreal launcher builds offscreen Pixel Streaming args from authoritative session context', () => {
  const args = createUnrealPixelStreamingArgs(record(), {
    streamerUrlTemplate: 'wss://signal.internal/streamer/{renderSessionId}?actor={actorId}',
    extraArgs: ['-SomeServerFlag={sceneId}']
  });

  assert.ok(args.includes('-RenderOffscreen'));
  assert.ok(args.some((item) => item.startsWith('-PixelStreamingURL=wss://signal.internal/')));
  assert.ok(args.includes('-PixelStreamingWebRTCMaxFps=60'));
  assert.ok(args.includes('-FenixRenderSessionId=render-1'));
  assert.ok(args.includes('-FenixCampaignId=campaign-1'));
  assert.ok(args.includes('-FenixSceneId=scene-1'));
  assert.ok(args.includes('-FenixActorId=actor-1'));
  assert.ok(args.includes('-FenixTokenId=token-1'));
  assert.ok(args.includes('-SomeServerFlag=scene-1'));
});

test('launcher rejects non-WebSocket streamer URL', () => {
  assert.throws(
    () => createUnrealPixelStreamingArgs(record(), { streamerUrlTemplate: 'https://signal.invalid/{renderSessionId}' }),
    (error) => error?.code === 'FENIX_RENDER_STREAMER_URL_INVALID' && error?.statusCode === 503
  );
});

test('process launcher uses shell:false and stops the exact session process', async () => {
  const calls = [];
  const child = new FakeChild();
  const launcher = new ProcessRenderRuntimeLauncher({
    command: '/opt/fenix/Fenix3D.sh',
    cwd: '/opt/fenix',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    startupGraceMs: 100,
    stopTimeoutMs: 500,
    logger: { info() {} },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    }
  });

  const started = await launcher.start(record());
  assert.equal(started.child.pid, 1001);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/opt/fenix/Fenix3D.sh');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.env.FENIX_ACTOR_ID, 'actor-1');
  assert.equal(launcher.list().length, 1);

  assert.equal(await launcher.stop('render-1'), true);
  assert.deepEqual(child.kills, ['SIGTERM']);
  assert.equal(launcher.list().length, 0);
});

test('launcher reuses an already running process for the same renderSessionId', async () => {
  let spawnCalls = 0;
  const child = new FakeChild();
  const launcher = new ProcessRenderRuntimeLauncher({
    command: 'Fenix3D',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    startupGraceMs: 100,
    logger: { info() {} },
    spawnImpl() {
      spawnCalls += 1;
      return child;
    }
  });
  await launcher.start(record());
  await launcher.start(record());
  assert.equal(spawnCalls, 1);
  await launcher.stopAll();
});

test('launcher rejects a runtime that exits during startup grace', async () => {
  const child = new FakeChild();
  const launcher = new ProcessRenderRuntimeLauncher({
    command: 'Fenix3D',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    startupGraceMs: 100,
    logger: { info() {} },
    spawnImpl() {
      setTimeout(() => {
        child.exitCode = 1;
        child.emit('exit', 1, null);
      }, 10);
      return child;
    }
  });

  await assert.rejects(
    () => launcher.start(record()),
    (error) => error?.code === 'FENIX_RENDER_RUNTIME_EARLY_EXIT' && error?.statusCode === 503
  );
  assert.equal(launcher.list().length, 0);
});

test('launcher never treats command text from a session request as executable authority', async () => {
  const calls = [];
  const child = new FakeChild();
  const launcher = new ProcessRenderRuntimeLauncher({
    command: '/trusted/Fenix3D',
    streamerUrlTemplate: 'ws://127.0.0.1:8888',
    startupGraceMs: 100,
    logger: { info() {} },
    spawnImpl(command, args, options) {
      calls.push({ command, args, options });
      return child;
    }
  });

  await launcher.start(record({ command: '/tmp/attacker', shell: true }));
  assert.equal(calls[0].command, '/trusted/Fenix3D');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args.includes('/tmp/attacker'), false);
  await launcher.stopAll();
});
