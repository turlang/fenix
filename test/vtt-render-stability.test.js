import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fogSource = await readFile(new URL('../apps/fenix-vtt/components/fog-of-war-overlay.jsx', import.meta.url), 'utf8');
const lightingSource = await readFile(new URL('../apps/fenix-vtt/components/dynamic-lighting-overlay.jsx', import.meta.url), 'utf8');

test('Fog evita setState quando a exploração não mudou durante drag', () => {
  assert.match(fogSource, /sameCells\(current, persisted\) \? current : \[\.\.\.persisted\]/);
  assert.match(fogSource, /sameCells\(current, merged\) \? current : \[\.\.\.merged\]/);
  assert.match(fogSource, /const lightingTokens = useMemo\(/);
});

test('editor de iluminação sincroniza por assinatura estável de conteúdo', () => {
  assert.match(lightingSource, /const lightingSignature = JSON\.stringify\(scene\?\.lighting \?\? \{\}\)/);
  assert.match(lightingSource, /\[scene\?\.id, lightingSignature, scene\?\.width, scene\?\.height, editorOpen\]/);
  assert.doesNotMatch(lightingSource, /\[scene\?\.id, scene\?\.lighting, scene\?\.width, scene\?\.height, editorOpen\]/);
});
