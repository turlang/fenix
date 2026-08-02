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
  assert.match(block, /Hooks\.on\('updateToken', \(document, changes = \{\}\) =>/);
  assert.doesNotMatch(block, /userId !== game\.user\.id/);
  assert.match(block, /Hooks\.on\('canvasReady', \(\) =>/);
  assert.match(block, /roomNarrationState\.primed = false/);
});

test('detecção usa a Note numerada mais próxima em salas amplas', () => {
  const block = source.slice(source.indexOf('function findRoomMarkerForToken'), source.indexOf('function resetRoomNarrationState'));
  assert.match(block, /extractRoomNumberFromMarker/);
  assert.match(block, /ranked\[0\]\?\.distance <= gridSize \* 8/);
});

test('combina documentos da Scene com marcadores renderizados', () => {
  const block = source.slice(source.indexOf('function roomMarkersForScene'), source.indexOf('function tokenTrackingId'));
  assert.match(block, /const markersById = new Map\(\)/);
  assert.match(block, /for \(const marker of sceneMarkers\)/);
  assert.match(block, /for \(const marker of renderedMarkers\)/);
  assert.match(block, /return \[\.\.\.markersById\.values\(\)\]/);
});

test('número da sala pode vir do texto renderizado pelo marcador', () => {
  const block = source.slice(source.indexOf('function extractRoomNumberFromMarker'), source.indexOf('function extractRoomReadAloud'));
  assert.match(block, /marker\?\.tooltip\?\.text/);
  assert.match(block, /document\.page\?\.name/);
  assert.match(block, /linkedPage\?\.name/);
  assert.match(block, /linkedJournal\?\.name/);
  assert.match(block, /return number/);
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

test('monitor periódico detecta mudanças mesmo quando o hook não é emitido', () => {
  const block = source.slice(source.indexOf('function stopRoomMonitor'), source.indexOf('function primeRoomOccupancy'));
  assert.match(block, /ROOM_MONITOR_INTERVAL_MS/);
  assert.match(block, /await checkRoomTransitions\(\)/);
  assert.match(block, /startRoomMonitor\(\)/);
});

test('transição encontra Journal pelo número, sem usar vínculo individual do marcador', () => {
  const block = source.slice(source.indexOf('async function checkRoomTransitions'), source.indexOf('function scheduleRoomCheck'));
  assert.match(block, /findJournalSourceForRoom\(scene, occupancy\.roomNumber\)/);
  assert.doesNotMatch(block, /findSceneJournalReference/);
  assert.doesNotMatch(block, /marker\.page|roomMarker\.page/);
  assert.match(block, /roomNarrationState\.observe/);
  assert.match(block, /entrada em nova sala detectada/);
  assert.match(block, /publicationKey = `room:.*:token:/);
  assert.match(block, /eventId: publicationKey/);
  assert.match(block, /result\.duplicate/);
  assert.match(block, /requisição duplicada bloqueada pelo Engine/);
  assert.doesNotMatch(block, /roomNarrationState\.rollback/);
});

test('correlação aceita Journal numerado dentro da pasta da cena', () => {
  const block = source.slice(source.indexOf('function extractRoomReadAloud'), source.indexOf('function visiblePlayerTokens'));
  assert.match(block, /journalMatchesRoom/);
  assert.match(block, /journalFolderName/);
  assert.match(block, /journalNumber === roomNumber/);
  assert.match(block, /extractRoomReadAloud\(page, roomNumber, journal\?\.name\)/);
});

test('áudio da sala é enviado apenas aos donos do token que entrou', () => {
  const helpers = source.slice(source.indexOf('function tokenNarrationRecipientUserIds'), source.indexOf('function findRoomMarkerForToken'));
  const transition = source.slice(source.indexOf('async function checkRoomTransitions'), source.indexOf('function scheduleRoomCheck'));
  assert.match(helpers, /ownerUserIdsForToken/);
  assert.match(helpers, /DOCUMENT_OWNERSHIP_LEVELS\?\.OWNER/);
  assert.match(transition, /const recipientUserIds = tokenNarrationRecipientUserIds\(token\)/);
  assert.doesNotMatch(transition, /tokensOccupyingRoom/);
  assert.match(transition, /const \{ visibleActors, perception \} = roomViewForToken/);
  assert.match(transition, /:token:\$\{occupancy\.tokenId\}/);
  assert.match(transition, /recipientUserIds\n\s*\);/);
});

test('contexto narrativo usa a fonte de visão do token que entrou', () => {
  const helpers = source.slice(source.indexOf('function sceneTokensForVision'), source.indexOf('function tokenNarrationRecipientUserIds'));
  const transition = source.slice(source.indexOf('async function checkRoomTransitions'), source.indexOf('function scheduleRoomCheck'));
  assert.match(source, /from '\.\/token-vision\.js'/);
  assert.match(helpers, /visibleTokensFrom\(token, candidates, \{ gridSize \}\)/);
  assert.match(helpers, /roomOccupancyForToken\(candidate, scene, markers\)\.roomKey === roomKey/);
  assert.match(helpers, /createTokenPerception\(token, visibleTokens\)/);
  assert.match(transition, /visibleActors,\n\s*narrationExclusions: \{ actorNames: sceneActorNames\(scene\) \},\n\s*perception/);
  assert.doesNotMatch(transition, /visibleActors = roomTokens/);
});

test('chat da sala é publicado como sussurro para os donos do token', () => {
  const transition = source.slice(source.indexOf('async function checkRoomTransitions'), source.indexOf('function scheduleRoomCheck'));
  const publisher = source.slice(source.indexOf('async function publishNarrationChat'), source.indexOf('async function startSession'));
  assert.match(transition, /publishNarrationChat\(result\.opening, publicationKey, recipientUserIds\)/);
  assert.match(publisher, /normalizeRecipientUserIds\(recipientUserIds\)/);
  assert.match(publisher, /messageData\.whisper = recipients/);
  assert.match(publisher, /sussurro descartado porque não há destinatários/);
});
