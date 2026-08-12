import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('VTT expõe authoring de paredes somente ao Mestre e salva pelo Scene Manager', async () => {
  const [mapStage, shell, provider, client] = await Promise.all([
    source('apps/fenix-vtt/components/map-stage.jsx'),
    source('apps/fenix-vtt/components/vtt-shell.jsx'),
    source('apps/fenix-vtt/components/session-provider.jsx'),
    source('apps/fenix-vtt/lib/fenix-api-client.js')
  ]);

  for (const marker of ['Paredes', 'wall-authoring-panel', 'onWallsChanged', 'canMoveAny && wallEditorOpen']) {
    assert.ok(mapStage.includes(marker), `MapStage sem marker ${marker}`);
  }
  assert.ok(shell.includes('onWallsChanged={updateSceneWalls}'));
  assert.ok(provider.includes('updateSceneWalls'));
  assert.ok(provider.includes('realtimeRef.current.updateScene(runtimeScene(result.scene))'));
  assert.ok(client.includes('/walls'));
});

test('editor inclui parede, porta, estado, apagar, desfazer e snap na grade', async () => {
  const mapStage = await source('apps/fenix-vtt/components/map-stage.jsx');
  for (const marker of ['Parede', 'Porta', 'Alternar porta', 'Apagar', 'Desfazer', 'Snap na grade', 'SceneDoorState.LOCKED']) {
    assert.ok(mapStage.includes(marker), `authoring sem controle ${marker}`);
  }
});
