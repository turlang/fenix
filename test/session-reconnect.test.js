import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('módulo reconecta sessão ativa sem chamar start novamente', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const startFunction = source.slice(source.indexOf('async function startSession'), source.indexOf('function injectStartButton'));
  assert.match(startFunction, /request\('\/v1\/session\/status'\)/);
  assert.match(startFunction, /currentStatus\?\.state === 'COLLECTING_ACTIONS'/);
  assert.match(startFunction, /resetRoomNarrationState\(currentStatus\.sessionId\)/);
  assert.match(startFunction, /primeRoomOccupancy\(\)/);
  assert.ok(startFunction.indexOf("request('/v1/session/status')") < startFunction.indexOf('collectSnapshot()'));
});

test('abertura não dispara uma segunda narração da sala inicial', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const startFunction = source.slice(source.indexOf('async function startSession'), source.indexOf('function injectStartButton'));
  assert.match(startFunction, /publishNarrationChat\(result\.opening, `opening:/);
  assert.match(startFunction, /primeRoomOccupancy\(\)/);
  assert.doesNotMatch(startFunction, /void checkRoomTransitions\(\)/);
});
