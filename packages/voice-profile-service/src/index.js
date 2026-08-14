import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_VERSION = 1;
const DEFAULT_FILE = resolve(process.cwd(), process.env.VOICE_PROFILE_FILE || 'data/voice-profiles.json');
const PROVIDERS = new Set(['browser', 'openai', 'elevenlabs', 'compatible']);
const SPEAKER_TYPES = new Set(['NARRATOR', 'NPC']);

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function text(value, limit = 1000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function id(value, fallback = '') {
  const normalized = text(value, 200).replace(/[^A-Za-z0-9._:-]+/g, '-');
  return normalized || fallback;
}

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function emptyStore() {
  return { version: STORE_VERSION, campaigns: {} };
}

function emptyCampaign(campaignId) {
  return {
    id: id(campaignId, 'default'),
    profiles: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeProvider(value, fallback = 'browser') {
  const normalized = text(value, 30).toLowerCase();
  return PROVIDERS.has(normalized) ? normalized : fallback;
}

function normalizeSpeakerType(value, npcId = null) {
  const normalized = text(value, 30).toUpperCase();
  if (SPEAKER_TYPES.has(normalized)) return normalized;
  return npcId ? 'NPC' : 'NARRATOR';
}

function normalizeProfile(record = {}, existing = null) {
  const npcId = id(record.npcId ?? existing?.npcId) || null;
  const speakerType = normalizeSpeakerType(record.speakerType ?? existing?.speakerType, npcId);
  const profileId = id(record.id ?? record.profileId ?? existing?.id)
    || (speakerType === 'NARRATOR' ? 'narrator' : `npc:${npcId}`);
  if (speakerType === 'NPC' && !npcId) throw new TypeError('O perfil de NPC precisa de npcId.');

  const now = new Date().toISOString();
  const provider = normalizeProvider(record.provider ?? existing?.provider, 'browser');
  return {
    ...(existing ?? {}),
    id: profileId,
    speakerType,
    npcId,
    npcName: text(record.npcName ?? record.name ?? existing?.npcName, 300) || (speakerType === 'NARRATOR' ? 'Narrador' : 'NPC sem nome'),
    provider,
    voiceId: text(record.voiceId ?? existing?.voiceId, 300) || null,
    model: text(record.model ?? existing?.model, 300) || null,
    language: text(record.language ?? existing?.language, 30) || 'pt-BR',
    instructions: text(record.instructions ?? existing?.instructions, 2000) || null,
    speed: clamp(record.speed ?? existing?.speed, 0.25, 4, 1),
    stability: clamp(record.stability ?? existing?.stability, 0, 1, 0.5),
    similarityBoost: clamp(record.similarityBoost ?? existing?.similarityBoost, 0, 1, 0.75),
    style: clamp(record.style ?? existing?.style, 0, 1, 0),
    useSpeakerBoost: bool(record.useSpeakerBoost ?? existing?.useSpeakerBoost, true),
    enabled: bool(record.enabled ?? existing?.enabled, true),
    fallbackToBrowser: bool(record.fallbackToBrowser ?? existing?.fallbackToBrowser, true),
    disclosure: 'Voz gerada por inteligência artificial.',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function summarize(campaign) {
  const profiles = Object.values(campaign?.profiles ?? {}).sort((left, right) => {
    if (left.speakerType !== right.speakerType) return left.speakerType === 'NARRATOR' ? -1 : 1;
    return String(left.npcName).localeCompare(String(right.npcName), 'pt-BR');
  });
  return {
    campaignId: campaign?.id ?? 'default',
    count: profiles.length,
    narratorConfigured: profiles.some((entry) => entry.id === 'narrator'),
    profiles: clone(profiles),
    updatedAt: campaign?.updatedAt ?? null
  };
}

export class InMemoryVoiceProfileService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.store = emptyStore();
  }

  campaign(campaignId, { create = true } = {}) {
    const key = id(campaignId, 'default');
    if (!this.store.campaigns[key] && create) this.store.campaigns[key] = emptyCampaign(key);
    return this.store.campaigns[key] ?? null;
  }

  async list(campaignId) {
    return summarize(this.campaign(campaignId));
  }

  async upsert(campaignId, record = {}) {
    const campaign = this.campaign(campaignId);
    const candidate = normalizeProfile(record);
    const existing = campaign.profiles[candidate.id] ?? null;
    const profile = normalizeProfile(record, existing);
    campaign.profiles[profile.id] = profile;
    campaign.updatedAt = profile.updatedAt;
    await this.persist();
    return { profile: clone(profile), snapshot: summarize(campaign) };
  }

  async remove(campaignId, profileId) {
    const campaign = this.campaign(campaignId);
    const key = id(profileId);
    const removed = Boolean(key && campaign.profiles[key]);
    if (removed) {
      delete campaign.profiles[key];
      campaign.updatedAt = new Date().toISOString();
      await this.persist();
    }
    return { removed, snapshot: summarize(campaign) };
  }

  async resolve(campaignId, { profileId = null, npcId = null, npcName = null, speakerType = null } = {}) {
    const campaign = this.campaign(campaignId, { create: false });
    if (!campaign) return null;
    const profiles = Object.values(campaign.profiles ?? {});
    const explicit = id(profileId);
    if (explicit && campaign.profiles[explicit]?.enabled) return clone(campaign.profiles[explicit]);
    const normalizedNpcId = id(npcId);
    if (normalizedNpcId) {
      const direct = campaign.profiles[`npc:${normalizedNpcId}`]
        ?? profiles.find((entry) => entry.npcId === normalizedNpcId);
      if (direct?.enabled) return clone(direct);
    }
    const normalizedName = text(npcName, 300).toLocaleLowerCase('pt-BR');
    if (normalizedName) {
      const byName = profiles.find((entry) => entry.enabled && entry.speakerType === 'NPC'
        && String(entry.npcName).toLocaleLowerCase('pt-BR') === normalizedName);
      if (byName) return clone(byName);
    }
    if (String(speakerType ?? '').toUpperCase() === 'NPC') return null;
    const narrator = campaign.profiles.narrator;
    return narrator?.enabled ? clone(narrator) : null;
  }

  async persist() {}
}

export class FileVoiceProfileService extends InMemoryVoiceProfileService {
  constructor({ filePath = DEFAULT_FILE, logger = console } = {}) {
    super({ logger });
    this.filePath = resolve(filePath);
    this.load();
  }

  load() {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.campaigns !== 'object') return;
      this.store = { version: STORE_VERSION, campaigns: parsed.campaigns };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][VoiceProfiles] arquivo inválido; iniciando memória vazia', { message: error.message });
      this.store = emptyStore();
    }
  }

  async persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}

export function createVoiceProfileServiceFromEnv({ logger = console, env = process.env } = {}) {
  return new FileVoiceProfileService({ filePath: env.VOICE_PROFILE_FILE || resolve(process.cwd(), env.MESTRE_ORC_DATA_DIRECTORY || 'data', 'voice-profiles.json'), logger });
}

export const voiceProfileInternals = {
  normalizeProfile,
  normalizeProvider,
  summarize,
  PROVIDERS: [...PROVIDERS]
};
