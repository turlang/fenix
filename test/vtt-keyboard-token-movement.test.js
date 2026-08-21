import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEditableKeyboardTarget,
  keyboardMovementStep,
  movementDirectionForKey,
  requestedTokenFromKeyboard
} from '../apps/fenix-vtt/lib/token-input-movement.js';

test('WASD e setas resolvem direções de movimento', () => {
  assert.deepEqual(movementDirectionForKey('w'), { x: 0, y: -1 });
  assert.deepEqual(movementDirectionForKey('ArrowDown'), { x: 0, y: 1 });
  assert.deepEqual(movementDirectionForKey('A'), { x: -1, y: 0 });
  assert.deepEqual(movementDirectionForKey('ArrowRight'), { x: 1, y: 0 });
});

test('botão não bloqueia atalhos de movimento, mas campos editáveis bloqueiam', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('movimento normal usa passo curto e Shift usa uma célula inteira', () => {
  assert.equal(keyboardMovementStep(70), 14);
  assert.equal(keyboardMovementStep(70, { fullCell: true }), 70);

  const token = { id: 'token-a', actorId: 'actor-a', x: 100, y: 100, size: 56 };
  assert.deepEqual(requestedTokenFromKeyboard(token, 'd', { gridSize: 70 }), {
    ...token,
    x: 114,
    y: 100
  });
  assert.deepEqual(requestedTokenFromKeyboard(token, 'ArrowUp', { gridSize: 70, fullCell: true }), {
    ...token,
    x: 100,
    y: 30
  });
});
