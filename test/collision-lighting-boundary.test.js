import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('colisão e iluminação permanecem fora do Shared Core narrativo', async () => {
  const collision = await source('packages/scene-collision/src/index.js');
  const lighting = await source('packages/scene-lighting/src/index.js');
  const gateway = await source('packages/realtime-session-gateway/src/index.js');
  const director = await source('packages/session-director/src/index.js');

  assert.match(collision, /scene-geometry/);
  assert.doesNotMatch(collision, /fastify|react|websocket|postgres|SessionDirector/i);
  assert.match(lighting, /scene-vision/);
  assert.doesNotMatch(lighting, /fastify|react|websocket|postgres|SessionDirector/i);
  assert.match(gateway, /resolveTokenMovement/);
  assert.match(gateway, /normalizeSceneLighting/);

  for (const forbidden of [
    'scene-collision',
    'scene-lighting',
    'resolveTokenMovement',
    'normalizeSceneLighting',
    'DynamicLightingOverlay'
  ]) {
    assert.equal(director.includes(forbidden), false, `SessionDirector não pode conhecer ${forbidden}`);
  }
});

test('UI mantém iluminação como capacidade de cena e usa provider autenticado', async () => {
  const overlay = await source('apps/fenix-vtt/components/dynamic-lighting-overlay.jsx');
  const provider = await source('apps/fenix-vtt/components/session-provider.jsx');
  const routes = await source('apps/api/src/http/register-scene-routes.js');
  assert.match(overlay, /computeSceneLightPolygons/);
  assert.match(overlay, /updateSceneLighting/);
  assert.match(provider, /updateSceneLighting/);
  assert.match(routes, /scenes\/:sceneId\/lighting/);
});
