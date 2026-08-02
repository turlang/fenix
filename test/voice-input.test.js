import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeVoiceTranscript,
  resolveSpeechRecognitionConstructor,
  speechRecognitionErrorMessage,
  speechRecognitionSupported,
  VoiceInputController
} from '../apps/foundry-module/scripts/voice-input.js';

class FakeRecognition {
  static instances = [];

  constructor() {
    FakeRecognition.instances.push(this);
    this.started = false;
    this.stopped = false;
    this.aborted = false;
  }

  start() {
    this.started = true;
    this.onstart?.();
  }

  stop() {
    this.stopped = true;
  }

  abort() {
    this.aborted = true;
    this.onend?.();
  }

  emitResult(results, resultIndex = 0) {
    this.onresult?.({ results, resultIndex });
  }

  emitError(error) {
    this.onerror?.({ error });
  }

  end() {
    this.onend?.();
  }
}

function speechResult(transcript, isFinal) {
  const result = [{ transcript }];
  result.isFinal = isFinal;
  return result;
}

test('normaliza a transcrição sem alterar o conteúdo declarado', () => {
  assert.equal(normalizeVoiceTranscript('  Eu   examino a porta  ! '), 'Eu examino a porta!');
});

test('detecta SpeechRecognition e o prefixo webkit', () => {
  class Standard {}
  class Webkit {}
  assert.equal(resolveSpeechRecognitionConstructor({ SpeechRecognition: Standard }), Standard);
  assert.equal(resolveSpeechRecognitionConstructor({ webkitSpeechRecognition: Webkit }), Webkit);
  assert.equal(speechRecognitionSupported({}), false);
});

test('coleta resultado parcial e entrega apenas a transcrição final', async () => {
  FakeRecognition.instances = [];
  const states = [];
  const interim = [];
  const finals = [];
  const controller = new VoiceInputController({
    scope: { webkitSpeechRecognition: FakeRecognition },
    onStateChange: (state) => states.push(state),
    onInterim: (text) => interim.push(text),
    onFinal: async (text) => finals.push(text)
  });

  assert.equal(controller.start({ language: 'pt-BR' }), true);
  const recognition = FakeRecognition.instances[0];
  assert.equal(recognition.lang, 'pt-BR');
  assert.equal(recognition.interimResults, true);
  recognition.emitResult([
    speechResult('eu examino', false),
    speechResult('a porta em busca de armadilhas', true)
  ]);
  recognition.end();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(finals, ['a porta em busca de armadilhas']);
  assert.ok(interim.includes('eu examino'));
  assert.deepEqual(states, ['starting', 'listening', 'processing', 'idle']);
});

test('parada manual encerra a captura sem duplicar a entrega', async () => {
  FakeRecognition.instances = [];
  const finals = [];
  const controller = new VoiceInputController({
    scope: { SpeechRecognition: FakeRecognition },
    onFinal: (text) => finals.push(text)
  });
  controller.start();
  const recognition = FakeRecognition.instances[0];
  recognition.emitResult([speechResult('avanço em silêncio', true)]);
  assert.equal(controller.stop(), true);
  recognition.end();
  recognition.end();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(finals, ['avanço em silêncio']);
});

test('traduz erros comuns do microfone para mensagens úteis', () => {
  assert.match(speechRecognitionErrorMessage('not-allowed'), /permissão/);
  assert.match(speechRecognitionErrorMessage('audio-capture'), /microfone/);
  assert.match(speechRecognitionErrorMessage('network'), /conexão/);
});


test('avisa quando nenhuma fala é reconhecida', () => {
  FakeRecognition.instances = [];
  const errors = [];
  const controller = new VoiceInputController({
    scope: { SpeechRecognition: FakeRecognition },
    onError: (error) => errors.push(error)
  });
  controller.start();
  FakeRecognition.instances[0].end();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'no-speech');
  assert.equal(controller.state, 'idle');
});

test('erro de permissão não gera aviso duplicado de ausência de fala', () => {
  FakeRecognition.instances = [];
  const errors = [];
  const controller = new VoiceInputController({
    scope: { webkitSpeechRecognition: FakeRecognition },
    onError: (error) => errors.push(error)
  });
  controller.start();
  const recognition = FakeRecognition.instances[0];
  recognition.emitError('not-allowed');
  recognition.end();
  assert.deepEqual(errors.map((error) => error.code), ['not-allowed']);
  assert.equal(controller.state, 'idle');
});
