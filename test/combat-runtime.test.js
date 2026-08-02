import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const sceneSnapshot = {
  activeScene: { id: 'scene-1', name: 'Ponte em Ruínas', description: 'Uma ponte estreita cruza o abismo.' },
  campaign: { worldId: 'world-combat', systemId: 'dnd5e' },
  visibleActors: [
    { id: 'hero-1', name: 'Arannis', type: 'character' },
    { id: 'goblin-1', name: 'Goblin', type: 'npc' }
  ],
  narrationExclusions: { actorNames: [] },
  sceneJournal: {
    id: 'journal-1', name: 'Ponte em Ruínas', explicitLink: true,
    selectedPage: {
      id: 'page-1', name: 'Ponte em Ruínas', areaName: '1. Ponte',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
      content: 'Uma ponte estreita de pedra atravessa um abismo profundo. Lajes quebradas e uma camada de poeira cobrem a passagem. Muros baixos acompanham as laterais, embora vários trechos tenham desabado. No fim da ponte, um arco partido abre caminho para ruínas de pedra. Riscos recentes atravessam o chão perto do outro lado e desaparecem atrás dos blocos caídos. A travessia permanece estreita e exposta.'
    }
  }
};

const combatSnapshot = {
  id: 'combat-1', sceneId: 'scene-1', round: 1, turn: 0, started: true,
  activeCombatant: { id: 'c1', actorId: 'hero-1', name: 'Arannis', actorType: 'character' },
  combatants: [
    { id: 'c1', actorId: 'hero-1', name: 'Arannis', actorType: 'character' },
    { id: 'c2', actorId: 'goblin-1', name: 'Goblin', actorType: 'npc' }
  ]
};

function narrator(captured) {
  return {
    async createOpening() {
      return 'A passagem se reduz a uma ponte estreita de pedra sobre um abismo profundo. Lajes partidas interrompem a superfície coberta de poeira, e os muros baixos das laterais apresentam grandes trechos desabados. À frente, a travessia termina sob um arco quebrado, aberto entre as ruínas.\n\nPerto da extremidade oposta, riscos recentes cortam o chão e seguem até desaparecer atrás dos blocos caídos. A ponte oferece pouco espaço, permanece estreita e exposta, e o caminho adiante fica concentrado na abertura sob o arco. O que vocês fazem?';
    },
    async narrateRound() { return 'A rodada fora de combate se resolve.'; },
    async narrateResolution() { return 'A ação se resolve.'; },
    async narrateCombatTurn(payload) {
      captured.turn = payload;
      return '[tenso] A lâmina encontra o espaço entre as defesas... o goblin recua um passo.';
    },
    async narrateCombatRound(payload) {
      captured.round = payload;
      return '[foco] A primeira troca termina com os dois lados ainda disputando a ponte.';
    }
  };
}

test('sincroniza, registra e narra um turno do Combat Tracker', async () => {
  const captured = {};
  const runtime = createSessionRuntime({ narrator: narrator(captured) });
  await runtime.start(sceneSnapshot);
  const synced = await runtime.syncCombat(combatSnapshot);
  assert.equal(synced.combat.active, true);

  const queued = await runtime.processCombatAction({
    eventId: 'combat-chat:1', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco o goblin.',
    roll: { total: 19, damageTotal: 8, damageType: 'cortante', authoritative: true }
  });
  assert.equal(queued.turn.actionCount, 1);

  const result = await runtime.resolveCombatTurn({
    eventId: 'combat-turn:1', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis'
  });
  assert.match(result.narration, /lâmina/);
  assert.equal(result.resolutions[0].rules.result.roll.total, 19);
  assert.equal(result.resolutions[0].rules.result.authoritative, true);
  assert.equal(result.turn.resolved, true);
  assert.equal(captured.turn.resolutions.length, 1);
});

test('bloqueia rodada fora de combate enquanto o Combat Tracker está ativo', async () => {
  const runtime = createSessionRuntime({ narrator: narrator({}) });
  await runtime.start(sceneSnapshot);
  await runtime.syncCombat(combatSnapshot);
  await assert.rejects(
    () => runtime.processAction({ actorId: 'hero-1', content: 'Examino a ponte.' }),
    /Combat Tracker/
  );
});

test('gera um resumo depois de pelo menos um turno resolvido', async () => {
  const captured = {};
  const runtime = createSessionRuntime({ narrator: narrator(captured) });
  await runtime.start(sceneSnapshot);
  await runtime.syncCombat(combatSnapshot);
  await runtime.processCombatAction({
    eventId: 'combat-chat:1', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco o goblin.'
  });
  await runtime.resolveCombatTurn({ eventId: 'combat-turn:1', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1' });
  const result = await runtime.summarizeCombatRound({ eventId: 'combat-round:1', round: 1 });
  assert.equal(result.roundNumber, 1);
  assert.equal(result.turns.length, 1);
  assert.match(result.narration, /primeira troca/);
  assert.equal(captured.round.turns.length, 1);
  assert.equal(result.combat.currentRound.summarized, true);
});


test('preserva os eventos do turno quando a narração de combate falha', async () => {
  const provider = narrator({});
  provider.narrateCombatTurn = async () => { throw new Error('falha simulada da IA'); };
  const runtime = createSessionRuntime({ narrator: provider });
  await runtime.start(sceneSnapshot);
  await runtime.syncCombat(combatSnapshot);
  await runtime.processCombatAction({
    eventId: 'combat-chat:failure', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco o goblin.'
  });
  await assert.rejects(
    () => runtime.resolveCombatTurn({ eventId: 'combat-turn:failure', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1' }),
    /falha simulada/
  );
  const status = runtime.getStatus();
  assert.equal(status.combat.currentTurn.actionCount, 1);
  assert.equal(status.combat.currentTurn.resolved, false);
});

test('não publica duas vezes a mesma resolução de turno', async () => {
  const publications = [];
  const runtime = createSessionRuntime({
    narrator: narrator({}),
    publishChat: async (content) => { publications.push(content); }
  });
  await runtime.start(sceneSnapshot);
  publications.length = 0;
  await runtime.syncCombat(combatSnapshot);
  await runtime.processCombatAction({
    eventId: 'combat-chat:duplicate', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco o goblin.'
  });
  const input = { eventId: 'combat-turn:duplicate', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1' };
  const first = await runtime.resolveCombatTurn(input);
  const second = await runtime.resolveCombatTurn(input);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(publications.length, 1);
});
