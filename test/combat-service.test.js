import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CombatService,
  combatTurnKey,
  normalizeActionEconomy,
  normalizeCombatSnapshot
} from '../packages/combat-service/src/index.js';

const snapshot = {
  id: 'combat-1',
  sceneId: 'scene-1',
  round: 1,
  turn: 0,
  started: true,
  activeCombatant: { id: 'c1', actorId: 'hero-1', name: 'Arannis', actorType: 'character' },
  combatants: [
    { id: 'c1', actorId: 'hero-1', name: 'Arannis', actorType: 'character', initiative: 18 },
    { id: 'c2', actorId: 'hero-2', name: 'Brom', actorType: 'character', initiative: 14 },
    { id: 'c3', actorId: 'goblin-1', name: 'Goblin', actorType: 'npc', initiative: 12 }
  ]
};

test('normaliza economia de ações em português e inglês', () => {
  assert.equal(normalizeActionEconomy('ação bônus'), 'BONUS_ACTION');
  assert.equal(normalizeActionEconomy('reação'), 'REACTION');
  assert.equal(normalizeActionEconomy('movement'), 'MOVEMENT');
  assert.equal(normalizeActionEconomy('qualquer coisa'), 'ACTION');
});

test('sincroniza o combate e cria o turno corrente', () => {
  const service = new CombatService();
  const status = service.sync(snapshot);
  assert.equal(status.active, true);
  assert.equal(status.combatId, 'combat-1');
  assert.equal(status.currentTurn.actorId, 'hero-1');
  assert.equal(status.currentTurn.actionCount, 0);
  assert.equal(combatTurnKey(normalizeCombatSnapshot(snapshot)), 'combat-1:r1:t0:c1');
});

test('registra ação e ação bônus em slots separados e substitui apenas o mesmo slot', () => {
  const service = new CombatService();
  service.sync(snapshot);
  const first = service.registerAction({
    eventId: 'a1', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco o goblin.'
  });
  const bonus = service.registerAction({
    eventId: 'a2', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'BONUS_ACTION', content: 'Uso a inspiração.'
  });
  const replacement = service.registerAction({
    eventId: 'a3', combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1',
    actorId: 'hero-1', actorName: 'Arannis', economyType: 'ACTION', content: 'Ataco com a espada longa.'
  });
  assert.equal(first.replaced, false);
  assert.equal(bonus.turn.actionCount, 2);
  assert.equal(replacement.replaced, true);
  assert.equal(replacement.turn.actionCount, 2);
  assert.equal(service.actionsForTurn()[0].content, 'Ataco com a espada longa.');
});

test('rejeita ação comum fora da iniciativa e permite uma reação por rodada', () => {
  const service = new CombatService();
  service.sync(snapshot);
  assert.throws(() => service.registerAction({
    combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1', actorId: 'hero-2',
    economyType: 'ACTION', content: 'Ataco fora do meu turno.'
  }), /Somente Arannis/);

  service.registerAction({
    combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1', actorId: 'hero-2', actorName: 'Brom',
    economyType: 'REACTION', content: 'Uso Escudo.'
  });
  service.markTurnResolved({}, { narration: 'Brom ergue a defesa.' });
  service.sync({ ...snapshot, turn: 1, activeCombatant: snapshot.combatants[1] });
  assert.throws(() => service.registerAction({
    combatId: 'combat-1', round: 1, turn: 1, combatantId: 'c2', actorId: 'hero-2', actorName: 'Brom',
    economyType: 'REACTION', content: 'Tento reagir novamente.'
  }), /já utilizou a reação/);
});

test('anexa reações ao turno ativo e rejeita referência de turno forjada', () => {
  const service = new CombatService();
  service.sync(snapshot);
  service.registerAction({
    combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c2', actorId: 'hero-2', actorName: 'Brom',
    economyType: 'REACTION', content: 'Uso Escudo.'
  });
  const actions = service.actionsForTurn();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].actorId, 'hero-2');
  assert.equal(actions[0].economyType, 'REACTION');

  assert.throws(() => service.registerAction({
    combatId: 'combat-1', round: 1, turn: 1, combatantId: 'c2', actorId: 'hero-2',
    economyType: 'ACTION', content: 'Tento agir usando outra referência.'
  }), /turno ativo/);
});

test('mantém turnos resolvidos e habilita resumo da rodada', () => {
  const service = new CombatService();
  service.sync(snapshot);
  service.registerAction({
    combatId: 'combat-1', round: 1, turn: 0, combatantId: 'c1', actorId: 'hero-1',
    economyType: 'ACTION', content: 'Ataco o goblin.'
  });
  service.markTurnResolved({}, { narration: 'A lâmina corta o ar.', actions: service.actionsForTurn() });
  assert.equal(service.resolvedTurns(1).length, 1);
  assert.equal(service.roundStatus(1).canSummarize, true);
  service.markRoundSummarized(1, { narration: 'A primeira troca termina.' });
  assert.equal(service.roundStatus(1).summarized, true);
  assert.equal(service.roundStatus(1).canSummarize, false);
});
