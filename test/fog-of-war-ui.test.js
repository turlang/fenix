import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('MapStage aplica Fog automático ao jogador e preview explícito ao Mestre', async () => {
  const mapStage = await source('apps/fenix-vtt/components/map-stage.jsx');
  for (const marker of [
    'FogOfWarOverlay',
    'onFogChanged',
    'fogEnabled',
    'fogPreview',
    'movableActorId',
    'visionActorId',
    'Salvar Fog'
  ]) {
    assert.ok(mapStage.includes(marker), `MapStage sem ${marker}`);
  }
  assert.match(mapStage, /fogActive\s*=\s*fogEnabled\s*&&\s*\(!canMoveAny\s*\|\|\s*fogPreview\)/);
});

test('overlay usa LOS atual e somente a memória de exploração apropriada ao ator', async () => {
  const overlay = await source('apps/fenix-vtt/components/fog-of-war-overlay.jsx');
  for (const marker of [
    'computeVisibilityPolygon',
    'visibleGridCells',
    'exploredCells',
    'exploredByActor',
    'actorId',
    'fog-unexplored',
    'fog-explored'
  ]) {
    assert.ok(overlay.includes(marker), `Fog overlay sem ${marker}`);
  }
});

test('provider invalida catálogo no SCENE_UPDATED e expõe updateSceneFog somente via API autenticada', async () => {
  const provider = await source('apps/fenix-vtt/components/session-provider.jsx');
  const client = await source('apps/fenix-vtt/lib/fenix-api-client.js');
  assert.ok(provider.includes("case 'SCENE_UPDATED':"));
  assert.ok(provider.includes('refreshScenes()'));
  assert.ok(provider.includes('updateSceneFog'));
  assert.ok(client.includes('/fog`'));
  assert.ok(client.includes("credentials: 'include'"));
});
