import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('token authoring persistente possui API independente da sessão narrativa', async () => {
  const [routes, app, server, client] = await Promise.all([
    source('apps/api/src/http/register-token-routes.js'),
    source('apps/api/src/app.js'),
    source('apps/api/src/server.js'),
    source('apps/fenix-vtt/lib/fenix-api-client.js')
  ]);

  assert.match(routes, /scenes\/:sceneId\/tokens/);
  assert.match(routes, /tokenService\.list/);
  assert.match(routes, /tokenService\.upsert/);
  assert.match(app, /registerTokenRoutes/);
  assert.match(app, /tokenService = null/);
  assert.match(server, /tokenService,/);
  assert.match(client, /listSceneTokens\(campaignId, sceneId\)/);
  assert.match(client, /upsertSceneToken\(campaignId, sceneId, token\)/);
});

test('colocar token não inicia IA e usa persistência da cena quando realtime não está conectado', async () => {
  const provider = await source('apps/fenix-vtt/components/session-provider.jsx');
  const state = await source('apps/fenix-vtt/lib/session-state.js');
  const start = provider.indexOf('const placeActorToken = useCallback');
  const end = provider.indexOf('const createMapScene = useCallback', start);
  assert.ok(start >= 0 && end > start);
  const placement = provider.slice(start, end);

  assert.doesNotMatch(placement, /ensureSession\(/);
  assert.match(placement, /client\.upsertSceneToken/);
  assert.match(provider, /client\.listSceneTokens/);
  assert.match(provider, /const moveToken = useCallback/);
  assert.match(provider, /activeScene\.id, normalizedToken/);
  assert.match(state, /case 'SCENE_TOKENS'/);
});
