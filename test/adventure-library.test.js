import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  chunkAdventureText,
  extractAdventureDocument,
  FileAdventureLibrary,
  InMemoryAdventureLibrary
} from '../packages/adventure-library/src/index.js';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

function base64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

function createStoredZip(fileName, content) {
  const name = Buffer.from(fileName, 'utf8');
  const data = Buffer.from(content, 'utf8');
  const local = Buffer.alloc(30 + name.length + data.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);
  data.copy(local, 30 + name.length);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  name.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

const campaignId = 'world-adventure';
const safeAdventureText = `# Introdução\nNotas reservadas do mestre sobre a região.\n\n# Texto para ler em voz alta\nUma porta de madeira revestida de cobre encerra a galeria. O baixo-relevo mostra um anjo triste.\n\n# Segredo da sala\nA fechadura aciona uma armadilha escondida.`;

test('classifica trechos importados sem liberar segredos', () => {
  const chunks = chunkAdventureText(safeAdventureText, { documentId: 'doc-1', mode: 'READ_ALOUD_ONLY' });
  assert.equal(chunks.length, 3);
  assert.equal(chunks.find((entry) => /Texto para ler/i.test(entry.heading)).access, 'PLAYER_SAFE');
  assert.equal(chunks.find((entry) => /Segredo/i.test(entry.heading)).access, 'GM_ONLY');
  assert.equal(chunks.find((entry) => /Introdução/i.test(entry.heading)).access, 'GM_ONLY');
});

test('modo PLAYER_SAFE ainda preserva seções explicitamente secretas', () => {
  const chunks = chunkAdventureText(safeAdventureText, { documentId: 'doc-1', mode: 'PLAYER_SAFE' });
  assert.equal(chunks.find((entry) => /Texto para ler/i.test(entry.heading)).access, 'PLAYER_SAFE');
  assert.equal(chunks.find((entry) => /Segredo/i.test(entry.heading)).access, 'GM_ONLY');
});

test('importa TXT, pesquisa toda a biblioteca e entrega à narração somente PLAYER_SAFE', async () => {
  const library = new InMemoryAdventureLibrary({ logger: {} });
  const imported = await library.importDocument(campaignId, {
    fileName: 'galeria.txt',
    mode: 'READ_ALOUD_ONLY',
    contentBase64: base64(safeAdventureText)
  });
  assert.equal(imported.duplicate, false);
  assert.equal(imported.document.safeChunkCount, 1);
  assert.equal(imported.document.secretChunkCount, 2);

  const all = await library.search(campaignId, 'armadilha fechadura', { limit: 5 });
  assert.equal(all.length, 1);
  assert.equal(all[0].chunk.access, 'GM_ONLY');

  const safe = await library.contextForNarration(campaignId, 'porta cobre anjo triste');
  assert.equal(safe.references.length, 1);
  assert.match(safe.references[0].text, /anjo triste/i);
  assert.doesNotMatch(JSON.stringify(safe), /armadilha escondida/i);
});

test('deduplica o mesmo arquivo por SHA-256', async () => {
  const library = new InMemoryAdventureLibrary({ logger: {} });
  const input = { fileName: 'galeria.md', mode: 'REFERENCE_ONLY', contentBase64: base64(safeAdventureText) };
  const first = await library.importDocument(campaignId, input);
  const second = await library.importDocument(campaignId, input);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal((await library.list(campaignId)).documentCount, 1);
});

test('rejeita Base64 inválido antes da extração', async () => {
  const library = new InMemoryAdventureLibrary({ logger: {} });
  await assert.rejects(
    library.importDocument(campaignId, { fileName: 'quebrado.txt', contentBase64: '%%%não-base64%%%' }),
    /Base64 inválido/
  );
});

test('remoção informa as contagens originais do documento', async () => {
  const library = new InMemoryAdventureLibrary({ logger: {} });
  const imported = await library.importDocument(campaignId, {
    fileName: 'galeria.txt', mode: 'READ_ALOUD_ONLY', contentBase64: base64(safeAdventureText)
  });
  const result = await library.remove(campaignId, imported.document.id);
  assert.equal(result.removed.safeChunkCount, 1);
  assert.equal(result.removed.secretChunkCount, 2);
  assert.equal(result.summary.documentCount, 0);
});

test('extrai DOCX sem dependência externa', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Texto para ler em voz alta</w:t></w:r></w:p>
    <w:p><w:r><w:t>Colunas falsas adornam as paredes da galeria.</w:t></w:r></w:p>
  </w:body></w:document>`;
  const docx = createStoredZip('word/document.xml', xml);
  const extracted = extractAdventureDocument({ fileName: 'aventura.docx', content: docx });
  assert.equal(extracted.method, 'docx-native');
  assert.match(extracted.text, /# Texto para ler em voz alta/);
  assert.match(extracted.text, /Colunas falsas/);
});

test('extrai PDF textual pelo fallback quando pdftotext não existe', () => {
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>stream\nBT (Uma galeria de pedra leva a uma porta de cobre.) Tj ET\nendstream\nendobj\n%%EOF', 'latin1');
  const extracted = extractAdventureDocument({ fileName: 'aventura.pdf', content: pdf, pdfTextCommand: '__comando_inexistente__' });
  assert.equal(extracted.method, 'pdf-native-fallback');
  assert.match(extracted.text, /porta de cobre/i);
});

test('persiste a biblioteca por campanha com gravação em arquivo', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-adventure-'));
  const filePath = join(directory, 'adventure-library.json');
  try {
    const first = new FileAdventureLibrary({ filePath, logger: {} });
    await first.importDocument(campaignId, {
      fileName: 'galeria.txt', mode: 'READ_ALOUD_ONLY', contentBase64: base64(safeAdventureText)
    });
    const second = new FileAdventureLibrary({ filePath, logger: {} });
    const restored = await second.list(campaignId);
    assert.equal(restored.documentCount, 1);
    assert.equal(restored.safeChunkCount, 1);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(raw.version, 1);
    assert.ok(raw.campaigns[campaignId]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('runtime inclui apenas referências seguras na resolução narrativa', async () => {
  const library = new InMemoryAdventureLibrary({ logger: {} });
  await library.importDocument('world-1', {
    fileName: 'galeria.txt', mode: 'READ_ALOUD_ONLY', contentBase64: base64(safeAdventureText)
  });
  let roundContext = null;
  const runtime = createSessionRuntime({
    adventureLibrary: library,
    narrator: {
      async createOpening() { return `A poeira recobre as pedras da galeria e suaviza os contornos das colunas falsas alinhadas nas paredes. A luz alcança somente parte do corredor, deixando o fundo comprimido entre faixas de sombra e cobre envelhecido. Cada passo possível segue pelo mesmo eixo estreito, sem desvios visíveis.\n\nNo fim da passagem, uma porta de madeira revestida por placas de cobre interrompe a continuidade da pedra. O metal gasto acompanha um baixo-relevo antigo, enquanto o restante da galeria permanece imóvel ao redor desse limite fechado.\n\nO que vocês fazem?`; },
      async narrateRound(payload) { roundContext = payload.context; return 'A atenção se volta para a porta de cobre.'; }
    }
  });
  await runtime.start({
    activeScene: { id: 'scene-1', name: 'Galeria do Anjo', description: 'Galeria de pedra.' },
    campaign: { worldId: 'world-1', systemId: 'dnd5e' },
    visibleActors: [],
    narrationExclusions: { actorNames: [] },
    sceneJournal: {
      id: 'journal-1', name: 'Galeria do Anjo', explicitLink: true,
      selectedPage: { name: 'Galeria', content: 'Uma galeria de pedra termina em uma porta.', extractionMode: 'DIRECT_JOURNAL_READ_ALOUD' }
    }
  });
  await runtime.processAction({ actorId: 'hero-1', actorName: 'Arannis', content: 'Examino a porta de cobre e o anjo triste.', eventId: 'chat:1' });
  await runtime.resolveRound({ eventId: 'round:1' });
  assert.equal(roundContext.adventure.references.length, 1);
  assert.match(roundContext.adventure.references[0].text, /anjo triste/i);
  assert.doesNotMatch(JSON.stringify(roundContext.adventure), /armadilha escondida/i);
});

test('API e módulo Foundry expõem importação, busca e painel da biblioteca', async () => {
  const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
  const main = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
  const panel = await readFile(new URL('../apps/foundry-module/scripts/adventure-library-panel.js', import.meta.url), 'utf8');
  assert.match(server, /\/v1\/adventure-library\/:campaignId\/import/);
  assert.match(server, /\/v1\/adventure-library\/:campaignId\/search/);
  assert.match(server, /ADVENTURE_IMPORT_FAILED/);
  assert.match(main, /mestreOrcAdventureLibrary/);
  assert.match(panel, /Biblioteca da aventura/);
  assert.match(panel, /REFERENCE_ONLY/);
});
