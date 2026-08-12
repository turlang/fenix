import test from 'node:test';
import assert from 'node:assert/strict';
import { FenixApiClient, FenixApiError } from '../apps/fenix-vtt/lib/fenix-api-client.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
}

test('FenixApiClient envia campanha, commandId, credenciais e eventos para os endpoints universais', async () => {
  const calls = [];
  const client = new FenixApiClient({
    baseUrl: 'http://engine.test/',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/start')) return jsonResponse({ state: 'COLLECTING_ACTIONS', opening: 'Abertura.' });
      if (url.endsWith('/room-entry')) return jsonResponse({ state: 'COLLECTING_ACTIONS', opening: 'Sala.', room: { id: '03' } });
      return jsonResponse({ state: 'COLLECTING_ACTIONS' });
    }
  });

  await client.start({ activeScene: { id: 'scene-1' } }, 'campaign-1', 'command-start-1');
  await client.roomEntry(
    { room: { id: '03', name: 'Câmara Norte' }, source: { canonicalAnchor: true, text: 'Fonte.' } },
    'campaign-1',
    'command-room-1'
  );

  assert.equal(calls[0].url, 'http://engine.test/v1/session/start');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    snapshot: { activeScene: { id: 'scene-1' } },
    campaignId: 'campaign-1',
    commandId: 'command-start-1'
  });
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[1].url, 'http://engine.test/v1/session/room-entry');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(JSON.parse(calls[1].options.body).room.id, '03');
  assert.equal(JSON.parse(calls[1].options.body).commandId, 'command-room-1');
});

test('FenixApiClient expõe endpoints de autenticação, campanhas, mapas e paredes com cookie habilitado', async () => {
  const calls = [];
  const client = new FenixApiClient({
    baseUrl: 'http://engine.test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, asset: { id: 'asset-1' }, scene: { id: 'scene-1' } });
    }
  });

  await client.login({ email: 'gm@example.com', password: 'senha-segura' });
  await client.createCampaign({ title: 'Ecos de Amn' });
  await client.createInvite('campaign-1', 'hero-ayla');
  await client.importMapUrl('campaign-1', 'https://cdn.example.com/maps/templo.webp');
  await client.updateSceneWalls('campaign-1', 'scene-1', [
    { id: 'wall-1', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 100, y: 0 }, doorState: null }
  ]);

  assert.match(calls[0].url, /\/v1\/auth\/login$/);
  assert.match(calls[1].url, /\/v1\/campaigns$/);
  assert.match(calls[2].url, /\/v1\/campaigns\/campaign-1\/invites$/);
  assert.match(calls[3].url, /\/v1\/campaigns\/campaign-1\/assets\/import-url$/);
  assert.deepEqual(JSON.parse(calls[3].options.body), { url: 'https://cdn.example.com/maps/templo.webp' });
  assert.match(calls[4].url, /\/v1\/campaigns\/campaign-1\/scenes\/scene-1\/walls$/);
  assert.equal(JSON.parse(calls[4].options.body).walls[0].id, 'wall-1');
  assert.ok(calls.every((call) => call.options.credentials === 'include'));
});

test('FenixApiClient chama fetch com contexto global compatível com navegadores', async () => {
  let observedThis = null;
  const fetchImpl = async function () {
    observedThis = this;
    return jsonResponse({ bootstrapRequired: true });
  };
  const client = new FenixApiClient({ baseUrl: 'http://engine.test', fetchImpl });

  const result = await client.authStatus();

  assert.equal(observedThis, globalThis);
  assert.deepEqual(result, { bootstrapRequired: true });
});

test('FenixApiClient preserva código e status retornados pelo Engine', async () => {
  const client = new FenixApiClient({
    fetchImpl: async () => jsonResponse({ code: 'AI_NOT_CONFIGURED', message: 'Groq ausente.' }, 503)
  });

  await assert.rejects(
    () => client.status(),
    (error) => error instanceof FenixApiError
      && error.code === 'AI_NOT_CONFIGURED'
      && error.status === 503
      && /Groq ausente/.test(error.message)
  );
});
