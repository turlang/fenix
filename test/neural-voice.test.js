import test from 'node:test';
import assert from 'node:assert/strict';
import { NeuralVoiceService } from '../packages/neural-voice-service/src/index.js';

function audioResponse(value = 'audio-data', type = 'audio/mpeg') {
  return new Response(Buffer.from(value), { status: 200, headers: { 'content-type': type } });
}

const disabled = { enabled: false, apiKey: '', baseUrl: '', model: '', voiceId: '' };

test('OpenAI TTS envia modelo, voz, instruções, formato e velocidade', async () => {
  let captured = null;
  const service = new NeuralVoiceService({
    order: ['openai'],
    providers: {
      elevenlabs: disabled,
      compatible: disabled,
      openai: { id: 'openai', enabled: true, apiKey: 'secret-key', baseUrl: 'https://api.openai.test/v1', model: 'gpt-4o-mini-tts', voiceId: 'marin', format: 'mp3' }
    },
    fetchImpl: async (url, options) => { captured = { url, options }; return audioResponse(); },
    logger: { warn() {} }
  });
  const result = await service.synthesize({
    text: 'As portas se abrem lentamente.',
    profile: { provider: 'openai', voiceId: 'cedar', model: 'gpt-4o-mini-tts', instructions: 'Voz grave e baixa.', speed: 0.9 }
  });
  const body = JSON.parse(captured.options.body);
  assert.equal(captured.url, 'https://api.openai.test/v1/audio/speech');
  assert.equal(captured.options.headers.Authorization, 'Bearer secret-key');
  assert.equal(body.voice, 'cedar');
  assert.equal(body.instructions, 'Voz grave e baixa.');
  assert.equal(body.speed, 0.9);
  assert.equal(result.mimeType, 'audio/mpeg');
  assert.equal(Buffer.from(result.audioBase64, 'base64').toString(), 'audio-data');
});

test('ElevenLabs envia voice settings avançadas sem expor chave no status', async () => {
  let captured = null;
  const service = new NeuralVoiceService({
    order: ['elevenlabs'],
    providers: {
      openai: disabled,
      compatible: disabled,
      elevenlabs: { id: 'elevenlabs', enabled: true, apiKey: 'xi-secret', baseUrl: 'https://eleven.test/v1', model: 'eleven_multilingual_v2', voiceId: 'default-voice', outputFormat: 'mp3_44100_128' }
    },
    fetchImpl: async (url, options) => { captured = { url, options }; return audioResponse(); },
    logger: { warn() {} }
  });
  await service.synthesize({
    text: 'Quem se aproxima?',
    profile: { provider: 'elevenlabs', voiceId: 'npc-voice', language: 'pt-BR', stability: 0.65, similarityBoost: 0.82, style: 0.3, speed: 0.95, useSpeakerBoost: true }
  });
  const body = JSON.parse(captured.options.body);
  assert.match(captured.url, /text-to-speech\/npc-voice\?output_format=mp3_44100_128/);
  assert.equal(captured.options.headers['xi-api-key'], 'xi-secret');
  assert.equal(body.voice_settings.stability, 0.65);
  assert.equal(body.voice_settings.similarity_boost, 0.82);
  assert.equal(body.voice_settings.style, 0.3);
  assert.equal(body.voice_settings.speed, 0.95);
  assert.doesNotMatch(JSON.stringify(service.getStatus()), /xi-secret/);
});

test('fallback troca para voz padrão do provedor seguinte', async () => {
  const calls = [];
  const service = new NeuralVoiceService({
    order: ['elevenlabs', 'openai'],
    providers: {
      compatible: disabled,
      elevenlabs: { id: 'elevenlabs', enabled: true, apiKey: 'xi', baseUrl: 'https://eleven.test/v1', model: 'eleven-model', voiceId: 'eleven-default', outputFormat: 'mp3_44100_128' },
      openai: { id: 'openai', enabled: true, apiKey: 'sk', baseUrl: 'https://openai.test/v1', model: 'openai-model', voiceId: 'marin', format: 'mp3' }
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      if (url.includes('eleven.test')) return new Response(JSON.stringify({ message: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } });
      return audioResponse('fallback-audio');
    },
    logger: { warn() {} }
  });
  const result = await service.synthesize({ text: 'Teste de fallback.', profile: { provider: 'elevenlabs', voiceId: 'npc-specific', model: 'npc-model' } });
  assert.equal(result.provider, 'openai');
  assert.equal(result.fallbackUsed, true);
  assert.equal(calls[1].body.voice, 'marin');
  assert.equal(calls[1].body.model, 'openai-model');
});

test('cache e requisição em andamento impedem síntese paga duplicada', async () => {
  let count = 0;
  const service = new NeuralVoiceService({
    order: ['openai'],
    providers: { elevenlabs: disabled, compatible: disabled, openai: { id: 'openai', enabled: true, apiKey: 'sk', baseUrl: 'https://openai.test/v1', model: 'tts', voiceId: 'alloy', format: 'mp3' } },
    fetchImpl: async () => { count += 1; await new Promise((resolve) => setTimeout(resolve, 10)); return audioResponse('same'); },
    logger: { warn() {} }
  });
  const [first, second] = await Promise.all([
    service.synthesize({ text: 'Uma única geração.' }),
    service.synthesize({ text: 'Uma única geração.' })
  ]);
  const third = await service.synthesize({ text: 'Uma única geração.' });
  assert.equal(count, 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(third.cached, true);
});
