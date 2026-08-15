import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routesUrl = new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url);
const clientUrl = new URL('../apps/fenix-vtt/lib/fenix-api-client.js', import.meta.url);
const providerUrl = new URL('../apps/fenix-vtt/components/session-provider.jsx', import.meta.url);

test('API separa elevação e regiões de Fog', async () => {
  const routes = await readFile(routesUrl, 'utf8');
  assert.match(routes, /scenes\/:sceneId\/elevation/);
  assert.match(routes, /sceneService\.updateElevation/);
  assert.match(routes, /scenes\/:sceneId\/regions/);
  assert.match(routes, /sceneService\.updateRegions/);
  assert.equal(routes.includes('visionProfiles'), false);
});

test('cliente expõe authoring físico por endpoints próprios', async () => {
  const client = await readFile(clientUrl, 'utf8');
  assert.match(client, /updateSceneElevation\(campaignId, sceneId, elevation\)/);
  assert.match(client, /updateSceneRegions\(campaignId, sceneId, regions\)/);
  assert.match(client, /\/elevation/);
  assert.match(client, /\/regions/);
});

test('provider preserva elevação e regiões ao sincronizar cena realtime', async () => {
  const provider = await readFile(providerUrl, 'utf8');
  assert.match(provider, /elevation: structuredClone\(scene\.elevation/);
  assert.match(provider, /regions: structuredClone\(scene\.regions/);
  assert.match(provider, /updateSceneElevation/);
  assert.match(provider, /updateSceneRegions/);
  assert.match(provider, /token\?\.actorId \?\? token\?\.id/);
});
