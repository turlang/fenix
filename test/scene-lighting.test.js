import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSceneLightPolygons,
  lightContributionAtPoint,
  normalizeSceneLighting,
  resolveLightOrigin
} from '../packages/scene-lighting/src/index.js';

function light(overrides = {}) {
  return {
    id: 'light-1',
    name: 'Tocha',
    enabled: true,
    x: 70,
    y: 140,
    radiusCells: 4,
    intensity: 1,
    color: '#ffcc66',
    ...overrides
  };
}

function barrier(kind = 'wall', doorState = null) {
  return {
    id: 'barrier-1',
    kind,
    doorState,
    a: { x: 140, y: 0 },
    b: { x: 140, y: 280 }
  };
}

test('configuração de iluminação normaliza limites e rejeita IDs duplicados', () => {
  const normalized = normalizeSceneLighting({
    enabled: true,
    darkness: 5,
    sources: [light({ radiusCells: 999, intensity: 9, color: 'invalid' })]
  }, { sceneWidth: 420, sceneHeight: 280 });
  assert.equal(normalized.enabled, true);
  assert.equal(normalized.darkness, 0.98);
  assert.equal(normalized.sources[0].radiusCells, 60);
  assert.equal(normalized.sources[0].intensity, 1);
  assert.equal(normalized.sources[0].color, '#f2c66f');

  assert.throws(
    () => normalizeSceneLighting({ sources: [light(), light()] }),
    (error) => error.code === 'SCENE_LIGHT_ID_CONFLICT'
  );
});

test('parede e porta fechada bloqueiam contribuição; porta aberta deixa luz passar', () => {
  const source = light();
  const target = { x: 210, y: 140 };
  const common = { source, point: target, grid: { size: 70 } };
  assert.equal(lightContributionAtPoint({ ...common, walls: [barrier()] }), 0);
  assert.equal(lightContributionAtPoint({ ...common, walls: [barrier('door', 'closed')] }), 0);
  assert.equal(lightContributionAtPoint({ ...common, walls: [barrier('door', 'locked')] }), 0);
  assert.ok(lightContributionAtPoint({ ...common, walls: [barrier('door', 'open')] }) > 0);
});

test('polígono de luz é recortado pelo mesmo LOS da cena', () => {
  const polygons = computeSceneLightPolygons({
    lighting: { enabled: true, darkness: 0.8, sources: [light()] },
    walls: [barrier()],
    grid: { size: 70 },
    sceneWidth: 420,
    sceneHeight: 280
  });
  assert.equal(polygons.length, 1);
  const eastNearOrigin = polygons[0].polygon.filter((point) => Math.abs(point.y - 140) < 4);
  assert.ok(eastNearOrigin.length > 0);
  assert.ok(Math.max(...eastNearOrigin.map((point) => point.x)) <= 140.1);
});

test('fonte anexada acompanha a posição autoritativa do token', () => {
  const source = light({ attachedTokenId: 'hero-ayla', x: 10, y: 10 });
  assert.deepEqual(resolveLightOrigin(source, [{ id: 'hero-ayla', x: 222, y: 111 }]), { x: 222, y: 111 });
  assert.deepEqual(resolveLightOrigin(source, []), { x: 10, y: 10 });
});
