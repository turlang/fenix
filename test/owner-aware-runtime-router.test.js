import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OwnerAwareRuntimeRouter,
  RuntimeRoutingSigner,
  resolveOwnerWebSocketUrl
} from '../packages/owner-aware-runtime-router/src/index.js';

const SECRET = 'fenix-test-routing-secret-0123456789abcdef';

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

test('assinatura interna detecta adulteração e expiração', () => {
  const signer = new RuntimeRoutingSigner({ secret: SECRET, maxClockSkewMs: 10_000 });
  const timestamp = Date.now();
  const headers = signer.sign({
    source: 'engine-a',
    generation: 7,
    timestamp,
    method: 'POST',
    path: '/v1/session/action',
    body: { campaignId: 'campaign-a', content: 'examino a porta' }
  });

  const verified = signer.verify({
    headers,
    method: 'POST',
    path: '/v1/session/action',
    body: { content: 'examino a porta', campaignId: 'campaign-a' },
    now: timestamp + 500
  });
  assert.equal(verified.routed, true);
  assert.equal(verified.generation, 7);

  assert.throws(
    () => signer.verify({
      headers,
      method: 'POST',
      path: '/v1/session/action',
      body: { campaignId: 'campaign-a', content: 'conteúdo alterado' },
      now: timestamp + 500
    }),
    (error) => error.code === 'RUNTIME_ROUTING_AUTH_INVALID' && error.statusCode === 401
  );

  assert.throws(
    () => signer.verify({
      headers,
      method: 'POST',
      path: '/v1/session/action',
      body: { campaignId: 'campaign-a', content: 'examino a porta' },
      now: timestamp + 20_000
    }),
    (error) => error.code === 'RUNTIME_ROUTING_AUTH_EXPIRED'
  );
});

test('router encaminha HTTP ao owner preservando autenticação e assinatura interna', async () => {
  let received = null;
  const router = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-b',
    leaseManager: {
      inspect: async () => ({
        campaignId: 'campaign-a',
        ownerId: 'engine-a',
        ownerUrl: 'http://engine-a:3001',
        sessionId: 'session-a',
        generation: 11,
        leaseUntil: new Date(Date.now() + 60_000).toISOString()
      })
    },
    routingSecret: SECRET,
    fetchImpl: async (url, options) => {
      received = { url, options };
      return jsonResponse(200, { state: 'COLLECTING_ACTIONS', narration: 'ok' });
    }
  });

  const result = await router.executeHttp({
    campaignId: 'campaign-a',
    sessionId: 'session-a',
    method: 'POST',
    path: '/v1/session/action',
    body: { campaignId: 'campaign-a', content: 'examino a porta' },
    headers: { cookie: 'fenix_session=opaque', authorization: 'Bearer fallback' },
    executeLocal: async () => assert.fail('não deveria executar localmente')
  });

  assert.equal(result.narration, 'ok');
  assert.equal(received.url, 'http://engine-a:3001/v1/session/action');
  assert.equal(received.options.headers.cookie, 'fenix_session=opaque');
  assert.equal(received.options.headers.authorization, 'Bearer fallback');
  assert.equal(received.options.headers['x-fenix-route-generation'], '11');
  assert.equal(received.options.headers['x-fenix-route-hop'], '1');
  assert.ok(received.options.headers['x-fenix-route-signature']);
});

test('requisição já roteada nunca cria proxy em cadeia', async () => {
  const signer = new RuntimeRoutingSigner({ secret: SECRET });
  const body = { campaignId: 'campaign-a', content: 'ação' };
  const path = '/v1/session/action';
  const headers = signer.sign({
    source: 'engine-a',
    generation: 2,
    method: 'POST',
    path,
    body
  });
  const router = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-b',
    leaseManager: {
      inspect: async () => ({
        ownerId: 'engine-c',
        ownerUrl: 'http://engine-c:3001',
        sessionId: 'session-a',
        generation: 3,
        leaseUntil: new Date(Date.now() + 60_000).toISOString()
      })
    },
    routingSecret: SECRET,
    fetchImpl: async () => assert.fail('não deveria criar segundo proxy')
  });

  await assert.rejects(
    () => router.executeHttp({
      campaignId: 'campaign-a',
      sessionId: 'session-a',
      method: 'POST',
      path,
      body,
      headers,
      executeLocal: async () => assert.fail('não deveria executar localmente')
    }),
    (error) => error.code === 'RUNTIME_OWNER_CHANGED' && error.ownerId === 'engine-c'
  );
});

test('router refaz resolução uma vez quando generation muda durante takeover', async () => {
  let inspections = 0;
  let requests = 0;
  const router = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-c',
    leaseManager: {
      inspect: async () => {
        inspections += 1;
        if (inspections === 1) {
          return {
            ownerId: 'engine-a',
            ownerUrl: 'http://engine-a:3001',
            sessionId: 'session-a',
            generation: 4,
            leaseUntil: new Date(Date.now() + 60_000).toISOString()
          };
        }
        return {
          ownerId: 'engine-b',
          ownerUrl: 'http://engine-b:3002',
          sessionId: 'session-a',
          generation: 5,
          leaseUntil: new Date(Date.now() + 60_000).toISOString()
        };
      }
    },
    routingSecret: SECRET,
    maxRetries: 1,
    fetchImpl: async (url) => {
      requests += 1;
      if (requests === 1) return jsonResponse(409, { code: 'RUNTIME_LEASE_LOST', message: 'lease mudou' });
      assert.equal(url, 'http://engine-b:3002/v1/session/action');
      return jsonResponse(200, { state: 'COLLECTING_ACTIONS', narration: 'novo owner' });
    }
  });

  const result = await router.executeHttp({
    campaignId: 'campaign-a',
    sessionId: 'session-a',
    method: 'POST',
    path: '/v1/session/action',
    body: { campaignId: 'campaign-a', content: 'avanço' },
    executeLocal: async () => assert.fail('não deveria executar localmente')
  });

  assert.equal(result.narration, 'novo owner');
  assert.equal(requests, 2);
  assert.equal(inspections, 2);
});

test('router executa local quando esta instância possui o lease', async () => {
  const router = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-a',
    leaseManager: {
      inspect: async () => ({
        ownerId: 'engine-a',
        ownerUrl: 'http://engine-a:3001',
        sessionId: 'session-a',
        generation: 9,
        leaseUntil: new Date(Date.now() + 60_000).toISOString()
      })
    },
    routingSecret: SECRET,
    fetchImpl: async () => assert.fail('não deveria encaminhar')
  });

  const result = await router.executeHttp({
    campaignId: 'campaign-a',
    sessionId: 'session-a',
    method: 'GET',
    path: '/v1/session/status?campaignId=campaign-a',
    executeLocal: async () => ({ state: 'COLLECTING_ACTIONS', local: true })
  });
  assert.equal(result.local, true);
});

test('URL do owner converte HTTP(S) em WS(S)', () => {
  assert.equal(
    resolveOwnerWebSocketUrl('http://engine-a:3001', '/v1/realtime?sessionId=s1'),
    'ws://engine-a:3001/v1/realtime?sessionId=s1'
  );
  assert.equal(
    resolveOwnerWebSocketUrl('https://engine.example', '/v1/realtime?sessionId=s1'),
    'wss://engine.example/v1/realtime?sessionId=s1'
  );
});
