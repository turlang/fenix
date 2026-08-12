import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMapScene } from '../packages/map-renderer-port/src/index.js';
import { demoScene, demoViewport } from '../apps/fenix-vtt/lib/demo-scene.js';

test('standalone demo scene exposes a tactical background and shared viewport', () => {
  assert.equal(demoScene.background, '/maps/salao-das-colunas.svg');
  assert.match(demoScene.background, /^\/maps\//);
  assert.deepEqual(demoViewport, { x: 230, y: 160, zoom: 0.82 });

  const normalized = normalizeMapScene(demoScene);
  assert.equal(normalized.background, demoScene.background);
  assert.equal(normalized.width, 1600);
  assert.equal(normalized.height, 1000);
});
