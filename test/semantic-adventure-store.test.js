import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { importDigitalPdfAdventureV11 } from '../packages/content-ingestion/src/layout-review.js';
import { FileSemanticAdventureStore } from '../packages/adventure-library/src/semantic-model-store.js';

function pdfLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function textBlock({ text, x, y, size = 12 }) {
  return ['BT', `/F1 ${size} Tf`, `1 0 0 1 ${x} ${y} Tm`, `(${pdfLiteral(text)}) Tj`, 'ET'].join('\n');
}

function makePdf() {
  const content = [
    '60 600 490 100 re S',
    textBlock({ text: '1. Cellar', x: 72, y: 744, size: 18 }),
    textBlock({ text: 'The old stone door opens into a cold cellar.', x: 80, y: 670 }),
    textBlock({ text: 'A broad cistern stands against the western wall.', x: 80, y: 648 }),
    textBlock({ text: 'GM Note: A cultist waits in a hidden alcove.', x: 72, y: 560 })
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
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

test('persists Adventure Models per campaign, rebuilds lexical index, and persists GM review decisions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'fenix-semantic-adventure-'));
  const filePath = path.join(directory, 'semantic-adventures.json');
  try {
    const model = await importDigitalPdfAdventureV11(makePdf(), {
      documentId: 'persist-fixture',
      title: 'Persistent Fixture',
      localize: false,
      autoAcceptConfidence: 0.99
    });
    assert.equal(model.review.summary.pending, 1);

    const first = new FileSemanticAdventureStore({ filePath, logger: { error() {} } });
    const saved = await first.saveModel('campaign-a', model);
    assert.equal(saved.id, model.id);
    assert.equal(saved.review.pending, 1);
    assert.equal(saved.index.chunkCount, model.chunks.length);
    assert.equal(saved.index.tokenCount > 0, true);

    const reloaded = new FileSemanticAdventureStore({ filePath, logger: { error() {} } });
    const listed = await reloaded.listModels('campaign-a');
    assert.equal(listed.length, 1);
    assert.equal(listed[0].title, 'Persistent Fixture');

    const hidden = await reloaded.search('campaign-a', model.id, {
      query: 'cistern',
      visibility: 'player',
      language: 'en'
    });
    assert.equal(hidden.length, 0);

    const reviewId = model.review.items.find((item) => item.status === 'pending').id;
    const reviewed = await reloaded.applyReview('campaign-a', model.id, { reviewId, action: 'accept' });
    assert.equal(reviewed.review.pending, 0);
    assert.equal(reviewed.review.accepted, 1);

    const third = new FileSemanticAdventureStore({ filePath, logger: { error() {} } });
    const visible = await third.search('campaign-a', model.id, {
      query: 'cistern',
      visibility: 'player',
      language: 'en'
    });
    assert.equal(visible.some((chunk) => /cistern/i.test(chunk.text)), true);
    assert.equal(visible.some((chunk) => /cultist/i.test(chunk.text)), false);

    assert.equal((await third.listModels('campaign-b')).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
