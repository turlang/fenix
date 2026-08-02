import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTokenPerception,
  resolveTokenVision,
  tokenVisibleFrom,
  visibleTokensFrom
} from '../apps/foundry-module/scripts/token-vision.js';

function rectangle(left, top, right, bottom) {
  return { contains: (x, y) => x >= left && x <= right && y >= top && y <= bottom };
}

function token(id, x, y, { actorId = id, hidden = false, statuses = [], vision = null } = {}) {
  const actor = { id: actorId, name: `Actor ${actorId}`, statuses: new Set(statuses) };
  return {
    document: { id, x, y, width: 1, height: 1, hidden, sight: { enabled: true }, actor },
    actor,
    vision
  };
}

test('usa o polígono iluminado da fonte de visão do token observador', () => {
  const viewer = token('viewer', 0, 0, { vision: { light: rectangle(0, 0, 260, 160), isBlinded: false } });
  const visible = token('visible', 100, 0);
  const outside = token('outside', 400, 0);

  assert.equal(tokenVisibleFrom(viewer, visible, { gridSize: 100 }), true);
  assert.equal(tokenVisibleFrom(viewer, outside, { gridSize: 100 }), false);
  assert.deepEqual(visibleTokensFrom(viewer, [visible, outside], { gridSize: 100 }), [visible]);
  assert.equal(resolveTokenVision(viewer).sourceKind, 'LIGHT');
});

test('não amplia visão para LOS quando o polígono iluminado existe', () => {
  const viewer = token('viewer', 0, 0, {
    vision: {
      light: rectangle(0, 0, 150, 150),
      los: rectangle(0, 0, 1000, 1000),
      isBlinded: false
    }
  });
  const target = token('target', 300, 0);

  assert.equal(tokenVisibleFrom(viewer, target, { gridSize: 100 }), false);
});

test('usa FOV como fallback quando a fonte não expõe light', () => {
  const viewer = token('viewer', 0, 0, { vision: { fov: rectangle(0, 0, 300, 300), isBlinded: false } });
  const target = token('target', 100, 100);

  assert.equal(tokenVisibleFrom(viewer, target, { gridSize: 100 }), true);
  assert.equal(resolveTokenVision(viewer).sourceKind, 'FOV');
});

test('exclui tokens ocultos, invisíveis e observadores sem visão disponível', () => {
  const viewer = token('viewer', 0, 0, { vision: { light: rectangle(0, 0, 500, 500), isBlinded: false } });
  const hidden = token('hidden', 100, 0, { hidden: true });
  const invisible = token('invisible', 100, 0, { statuses: ['invisible'] });
  const noVision = token('no-vision', 0, 0);
  const target = token('target', 100, 0);

  assert.equal(tokenVisibleFrom(viewer, hidden, { gridSize: 100 }), false);
  assert.equal(tokenVisibleFrom(viewer, invisible, { gridSize: 100 }), false);
  assert.equal(tokenVisibleFrom(noVision, target, { gridSize: 100 }), false);
});

test('token cegado produz percepção canônica conservadora e nenhum ator visível', () => {
  const viewer = token('viewer', 0, 0, {
    actorId: 'hero',
    vision: { light: rectangle(0, 0, 500, 500), isBlinded: true }
  });
  const target = token('target', 100, 0, { actorId: 'npc-1' });
  const perception = createTokenPerception(viewer, []);

  assert.equal(tokenVisibleFrom(viewer, target, { gridSize: 100 }), false);
  assert.deepEqual(perception, {
    mode: 'CANONICAL_ONLY',
    observer: { tokenId: 'viewer', actorId: 'hero' },
    visionAvailable: false,
    blinded: true,
    sourceKind: 'NONE',
    limitedToLineOfSight: true,
    visibleActorCount: 0
  });
});

test('conta atores visíveis sem duplicar tokens do mesmo ator', () => {
  const viewer = token('viewer', 0, 0, { actorId: 'hero', vision: { light: rectangle(0, 0, 500, 500) } });
  const first = token('target-1', 100, 0, { actorId: 'npc-1' });
  const second = token('target-2', 200, 0, { actorId: 'npc-1' });
  const perception = createTokenPerception(viewer, [first, second]);

  assert.equal(perception.mode, 'TOKEN_VISION');
  assert.equal(perception.visibleActorCount, 1);
});
