import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const paths = [
  'packages/platform-protocol/src/index.js',
  'packages/vtt-bridge-sdk/src/index.js',
  'packages/render-stream-contract/src/index.js',
  'packages/render-node-gateway/src/index.js',
  'packages/ai-inference-gateway/src/index.js'
];

test('Platform 2.0 contracts do not depend on the Fenix VTT UI', async () => {
  for (const path of paths) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.equal(source.includes('apps/fenix-vtt'), false, `${path} não pode depender da UI standalone`);
    assert.equal(source.includes('components/'), false, `${path} não pode importar componentes de UI`);
  }
});

test('render contract preserves server authority by not accepting absolute movement position', async () => {
  const source = await readFile(new URL('../packages/render-stream-contract/src/index.js', import.meta.url), 'utf8');
  const moveBlock = source.slice(source.indexOf('if (type === PlayerInputType.MOVE)'), source.indexOf('if (type === PlayerInputType.LOOK)'));
  assert.equal(/\bx\s*:/.test(moveBlock), false);
  assert.equal(/\by\s*:/.test(moveBlock), false);
  assert.match(moveBlock, /forward/);
  assert.match(moveBlock, /strafe/);
});

test('architecture document separates AI GPU from Render GPU responsibilities', async () => {
  const source = await readFile(new URL('../docs/FENIX_PLATFORM_ARCHITECTURE_V2.md', import.meta.url), 'utf8');
  assert.match(source, /AI GPU Node/);
  assert.match(source, /Render GPU Node/);
  assert.match(source, /WebRTC/);
  assert.match(source, /VTT Bridge SDK/);
});
