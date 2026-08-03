import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = Promise.all([
  readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/foundry-module/scripts/automation-panel.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8')
]);

test('Foundry oferece fila de automações somente ao mestre', async () => {
  const [main, panel, css] = await files;
  assert.match(main, /injectAutomationButton/);
  assert.match(main, /open-automations/);
  assert.match(main, /mestreOrcAutomations/);
  assert.match(panel, /if \(!game\.user\?\.isGM/);
  assert.match(panel, /Nenhuma ação é aplicada silenciosamente/);
  assert.match(css, /mestre-orc-automation-panel/);
});

test('painel separa aprovação, execução e reversão', async () => {
  const [, panel] = await files;
  assert.match(panel, /data-automation-action="approve"/);
  assert.match(panel, /data-automation-action="execute"/);
  assert.match(panel, /execute\/claim/);
  assert.match(panel, /execute\/result/);
  assert.match(panel, /rollback\/claim/);
  assert.match(panel, /rollback\/result/);
  assert.match(panel, /segundo passo explícito/i);
});

test('executor local usa allowlist e recibos reversíveis', async () => {
  const [, panel] = await files;
  assert.match(panel, /CHAT_MESSAGE/);
  assert.match(panel, /CREATE_JOURNAL/);
  assert.match(panel, /APPEND_JOURNAL_PAGE/);
  assert.match(panel, /CREATE_SCENE_NOTE/);
  assert.match(panel, /UPDATE_ACTOR_RESOURCE/);
  assert.match(panel, /previousValue/);
  assert.match(panel, /appliedValue/);
  assert.match(panel, /assertAutomationOwnership/);
  assert.match(panel, /alterado depois da automação/);
  assert.match(panel, /deleteEmbeddedDocuments/);
  assert.doesNotMatch(panel, /eval\s*\(|new Function\s*\(/);
});

test('API expõe sugestões, fila, aprovação, execução e rollback auditáveis', async () => {
  const [, , , server] = await files;
  assert.match(server, /createAutomationServiceFromEnv/);
  assert.match(server, /\/v1\/automations\/:campaignId\/suggest/);
  assert.match(server, /\['approve', 'approveAutomationProposal'/);
  assert.match(server, /execute\/claim/);
  assert.match(server, /execute\/result/);
  assert.match(server, /rollback\/claim/);
  assert.match(server, /rollback\/result/);
});
