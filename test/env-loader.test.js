import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverPath = new URL('../apps/api/src/server.js', import.meta.url);
const appPath = new URL('../apps/api/src/app.js', import.meta.url);

test('Engine carrega automaticamente o arquivo .env antes de criar providers', async () => {
  const source = await readFile(serverPath, 'utf8');
  const loadIndex = source.indexOf('loadEnvFile();');
  const providerImportIndex = source.indexOf('createNarrativeProviderFromEnv');
  const providerCallIndex = source.indexOf('const narrator = createNarrativeProviderFromEnv({ logger });');

  assert.ok(providerImportIndex >= 0, 'provider narrativo deve permanecer importado no composition root');
  assert.ok(loadIndex > providerImportIndex, 'loadEnvFile deve executar após os imports ESM');
  assert.ok(providerCallIndex > loadIndex, 'loadEnvFile deve executar antes da criação dos providers');
});

test('health reporta o estado do provider sem acoplar criação ao Fastify', async () => {
  const source = await readFile(appPath, 'utf8');
  assert.match(source, /ai: narrator \? 'groq' : 'not-configured'/);
  assert.doesNotMatch(source, /createNarrativeProviderFromEnv/);
});
