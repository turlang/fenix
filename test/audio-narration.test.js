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
  assert.equal(directive.text, 'A caverna se abre diante do grupo.');
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
  assert.equal(result.audio.text, result.opening.replace(/\s+/g, ' ').trim());
  assert.equal(result.audio.sceneId, 'scene-audio');
  assert.equal(result.audio.sessionId, result.sessionId);
});

test('módulo Foundry contém reprodução local e transmissão por socket', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  assert.match(source, /SpeechSynthesisUtterance/);
  assert.match(source, /module\.\$\{MODULE_ID\}/);
  assert.match(source, /type: 'narration-audio'/);
  assert.match(source, /publishNarrationAudio\(result\.audio, result\.opening/);
});
