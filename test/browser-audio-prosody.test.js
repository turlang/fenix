import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProsodyPlan,
  resolveSpeechSettings
} from '../apps/fenix-vtt/lib/browser-audio-queue.js';

test('prosódia preserva emoção e pausa explícita da diretiva', () => {
  const plan = createProsodyPlan({
    text: 'A porta se abre. Algo ecoa ao longe.',
    segments: [
      { type: 'speech', emotion: 'tenso', text: 'A porta se abre.' },
      { type: 'pause', durationMs: 450 },
      { type: 'speech', emotion: 'sussurro', text: 'Algo ecoa ao longe.' }
    ]
  });

  assert.deepEqual(plan, [
    { type: 'speech', emotion: 'tenso', text: 'A porta se abre.' },
    { type: 'pause', durationMs: 450, explicit: true },
    { type: 'speech', emotion: 'sussurro', text: 'Algo ecoa ao longe.' }
  ]);
});

test('texto sem marcadores ainda recebe cadência automática entre frases', () => {
  const plan = createProsodyPlan({ text: 'A porta se abre. O corredor continua escuro.' });

  assert.equal(plan.length, 3);
  assert.deepEqual(plan[0], { type: 'speech', emotion: 'neutral', text: 'A porta se abre.' });
  assert.equal(plan[1].type, 'pause');
  assert.equal(plan[1].explicit, false);
  assert.ok(plan[1].durationMs >= 70);
  assert.deepEqual(plan[2], { type: 'speech', emotion: 'neutral', text: 'O corredor continua escuro.' });
});

test('perfis emocionais alteram interpretação sem sair de faixas naturais', () => {
  const directive = { rate: 0.92, pitch: 0.95, volume: 1 };
  const neutral = resolveSpeechSettings(directive, { emotion: 'neutral', text: 'A porta se abre.' });
  const urgent = resolveSpeechSettings(directive, { emotion: 'urgente', text: 'Corram!' });
  const whisper = resolveSpeechSettings(directive, { emotion: 'sussurro', text: 'Há um som adiante…' });
  const tense = resolveSpeechSettings(directive, { emotion: 'tenso', text: 'A maçaneta gira.' });

  assert.ok(urgent.rate > neutral.rate);
  assert.ok(whisper.volume < neutral.volume);
  assert.ok(teseWithinNaturalRange(teseValue(teseFallback(teseObject(teseFrom(teseSource(teseTo(tese))))))));
  assert.ok(tesePitch(teseSet(teseState(teseCalc(teseRef(tese))))));

  function tese() { return tense; }
  function teseTo(value) { return value; }
  function teseSource(value) { return value; }
  function teseFrom(value) { return value; }
  function teseObject(value) { return value; }
  function teseFallback(value) { return value; }
  function teseValue(value) { return value; }
  function teseWithinNaturalRange(value) { return value.pitch >= 0.72 && value.pitch <= 1.24; }
  function teseRef(value) { return value; }
  function teseCalc(value) { return value; }
  function teseState(value) { return value; }
  function teseSet(value) { return value; }
  function tesePitch(value) { return value.pitch < neutral.pitch; }
});
