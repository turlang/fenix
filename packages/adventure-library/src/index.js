import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inflateRawSync, inflateSync } from 'node:zlib';

const LIBRARY_VERSION = 1;
const IMPORT_MODES = new Set(['REFERENCE_ONLY', 'READ_ALOUD_ONLY', 'PLAYER_SAFE']);
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.html', '.htm', '.docx', '.pdf']);
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_000_000;
const DEFAULT_FILE = resolve(process.cwd(), process.env.ADVENTURE_LIBRARY_FILE || 'data/adventure-library.json');
const STOP_WORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','da','do','das','dos','e','ou','em','no','na','nos','nas','para','por','com','sem','sob','sobre','que','se','ao','aos','à','às','é','são','foi','ser','como','mais','menos','muito','muita','muitos','muitas','este','esta','esse','essa','isso','isto','ele','ela','eles','elas','the','and','or','of','to','in','on','for','with','without','is','are','was','were'
]);
const SAFE_HEADING_PATTERNS = [
  /read[ -]?aloud/i,
  /boxed text/i,
  /player(?:s)? description/i,
  /texto para (?:ler|os jogadores)/i,
  /leia (?:em voz alta|aos jogadores)/i,
  /descri[cç][aã]o para (?:os )?jogadores/i,
  /narra[cç][aã]o da (?:sala|cena|[aá]rea)/i
];
const SECRET_HEADING_PATTERNS = [
  /segredo/i, /solu[cç][aã]o/i, /armadilha/i, /estat[ií]stic/i, /bloco de estat/i,
  /tesouro/i, /recompensa/i, /notas? do mestre/i, /gm notes?/i, /dm notes?/i,
  /desenvolvimento/i, /consequ[eê]ncias? ocult/i, /inimigos?/i, /t[aá]tica/i
];

function cleanText(value, limit = MAX_EXTRACTED_CHARS) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, limit);
}

function normalizeId(value, fallback = 'default') {
  const normalized = String(value ?? '').trim().replace(/[^A-Za-z0-9._:-]+/g, '-').slice(0, 200);
  return normalized || fallback;
}

function extensionOf(fileName = '') {
  const match = String(fileName).toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] ?? '';
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  return cleanText(
    decodeXml(String(value ?? '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr)>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ' '))
  );
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

function unzipEntry(buffer, wantedName) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) throw new Error('DOCX inválido: diretório ZIP não encontrado.');
  const entries = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < entries && cursor + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const fileName = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');
    if (fileName === wantedName) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('DOCX inválido: entrada local corrompida.');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compression === 0) return Buffer.from(compressed);
      if (compression === 8) return inflateRawSync(compressed);
      throw new Error(`DOCX usa compressão ZIP não suportada (${compression}).`);
    }
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}

function extractDocx(buffer) {
  const xmlBuffer = unzipEntry(buffer, 'word/document.xml');
  if (!xmlBuffer) throw new Error('DOCX inválido: word/document.xml não encontrado.');
  const xml = xmlBuffer.toString('utf8');
  const paragraphs = [];
  const paragraphPattern = /<w:p\b[\s\S]*?<\/w:p>/gi;
  for (const match of xml.matchAll(paragraphPattern)) {
    const paragraph = match[0];
    const style = paragraph.match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i)?.[1] ?? '';
    const fragments = [];
    for (const textMatch of paragraph.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)) fragments.push(decodeXml(textMatch[1]));
    const text = cleanText(fragments.join('').replace(/\s+/g, ' '), 20_000);
    if (!text) continue;
    const heading = /heading|t[ií]tulo|title/i.test(style);
    paragraphs.push(heading ? `# ${text}` : text);
  }
  return { text: cleanText(paragraphs.join('\n\n')), method: 'docx-native', warnings: [] };
}

function decodePdfLiteral(value) {
  return String(value ?? '')
    .replace(/\\([nrtbf()\\])/g, (_match, code) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[code]))
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\\r?\n/g, '');
}

function extractPdfTextOperators(source) {
  const fragments = [];
  for (const block of source.matchAll(/BT([\s\S]*?)ET/g)) {
    const body = block[1];
    for (const match of body.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj|\[(.*?)\]\s*TJ/gs)) {
      const token = match[0];
      if (/\]\s*TJ$/.test(token)) {
        for (const item of token.matchAll(/\((?:\\.|[^\\)])*\)/g)) fragments.push(decodePdfLiteral(item[0].slice(1, -1)));
      } else {
        const literal = token.match(/^\(((?:\\.|[^\\)])*)\)/s)?.[1];
        if (literal != null) fragments.push(decodePdfLiteral(literal));
      }
    }
    fragments.push('\n');
  }
  return cleanText(fragments.join(' '));
}

function fallbackPdfExtraction(buffer) {
  const binary = buffer.toString('latin1');
  const fragments = [extractPdfTextOperators(binary)];
  const streamPattern = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/gs;
  for (const match of binary.matchAll(streamPattern)) {
    if (!/FlateDecode/i.test(match[1])) continue;
    try {
      const compressed = Buffer.from(match[2], 'latin1');
      const inflated = inflateSync(compressed).toString('latin1');
      fragments.push(extractPdfTextOperators(inflated));
    } catch {
      // Stream possivelmente possui filtros adicionais; outros streams ainda podem fornecer texto.
    }
  }
  return cleanText(fragments.filter(Boolean).join('\n'));
}

function extractPdf(buffer, { pdfTextCommand = process.env.PDFTOTEXT_COMMAND || 'pdftotext' } = {}) {
  const result = spawnSync(pdfTextCommand, ['-layout', '-enc', 'UTF-8', '-', '-'], {
    input: buffer,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: 25_000,
    windowsHide: true
  });
  const commandText = cleanText(result.stdout);
  if (!result.error && result.status === 0 && commandText.length >= 20) {
    return { text: commandText, method: 'pdftotext', warnings: [] };
  }
  const fallback = fallbackPdfExtraction(buffer);
  if (fallback.length >= 20) {
    return {
      text: fallback,
      method: 'pdf-native-fallback',
      warnings: ['PDF extraído pelo modo básico. Instale Poppler/pdftotext para maior fidelidade.']
    };
  }
  throw new Error('Não foi possível extrair texto do PDF. O arquivo pode ser digitalizado; faça OCR ou importe o texto em TXT.');
}

export function extractAdventureDocument({ fileName, mimeType = '', content, pdfTextCommand } = {}) {
  const extension = extensionOf(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error(`Formato não suportado: ${extension || mimeType || 'desconhecido'}.`);
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content ?? '');
  if (!buffer.length) throw new Error('O arquivo está vazio.');
  if (buffer.length > MAX_FILE_BYTES) throw new Error(`O arquivo excede ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB.`);
  if (extension === '.docx') return extractDocx(buffer);
  if (extension === '.pdf') return extractPdf(buffer, { pdfTextCommand });
  const raw = buffer.toString('utf8');
  if (extension === '.html' || extension === '.htm' || /html/i.test(mimeType)) {
    return { text: stripHtml(raw), method: 'html-native', warnings: [] };
  }
  return { text: cleanText(raw), method: extension === '.md' ? 'markdown-native' : 'text-native', warnings: [] };
}

function headingLevel(line) {
  const markdown = String(line).match(/^\s*(#{1,6})\s+(.+)$/);
  if (markdown) return { level: markdown[1].length, title: cleanText(markdown[2], 300) };
  const trimmed = cleanText(line, 300);
  if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9][A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9\s:–—-]{4,80}$/.test(trimmed)) return { level: 2, title: trimmed };
  return null;
}

function accessForHeading(heading, mode) {
  const normalized = String(heading ?? '');
  if (SECRET_HEADING_PATTERNS.some((pattern) => pattern.test(normalized))) return 'GM_ONLY';
  if (mode === 'PLAYER_SAFE') return 'PLAYER_SAFE';
  if (mode === 'READ_ALOUD_ONLY' && SAFE_HEADING_PATTERNS.some((pattern) => pattern.test(normalized))) return 'PLAYER_SAFE';
  return 'GM_ONLY';
}

function splitLongParagraph(value, maxChars = 1300) {
  const text = cleanText(value, 50_000);
  if (text.length <= maxChars) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      parts.push(current.trim());
      current = '';
    }
    current = `${current} ${sentence}`.trim();
  }
  if (current) parts.push(current);
  return parts;
}

export function chunkAdventureText(text, { documentId = 'document', mode = 'REFERENCE_ONLY' } = {}) {
  const importMode = IMPORT_MODES.has(mode) ? mode : 'REFERENCE_ONLY';
  const lines = cleanText(text).split('\n');
  const chunks = [];
  let heading = 'Introdução';
  let section = [];
  let order = 0;
  const flush = () => {
    const body = cleanText(section.join('\n\n'), 100_000);
    section = [];
    if (!body) return;
    const access = accessForHeading(heading, importMode);
    for (const paragraph of splitLongParagraph(body)) {
      chunks.push({
        id: `${documentId}:chunk:${order + 1}`,
        documentId,
        order: order++,
        heading,
        text: paragraph,
        access,
        wordCount: paragraph.split(/\s+/).filter(Boolean).length
      });
    }
  };
  for (const rawLine of lines) {
    const detected = headingLevel(rawLine);
    if (detected) {
      flush();
      heading = detected.title;
      continue;
    }
    if (!rawLine.trim()) {
      if (section.length && section.at(-1) !== '') section.push('');
      continue;
    }
    section.push(rawLine.trim());
  }
  flush();
  return chunks;
}

function normalizedTokens(value) {
  return [...new Set(String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token)))];
}

function documentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function emptyStore() {
  return { version: LIBRARY_VERSION, campaigns: {} };
}

function emptyCampaign(id) {
  return { id, documents: {}, chunks: {}, updatedAt: null };
}

function publicDocument(document, chunks = []) {
  return {
    ...document,
    safeChunkCount: chunks.filter((chunk) => chunk.access === 'PLAYER_SAFE').length,
    secretChunkCount: chunks.filter((chunk) => chunk.access === 'GM_ONLY').length
  };
}

export class InMemoryAdventureLibrary {
  constructor({ logger = console, pdfTextCommand } = {}) {
    this.logger = logger;
    this.pdfTextCommand = pdfTextCommand;
    this.store = emptyStore();
  }

  async loadStore() { return this.store; }
  async saveStore(store) { this.store = store; }

  async importDocument(campaignId, input = {}) {
    const id = normalizeId(campaignId);
    const fileName = cleanText(input.fileName, 300);
    const mode = IMPORT_MODES.has(input.mode) ? input.mode : 'REFERENCE_ONLY';
    if (!fileName) throw new Error('Nome do arquivo é obrigatório.');
    const encodedContent = String(input.contentBase64 ?? '').replace(/\s+/g, '');
    if (!encodedContent || !/^[A-Za-z0-9+/]*={0,2}$/.test(encodedContent) || encodedContent.length % 4 === 1) {
      throw new Error('Conteúdo Base64 inválido.');
    }
    let content;
    try { content = Buffer.from(encodedContent, 'base64'); }
    catch { throw new Error('Conteúdo Base64 inválido.'); }
    if (!content.length) throw new Error('Conteúdo do arquivo não foi recebido.');
    const canonicalInput = encodedContent.replace(/=+$/, '');
    const canonicalOutput = content.toString('base64').replace(/=+$/, '');
    if (canonicalInput !== canonicalOutput) throw new Error('Conteúdo Base64 inválido.');
    const hash = documentHash(content);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const duplicate = Object.values(campaign.documents).find((entry) => entry.sha256 === hash);
    if (duplicate) return { duplicate: true, document: publicDocument(duplicate, Object.values(campaign.chunks).filter((chunk) => chunk.documentId === duplicate.id)), summary: this.summary(campaign) };

    const extracted = extractAdventureDocument({ fileName, mimeType: input.mimeType, content, pdfTextCommand: this.pdfTextCommand });
    if (extracted.text.length < 20) throw new Error('O documento não possui texto suficiente para indexação.');
    const documentId = randomUUID();
    const chunks = chunkAdventureText(extracted.text, { documentId, mode });
    const now = new Date().toISOString();
    const document = {
      id: documentId,
      title: cleanText(input.title, 300) || fileName.replace(/\.[^.]+$/, ''),
      fileName,
      mimeType: cleanText(input.mimeType, 120) || null,
      extension: extensionOf(fileName),
      mode,
      sha256: hash,
      extractionMethod: extracted.method,
      warnings: extracted.warnings ?? [],
      characterCount: extracted.text.length,
      wordCount: extracted.text.split(/\s+/).filter(Boolean).length,
      chunkCount: chunks.length,
      createdAt: now,
      updatedAt: now
    };
    campaign.documents[documentId] = document;
    for (const chunk of chunks) campaign.chunks[chunk.id] = chunk;
    campaign.updatedAt = now;
    store.campaigns[id] = campaign;
    await this.saveStore(store);
    return { duplicate: false, document: publicDocument(document, chunks), summary: this.summary(campaign) };
  }

  async list(campaignId) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const chunks = Object.values(campaign.chunks);
    return {
      ...this.summary(campaign),
      documents: Object.values(campaign.documents)
        .map((document) => publicDocument(document, chunks.filter((chunk) => chunk.documentId === document.id)))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    };
  }

  async remove(campaignId, documentId) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const removed = campaign.documents[documentId] ?? null;
    const removedChunks = removed
      ? Object.values(campaign.chunks).filter((chunk) => chunk.documentId === documentId)
      : [];
    if (removed) {
      delete campaign.documents[documentId];
      for (const [chunkId, chunk] of Object.entries(campaign.chunks)) if (chunk.documentId === documentId) delete campaign.chunks[chunkId];
      campaign.updatedAt = new Date().toISOString();
      store.campaigns[id] = campaign;
      await this.saveStore(store);
    }
    return { removed: removed ? publicDocument(removed, removedChunks) : null, summary: this.summary(campaign) };
  }

  async updateMode(campaignId, documentId, mode) {
    if (!IMPORT_MODES.has(mode)) throw new Error('Modo de importação inválido.');
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const document = campaign.documents[documentId];
    if (!document) throw new Error('Documento não encontrado.');
    document.mode = mode;
    document.updatedAt = new Date().toISOString();
    for (const chunk of Object.values(campaign.chunks)) {
      if (chunk.documentId === documentId) chunk.access = accessForHeading(chunk.heading, mode);
    }
    campaign.updatedAt = document.updatedAt;
    store.campaigns[id] = campaign;
    await this.saveStore(store);
    const chunks = Object.values(campaign.chunks).filter((chunk) => chunk.documentId === documentId);
    return { document: publicDocument(document, chunks), summary: this.summary(campaign) };
  }

  async search(campaignId, query, { limit = 8, narrationSafeOnly = false, documentId = null } = {}) {
    const id = normalizeId(campaignId);
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const phrase = cleanText(query, 500);
    const tokens = normalizedTokens(phrase);
    if (!phrase || !tokens.length) return [];
    const loweredPhrase = phrase.toLocaleLowerCase('pt-BR');
    const results = [];
    for (const chunk of Object.values(campaign.chunks)) {
      if (documentId && chunk.documentId !== documentId) continue;
      if (narrationSafeOnly && chunk.access !== 'PLAYER_SAFE') continue;
      const document = campaign.documents[chunk.documentId];
      if (!document) continue;
      const haystack = `${document.title} ${chunk.heading} ${chunk.text}`.toLocaleLowerCase('pt-BR');
      const haystackTokens = new Set(normalizedTokens(haystack));
      const overlap = tokens.filter((token) => haystackTokens.has(token));
      if (!overlap.length && !haystack.includes(loweredPhrase)) continue;
      let score = overlap.length * 5 / Math.max(1, tokens.length);
      if (haystack.includes(loweredPhrase)) score += 8;
      if (String(chunk.heading).toLocaleLowerCase('pt-BR').includes(loweredPhrase)) score += 5;
      if (String(document.title).toLocaleLowerCase('pt-BR').includes(loweredPhrase)) score += 4;
      if (chunk.access === 'PLAYER_SAFE') score += 0.25;
      results.push({
        score: Number(score.toFixed(3)),
        document: { id: document.id, title: document.title, fileName: document.fileName, mode: document.mode },
        chunk: { id: chunk.id, heading: chunk.heading, text: chunk.text, access: chunk.access, order: chunk.order }
      });
    }
    return results.sort((a, b) => b.score - a.score || a.chunk.order - b.chunk.order).slice(0, Math.max(1, Math.min(30, Number(limit) || 8)));
  }

  async contextForNarration(campaignId, query, { limit = 4, maxChars = 3600 } = {}) {
    const results = await this.search(campaignId, query, { limit, narrationSafeOnly: true });
    let used = 0;
    const references = [];
    for (const result of results) {
      const available = Math.max(0, maxChars - used);
      if (available < 80) break;
      const text = cleanText(result.chunk.text, available);
      used += text.length;
      references.push({
        documentId: result.document.id,
        documentTitle: result.document.title,
        heading: result.chunk.heading,
        text,
        score: result.score,
        access: 'PLAYER_SAFE'
      });
    }
    return {
      query: cleanText(query, 500),
      references,
      characterCount: used,
      safety: 'Somente trechos PLAYER_SAFE. Nunca revelar conteúdo GM_ONLY.'
    };
  }

  summary(campaign) {
    const documents = Object.values(campaign.documents ?? {});
    const chunks = Object.values(campaign.chunks ?? {});
    return {
      campaignId: campaign.id,
      documentCount: documents.length,
      chunkCount: chunks.length,
      safeChunkCount: chunks.filter((chunk) => chunk.access === 'PLAYER_SAFE').length,
      secretChunkCount: chunks.filter((chunk) => chunk.access === 'GM_ONLY').length,
      updatedAt: campaign.updatedAt ?? null
    };
  }
}

export class FileAdventureLibrary extends InMemoryAdventureLibrary {
  constructor({ filePath = DEFAULT_FILE, logger = console, pdfTextCommand } = {}) {
    super({ logger, pdfTextCommand });
    this.filePath = resolve(filePath);
  }

  async loadStore() {
    if (!existsSync(this.filePath)) return emptyStore();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return emptyStore();
      parsed.version = LIBRARY_VERSION;
      parsed.campaigns ??= {};
      return parsed;
    } catch (error) {
      this.logger.error?.('[Mestre Orc][AdventureLibrary] falha ao ler biblioteca', { message: error.message });
      throw new Error('A biblioteca de aventuras está corrompida.');
    }
  }

  async saveStore(store) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}

export function createAdventureLibraryFromEnv({ logger = console } = {}) {
  return new FileAdventureLibrary({
    filePath: process.env.ADVENTURE_LIBRARY_FILE || resolve(process.cwd(), process.env.MESTRE_ORC_DATA_DIRECTORY || 'data', 'adventure-library.json'),
    pdfTextCommand: process.env.PDFTOTEXT_COMMAND || 'pdftotext',
    logger
  });
}

export const AdventureImportModes = Object.freeze([...IMPORT_MODES]);
