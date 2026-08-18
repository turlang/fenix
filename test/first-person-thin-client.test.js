import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderSessionDescriptor } from '../packages/render-stream-contract/src/index.js';

const dualViewPath = new URL('../apps/fenix-vtt/components/dual-view-vtt-shell.jsx', import.meta.url);
const firstPersonPath = new URL('../apps/fenix-vtt/components/first-person-stage.jsx', import.meta.url);
const authGatePath = new URL('../apps/fenix-vtt/components/auth-campaign-gate.jsx', import.meta.url);
const layoutPath = new URL('../apps/fenix-vtt/app/layout.js', import.meta.url);

test('Fenix VTT mounts a dual Top View / First Person controller', async () => {
  const [dualView, authGate] = await Promise.all([
    readFile(dualViewPath, 'utf8'),
    readFile(authGatePath, 'utf8')
  ]);
  assert.match(authGate, /DualViewVttShell/);
  assert.match(dualView, />Top View</);
  assert.match(dualView, />\s*1ª Pessoa\s*</);
  assert.match(dualView, /state\.tokens\.find/);
  assert.match(dualView, /actorId/);
  assert.match(dualView, /activeScene/);
});

test('First Person client requests GPU session using scene actor and persistent token then releases it', async () => {
  const source = await readFile(firstPersonPath, 'utf8');
  assert.match(source, /\/render-sessions/);
  assert.match(source, /sceneId: scene\.id/);
  assert.match(source, /actorId: actor\.id/);
  assert.match(source, /tokenId: token\.tokenId \?\? token\.id/);
  assert.match(source, /method: 'DELETE'/);
  assert.match(source, /preferredCodecs: \['av1', 'h264'\]/);
  assert.doesNotMatch(source, /FENIX_RENDER_NODE_TOKEN/);
  assert.doesNotMatch(source, /FENIX_RENDER_NODE_URL/);
});

test('thin client embeds only the public player URL returned by the broker', async () => {
  const source = await readFile(firstPersonPath, 'utf8');
  assert.match(source, /descriptor\?\.playerUrl/);
  assert.match(source, /src=\{playerUrl\}/);
  assert.doesNotMatch(source, /src=\{descriptor\?\.signallingUrl\}/);
});

test('render descriptor rejects unsafe schemes for browser-facing URLs', () => {
  const unsafe = createRenderSessionDescriptor({
    renderSessionId: 'r1',
    playerUrl: 'javascript:alert(1)',
    signallingUrl: 'file:///tmp/socket'
  });
  assert.equal(unsafe.playerUrl, null);
  assert.equal(unsafe.signallingUrl, null);

  const safe = createRenderSessionDescriptor({
    renderSessionId: 'r2',
    playerUrl: 'https://stream.example/player/r2',
    signallingUrl: 'wss://stream.example/signal/r2'
  });
  assert.equal(safe.playerUrl, 'https://stream.example/player/r2');
  assert.equal(safe.signallingUrl, 'wss://stream.example/signal/r2');
});

test('first-person CSS loads last so the thin client owns its isolated surface', async () => {
  const source = await readFile(layoutPath, 'utf8');
  const firstPerson = source.indexOf("import './first-person.css';");
  const actorCatalog = source.indexOf("import './actor-catalog.css';");
  assert.ok(firstPerson > actorCatalog);
});
