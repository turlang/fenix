import assert from 'node:assert/strict';
import { Pool } from 'pg';
import WebSocket from 'ws';
import { createConfig } from '../packages/config/src/index.js';
import { PostgresRuntimeLeaseManager } from '../packages/distributed-runtime-coordination/src/index.js';
import { OwnerAwareRuntimeRouter } from '../packages/owner-aware-runtime-router/src/index.js';
import {
  RealtimeSessionGateway,
  RealtimeSessionHub,
  createDevelopmentPeerAuthorizer
} from '../packages/realtime-session-gateway/src/index.js';
import { createApiApp } from '../apps/api/src/app.js';
import { createOwnerAwareWebSocketProxy } from '../apps/api/src/realtime/owner-aware-websocket-proxy.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL é obrigatória para o teste owner-aware.');

const SECRET = 'fenix-ci-owner-routing-secret-0123456789abcdef';
const CAMPAIGN_ID = 'campaign-routing';
const SESSION_ID = 'session-routing';
const ENGINE_A_URL = 'http://127.0.0.1:33101';
const ENGINE_B_URL = 'http://127.0.0.1:33102';

const admin = new Pool({ connectionString, max: 2, application_name: 'fenix-ci-routing-admin' });
const poolA = new Pool({ connectionString, max: 4, application_name: 'fenix-ci-routing-a' });
const poolB = new Pool({ connectionString, max: 4, application_name: 'fenix-ci-routing-b' });

const leaseA = new PostgresRuntimeLeaseManager({
  pool: poolA,
  instanceId: 'engine-a',
  instanceUrl: ENGINE_A_URL,
  leaseTtlMs: 10_000,
  heartbeatIntervalMs: 2_000,
  logger: {}
});
const leaseB = new PostgresRuntimeLeaseManager({
  pool: poolB,
  instanceId: 'engine-b',
  instanceUrl: ENGINE_B_URL,
  leaseTtlMs: 10_000,
  heartbeatIntervalMs: 2_000,
  logger: {}
});

function createLocalSessionService(label, calls) {
  return {
    getStatus() {
      return { state: 'COLLECTING_ACTIONS', sessionId: SESSION_ID, campaignId: CAMPAIGN_ID };
    },
    async start() {
      calls.push([label, 'start']);
      return { state: 'COLLECTING_ACTIONS', sessionId: SESSION_ID, opening: `${label}:opening` };
    },
    async processAction(input) {
      calls.push([label, 'action', input.content]);
      return { state: 'COLLECTING_ACTIONS', sessionId: SESSION_ID, narration: `${label}:${input.content}` };
    },
    async describeRoom(input) {
      calls.push([label, 'room', input?.room?.id ?? null]);
      return { state: 'COLLECTING_ACTIONS', sessionId: SESSION_ID, opening: `${label}:room` };
    },
    async end() {
      calls.push([label, 'end']);
      return { state: 'ENDED', sessionId: null };
    }
  };
}

function createRealtimeGateway({ sessionService, hub, leaseManager, label }) {
  const authorizePeer = createDevelopmentPeerAuthorizer({ isProduction: false });
  return {
    openPeer(input) {
      const base = new RealtimeSessionGateway({ hub, sessionService, authorizePeer, logger: {} });
      const peer = base.openPeer(input);
      return {
        ...peer,
        receive: async (raw) => {
          await leaseManager.assertOwned(CAMPAIGN_ID);
          return peer.receive(raw);
        }
      };
    },
    sendError(sessionId, clientId, error, commandId = null) {
      return hub.sendTo(sessionId, clientId, {
        type: 'ERROR',
        commandId,
        payload: {
          code: error?.code || 'REALTIME_ERROR',
          message: error?.message || `${label}:realtime failure`,
          status: Number(error?.statusCode) || 500
        }
      });
    }
  };
}

function waitForWsEvent(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('timeout aguardando evento WebSocket owner-aware'));
    }, timeoutMs);
    const onMessage = (raw) => {
      let event;
      try { event = JSON.parse(raw.toString()); } catch { return; }
      if (!predicate(event)) return;
      cleanup();
      resolve(event);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };
    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

let appA = null;
let appB = null;
try {
  await admin.query('CREATE TABLE IF NOT EXISTS fenix_runtime_leases (campaign_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, owner_url TEXT, session_id TEXT, generation BIGINT NOT NULL DEFAULT 1, lease_until TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
  await admin.query('DELETE FROM fenix_runtime_leases WHERE campaign_id = $1', [CAMPAIGN_ID]);
  await Promise.all([leaseA.initialize(), leaseB.initialize()]);
  const owned = await leaseA.acquire({ campaignId: CAMPAIGN_ID, sessionId: SESSION_ID });
  assert.equal(owned.ownerId, 'engine-a');

  const resolveCampaignIdBySessionId = (sessionId) => sessionId === SESSION_ID ? CAMPAIGN_ID : null;
  const routerA = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-a',
    instancePublicUrl: ENGINE_A_URL,
    leaseManager: leaseA,
    resolveCampaignIdBySessionId,
    routingSecret: SECRET,
    maxRetries: 1,
    logger: {}
  });
  const routerB = new OwnerAwareRuntimeRouter({
    instanceId: 'engine-b',
    instancePublicUrl: ENGINE_B_URL,
    leaseManager: leaseB,
    resolveCampaignIdBySessionId,
    routingSecret: SECRET,
    maxRetries: 1,
    logger: {}
  });

  const calls = [];
  const serviceA = createLocalSessionService('A', calls);
  const serviceB = createLocalSessionService('B', calls);
  const hubA = new RealtimeSessionHub({ logger: {} });
  const hubB = new RealtimeSessionHub({ logger: {} });
  const gatewayA = createRealtimeGateway({ sessionService: serviceA, hub: hubA, leaseManager: leaseA, label: 'A' });
  const gatewayB = createRealtimeGateway({ sessionService: serviceB, hub: hubB, leaseManager: leaseB, label: 'B' });

  const configA = createConfig({
    PORT: '33101',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    FENIX_INTERNAL_ROUTING_SECRET: SECRET,
    FENIX_INSTANCE_ID: 'engine-a',
    FENIX_INSTANCE_PUBLIC_URL: ENGINE_A_URL
  });
  const configB = createConfig({
    PORT: '33102',
    CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
    FENIX_INTERNAL_ROUTING_SECRET: SECRET,
    FENIX_INSTANCE_ID: 'engine-b',
    FENIX_INSTANCE_PUBLIC_URL: ENGINE_B_URL
  });

  appA = await createApiApp({
    config: configA,
    sessionService: serviceA,
    realtimeGateway: gatewayA,
    runtimeRouter: routerA,
    realtimeProxy: createOwnerAwareWebSocketProxy({ ownerRouter: routerA, logger: {} })
  });
  appB = await createApiApp({
    config: configB,
    sessionService: serviceB,
    realtimeGateway: gatewayB,
    runtimeRouter: routerB,
    realtimeProxy: createOwnerAwareWebSocketProxy({ ownerRouter: routerB, logger: {} })
  });
  await appA.listen({ host: '127.0.0.1', port: 33101 });
  await appB.listen({ host: '127.0.0.1', port: 33102 });

  const routedHttp = await fetch(`${ENGINE_B_URL}/v1/session/action`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId: CAMPAIGN_ID, sessionId: SESSION_ID, content: 'abro a porta' })
  });
  assert.equal(routedHttp.status, 200);
  const routedPayload = await routedHttp.json();
  assert.equal(routedPayload.narration, 'A:abro a porta');
  assert.equal(calls.some((entry) => entry[0] === 'A' && entry[1] === 'action'), true);
  assert.equal(calls.some((entry) => entry[0] === 'B' && entry[1] === 'action'), false);

  const forged = await fetch(`${ENGINE_B_URL}/v1/session/action`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-fenix-route-hop': '1',
      'x-fenix-route-source': 'attacker'
    },
    body: JSON.stringify({ campaignId: CAMPAIGN_ID, sessionId: SESSION_ID, content: 'forjado' })
  });
  assert.equal(forged.status, 401);
  assert.equal((await forged.json()).code, 'RUNTIME_ROUTING_AUTH_INVALID');

  const ws = new WebSocket(`ws://127.0.0.1:33102/v1/realtime?sessionId=${SESSION_ID}&clientId=ci-client&role=gm`);
  const state = await waitForWsEvent(ws, (event) => event.type === 'STATE_SYNC');
  assert.equal(state.payload.sessionId, SESSION_ID);

  ws.send(JSON.stringify({ type: 'PING', commandId: 'ping-1', payload: {} }));
  const pong = await waitForWsEvent(ws, (event) => event.type === 'PONG' && event.commandId === 'ping-1');
  assert.ok(pong.payload.now);

  ws.send(JSON.stringify({ type: 'ACTION_SUBMIT', commandId: 'action-1', payload: { content: 'investigo o altar' } }));
  const ack = await waitForWsEvent(ws, (event) => event.type === 'ACK' && event.commandId === 'action-1');
  assert.equal(ack.payload.type, 'ACTION_SUBMIT');
  assert.equal(calls.some((entry) => entry[0] === 'A' && entry[1] === 'action' && entry[2] === 'investigo o altar'), true);
  ws.close(1000, 'done');

  console.log('Owner-aware HTTP + WebSocket routing integration OK');
} finally {
  await Promise.allSettled([appB?.close?.(), appA?.close?.()]);
  await Promise.allSettled([leaseA.releaseAll(), leaseB.releaseAll()]);
  await Promise.allSettled([poolA.end(), poolB.end()]);
  await admin.end();
}
