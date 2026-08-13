import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const editorSource = await readFile(new URL('../apps/fenix-vtt/components/advanced-vision-editor.jsx', import.meta.url), 'utf8');
const fogSource = await readFile(new URL('../apps/fenix-vtt/components/fog-of-war-overlay.jsx', import.meta.url), 'utf8');
const lightingSource = await readFile(new URL('../apps/fenix-vtt/components/dynamic-lighting-overlay.jsx', import.meta.url), 'utf8');
const routeSource = await readFile(new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url), 'utf8');

test('editor expõe visão normal, darkvision, infravision, alcance, elevação e luz pessoal', () => {
  assert.match(editorSource, /Visão no escuro/);
  assert.match(editorSource, /Infravisão/);
  assert.match(editorSource, /Alcance \(células\)/);
  assert.match(editorSource, /Elevação \/ Z/);
  assert.match(editorSource, /Fonte de luz pessoal anexada ao token/);
  assert.match(editorSource, /visionProfiles/);
});

test('Fog usa alcance individual e só aplica sentidos especiais na visão ativa', () => {
  assert.match(fogSource, /resolveTokenVisionProfile/);
  assert.match(fogSource, /visionRangeCells: visionProfile\.rangeCells/);
  assert.match(fogSource, /maxDistance: visionProfile\.rangeCells/);
  assert.match(fogSource, /visionProfile=\{active \? visionProfile : null\}/);
  assert.match(fogSource, /visionPolygon=\{active \? visibility : \[\]\}/);
  assert.match(fogSource, /active=\{true\}/);
});

test('Lighting deriva luz pessoal e reduz escuridão apenas dentro do LOS avançado', () => {
  assert.match(lightingSource, /personalLightSources/);
  assert.match(lightingSource, /vision-personal-/);
  assert.match(lightingSource, /tokenVisionTint/);
  assert.match(lightingSource, /visionPolygon/);
  assert.match(lightingSource, /visionMaskFill/);
});

test('rota de Fog encaminha visionProfiles ao serviço autenticado', () => {
  assert.match(routeSource, /visionProfiles: request\.body\?\.visionProfiles/);
});
