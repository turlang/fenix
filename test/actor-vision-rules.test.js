import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VisionSense,
  createGenericRpgSystemAdapter,
  effectiveVisionRange,
  normalizeVisionProfile
} from '../packages/rpg-rules-contract/src/index.js';
import { normalizeSceneScale } from '../packages/scene-scale/src/index.js';

test('perfil de visão pertence às regras do ator e converte pela escala da cena', () => {
  const profile = normalizeVisionProfile({
    unit: 'm',
    eyeHeight: 1.65,
    preferredSense: 'normal',
    senses: {
      normal: 9,
      darkvision: 18
    }
  });
  const scale = normalizeSceneScale({ distancePerCell: 1.5, unit: 'm' });

  assert.equal(effectiveVisionRange({ profile, sceneScale: scale }).cells, 6);
  assert.equal(effectiveVisionRange({ profile, sceneScale: scale, sense: VisionSense.DARKVISION }).cells, 12);
  assert.equal(profile.eyeHeight, 1.65);
});

test('adaptador genérico resolve visão e movimento a partir da ficha', () => {
  const adapter = createGenericRpgSystemAdapter({ id: 'generic-test' });
  const sheet = {
    height: 1.9,
    movement: { unit: 'm', speeds: { walk: 7.5, fly: 15 }, defaultMode: 'walk' },
    vision: { unit: 'm', eyeHeight: 1.7, senses: { normal: 12, blindsight: 3 } }
  };

  const movement = adapter.resolveMovementProfile({ sheet });
  const vision = adapter.resolveVisionProfile({ sheet });
  assert.equal(movement.speeds.walk.distance, 7.5);
  assert.equal(movement.speeds.fly.distance, 15);
  assert.equal(vision.senses.normal.distance, 12);
  assert.equal(vision.senses.blindsight.distance, 3);
});

test('visão desativada resolve orçamento zero', () => {
  const profile = normalizeVisionProfile({ enabled: false, unit: 'm', senses: { normal: 30 } });
  const resolved = effectiveVisionRange({ profile, sceneScale: { distancePerCell: 1.5, unit: 'm' } });
  assert.equal(resolved.cells, 0);
  assert.equal(resolved.distance, 0);
});
