import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Foundry oferece painel de mapas no chat e nos controles da cena', async () => {
  const [main, panel, css, moduleJson] = await Promise.all([
    readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/scripts/map-panel.js', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8'),
    readFile(new URL('../apps/foundry-module/module.json', import.meta.url), 'utf8')
  ]);
  assert.match(main, /injectMapButton/);
  assert.match(main, /mestreOrcMaps/);
  assert.match(main, /open-maps/);
  assert.match(panel, /Mapas e Scenes/);
  assert.match(panel, /createFoundrySceneFromBlueprint/);
  assert.match(panel, /FilePicker\.upload/);
  assert.match(panel, /SceneClass\.create/);
  assert.match(panel, /createEmbeddedDocuments\('Wall'/);
  assert.match(panel, /createEmbeddedDocuments\('AmbientLight'/);
  assert.match(panel, /createEmbeddedDocuments\('Note'/);
  assert.match(panel, /JournalClass\.create/);
  assert.match(css, /mestre-orc-map-panel/);
  assert.match(moduleJson, /mapas|Scenes/i);
});

test('API expõe ciclo completo de plantas e vínculo com Scene', async () => {
  const source = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  assert.match(source, /createMapServiceFromEnv/);
  assert.match(source, /app\.get\('\/v1\/maps\/:campaignId'/);
  assert.match(source, /app\.post\('\/v1\/maps\/:campaignId\/generate'/);
  assert.match(source, /:mapId\/scene-created/);
  assert.match(source, /app\.delete\('\/v1\/maps\/:campaignId\/:mapId'/);
  assert.match(source, /MAP_DUPLICATE/);
});
