import test from 'node:test';
import assert from 'node:assert/strict';
import {
  audioTargetsUser,
  normalizeRecipientUserIds,
  ownerUserIdsForToken
} from '../apps/foundry-module/scripts/audio-routing.js';

test('diretiva sem destinatários explícitos permanece geral', () => {
  assert.equal(normalizeRecipientUserIds(undefined), null);
  assert.equal(audioTargetsUser({ text: 'Abertura geral.' }, 'player-1'), true);
});

test('diretiva de sala toca somente para usuários listados', () => {
  const directive = { recipientUserIds: ['player-1', 'player-1', 'player-2'] };
  assert.deepEqual(normalizeRecipientUserIds(directive.recipientUserIds), ['player-1', 'player-2']);
  assert.equal(audioTargetsUser(directive, 'player-1'), true);
  assert.equal(audioTargetsUser(directive, 'player-3'), false);
  assert.equal(audioTargetsUser({ recipientUserIds: [] }, 'player-1'), false);
});

test('proprietários do token excluem GM, observadores e usuários inativos', () => {
  const token = {
    actor: {
      ownership: {
        default: 0,
        'player-owner': 3,
        'player-observer': 2,
        'player-offline': 3,
        'gm-1': 3
      }
    }
  };
  const users = [
    { id: 'player-owner', active: true, isGM: false },
    { id: 'player-observer', active: true, isGM: false },
    { id: 'player-offline', active: false, isGM: false },
    { id: 'gm-1', active: true, isGM: true }
  ];

  assert.deepEqual(ownerUserIdsForToken(token, users, 3), ['player-owner']);
});

test('permissão OWNER calculada pelo Actor também é aceita', () => {
  const token = {
    actor: {
      ownership: { default: 0 },
      testUserPermission(user, permission) {
        return permission === 'OWNER' && user.id === 'player-owner';
      }
    }
  };
  assert.deepEqual(
    ownerUserIdsForToken(token, [{ id: 'player-owner', active: true, isGM: false }]),
    ['player-owner']
  );
});
