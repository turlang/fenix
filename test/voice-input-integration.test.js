import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('integra microfone, transcrição, personagem e chat na fila narrativa', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const voiceBlock = source.slice(
    source.indexOf('function currentVoiceActorIdentity'),
    source.indexOf('const PRIVATE_JOURNAL_SELECTOR')
  );
  assert.match(source, /VoiceInputController/);
  assert.match(source, /voiceInputEnabled/);
  assert.match(source, /voiceInputLanguage/);
  assert.match(source, /voiceInputAutoSend/);
  assert.match(voiceBlock, /ChatMessage\.getSpeaker/);
  assert.match(voiceBlock, /selecione um token próprio ou vincule um personagem/);
  assert.match(voiceBlock, /stopNarrationAudio\(\)/);
  assert.match(voiceBlock, /ChatMessage\.create\(messageData\)/);
  assert.match(voiceBlock, /voiceInput: true/);
  assert.match(voiceBlock, /fillVoiceTranscriptInComposer/);
  assert.match(source, /session-status-request/);
  assert.match(source, /broadcastVoiceSessionStatus/);
  assert.match(source, /voiceSessionActive/);
  assert.match(source, /if \(!sender\?\.isGM\)/);
});

test('ação de voz do mestre é aceita sem liberar mensagens manuais do GM', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const block = source.slice(
    source.indexOf('async function processPlayerActionMessage'),
    source.indexOf('function installPlayerActionHook')
  );
  assert.match(block, /const voiceInputMessage = Boolean/);
  assert.match(block, /messageAuthorIsGm\(message\) && !voiceInputMessage/);
});
