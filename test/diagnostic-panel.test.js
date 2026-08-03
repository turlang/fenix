import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile(new URL('../apps/foundry-module/scripts/diagnostic-panel.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8');

test('Central de Diagnóstico coleta navegador, microfone, Foundry, Scene e combate', () => {
  assert.match(panel, /navigator\.permissions/);
  assert.match(panel, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(panel, /game\.version/);
  assert.match(panel, /canvas\?\.scene/);
  assert.match(panel, /game\.combat/);
  assert.match(panel, /apiLatencyMs/);
});

test('painel executa diagnóstico completo e exporta relatório sanitizado', () => {
  assert.match(panel, /Executar diagnóstico completo/);
  assert.match(panel, /Exportar relatório sanitizado/);
  assert.match(panel, /\/v1\/diagnostics\/\$\{encodeURIComponent\(campaignId\(\)\)\}\/run/);
  assert.match(panel, /\/v1\/diagnostics\/\$\{encodeURIComponent\(campaignId\(\)\)\}\/export/);
  assert.match(panel, /Chaves, tokens, cookies, senhas e credenciais/);
});

test('Central de Diagnóstico é exclusiva do GM e aparece no chat e controles da cena', () => {
  assert.match(panel, /somente o mestre pode abrir a Central de Diagnóstico/i);
  assert.match(main, /injectDiagnosticButton/);
  assert.match(main, /open-diagnostics/);
  assert.match(main, /mestreOrcDiagnostics/);
  assert.match(main, /Central de Diagnóstico/);
});

test('API expõe execução, eventos e exportação de diagnóstico', () => {
  assert.match(server, /app\.get\('\/v1\/diagnostics\/:campaignId'/);
  assert.match(server, /app\.post\('\/v1\/diagnostics\/:campaignId\/run'/);
  assert.match(server, /app\.post\('\/v1\/diagnostics\/:campaignId\/events'/);
  assert.match(server, /app\.post\('\/v1\/diagnostics\/:campaignId\/export'/);
  assert.match(server, /diagnosticService\.recordRequest/);
});

test('painel possui estilos responsivos e estados de severidade', () => {
  assert.match(css, /mestre-orc-diagnostic-overlay/);
  assert.match(css, /mestre-orc-diagnostic-check\.is-fail/);
  assert.match(css, /mestre-orc-diagnostic-provider-grid/);
  assert.match(css, /@media\(max-width:600px\)/);
});
