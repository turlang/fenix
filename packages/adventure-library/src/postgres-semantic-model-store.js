import { applyAdventureReviewDecisions } from '../../content-ingestion/src/review-queue.js';
import { applyOcrReviewDecisions } from '../../content-ingestion/src/ocr-vision.js';
import { retrieveAdventureKnowledge } from '../../content-ingestion/src/index.js';
import { buildSemanticAdventureIndex } from './semantic-model-store.js';

function normalizeId(value, fallback = 'default') {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 200);
  return normalized || fallback;
}

function summary(row) {
  const model = row.model_json ?? row.model ?? {};
  const index = row.index_json ?? row.index ?? buildSemanticAdventureIndex(model);
  return {
    id: model.id,
    title: model.title,
    language: model.language,
    source: model.source,
    ingestion: model.ingestion ?? null,
    stats: model.stats,
    review: model.review?.summary ?? null,
    ocrReview: model.ocr?.review?.summary ?? null,
    index: { chunkCount: index.chunkCount ?? 0, tokenCount: index.tokenCount ?? 0 },
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? '')
  };
}

export class PostgresSemanticAdventureStore {
  constructor({ pool, logger = console } = {}) {
    if (!pool?.query) throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
    this.logger = logger;
    this.driver = 'postgres';
  }

  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS fenix_semantic_adventures (
        campaign_id TEXT NOT NULL,
        adventure_id TEXT NOT NULL,
        model_json JSONB NOT NULL,
        index_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (campaign_id, adventure_id)
      )
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS fenix_semantic_adventures_campaign_updated_idx
      ON fenix_semantic_adventures (campaign_id, updated_at DESC)
    `);
    return true;
  }

  async saveModel(campaignId, model) {
    if (model?.schema !== 'fenix.adventure-model') throw new Error('Adventure Model inválido.');
    const campaign = normalizeId(campaignId);
    const index = buildSemanticAdventureIndex(model);
    const result = await this.pool.query(`
      INSERT INTO fenix_semantic_adventures (campaign_id, adventure_id, model_json, index_json)
      VALUES ($1, $2, $3::jsonb, $4::jsonb)
      ON CONFLICT (campaign_id, adventure_id)
      DO UPDATE SET model_json = EXCLUDED.model_json, index_json = EXCLUDED.index_json, updated_at = NOW()
      RETURNING model_json, index_json, updated_at
    `, [campaign, model.id, JSON.stringify(model), JSON.stringify(index)]);
    return summary(result.rows[0]);
  }

  async getModel(campaignId, adventureId) {
    const result = await this.pool.query(`
      SELECT model_json FROM fenix_semantic_adventures
      WHERE campaign_id = $1 AND adventure_id = $2
    `, [normalizeId(campaignId), normalizeId(adventureId)]);
    return result.rows[0]?.model_json ?? null;
  }

  async listModels(campaignId) {
    const result = await this.pool.query(`
      SELECT model_json, index_json, updated_at
      FROM fenix_semantic_adventures
      WHERE campaign_id = $1
      ORDER BY updated_at DESC
    `, [normalizeId(campaignId)]);
    return result.rows.map(summary);
  }

  async removeModel(campaignId, adventureId) {
    const result = await this.pool.query(`
      DELETE FROM fenix_semantic_adventures
      WHERE campaign_id = $1 AND adventure_id = $2
      RETURNING model_json, index_json, updated_at
    `, [normalizeId(campaignId), normalizeId(adventureId)]);
    return result.rows[0] ? summary(result.rows[0]) : null;
  }

  async applyReview(campaignId, adventureId, decisions, { queue = 'layout' } = {}) {
    const current = await this.getModel(campaignId, adventureId);
    if (!current) throw new Error('Adventure Model não encontrado.');
    const model = queue === 'ocr'
      ? applyOcrReviewDecisions(current, decisions)
      : applyAdventureReviewDecisions(current, decisions);
    return this.saveModel(campaignId, model);
  }

  async search(campaignId, adventureId, options = {}) {
    const result = await this.pool.query(`
      SELECT model_json, index_json
      FROM fenix_semantic_adventures
      WHERE campaign_id = $1 AND adventure_id = $2
    `, [normalizeId(campaignId), normalizeId(adventureId)]);
    const row = result.rows[0];
    if (!row) return [];
    let model = row.model_json;
    const queryTokens = String(options.query ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((token) => token.length > 1);
    if (queryTokens.length) {
      const candidateIds = new Set();
      for (const token of queryTokens) for (const chunkId of row.index_json?.byToken?.[token] ?? []) candidateIds.add(chunkId);
      if (candidateIds.size) model = { ...model, chunks: model.chunks.filter((chunk) => candidateIds.has(chunk.id)) };
    }
    return retrieveAdventureKnowledge(model, options);
  }
}
