import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stageUrl = new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url);
const regionUrl = new URL('../apps/fenix-vtt/components/scene-region-authoring.jsx', import.meta.url);
const shellUrl = new URL('../apps/fenix-vtt/components/vtt-shell.jsx', import.meta.url);
const layoutUrl = new URL('../apps/fenix-vtt/app/layout.js', import.meta.url);

test('MapStage oferece uma única camada contextual de regiões', async () => {
  const source = await readFile(stageUrl, 'utf8');

  assert.match(source, /const \[regionEditorOpen, setRegionEditorOpen\] = useState\(false\)/);
  assert.match(source, /openSceneTool\(regionEditorOpen \? null : 'regions'\)/);
  assert.match(source, />Pisos<\/button>/);
  assert.match(source, /<SceneRegionAuthoring/);
  assert.match(source, /if \(busy \|\| event\.button === 2 \|\| regionEditorOpen\) return/);
});

test('authoring de região separa Piso, Escada e Rampa', async () => {
  const source = await readFile(regionUrl, 'utf8');

  assert.match(source, /SceneRegionKind\.FLOOR/);
  assert.match(source, /SceneRegionKind\.STAIRS/);
  assert.match(source, /SceneRegionKind\.RAMP/);
  assert.match(source, />Piso<\/button>/);
  assert.match(source, />Escada<\/button>/);
  assert.match(source, />Rampa<\/button>/);
  assert.match(source, /Inverter sentido da subida/);
});

test('regiões usam nível base, snap e persistência pelo provider', async () => {
  const region = await readFile(regionUrl, 'utf8');
  const shell = await readFile(shellUrl, 'utf8');

  assert.match(region, /Nível base/);
  assert.match(region, /Snap na grade/);
  assert.match(region, /normalizeSceneRegions\(regions/);
  assert.match(region, /onRegionsChanged\(scene\.id, normalized\)/);
  assert.match(shell, /updateSceneRegions/);
  assert.match(shell, /onRegionsChanged=\{updateSceneRegions\}/);
});

test('CSS de authoring é carregado por último no shell', async () => {
  const layout = await readFile(layoutUrl, 'utf8');
  const inspectorIndex = layout.indexOf('./context-inspector.css');
  const regionIndex = layout.indexOf('./scene-region-authoring.css');

  assert.ok(inspectorIndex >= 0);
  assert.ok(regionIndex > inspectorIndex);
});
