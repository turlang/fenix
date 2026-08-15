import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routesUrl = new URL('../apps/api/src/http/register-actor-routes.js', import.meta.url);
const appUrl = new URL('../apps/api/src/app.js', import.meta.url);

test('API oferece leitura de ficha e atualização persistente GM-only pelo serviço', async () => {
  const routes = await readFile(routesUrl, 'utf8');
  assert.match(routes, /\/v1\/campaigns\/:campaignId\/actors/);
  assert.match(routes, /actorService\.list/);
  assert.match(routes, /actorService\.get/);
  assert.match(routes, /actorService\.upsert/);
  assert.match(routes, /requireAuthenticatedRequest/);
});

test('composition root HTTP registra ator apenas quando actorService existe', async () => {
  const app = await readFile(appUrl, 'utf8');
  assert.match(app, /registerActorRoutes/);
  assert.match(app, /if \(actorService\) registerActorRoutes/);
  assert.match(app, /actorSheets: actorService \? 'enabled' : 'disabled'/);
});
