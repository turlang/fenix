import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mapStageUrl = new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url);
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

test('token contextual separa token, ator, ficha e sistema', async () => {
  const code = await source(mapStageUrl);

  assert.match(code, /tokenId/);
  assert.match(code, /actorId/);
  assert.match(code, /sheetId/);
  assert.match(code, /systemId/);
  assert.match(code, /Ficha e demais capacidades pertencem|Visão, deslocamento, voo, natação/);
});

test('cena contextual oferece somente ferramentas de mapa já disponíveis', async () => {
  const code = await source(mapStageUrl);

  assert.match(code, /Grade e escala/);
  assert.match(code, /Paredes e portas/);
  assert.match(code, /Fog \/ visão/);
  assert.match(code, /1 célula =/);
});

test('estilo do inspector é carregado depois do shell principal', async () => {
  const code = await source(layoutUrl);
  const experienceIndex = code.indexOf("./vtt-experience.css");
  const inspectorIndex = code.indexOf("./context-inspector.css");

  assert.ok(experienceIndex >= 0);
  assert.ok(inspectorIndex > experienceIndex);
});
