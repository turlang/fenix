import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mapStageUrl = new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url);
const actorInspectorUrl = new URL('../apps/fenix-vtt/components/actor-sheet-inspector.jsx', import.meta.url);
const layoutUrl = new URL('../apps/fenix-vtt/app/layout.js', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('botão direito não inicia drag e abre configurações contextuais', async () => {
  const code = await source(mapStageUrl);

  assert.match(code, /busy \|\| event\.button === 2/);
  assert.match(code, /function handleContextMenu\(event\)/);
  assert.match(code, /onContextMenu=\{handleContextMenu\}/);
  assert.match(code, /Configurações do token/);
  assert.match(code, /Configurações da cena/);
});

test('token contextual mantém token separado da Ficha/Ator e Sistema', async () => {
  const stage = await source(mapStageUrl);
  const actor = await source(actorInspectorUrl);

  assert.match(stage, /tokenIdentity/);
  assert.match(stage, /<ActorSheetInspector/);
  assert.match(actor, /actorId/);
  assert.match(actor, /sheetId/);
  assert.match(actor, /systemId/);
  assert.match(actor, /Deslocamento/);
  assert.match(actor, /Visão e sentidos/);
});

test('cena contextual oferece somente ferramentas de mapa já disponíveis', async () => {
  const code = await source(mapStageUrl);

  assert.match(code, /Grade e escala/);
  assert.match(code, /Paredes e portas/);
  assert.match(code, /Fog \/ exploração/);
  assert.match(code, /1 célula =/);
});

test('estilo do inspector é carregado depois do shell principal', async () => {
  const code = await source(layoutUrl);
  const experienceIndex = code.indexOf("./vtt-experience.css");
  const inspectorIndex = code.indexOf("./context-inspector.css");

  assert.ok(experienceIndex >= 0);
  assert.ok(inspectorIndex > experienceIndex);
});
