import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AudioNarrationService } from '../packages/audio-narration-service/src/index.js';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const snapshot = {
  activeScene: { id: 'scene-audio', name: 'Entrada da Caverna', description: '' },
  visibleActors: [],
  sceneJournal: {
    id: 'journal-audio',
    name: 'Entrada da Caverna',
    explicitLink: true,
    selectedPage: {
      name: 'Entrada da Caverna',
      content: 'Uma passagem escura se abre na encosta.',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
    }
  }
};

test('AudioNarrationService cria diretiva browser-tts normalizada', () => {
  const service = new AudioNarrationService({ language: 'pt-BR', rate: 0.88, pitch: 0.8, volume: 0.9 });
  const directive = service.createDirective('  A caverna\nse abre diante do grupo.  ', { sceneId: 'scene-1', sessionId: 'session-1' });

  assert.equal(directive.mode, 'browser-tts');
  assert.equal(directive.text, 'A caverna\nse abre diante do grupo.');
  assert.equal(directive.language, 'pt-BR');
  assert.equal(directive.sceneId, 'scene-1');
  assert.equal(directive.sessionId, 'session-1');
  assert.ok(directive.id);
});

test('runtime retorna diretiva de áudio junto da abertura', async () => {
  const narrator = {
    async createOpening() {
      return `A passagem se abre na encosta, parcialmente escondida pela vegetação. Um riacho raso cruza o terreno diante da entrada, enquanto uma faixa de solo firme acompanha a margem direita até o interior.

O espaço permanece diante do grupo, oferecendo mais de uma forma de aproximação antes que alguém avance. O que vocês fazem?`;
    }
  };
  const runtime = createSessionRuntime({ narrator });
  const result = await runtime.start({ snapshot });

  assert.equal(result.audio.mode, 'browser-tts');
  assert.equal(result.audio.text, result.opening.trim());
  assert.equal(result.audio.sceneId, 'scene-audio');
  assert.equal(result.audio.sessionId, result.sessionId);
});

test('módulo Foundry contém reprodução local e transmissão por socket', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  assert.match(source, /SpeechSynthesisUtterance/);
  assert.match(source, /parseCinematicSpeechScript/);
  assert.match(source, /speakCinematicSegments/);
  assert.match(source, /module\.\$\{MODULE_ID\}/);
  assert.match(source, /type: 'narration-audio'/);
  assert.match(source, /publishNarrationAudio\([\s\S]*?result\.audio,[\s\S]*?result\.opening/);
});

test('TTS bloqueia texto e diretiva publicados mais de uma vez', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  assert.match(source, /audioWasRecentlySpoken/);
  assert.match(source, /AUDIO_DEDUPE_WINDOW_MS/);
  assert.match(source, /claimBrowserPublication\('audio-publication', key\)/);
  assert.match(source, /reprodução duplicada bloqueada/);
  assert.match(source, /source: 'local-publish'/);
  assert.match(source, /source: 'socket'/);
  assert.match(source, /globalThis\.localStorage/);
  assert.match(source, /socket duplicado bloqueado/);
  assert.match(source, /claimBrowserPublication\('audio-publication', publicationKey\)/);
});

test('socket respeita destinatários da diretiva antes de reproduzir', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('function installAudioSocket'), source.indexOf('function refreshAudioToggleButton'));
  assert.match(block, /audioTargetsUser\(payload\.audio, game\.user\?\.id\)/);
  assert.match(block, /diretiva destinada a outro usuário ignorada/);
  assert.ok(block.indexOf('audioTargetsUser') < block.indexOf("claimBrowserPublication('audio-publication'"));
});

test('AudioNarrationService cria diretiva neural com perfil persistente e fallback', () => {
  const service = new AudioNarrationService({ mode: 'neural-auto', synthesisPath: '/v1/audio/synthesize' });
  const directive = service.createDirective('[tenso] A porta se abre.', {
    campaignId: 'world-1', profileId: 'npc:goblin-1', speakerType: 'NPC', npcId: 'goblin-1', npcName: 'Snig'
  });

  assert.equal(directive.mode, 'neural-auto');
  assert.equal(directive.fallbackMode, 'browser-tts');
  assert.equal(directive.synthesisPath, '/v1/audio/synthesize');
  assert.equal(directive.campaignId, 'world-1');
  assert.equal(directive.profileId, 'npc:goblin-1');
  assert.equal(directive.speakerType, 'NPC');
  assert.equal(directive.npcId, 'goblin-1');
  assert.equal(directive.npcName, 'Snig');
  assert.equal(directive.aiGenerated, true);
  assert.match(directive.disclosure, /inteligência artificial/i);
});

test('modo neural-only não autoriza fallback local', () => {
  const directive = new AudioNarrationService({ mode: 'neural-only' }).createDirective('A voz ecoa.', { campaignId: 'world-2' });
  assert.equal(directive.mode, 'neural-only');
  assert.equal(directive.fallbackMode, null);
});
