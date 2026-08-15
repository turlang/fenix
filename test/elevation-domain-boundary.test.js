import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const directorUrl = new URL('../packages/session-director/src/index.js', import.meta.url);
const elevationUrl = new URL('../packages/scene-elevation/src/index.js', import.meta.url);

test('scene-elevation permanece um contrato físico puro', async () => {
  const source = await readFile(elevationUrl, 'utf8');

  for (const forbidden of [
    'SessionDirector',
    'Groq',
    'NarrationService',
    'Fastify',
    'React',
    'Postgres',
    'WebSocket'
  ]) {
    assert.equal(source.includes(forbidden), false, `scene-elevation não deve depender de ${forbidden}`);
  }

  for (const required of [
    'normalizeSceneElevation',
    'normalizeSceneRegions',
    'resolveGroundElevation',
    'clampFlyingElevation',
    'SceneRegionKind'
  ]) {
    assert.equal(source.includes(required), true, `scene-elevation deve expor ${required}`);
  }
});

test('SessionDirector não conhece física vertical da cena', async () => {
  const source = await readFile(directorUrl, 'utf8');

  for (const forbidden of [
    'scene-elevation',
    'normalizeSceneElevation',
    'normalizeSceneRegions',
    'resolveGroundElevation',
    'clampFlyingElevation',
    'SceneRegionKind',
    'TokenMovementMode'
  ]) {
    assert.equal(source.includes(forbidden), false, `SessionDirector não pode conhecer ${forbidden}`);
  }
});
