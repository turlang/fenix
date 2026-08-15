import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTokenMovement } from '../packages/scene-collision/src/index.js';

function barrier(kind = 'wall', doorState = null, overrides = {}) {
  return {
    id: 'barrier-1',
    kind,
    doorState,
    a: { x: 140, y: 0 },
    b: { x: 140, y: 280 },
    ...overrides
  };
}

function movement(walls, options = {}) {
  return resolveTokenMovement({
    from: { x: 70, y: 140 },
    to: { x: 210, y: 140 },
    walls,
    sceneWidth: 420,
    sceneHeight: 280,
    tokenSize: 40,
    padding: 0,
    ...options
  });
}

test('parede interrompe o sweep antes do token atravessar o segmento', () => {
  const result = movement([barrier()]);
  assert.equal(result.blocked, true);
  assert.equal(result.wallId, 'barrier-1');
  assert.ok(result.position.x <= 120.1, `posição aceita deveria parar antes da parede: ${result.position.x}`);
  assert.ok(result.position.x >= 119, `posição aceita não deveria recuar demais: ${result.position.x}`);
  assert.equal(result.position.y, 140);
  assert.ok(result.fraction > 0 && result.fraction < 1);
});

test('porta fechada ou trancada bloqueia; porta aberta permite passagem', () => {
  assert.equal(movement([barrier('door', 'closed')]).blocked, true);
  assert.equal(movement([barrier('door', 'locked')]).blocked, true);
  const open = movement([barrier('door', 'open')]);
  assert.equal(open.blocked, false);
  assert.equal(open.position.x, 210);
});

test('limites da cena mantêm o centro do token dentro do mapa', () => {
  const result = resolveTokenMovement({
    from: { x: 100, y: 100 },
    to: { x: -50, y: 999 },
    walls: [],
    sceneWidth: 420,
    sceneHeight: 280,
    tokenSize: 40,
    padding: 0
  });
  assert.equal(result.boundaryAdjusted, true);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.position, { x: 20, y: 260 });
});

test('token encostado em obstáculo consegue se afastar sem ficar preso', () => {
  const result = resolveTokenMovement({
    from: { x: 120, y: 140 },
    to: { x: 70, y: 140 },
    walls: [barrier()],
    sceneWidth: 420,
    sceneHeight: 280,
    tokenSize: 40,
    padding: 0
  });
  assert.equal(result.blocked, false);
  assert.equal(result.position.x, 70);
});

test('parede finita bloqueia no mesmo nível e libera voo acima do topo', () => {
  const wall = barrier('wall', null, { bottomElevation: 0, topElevation: 3 });
  assert.equal(movement([wall], { verticalEnabled: true, tokenElevation: 0, tokenHeight: 1.8 }).blocked, true);
  const flying = movement([wall], { verticalEnabled: true, tokenElevation: 3.1, tokenHeight: 1.8 });
  assert.equal(flying.blocked, false);
  assert.equal(flying.position.x, 210);
});

test('barreira elevada permite passagem por baixo e bloqueia token na faixa da ponte', () => {
  const railing = barrier('wall', null, { bottomElevation: 4, topElevation: 6 });
  assert.equal(movement([railing], { verticalEnabled: true, tokenElevation: 0, tokenHeight: 1.8 }).blocked, false);
  assert.equal(movement([railing], { verticalEnabled: true, tokenElevation: 4, tokenHeight: 1.8 }).blocked, true);
});

test('modelo vertical desligado preserva colisão 2D mesmo com parede finita', () => {
  const wall = barrier('wall', null, { bottomElevation: 0, topElevation: 3 });
  assert.equal(movement([wall], { verticalEnabled: false, tokenElevation: 20, tokenHeight: 1.8 }).blocked, true);
});
