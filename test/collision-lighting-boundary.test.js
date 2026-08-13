import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('colisão, iluminação e elevação permanecem fora do Shared Core narrativo', async () => {
  const collision = await source('packages/scene-collision/src/index.js');
  const lighting = await source('packages/scene-lighting/src/index.js');
  const elevation = await source('packages/scene-elevation/src/index.js');
  const gateway = await source('packages/realtime-session-gateway/src/index.js');
  const director = await source('packages/session-director/src/index.js');

  assert.match(collision, /scene-geometry/);
  assert.match(collision, /scene-elevation/);
  assert.doesNotMatch(collision, /fastify|react|websocket|postgres|SessionDirector/i);
  assert.match(lighting, /scene-vision/);
  assert.match(lighting, /scene-elevation/);
  assert.doesNotMatch(lighting, /fastify|react|websocket|postgres|SessionDirector/i);
  assert.match(elevation, /normalizeSceneElevation/);
  assert.match(elevation, /clampFlyingElevation/);
  assert.doesNotMatch(elevation, /fastify|react|websocket|postgres|SessionDirector|foundry/i);
  assert.match(gateway, /resolveTokenMovement/);
  assert.match(gateway, /normalizeSceneLighting/);
  assert.match(gateway, /resolveTokenVerticalState/);
  assert.match(gateway, /clampFlyingElevation/);

  for (const forbidden of [
    'scene-collision',
    'scene-lighting',
    'scene-elevation',
    'resolveTokenMovement',
    'normalizeSceneLighting',
    'normalizeSceneElevation',
    'clampFlyingElevation',
    'DynamicLightingOverlay'
  ]) {
    assert.equal(director.includes(forbidden), false, `SessionDirector não pode conhecer ${forbidden}`);
  }
});

test('UI mantém iluminação e elevação como capacidades de cena via providers autenticados', async () => {
  const overlay = await source('apps/fenix-vtt/components/dynamic-lighting-overlay.jsx');
  const editor = await source('apps/fenix-vtt/components/advanced-vision-editor.jsx');
  const provider = await source('apps/fenix-vtt/components/session-provider.jsx');
  const routes = await source('apps/api/src/http/register-scene-routes.js');
  assert.match(overlay, /computeSceneLightPolygons/);
  assert.match(overlay, /verticalEnabled/);
  assert.match(overlay, /updateSceneLighting/);
  assert.match(editor, /sceneElevation/);
  assert.match(editor, /updateSceneFog/);
  assert.match(editor, /updateSceneWalls/);
  assert.match(provider, /updateSceneLighting/);
  assert.match(provider, /updateSceneFog/);
  assert.match(routes, /scenes\/:sceneId\/lighting/);
  assert.match(routes, /sceneElevation: request\.body\?\.sceneElevation/);
});
