import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stage = await readFile(new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url), 'utf8');
const controlsCss = await readFile(new URL('../apps/fenix-vtt/app/scene-controls.css', import.meta.url), 'utf8');
const floorCss = await readFile(new URL('../apps/fenix-vtt/app/floor-region-visual.css', import.meta.url), 'utf8');
const layout = await readFile(new URL('../apps/fenix-vtt/app/layout.js', import.meta.url), 'utf8');

test('Mestre usa camadas e paleta contextual no padrão de VTT', () => {
  assert.match(stage, /SceneLayer = Object\.freeze/);
  assert.match(stage, /Camadas da cena/);
  assert.match(stage, />Tokens</);
  assert.match(stage, />Paredes</);
  assert.match(stage, />Regiões</);
  assert.match(stage, />Fog</);
  assert.match(stage, />Grade</);
  assert.match(stage, /Ferramentas da camada ativa/);
});

test('regiões são criadas e movidas diretamente pelo canvas', () => {
  assert.match(stage, /handleRegionPointerDown/);
  assert.match(stage, /handleRegionPointerMove/);
  assert.match(stage, /handleRegionPointerUp/);
  assert.match(stage, /regionGestureRef/);
  assert.match(stage, /SceneRegionKind\.FLOOR/);
  assert.match(stage, /SceneRegionKind\.STAIRS/);
  assert.match(stage, /SceneRegionKind\.RAMP/);
  assert.match(stage, /translatedRegion/);
  assert.match(stage, /Escolha Piso, Escada ou Rampa e arraste no mapa/);
});

test('região selecionada possui legend, inspector e persistência GM-only existente', () => {
  assert.match(stage, /scene-region-legend/);
  assert.match(stage, /scene-region-inspector/);
  assert.match(stage, /Z inicial/);
  assert.match(stage, /Z final/);
  assert.match(stage, /Inverter subida/);
  assert.match(stage, /regionClient\.updateSceneRegions\(campaign\.id, scene\.id, normalized\)/);
});

test('CSS carrega controles laterais e remove botão legado de pisos', () => {
  assert.match(layout, /import '\.\/scene-controls\.css';/);
  assert.match(controlsCss, /\.scene-layer-controls/);
  assert.match(controlsCss, /\.scene-tool-palette/);
  assert.match(controlsCss, /\.scene-region-authoring-overlay/);
  assert.match(floorCss, /\.floor-region-overlay-toggle \{\s*display: none;/);
});
