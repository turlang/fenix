import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HeadlessMapRenderer,
  MapRendererBackend,
  assertMapRendererPort,
  selectMapRendererBackend
} from '../packages/map-renderer-port/src/index.js';
import { detectBrowserRendererBackend } from '../packages/webgl-map-renderer/src/index.js';

test('MapRendererPort headless implementa ciclo básico de cena e token', () => {
  const renderer = assertMapRendererPort(new HeadlessMapRenderer());
  renderer.loadScene({ id: 'scene-1', name: 'Mapa', width: 1000, height: 800, grid: { size: 50 } });
  renderer.setViewport({ x: 100, y: 50, zoom: 1.5 });
  renderer.upsertToken({ id: 'token-1', name: 'Ayla', x: 200, y: 200, size: 60 });

  const hit = renderer.hitTest({ x: 200, y: 200 });
  const frame = renderer.render();

  assert.equal(hit.token.id, 'token-1');
  assert.equal(frame.sceneId, 'scene-1');
  assert.equal(frame.tokenCount, 1);
  assert.equal(frame.frame, 1);
});

test('backend prioriza WebGPU, mantém WebGL2 como baseline e possui fallback headless', () => {
  assert.equal(selectMapRendererBackend({ hasWebGpu: true, hasWebGl2: true }), MapRendererBackend.WEBGPU);
  assert.equal(selectMapRendererBackend({ hasWebGpu: false, hasWebGl2: true }), MapRendererBackend.WEBGL2);
  assert.equal(selectMapRendererBackend({ hasWebGpu: false, hasWebGl2: false }), MapRendererBackend.HEADLESS);
});

test('capability detection do navegador não depende de globals durante import', () => {
  const webgpu = detectBrowserRendererBackend({ navigatorLike: { gpu: {} }, canvas: null });
  const webgl = detectBrowserRendererBackend({ navigatorLike: {}, canvas: { getContext: (name) => name === 'webgl2' ? {} : null } });
  const headless = detectBrowserRendererBackend({ navigatorLike: {}, canvas: { getContext: () => null } });

  assert.equal(webgpu, MapRendererBackend.WEBGPU);
  assert.equal(webgl, MapRendererBackend.WEBGL2);
  assert.equal(headless, MapRendererBackend.HEADLESS);
});

test('renderer destruído falha rápido em novas operações', () => {
  const renderer = new HeadlessMapRenderer();
  renderer.destroy();
  assert.throws(() => renderer.render(), /destruído/);
});
