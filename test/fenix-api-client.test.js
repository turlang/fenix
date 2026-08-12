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

test('FenixApiClient envia campanha, credenciais e eventos para os endpoints universais', async () => {
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

  await client.start({ activeScene: { id: 'scene-1' } }, 'campaign-1');
  await client.roomEntry({ room: { id: '03', name: 'Câmara Norte' }, source: { canonicalAnchor: true, text: 'Fonte.' } });

  assert.equal(calls[0].url, 'http://engine.test/v1/session/start');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    snapshot: { activeScene: { id: 'scene-1' } },
    campaignId: 'campaign-1'
  });
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[1].url, 'http://engine.test/v1/session/room-entry');
  assert.equal(calls[1].options.credentials, 'include');
  assert.equal(JSON.parse(calls[1].options.body).room.id, '03');
});

test('FenixApiClient expõe endpoints de autenticação e campanhas com cookie habilitado', async () => {
  const calls = [];
  const client = new FenixApiClient({
    baseUrl: 'http://engine.test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true });
    }
  });

  await client.login({ email: 'gm@example.com', password: 'senha-segura' });
  await client.createCampaign({ title: 'Ecos de Amn' });
  await client.createInvite('campaign-1', 'hero-ayla');

  assert.match(calls[0].url, /\/v1\/auth\/login$/);
  assert.match(calls[1].url, /\/v1\/campaigns$/);
  assert.match(calls[2].url, /\/v1\/campaigns\/campaign-1\/invites$/);
  assert.ok(calls.every((call) => call.options.credentials === 'include'));
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
