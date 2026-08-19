import crypto from 'node:crypto';
import zlib from 'node:zlib';

function contentError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function cleanText(value) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/[\t\f\v]+/g, ' ').replace(/\r\n?/g, '\n');
}

function normalizeLine(value) {
  return cleanText(value).replace(/[ \u00a0]+/g, ' ').trim();
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw contentError('PDF deve ser fornecido como Buffer, Uint8Array ou ArrayBuffer.', 'FENIX_PDF_INPUT_INVALID');
}

function readObjectBody(binary, start) {
  const end = binary.indexOf('endobj', start);
  if (end < 0) return null;
  return { body: binary.slice(start, end), end: end + 6 };
}

function decodeStream(dict, raw) {
  if (!raw) return null;
  if (/\/Filter\s*\/FlateDecode\b/.test(dict) || /\/Filter\s*\[[^\]]*\/FlateDecode\b[^\]]*\]/s.test(dict)) {
    try {
      return zlib.inflateSync(raw);
    } catch (error) {
      throw contentError('Falha ao descompactar stream Flate do PDF.', 'FENIX_PDF_STREAM_DEFLATE_FAILED', { cause: error.message });
    }
  }
  if (/\/Filter\b/.test(dict)) return null;
  return raw;
}

function splitObjectBody(body) {
  const match = /stream(?:\r\n|\n|\r)/.exec(body);
  if (!match) return { dict: body.trim(), rawStream: null };
  const streamStart = match.index + match[0].length;
  const endStream = body.indexOf('endstream', streamStart);
  if (endStream < 0) return { dict: body.slice(0, match.index).trim(), rawStream: null };
  let rawText = body.slice(streamStart, endStream);
  if (rawText.endsWith('\r\n')) rawText = rawText.slice(0, -2);
  else if (rawText.endsWith('\n') || rawText.endsWith('\r')) rawText = rawText.slice(0, -1);
  return { dict: body.slice(0, match.index).trim(), rawStream: Buffer.from(rawText, 'latin1') };
}

function parsePdfObjects(buffer) {
  const binary = buffer.toString('latin1');
  const objects = new Map();
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = objectPattern.exec(binary))) {
    const found = readObjectBody(binary, objectPattern.lastIndex);
    if (!found) break;
    const { dict, rawStream } = splitObjectBody(found.body);
    const object = {
      id: Number(match[1]),
      generation: Number(match[2]),
      body: found.body,
      dict,
      rawStream,
      decodedStream: null
    };
    if (rawStream) object.decodedStream = decodeStream(dict, rawStream);
    objects.set(object.id, object);
    objectPattern.lastIndex = found.end;
  }

  for (const object of [...objects.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(object.dict) || !object.decodedStream) continue;
    const n = Number(/\/N\s+(\d+)/.exec(object.dict)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(object.dict)?.[1]);
    if (!Number.isInteger(n) || !Number.isInteger(first) || n <= 0 || first < 0) continue;
    const decoded = object.decodedStream.toString('latin1');
    const headerNumbers = decoded.slice(0, first).trim().split(/\s+/).map(Number);
    if (headerNumbers.length < n * 2) continue;
    const entries = [];
    for (let index = 0; index < n; index += 1) entries.push({ id: headerNumbers[index * 2], offset: headerNumbers[index * 2 + 1] });
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (!Number.isInteger(entry.id) || !Number.isInteger(entry.offset)) continue;
      const start = first + entry.offset;
      const end = index + 1 < entries.length ? first + entries[index + 1].offset : decoded.length;
      const body = decoded.slice(start, end).trim();
      if (!body) continue;
      objects.set(entry.id, { id: entry.id, generation: 0, body, dict: body, rawStream: null, decodedStream: null });
    }
  }
  return { binary, objects };
}

function refsFromArray(body, key) {
  const array = new RegExp(`/${key}\\s*\\[([\\s\\S]*?)\\]`).exec(body)?.[1];
  if (!array) return [];
  return [...array.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1]));
}

function refFromKey(body, key) {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body);
  return match ? Number(match[1]) : null;
}

function pageOrder(objects) {
  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog\b/.test(object.body));
  const rootPages = catalog ? refFromKey(catalog.body, 'Pages') : null;
  const ordered = [];
  const seen = new Set();

  const walk = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const object = objects.get(id);
    if (!object) return;
    if (/\/Type\s*\/Pages\b/.test(object.body)) {
      for (const child of refsFromArray(object.body, 'Kids')) walk(child);
      return;
    }
    if (/\/Type\s*\/Page\b/.test(object.body)) ordered.push(id);
  };

  if (rootPages) walk(rootPages);
  if (!ordered.length) {
    return [...objects.values()]
      .filter((object) => /\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body))
      .sort((a, b) => a.id - b.id)
      .map((object) => object.id);
  }
  return ordered;
}

function balancedDictionary(text, startIndex) {
  const start = text.indexOf('<<', startIndex);
  if (start < 0) return null;
  let depth = 0;
  for (let index = start; index < text.length - 1; index += 1) {
    const pair = text.slice(index, index + 2);
    if (pair === '<<') { depth += 1; index += 1; continue; }
    if (pair === '>>') {
      depth -= 1;
      index += 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function resourceBody(pageBody, objects) {
  const ref = refFromKey(pageBody, 'Resources');
  if (ref && objects.has(ref)) return objects.get(ref).body;
  const marker = pageBody.indexOf('/Resources');
  return marker >= 0 ? balancedDictionary(pageBody, marker + '/Resources'.length) : null;
}

function fontRefs(pageBody, objects) {
  const resources = resourceBody(pageBody, objects);
  if (!resources) return new Map();
  let fontBlock = null;
  const fontRef = refFromKey(resources, 'Font');
  if (fontRef && objects.has(fontRef)) fontBlock = objects.get(fontRef).body;
  else {
    const marker = resources.indexOf('/Font');
    if (marker >= 0) fontBlock = balancedDictionary(resources, marker + 5);
  }
  if (!fontBlock) return new Map();
  const refs = new Map();
  for (const match of fontBlock.matchAll(/\/([^\s<>\[\]()]+)\s+(\d+)\s+\d+\s+R/g)) refs.set(match[1], Number(match[2]));
  return refs;
}

function decodeUtf16Be(bytes) {
  const codeUnits = [];
  for (let index = 0; index + 1 < bytes.length; index += 2) codeUnits.push((bytes[index] << 8) | bytes[index + 1]);
  return String.fromCharCode(...codeUnits);
}

function hexToUtf16(hex) {
  const cleaned = hex.replace(/\s+/g, '');
  if (!cleaned) return '';
  const bytes = Buffer.from(cleaned.length % 2 ? `${cleaned}0` : cleaned, 'hex');
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16Be(bytes.subarray(2));
  if (bytes.length % 2 === 0 && bytes.some((value, index) => index % 2 === 0 && value === 0)) return decodeUtf16Be(bytes);
  return bytes.toString('utf8');
}

function parseToUnicodeCMap(buffer) {
  const map = new Map();
  if (!buffer) return map;
  const text = buffer.toString('latin1');
  for (const section of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) map.set(pair[1].toUpperCase(), hexToUtf16(pair[2]));
  }
  for (const section of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of section[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(?:<([0-9A-Fa-f]+)>|\[([^\]]+)\])/g)) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const width = range[1].length;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 4096) continue;
      if (range[3]) {
        const destStart = Number.parseInt(range[3], 16);
        for (let value = start; value <= end; value += 1) {
          const src = value.toString(16).toUpperCase().padStart(width, '0');
          const dst = (destStart + value - start).toString(16).toUpperCase().padStart(range[3].length, '0');
          map.set(src, hexToUtf16(dst));
        }
      } else {
        const values = [...range[4].matchAll(/<([0-9A-Fa-f]+)>/g)].map((item) => item[1]);
        values.forEach((dst, index) => {
          const srcValue = start + index;
          if (srcValue <= end) map.set(srcValue.toString(16).toUpperCase().padStart(width, '0'), hexToUtf16(dst));
        });
      }
    }
  }
  return map;
}

function pageFontMaps(pageBody, objects) {
  const result = new Map();
  for (const [alias, fontId] of fontRefs(pageBody, objects)) {
    const font = objects.get(fontId);
    const cmapRef = font ? refFromKey(font.body, 'ToUnicode') : null;
    const cmapObject = cmapRef ? objects.get(cmapRef) : null;
    result.set(alias, parseToUnicodeCMap(cmapObject?.decodedStream));
  }
  return result;
}

function decodePdfString(bytes, cmap) {
  if (!bytes?.length) return '';
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16Be(bytes.subarray(2));
  if (cmap?.size) {
    const lengths = [...new Set([...cmap.keys()].map((key) => key.length / 2))].sort((a, b) => b - a);
    let output = '';
    for (let index = 0; index < bytes.length;) {
      let matched = false;
      for (const length of lengths) {
        if (index + length > bytes.length) continue;
        const key = bytes.subarray(index, index + length).toString('hex').toUpperCase();
        if (cmap.has(key)) {
          output += cmap.get(key);
          index += length;
          matched = true;
          break;
        }
      }
      if (!matched) {
        output += Buffer.from([bytes[index]]).toString('latin1');
        index += 1;
      }
    }
    return output;
  }
  return bytes.toString('latin1');
}

function parseLiteralString(text, start) {
  const bytes = [];
  let depth = 1;
  let index = start + 1;
  while (index < text.length && depth > 0) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      if (next === '\r' && text[index + 2] === '\n') { index += 3; continue; }
      if (next === '\n' || next === '\r') { index += 2; continue; }
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (next in escapes) { bytes.push(escapes[next]); index += 2; continue; }
      if (/[0-7]/.test(next ?? '')) {
        const octal = text.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
        bytes.push(Number.parseInt(octal, 8));
        index += 1 + octal.length;
        continue;
      }
      if (next) { bytes.push(next.charCodeAt(0) & 0xff); index += 2; continue; }
    }
    if (char === '(') { depth += 1; bytes.push(40); index += 1; continue; }
    if (char === ')') {
      depth -= 1;
      if (depth > 0) bytes.push(41);
      index += 1;
      continue;
    }
    bytes.push(char.charCodeAt(0) & 0xff);
    index += 1;
  }
  return { token: { type: 'string', value: Buffer.from(bytes) }, next: index };
}

function tokenizePdfContent(text) {
  let index = 0;
  const parseSequence = (stop = null) => {
    const tokens = [];
    while (index < text.length) {
      const char = text[index];
      if (stop && char === stop) { index += 1; break; }
      if (/\s/.test(char)) { index += 1; continue; }
      if (char === '%') {
        const end = text.indexOf('\n', index);
        index = end < 0 ? text.length : end + 1;
        continue;
      }
      if (char === '(') {
        const parsed = parseLiteralString(text, index);
        tokens.push(parsed.token);
        index = parsed.next;
        continue;
      }
      if (char === '[') {
        index += 1;
        tokens.push({ type: 'array', value: parseSequence(']') });
        continue;
      }
      if (char === '<' && text[index + 1] !== '<') {
        const end = text.indexOf('>', index + 1);
        if (end < 0) break;
        const hex = text.slice(index + 1, end).replace(/\s+/g, '');
        tokens.push({ type: 'string', value: Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex') });
        index = end + 1;
        continue;
      }
      if (char === '/') {
        let end = index + 1;
        while (end < text.length && !/[\s\[\]()<>/%]/.test(text[end])) end += 1;
        tokens.push({ type: 'name', value: text.slice(index + 1, end) });
        index = end;
        continue;
      }
      if (char === '"' || char === "'") {
        tokens.push({ type: 'keyword', value: char });
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < text.length && !/[\s\[\]()<>/%]/.test(text[end])) end += 1;
      const raw = text.slice(index, end);
      if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) tokens.push({ type: 'number', value: Number(raw) });
      else tokens.push({ type: 'keyword', value: raw });
      index = end;
    }
    return tokens;
  };
  return parseSequence();
}

function extractTextFromContent(buffer, fontMaps) {
  if (!buffer) return '';
  const tokens = tokenizePdfContent(buffer.toString('latin1'));
  const output = [];
  let operands = [];
  let currentFont = null;
  let inText = false;
  const emitString = (token) => {
    if (token?.type !== 'string') return;
    output.push(decodePdfString(token.value, fontMaps.get(currentFont)));
  };
  const newline = () => {
    if (output.length && output[output.length - 1] !== '\n') output.push('\n');
  };

  for (const token of tokens) {
    if (token.type !== 'keyword') { operands.push(token); continue; }
    const op = token.value;
    if (op === 'BT') { inText = true; operands = []; continue; }
    if (op === 'ET') { newline(); inText = false; operands = []; continue; }
    if (!inText) { operands = []; continue; }
    if (op === 'Tf') {
      currentFont = operands.find((item) => item.type === 'name')?.value ?? currentFont;
    } else if (op === 'Tj') {
      emitString(operands.at(-1));
    } else if (op === 'TJ') {
      const array = operands.at(-1);
      if (array?.type === 'array') {
        for (const item of array.value) {
          if (item.type === 'string') emitString(item);
          else if (item.type === 'number' && item.value < -120) output.push(' ');
        }
      }
    } else if (op === "'") {
      newline(); emitString(operands.at(-1));
    } else if (op === '"') {
      newline();
      const stringOperand = [...operands].reverse().find((item) => item.type === 'string');
      emitString(stringOperand);
    } else if (op === 'T*' || op === 'Td' || op === 'TD') {
      newline();
    }
    operands = [];
  }

  return cleanText(output.join(''))
    .split('\n')
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .join('\n');
}

function pageContentRefs(pageBody) {
  const refs = refsFromArray(pageBody, 'Contents');
  if (refs.length) return refs;
  const single = refFromKey(pageBody, 'Contents');
  return single ? [single] : [];
}

export function extractDigitalPdf(input, { documentId = null, maxBytes = 64 * 1024 * 1024 } = {}) {
  const buffer = asBuffer(input);
  if (buffer.length > maxBytes) throw contentError('PDF excede o limite configurado para importação.', 'FENIX_PDF_TOO_LARGE', { maxBytes });
  if (!buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) throw contentError('Arquivo não possui cabeçalho PDF válido.', 'FENIX_PDF_HEADER_INVALID');
  const { binary, objects } = parsePdfObjects(buffer);
  if (/\/Encrypt\b/.test(binary)) throw contentError('PDF criptografado não é suportado neste marco.', 'FENIX_PDF_ENCRYPTED_UNSUPPORTED');
  const pages = [];
  const orderedPageIds = pageOrder(objects);
  for (let index = 0; index < orderedPageIds.length; index += 1) {
    const pageObject = objects.get(orderedPageIds[index]);
    const fonts = pageFontMaps(pageObject.body, objects);
    const parts = [];
    for (const contentId of pageContentRefs(pageObject.body)) {
      const content = objects.get(contentId);
      if (!content?.decodedStream) continue;
      const text = extractTextFromContent(content.decodedStream, fonts);
      if (text) parts.push(text);
    }
    pages.push(Object.freeze({ pageNumber: index + 1, objectId: pageObject.id, text: parts.join('\n').trim() }));
  }
  const extractedCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);
  if (!pages.length || extractedCharacters < 8) {
    throw contentError('Nenhuma camada de texto utilizável foi encontrada. OCR não faz parte deste marco.', 'FENIX_PDF_TEXT_LAYER_REQUIRED');
  }
  return Object.freeze({
    schema: 'fenix.pdf-text-document',
    version: 1,
    documentId: documentId || stableId(buffer.subarray(0, Math.min(buffer.length, 1024 * 1024))),
    pageCount: pages.length,
    extractedCharacters,
    pages
  });
}

const LANGUAGE_WORDS = Object.freeze({
  pt: ['de', 'da', 'do', 'das', 'dos', 'e', 'que', 'uma', 'um', 'para', 'com', 'porta', 'sala', 'teste', 'mestre'],
  en: ['the', 'of', 'and', 'to', 'a', 'with', 'door', 'room', 'check', 'treasure', 'player', 'secret'],
  es: ['de', 'la', 'el', 'y', 'que', 'una', 'un', 'con', 'puerta', 'sala', 'prueba', 'secreto'],
  fr: ['de', 'la', 'le', 'et', 'que', 'une', 'un', 'avec', 'porte', 'salle', 'test', 'secret']
});

export function detectDocumentLanguage(value) {
  const words = cleanText(value).toLowerCase().normalize('NFKC').match(/[\p{L}\p{M}]+/gu) ?? [];
  const scores = {};
  for (const [language, vocabulary] of Object.entries(LANGUAGE_WORDS)) {
    const set = new Set(vocabulary);
    scores[language] = words.reduce((score, word) => score + (set.has(word) ? 1 : 0), 0);
  }
  if (/[ãõçáéíóúâêô]/i.test(value)) scores.pt += 3;
  if (/[ñ¡¿]/i.test(value)) scores.es += 3;
  if (/[àâçéèêëîïôùûüÿœ]/i.test(value)) scores.fr += 2;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [language, score] = ranked[0] ?? ['und', 0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  const confidence = score <= 0 ? 0 : Math.max(0.2, Math.min(0.99, (score - runnerUp + 1) / Math.max(2, score + 1)));
  return Object.freeze({ language: score > 0 ? language : 'und', confidence, scores: Object.freeze(scores) });
}

function headingKind(line) {
  if (/^(?:chapter|cap[ií]tulo|chapitre)\s+[\divxlc]+\b/i.test(line)) return 'chapter';
  if (/^(?:area|room|sala|área)\s+[A-Z0-9][A-Z0-9.-]*\b/i.test(line)) return 'area';
  if (/^[A-Z0-9]{1,4}[.:-]\s+\S+/.test(line) && line.length <= 100) return 'area';
  if (/^\d+[A-Za-z]?[.:-]\s+\S+/.test(line) && line.length <= 100) return 'area';
  return null;
}

const READ_ALOUD = /^(?:read\s*aloud|boxed\s*text|player\s*text|leia\s+em\s+voz\s+alta|texto\s+para\s+os\s+jogadores|narra[cç][aã]o)\s*[:—-]\s*(.+)$/i;
const GM_NOTE = /^(?:(?:gm|dm|game\s*master|mestre)\s*(?:note|notes|nota|notas))\s*[:—-]\s*(.+)$/i;
const SECRET = /^(?:secret|segredo)\s*[:—-]\s*(.+)$/i;
const TREASURE = /\b(?:treasure|reward|loot|tesouro|recompensa)\b/i;
const CHECK_PATTERNS = [
  /\b(?:DC|CD)\s*(\d{1,3})\b(?:\s*[-—,:]?\s*([\p{L}][\p{L}\s-]{1,40}))?/iu,
  /\b([\p{L}][\p{L}\s-]{1,40}?)\s+(?:check|teste)\s*(?:\(|,|:)?\s*(?:DC|CD)\s*(\d{1,3})\b/iu
];

function provenance(documentId, pageNumber, section = null) {
  return Object.freeze({ type: 'pdf', documentId, page: pageNumber, section });
}

function addChunk(chunks, { documentId, pageNumber, sectionId, sectionTitle, type, text, visibility = 'gm', revealKey = null }) {
  const normalized = normalizeLine(text);
  if (!normalized) return null;
  const chunk = Object.freeze({
    id: stableId(documentId, pageNumber, sectionId, type, normalized),
    type,
    sectionId,
    sectionTitle,
    visibility,
    revealKey,
    originalText: normalized,
    localized: {},
    source: provenance(documentId, pageNumber, sectionTitle)
  });
  chunks.push(chunk);
  return chunk;
}

function extractCheck(line, source) {
  for (const pattern of CHECK_PATTERNS) {
    const match = pattern.exec(line);
    if (!match) continue;
    const secondIsNumber = /^\d+$/.test(match[2] ?? '');
    const dc = Number(secondIsNumber ? match[2] : match[1]);
    const label = normalizeLine(secondIsNumber ? match[1] : match[2]);
    if (!Number.isInteger(dc)) continue;
    return Object.freeze({ id: stableId('check', source.documentId, source.page, line), type: 'check', dc, label: label || null, originalText: line, source });
  }
  return null;
}

export function compileAdventureDocument(document, { title = null, sourceLanguage = null } = {}) {
  if (!document?.pages?.length) throw contentError('Documento extraído sem páginas.', 'FENIX_ADVENTURE_DOCUMENT_EMPTY');
  const allText = document.pages.map((page) => page.text).join('\n');
  const detected = sourceLanguage ? { language: sourceLanguage, confidence: 1, scores: {} } : detectDocumentLanguage(allText.slice(0, 100_000));
  const chapters = [];
  const sections = [];
  const readAloud = [];
  const gmNotes = [];
  const secrets = [];
  const checks = [];
  const treasures = [];
  const chunks = [];
  let currentChapter = null;
  let currentSection = null;

  const ensureSection = (pageNumber) => {
    if (currentSection) return currentSection;
    currentSection = {
      id: stableId(document.documentId, 'page', pageNumber),
      title: `Page ${pageNumber}`,
      kind: 'page',
      chapterId: currentChapter?.id ?? null,
      source: provenance(document.documentId, pageNumber, `Page ${pageNumber}`)
    };
    sections.push(currentSection);
    return currentSection;
  };

  for (const page of document.pages) {
    const lines = cleanText(page.text).split('\n').map(normalizeLine).filter(Boolean);
    for (const line of lines) {
      const kind = headingKind(line);
      if (kind === 'chapter') {
        currentChapter = Object.freeze({ id: stableId(document.documentId, 'chapter', line), title: line, source: provenance(document.documentId, page.pageNumber, line) });
        chapters.push(currentChapter);
        currentSection = null;
        continue;
      }
      if (kind === 'area') {
        currentSection = Object.freeze({
          id: stableId(document.documentId, 'area', line),
          title: line,
          kind: 'area',
          chapterId: currentChapter?.id ?? null,
          source: provenance(document.documentId, page.pageNumber, line)
        });
        sections.push(currentSection);
        continue;
      }
      const section = ensureSection(page.pageNumber);
      const source = provenance(document.documentId, page.pageNumber, section.title);

      const read = READ_ALOUD.exec(line);
      if (read) {
        const chunk = addChunk(chunks, { documentId: document.documentId, pageNumber: page.pageNumber, sectionId: section.id, sectionTitle: section.title, type: 'read-aloud', text: read[1], visibility: 'player' });
        readAloud.push(Object.freeze({ id: chunk.id, sectionId: section.id, originalText: chunk.originalText, source }));
        continue;
      }
      const gm = GM_NOTE.exec(line);
      if (gm) {
        const chunk = addChunk(chunks, { documentId: document.documentId, pageNumber: page.pageNumber, sectionId: section.id, sectionTitle: section.title, type: 'gm-note', text: gm[1], visibility: 'gm' });
        gmNotes.push(Object.freeze({ id: chunk.id, sectionId: section.id, originalText: chunk.originalText, source }));
        continue;
      }
      const secret = SECRET.exec(line);
      if (secret) {
        const secretId = stableId(document.documentId, page.pageNumber, section.id, 'secret', secret[1]);
        addChunk(chunks, { documentId: document.documentId, pageNumber: page.pageNumber, sectionId: section.id, sectionTitle: section.title, type: 'secret', text: secret[1], visibility: 'conditional', revealKey: secretId });
        secrets.push(Object.freeze({ id: secretId, sectionId: section.id, policy: 'conditional', originalText: normalizeLine(secret[1]), source }));
        continue;
      }

      const check = extractCheck(line, source);
      if (check) checks.push(check);
      if (TREASURE.test(line)) treasures.push(Object.freeze({ id: stableId('treasure', document.documentId, page.pageNumber, line), sectionId: section.id, originalText: line, source }));
      addChunk(chunks, { documentId: document.documentId, pageNumber: page.pageNumber, sectionId: section.id, sectionTitle: section.title, type: 'gm-prose', text: line, visibility: 'gm' });
    }
  }

  return Object.freeze({
    schema: 'fenix.adventure-model',
    version: 1,
    id: stableId('adventure', document.documentId),
    title: title || `Imported Adventure ${document.documentId.slice(0, 8)}`,
    source: Object.freeze({ type: 'pdf', documentId: document.documentId, pageCount: document.pageCount }),
    language: Object.freeze({ source: detected.language, confidence: detected.confidence, target: null }),
    chapters: Object.freeze(chapters),
    sections: Object.freeze(sections),
    entities: Object.freeze({
      readAloud: Object.freeze(readAloud),
      gmNotes: Object.freeze(gmNotes),
      secrets: Object.freeze(secrets),
      checks: Object.freeze(checks),
      treasures: Object.freeze(treasures)
    }),
    chunks: Object.freeze(chunks),
    stats: Object.freeze({ pages: document.pageCount, chunks: chunks.length, readAloud: readAloud.length, secrets: secrets.length, checks: checks.length, treasures: treasures.length })
  });
}

function numbersSignature(value) {
  return (String(value ?? '').match(/\b\d+(?:[.,]\d+)?\b/g) ?? []).map((item) => item.replace(',', '.'));
}

function validateMechanicalFacts(original, localized) {
  const before = numbersSignature(original);
  const after = numbersSignature(localized);
  if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
    throw contentError('A localização alterou valores numéricos protegidos.', 'FENIX_LOCALIZATION_MECHANICAL_FACT_CHANGED', { before, after });
  }
}

export function createAiGatewayTranslator({ gateway, glossary = {} } = {}) {
  if (!gateway?.generateText) throw contentError('AI Gateway inválido para localização.', 'FENIX_LOCALIZATION_GATEWAY_INVALID');
  return async ({ text, sourceLanguage, targetLanguage }) => {
    const glossaryLines = Object.entries(glossary).map(([source, target]) => `${source} => ${target}`).join('\n');
    const result = await gateway.generateText({
      system: [
        'Você é o localizador do Fênix VTT.',
        'Traduza fielmente o texto de RPG sem adicionar, remover ou alterar fatos.',
        'Preserve exatamente todos os números, DC/CD, quantidades, distâncias e nomes próprios.',
        'Responda apenas com o texto traduzido, sem comentários.',
        glossaryLines ? `Glossário obrigatório:\n${glossaryLines}` : ''
      ].filter(Boolean).join('\n'),
      prompt: `Idioma de origem: ${sourceLanguage}\nIdioma de destino: ${targetLanguage}\n\n${text}`,
      temperature: 0.1,
      maxTokens: Math.max(200, Math.ceil(String(text).length * 1.5))
    });
    return result.content;
  };
}

export async function localizeAdventureModel(model, { targetLanguage = 'pt-BR', translator = null } = {}) {
  const sourceLanguage = model?.language?.source ?? 'und';
  const sourceBase = sourceLanguage.toLowerCase().split('-')[0];
  const targetBase = targetLanguage.toLowerCase().split('-')[0];
  const translate = typeof translator === 'function' ? translator : translator?.translate?.bind(translator);
  if (sourceBase !== targetBase && !translate) throw contentError('Localizador é obrigatório quando o idioma de origem difere do destino.', 'FENIX_LOCALIZER_REQUIRED');

  const chunks = [];
  for (const chunk of model.chunks) {
    let localizedText = chunk.originalText;
    if (sourceBase !== targetBase) {
      localizedText = normalizeLine(await translate({ text: chunk.originalText, sourceLanguage, targetLanguage, source: chunk.source }));
      validateMechanicalFacts(chunk.originalText, localizedText);
    }
    chunks.push(Object.freeze({ ...chunk, localized: Object.freeze({ ...chunk.localized, [targetLanguage]: localizedText }) }));
  }
  return Object.freeze({ ...model, language: Object.freeze({ ...model.language, target: targetLanguage }), chunks: Object.freeze(chunks) });
}

function tokens(value) {
  return new Set(cleanText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z0-9]+/g) ?? []);
}

function overlapScore(queryTokens, textValue) {
  if (!queryTokens.size) return 0;
  const textTokens = tokens(textValue);
  let score = 0;
  for (const token of queryTokens) if (textTokens.has(token)) score += 1;
  return score / queryTokens.size;
}

export function retrieveAdventureKnowledge(model, { query = '', sectionId = null, visibility = 'player', revealedSecretIds = [], language = 'pt-BR', limit = 8 } = {}) {
  const revealed = new Set(revealedSecretIds);
  const queryTokens = tokens(query);
  const ranked = [];
  for (const chunk of model?.chunks ?? []) {
    const allowed = visibility === 'gm'
      ? true
      : chunk.visibility === 'player' || (chunk.visibility === 'conditional' && chunk.revealKey && revealed.has(chunk.revealKey));
    if (!allowed) continue;
    const textValue = chunk.localized?.[language] || chunk.originalText;
    let score = overlapScore(queryTokens, `${chunk.sectionTitle} ${textValue}`);
    if (sectionId && chunk.sectionId === sectionId) score += 2;
    if (!query && !sectionId) score += chunk.type === 'read-aloud' ? 1 : 0;
    ranked.push({ chunk, text: textValue, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.chunk.source.page - b.chunk.source.page);
  return Object.freeze(ranked.slice(0, Math.max(1, Number(limit) || 8)).map(({ chunk, text: value, score }) => Object.freeze({
    id: chunk.id,
    type: chunk.type,
    sectionId: chunk.sectionId,
    sectionTitle: chunk.sectionTitle,
    text: value,
    score,
    source: chunk.source
  })));
}

export function buildMestreKnowledgeContext(model, options = {}) {
  const chunks = retrieveAdventureKnowledge(model, options);
  return Object.freeze({
    schema: 'fenix.mestre-knowledge-context',
    version: 1,
    adventureId: model.id,
    language: options.language ?? model.language?.target ?? model.language?.source ?? 'und',
    chunks,
    text: chunks.map((chunk) => `[${chunk.sectionTitle} · p.${chunk.source.page}] ${chunk.text}`).join('\n\n')
  });
}

export async function importDigitalPdfAdventure(input, options = {}) {
  const extracted = extractDigitalPdf(input, options);
  const compiled = compileAdventureDocument(extracted, options);
  if (options.localize === false) return compiled;
  return localizeAdventureModel(compiled, options);
}
