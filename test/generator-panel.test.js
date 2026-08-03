import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Foundry oferece Forja de conteúdo no chat e controles da cena', async () => {
  const [main, panel, css] = await Promise.all([
    readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/scripts/generator-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8')
  ]);
  assert.match(main, /injectGeneratorButton/);
  assert.match(main, /mestreOrcGenerators/);
  assert.match(main, /open-generators/);
  assert.match(panel, /Forja de conteúdo/);
  assert.match(panel, /Gerar e arquivar/);
  assert.match(panel, /Proteção contra repetição/);
  assert.match(panel, /referência exclusiva do mestre/i);
  assert.match(css, /mestre-orc-generator-panel/);
});

test('API expõe geração, consulta, ativação, arquivamento e exclusão', async () => {
  const source = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  assert.match(source, /createGeneratorServiceFromEnv/);
  assert.match(source, /app\.post\('\/v1\/generators\/:campaignId\/generate'/);
  assert.match(source, /:artifactId\/activate/);
  assert.match(source, /:artifactId\/archive/);
  assert.match(source, /app\.delete\('\/v1\/generators\/:campaignId\/:artifactId'/);
  assert.match(source, /GENERATOR_REPETITION_BLOCKED/);
});
