import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editorSource = await readFile(new URL('../apps/fenix-vtt/components/advanced-vision-editor.jsx', import.meta.url), 'utf8');
const fogSource = await readFile(new URL('../apps/fenix-vtt/components/fog-of-war-overlay.jsx', import.meta.url), 'utf8');
const floorOverlaySource = await readFile(new URL('../apps/fenix-vtt/components/floor-region-overlay.jsx', import.meta.url), 'utf8');
const lightingSource = await readFile(new URL('../apps/fenix-vtt/components/dynamic-lighting-overlay.jsx', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url), 'utf8');
const serverSource = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');

test('editor expõe visão, níveis, voo, altura corporal e piso automático', () => {
  assert.match(editorSource, /Visão no escuro/);
  assert.match(editorSource, /Infravisão/);
  assert.match(editorSource, /Alcance \(células\)/);
  assert.match(editorSource, /Elevação base \/ Z/);
  assert.match(editorSource, /Altura do corpo/);
  assert.match(editorSource, /Solo \/ piso automático/);
  assert.match(editorSource, /Voo \/ Z variável/);
  assert.match(editorSource, /Níveis da cena/);
  assert.match(editorSource, /Pisos e transições/);
  assert.match(editorSource, /Aplicar faixa padrão às paredes/);
  assert.match(editorSource, /Fonte de luz pessoal anexada ao token/);
  assert.match(editorSource, /SceneRegionKind/);
  assert.match(editorSource, /updateSceneRegions/);
});

test('Mestre possui overlay visual de pisos e badges de Z sobre o battlemap', () => {
  assert.match(floorOverlaySource, /if \(!isGm \|\| !scene \|\| !viewport\) return null/);
  assert.match(floorOverlaySource, /Pisos · \{regions\.length\}/);
  assert.match(floorOverlaySource, /floor-region-shape region-\$\{region\.kind\}/);
  assert.match(floorOverlaySource, /floor-region-live-arrow/);
  assert.match(floorOverlaySource, /floor-region-token-z/);
  assert.match(fogSource, /FloorRegionOverlay/);
  assert.match(fogSource, /viewport=\{viewport\}/);
});

test('Fog usa alcance e elevação individuais e só aplica sentidos especiais na visão ativa', () => {
  assert.match(fogSource, /resolveTokenVisionProfile/);
  assert.match(fogSource, /visionRangeCells: visionProfile\.rangeCells/);
  assert.match(fogSource, /verticalEnabled: elevationConfig\.enabled/);
  assert.match(fogSource, /originElevation: observerElevation/);
  assert.match(fogSource, /elevation: observerElevation/);
});

test('Lighting deriva luz pessoal com Z e habilita oclusão vertical', () => {
  assert.match(lightingSource, /personalLightSources/);
  assert.match(lightingSource, /elevation: profile\.elevation/);
  assert.match(lightingSource, /verticalEnabled: elevationConfig\.enabled/);
});

test('rotas expõem authoring de regiões e Fog vertical autenticados', () => {
  assert.match(routeSource, /scenes\/:sceneId\/regions/);
  assert.match(routeSource, /updateRegions/);
  assert.match(routeSource, /sceneElevation: request\.body\?\.sceneElevation/);
});

test('composition root resolve piso no Engine e persiste exploração com Z aceito', () => {
  assert.match(serverSource, /resolveGroundElevation/);
  assert.match(serverSource, /pendingMovePoint/);
  assert.match(serverSource, /resolveRuntimeVerticalState/);
  assert.match(serverSource, /elevation: result\.token\.elevation/);
});
