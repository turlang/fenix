import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const panel = await readFile(new URL('../apps/foundry-module/scripts/backup-panel.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8');

test('painel de backup é exclusivo para GM e está disponível no chat e controles da cena', () => {
  assert.match(panel, /somente o mestre pode administrar backups/i);
  assert.match(panel, /BACKUP_BUTTON_ID/);
  assert.match(main, /injectBackupButton/);
  assert.match(main, /mestreOrcBackups/);
  assert.match(main, /openBackupPanel/);
});

test('painel oferece criação, exportação, inspeção, mesclagem e substituição confirmada', () => {
  assert.match(panel, /Criar backup/);
  assert.match(panel, /data-backup-action="export"/);
  assert.match(panel, /Validar antes de restaurar/);
  assert.match(panel, /restore-merge/);
  assert.match(panel, /restore-replace/);
  assert.match(panel, /Digite RESTAURAR/);
  assert.match(panel, /Digite MESCLAR/);
});

test('API expõe ciclo completo de backups com inspeção separada da restauração', () => {
  assert.match(server, /app\.get\('\/v1\/backups\/:campaignId'/);
  assert.match(server, /app\.post\('\/v1\/backups\/:campaignId'/);
  assert.match(server, /app\.post\('\/v1\/backups\/:campaignId\/:backupId\/export'/);
  assert.match(server, /app\.post\('\/v1\/backups\/:campaignId\/inspect'/);
  assert.match(server, /app\.post\('\/v1\/backups\/:campaignId\/restore'/);
  assert.match(server, /app\.delete\('\/v1\/backups\/:campaignId\/:backupId'/);
});

test('estilos do painel de backup possuem responsividade e prévia de restauração', () => {
  assert.match(css, /mestre-orc-backup-overlay/);
  assert.match(css, /mestre-orc-backup-preview/);
  assert.match(css, /@media\(max-width:760px\)/);
});
