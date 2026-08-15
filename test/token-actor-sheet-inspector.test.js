import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const actorInspectorUrl = new URL('../apps/fenix-vtt/components/actor-sheet-inspector.jsx', import.meta.url);
const mapStageUrl = new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url);
const clientUrl = new URL('../apps/fenix-vtt/lib/fenix-api-client.js', import.meta.url);
const sceneRoutesUrl = new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url);
const layoutUrl = new URL('../apps/fenix-vtt/app/layout.js', import.meta.url);

test('botão direito do token abre Ficha/Ator contextual sem mover regra para o mapa', async () => {
  const stage = await readFile(mapStageUrl, 'utf8');
  const inspector = await readFile(actorInspectorUrl, 'utf8');

  assert.match(stage, /import \{ ActorSheetInspector \}/);
  assert.match(stage, /<ActorSheetInspector/);
  assert.match(stage, /token=\{inspectedToken\}/);
  assert.match(stage, /onApplied=\{async \(\) =>/);
  assert.match(stage, /await onTokenMoved\?\.\(inspectedToken, \{\}\)/);

  assert.match(inspector, /Caminhada \(m\)/);
  assert.match(inspector, /Natação \(m\)/);
  assert.match(inspector, /Voo \(m\)/);
  assert.match(inspector, /Altura corporal \(m\)/);
  assert.match(inspector, /Altura dos olhos \(m\)/);
  assert.match(inspector, /Visão no escuro/);
  assert.match(inspector, /Baixa luminosidade/);
  assert.match(inspector, /Sentido sísmico/);
});

test('ficha usa endpoints autenticados de ator e mantém edição GM-only', async () => {
  const inspector = await readFile(actorInspectorUrl, 'utf8');
  const client = await readFile(clientUrl, 'utf8');

  assert.match(client, /listActors\(campaignId\)/);
  assert.match(client, /getActor\(campaignId, actorId\)/);
  assert.match(client, /upsertActor\(campaignId, actorId, input\)/);
  assert.match(inspector, /client\.getActor\(campaign\.id, actorId\)/);
  assert.match(inspector, /client\.upsertActor\(campaign\.id, actorId/);
  assert.match(inspector, /disabled=\{!isGm\}/);
  assert.match(inspector, /Ficha em modo de leitura/);
});

test('Fog não aceita mais alcance de visão no contrato de escrita', async () => {
  const stage = await readFile(mapStageUrl, 'utf8');
  const routes = await readFile(sceneRoutesUrl, 'utf8');

  assert.doesNotMatch(stage, /Alcance de visão \(células\)/);
  assert.doesNotMatch(stage, /visionRangeCells: normalized\.visionRangeCells/);
  assert.doesNotMatch(routes, /visionRangeCells: request\.body\?\.visionRangeCells/);
  assert.match(stage, /Fog guarda apenas o que já foi explorado/);
  assert.match(stage, /Alcance e sentidos vêm da Ficha \+ Sistema RPG/);
});

test('estilo do editor de ficha é carregado depois das ferramentas contextuais', async () => {
  const layout = await readFile(layoutUrl, 'utf8');
  const toolsIndex = layout.indexOf('./contextual-tools.css');
  const actorIndex = layout.indexOf('./actor-sheet-inspector.css');
  assert.ok(toolsIndex >= 0);
  assert.ok(actorIndex > toolsIndex);
});
