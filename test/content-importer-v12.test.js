import assert from 'node:assert/strict';
import test from 'node:test';
import { importPdfAdventureV12 } from '../packages/content-ingestion/src/importer-v12.js';
import { applyOcrReviewDecisions } from '../packages/content-ingestion/src/ocr-vision.js';
import { discoverPdfImageAssets } from '../packages/content-ingestion/src/pdf-image-discovery.js';
import { retrieveAdventureKnowledge } from '../packages/content-ingestion/src/index.js';
import { PostgresSemanticAdventureStore } from '../packages/adventure-library/src/postgres-semantic-model-store.js';

function makePdf({ lines = [], includeImage = false } = {}) {
  const textLines = lines.length ? lines : [];
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...textLines.flatMap((line, index) => [index ? '0 -18 Td' : '', `(${String(line).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj`]).filter(Boolean),
    'ET'
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  if (includeImage) {
    const bytes = 'ABCD';
    objects.push(`6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1400 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${bytes.length} >>\nstream\n${bytes}\nendstream\nendobj\n`);
  }
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += object;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

function fakeOcrProvider() {
  return {
    id: 'fixture-ocr',
    async extractPdf() {
      return {
        provider: 'fixture-ocr',
        language: 'en',
        pages: [{
          pageNumber: 1,
          width: 1200,
          height: 1600,
          blocks: [
            { text: '1. Cellar', confidence: 0.99, kind: 'heading', bounds: { x: 80, y: 90, width: 300, height: 50 } },
            {
              text: 'The door opens into a silent stone cellar.',
              confidence: 0.72,
              kind: 'read-aloud',
              proposedType: 'read-aloud',
              bounds: { x: 90, y: 180, width: 880, height: 180 },
              preview: { dataUrl: 'data:image/png;base64,AA==' }
            }
          ]
        }]
      };
    }
  };
}

test('v1.2 falls back to OCR/Vision for scanned PDF and keeps uncertain blocks GM-only', async () => {
  const model = await importPdfAdventureV12(makePdf(), {
    documentId: 'scan-fixture',
    title: 'Scanned Fixture',
    localize: false,
    ocrProvider: fakeOcrProvider(),
    ocrTrustedConfidence: 0.92,
    ocrMinimumReviewConfidence: 0.35
  });

  assert.equal(model.ingestion.extractionMode, 'ocr-vision');
  assert.equal(model.ocr.document.provider, 'fixture-ocr');
  assert.equal(model.ocr.review.summary.pending, 1);
  const pending = model.ocr.review.items[0];
  const playerBefore = retrieveAdventureKnowledge(model, { visibility: 'player', language: 'en' });
  assert.equal(playerBefore.some((chunk) => /silent stone cellar/i.test(chunk.text)), false);

  const accepted = applyOcrReviewDecisions(model, [{ reviewId: pending.id, action: 'accept' }]);
  assert.equal(accepted.ocr.review.summary.pending, 0);
  assert.equal(accepted.ocr.review.summary.accepted, 1);
  const playerAfter = retrieveAdventureKnowledge(accepted, { visibility: 'player', language: 'en' });
  assert.equal(playerAfter.some((chunk) => /silent stone cellar/i.test(chunk.text)), true);
});

test('v1.2 fails closed for scanned PDF when OCR provider is absent', async () => {
  await assert.rejects(
    importPdfAdventureV12(makePdf(), { documentId: 'scan-no-provider', localize: false }),
    (error) => error.code === 'FENIX_OCR_PROVIDER_REQUIRED'
  );
});

test('discovers large embedded PDF images as reviewable map candidates without mutating scenes', () => {
  const discovery = discoverPdfImageAssets(makePdf({ lines: ['1. Cellar'], includeImage: true }), { documentId: 'image-fixture' });
  assert.equal(discovery.schema, 'fenix.pdf-image-discovery');
  assert.equal(discovery.imageCount, 1);
  assert.equal(discovery.mapCandidateCount, 1);
  assert.equal(discovery.images[0].width, 1400);
  assert.equal(discovery.images[0].mapCandidate, true);
  assert.equal(discovery.policy.authoritativeSceneMutation, false);
  assert.equal(discovery.policy.gmReviewRequired, true);
});

class FakePool {
  constructor() { this.rows = new Map(); }
  key(campaignId, adventureId) { return `${campaignId}:${adventureId}`; }
  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (/^CREATE (TABLE|INDEX)/i.test(normalized)) return { rows: [] };
    if (/^INSERT INTO fenix_semantic_adventures/i.test(normalized)) {
      const [campaignId, adventureId, modelJson, indexJson] = params;
      const row = {
        campaign_id: campaignId,
        adventure_id: adventureId,
        model_json: JSON.parse(modelJson),
        index_json: JSON.parse(indexJson),
        updated_at: new Date('2026-08-19T21:00:00.000Z')
      };
      this.rows.set(this.key(campaignId, adventureId), row);
      return { rows: [row] };
    }
    if (/^SELECT model_json FROM fenix_semantic_adventures/i.test(normalized)) {
      const row = this.rows.get(this.key(params[0], params[1]));
      return { rows: row ? [{ model_json: structuredClone(row.model_json) }] : [] };
    }
    if (/^SELECT model_json, index_json FROM fenix_semantic_adventures/i.test(normalized)) {
      const row = this.rows.get(this.key(params[0], params[1]));
      return { rows: row ? [{ model_json: structuredClone(row.model_json), index_json: structuredClone(row.index_json) }] : [] };
    }
    if (/^SELECT model_json, index_json, updated_at FROM fenix_semantic_adventures/i.test(normalized)) {
      const campaignId = params[0];
      return { rows: [...this.rows.values()].filter((row) => row.campaign_id === campaignId).map((row) => structuredClone(row)) };
    }
    if (/^DELETE FROM fenix_semantic_adventures/i.test(normalized)) {
      const key = this.key(params[0], params[1]);
      const row = this.rows.get(key);
      this.rows.delete(key);
      return { rows: row ? [row] : [] };
    }
    throw new Error(`SQL não tratado no FakePool: ${normalized}`);
  }
}

test('PostgreSQL semantic store persists model and OCR review decisions across reads', async () => {
  const pool = new FakePool();
  const store = new PostgresSemanticAdventureStore({ pool });
  await store.initialize();
  const model = await importPdfAdventureV12(makePdf(), {
    documentId: 'postgres-scan',
    title: 'Postgres Scan',
    localize: false,
    ocrProvider: fakeOcrProvider()
  });
  await store.saveModel('campaign-1', model);
  assert.equal((await store.listModels('campaign-1')).length, 1);
  const reviewId = model.ocr.review.items[0].id;
  await store.applyReview('campaign-1', model.id, [{ reviewId, action: 'accept' }], { queue: 'ocr' });
  const reloaded = await store.getModel('campaign-1', model.id);
  assert.equal(reloaded.ocr.review.summary.pending, 0);
  assert.equal(reloaded.ocr.review.summary.accepted, 1);
  assert.equal(reloaded.chunks.some((chunk) => chunk.type === 'read-aloud' && chunk.visibility === 'player'), true);
});
