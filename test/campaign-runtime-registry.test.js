import test from 'node:test';
import assert from 'node:assert/strict';
import { CampaignRuntimeRegistry } from '../packages/campaign-runtime-registry/src/index.js';

function createRuntimeFactory(calls) {
  return ({ campaignId }) => {
    let state = 'IDLE';
    let sessionId = null;
    return {
      async restore(input) {
        state = 'COLLECTING_ACTIONS';
        sessionId = input.sessionId;
        calls.push(['restore', campaignId, sessionId]);
        return { state, sessionId };
      },
      async start() {
        state = 'COLLECTING_ACTIONS';
        sessionId = `session-${campaignId ?? 'legacy'}-${calls.length}`;
        calls.push(['start', campaignId, sessionId]);
        return { state, sessionId, opening: `Abertura ${campaignId}` };
      },
      async processAction(input) {
        calls.push(['action', campaignId, input.content]);
        return { state, narration: `ação:${campaignId}:${input.content}` };
      },
      async describeRoom(input) {
        calls.push(['room', campaignId, input.room?.id]);
        return { state, opening: `sala:${campaignId}:${input.room?.id}` };
      },
      async end() {
        state = 'ENDED';
        const ended = sessionId;
        sessionId = null;
        calls.push(['end', campaignId, ended]);
        return { state, sessionId: null };
      },
      getStatus() {
        return { state, sessionId };
      }
    };
  };
}

function createCampaignService() {
  const campaigns = [
    { id: 'campaign-a', activeSession: { sessionId: 'session-a', snapshot: { activeScene: { id: 'a' } }, startedAt: '2026-08-12T10:00:00.000Z' } },
    { id: 'campaign-b', activeSession: { sessionId: 'session-b', snapshot: { activeScene: { id: 'b' } }, startedAt: '2026-08-12T10:01:00.000Z' } },
    { id: 'campaign-c', activeSession: null }
  ];
  const realtime = new Map([
    ['session-a', { revision: 3, tokens: [] }],
    ['session-b', { revision: 4, tokens: [] }]
  ]);
  return {
    repository: { snapshot: () => ({ campaigns }) },
    getRaw: (id) => campaigns.find((campaign) => campaign.id === id) ?? null,
    loadRealtimeSnapshot: (id) => realtime.get(id) ?? null,
    async setActiveSession(id, activeSession) {
      campaigns.find((campaign) => campaign.id === id).activeSession = structuredClone(activeSession);
    },
    async clearActiveSessionBySessionId(id) {
      const campaign = campaigns.find((item) => item.activeSession?.sessionId === id);
      if (!campaign) return false;
      campaign.activeSession = null;
      return true;
    },
    async clearRealtimeSnapshot(id) {
      realtime.delete(id);
    }
  };
}

test('registry restaura e mantém duas campanhas ativas isoladas', async () => {
  const calls = [];
  const hydrated = [];
  const registry = new CampaignRuntimeRegistry({
    runtimeFactory: createRuntimeFactory(calls),
    campaignService: createCampaignService(),
    realtimeHub: {
      hydrateSession: (sessionId, snapshot) => hydrated.push([sessionId, snapshot.revision]),
      persistSession: async () => true
    },
    logger: {}
  });

  const initialized = await registry.initialize();
  assert.equal(initialized.active, 2);
  assert.equal(registry.getStatus({ campaignId: 'campaign-a' }).sessionId, 'session-a');
  assert.equal(registry.getStatus({ sessionId: 'session-b' }).campaignId, 'campaign-b');
  assert.equal(registry.getStatus().state, 'MULTI_SESSION');
  assert.deepEqual(hydrated, [['session-a', 3], ['session-b', 4]]);

  const action = await registry.processAction({ sessionId: 'session-b', content: 'examino a porta' });
  assert.equal(action.narration, 'ação:campaign-b:examino a porta');
  assert.ok(calls.some((entry) => entry[0] === 'action' && entry[1] === 'campaign-b'));
});

test('encerrar uma campanha não derruba o runtime da outra', async () => {
  const calls = [];
  const campaignService = createCampaignService();
  const registry = new CampaignRuntimeRegistry({
    runtimeFactory: createRuntimeFactory(calls),
    campaignService,
    realtimeHub: { hydrateSession() {}, persistSession: async () => true },
    logger: {}
  });
  await registry.initialize();

  await registry.end({ campaignId: 'campaign-a' });
  assert.equal(registry.getStatus({ campaignId: 'campaign-a' }).state, 'IDLE');
  assert.equal(registry.getStatus({ campaignId: 'campaign-b' }).sessionId, 'session-b');
});

test('duas campanhas novas podem iniciar sessões simultâneas independentes', async () => {
  const calls = [];
  const campaignService = createCampaignService();
  campaignService.getRaw('campaign-a').activeSession = null;
  campaignService.getRaw('campaign-b').activeSession = null;
  const registry = new CampaignRuntimeRegistry({
    runtimeFactory: createRuntimeFactory(calls),
    campaignService,
    logger: {}
  });

  const [first, second] = await Promise.all([
    registry.start({ campaignId: 'campaign-a', snapshot: { activeScene: { id: 'a' } } }),
    registry.start({ campaignId: 'campaign-b', snapshot: { activeScene: { id: 'b' } } })
  ]);

  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(registry.getStatus({ campaignId: 'campaign-a' }).sessionId, first.sessionId);
  assert.equal(registry.getStatus({ campaignId: 'campaign-b' }).sessionId, second.sessionId);
});

test('duas inicializações concorrentes da mesma campanha não criam sessões duplicadas', async () => {
  const campaignService = createCampaignService();
  campaignService.repository.snapshot = () => ({ campaigns: [] });
  let starts = 0;
  const registry = new CampaignRuntimeRegistry({
    campaignService,
    logger: {},
    runtimeFactory: ({ campaignId }) => {
      let sessionId = null;
      return {
        async start() {
          starts += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          sessionId = `session-${campaignId}`;
          return { state: 'COLLECTING_ACTIONS', sessionId, opening: 'Abertura.' };
        },
        async restore(input) { sessionId = input.sessionId; return { state: 'COLLECTING_ACTIONS', sessionId }; },
        async processAction() { return { state: 'COLLECTING_ACTIONS' }; },
        async describeRoom() { return { state: 'COLLECTING_ACTIONS' }; },
        async end() { sessionId = null; return { state: 'ENDED', sessionId }; },
        getStatus() { return { state: sessionId ? 'COLLECTING_ACTIONS' : 'IDLE', sessionId }; }
      };
    }
  });

  const first = registry.start({ campaignId: 'campaign-c', snapshot: { activeScene: { id: 'c' } } });
  await assert.rejects(
    () => registry.start({ campaignId: 'campaign-c', snapshot: { activeScene: { id: 'c' } } }),
    (error) => error.code === 'SESSION_ALREADY_ACTIVE' && error.statusCode === 409
  );
  await first;
  assert.equal(starts, 1);
});
