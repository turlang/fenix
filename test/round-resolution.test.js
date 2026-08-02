import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionDirector } from '../packages/session-director/src/index.js';
import { IntentInterpreter } from '../packages/intent-interpreter/src/index.js';
import { RulesService } from '../packages/rules-service/src/index.js';
import { RelationshipService } from '../packages/relationship-service/src/index.js';
import { NPCCoordinator } from '../packages/npc-coordinator/src/index.js';
import { WorldStateService } from '../packages/world-state/src/index.js';

function createDirector({ failRound = false } = {}) {
  const counters = { published: 0, rounds: 0 };
  const captured = { round: null };
  const context = {
    scene: { id: 'scene-1', name: 'Portão da Fortaleza' },
    campaign: { worldId: 'world-1', systemId: 'dnd5e' },
    visibleActors: [
      { id: 'hero-1', name: 'Arannis', type: 'character' },
      { id: 'hero-2', name: 'Brom', type: 'character' },
      { id: 'npc-1', name: 'Vigia', type: 'npc' }
    ],
    narrationExclusions: { actorNames: [] },
    sceneJournal: null
  };
  const director = new SessionDirector({
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
    intentInterpreter: new IntentInterpreter({ logger: { error() {} } }),
    rulesService: new RulesService({ logger: { error() {} } }),
    relationshipService: new RelationshipService({ logger: { error() {} } }),
    npcCoordinator: new NPCCoordinator({ logger: { error() {} } }),
    worldStateService: new WorldStateService({ logger: { error() {} } }),
    narrationService: {
      async createOpening() { return 'O portão se ergue diante do grupo. O que vocês fazem?'; },
      async narrateRound(payload) {
        counters.rounds += 1;
        captured.round = payload;
        if (failRound) throw new Error('Falha simulada da IA.');
        return 'As declarações convergem em uma única sequência, e o estado do portão muda diante do grupo.';
      }
    },
    foundryPublisher: { async postNarration() { counters.published += 1; } },
    logger: { error() {} }
  });
  return { director, counters, captured };
}

test('mantém apenas a declaração mais recente de cada personagem', async () => {
  const { director } = createDirector();
  await director.start();

  const first = await director.processAction({
    eventId: 'chat:1', actorId: 'hero-1', actorName: 'Arannis', content: 'Observo o portão.'
  });
  const replacement = await director.processAction({
    eventId: 'chat:2', actorId: 'hero-1', actorName: 'Arannis', content: 'Examino as dobradiças do portão.'
  });

  assert.equal(first.replaced, false);
  assert.equal(replacement.replaced, true);
  assert.equal(replacement.round.actionCount, 1);
  assert.deepEqual(replacement.round.actorIds, ['hero-1']);
  assert.equal(replacement.declaration.content, 'Examino as dobradiças do portão.');
});

test('resolve duas declarações em uma única narração e avança o World State', async () => {
  const { director, counters, captured } = createDirector();
  const started = await director.start();
  assert.equal(started.round.number, 1);

  await director.processAction({
    eventId: 'chat:1', actorId: 'hero-1', actorName: 'Arannis', content: 'Digo ao Vigia que viemos em paz.'
  });
  await director.processAction({
    eventId: 'chat:2', actorId: 'hero-2', actorName: 'Brom', content: 'Examino o portão em busca de uma abertura.'
  });

  const result = await director.resolveRound({ eventId: 'round:1' });

  assert.equal(counters.rounds, 1);
  assert.equal(counters.published, 2); // abertura + uma narração consolidada
  assert.equal(result.declarations.length, 2);
  assert.equal(result.resolutions.length, 2);
  assert.equal(result.resolutions[0].rules.adapter.systemId, 'dnd5e');
  assert.equal(result.npcCoordination.reactions[0].npcName, 'Vigia');
  assert.equal(result.worldState.completedRounds, 1);
  assert.equal(result.worldState.roundNumber, 1);
  assert.equal(result.round.number, 2);
  assert.equal(result.round.actionCount, 0);
  assert.equal(captured.round.resolutions.length, 2);
  assert.match(result.narration, /única sequência/);
});

test('preserva as declarações quando a narração consolidada falha', async () => {
  const { director } = createDirector({ failRound: true });
  await director.start();
  await director.processAction({
    eventId: 'chat:1', actorId: 'hero-1', actorName: 'Arannis', content: 'Examino o portão.'
  });

  await assert.rejects(
    () => director.resolveRound({ eventId: 'round:failure' }),
    /Falha simulada/
  );
  const status = director.getStatus();
  assert.equal(status.state, 'COLLECTING_ACTIONS');
  assert.equal(status.round.number, 1);
  assert.equal(status.round.actionCount, 1);
  assert.equal(status.worldState.completedRounds, 0);
});

test('rejeita declaração sem personagem vinculado', async () => {
  const { director } = createDirector();
  await director.start();
  await assert.rejects(
    () => director.processAction({ eventId: 'chat:anon', content: 'Examino a porta.' }),
    /vinculada a um personagem/
  );
});
