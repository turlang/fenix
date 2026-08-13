import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('exploração persistida deriva do TOKEN_MOVE normalizado e não de endpoint público de células', async () => {
  const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url), 'utf8');

  assert.ok(server.includes("message.type === 'TOKEN_MOVE'"));
  assert.ok(server.includes('const result = await peer.receive(raw)'));
  assert.ok(server.includes('sceneService.recordExploration'));
  assert.ok(server.includes('actorId: result.token.id'));
  assert.ok(server.includes('x: result.token.x'));
  assert.ok(server.includes('y: result.token.y'));
  assert.equal(routes.includes('exploredCells'), false, 'HTTP não deve aceitar células arbitrárias do browser');
});
