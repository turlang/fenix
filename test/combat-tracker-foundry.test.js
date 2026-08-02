import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionEconomyFromMessage,
  combatActionPayloadFromMessage,
  combatSnapshotFromDocument,
  extractCombatRoll,
  stripActionEconomyPrefix
} from '../apps/foundry-module/scripts/combat-tracker.js';

test('detecta prefixos de ação, bônus, reação e movimento', () => {
  assert.equal(actionEconomyFromMessage({}, 'Ação bônus: uso Passo Nebuloso'), 'BONUS_ACTION');
  assert.equal(actionEconomyFromMessage({}, '[Reação] uso Escudo'), 'REACTION');
  assert.equal(actionEconomyFromMessage({}, 'Movimento — avanço seis metros'), 'MOVEMENT');
  assert.equal(stripActionEconomyPrefix('Ação: golpeio o orc'), 'golpeio o orc');
});

test('prioriza o tipo de ativação do item D&D 5e', () => {
  const message = { flags: { dnd5e: { itemData: { system: { activation: { type: 'bonus' } } } } } };
  assert.equal(actionEconomyFromMessage(message, 'Ataco'), 'BONUS_ACTION');
});

test('extrai rolagem confirmada sem inventar resultado', () => {
  const result = extractCombatRoll({ rolls: [{ total: 19, formula: '1d20+5' }, { total: 8, formula: '1d8+3' }] });
  assert.equal(result.total, 19);
  assert.equal(result.damageTotal, 8);
  assert.equal(result.authoritative, true);
  assert.equal(result.outcome, null);
});

test('normaliza documento do Combat Tracker e cria payload', () => {
  const combatant = { id: 'c1', actorId: 'a1', tokenId: 't1', name: 'Arannis', initiative: 18, actor: { type: 'character' } };
  const snapshot = combatSnapshotFromDocument({
    id: 'combat-1', sceneId: 'scene-1', round: 2, turn: 0, started: true,
    combatant, combatants: { contents: [combatant] }
  });
  assert.equal(snapshot.activeCombatant.actorId, 'a1');
  const payload = combatActionPayloadFromMessage({ rolls: [{ total: 17, formula: '1d20+5' }] }, {
    content: 'Ação: ataco o goblin',
    identity: { actorId: 'a1', actorName: 'Arannis', tokenId: 't1', combatantId: 'c1', targetIds: ['g1'] },
    combat: snapshot
  });
  assert.equal(payload.content, 'ataco o goblin');
  assert.equal(payload.economyType, 'ACTION');
  assert.equal(payload.roll.total, 17);
  assert.deepEqual(payload.targetIds, ['g1']);
});
