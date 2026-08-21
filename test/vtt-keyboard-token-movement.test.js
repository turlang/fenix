import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEditableKeyboardTarget,
  keyboardMovementStep,
  movementDirectionForKey,
  requestedTokenFromKeyboard,
  tokenKeyboardFootprintCells
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

test('Pequeno ou maior move exatamente uma célula por tecla', () => {
  assert.equal(keyboardMovementStep(70), 70);
  assert.equal(keyboardMovementStep(70, { footprintCells: 1 }), 70);
  assert.equal(keyboardMovementStep(70, { footprintCells: 2 }), 70);

  const token = {
    id: 'token-a', actorId: 'actor-a', x: 100, y: 100, size: 56,
    footprint: { widthCells: 1, heightCells: 1 }
  };
  assert.deepEqual(requestedTokenFromKeyboard(token, 'd', { gridSize: 70 }), {
    ...token,
    x: 170,
    y: 100
  });
});

test('criatura abaixo de Pequeno usa passo proporcional ao footprint', () => {
  const tiny = {
    id: 'token-tiny', actorId: 'actor-tiny', x: 100, y: 100, size: 35,
    footprint: { widthCells: 0.5, heightCells: 0.5 }
  };
  assert.equal(tokenKeyboardFootprintCells(tiny), 0.5);
  assert.equal(keyboardMovementStep(70, { footprintCells: 0.5 }), 35);
  assert.deepEqual(requestedTokenFromKeyboard(tiny, 'ArrowUp', { gridSize: 70 }), {
    ...tiny,
    x: 100,
    y: 65
  });
});
