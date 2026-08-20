import assert from 'node:assert/strict';
import test from 'node:test';
import { importFoundryJournalJson } from '../packages/content-ingestion/src/foundry-journal-adapter.js';
import { extractPdfImageAssets } from '../packages/content-ingestion/src/pdf-image-extraction.js';
import { CampaignContentImportService } from '../packages/content-ingestion/src/content-import-service.js';
import { InMemorySemanticAdventureStore } from '../packages/adventure-library/src/semantic-model-store.js';

function makePdfWithJpeg() {
  const content = ['BT', '/F1 12 Tf', '72 720 Td', '(1. Cellar) Tj', '0 -18 Td', '(Read Aloud: The stone door opens.) Tj', 'ET'].join('\n');
  const jpeg = 'FAKE-JPEG-BYTES';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    `6 0 obj\n<< /Type /XObject /Subtype /Image /Width 1400 /Height 1000 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream\nendobj\n`
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

function foundryFixture() {
  return {
    _id: 'rDYAeFtPX0qX4jc1',
    name: '1. Cellar',
    uuid: 'JournalEntry.rDYAeFtPX0qX4jc1',
    _stats: { coreVersion: '13.351', systemId: 'dnd5e', systemVersion: '5.3.3' },
    pages: [{
      _id: 'dUK2VE7Ghk8K5dFp',
      name: '1. Cellar',
      type: 'text',
      text: {
        content: '<h3>1. Cellar</h3><div class="ve-rd__b-inset--readaloud"><p>The stone door opens into a silent cellar.</p></div><p>DC 15 Wisdom (Perception) check reveals the latch.</p><p>Treasure: 50 gp.</p><p>@UUID[JournalEntry.next.JournalEntryPage.area2]{Area 2}</p>'
      }
    }]
  };
}

test('v1.3 imports Foundry JournalEntry/Page preserving UUID, HTML and references', async () => {
  const model = await importFoundryJournalJson(foundryFixture(), { localize: false });
  assert.equal(model.source.type, 'foundry-journal');
  assert.equal(model.source.journalUuid, 'JournalEntry.rDYAeFtPX0qX4jc1');
  assert.equal(model.foundry.pages[0].pageUuid, 'JournalEntry.rDYAeFtPX0qX4jc1.JournalEntryPage.dUK2VE7Ghk8K5dFp');
  assert.match(model.foundry.pages[0].originalHtml, /ve-rd__b-inset--readaloud/);
  assert.equal(model.foundry.references[0].uuid, 'JournalEntry.next.JournalEntryPage.area2');
  const readAloud = model.chunks.find((chunk) => chunk.type === 'read-aloud');
  assert.ok(readAloud);
  assert.equal(readAloud.visibility, 'player');
  assert.equal(readAloud.source.pageUuid, 'JournalEntry.rDYAeFtPX0qX4jc1.JournalEntryPage.dUK2VE7Ghk8K5dFp');
  assert.equal(model.entities.checks.some((check) => check.dc === 15), true);
  assert.equal(model.entities.treasures.length >= 1, true);
});

test('v1.3 extracts DCT embedded image bytes without inventing geometry', () => {
  const extracted = extractPdfImageAssets(makePdfWithJpeg(), { documentId: 'asset-fixture', minimumPixels: 1000 });
  assert.equal(extracted.schema, 'fenix.pdf-image-extraction');
  assert.equal(extracted.extractedCount, 1);
  assert.equal(extracted.assets[0].mimeType, 'image/jpeg');
  assert.equal(extracted.assets[0].width, 1400);
  assert.equal(extracted.assets[0].buffer.toString('latin1'), 'FAKE-JPEG-BYTES');
  assert.equal('walls' in extracted.assets[0], false);
});

test('v1.3 stores PDF map candidate then promotes it to Scene only after explicit GM action', async () => {
  const store = new InMemorySemanticAdventureStore();
  await store.initialize();
  const uploads = [];
  const scenes = [];
  const sceneService = {
    async uploadMap(input) {
      uploads.push(input);
      return { id: `asset-${uploads.length}`, fileName: input.fileName, mimeType: input.mimeType, width: 1400, height: 1000 };
    },
    async createScene(input) {
      scenes.push(input);
      return {
        scene: { id: 'scene-1', name: input.name, width: input.width, height: input.height, backgroundAssetId: input.assetId, walls: [], regions: [] },
        activeSceneId: 'scene-1'
      };
    }
  };
  const campaignService = {
    requireRole(campaignId, userId, role) {
      assert.equal(campaignId, 'campaign-1');
      assert.equal(userId, 'gm-1');
      assert.equal(role, 'gm');
      return { campaign: { id: campaignId }, membership: { role: 'gm' } };
    }
  };
  const service = new CampaignContentImportService({ campaignService, store, sceneService });
  const imported = await service.importPdf({
    campaignId: 'campaign-1',
    userId: 'gm-1',
    fileName: 'cellar.pdf',
    dataBase64: makePdfWithJpeg().toString('base64'),
    localize: false,
    minimumImagePixels: 1000
  });
  assert.equal(uploads.length, 1);
  const candidate = imported.model.assets.extractedImages.items[0];
  assert.equal(candidate.mapCandidate, true);
  assert.equal(candidate.status, 'review');
  assert.equal(scenes.length, 0);

  const promoted = await service.promoteMapToScene({
    campaignId: 'campaign-1',
    userId: 'gm-1',
    adventureId: imported.model.id,
    imageId: candidate.id,
    name: 'Cellar Map',
    gridSize: 70
  });
  assert.equal(scenes.length, 1);
  assert.equal(promoted.scene.backgroundAssetId, candidate.campaignAssetId);
  assert.deepEqual(promoted.scene.walls, []);
  assert.deepEqual(promoted.scene.regions, []);
  assert.equal(promoted.model.assets.extractedImages.items[0].status, 'promoted');
});

test('v1.3 content service imports Foundry JSON only for GM and persists source identity', async () => {
  const store = new InMemorySemanticAdventureStore();
  const campaignService = {
    requireRole(_campaignId, _userId, role) {
      assert.equal(role, 'gm');
      return { campaign: { id: 'campaign-1' }, membership: { role: 'gm' } };
    }
  };
  const service = new CampaignContentImportService({ campaignService, store });
  const result = await service.importFoundry({
    campaignId: 'campaign-1',
    userId: 'gm-1',
    fileName: 'cellar.json',
    journal: foundryFixture(),
    localize: false
  });
  const reloaded = await store.getModel('campaign-1', result.model.id);
  assert.equal(reloaded.source.type, 'foundry-journal');
  assert.equal(reloaded.foundry.pages[0].pageId, 'dUK2VE7Ghk8K5dFp');
});
