import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const shellUrl = new URL('../apps/fenix-vtt/components/vtt-shell.jsx', import.meta.url);
const inspectorUrl = new URL('../apps/fenix-vtt/components/scene-settings-inspector.jsx', import.meta.url);

test('botão direito na cena abre configurações sem ativá-la', async () => {
  const source = await readFile(shellUrl, 'utf8');

  assert.match(source, /function handleSceneContextMenu\(event, scene\)/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /setSceneInspectorId\(scene\.id\)/);
  assert.match(source, /onContextMenu=\{\(event\) => handleSceneContextMenu\(event, scene\)\}/);
  assert.doesNotMatch(source, /handleSceneContextMenu[\s\S]{0,400}activateScene\(scene\.id\)/);
});

test('inspector de cena é temporário e separado do painel permanente', async () => {
  const shell = await readFile(shellUrl, 'utf8');
  const inspector = await readFile(inspectorUrl, 'utf8');

  assert.match(shell, /<SceneSettingsInspector/);
  assert.match(shell, /onClose=\{\(\) => setSceneInspectorId\(null\)\}/);
  assert.match(inspector, /map-context-inspector scene-settings-inspector/);
  assert.match(inspector, /Configurações da cena/);
});

test('configuração física da cena expõe níveis sem misturar ficha ou movimento', async () => {
  const inspector = await readFile(inspectorUrl, 'utf8');

  assert.match(inspector, /Espaço 2\.5D/);
  assert.match(inspector, /Altura por nível/);
  assert.match(inspector, /Passo vertical/);
  assert.match(inspector, /Parede: base/);
  assert.match(inspector, /Parede: topo/);
  assert.match(inspector, /Salvar altura e níveis/);
  assert.match(inspector, /onUpdateElevation\(scene\.id, draft\)/);
  assert.match(inspector, /visão e movimento vêm da ficha \+ sistema de RPG/i);
});

test('shell preserva identidade por actorId e física realtime da cena', async () => {
  const shell = await readFile(shellUrl, 'utf8');

  assert.match(shell, /\(token\.actorId \?\? token\.id\) === actorId/);
  assert.match(shell, /elevation: realtimeScene\?\.elevation/);
  assert.match(shell, /regions: Array\.isArray\(realtimeScene\?\.regions\)/);
});
