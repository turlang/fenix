import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panelUrl = new URL('../apps/foundry-module/scripts/ai-provider-panel.js', import.meta.url);
const mainUrl = new URL('../apps/foundry-module/scripts/main.js', import.meta.url);
const serverUrl = new URL('../apps/api/src/server.js', import.meta.url);

test('painel de provedores consulta métricas e permite rearmar circuitos', async () => {
  const source = await readFile(panelUrl, 'utf8');
  assert.match(source, /GET|\/v1\/ai\/providers/);
  assert.match(source, /\/v1\/ai\/providers\/\$\{encodeURIComponent\(providerId\)\}\/reset/);
  assert.match(source, /CLOSED/);
  assert.match(source, /HALF_OPEN/);
  assert.match(source, /lastLatencyMs/);
  assert.doesNotMatch(source, /API_KEY|Authorization|x-api-key/);
});

test('Foundry injeta Saúde da IA no chat e nos controles da cena', async () => {
  const source = await readFile(mainUrl, 'utf8');
  assert.match(source, /injectAiProviderButton/);
  assert.match(source, /open-ai-providers/);
  assert.match(source, /mestreOrcAiProviders/);
  assert.match(source, /Saúde dos provedores de IA/);
});

test('API expõe status sanitizado e rearme por provedor', async () => {
  const source = await readFile(serverUrl, 'utf8');
  assert.match(source, /app\.get\('\/v1\/ai\/providers'/);
  assert.match(source, /app\.post\('\/v1\/ai\/providers\/:providerId\/reset'/);
  assert.match(source, /AI_PROVIDER_NOT_FOUND/);
});
