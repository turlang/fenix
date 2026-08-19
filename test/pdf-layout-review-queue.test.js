import assert from 'node:assert/strict';
import test from 'node:test';
import { retrieveAdventureKnowledge } from '../packages/content-ingestion/src/index.js';
import { extractPdfLayoutSemantics } from '../packages/content-ingestion/src/layout-semantics.js';
import { applyAdventureReviewDecisions } from '../packages/content-ingestion/src/review-queue.js';
import { importDigitalPdfAdventureV11 } from '../packages/content-ingestion/src/importer-v11.js';

function pdfLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textBlock({ text, x, y, size = 12 }) {
  return [
    'BT',
    `/F1 ${size} Tf`,
    `1 0 0 1 ${x} ${y} Tm`,
    `(${pdfLiteral(text)}) Tj`,
    'ET'
  ].join('\n');
}

function makeLayoutPdf({ labeled = false } = {}) {
  const first = labeled
    ? 'Read Aloud: The door opens into a cold stone cellar filled with damp air.'
    : 'The door opens into a cold stone cellar filled with damp air.';
  const content = [
    '60 600 490 100 re S',
    textBlock({ text: '1. Cellar', x: 72, y: 744, size: 18 }),
    textBlock({ text: first, x: 80, y: 670, size: 12 }),
    textBlock({ text: 'A broad stone cistern occupies the western wall of the chamber.', x: 80, y: 648, size: 12 }),
    textBlock({ text: 'GM Note: A cultist waits behind the northern pillar.', x: 72, y: 560, size: 12 })
  ].join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, 'latin1'));
    body += object;
  }
  const xref = Buffer.byteLength(body, 'latin1');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('detects typography and boxed text, but keeps inferred read-aloud blocked until GM review', async () => {
  const pdf = makeLayoutPdf();
  const layout = extractPdfLayoutSemantics(pdf, { documentId: 'layout-fixture' });
  assert.equal(layout.schema, 'fenix.pdf-layout-semantics');
  assert.equal(layout.stats.boxedTextCandidates, 1);
  assert.equal(layout.stats.headingCandidates >= 1, true);
  const boxed = layout.pages[0].candidates.find((candidate) => candidate.kind === 'boxed-text');
  assert.match(boxed.text, /cold stone cellar/i);
  assert.equal(boxed.confidence >= 0.65, true);

  const model = await importDigitalPdfAdventureV11(pdf, {
    documentId: 'layout-fixture',
    title: 'Layout Fixture',
    localize: false,
    autoAcceptConfidence: 0.99
  });
  assert.equal(model.review.schema, 'fenix.content-review-queue');
  assert.equal(model.review.summary.pending, 1);
  assert.equal(model.stats.reviewPending, 1);

  const before = retrieveAdventureKnowledge(model, { query: 'cistern', visibility: 'player', language: 'en' });
  assert.equal(before.some((chunk) => /cistern/i.test(chunk.text)), false);
  assert.equal(before.some((chunk) => /cultist/i.test(chunk.text)), false);

  const reviewId = model.review.items.find((item) => item.status === 'pending').id;
  const approved = applyAdventureReviewDecisions(model, [{ reviewId, action: 'accept', reason: 'Box confirmed as player read-aloud.' }]);
  assert.equal(approved.review.summary.pending, 0);
  assert.equal(approved.review.summary.accepted, 1);
  assert.equal(approved.entities.readAloud.length, 1);

  const after = retrieveAdventureKnowledge(approved, { query: 'cistern', visibility: 'player', language: 'en' });
  assert.equal(after.some((chunk) => /cistern/i.test(chunk.text)), true);
  assert.equal(after.some((chunk) => /cultist/i.test(chunk.text)), false);
});

test('a rejected layout candidate remains GM-only', async () => {
  const model = await importDigitalPdfAdventureV11(makeLayoutPdf(), {
    documentId: 'layout-reject',
    localize: false,
    autoAcceptConfidence: 0.99
  });
  const reviewId = model.review.items.find((item) => item.status === 'pending').id;
  const rejected = applyAdventureReviewDecisions(model, { reviewId, action: 'reject' });
  assert.equal(rejected.review.summary.rejected, 1);
  const player = retrieveAdventureKnowledge(rejected, { query: 'cistern', visibility: 'player', language: 'en' });
  assert.equal(player.length, 0);
});

test('layout inference does not duplicate explicitly labeled read-aloud already compiled by v1', async () => {
  const model = await importDigitalPdfAdventureV11(makeLayoutPdf({ labeled: true }), {
    documentId: 'layout-labeled',
    localize: false
  });
  assert.equal(model.entities.readAloud.length, 1);
  assert.equal(model.review.summary.total, 0);
});