import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

const FORMAT = 'mestre-orc-campaign-backup';
const FORMAT_VERSION = 1;
const INDEX_VERSION = 1;
const DEFAULT_MAX_BACKUPS = 20;
const MAX_BUNDLE_BYTES = 24 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 96 * 1024 * 1024;
const TOKEN_TTL_MS = 10 * 60 * 1000;
const SENSITIVE_KEY = /^(api[-_]?key|authorization|token|access[-_]?token|refresh[-_]?token|execution[-_]?token|rollback[-_]?token|secret|password|passphrase|credential|private[-_]?key)$/i;

function clone(value) { return value == null ? value : structuredClone(value); }
function nowIso() { return new Date().toISOString(); }
function safeId(value, fallback = '') {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 180);
  return normalized || fallback;
}
function cleanText(value, max = 500) { return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max); }
function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex'); }
function secureEqualHex(left, right) {
  try {
    const a = Buffer.from(String(left), 'hex');
    const b = Buffer.from(String(right), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch { return false; }
}
function requireGm(requester) {
  if (!requester?.isGM) {
    const error = new Error('Somente um mestre pode criar, exportar ou restaurar backups.');
    error.code = 'BACKUP_GM_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
  return { id: safeId(requester.id, 'gm'), name: cleanText(requester.name, 200) || 'Mestre', isGM: true };
}
function sanitize(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 10000).map((entry) => sanitize(entry, depth + 1));
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 20000)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitize(entry, depth + 1);
  }
  return output;
}
function mergeValues(current, incoming) {
  if (incoming == null) return clone(incoming);
  if (Array.isArray(incoming)) {
    const existing = Array.isArray(current) ? current : [];
    const keyed = incoming.every((entry) => entry && typeof entry === 'object' && (entry.id || entry.key));
    if (!keyed) {
      const seen = new Set();
      return [...existing, ...incoming].filter((entry) => {
        const fingerprint = JSON.stringify(entry);
        if (seen.has(fingerprint)) return false;
        seen.add(fingerprint);
        return true;
      }).map(clone);
    }
    const map = new Map();
    for (const entry of existing) map.set(String(entry.id ?? entry.key), clone(entry));
    for (const entry of incoming) {
      const key = String(entry.id ?? entry.key);
      map.set(key, mergeValues(map.get(key), entry));
    }
    return [...map.values()];
  }
  if (typeof incoming === 'object') {
    const result = current && typeof current === 'object' && !Array.isArray(current) ? clone(current) : {};
    for (const [key, value] of Object.entries(incoming)) result[key] = mergeValues(result[key], value);
    return result;
  }
  return incoming;
}
function remapCampaignReferences(value, sourceId, targetId, keyName = '') {
  if (Array.isArray(value)) return value.map((entry) => remapCampaignReferences(entry, sourceId, targetId));
  if (!value || typeof value !== 'object') {
    if (/^(campaignId|worldId)$/i.test(keyName) && String(value ?? '') === sourceId) return targetId;
    return value;
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) output[key] = remapCampaignReferences(entry, sourceId, targetId, key);
  if (typeof output.campaignId === 'string') output.campaignId = targetId;
  if (typeof output.worldId === 'string') output.worldId = targetId;
  if (typeof output.id === 'string' && output.id === sourceId && ('campaignId' in output || 'createdAt' in output)) output.id = targetId;
  return output;
}
function strictBase64(value) {
  const normalized = String(value ?? '').replace(/\s+/g, '');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw backupError('BACKUP_BASE64_INVALID', 'Arquivo de backup inválido.', 400);
  const buffer = Buffer.from(normalized, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) throw backupError('BACKUP_BASE64_INVALID', 'Arquivo de backup inválido.', 400);
  if (buffer.length > MAX_BUNDLE_BYTES) throw backupError('BACKUP_TOO_LARGE', 'O backup excede o limite permitido.', 413);
  return buffer;
}
function backupError(code, message, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}
function requesterSummary(requester) { return { id: requester.id, name: requester.name }; }
function countFragment(fragment) {
  if (fragment == null) return 0;
  if (Array.isArray(fragment)) return fragment.length;
  if (typeof fragment !== 'object') return 1;
  const preferred = ['facts','npcs','relationships','quests','items','documents','chunks','artifacts','blueprints','profiles','entries','proposals','audit','recentEvents'];
  const count = preferred.reduce((total, key) => total + (Array.isArray(fragment[key]) ? fragment[key].length : fragment[key] && typeof fragment[key] === 'object' ? Object.keys(fragment[key]).length : 0), 0);
  return count || Object.keys(fragment).length;
}
function createEnvelope(payload, { passphrase = '', metadata = {} } = {}) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const compressed = gzipSync(raw, { level: 9 });
  const base = { format: FORMAT, formatVersion: FORMAT_VERSION, createdAt: nowIso(), compression: 'gzip', metadata };
  if (passphrase) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(String(passphrase), salt, 32);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
    return {
      ...base,
      encrypted: true,
      encryption: 'aes-256-gcm+scrypt',
      salt: salt.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64'),
      contentBase64: ciphertext.toString('base64'), sha256: sha256(ciphertext)
    };
  }
  return { ...base, encrypted: false, contentBase64: compressed.toString('base64'), sha256: sha256(compressed) };
}
function decodeEnvelope(envelope, passphrase = '') {
  if (!envelope || envelope.format !== FORMAT || envelope.formatVersion !== FORMAT_VERSION) throw backupError('BACKUP_FORMAT_UNSUPPORTED', 'Formato ou versão de backup incompatível.', 400);
  const content = strictBase64(envelope.contentBase64);
  if (!secureEqualHex(envelope.sha256, sha256(content))) throw backupError('BACKUP_INTEGRITY_FAILED', 'A verificação de integridade do backup falhou.', 400);
  let compressed = content;
  if (envelope.encrypted) {
    if (!passphrase) throw backupError('BACKUP_PASSPHRASE_REQUIRED', 'Este backup está criptografado e exige senha.', 401);
    try {
      const salt = strictBase64(envelope.salt);
      const iv = strictBase64(envelope.iv);
      const authTag = strictBase64(envelope.authTag);
      const key = scryptSync(String(passphrase), salt, 32);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      compressed = Buffer.concat([decipher.update(content), decipher.final()]);
    } catch (error) {
      if (error?.code?.startsWith?.('BACKUP_')) throw error;
      throw backupError('BACKUP_PASSPHRASE_INVALID', 'Senha incorreta ou arquivo criptografado corrompido.', 401);
    }
  }
  try {
    const raw = gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    const payload = JSON.parse(raw.toString('utf8'));
    if (!payload || payload.format !== FORMAT || payload.formatVersion !== FORMAT_VERSION || !payload.campaignId || typeof payload.sources !== 'object') {
      throw new Error('payload inválido');
    }
    return sanitize(payload);
  } catch (error) {
    if (error?.code?.startsWith?.('BACKUP_')) throw error;
    throw backupError('BACKUP_CONTENT_INVALID', 'O conteúdo interno do backup é inválido ou excede o limite permitido.', 400);
  }
}

export class BackupService {
  constructor({ sources = [], backupDirectory = resolve(process.cwd(), 'data/backups'), engineVersion = 'unknown', maxBackups = DEFAULT_MAX_BACKUPS, logger = console, clock = Date.now } = {}) {
    this.sources = sources.filter((source) => source?.id && source?.readCampaign && source?.writeCampaign);
    this.backupDirectory = resolve(backupDirectory);
    this.engineVersion = engineVersion;
    this.maxBackups = Math.max(3, Math.min(100, Number(maxBackups) || DEFAULT_MAX_BACKUPS));
    this.logger = logger;
    this.clock = clock;
    this.tokens = new Map();
    this.operationQueue = Promise.resolve();
  }

  async serialize(operation) {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.catch(() => undefined);
    return run;
  }

  cleanupTokens() {
    const now = this.clock();
    for (const [token, entry] of this.tokens) if (entry.expiresAt <= now || entry.used) this.tokens.delete(token);
  }

  async capture(campaignId, { label = '', requester = null, automatic = false } = {}) {
    const id = safeId(campaignId, 'default');
    const sources = {};
    const manifest = [];
    for (const source of this.sources) {
      const fragment = sanitize(await source.readCampaign(id));
      sources[source.id] = fragment;
      manifest.push({ id: source.id, label: source.label ?? source.id, count: countFragment(fragment) });
    }
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      engineVersion: this.engineVersion,
      campaignId: id,
      createdAt: nowIso(),
      label: cleanText(label, 200) || (automatic ? 'Snapshot automático pré-restauração' : 'Backup da campanha'),
      automatic: Boolean(automatic),
      createdBy: requester ? requesterSummary(requester) : null,
      manifest,
      sources
    };
  }

  createBundle(payload, { passphrase = '' } = {}) {
    const metadata = {
      campaignId: payload.campaignId,
      createdAt: payload.createdAt,
      engineVersion: payload.engineVersion,
      label: payload.label,
      automatic: payload.automatic,
      sourceCount: payload.manifest.length,
      itemCount: payload.manifest.reduce((sum, entry) => sum + entry.count, 0)
    };
    const envelope = createEnvelope(payload, { passphrase: String(passphrase ?? ''), metadata });
    const buffer = Buffer.from(`${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
    if (buffer.length > MAX_BUNDLE_BYTES) throw backupError('BACKUP_TOO_LARGE', 'O backup excede o limite permitido.', 413);
    return { envelope, buffer, metadata: { ...metadata, encrypted: envelope.encrypted, bytes: buffer.length } };
  }

  campaignDirectory(campaignId) { return join(this.backupDirectory, safeId(campaignId, 'default')); }

  async create(campaignId, options = {}) {
    const gm = requireGm(options.requester);
    return this.serialize(() => this.createUnlocked(campaignId, { ...options, requester: gm }));
  }

  async createUnlocked(campaignId, { requester, label = '', passphrase = '', automatic = false } = {}) {
    const payload = await this.capture(campaignId, { label, requester, automatic });
    const { buffer, metadata } = this.createBundle(payload, { passphrase });
    const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const directory = this.campaignDirectory(payload.campaignId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const filePath = join(directory, `${backupId}.mobackup`);
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, buffer, { mode: 0o600 });
    renameSync(temporary, filePath);
    await this.prune(payload.campaignId);
    return { backup: { id: backupId, ...metadata, label: payload.label, automatic, fileName: `${backupId}.mobackup` } };
  }

  async prune(campaignId) {
    const entries = this.listFiles(campaignId);
    for (const entry of entries.slice(this.maxBackups)) rmSync(entry.filePath, { force: true });
  }

  listFiles(campaignId) {
    const directory = this.campaignDirectory(campaignId);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).filter((name) => name.endsWith('.mobackup')).map((name) => {
      const filePath = join(directory, name);
      try {
        const envelope = JSON.parse(readFileSync(filePath, 'utf8'));
        const stat = statSync(filePath);
        return {
          id: name.replace(/\.mobackup$/, ''), filePath, fileName: name, bytes: stat.size,
          encrypted: Boolean(envelope.encrypted), createdAt: envelope.metadata?.createdAt ?? stat.mtime.toISOString(),
          engineVersion: envelope.metadata?.engineVersion ?? null, label: envelope.metadata?.label ?? 'Backup',
          automatic: Boolean(envelope.metadata?.automatic), sourceCount: Number(envelope.metadata?.sourceCount) || 0,
          itemCount: Number(envelope.metadata?.itemCount) || 0
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async list(campaignId, { requester } = {}) {
    requireGm(requester);
    return { campaignId: safeId(campaignId, 'default'), backups: this.listFiles(campaignId).map(({ filePath, ...entry }) => entry) };
  }

  async exportStored(campaignId, backupId, { requester } = {}) {
    requireGm(requester);
    const id = safeId(backupId);
    const entry = this.listFiles(campaignId).find((item) => item.id === id);
    if (!entry) throw backupError('BACKUP_NOT_FOUND', 'Backup não encontrado.', 404);
    const buffer = readFileSync(entry.filePath);
    return { backup: { ...entry, filePath: undefined }, contentBase64: buffer.toString('base64') };
  }

  async remove(campaignId, backupId, { requester } = {}) {
    requireGm(requester);
    const id = safeId(backupId);
    const entry = this.listFiles(campaignId).find((item) => item.id === id);
    if (!entry) return { removed: false };
    rmSync(entry.filePath, { force: true });
    return { removed: true, backupId: id };
  }

  parseBundle(contentBase64, passphrase = '') {
    const fileBuffer = strictBase64(contentBase64);
    let envelope;
    try { envelope = JSON.parse(fileBuffer.toString('utf8')); }
    catch { throw backupError('BACKUP_FILE_INVALID', 'O arquivo selecionado não é um backup válido.', 400); }
    return { envelope, payload: decodeEnvelope(envelope, String(passphrase ?? '')), fileBuffer };
  }

  async inspect(campaignId, { requester, contentBase64, passphrase = '', allowCampaignRemap = false } = {}) {
    const gm = requireGm(requester);
    this.cleanupTokens();
    const targetCampaignId = safeId(campaignId, 'default');
    const { envelope, payload, fileBuffer } = this.parseBundle(contentBase64, passphrase);
    const sourceCampaignId = safeId(payload.campaignId, 'default');
    if (sourceCampaignId !== targetCampaignId && !allowCampaignRemap) {
      throw backupError('BACKUP_CAMPAIGN_MISMATCH', 'O backup pertence a outra campanha. Ative a remapeação explicitamente para continuar.', 409, { sourceCampaignId, targetCampaignId });
    }
    const token = randomUUID();
    const expiresAt = this.clock() + TOKEN_TTL_MS;
    this.tokens.set(token, { token, expiresAt, used: false, gmId: gm.id, targetCampaignId, sourceCampaignId, payload, digest: sha256(fileBuffer), allowCampaignRemap: Boolean(allowCampaignRemap) });
    return {
      restoreToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      preview: {
        sourceCampaignId, targetCampaignId, remapped: sourceCampaignId !== targetCampaignId,
        createdAt: payload.createdAt, engineVersion: payload.engineVersion, label: payload.label,
        encrypted: Boolean(envelope.encrypted), manifest: payload.manifest ?? [],
        sourceCount: Object.keys(payload.sources ?? {}).length,
        itemCount: (payload.manifest ?? []).reduce((sum, entry) => sum + Number(entry.count || 0), 0)
      }
    };
  }

  async restore(campaignId, { requester, restoreToken, mode = 'MERGE' } = {}) {
    const gm = requireGm(requester);
    this.cleanupTokens();
    const token = this.tokens.get(String(restoreToken ?? ''));
    if (!token || token.used || token.expiresAt <= this.clock()) throw backupError('BACKUP_RESTORE_TOKEN_INVALID', 'A confirmação de restauração expirou ou já foi utilizada.', 409);
    const targetCampaignId = safeId(campaignId, 'default');
    if (token.gmId !== gm.id || token.targetCampaignId !== targetCampaignId) throw backupError('BACKUP_RESTORE_TOKEN_INVALID', 'A confirmação não pertence a este mestre ou campanha.', 403);
    const normalizedMode = String(mode ?? '').toUpperCase();
    if (!['MERGE', 'REPLACE'].includes(normalizedMode)) throw backupError('BACKUP_RESTORE_MODE_INVALID', 'Modo de restauração inválido.', 400);
    token.used = true;

    return this.serialize(async () => {
      const automatic = await this.createUnlocked(targetCampaignId, { requester: gm, label: `Pré-restauração ${normalizedMode}`, automatic: true });
      const previous = {};
      const restored = [];
      try {
        for (const source of this.sources) {
          previous[source.id] = await source.readCampaign(targetCampaignId);
          if (!(source.id in token.payload.sources)) continue;
          const incoming = remapCampaignReferences(token.payload.sources[source.id], token.sourceCampaignId, targetCampaignId);
          if (normalizedMode === 'MERGE' && incoming == null) continue;
          const next = normalizedMode === 'REPLACE' ? incoming : mergeValues(previous[source.id], incoming);
          await source.writeCampaign(targetCampaignId, sanitize(next), { mode: normalizedMode });
          restored.push({ id: source.id, count: countFragment(next) });
        }
      } catch (error) {
        for (const source of [...this.sources].reverse()) {
          if (!(source.id in previous)) continue;
          try { await source.writeCampaign(targetCampaignId, previous[source.id], { mode: 'REPLACE' }); }
          catch (rollbackError) { this.logger.error?.('[Mestre Orc][Backup] falha no rollback transacional', { source: source.id, message: rollbackError.message }); }
        }
        throw backupError('BACKUP_RESTORE_FAILED', 'A restauração falhou e os dados anteriores foram reaplicados.', 500, { cause: error.message });
      }
      return {
        restored: true, mode: normalizedMode, campaignId: targetCampaignId,
        sourceCampaignId: token.sourceCampaignId, sources: restored,
        automaticBackup: automatic.backup,
        restoredAt: nowIso()
      };
    });
  }
}

export function createCampaignMapSource({ id, label, service, read = 'loadStore', write = 'saveStore' }) {
  return {
    id, label,
    async readCampaign(campaignId) {
      const store = await service[read]();
      return clone(store?.campaigns?.[campaignId] ?? null);
    },
    async writeCampaign(campaignId, fragment) {
      const store = clone(await service[read]()) ?? { version: 1, campaigns: {} };
      store.campaigns ??= {};
      if (fragment == null) delete store.campaigns[campaignId];
      else store.campaigns[campaignId] = clone(fragment);
      store.updatedAt = nowIso();
      await service[write](store);
    }
  };
}

export function createVoiceProfileSource(service) {
  return {
    id: 'voiceProfiles', label: 'Perfis de voz',
    async readCampaign(campaignId) { return clone(service.store?.campaigns?.[campaignId] ?? null); },
    async writeCampaign(campaignId, fragment) {
      service.store ??= { version: 1, campaigns: {} };
      service.store.campaigns ??= {};
      if (fragment == null) delete service.store.campaigns[campaignId];
      else service.store.campaigns[campaignId] = clone(fragment);
      await service.persist();
    }
  };
}

export function createNarrationHistorySource(service) {
  return {
    id: 'narrationHistory', label: 'Histórico de narração',
    readCampaign: (campaignId) => service.exportCampaign(campaignId),
    writeCampaign: (campaignId, fragment) => service.importCampaign(campaignId, Array.isArray(fragment) ? fragment : [], { mode: 'REPLACE' })
  };
}

export function createBackupServiceFromEnv({ services, engineVersion = 'unknown', logger = console, env = process.env } = {}) {
  const sources = [
    createCampaignMapSource({ id: 'campaignMemory', label: 'Memória da campanha', service: services.campaignMemory, read: 'readDatabase', write: 'writeDatabase' }),
    createCampaignMapSource({ id: 'adventureLibrary', label: 'Biblioteca da aventura', service: services.adventureLibrary }),
    createCampaignMapSource({ id: 'generatedContent', label: 'Conteúdo gerado', service: services.generatorService }),
    createCampaignMapSource({ id: 'mapBlueprints', label: 'Mapas e Scenes', service: services.mapService }),
    createVoiceProfileSource(services.voiceProfileService),
    createCampaignMapSource({ id: 'tutorHistory', label: 'Histórico dos tutores', service: services.tutorService }),
    createCampaignMapSource({ id: 'automations', label: 'Automações e auditoria', service: services.automationService }),
    createNarrationHistorySource(services.narrationMemory)
  ];
  return new BackupService({
    sources,
    backupDirectory: env.BACKUP_DIRECTORY || resolve(process.cwd(), 'data/backups'),
    engineVersion,
    maxBackups: Number(env.BACKUP_RETENTION_PER_CAMPAIGN) || DEFAULT_MAX_BACKUPS,
    logger
  });
}

export const BackupModes = ['MERGE', 'REPLACE'];
export const backupInternals = { createEnvelope, decodeEnvelope, mergeValues, remapCampaignReferences, sanitize, countFragment, FORMAT, FORMAT_VERSION };
