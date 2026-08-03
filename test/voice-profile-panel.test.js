import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Foundry oferece painel de perfis e reprodução neural com fallback local', async () => {
  const [main, panel, css] = await Promise.all([
    readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/scripts/voice-profile-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8')
  ]);
  assert.match(main, /speakNeuralDirectivePrepared/);
  assert.match(main, /\/v1\/audio\/synthesize/);
  assert.match(main, /fallbackMode === 'browser-tts'/);
  assert.match(main, /base64AudioBlob/);
  assert.match(main, /injectVoiceProfileButton/);
  assert.match(panel, /Vozes do narrador e dos NPCs/);
  assert.match(panel, /O módulo não cria nem clona vozes/);
  assert.match(panel, /Voz gerada por inteligência artificial/);
  assert.match(panel, /\/v1\/voice-profiles\//);
  assert.match(css, /mestre-orc-voice-panel/);
});

test('API expõe perfis persistentes e síntese sem enviar credenciais ao Foundry', async () => {
  const source = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  assert.match(source, /createNeuralVoiceServiceFromEnv/);
  assert.match(source, /createVoiceProfileServiceFromEnv/);
  assert.match(source, /GET|app\.get\('\/v1\/voice\/providers'/);
  assert.match(source, /app\.post\('\/v1\/audio\/synthesize'/);
  assert.match(source, /voiceProfileService\.resolve/);
  assert.doesNotMatch(source, /return\s+\{[^}]*apiKey/s);
});
