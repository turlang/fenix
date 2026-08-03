import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';
import { BackupService, backupInternals, createBackupServiceFromEnv } from '../packages/backup-service/src/index.js';

const gm = { id: 'gm-1', name: 'Mestre', isGM: true };
const player = { id: 'p-1', name: 'Jogador', isGM: false };

class StoreService {
  constructor(campaigns = {}) { this.store = { version: 1, campaigns: structuredClone(campaigns) }; }
  async loadStore() { return structuredClone(this.store); }
  async saveStore(store) { this.store = structuredClone(store); }
}
class MemoryStore extends StoreService {
  async readDatabase() { return this.loadStore(); }
  async writeDatabase(store) { return this.saveStore(store); }
}
class VoiceStore {
  constructor(campaigns = {}) { this.store = { version: 1, campaigns: structuredClone(campaigns) }; }
  async persist() {}
}

function services(seed = {}) {
  return {
    campaignMemory: new MemoryStore(seed.campaignMemory),
    adventureLibrary: new StoreService(seed.adventureLibrary),
    generatorService: new StoreService(seed.generatedContent),
    mapService: new StoreService(seed.mapBlueprints),
    voiceProfileService: new VoiceStore(seed.voiceProfiles),
    tutorService: new StoreService(seed.tutorHistory),
    automationService: new StoreService(seed.automations),
    narrationMemory: new InMemoryNarrationMemory()
  };
}

async function makeService(directory, seed = {}) {
  const bound = services(seed);
  const service = createBackupServiceFromEnv({
    services: bound,
    engineVersion: '0.1.0-alpha.48',
    logger: {},
    env: { BACKUP_DIRECTORY: directory, BACKUP_RETENTION_PER_CAMPAIGN: '5' }
  });
  return { service, bound };
}

test('somente GM pode criar e listar backups isolados por campanha', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-'));
  try {
    const { service } = await makeService(directory, { campaignMemory: { world1: { campaignId: 'world1', facts: { f1: { id: 'f1', text: 'Ponte caiu.' } } } } });
    await assert.rejects(service.create('world1', { requester: player }), (error) => error.code === 'BACKUP_GM_REQUIRED' && error.statusCode === 403);
    const created = await service.create('world1', { requester: gm, label: 'Sessão 12' });
    assert.equal(created.backup.encrypted, false);
    const list = await service.list('world1', { requester: gm });
    assert.equal(list.backups.length, 1);
    assert.equal(list.backups[0].label, 'Sessão 12');
    assert.equal((await service.list('world2', { requester: gm })).backups.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('backup criptografado exige senha, valida integridade e não inclui campos sensíveis', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-'));
  try {
    const { service } = await makeService(directory, { automations: { world1: { campaignId: 'world1', proposals: [{ id: 'a1', apiKey: 'segredo', payload: { token: 'não exportar', tokenId: 'token-legitimo', value: 4 } }] } } });
    const created = await service.create('world1', { requester: gm, label: 'Protegido', passphrase: 'senha-forte' });
    assert.equal(created.backup.encrypted, true);
    const exported = await service.exportStored('world1', created.backup.id, { requester: gm });
    await assert.rejects(service.inspect('world1', { requester: gm, contentBase64: exported.contentBase64 }), (error) => error.code === 'BACKUP_PASSPHRASE_REQUIRED');
    await assert.rejects(service.inspect('world1', { requester: gm, contentBase64: exported.contentBase64, passphrase: 'errada' }), (error) => error.code === 'BACKUP_PASSPHRASE_INVALID');
    const inspected = await service.inspect('world1', { requester: gm, contentBase64: exported.contentBase64, passphrase: 'senha-forte' });
    assert.ok(inspected.restoreToken);
    const envelope = JSON.parse(Buffer.from(exported.contentBase64, 'base64').toString('utf8'));
    const payload = backupInternals.decodeEnvelope(envelope, 'senha-forte');
    assert.equal('apiKey' in payload.sources.automations.proposals[0], false);
    assert.equal('token' in payload.sources.automations.proposals[0].payload, false);
    assert.equal(payload.sources.automations.proposals[0].payload.tokenId, 'token-legitimo');
    const tampered = { ...envelope, contentBase64: Buffer.from('adulterado').toString('base64') };
    await assert.rejects(service.inspect('world1', { requester: gm, contentBase64: Buffer.from(JSON.stringify(tampered)).toString('base64'), passphrase: 'senha-forte' }), (error) => error.code === 'BACKUP_INTEGRITY_FAILED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('restauração REPLACE cria snapshot automático e token só pode ser usado uma vez', async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-source-'));
  const targetDir = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-target-'));
  try {
    const source = await makeService(sourceDir, {
      campaignMemory: { world1: { campaignId: 'world1', facts: { old: { id: 'old', text: 'Do backup' } } } },
      adventureLibrary: { world1: { id: 'world1', documents: { d1: { id: 'd1', title: 'Aventura' } }, chunks: {} } }
    });
    await source.bound.narrationMemory.append({ id: 'n1', campaignId: 'world1', sceneKey: 's1', text: 'Narração antiga' });
    await source.bound.narrationMemory.append({ id: 'n2', campaignId: 'other', sceneKey: 's2', text: 'Outra campanha' });
    const created = await source.service.create('world1', { requester: gm });
    const exported = await source.service.exportStored('world1', created.backup.id, { requester: gm });

    const target = await makeService(targetDir, { campaignMemory: { world1: { campaignId: 'world1', facts: { current: { id: 'current', text: 'Atual' } } } } });
    const inspected = await target.service.inspect('world1', { requester: gm, contentBase64: exported.contentBase64 });
    const restored = await target.service.restore('world1', { requester: gm, restoreToken: inspected.restoreToken, mode: 'REPLACE' });
    assert.equal(restored.restored, true);
    assert.equal(restored.automaticBackup.automatic, true);
    const memory = await target.bound.campaignMemory.readDatabase();
    assert.ok(memory.campaigns.world1.facts.old);
    assert.equal(memory.campaigns.world1.facts.current, undefined);
    assert.deepEqual((await target.bound.narrationMemory.exportCampaign('world1')).map((entry) => entry.id), ['n1']);
    await assert.rejects(target.service.restore('world1', { requester: gm, restoreToken: inspected.restoreToken, mode: 'REPLACE' }), (error) => error.code === 'BACKUP_RESTORE_TOKEN_INVALID');
    assert.equal((await target.service.list('world1', { requester: gm })).backups.some((entry) => entry.automatic), true);
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('restauração MERGE preserva registros atuais e importedos vencem conflitos pelo id', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-merge-'));
  try {
    const original = await makeService(directory, { tutorHistory: { world1: { campaignId: 'world1', entries: [{ id: 'e1', answer: 'backup' }] } } });
    const created = await original.service.create('world1', { requester: gm });
    const exported = await original.service.exportStored('world1', created.backup.id, { requester: gm });
    original.bound.tutorService.store.campaigns.world1.entries = [{ id: 'e1', answer: 'atual' }, { id: 'e2', answer: 'novo' }];
    const inspected = await original.service.inspect('world1', { requester: gm, contentBase64: exported.contentBase64 });
    await original.service.restore('world1', { requester: gm, restoreToken: inspected.restoreToken, mode: 'MERGE' });
    const entries = original.bound.tutorService.store.campaigns.world1.entries;
    assert.equal(entries.length, 2);
    assert.equal(entries.find((entry) => entry.id === 'e1').answer, 'backup');
    assert.equal(entries.find((entry) => entry.id === 'e2').answer, 'novo');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('backup de outra campanha exige remapeação explícita', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-remap-'));
  try {
    const source = await makeService(join(directory, 'source'), { campaignMemory: { origin: { campaignId: 'origin', worldId: 'origin', facts: { f: { id: 'f' } } } } });
    const created = await source.service.create('origin', { requester: gm });
    const exported = await source.service.exportStored('origin', created.backup.id, { requester: gm });
    const target = await makeService(join(directory, 'target'));
    await assert.rejects(target.service.inspect('destino', { requester: gm, contentBase64: exported.contentBase64 }), (error) => error.code === 'BACKUP_CAMPAIGN_MISMATCH');
    const inspected = await target.service.inspect('destino', { requester: gm, contentBase64: exported.contentBase64, allowCampaignRemap: true });
    await target.service.restore('destino', { requester: gm, restoreToken: inspected.restoreToken, mode: 'REPLACE' });
    const restored = (await target.bound.campaignMemory.readDatabase()).campaigns.destino;
    assert.equal(restored.campaignId, 'destino');
    assert.equal(restored.worldId, 'destino');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('falha durante restauração reaplica os fragmentos anteriores', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-backup-rollback-'));
  try {
    let stateA = { campaignId: 'w', value: 'atual-a' };
    let stateB = { campaignId: 'w', value: 'atual-b' };
    let fail = false;
    const sources = [
      { id: 'a', async readCampaign() { return structuredClone(stateA); }, async writeCampaign(_id, value) { stateA = structuredClone(value); } },
      { id: 'b', async readCampaign() { return structuredClone(stateB); }, async writeCampaign(_id, value) { if (fail) throw new Error('disco indisponível'); stateB = structuredClone(value); } }
    ];
    const service = new BackupService({ sources, backupDirectory: directory, engineVersion: 'test', logger: {} });
    stateA = { campaignId: 'w', value: 'backup-a' }; stateB = { campaignId: 'w', value: 'backup-b' };
    const created = await service.create('w', { requester: gm });
    const exported = await service.exportStored('w', created.backup.id, { requester: gm });
    stateA = { campaignId: 'w', value: 'atual-a' }; stateB = { campaignId: 'w', value: 'atual-b' };
    const inspected = await service.inspect('w', { requester: gm, contentBase64: exported.contentBase64 });
    fail = true;
    await assert.rejects(service.restore('w', { requester: gm, restoreToken: inspected.restoreToken, mode: 'REPLACE' }), (error) => error.code === 'BACKUP_RESTORE_FAILED');
    assert.equal(stateA.value, 'atual-a');
    assert.equal(stateB.value, 'atual-b');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
