import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresFenixRepository } from '../packages/persistence-repository/src/index.js';
import { AuthService } from '../packages/auth-service/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { CampaignRuntimeRegistry } from '../packages/campaign-runtime-registry/src/index.js';
import {
  PostgresRuntimeLeaseManager,
  PostgresStateBus
} from '../packages/distributed-runtime-coordination/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL é obrigatória para o teste distribuído.');

const admin = new Pool({ connectionString, max: 2, application_name: 'fenix-ci-distributed-admin' });
await admin.query('DROP TABLE IF EXISTS fenix_runtime_leases');
await admin.query('DROP TABLE IF EXISTS fenix_repository_state');

const poolA = new Pool({ connectionString, max: 6, application_name: 'fenix-ci-engine-a' });
const poolB = new Pool({ connectionString, max: 6, application_name: 'fenix-ci-engine-b' });
const repositoryA = new PostgresFenixRepository({ pool: poolA, logger: {} });
const repositoryB = new PostgresFenixRepository({ pool: poolB, logger: {} });
const busA = new PostgresStateBus({ pool: poolA, instanceId: 'engine-a', logger: {} });
const busB = new PostgresStateBus({ pool: poolB, instanceId: 'engine-b', logger: {} });
const leaseA = new PostgresRuntimeLeaseManager({
  pool: poolA,
  instanceId: 'engine-a',
  instanceUrl: 'https://engine-a.example',
  leaseTtlMs: 5000,
  heartbeatIntervalMs: 1000,
  publishEvent: (type, payload) => busA.publish(type, payload),
  logger: {}
});
const leaseB = new PostgresRuntimeLeaseManager({
  pool: poolB,
  instanceId: 'engine-b',
  instanceUrl: 'https://engine-b.example',
  leaseTtlMs: 5000,
  heartbeatIntervalMs: 1000,
  publishEvent: (type, payload) => busB.publish(type, payload),
  logger: {}
});

function waitFor(predicate, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout aguardando propagação distribuída'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function runtimeFactory(label, calls) {
  return ({ campaignId }) => {
    let state = 'IDLE';
    let sessionId = null;
    return {
      async restore(input) {
        state = 'COLLECTING_ACTIONS';
        sessionId = input.sessionId;
        calls.push([label, 'restore', campaignId, sessionId]);
        return { state, sessionId };
      },
      async start() {
        throw new Error('start não é esperado no cenário de failover');
      },
      async processAction(input) {
        calls.push([label, 'action', campaignId, input.content]);
        return { state, narration: `${label}:${input.content}` };
      },
      async describeRoom() { return { state, opening: label }; },
      async end() { state = 'ENDED'; sessionId = null; return { state, sessionId }; },
      getStatus() { return { state, sessionId }; }
    };
  };
}

let unsubscribeB = () => undefined;
try {
  await Promise.all([repositoryA.initialize(), repositoryB.initialize()]);
  await Promise.all([busA.initialize(), busB.initialize()]);
  await Promise.all([leaseA.initialize(), leaseB.initialize()]);

  const authCacheB = new AuthService({ repository: repositoryB, logger: {} });
  const campaignCacheB = new CampaignService({ repository: repositoryB, logger: {} });
  authCacheB.refreshFromRepository();
  campaignCacheB.refreshFromRepository();

  repositoryA.setChangePublisher((metadata) => busA.publish('STATE_CHANGED', metadata));
  let invalidations = 0;
  unsubscribeB = busB.subscribe(async (event) => {
    if (event.type !== 'STATE_CHANGED') return;
    await repositoryB.refresh();
    authCacheB.refreshFromRepository();
    campaignCacheB.refreshFromRepository();
    invalidations += 1;
  });

  await repositoryA.mutate((draft) => {
    draft.users.push({
      id: 'shared-user',
      email: 'shared@example.com',
      displayName: 'Shared User',
      password: { algorithm: 'scrypt', salt: 'unused', hash: 'unused' },
      createdAt: '2026-08-12T12:00:00.000Z',
      updatedAt: '2026-08-12T12:00:00.000Z'
    });
  });
  await waitFor(() => invalidations > 0 && authCacheB.getUserById('shared-user')?.email === 'shared@example.com');
  assert.equal(repositoryB.snapshot().users[0].id, 'shared-user');
  assert.equal(authCacheB.getUserById('shared-user').displayName, 'Shared User');

  const firstLease = await leaseA.acquire({ campaignId: 'campaign-lock', sessionId: 'session-lock' });
  await assert.rejects(
    () => leaseB.acquire({ campaignId: 'campaign-lock', sessionId: 'session-lock' }),
    (error) => error.code === 'RUNTIME_LEASE_HELD' && error.ownerId === 'engine-a'
  );
  await leaseA.assertOwned('campaign-lock', firstLease.generation);

  await admin.query(
    `UPDATE fenix_runtime_leases SET lease_until = NOW() - INTERVAL '1 second' WHERE campaign_id = $1`,
    ['campaign-lock']
  );
  const takeoverLease = await leaseB.acquire({ campaignId: 'campaign-lock', sessionId: 'session-lock' });
  assert.ok(takeoverLease.generation > firstLease.generation);
  await assert.rejects(
    () => leaseA.assertOwned('campaign-lock', firstLease.generation),
    (error) => error.code === 'RUNTIME_LEASE_LOST'
  );

  const activeSession = {
    sessionId: 'session-failover',
    snapshot: { activeScene: { id: 'scene-failover' }, metadata: { campaignId: 'campaign-failover' } },
    startedAt: '2026-08-12T12:00:00.000Z'
  };
  await repositoryA.mutate((draft) => {
    draft.campaigns.push({
      id: 'campaign-failover',
      title: 'Failover',
      systemId: 'system-test',
      ownerUserId: 'gm',
      members: [{ userId: 'gm', role: 'gm', actorId: null, joinedAt: activeSession.startedAt }],
      activeSession,
      createdAt: activeSession.startedAt,
      updatedAt: activeSession.startedAt
    });
  });
  await waitFor(() => campaignCacheB.getRaw('campaign-failover')?.activeSession?.sessionId === 'session-failover');
  await repositoryA.refresh();

  const campaignA = new CampaignService({ repository: repositoryA, logger: {} });
  campaignA.refreshFromRepository();
  const campaignB = campaignCacheB;
  const calls = [];
  const registryA = new CampaignRuntimeRegistry({
    campaignService: campaignA,
    leaseManager: leaseA,
    runtimeFactory: runtimeFactory('A', calls),
    logger: {}
  });
  const registryB = new CampaignRuntimeRegistry({
    campaignService: campaignB,
    leaseManager: leaseB,
    runtimeFactory: runtimeFactory('B', calls),
    logger: {}
  });

  const bootA = await registryA.initialize();
  const bootB = await registryB.initialize();
  assert.equal(bootA.restored.some((item) => item.campaignId === 'campaign-failover'), true);
  assert.equal(bootB.remote.some((item) => item.campaignId === 'campaign-failover'), true);
  assert.equal(registryA.getStatus({ campaignId: 'campaign-failover' }).sessionId, 'session-failover');
  assert.equal(registryB.getStatus({ campaignId: 'campaign-failover' }).state, 'REMOTE_ACTIVE');

  const leaseBeforeCrash = await leaseA.inspect('campaign-failover');
  await admin.query(
    `UPDATE fenix_runtime_leases SET lease_until = NOW() - INTERVAL '1 second' WHERE campaign_id = $1`,
    ['campaign-failover']
  );
  await registryB.reconcile({ refreshRepository: true });
  assert.equal(registryB.getStatus({ campaignId: 'campaign-failover' }).sessionId, 'session-failover');
  const leaseAfterFailover = await leaseB.inspect('campaign-failover');
  assert.ok(leaseAfterFailover.generation > leaseBeforeCrash.generation);

  await assert.rejects(
    () => registryA.processAction({ campaignId: 'campaign-failover', content: 'ação antiga' }),
    (error) => error.code === 'RUNTIME_LEASE_LOST'
  );
  const result = await registryB.processAction({ campaignId: 'campaign-failover', content: 'ação nova' });
  assert.equal(result.narration, 'B:ação nova');
  assert.equal(registryA.getStatus({ campaignId: 'campaign-failover' }).state, 'REMOTE_ACTIVE');

  console.log('Distributed runtime lease + LISTEN/NOTIFY integration OK');
} finally {
  unsubscribeB();
  await Promise.allSettled([leaseA.releaseAll(), leaseB.releaseAll()]);
  await Promise.allSettled([busA.close(), busB.close()]);
  await Promise.allSettled([repositoryA.close(), repositoryB.close()]);
  await admin.end();
}
