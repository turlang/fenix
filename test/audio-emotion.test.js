import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioNarrationService,
  parseEmotionalSegments
} from '../packages/audio-narration-service/src/index.js';

test('marcadores emocionais viram segmentos sem serem falados pelo Browser-TTS', () => {
  const segments = parseEmotionalSegments('[tenso] A porta se abre. [pausa] [sussurro] Algo ecoa ao longe.');
  assert.deepEqual(segments, [
    { type: 'speech', emotion: 'tenso', text: 'A porta se abre.' },
    { type: 'pause', durationMs: 450 },
    { type: 'speech', emotion: 'sussurro', text: 'Algo ecoa ao longe.' }
  ]);

  const directive = new AudioNarrationService().createDirective('[tenso] A porta se abre. [pausa] [sussurro] Algo ecoa ao longe.');
  assert.equal(directive.text, 'A porta se abre. Algo ecoa ao longe.');
  assert.equal(directive.segments.length, 3);
});
