import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  actionMessageRejectionReason,
  isSupportedPlayerChatStyle
} from '../apps/foundry-module/scripts/chat-action-filter.js';

test('ignora aviso privado do Plutonium', () => {
  const message = {
    content: '<p>Welcome to Plutonium!</p>',
    whisper: ['player-2'],
    flags: { plutonium: { notice: true } }
  };
  assert.equal(actionMessageRejectionReason(message, 'Welcome to Plutonium!'), 'PRIVATE_MESSAGE');
});

test('ignora aviso de módulo mesmo quando não é whisper', () => {
  const message = { content: '<p>Welcome to Plutonium!</p>', whisper: [] };
  assert.equal(actionMessageRejectionReason(message, 'Welcome to Plutonium!'), 'MODULE_NOTICE');
});

test('ignora rolagens e cards automatizados', () => {
  assert.equal(actionMessageRejectionReason({ content: 'Ataque', rolls: [{}] }, 'Ataque'), 'ROLL_MESSAGE');
  assert.equal(
    actionMessageRejectionReason({ content: '<div class="chat-card"><button data-action="use">Usar</button></div>' }, 'Usar'),
    'AUTOMATED_CARD'
  );
});

test('aceita ação pública textual de jogador', () => {
  const message = { content: '<p>Examino a porta em busca de armadilhas.</p>', whisper: [], style: 1 };
  assert.equal(actionMessageRejectionReason(message, 'Examino a porta em busca de armadilhas.'), null);
  assert.equal(isSupportedPlayerChatStyle(message, { OOC: 1, IC: 2, EMOTE: 3 }), true);
});

test('rejeita estilos de chat não textuais', () => {
  assert.equal(isSupportedPlayerChatStyle({ style: 5 }, { OOC: 1, IC: 2, EMOTE: 3 }), false);
});

test('hook processa apenas mensagens criadas e deduplica a publicação', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('async function processPlayerActionMessage'), source.indexOf('function installPlayerActionHook'));
  const installBlock = source.slice(source.indexOf('function installPlayerActionHook'), source.indexOf('function extractSceneSectionFromPage'));
  assert.match(block, /actionMessageRejectionReason/);
  assert.match(block, /claimPlayerActionContent/);
  assert.match(block, /eventId/);
  assert.match(block, /result\?\.duplicate/);
  assert.match(block, /publishNarrationChat\(result\.narration, actionPublicationKey\)/);
  assert.match(installBlock, /Hooks\.on\('createChatMessage'/);
  assert.doesNotMatch(installBlock, /Hooks\.on\('chatMessage'/);
});
