import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stageUrl = new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url);
const controlsUrl = new URL('../apps/fenix-vtt/components/scene-context-controls.jsx', import.meta.url);
const layoutUrl = new URL('../apps/fenix-vtt/app/layout.js', import.meta.url);
const cssUrl = new URL('../apps/fenix-vtt/app/contextual-tools.css', import.meta.url);

test('rail permanente contém contextos Tokens e Mapa, não todas as ferramentas', async () => {
  const controls = await readFile(controlsUrl, 'utf8');

  assert.match(controls, /Contextos da cena/);
  assert.match(controls, />Tokens<\/small>/);
  assert.match(controls, />Mapa<\/small>/);
  assert.match(controls, /scene-context-palette/);
  assert.match(controls, /context === 'map'/);
});

test('ferramentas de mapa ficam dentro da paleta Mapa', async () => {
  const controls = await readFile(controlsUrl, 'utf8');

  for (const label of ['Grade', 'Paredes / portas', 'Pisos', 'Fog', 'Visão']) {
    assert.ok(controls.includes(label), `paleta Mapa deve conter ${label}`);
  }
  assert.match(controls, /Ambiente e geometria/);
});

test('contexto Tokens concentra seleção e direciona configurações para botão direito', async () => {
  const controls = await readFile(controlsUrl, 'utf8');

  assert.match(controls, /Selecionar \/ mover/);
  assert.match(controls, /Botão direito no token abre suas configurações/);
  assert.match(controls, /Token e entidade/);
});

test('MapStage troca contextos sem empilhar editores', async () => {
  const stage = await readFile(stageUrl, 'utf8');

  assert.match(stage, /const \[controlContext, setControlContext\] = useState\('tokens'\)/);
  assert.match(stage, /function closeSceneEditors\(\)/);
  assert.match(stage, /function activateTokenTool/);
  assert.match(stage, /function openSceneTool/);
  assert.match(stage, /setGridEditorOpen\(nextTool === 'grid'\)/);
  assert.match(stage, /setWallEditorOpen\(nextTool === 'walls'\)/);
  assert.match(stage, /setRegionEditorOpen\(nextTool === 'regions'\)/);
  assert.match(stage, /setFogEditorOpen\(nextTool === 'fog'\)/);
  assert.match(stage, /<SceneContextControls/);
});

test('câmera é separada das ferramentas de edição', async () => {
  const controls = await readFile(controlsUrl, 'utf8');
  const css = await readFile(cssUrl, 'utf8');

  assert.match(controls, /map-camera-controls/);
  assert.match(controls, /onZoomOut/);
  assert.match(controls, /onZoomIn/);
  assert.match(controls, /onFit/);
  assert.match(css, /\.map-camera-toolbar \{\s*display: none !important;/);
});

test('CSS contextual é carregado depois dos estilos de authoring', async () => {
  const layout = await readFile(layoutUrl, 'utf8');
  const regionIndex = layout.indexOf('./scene-region-authoring.css');
  const contextIndex = layout.indexOf('./contextual-tools.css');

  assert.ok(regionIndex >= 0);
  assert.ok(contextIndex > regionIndex);
});
