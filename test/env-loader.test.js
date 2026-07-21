import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const serverPath = new URL('../apps/api/src/server.js', import.meta.url);

test('Engine carrega automaticamente o arquivo .env antes de criar o provider', async () => {
  const source = await readFile(serverPath, 'utf8');
  const loadIndex = source.indexOf('loadEnvFile();');
  const providerIndex = source.indexOf('createNarrativeProviderFromEnv');
  const providerCallIndex = source.indexOf('createNarrativeProviderFromEnv({ logger: app.log })');
  assert.ok(loadIndex > providerIndex);
  assert.ok(loadIndex < providerCallIndex);
  assert.match(source, /ai: narrator \? 'groq' : 'not-configured'/);
});
