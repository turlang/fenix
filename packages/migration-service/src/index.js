import { createHash, randomUUID } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export const CURRENT_DATA_SCHEMA_VERSION = 1;
const STATE_FILE_NAME = 'migration-state.json';
const SNAPSHOT_DIRECTORY_NAME = 'migrations';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function nowIso(clock = Date.now) {
  return new Date(clock()).toISOString();
}

function safeId(value, fallback = 'snapshot') {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function migrationError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeCampaignStore(value) {
  const source = ensureObject(value);
  if (source.campaigns && typeof source.campaigns === 'object' && !Array.isArray(source.campaigns)) {
    return { ...source, version: CURRENT_DATA_SCHEMA_VERSION, campaigns: source.campaigns };
  }

  const candidateKeys = Object.keys(source).filter((key) => !['version', 'updatedAt', 'createdAt'].includes(key));
  const campaignShapeKeys = ['facts', 'npcs', 'relationships', 'quests', 'items', 'documents', 'chunks', 'artifacts', 'blueprints', 'profiles', 'entries', 'proposals', 'audit'];
  const looksLikeSingleCampaign = typeof source.id === 'string' && campaignShapeKeys.some((key) => key in source);
  if (looksLikeSingleCampaign) {
    return {
      version: CURRENT_DATA_SCHEMA_VERSION,
      updatedAt: source.updatedAt ?? null,
      campaigns: { [safeId(source.id, 'default')]: source }
    };
  }

  const looksLikeCampaignMap = candidateKeys.length > 0 && candidateKeys.every((key) => {
    const entry = source[key];
    return entry && typeof entry === 'object' && !Array.isArray(entry);
  });

  return {
    version: CURRENT_DATA_SCHEMA_VERSION,
    updatedAt: source.updatedAt ?? null,
    campaigns: looksLikeCampaignMap
      ? Object.fromEntries(candidateKeys.map((key) => [key, source[key]]))
      : {}
  };
}

function normalizeNarrationStore(value) {
  if (Array.isArray(value)) return { version: CURRENT_DATA_SCHEMA_VERSION, records: value };
  const source = ensureObject(value);
  return {
    ...source,
    version: CURRENT_DATA_SCHEMA_VERSION,
    records: Array.isArray(source.records) ? source.records : []
  };
}

export const DEFAULT_DATA_SOURCES = Object.freeze([
  { id: 'narration-history', fileName: 'narration-history.json', normalize: normalizeNarrationStore },
  { id: 'campaign-memory', fileName: 'campaign-memory.json', normalize: normalizeCampaignStore },
  { id: 'adventure-library', fileName: 'adventure-library.json', normalize: normalizeCampaignStore },
  { id: 'generated-content', fileName: 'generated-content.json', normalize: normalizeCampaignStore },
  { id: 'map-blueprints', fileName: 'map-blueprints.json', normalize: normalizeCampaignStore },
  { id: 'voice-profiles', fileName: 'voice-profiles.json', normalize: normalizeCampaignStore },
  { id: 'tutor-history', fileName: 'tutor-history.json', normalize: normalizeCampaignStore },
  { id: 'automation-proposals', fileName: 'automation-proposals.json', normalize: normalizeCampaignStore }
]);

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, path);
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  try {
    return { raw, value: JSON.parse(raw) };
  } catch (cause) {
    throw migrationError('MIGRATION_INVALID_JSON', `O arquivo ${basename(path)} contém JSON inválido.`, {
      filePath: path,
      cause: cause.message
    });
  }
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export class MigrationService {
  constructor({
    dataDirectory = resolve(process.cwd(), 'data'),
    sources = DEFAULT_DATA_SOURCES,
    engineVersion = 'unknown',
    logger = console,
    clock = Date.now
  } = {}) {
    this.dataDirectory = resolve(dataDirectory);
    this.sources = sources.map((source) => ({ ...source, path: source.path ? resolve(source.path) : resolve(dataDirectory, source.fileName) }));
    this.engineVersion = engineVersion;
    this.logger = logger;
    this.clock = clock;
    this.statePath = join(this.dataDirectory, STATE_FILE_NAME);
    this.snapshotDirectory = join(this.dataDirectory, SNAPSHOT_DIRECTORY_NAME);
  }

  async readState() {
    if (!(await exists(this.statePath))) {
      return {
        schemaVersion: 0,
        engineVersion: null,
        updatedAt: null,
        history: []
      };
    }
    const { value } = await readJson(this.statePath);
    const source = ensureObject(value);
    return {
      schemaVersion: Number.isInteger(source.schemaVersion) ? source.schemaVersion : 0,
      engineVersion: source.engineVersion ?? null,
      updatedAt: source.updatedAt ?? null,
      history: Array.isArray(source.history) ? source.history.slice(-50) : []
    };
  }

  async inspect() {
    const state = await this.readState();
    const files = [];
    let changesRequired = state.schemaVersion !== CURRENT_DATA_SCHEMA_VERSION;

    for (const source of this.sources) {
      if (!(await exists(source.path))) {
        files.push({ id: source.id, fileName: source.fileName, status: 'MISSING', currentVersion: null, targetVersion: CURRENT_DATA_SCHEMA_VERSION });
        continue;
      }

      try {
        const { raw, value } = await readJson(source.path);
        const normalized = source.normalize(value);
        const currentVersion = Number.isInteger(value?.version) ? value.version : 0;
        const changed = stableJson(normalized) !== stableJson(value);
        if (changed || currentVersion !== CURRENT_DATA_SCHEMA_VERSION) changesRequired = true;
        files.push({
          id: source.id,
          fileName: source.fileName,
          status: changed ? 'NEEDS_MIGRATION' : 'READY',
          currentVersion,
          targetVersion: CURRENT_DATA_SCHEMA_VERSION,
          bytes: Buffer.byteLength(raw),
          sha256: sha256(raw)
        });
      } catch (error) {
        files.push({
          id: source.id,
          fileName: source.fileName,
          status: 'INVALID',
          currentVersion: null,
          targetVersion: CURRENT_DATA_SCHEMA_VERSION,
          error: error.message
        });
        changesRequired = true;
      }
    }

    return {
      engineVersion: this.engineVersion,
      schemaVersion: state.schemaVersion,
      targetSchemaVersion: CURRENT_DATA_SCHEMA_VERSION,
      changesRequired,
      dataDirectory: this.dataDirectory,
      files,
      updatedAt: state.updatedAt
    };
  }

  async createSnapshot({ label = 'pre-migration' } = {}) {
    await mkdir(this.snapshotDirectory, { recursive: true });
    const timestamp = nowIso(this.clock).replace(/[:.]/g, '-');
    const snapshotId = `${timestamp}-${safeId(label)}-${randomUUID().slice(0, 8)}`;
    const target = join(this.snapshotDirectory, snapshotId);
    await mkdir(target, { recursive: true });

    const files = [];
    for (const source of this.sources) {
      if (!(await exists(source.path))) {
        files.push({ id: source.id, fileName: source.fileName, existed: false });
        continue;
      }
      const destination = join(target, source.fileName);
      await cp(source.path, destination, { force: true });
      const raw = await readFile(source.path);
      files.push({ id: source.id, fileName: source.fileName, existed: true, bytes: raw.length, sha256: sha256(raw) });
    }

    if (await exists(this.statePath)) await cp(this.statePath, join(target, STATE_FILE_NAME), { force: true });
    const manifest = {
      format: 'mestre-orc-migration-snapshot',
      version: 1,
      snapshotId,
      label,
      engineVersion: this.engineVersion,
      schemaVersion: (await this.readState()).schemaVersion,
      createdAt: nowIso(this.clock),
      files
    };
    await atomicWrite(join(target, 'snapshot.json'), stableJson(manifest));
    return clone(manifest);
  }

  async migrate({ dryRun = false, createSnapshot = true, reason = 'startup' } = {}) {
    const inspection = await this.inspect();
    const invalid = inspection.files.filter((entry) => entry.status === 'INVALID');
    if (invalid.length) {
      throw migrationError('MIGRATION_SOURCE_INVALID', 'A migração foi interrompida porque existem arquivos persistentes inválidos.', { files: invalid });
    }

    if (!inspection.changesRequired) {
      return { changed: false, dryRun, inspection, snapshot: null, migratedFiles: [] };
    }

    const hasExistingData = inspection.files.some((entry) => entry.status !== 'MISSING');
    const snapshot = !dryRun && createSnapshot && hasExistingData ? await this.createSnapshot({ label: reason }) : null;
    const migratedFiles = [];

    for (const source of this.sources) {
      if (!(await exists(source.path))) continue;
      const { value } = await readJson(source.path);
      const normalized = source.normalize(value);
      const before = stableJson(value);
      const after = stableJson(normalized);
      if (before === after) continue;
      migratedFiles.push({ id: source.id, fileName: source.fileName, fromVersion: Number(value?.version) || 0, toVersion: CURRENT_DATA_SCHEMA_VERSION });
      if (!dryRun) await atomicWrite(source.path, after);
    }

    if (!dryRun) {
      const previous = await this.readState();
      const historyEntry = {
        id: randomUUID(),
        fromVersion: previous.schemaVersion,
        toVersion: CURRENT_DATA_SCHEMA_VERSION,
        engineVersion: this.engineVersion,
        reason,
        snapshotId: snapshot?.snapshotId ?? null,
        migratedFiles: migratedFiles.map((entry) => entry.fileName),
        appliedAt: nowIso(this.clock)
      };
      const state = {
        schemaVersion: CURRENT_DATA_SCHEMA_VERSION,
        engineVersion: this.engineVersion,
        updatedAt: historyEntry.appliedAt,
        history: [...previous.history, historyEntry].slice(-50)
      };
      await atomicWrite(this.statePath, stableJson(state));
    }

    return { changed: true, dryRun, inspection, snapshot, migratedFiles };
  }

  async listSnapshots() {
    if (!(await exists(this.snapshotDirectory))) return [];
    const entries = await readdir(this.snapshotDirectory, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(this.snapshotDirectory, entry.name, 'snapshot.json');
      try {
        const { value } = await readJson(manifestPath);
        snapshots.push(value);
      } catch {
        // Snapshot incompleto é ignorado; não deve bloquear os demais.
      }
    }
    return snapshots.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
  }

  async rollback(snapshotId) {
    const id = safeId(snapshotId, '');
    if (!id) throw migrationError('MIGRATION_SNAPSHOT_REQUIRED', 'Informe o snapshot que deve ser restaurado.');
    const sourceDirectory = join(this.snapshotDirectory, id);
    const manifestPath = join(sourceDirectory, 'snapshot.json');
    if (!(await exists(manifestPath))) throw migrationError('MIGRATION_SNAPSHOT_NOT_FOUND', 'Snapshot de migração não encontrado.', { snapshotId: id });
    const { value: manifest } = await readJson(manifestPath);
    if (manifest?.format !== 'mestre-orc-migration-snapshot') throw migrationError('MIGRATION_SNAPSHOT_INVALID', 'O snapshot selecionado é inválido.');

    const safety = await this.createSnapshot({ label: 'pre-rollback' });
    try {
      for (const file of manifest.files ?? []) {
        const destination = join(this.dataDirectory, file.fileName);
        if (file.existed) {
          await cp(join(sourceDirectory, file.fileName), destination, { force: true });
        } else {
          await rm(destination, { force: true });
        }
      }
      const priorState = join(sourceDirectory, STATE_FILE_NAME);
      if (await exists(priorState)) await cp(priorState, this.statePath, { force: true });
      else await rm(this.statePath, { force: true });
      return { rolledBack: true, snapshotId: id, safetySnapshotId: safety.snapshotId };
    } catch (cause) {
      this.logger.error?.('[Mestre Orc][Migration] rollback falhou', { snapshotId: id, message: cause.message });
      throw migrationError('MIGRATION_ROLLBACK_FAILED', 'Não foi possível restaurar o snapshot de migração.', { cause: cause.message, safetySnapshotId: safety.snapshotId });
    }
  }

  async verifyWritable() {
    await mkdir(this.dataDirectory, { recursive: true });
    const probe = join(this.dataDirectory, `.write-probe-${process.pid}-${Date.now()}`);
    await writeFile(probe, 'ok', { encoding: 'utf8', mode: 0o600 });
    const metadata = await stat(probe);
    await rm(probe, { force: true });
    return metadata.isFile();
  }
}

export function createMigrationServiceFromEnv({ env = process.env, engineVersion = 'unknown', logger = console } = {}) {
  const dataDirectory = resolve(process.cwd(), env.MESTRE_ORC_DATA_DIRECTORY || 'data');
  const paths = {
    'narration-history': env.MESTRE_ORC_NARRATION_MEMORY_FILE,
    'campaign-memory': env.MESTRE_ORC_CAMPAIGN_MEMORY_FILE,
    'adventure-library': env.ADVENTURE_LIBRARY_FILE,
    'generated-content': env.GENERATOR_ARCHIVE_FILE,
    'map-blueprints': env.MAP_BLUEPRINT_FILE,
    'voice-profiles': env.VOICE_PROFILE_FILE,
    'tutor-history': env.TUTOR_HISTORY_FILE,
    'automation-proposals': env.AUTOMATION_PROPOSALS_FILE
  };
  const sources = DEFAULT_DATA_SOURCES.map((source) => ({
    ...source,
    path: paths[source.id] ? resolve(paths[source.id]) : resolve(dataDirectory, source.fileName)
  }));
  return new MigrationService({ dataDirectory, sources, engineVersion, logger });
}

export const migrationInternals = {
  normalizeCampaignStore,
  normalizeNarrationStore,
  stableJson,
  sha256,
  STATE_FILE_NAME,
  SNAPSHOT_DIRECTORY_NAME
};
