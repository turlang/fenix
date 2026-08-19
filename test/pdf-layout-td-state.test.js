import assert from 'node:assert/strict';
import test from 'node:test';
import { extractPdfLayoutSemantics } from '../packages/content-ingestion/src/layout-semantics.js';

function literal(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function makePdf() {
  const first = 'The first boxed line remains aligned inside the narrative frame.';
  const second = 'The second boxed line uses Td and must return to the line origin.';
  const content = [
    '60 600 490 100 re S',
    'BT',
    '/F1 12 Tf',
    '80 670 Td',
    `(${literal(first)}) Tj`,
    '0 -22 Td',
    `(${literal(second)}) Tj`,
    'ET',
    'BT',
    '/F1 18 Tf',
    '1 0 0 1 72 744 Tm',
    '(1. Cellar) Tj',
    'ET'
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

test('Td updates the text line matrix instead of advancing from the end of the previous glyph run', () => {
  const layout = extractPdfLayoutSemantics(makePdf(), { documentId: 'td-line-matrix' });
  const boxed = layout.pages[0].candidates.find((candidate) => candidate.kind === 'boxed-text');
  assert.ok(boxed, 'expected the two Td-positioned lines to remain inside the same rectangle');
  assert.match(boxed.text, /first boxed line/i);
  assert.match(boxed.text, /second boxed line/i);

  const first = layout.pages[0].lines.find((line) => /first boxed line/i.test(line.text));
  const second = layout.pages[0].lines.find((line) => /second boxed line/i.test(line.text));
  assert.ok(first);
  assert.ok(second);
  assert.equal(Math.abs(first.x - second.x) < 0.001, true, 'both lines should start at the same x origin after 0 -22 Td');
  assert.equal(second.y < first.y, true);
});
