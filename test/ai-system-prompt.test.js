import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildNarratorSystemPrompt,
  EMOTION_MARKERS,
  NARRATOR_SYSTEM_PROMPT_VERSION
} from '../packages/ai-provider/src/system-prompt.js';

test('system prompt protege agência e conteúdo reservado', () => {
  const prompt = buildNarratorSystemPrompt();
  assert.match(prompt, /Nunca controle personagens jogadores/i);
  assert.match(prompt, /material reservado ao mestre/i);
  assert.match(prompt, /Não emita marcadores de voz/i);
  assert.match(prompt, new RegExp(NARRATOR_SYSTEM_PROMPT_VERSION));
});

test('system prompt expõe somente marcadores emocionais permitidos quando habilitado', () => {
  const prompt = buildNarratorSystemPrompt({ audioMarkersEnabled: true });
  for (const marker of EMOTION_MARKERS) assert.match(prompt, new RegExp(marker.replace(/[\[\]]/g, '\\$&')));
  assert.doesNotMatch(prompt, /\[furioso\]/i);
});
