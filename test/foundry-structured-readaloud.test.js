import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainPath = new URL('../apps/foundry-module/scripts/main.js', import.meta.url);

test('módulo prioriza estrutura data-roll-name-ancestor e bloco readaloud', async () => {
  const source = await readFile(mainPath, 'utf8');
  assert.match(source, /findStructuredSceneSection/);
  assert.match(source, /findStartingArea/);
  assert.match(source, /ve-rd__b-inset--readaloud/);
  assert.match(source, /STRUCTURED_READ_ALOUD/);
  assert.match(source, /areaName/);
  assert.doesNotMatch(source, /HEADING_SECTION_FALLBACK/);
  assert.doesNotMatch(source, /PLAIN_TEXT_FALLBACK/);
  assert.match(source, /Conteúdo integral do Journal nunca é enviado/);
});
