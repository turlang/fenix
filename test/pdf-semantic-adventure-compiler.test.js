import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMestreKnowledgeContext,
  compileAdventureDocument,
  extractDigitalPdf,
  importDigitalPdfAdventure,
  localizeAdventureModel,
  retrieveAdventureKnowledge
} from '../packages/content-ingestion/src/index.js';

function pdfLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function makePdf(lines) {
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...lines.flatMap((line, index) => [index ? '0 -18 Td' : '', `(${pdfLiteral(line)}) Tj`]).filter(Boolean),
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
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

const lines = [
  'Chapter 1: The Cellar',
  '1. Cellar',
  'Read Aloud: The door opens onto a large stone cellar.',
  'GM Note: A cultist waits behind the pillar.',
  'Secret: A hidden satchel contains 50 gp.',
  'Perception check DC 15 reveals the satchel.',
  'Treasure: 50 gp and a silver key.'
];

const translator = async ({ text }) => text
  .replace('The door opens onto a large stone cellar.', 'A porta se abre para uma grande adega de pedra.')
  .replace('A cultist waits behind the pillar.', 'Um cultista espera atrás do pilar.')
  .replace('A hidden satchel contains 50 gp.', 'Uma bolsa escondida contém 50 po.')
  .replace('Perception check DC 15 reveals the satchel.', 'Teste de Percepção DC 15 revela a bolsa.')
  .replace('Treasure: 50 gp and a silver key.', 'Tesouro: 50 po e uma chave de prata.');

test('imports a digital PDF into a localized Adventure Model with provenance and protected secrets', async () => {
  const pdf = makePdf(lines);
  const extracted = extractDigitalPdf(pdf, { documentId: 'fixture-adventure' });
  assert.equal(extracted.pageCount, 1);
  assert.match(extracted.pages[0].text, /Read Aloud/);

  const model = await importDigitalPdfAdventure(pdf, {
    documentId: 'fixture-adventure',
    title: 'Fixture Adventure',
    targetLanguage: 'pt-BR',
    translator
  });

  assert.equal(model.schema, 'fenix.adventure-model');
  assert.equal(model.language.source, 'en');
  assert.equal(model.language.target, 'pt-BR');
  assert.equal(model.chapters.length, 1);
  assert.equal(model.sections.some((section) => section.kind === 'area'), true);
  assert.equal(model.entities.readAloud.length, 1);
  assert.equal(model.entities.gmNotes.length, 1);
  assert.equal(model.entities.secrets.length, 1);
  assert.equal(model.entities.checks[0].dc, 15);
  assert.equal(model.entities.treasures.length, 1);
  assert.equal(model.entities.checks[0].source.page, 1);

  const player = retrieveAdventureKnowledge(model, { visibility: 'player', language: 'pt-BR' });
  assert.equal(player.some((chunk) => /cultista/i.test(chunk.text)), false);
  assert.equal(player.some((chunk) => /50 po/.test(chunk.text)), false);
  assert.equal(player.some((chunk) => /porta se abre/i.test(chunk.text)), true);

  const secretId = model.entities.secrets[0].id;
  const revealed = retrieveAdventureKnowledge(model, {
    visibility: 'player',
    language: 'pt-BR',
    revealedSecretIds: [secretId]
  });
  assert.equal(revealed.some((chunk) => /50 po/.test(chunk.text)), true);

  const context = buildMestreKnowledgeContext(model, { visibility: 'player', language: 'pt-BR' });
  assert.equal(context.schema, 'fenix.mestre-knowledge-context');
  assert.match(context.text, /porta se abre/i);
  assert.doesNotMatch(context.text, /cultista/i);
});

test('rejects localization that changes protected numeric facts', async () => {
  const extracted = extractDigitalPdf(makePdf(['1. Cellar', 'Read Aloud: A DC 15 door hides 50 gp.']), { documentId: 'numbers' });
  const model = compileAdventureDocument(extracted, { sourceLanguage: 'en' });
  await assert.rejects(
    localizeAdventureModel(model, {
      targetLanguage: 'pt-BR',
      translator: async ({ text }) => text.replace('15', '16')
    }),
    (error) => error.code === 'FENIX_LOCALIZATION_MECHANICAL_FACT_CHANGED'
  );
});

test('fails closed when the PDF has no usable text layer', () => {
  const pdf = makePdf(['']);
  assert.throws(
    () => extractDigitalPdf(pdf, { documentId: 'scan' }),
    (error) => error.code === 'FENIX_PDF_TEXT_LAYER_REQUIRED'
  );
});
