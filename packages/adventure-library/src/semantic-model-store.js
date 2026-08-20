import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { applyAdventureReviewDecisions } from '../../content-ingestion/src/review-queue.js';
import { applyOcrReviewDecisions } from '../../content-ingestion/src/ocr-vision.js';
import { retrieveAdventureKnowledge } from '../../content-ingestion/src/index.js';

const STORE_VERSION = 1;
const DEFAULT_FILE = resolve(process.cwd(), process.env.FENIX_SEMANTIC_ADVENTURE_FILE || 'data/semantic-adventures.json');

function normalizeId(value, fallback = 'default') {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 200);
  return normalized || fallback;
}
function emptyStore() { return { schema: 'fenix.semantic-adventure-library', version: STORE_VERSION, campaigns: {} }; }
function emptyCampaign(id) { return { id, models: {}, updatedAt: null }; }
function tokens(value) {
  return [...new Set(String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1))];
}

export function buildSemanticAdventureIndex(model) {
  const byToken = {};
  for (const chunk of model?.chunks ?? []) {
    const localizedText = Object.values(chunk.localized ?? {}).join(' ');
    const haystack = `${chunk.sectionTitle ?? ''} ${chunk.originalText ?? ''} ${localizedText}`;
    for (const token of tokens(haystack)) {
      byToken[token] ??= [];
      if (!byToken[token].includes(chunk.id)) byToken[token].push(chunk.id);
    }
  }
  return Object.freeze({
    schema: 'fenix.semantic-adventure-index', version: 1, adventureId: model.id,
    chunkCount: model?.chunks?.length ?? 0, tokenCount: Object.keys(byToken).length,
    byToken: Object.freeze(Object.fromEntries(Object.entries(byToken).map(([token, ids]) => [token, Object.freeze(ids)])))
  });
}

function modelSummary(record) {
  const model = record.model;
  return {
    id: model.id,
    title: model.title,
    language: model.language,
    source: model.source,
    ingestion: model.ingestion ?? null,
    stats: model.stats,
    review: model.review?.summary ?? null,
    ocrReview: model.ocr?.review?.summary ?? null,
    bindingReview: model.bindingReview?.summary ?? null,
    entityGraph: model.entityGraph ? { schema: model.entityGraph.schema, version: model.entityGraph.version, stats: model.entityGraph.stats } : null,
    index: { chunkCount: record.index.chunkCount, tokenCount: record.index.tokenCount },
    updatedAt: record.updatedAt
  };
}

export class InMemorySemanticAdventureStore {
  constructor({ logger = console } = {}) { this.logger = logger; this.store = emptyStore(); this.driver = 'memory'; }
  async initialize() { return true; }
  async loadStore() { return this.store; }
  async saveStore(store) { this.store = store; }

  async saveModel(campaignId, model) {
    if (model?.schema !== 'fenix.adventure-model') throw new Error('Adventure Model inválido.');
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const now = new Date().toISOString();
    const record = { model, index: buildSemanticAdventureIndex(model), updatedAt: now };
    campaign.models[model.id] = record;
    campaign.updatedAt = now;
    store.campaigns[id] = campaign;
    await this.saveStore(store);
    return modelSummary(record);
  }
  async getModel(campaignId, adventureId) {
    const store = await this.loadStore();
    return store.campaigns[normalizeId(campaignId)]?.models?.[adventureId]?.model ?? null;
  }
  async listModels(campaignId) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    return Object.values(campaign.models).map(modelSummary).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }
  async removeModel(campaignId, adventureId) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const existing = campaign.models[adventureId] ?? null;
    if (!existing) return null;
    delete campaign.models[adventureId];
    campaign.updatedAt = new Date().toISOString();
    store.campaigns[id] = campaign;
    await this.saveStore(store);
    return modelSummary(existing);
  }
  async applyReview(campaignId, adventureId, decisions, { queue = 'layout' } = {}) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const record = campaign.models[adventureId];
    if (!record) throw new Error('Adventure Model não encontrado.');
    const model = queue === 'ocr' ? applyOcrReviewDecisions(record.model, decisions) : applyAdventureReviewDecisions(record.model, decisions);
    const now = new Date().toISOString();
    const updated = { model, index: buildSemanticAdventureIndex(model), updatedAt: now };
    campaign.models[adventureId] = updated;
    campaign.updatedAt = now;
    store.campaigns[id] = campaign;
    await this.saveStore(store);
    return modelSummary(updated);
  }
  async search(campaignId, adventureId, options = {}) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const record = store.campaigns[id]?.models?.[adventureId];
    if (!record) return [];
    const queryTokens = tokens(options.query ?? '');
    let model = record.model;
    if (queryTokens.length) {
      const candidateIds = new Set();
      for (const token of queryTokens) for (const chunkId of record.index.byToken[token] ?? []) candidateIds.add(chunkId);
      if (candidateIds.size) model = { ...model, chunks: model.chunks.filter((chunk) => candidateIds.has(chunk.id)) };
    }
    return retrieveAdventureKnowledge(model, options);
  }
}

export class FileSemanticAdventureStore extends InMemorySemanticAdventureStore {
  constructor({ filePath = DEFAULT_FILE, logger = console } = {}) { super({ logger }); this.filePath = resolve(filePath); this.driver = 'file'; }
  async loadStore() {
    if (!existsSync(this.filePath)) return emptyStore();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return emptyStore();
      parsed.schema = 'fenix.semantic-adventure-library'; parsed.version = STORE_VERSION; parsed.campaigns ??= {};
      return parsed;
    } catch (error) {
      this.logger.error?.('[Fênix][SemanticAdventureStore] falha ao ler store', { message: error.message });
      throw new Error('A biblioteca semântica de aventuras está corrompida.');
    }
  }
  async saveStore(store) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}

export function createSemanticAdventureStoreFromEnv({ logger = console } = {}) {
  return new FileSemanticAdventureStore({ filePath: process.env.FENIX_SEMANTIC_ADVENTURE_FILE || DEFAULT_FILE, logger });
}
