import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, ROOT), 'utf8');
}

test('3D runtime adapter stays renderer-agnostic and independent from Fenix VTT UI', async () => {
  const code = await source('packages/render-runtime-adapter/src/index.js');
  assert.doesNotMatch(code, /apps\/fenix-vtt|react|next\/|foundry-adapter|pixel-streaming-infrastructure/);
  assert.match(code, /render-stream-contract/);
  assert.match(code, /scene-scale/);
});

test('runtime control reuses authoritative token runtime instead of implementing a second collision engine', async () => {
  const code = await source('packages/render-runtime-control/src/index.js');
  assert.match(code, /authoritative-token-runtime/);
  assert.doesNotMatch(code, /resolveTokenMovement|scene-collision|apps\/fenix-vtt|react/);
});

test('public render descriptor remains free of runtime control secrets', async () => {
  const code = await source('packages/render-stream-contract/src/index.js');
  const descriptorBody = code.slice(code.indexOf('export function createRenderSessionDescriptor'));
  assert.doesNotMatch(descriptorBody, /runtimeControl|accessToken|controlId/);
});
