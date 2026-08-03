import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = Promise.all([
  readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/foundry-module/scripts/tutor-panel.js', import.meta.url), 'utf8'),
  readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8')
]);

test('Foundry oferece Tutor de Ficha aos jogadores e Tutor de Mestre ao GM', async () => {
  const [main, panel, css] = await files;
  assert.match(main, /injectTutorButton/);
  assert.match(main, /open-tutors/);
  assert.match(main, /mestreOrcTutors/);
  assert.match(panel, /Tutor de Ficha/);
  assert.match(panel, /Tutor de Mestre/);
  assert.match(panel, /actor\.isOwner/);
  assert.match(panel, /Nenhuma alteração foi aplicada automaticamente/);
  assert.match(css, /mestre-orc-tutor-panel/);
});

test('snapshot da ficha é curado e não envia o documento bruto inteiro', async () => {
  const [, panel] = await files;
  assert.match(panel, /actorTutorSnapshot/);
  assert.match(panel, /abilities/);
  assert.match(panel, /skills/);
  assert.match(panel, /resources/);
  assert.match(panel, /spells/);
  assert.match(panel, /description.*slice\(0, 1200\)/s);
  assert.doesNotMatch(panel, /JSON\.stringify\(actor\)/);
});

test('API expõe tutores e histórico privado persistente', async () => {
  const [, , , server] = await files;
  assert.match(server, /createTutorServiceFromEnv/);
  assert.match(server, /\/v1\/tutors\/:campaignId\/sheet/);
  assert.match(server, /\/v1\/tutors\/:campaignId\/gm/);
  assert.match(server, /\/v1\/tutors\/:campaignId\/history/);
  assert.match(server, /TUTOR_GM_FAILED|GM_TUTOR_FAILED/);
});
