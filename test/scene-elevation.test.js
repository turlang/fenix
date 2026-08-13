import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TokenMovementMode,
  clampFlyingElevation,
  eyeElevation,
  levelForElevation,
  normalizeSceneElevation,
  normalizeTokenVerticalProfile,
  tokenVerticalBand,
  verticalBandsOverlap,
  wallContainsElevation,
  wallIntersectsVerticalBand
} from '../packages/scene-elevation/src/index.js';

test('configuração vertical normaliza níveis, passo e faixa padrão de paredes', () => {
  const config = normalizeSceneElevation({
    enabled: true,
    unit: 'm',
    levelHeight: 3,
    verticalStep: 1,
    defaultWallBottom: 0,
    defaultWallTop: 3,
    levels: [
      { id: 'ground', name: 'Térreo', elevation: 0 },
      { id: 'bridge', name: 'Ponte', elevation: 4 }
    ]
  });
  assert.equal(config.enabled, true);
  assert.equal(config.levels.length, 2);
  assert.equal(levelForElevation(config, 3.7).id, 'bridge');
});

test('perfil vertical distingue solo e voo e calcula altura dos olhos', () => {
  const flying = normalizeTokenVerticalProfile({ elevation: 4, height: 2, movementMode: 'flying' });
  const ground = normalizeTokenVerticalProfile({ movementMode: 'invalid' });
  assert.equal(flying.movementMode, TokenMovementMode.FLYING);
  assert.equal(ground.movementMode, TokenMovementMode.GROUND);
  assert.equal(eyeElevation(flying), 5.8);
});

test('faixas verticais só se bloqueiam quando realmente se sobrepõem', () => {
  const wall = { bottomElevation: 0, topElevation: 3 };
  assert.equal(wallIntersectsVerticalBand(wall, tokenVerticalBand({ elevation: 0, height: 1.8 })), true);
  assert.equal(wallIntersectsVerticalBand(wall, tokenVerticalBand({ elevation: 3, height: 1.8 })), false);
  assert.equal(wallContainsElevation(wall, 1.5), true);
  assert.equal(wallContainsElevation(wall, 5), false);
  assert.equal(verticalBandsOverlap({ bottom: 0, top: 2 }, { bottom: 2, top: 4 }), false);
});

test('voo limita a alteração de Z a um passo por comando', () => {
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: 50, verticalStep: 1 }), 5);
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: -50, verticalStep: 1 }), 3);
  assert.equal(clampFlyingElevation({ previousElevation: 4, requestedElevation: 4.5, verticalStep: 1 }), 4.5);
});
