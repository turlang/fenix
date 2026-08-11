import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('server é somente composition root e não declara regras HTTP de sessão', async () => {
  const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../apps/api/src/http/register-session-routes.js', import.meta.url), 'utf8');
  const controller = await readFile(new URL('../apps/api/src/http/session-controller.js', import.meta.url), 'utf8');

  assert.doesNotMatch(server, /app\.(post|get)\(['"]\/v1\/session/);
  assert.match(routes, /\/v1\/session\/room-entry/);
  assert.match(controller, /sessionService\.describeRoom/);
  assert.doesNotMatch(controller, /RulesService|NarrationService|RelationshipService/);
});
