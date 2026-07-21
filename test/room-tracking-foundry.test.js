import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');

test('marcador numérico usa x/y como centro e área mínima de duas células', () => {
  const block = source.slice(source.indexOf('function roomMarkerBounds'), source.indexOf('function tokenCenterPixels'));
  assert.match(block, /gridSize \* 2/);
  assert.match(block, /Number\(document\.x \?\? 0\) - width \/ 2/);
  assert.match(block, /Number\(document\.y \?\? 0\) - height \/ 2/);
});

test('GM verifica movimentos de tokens realizados por jogadores', () => {
  const block = source.slice(source.indexOf('function installRoomTracking'), source.indexOf('async function ensureSessionActive'));
  assert.match(block, /Hooks\.on\('updateToken', \(\) =>/);
  assert.doesNotMatch(block, /userId !== game\.user\.id/);
  assert.match(block, /Hooks\.on\('canvasReady', scheduleRoomCheck\)/);
});

test('detecção usa a Note numerada mais próxima em salas amplas', () => {
  const block = source.slice(source.indexOf('function findRoomMarkerForToken'), source.indexOf('function resetRoomNarrationState'));
  assert.match(block, /extractRoomNumberFromMarker/);
  assert.match(block, /ranked\[0\]\?\.distance <= gridSize \* 8/);
});

test('rastreamento aceita personagem controlado pelo GM durante teste', () => {
  const block = source.slice(source.indexOf('function visiblePlayerTokens'), source.indexOf('function findRoomNoteForToken'));
  assert.match(block, /token\.controlled/);
  assert.match(block, /actor\?\.type/);
  assert.match(block, /Fallback de diagnóstico/);
});

test('módulo recupera sessão ativa automaticamente no ready', () => {
  assert.match(source, /async function synchronizeRoomSessionState\(\)/);
  assert.match(source, /void synchronizeRoomSessionState\(\)/);
  assert.match(source, /sessão ativa recuperada automaticamente/);
});

test('transição encontra Journal pelo número, sem usar vínculo individual do marcador', () => {
  const block = source.slice(source.indexOf('async function checkRoomTransitions'), source.indexOf('function scheduleRoomCheck'));
  assert.match(block, /findJournalSourceForRoom\(scene, roomNumber\)/);
  assert.doesNotMatch(block, /findSceneJournalReference/);
  assert.doesNotMatch(block, /marker\.page|roomMarker\.page/);
});
