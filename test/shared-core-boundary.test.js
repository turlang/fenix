import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('SessionDirector não conhece implementações específicas de VTT', async () => {
  const source = await readFile(new URL('../packages/session-director/src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Foundry/i);
  assert.doesNotMatch(source, /canvas\.|game\.|ChatMessage|SpeechSynthesis/i);
  assert.match(source, /contextPort/);
  assert.match(source, /narrationOutput/);
});

test('compatibilidade Foundry permanece somente na composition layer', async () => {
  const runtime = await readFile(new URL('../packages/session-runtime/src/index.js', import.meta.url), 'utf8');
  assert.match(runtime, /FoundryAdapter/);
  assert.match(runtime, /foundryApi/);
  assert.match(runtime, /publishChat/);
});
