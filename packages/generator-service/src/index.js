import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const STORE_VERSION = 1;
const DEFAULT_FILE = resolve(process.cwd(), process.env.GENERATOR_ARCHIVE_FILE || 'data/generated-content.json');
const ARTIFACT_TYPES = new Set(['ADVENTURE', 'NPC', 'DUNGEON']);
const ARTIFACT_STATUSES = new Set(['ARCHIVED', 'ACTIVE']);
const DEFAULT_SIMILARITY_THRESHOLD = 0.62;
const DEFAULT_MAX_ATTEMPTS = 3;

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function cleanText(value, limit = 4000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, limit);
}

function compactText(value, limit = 1000) {
  return cleanText(value, limit).replace(/\s+/g, ' ').trim();
}

function safeId(value, fallback = '') {
  const normalized = compactText(value, 200).replace(/[^A-Za-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function normalizeType(value) {
  const type = compactText(value, 30).toUpperCase();
  if (!ARTIFACT_TYPES.has(type)) throw new TypeError('Tipo de gerador inválido. Use ADVENTURE, NPC ou DUNGEON.');
  return type;
}

function normalizeStatus(value, fallback = 'ARCHIVED') {
  const status = compactText(value, 30).toUpperCase();
  return ARTIFACT_STATUSES.has(status) ? status : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, number));
}

function emptyStore() {
  return { version: STORE_VERSION, campaigns: {} };
}

function emptyCampaign(campaignId) {
  const now = new Date().toISOString();
  return {
    id: safeId(campaignId, 'default'),
    artifacts: {},
    sequence: { ADVENTURE: 0, NPC: 0, DUNGEON: 0 },
    createdAt: now,
    updatedAt: now
  };
}

function normalizeTokens(value) {
  return [...new Set(String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 2))];
}

function jaccardSimilarity(left, right) {
  const leftTokens = new Set(normalizeTokens(left));
  const rightTokens = new Set(normalizeTokens(right));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = leftTokens.size + rightTokens.size - intersection;
  return union ? intersection / union : 0;
}

function artifactComparisonText(artifact = {}) {
  return [
    artifact.title,
    artifact.summary,
    ...(artifact.tags ?? []),
    artifact.metadata?.hook,
    artifact.metadata?.role,
    artifact.metadata?.theme,
    artifact.content
  ].filter(Boolean).join('\n').slice(0, 12000);
}

function artifactSignature(artifact = {}) {
  return createHash('sha256').update(artifactComparisonText(artifact)).digest('hex');
}

function stripCodeFence(value) {
  const text = cleanText(value, 200000);
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : text;
}

function parseGeneratedPayload(value) {
  if (value && typeof value === 'object') return clone(value);
  const text = stripCodeFence(value);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const error = new Error('O provedor não retornou um artefato estruturado válido.');
    error.code = 'GENERATOR_INVALID_RESPONSE';
    throw error;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    const error = new Error('O JSON retornado pelo gerador é inválido.', { cause });
    error.code = 'GENERATOR_INVALID_RESPONSE';
    throw error;
  }
}

function normalizeTags(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(',');
  return [...new Set(entries.map((entry) => compactText(entry, 80).toLocaleLowerCase('pt-BR')).filter(Boolean))].slice(0, 20);
}

function normalizeMetadata(type, metadata = {}) {
  const common = {
    system: compactText(metadata.system, 120) || null,
    tone: compactText(metadata.tone, 200) || null,
    levelRange: compactText(metadata.levelRange, 80) || null,
    playerCount: clampInteger(metadata.playerCount, 1, 20, null)
  };
  if (type === 'NPC') {
    return {
      ...common,
      name: compactText(metadata.name, 300) || null,
      npcId: safeId(metadata.npcId) || null,
      role: compactText(metadata.role, 200) || null,
      ancestry: compactText(metadata.ancestry, 160) || null,
      occupation: compactText(metadata.occupation, 200) || null,
      motivation: compactText(metadata.motivation, 1000) || null,
      secret: compactText(metadata.secret, 1500) || null,
      voiceDirection: compactText(metadata.voiceDirection, 1000) || null
    };
  }
  if (type === 'DUNGEON') {
    return {
      ...common,
      theme: compactText(metadata.theme, 300) || null,
      roomCount: clampInteger(metadata.roomCount, 1, 200, null),
      levels: clampInteger(metadata.levels, 1, 20, 1),
      objective: compactText(metadata.objective, 1000) || null,
      entrance: compactText(metadata.entrance, 500) || null
    };
  }
  return {
    ...common,
    hook: compactText(metadata.hook, 1000) || null,
    estimatedSessions: clampInteger(metadata.estimatedSessions, 1, 100, null),
    structure: compactText(metadata.structure, 500) || null
  };
}

function normalizeGeneratedArtifact({ type, raw, brief, options, generationNumber, attempt }) {
  const payload = parseGeneratedPayload(raw);
  const title = compactText(payload.title ?? payload.name, 300);
  const summary = compactText(payload.summary ?? payload.synopsis, 1800);
  const content = cleanText(payload.content ?? payload.markdown ?? payload.body, 120000);
  if (!title || title.length < 3) throw Object.assign(new Error('A geração não possui título válido.'), { code: 'GENERATOR_INVALID_RESPONSE' });
  if (!summary || summary.length < 20) throw Object.assign(new Error('A geração não possui resumo suficiente.'), { code: 'GENERATOR_INVALID_RESPONSE' });
  if (!content || content.length < 200) throw Object.assign(new Error('A geração não possui conteúdo suficiente.'), { code: 'GENERATOR_INVALID_RESPONSE' });
  const now = new Date().toISOString();
  const artifact = {
    id: randomUUID(),
    type,
    status: 'ARCHIVED',
    title,
    summary,
    tags: normalizeTags(payload.tags),
    content,
    metadata: normalizeMetadata(type, { ...(options ?? {}), ...(payload.metadata ?? {}) }),
    source: {
      brief: compactText(brief, 5000),
      options: clone(options ?? {}),
      attempt,
      generationNumber
    },
    integration: null,
    createdAt: now,
    updatedAt: now
  };
  artifact.signature = artifactSignature(artifact);
  return artifact;
}

function similarityAgainstHistory(candidate, artifacts = []) {
  const candidateText = artifactComparisonText(candidate);
  let closest = null;
  for (const artifact of artifacts) {
    const exact = candidate.signature === artifact.signature;
    const similarity = exact ? 1 : jaccardSimilarity(candidateText, artifactComparisonText(artifact));
    if (!closest || similarity > closest.similarity) closest = { artifact, similarity, exact };
  }
  return closest;
}

function publicArtifact(artifact, { includeContent = false } = {}) {
  if (!artifact) return null;
  const result = clone(artifact);
  if (!includeContent) delete result.content;
  return result;
}

function summarizeCampaign(campaign) {
  const artifacts = Object.values(campaign?.artifacts ?? {});
  const byType = { ADVENTURE: 0, NPC: 0, DUNGEON: 0 };
  const byStatus = { ARCHIVED: 0, ACTIVE: 0 };
  for (const artifact of artifacts) {
    byType[artifact.type] = (byType[artifact.type] ?? 0) + 1;
    byStatus[artifact.status] = (byStatus[artifact.status] ?? 0) + 1;
  }
  return {
    campaignId: campaign?.id ?? 'default',
    count: artifacts.length,
    counts: { byType, byStatus },
    updatedAt: campaign?.updatedAt ?? null,
    artifacts: artifacts
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .map((artifact) => publicArtifact(artifact))
  };
}

function historyForPrompt(artifacts, type, limit = 30) {
  return artifacts
    .filter((artifact) => artifact.type === type)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit)
    .map((artifact) => ({
      id: artifact.id,
      title: artifact.title,
      summary: artifact.summary,
      tags: artifact.tags,
      signature: artifact.signature.slice(0, 16)
    }));
}

export class InMemoryGeneratorService {
  constructor({ narrator, campaignMemory = null, adventureLibrary = null, logger = console, similarityThreshold = DEFAULT_SIMILARITY_THRESHOLD, maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
    this.narrator = narrator;
    this.campaignMemory = campaignMemory;
    this.adventureLibrary = adventureLibrary;
    this.logger = logger;
    this.similarityThreshold = Math.max(0.2, Math.min(0.95, Number(similarityThreshold) || DEFAULT_SIMILARITY_THRESHOLD));
    this.maxAttempts = clampInteger(maxAttempts, 1, 8, DEFAULT_MAX_ATTEMPTS);
    this.store = emptyStore();
    this.writeChain = Promise.resolve();
    this.generationChains = new Map();
  }

  async loadStore() { return this.store; }
  async saveStore(store) { this.store = store; }

  async mutate(operation) {
    const next = this.writeChain.then(async () => {
      const store = await this.loadStore();
      const result = await operation(store);
      await this.saveStore(store);
      return clone(result);
    });
    this.writeChain = next.catch(() => {});
    return next;
  }

  async list(campaignId, { type = null, status = null } = {}) {
    const key = safeId(campaignId, 'default');
    const store = await this.loadStore();
    const campaign = store.campaigns[key] ?? emptyCampaign(key);
    const snapshot = summarizeCampaign(campaign);
    if (!type && !status) return snapshot;
    const normalizedType = type ? normalizeType(type) : null;
    const normalizedStatus = status ? normalizeStatus(status) : null;
    return {
      ...snapshot,
      artifacts: snapshot.artifacts.filter((entry) => (!normalizedType || entry.type === normalizedType) && (!normalizedStatus || entry.status === normalizedStatus))
    };
  }

  async get(campaignId, artifactId) {
    const key = safeId(campaignId, 'default');
    const store = await this.loadStore();
    return publicArtifact(store.campaigns[key]?.artifacts?.[safeId(artifactId)] ?? null, { includeContent: true });
  }

  async generate(campaignId, input = {}) {
    const key = safeId(campaignId, 'default');
    const previous = this.generationChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => this.generateUnlocked(campaignId, input));
    this.generationChains.set(key, current);
    try {
      return await current;
    } finally {
      if (this.generationChains.get(key) === current) this.generationChains.delete(key);
    }
  }

  async generateUnlocked(campaignId, input = {}) {
    if (!this.narrator || typeof this.narrator.generateArtifact !== 'function') {
      const error = new Error('Nenhum provedor de IA com suporte ao gerador está configurado.');
      error.code = 'GENERATOR_AI_NOT_CONFIGURED';
      error.statusCode = 503;
      throw error;
    }
    const key = safeId(campaignId, 'default');
    const type = normalizeType(input.type);
    const brief = compactText(input.brief, 5000);
    if (brief.length < 10) throw new TypeError('Descreva o que deve ser gerado com pelo menos 10 caracteres.');
    const options = {
      system: compactText(input.system, 120) || 'D&D 5e',
      tone: compactText(input.tone, 200) || 'medieval sombrio e cinematográfico',
      levelRange: compactText(input.levelRange, 80) || null,
      playerCount: clampInteger(input.playerCount, 1, 20, null),
      length: compactText(input.length, 40).toUpperCase() || 'MEDIUM',
      includeSecrets: input.includeSecrets !== false,
      constraints: compactText(input.constraints, 3000) || null
    };

    const store = await this.loadStore();
    const campaign = store.campaigns[key] ?? emptyCampaign(key);
    const allArtifacts = Object.values(campaign.artifacts ?? {});
    const typeArtifacts = allArtifacts.filter((artifact) => artifact.type === type);
    const generationNumber = Number(campaign.sequence?.[type] ?? 0) + 1;
    let lastRepetition = null;
    let lastInvalid = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      let raw;
      try {
        raw = await this.narrator.generateArtifact({
          type,
          brief,
          options,
          generationNumber,
          attempt,
          history: historyForPrompt(allArtifacts, type),
          rejection: lastRepetition ? {
            title: lastRepetition.artifact.title,
            similarity: Number(lastRepetition.similarity.toFixed(3)),
            instruction: 'Crie uma premissa, estrutura, personagens, conflitos e imagens centrais claramente diferentes.'
          } : null
        });
      } catch (error) {
        throw error;
      }

      let candidate;
      try {
        candidate = normalizeGeneratedArtifact({ type, raw, brief, options, generationNumber, attempt });
      } catch (error) {
        lastInvalid = error;
        this.logger.warn?.('[Mestre Orc][Generator] resposta inválida; repetindo geração', { type, attempt, code: error.code });
        continue;
      }

      const closest = similarityAgainstHistory(candidate, typeArtifacts);
      if (closest && (closest.exact || closest.similarity >= this.similarityThreshold)) {
        lastRepetition = closest;
        this.logger.warn?.('[Mestre Orc][Generator] conteúdo repetitivo rejeitado', {
          type,
          attempt,
          similarity: Number(closest.similarity.toFixed(3)),
          previousArtifactId: closest.artifact.id
        });
        continue;
      }

      return this.mutate((mutableStore) => {
        const mutableCampaign = mutableStore.campaigns[key] ?? emptyCampaign(key);
        mutableCampaign.sequence[type] = generationNumber;
        mutableCampaign.artifacts[candidate.id] = candidate;
        mutableCampaign.updatedAt = candidate.updatedAt;
        mutableStore.campaigns[key] = mutableCampaign;
        return {
          artifact: publicArtifact(candidate, { includeContent: true }),
          duplicateRejected: Boolean(lastRepetition),
          attempts: attempt,
          snapshot: summarizeCampaign(mutableCampaign)
        };
      });
    }

    if (lastRepetition) {
      const error = new Error('A IA repetiu conteúdo já arquivado. Nenhuma nova geração foi salva.');
      error.code = 'GENERATOR_REPETITION_BLOCKED';
      error.statusCode = 409;
      error.closestArtifactId = lastRepetition.artifact.id;
      error.similarity = Number(lastRepetition.similarity.toFixed(3));
      throw error;
    }
    throw lastInvalid ?? Object.assign(new Error('A IA não retornou conteúdo válido após novas tentativas.'), {
      code: 'GENERATOR_INVALID_RESPONSE',
      statusCode: 502
    });
  }

  async activate(campaignId, artifactId) {
    const key = safeId(campaignId, 'default');
    const artifactKey = safeId(artifactId);
    const store = await this.loadStore();
    const artifact = store.campaigns[key]?.artifacts?.[artifactKey];
    if (!artifact) return null;
    if (artifact.status === 'ACTIVE') return { artifact: publicArtifact(artifact, { includeContent: true }), alreadyActive: true };

    let integration = null;
    if (artifact.type === 'NPC') {
      if (!this.campaignMemory?.upsert) throw new Error('Memória da campanha indisponível para ativar o NPC.');
      const result = await this.campaignMemory.upsert(key, 'npcs', {
        id: artifact.metadata?.npcId || `generated:${artifact.id}`,
        name: artifact.metadata?.name || artifact.title,
        status: 'GENERATED',
        notes: `${artifact.summary}\n\n${artifact.content}`.slice(0, 2500),
        visibility: 'secret'
      });
      integration = { kind: 'CAMPAIGN_MEMORY_NPC', recordId: result.record?.id ?? null };
    } else {
      if (!this.adventureLibrary?.importDocument) throw new Error('Biblioteca da aventura indisponível para ativar o conteúdo.');
      const extensionLabel = artifact.type === 'DUNGEON' ? 'dungeon' : 'adventure';
      const result = await this.adventureLibrary.importDocument(key, {
        fileName: `generated-${extensionLabel}-${artifact.id}.md`,
        title: artifact.title,
        mimeType: 'text/markdown',
        mode: 'REFERENCE_ONLY',
        contentBase64: Buffer.from(`# ${artifact.title}\n\n> ${artifact.summary}\n\n${artifact.content}`, 'utf8').toString('base64')
      });
      integration = {
        kind: 'ADVENTURE_LIBRARY_DOCUMENT',
        documentId: result.document?.id ?? null,
        duplicate: Boolean(result.duplicate),
        mode: 'REFERENCE_ONLY'
      };
    }

    return this.mutate((mutableStore) => {
      const mutableArtifact = mutableStore.campaigns[key]?.artifacts?.[artifactKey];
      if (!mutableArtifact) return null;
      mutableArtifact.status = 'ACTIVE';
      mutableArtifact.integration = { ...integration, activatedAt: new Date().toISOString() };
      mutableArtifact.updatedAt = new Date().toISOString();
      mutableStore.campaigns[key].updatedAt = mutableArtifact.updatedAt;
      return { artifact: publicArtifact(mutableArtifact, { includeContent: true }), alreadyActive: false };
    });
  }

  async archive(campaignId, artifactId) {
    const key = safeId(campaignId, 'default');
    const artifactKey = safeId(artifactId);
    return this.mutate((store) => {
      const artifact = store.campaigns[key]?.artifacts?.[artifactKey];
      if (!artifact) return null;
      artifact.status = 'ARCHIVED';
      artifact.updatedAt = new Date().toISOString();
      store.campaigns[key].updatedAt = artifact.updatedAt;
      return { artifact: publicArtifact(artifact, { includeContent: true }) };
    });
  }

  async remove(campaignId, artifactId) {
    const key = safeId(campaignId, 'default');
    const artifactKey = safeId(artifactId);
    return this.mutate((store) => {
      const campaign = store.campaigns[key] ?? emptyCampaign(key);
      const removed = campaign.artifacts[artifactKey] ?? null;
      if (removed) delete campaign.artifacts[artifactKey];
      campaign.updatedAt = new Date().toISOString();
      store.campaigns[key] = campaign;
      return { removed: publicArtifact(removed, { includeContent: true }), snapshot: summarizeCampaign(campaign) };
    });
  }
}

export class FileGeneratorService extends InMemoryGeneratorService {
  constructor({ filePath = DEFAULT_FILE, ...options } = {}) {
    super(options);
    this.filePath = resolve(filePath);
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (!existsSync(this.filePath)) return;
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.campaigns !== 'object') return;
      this.store = { version: STORE_VERSION, campaigns: parsed.campaigns };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Generator] arquivo inválido; iniciando arquivo vazio', { message: error.message });
      this.store = emptyStore();
    }
  }

  async loadStore() { return this.store; }

  async saveStore(store) {
    this.store = store;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}

export function createGeneratorServiceFromEnv({ narrator, campaignMemory, adventureLibrary, logger = console, env = process.env } = {}) {
  return new FileGeneratorService({
    narrator,
    campaignMemory,
    adventureLibrary,
    logger,
    filePath: env.GENERATOR_ARCHIVE_FILE || resolve(process.cwd(), env.MESTRE_ORC_DATA_DIRECTORY || 'data', 'generated-content.json'),
    similarityThreshold: Number(env.GENERATOR_SIMILARITY_THRESHOLD) || DEFAULT_SIMILARITY_THRESHOLD,
    maxAttempts: Number(env.GENERATOR_MAX_ATTEMPTS) || DEFAULT_MAX_ATTEMPTS
  });
}

export const GeneratorArtifactTypes = [...ARTIFACT_TYPES];
export const GeneratorArtifactStatuses = [...ARTIFACT_STATUSES];
export const generatorInternals = {
  parseGeneratedPayload,
  normalizeGeneratedArtifact,
  artifactSignature,
  jaccardSimilarity,
  similarityAgainstHistory,
  summarizeCampaign,
  historyForPrompt
};
