import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainPath = new URL('../apps/foundry-module/scripts/main.js', import.meta.url);

test('busca Journal diretamente no diretório antes de flags da Scene', async () => {
  const source = await readFile(mainPath, 'utf8');
  assert.match(source, /findJournalDirectlyByScene/);
  assert.match(source, /journal-directory-exact/);
  assert.match(source, /DIRECT_JOURNAL_READ_ALOUD/);
  const functionIndex = source.indexOf('async function findSceneJournalReference');
  const directIndex = source.indexOf('findJournalDirectlyByScene(scene)', functionIndex);
  const configuredIndex = source.indexOf('findConfiguredSceneJournalReference(scene)', functionIndex);
  assert.ok(directIndex > functionIndex && directIndex < configuredIndex);
});
