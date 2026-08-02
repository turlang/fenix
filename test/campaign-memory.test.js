import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileCampaignMemory, InMemoryCampaignMemory } from '../packages/memory/src/index.js';
import { SessionDirector } from '../packages/session-director/src/index.js';
import { IntentInterpreter } from '../packages/intent-interpreter/src/index.js';
import { RulesService } from '../packages/rules-service/src/index.js';
import { RelationshipService } from '../packages/relationship-service/src/index.js';
import { NPCCoordinator } from '../packages/npc-coordinator/src/index.js';
import { WorldStateService } from '../packages/world-state/src/index.js';

const campaign = { worldId: 'world-memory', title: 'Sombras de Amn', systemId: 'dnd5e' };

function createDirector(memory) {
  const context = {
    scene: { id: 'scene-gate', name: 'Portão de Crimmor' },
    campaign,
    visibleActors: [
      { id: 'hero-1', name: 'Arannis', type: 'character' },
      { id: 'npc-1', name: 'Vigia', type: 'npc' }
    ],
    narrationExclusions: { actorNames: [] },
    sceneJournal: null
  };
  return new SessionDirector({
    foundryAdapter: { async sync() { return context; } },
    contextBuilder: {
      build(raw = {}) {
        return {
          ...context,
          ...raw,
          scene: raw.scene ?? raw.activeScene ?? context.scene,
          campaign: raw.campaign ?? context.campaign,
          visibleActors: raw.visibleActors ?? context.visibleActors,
          messages: raw.messages ?? []
        };
      }
    },
    intentInterpreter: new IntentInterpreter({ logger: {} }),
    rulesService: new RulesService({ logger: {} }),
    relationshipService: new RelationshipService({ logger: {} }),
    npcCoordinator: new NPCCoordinator({ logger: {} }),
    worldStateService: new WorldStateService({ logger: {} }),
    campaignMemory: memory,
    narrationService: {
      async createOpening() { return 'O portão se ergue diante do grupo.'; },
      async narrateRound() { return 'O vigia escuta a proposta e mantém a mão próxima da lança.'; },
      async describeRoom() { return 'A sala estreita revela o vigia junto à muralha.'; }
    },
    foundryPublisher: { async postNarration() {} },
    logger: {}
  });
}

test('armazena fatos, NPCs, relações, missões e itens por campanha', async () => {
  const memory = new InMemoryCampaignMemory({ logger: {} });
  await memory.upsert(campaign, 'facts', { text: 'A ponte de Crimmor está interditada.' });
  await memory.upsert(campaign, 'npcs', { id: 'npc-1', name: 'Vigia', status: 'ALERTA' });
  await memory.upsert(campaign, 'relationships', {
    actorId: 'hero-1', actorName: 'Arannis', npcId: 'npc-1', npcName: 'Vigia', score: 10
  });
  await memory.upsert(campaign, 'quests', { title: 'Abrir os portões', status: 'ACTIVE' });
  await memory.upsert(campaign, 'items', { name: 'Selo de cobre', ownerActorId: 'hero-1', quantity: 1 });

  const summary = memory.summary(await memory.load(campaign));
  assert.deepEqual(summary.counts, { facts: 1, npcs: 1, relationships: 1, quests: 1, items: 1 });
  assert.equal(summary.relationships[0].type, 'FRIENDLY');
  assert.equal(summary.quests[0].title, 'Abrir os portões');
  assert.equal(summary.items[0].name, 'Selo de cobre');
});

test('não envia registros secretos para o contexto narrativo', async () => {
  const memory = new InMemoryCampaignMemory({ logger: {} });
  await memory.upsert(campaign, 'facts', { text: 'O vigia teme o capitão.', visibility: 'known' });
  await memory.upsert(campaign, 'facts', { text: 'O capitão é um doppleganger.', visibility: 'secret' });

  const snapshot = await memory.load(campaign);
  const context = memory.contextForNarration(snapshot);
  assert.equal(context.recentFacts.length, 1);
  assert.match(context.recentFacts[0].text, /vigia teme/i);
  assert.doesNotMatch(JSON.stringify(context), /doppleganger/i);
});

test('registra rodada automaticamente e evita duplicação pelo eventId', async () => {
  const memory = new InMemoryCampaignMemory({ logger: {} });
  const payload = {
    campaign,
    eventId: 'round:1',
    sessionId: 'session-1',
    roundNumber: 1,
    context: { campaign, scene: { id: 'scene-gate', name: 'Portão' } },
    resolutions: [{
      declaration: {
        actorId: 'hero-1', actorName: 'Arannis',
        content: 'Aceito a missão Abrir os portões e pego o item chave de cobre.'
      },
      intent: { type: 'SOCIAL', target: 'Vigia' },
      rules: { result: { effect: 'O vigia considera a proposta.' } },
      relationship: {
        npcId: 'npc-1', npcName: 'Vigia', disposition: 5,
        relationshipType: 'FRIENDLY', effect: 'Relação melhorou'
      }
    }],
    npcCoordination: {
      reactions: [{ npcId: 'npc-1', npcName: 'Vigia', reaction: 'avalia as palavras', relationshipType: 'FRIENDLY' }]
    },
    worldState: { roundNumber: 1, completedRounds: 1, npcRelationships: { 'npc-1': 5 }, recentEvents: [] },
    narration: 'O vigia considera a proposta.'
  };

  await memory.applyRound(payload);
  await memory.applyRound(payload);
  const summary = memory.summary(await memory.load(campaign));
  assert.equal(summary.counts.facts, 1);
  assert.equal(summary.counts.npcs, 1);
  assert.equal(summary.counts.relationships, 1);
  assert.equal(summary.counts.quests, 1);
  assert.equal(summary.counts.items, 1);
  assert.equal(summary.relationships[0].score, 5);
});

test('persiste em arquivo e recupera os dados em uma nova instância', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-memory-'));
  const filePath = join(directory, 'campaign-memory.json');
  try {
    const first = new FileCampaignMemory({ filePath, logger: {} });
    await first.upsert(campaign, 'facts', { text: 'A ponte foi aberta.' });
    await first.upsert(campaign, 'quests', { title: 'Abrir os portões', status: 'COMPLETED' });

    const second = new FileCampaignMemory({ filePath, logger: {} });
    const restored = second.summary(await second.load(campaign));
    assert.equal(restored.counts.facts, 1);
    assert.equal(restored.quests[0].status, 'COMPLETED');
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.campaigns['world-memory']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recupera World State e continua a numeração após reiniciar o runtime', async () => {
  const memory = new InMemoryCampaignMemory({ logger: {} });
  const first = createDirector(memory);
  await first.start();
  await first.processAction({
    eventId: 'chat:1', actorId: 'hero-1', actorName: 'Arannis',
    content: 'Digo ao Vigia que viemos em paz.'
  });
  const resolved = await first.resolveRound({ eventId: 'round:1' });
  assert.equal(resolved.worldState.completedRounds, 1);
  await first.end();

  const second = createDirector(memory);
  const restarted = await second.start();
  assert.equal(restarted.worldState.restoredFromMemory, true);
  assert.equal(restarted.worldState.completedRounds, 1);
  assert.equal(restarted.round.number, 2);
  assert.equal(restarted.memory.counts.facts, 1);
  assert.equal(restarted.memory.counts.relationships, 1);
});

test('entrada de sala atualiza fatos e estado dos NPCs', async () => {
  const memory = new InMemoryCampaignMemory({ logger: {} });
  const director = createDirector(memory);
  await director.start();
  const result = await director.describeRoom({
    eventId: 'room:scene-gate:2:hero-1',
    room: { id: '2', name: 'Casa da Guarda' },
    source: { canonicalAnchor: true, text: 'Uma sala estreita se abre junto à muralha.' },
    scene: { id: 'scene-gate', name: 'Portão de Crimmor' },
    campaign,
    visibleActors: [{ id: 'npc-1', name: 'Vigia', type: 'npc' }],
    perception: { visionAvailable: true, sourceKind: 'LOS' }
  });

  assert.equal(result.memory.counts.facts, 1);
  assert.equal(result.memory.counts.npcs, 1);
  assert.equal(result.memory.recentNpcs[0].location, 'Casa da Guarda');
});

test('API expõe leitura, gravação e remoção da memória persistente', async () => {
  const source = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  assert.match(source, /GET, POST, DELETE, OPTIONS/);
  assert.match(source, /app\.get\('\/v1\/campaign-memory\/:campaignId'/);
  assert.match(source, /app\.post\('\/v1\/campaign-memory\/:campaignId\/:collection'/);
  assert.match(source, /app\.delete\('\/v1\/campaign-memory\/:campaignId\/:collection\/:recordId'/);
});
