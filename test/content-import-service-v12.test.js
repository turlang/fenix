import assert from 'node:assert/strict';
import test from 'node:test';
import { CampaignContentImportService } from '../packages/content-ingestion/src/content-import-service.js';
import { InMemorySemanticAdventureStore } from '../packages/adventure-library/src/semantic-model-store.js';

function makeScannedPdf() {
  const content = 'BT\nET';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`
  ];
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

function ocrProvider() {
  return {
    async extractPdf() {
      return {
        provider: 'service-fixture',
        language: 'en',
        pages: [{
          pageNumber: 1,
          width: 1000,
          height: 1400,
          blocks: [
            { text: '1. Cellar', confidence: 0.99, kind: 'heading' },
            { text: 'A cold stone room opens beyond the door.', confidence: 0.70, kind: 'read-aloud', proposedType: 'read-aloud' }
          ]
        }]
      };
    }
  };
}

test('campaign content service requires GM, persists scanned import, and applies OCR review', async () => {
  const calls = [];
  const campaignService = {
    requireRole(campaignId, userId, role) {
      calls.push({ campaignId, userId, role });
      assert.equal(role, 'gm');
      return { campaign: { id: campaignId }, membership: { userId, role: 'gm' } };
    }
  };
  const store = new InMemorySemanticAdventureStore();
  await store.initialize();
  const service = new CampaignContentImportService({ campaignService, store, ocrProvider: ocrProvider() });
  const pdf = makeScannedPdf();

  const imported = await service.importPdf({
    campaignId: 'campaign-a',
    userId: 'gm-a',
    fileName: 'scan.pdf',
    dataBase64: pdf.toString('base64'),
    localize: false
  });

  assert.equal(imported.model.ingestion.extractionMode, 'ocr-vision');
  assert.equal(imported.model.ocr.review.summary.pending, 1);
  assert.equal((await service.list({ campaignId: 'campaign-a', userId: 'gm-a' })).models.length, 1);

  const reviewId = imported.model.ocr.review.items[0].id;
  const reviewed = await service.review({
    campaignId: 'campaign-a',
    userId: 'gm-a',
    adventureId: imported.model.id,
    queue: 'ocr',
    decisions: [{ reviewId, action: 'accept', text: 'A cold stone cellar opens beyond the door.' }]
  });

  assert.equal(reviewed.model.ocr.review.summary.pending, 0);
  assert.equal(reviewed.model.ocr.review.summary.accepted, 1);
  assert.equal(reviewed.model.chunks.some((chunk) => chunk.visibility === 'player' && /cold stone cellar/.test(chunk.originalText)), true);
  assert.equal(calls.every((call) => call.role === 'gm'), true);
});

test('campaign content service propagates GM authorization denial', async () => {
  const denied = Object.assign(new Error('Permissão insuficiente.'), { code: 'CAMPAIGN_ROLE_FORBIDDEN', statusCode: 403 });
  const campaignService = { requireRole() { throw denied; } };
  const service = new CampaignContentImportService({ campaignService, store: new InMemorySemanticAdventureStore(), ocrProvider: ocrProvider() });

  await assert.rejects(
    service.list({ campaignId: 'campaign-a', userId: 'player-a' }),
    (error) => error.code === 'CAMPAIGN_ROLE_FORBIDDEN' && error.statusCode === 403
  );
});
