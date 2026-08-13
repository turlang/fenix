import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TokenVisionMode,
  normalizeTokenVisionProfile,
  normalizeTokenVisionProfiles,
  resolveTokenVisionProfile,
  tokenVisionTint
} from '../packages/scene-vision/src/index.js';

test('perfil de visão normaliza modo, alcance, elevação e luz pessoal', () => {
  const profile = normalizeTokenVisionProfile({
    mode: 'darkvision',
    rangeCells: 12,
    elevation: 3.5,
    personalLight: {
      enabled: true,
      radiusCells: 5,
      intensity: 0.7,
      color: '#ABCDEF'
    }
  });

  assert.equal(profile.mode, TokenVisionMode.DARKVISION);
  assert.equal(profile.rangeCells, 12);
  assert.equal(profile.elevation, 3.5);
  assert.deepEqual(profile.personalLight, {
    enabled: true,
    radiusCells: 5,
    intensity: 0.7,
    color: '#abcdef'
  });
});

test('perfil inválido falha fechado para visão normal e respeita limites', () => {
  const profile = normalizeTokenVisionProfile({
    mode: 'xray',
    rangeCells: 999,
    elevation: 99999,
    personalLight: { radiusCells: -8, intensity: 9, color: 'red' }
  }, { defaultRangeCells: 6 });

  assert.equal(profile.mode, TokenVisionMode.NORMAL);
  assert.equal(profile.rangeCells, 60);
  assert.equal(profile.elevation, 10000);
  assert.equal(profile.personalLight.radiusCells, 1);
  assert.equal(profile.personalLight.intensity, 1);
  assert.equal(profile.personalLight.color, '#f2c66f');
});

test('perfis são indexados por actorId e resolução usa alcance global como fallback', () => {
  const profiles = normalizeTokenVisionProfiles({
    'hero-ayla': { mode: 'infravision', rangeCells: 9 },
    'hero-dorian': { mode: 'normal', rangeCells: 5 }
  }, { defaultRangeCells: 7 });
  const scene = { visionProfiles: profiles };

  assert.equal(resolveTokenVisionProfile({ scene, actorId: 'hero-ayla', fallbackRangeCells: 7 }).mode, TokenVisionMode.INFRAVISION);
  assert.equal(resolveTokenVisionProfile({ scene, actorId: 'hero-ayla', fallbackRangeCells: 7 }).rangeCells, 9);
  assert.equal(resolveTokenVisionProfile({ scene, actorId: 'missing', fallbackRangeCells: 7 }).rangeCells, 7);
});

test('darkvision e infravision definem bypass de escuridão sem ignorar LOS', () => {
  const normal = tokenVisionTint(TokenVisionMode.NORMAL);
  const dark = tokenVisionTint(TokenVisionMode.DARKVISION);
  const infra = tokenVisionTint(TokenVisionMode.INFRAVISION);

  assert.equal(normal.darknessBypass, 0);
  assert.ok(dark.darknessBypass > 0);
  assert.ok(infra.darknessBypass > dark.darknessBypass);
  assert.ok(dark.opacity > 0);
  assert.ok(infra.opacity > 0);
});
