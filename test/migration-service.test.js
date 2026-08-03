import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MigrationService, CURRENT_DATA_SCHEMA_VERSION } from '../packages/migration-service/src/index.js';

async function temporaryDirectory() {
  return mkdtemp(join(tmpdir(), 'mestre-orc-migration-'));
}

test('primeira execução registra o schema sem criar snapshot vazio', async () => {
  const directory = await temporaryDirectory();
  try {
    const service = new MigrationService({ dataDirectory: directory, engineVersion: 'test' });
    const result = await service.migrate({ reason: 'test' });
    assert.equal(result.changed, true);
    assert.equal(result.snapshot, null);
    const state = JSON.parse(await readFile(join(directory, 'migration-state.json'), 'utf8'));
    assert.equal(state.schemaVersion, CURRENT_DATA_SCHEMA_VERSION);
    assert.deepEqual(await service.listSnapshots(), []);
    assert.equal((await service.migrate()).changed, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('migração normaliza formatos legados e cria snapshot reversível', async () => {
  const directory = await temporaryDirectory();
  try {
    await writeFile(join(directory, 'narration-history.json'), JSON.stringify([{ id: 'n1', campaignId: 'world' }]));
    await writeFile(join(directory, 'campaign-memory.json'), JSON.stringify({ id: 'world', facts: { a: { id: 'a', text: 'Fato' } } }));
    const service = new MigrationService({ dataDirectory: directory, engineVersion: 'test' });
    const result = await service.migrate({ reason: 'upgrade' });
    assert.equal(result.changed, true);
    assert.ok(result.snapshot?.snapshotId);
    const narration = JSON.parse(await readFile(join(directory, 'narration-history.json'), 'utf8'));
    const memory = JSON.parse(await readFile(join(directory, 'campaign-memory.json'), 'utf8'));
    assert.equal(narration.version, 1);
    assert.equal(narration.records.length, 1);
    assert.equal(memory.version, 1);
    assert.equal(memory.campaigns.world.facts.a.text, 'Fato');

    const rollback = await service.rollback(result.snapshot.snapshotId);
    assert.equal(rollback.rolledBack, true);
    const restoredNarration = JSON.parse(await readFile(join(directory, 'narration-history.json'), 'utf8'));
    assert.ok(Array.isArray(restoredNarration));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('JSON persistente corrompido bloqueia a migração sem sobrescrever o arquivo', async () => {
  const directory = await temporaryDirectory();
  try {
    const path = join(directory, 'voice-profiles.json');
    await writeFile(path, '{invalido');
    const service = new MigrationService({ dataDirectory: directory, engineVersion: 'test' });
    await assert.rejects(service.migrate(), (error) => error.code === 'MIGRATION_SOURCE_INVALID');
    assert.equal(await readFile(path, 'utf8'), '{invalido');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dry-run informa alterações sem escrever dados ou estado', async () => {
  const directory = await temporaryDirectory();
  try {
    const path = join(directory, 'tutor-history.json');
    await writeFile(path, JSON.stringify({ world: { id: 'world', entries: [] } }));
    const service = new MigrationService({ dataDirectory: directory, engineVersion: 'test' });
    const result = await service.migrate({ dryRun: true });
    assert.equal(result.changed, true);
    assert.equal(result.migratedFiles.length, 1);
    assert.equal(JSON.parse(await readFile(path, 'utf8')).version, undefined);
    await assert.rejects(readFile(join(directory, 'migration-state.json'), 'utf8'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
