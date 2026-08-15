import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('scene scale remains independent from token, sheets and RPG systems', async () => {
  const code = await source('packages/scene-scale/src/index.js');
  assert.doesNotMatch(code, /token-entity|rpg-rules|sheet-service|session-director/);
});

test('token entity contract does not import map physics or an RPG implementation', async () => {
  const code = await source('packages/token-entity/src/index.js');
  assert.doesNotMatch(code, /scene-collision|scene-vision|scene-lighting|dnd|pathfinder|session-director/);
});

test('RPG rules contract consumes physical scale but no renderer or VTT UI', async () => {
  const code = await source('packages/rpg-rules-contract/src/index.js');
  assert.match(code, /scene-scale/);
  assert.doesNotMatch(code, /react|webgl|map-stage|fenix-vtt|session-director/);
});
