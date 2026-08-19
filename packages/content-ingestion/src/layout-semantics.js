import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { extractDigitalPdf } from './index.js';

function fail(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw fail('PDF inválido para análise de layout.', 'FENIX_PDF_LAYOUT_INPUT_INVALID');
}

function clean(value) { return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim(); }
function id(...parts) { return crypto.createHash('sha256').update(parts.join('\u241f')).digest('hex').slice(0, 24); }

function decodeStream(dict, raw) {
  if (!raw) return null;
  if (/\/Filter\s*\/FlateDecode\b/.test(dict) || /\/Filter\s*\[[^\]]*\/FlateDecode\b[^\]]*\]/s.test(dict)) {
    try { return zlib.inflateSync(raw); } catch { return null; }
  }
  return /\/Filter\b/.test(dict) ? null : raw;
}

function parseObjects(buffer) {
  const binary = buffer.toString('latin1');
  const objects = new Map();
  const pattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = pattern.exec(binary))) {
    const end = binary.indexOf('endobj', pattern.lastIndex);
    if (end < 0) break;
    const body = binary.slice(pattern.lastIndex, end);
    const streamMarker = /stream(?:\r\n|\n|\r)/.exec(body);
    let dict = body.trim();
    let decodedStream = null;
    if (streamMarker) {
      const start = streamMarker.index + streamMarker[0].length;
      const streamEnd = body.indexOf('endstream', start);
      if (streamEnd >= 0) {
        dict = body.slice(0, streamMarker.index).trim();
        let raw = body.slice(start, streamEnd);
        if (raw.endsWith('\r\n')) raw = raw.slice(0, -2);
        else if (raw.endsWith('\n') || raw.endsWith('\r')) raw = raw.slice(0, -1);
        decodedStream = decodeStream(dict, Buffer.from(raw, 'latin1'));
      }
    }
    objects.set(Number(match[1]), { id: Number(match[1]), body, dict, decodedStream });
    pattern.lastIndex = end + 6;
  }
  return objects;
}

function ref(body, key) {
  const match = new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`).exec(body);
  return match ? Number(match[1]) : null;
}

function refs(body, key) {
  const value = new RegExp(`/${key}\\s*\\[([\\s\\S]*?)\\]`).exec(body)?.[1];
  return value ? [...value.matchAll(/(\d+)\s+\d+\s+R/g)].map((match) => Number(match[1])) : [];
}

function orderedPages(objects) {
  const catalog = [...objects.values()].find((object) => /\/Type\s*\/Catalog\b/.test(object.body));
  const root = catalog ? ref(catalog.body, 'Pages') : null;
  const result = [];
  const seen = new Set();
  const walk = (objectId) => {
    if (!objectId || seen.has(objectId)) return;
    seen.add(objectId);
    const object = objects.get(objectId);
    if (!object) return;
    if (/\/Type\s*\/Pages\b/.test(object.body)) {
      refs(object.body, 'Kids').forEach(walk);
    } else if (/\/Type\s*\/Page\b/.test(object.body)) {
      result.push(objectId);
    }
  };
  if (root) walk(root);
  return result.length ? result : [...objects.values()]
    .filter((object) => /\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body))
    .sort((a, b) => a.id - b.id).map((object) => object.id);
}

function pageStreams(body) {
  const many = refs(body, 'Contents');
  if (many.length) return many;
  const one = ref(body, 'Contents');
  return one ? [one] : [];
}

function pageBox(body) {
  const match = /\/MediaBox\s*\[\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*\]/.exec(body);
  if (!match) return { x: 0, y: 0, width: 612, height: 792 };
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return { x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) };
}

function literal(text, start) {
  const bytes = [];
  let depth = 1;
  let cursor = start + 1;
  while (cursor < text.length && depth) {
    const char = text[cursor];
    if (char === '\\') {
      const next = text[cursor + 1];
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (next in escapes) { bytes.push(escapes[next]); cursor += 2; continue; }
      if (next === '\r' && text[cursor + 2] === '\n') { cursor += 3; continue; }
      if (next === '\n' || next === '\r') { cursor += 2; continue; }
      if (/[0-7]/.test(next ?? '')) {
        const octal = text.slice(cursor + 1, cursor + 4).match(/^[0-7]{1,3}/)?.[0] ?? next;
        bytes.push(Number.parseInt(octal, 8)); cursor += 1 + octal.length; continue;
      }
      if (next) { bytes.push(next.charCodeAt(0) & 0xff); cursor += 2; continue; }
    }
    if (char === '(') { depth += 1; bytes.push(40); cursor += 1; continue; }
    if (char === ')') { depth -= 1; if (depth) bytes.push(41); cursor += 1; continue; }
    bytes.push(char.charCodeAt(0) & 0xff); cursor += 1;
  }
  return { token: { type: 'string', value: Buffer.from(bytes) }, cursor };
}

function tokenize(text) {
  let cursor = 0;
  const parse = (stop = null) => {
    const output = [];
    while (cursor < text.length) {
      const char = text[cursor];
      if (stop && char === stop) { cursor += 1; break; }
      if (/\s/.test(char)) { cursor += 1; continue; }
      if (char === '%') { const end = text.indexOf('\n', cursor); cursor = end < 0 ? text.length : end + 1; continue; }
      if (char === '(') { const result = literal(text, cursor); output.push(result.token); cursor = result.cursor; continue; }
      if (char === '[') { cursor += 1; output.push({ type: 'array', value: parse(']') }); continue; }
      if (char === '<' && text[cursor + 1] !== '<') {
        const end = text.indexOf('>', cursor + 1); if (end < 0) break;
        const hex = text.slice(cursor + 1, end).replace(/\s+/g, '');
        output.push({ type: 'string', value: Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex') }); cursor = end + 1; continue;
      }
      if (char === '/') {
        let end = cursor + 1; while (end < text.length && !/[\s\[\]()<>/%]/.test(text[end])) end += 1;
        output.push({ type: 'name', value: text.slice(cursor + 1, end) }); cursor = end; continue;
      }
      if (char === '"' || char === "'") { output.push({ type: 'keyword', value: char }); cursor += 1; continue; }
      let end = cursor + 1; while (end < text.length && !/[\s\[\]()<>/%]/.test(text[end])) end += 1;
      const raw = text.slice(cursor, end);
      output.push(/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw) ? { type: 'number', value: Number(raw) } : { type: 'keyword', value: raw });
      cursor = end;
    }
    return output;
  };
  return parse();
}

function basicText(buffer) {
  if (!buffer?.length) return '';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const units = [];
    for (let i = 2; i + 1 < buffer.length; i += 2) units.push((buffer[i] << 8) | buffer[i + 1]);
    return String.fromCharCode(...units);
  }
  return buffer.toString('latin1');
}

function numbers(operands) { return operands.filter((item) => item.type === 'number').map((item) => item.value); }

function geometry(stream) {
  const runs = [];
  const rectangles = [];
  const warnings = [];
  if (!stream) return { runs, rectangles, warnings: ['content-stream-unavailable'] };
  const tokens = tokenize(stream.toString('latin1'));
  let operands = [];
  let inText = false;
  let fontAlias = null;
  let fontSize = 12;
  let x = 0, y = 0, lineX = 0, lineY = 0, leading = 0;

  const nextLine = () => { lineY -= leading || Math.max(12, fontSize * 1.2); x = lineX; y = lineY; };
  const emit = (token) => {
    if (token?.type !== 'string') return;
    const text = clean(basicText(token.value));
    if (!text) return;
    const width = Math.max(fontSize * 0.35, text.length * fontSize * 0.48);
    runs.push({ id: id('run', runs.length, x, y, text), text, x, y, width, height: fontSize * 1.15, fontAlias, fontSize });
    x += width;
  };

  for (const token of tokens) {
    if (token.type !== 'keyword') { operands.push(token); continue; }
    const op = token.value;
    if (op === 'BT') { inText = true; x = y = lineX = lineY = 0; operands = []; continue; }
    if (op === 'ET') { inText = false; operands = []; continue; }
    if (!inText && op === 're') {
      const values = numbers(operands).slice(-4);
      if (values.length === 4) rectangles.push({ id: id('rect', rectangles.length, ...values), x: values[0], y: values[1], width: values[2], height: values[3] });
      operands = []; continue;
    }
    if (!inText) { operands = []; continue; }

    if (op === 'Tf') {
      fontAlias = operands.find((item) => item.type === 'name')?.value ?? fontAlias;
      const size = [...operands].reverse().find((item) => item.type === 'number')?.value;
      if (Number.isFinite(size) && size > 0) fontSize = size;
    } else if (op === 'Tm') {
      const values = numbers(operands).slice(-6);
      if (values.length === 6) { lineX = values[4]; lineY = values[5]; x = lineX; y = lineY; }
    } else if (op === 'Td' || op === 'TD') {
      const values = numbers(operands).slice(-2);
      if (values.length === 2) {
        lineX += values[0]; lineY += values[1]; x = lineX; y = lineY;
        if (op === 'TD') leading = -values[1];
      }
    } else if (op === 'TL') {
      const value = numbers(operands).at(-1); if (Number.isFinite(value)) leading = value;
    } else if (op === 'T*') nextLine();
    else if (op === 'Tj') emit(operands.at(-1));
    else if (op === 'TJ') {
      const array = operands.at(-1);
      if (array?.type === 'array') for (const item of array.value) {
        if (item.type === 'string') emit(item);
        else if (item.type === 'number' && item.value < -120) x += fontSize * 0.35;
      }
    } else if (op === "'") { nextLine(); emit(operands.at(-1)); }
    else if (op === '"') { nextLine(); emit([...operands].reverse().find((item) => item.type === 'string')); }
    operands = [];
  }
  if (runs.some((run) => /[^\x20-\x7EÀ-ÿ]/.test(run.text))) warnings.push('basic-font-decoding-may-be-incomplete');
  return { runs, rectangles, warnings };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 12;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function linesFromRuns(runs, extractedText) {
  const groups = [];
  for (const run of [...runs].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const tolerance = Math.max(2, run.fontSize * 0.38);
    let group = groups.find((item) => Math.abs(item.y - run.y) <= tolerance);
    if (!group) { group = { y: run.y, runs: [] }; groups.push(group); }
    group.runs.push(run);
  }
  groups.sort((a, b) => b.y - a.y);
  const extracted = String(extractedText ?? '').split('\n').map(clean).filter(Boolean);
  const canMap = groups.length > 0 && Math.abs(extracted.length - groups.length) <= Math.max(2, Math.ceil(groups.length * 0.25));
  return groups.map((group, index) => {
    group.runs.sort((a, b) => a.x - b.x);
    const rawText = clean(group.runs.map((run) => run.text).join(' '));
    const mapped = canMap ? extracted[index] : '';
    const fontSize = Math.max(...group.runs.map((run) => run.fontSize));
    const x = Math.min(...group.runs.map((run) => run.x));
    const right = Math.max(...group.runs.map((run) => run.x + run.width));
    return { id: id('line', index, group.y, mapped || rawText), text: mapped || rawText, rawText, x, y: group.y, width: right - x, height: fontSize * 1.2, fontSize, mappingConfidence: mapped ? 1 : rawText ? 0.58 : 0.2 };
  });
}

const READ_LABEL = /^(?:read\s*aloud|boxed\s*text|player\s*text|leia\s+em\s+voz\s+alta|texto\s+para\s+os\s+jogadores|narra[cç][aã]o)\s*[:—-]?/i;
const HEADING = /^(?:chapter|cap[ií]tulo|chapitre|area|room|sala|área)\b|^\d+[A-Za-z]?[.:-]\s+\S+/i;

function contains(rect, line) {
  const pad = 4;
  return line.x >= rect.x - pad && line.x <= rect.x + rect.width + pad && line.y >= rect.y - pad && line.y <= rect.y + rect.height + pad;
}

function analyze(pageNumber, mediaBox, lines, rectangles, warnings) {
  const weightedFonts = [];
  for (const line of lines) for (let i = 0; i < Math.max(1, Math.min(20, Math.ceil(line.text.length / 12))); i += 1) weightedFonts.push(line.fontSize);
  const bodyFontSize = median(weightedFonts);
  const candidates = [];

  for (const line of lines) {
    const ratio = line.fontSize / Math.max(1, bodyFontSize);
    if (line.text.length <= 140 && ratio >= 1.25 && line.fontSize >= bodyFontSize + 1.5) {
      let confidence = 0.68 + Math.min(0.18, (ratio - 1.25) * 0.35) + (HEADING.test(line.text) ? 0.12 : 0);
      candidates.push({ id: id('heading', pageNumber, line.id), kind: 'heading', proposedType: 'section-heading', text: line.text, confidence: Math.min(0.98, confidence), pageNumber, bounds: { x: line.x, y: line.y, width: line.width, height: line.height }, evidence: { method: 'font-size', bodyFontSize, fontSize: line.fontSize, ratio, mappingConfidence: line.mappingConfidence } });
    }
  }

  for (const rectangle of rectangles) {
    if (rectangle.width < mediaBox.width * 0.22 || rectangle.height < bodyFontSize * 1.5) continue;
    if (rectangle.width > mediaBox.width * 0.96 && rectangle.height > mediaBox.height * 0.8) continue;
    const inside = lines.filter((line) => contains(rectangle, line)).sort((a, b) => b.y - a.y || a.x - b.x);
    const combined = clean(inside.map((line) => line.text).join(' '));
    if (!inside.length || combined.length < 24) continue;
    const mappingConfidence = inside.reduce((sum, line) => sum + line.mappingConfidence, 0) / inside.length;
    let confidence = 0.78 + (inside.length >= 2 ? 0.07 : 0) + (combined.length >= 60 ? 0.05 : 0) + (rectangle.width < mediaBox.width * 0.9 ? 0.03 : 0) + (rectangle.height < mediaBox.height * 0.45 ? 0.02 : 0) + (READ_LABEL.test(combined) ? 0.12 : 0) - (mappingConfidence < 0.75 ? 0.12 : 0);
    confidence = Math.max(0.4, Math.min(0.99, confidence));
    candidates.push({ id: id('box', pageNumber, rectangle.id, combined), kind: 'boxed-text', proposedType: 'read-aloud', text: combined.replace(READ_LABEL, '').trim(), confidence, pageNumber, bounds: { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }, evidence: { method: 'enclosing-rectangle', rectangleId: rectangle.id, lineIds: inside.map((line) => line.id), bodyFontSize, mappingConfidence, labeled: READ_LABEL.test(combined) } });
  }

  return Object.freeze({ pageNumber, mediaBox: Object.freeze(mediaBox), bodyFontSize, lines: Object.freeze(lines.map(Object.freeze)), rectangles: Object.freeze(rectangles.map(Object.freeze)), candidates: Object.freeze(candidates.sort((a, b) => b.confidence - a.confidence).map(Object.freeze)), warnings: Object.freeze([...new Set(warnings)]) });
}

export function extractPdfLayoutSemantics(input, { documentId = null, extractedDocument = null } = {}) {
  const buffer = asBuffer(input);
  const extracted = extractedDocument ?? extractDigitalPdf(buffer, { documentId });
  const objects = parseObjects(buffer);
  const pages = [];
  const warnings = [];
  for (const [index, pageId] of orderedPages(objects).entries()) {
    const page = objects.get(pageId);
    if (!page) continue;
    const pageGeometry = { runs: [], rectangles: [], warnings: [] };
    for (const streamId of pageStreams(page.body)) {
      const stream = objects.get(streamId)?.decodedStream;
      const part = geometry(stream);
      pageGeometry.runs.push(...part.runs);
      pageGeometry.rectangles.push(...part.rectangles);
      pageGeometry.warnings.push(...part.warnings);
    }
    pages.push(analyze(index + 1, pageBox(page.body), linesFromRuns(pageGeometry.runs, extracted.pages[index]?.text), pageGeometry.rectangles, pageGeometry.warnings));
  }
  if (pages.length !== extracted.pageCount) warnings.push('layout-page-count-mismatch');
  return Object.freeze({ schema: 'fenix.pdf-layout-semantics', version: 1, documentId: extracted.documentId, pageCount: extracted.pageCount, pages: Object.freeze(pages), stats: Object.freeze({ lines: pages.reduce((n, page) => n + page.lines.length, 0), rectangles: pages.reduce((n, page) => n + page.rectangles.length, 0), candidates: pages.reduce((n, page) => n + page.candidates.length, 0), boxedTextCandidates: pages.reduce((n, page) => n + page.candidates.filter((candidate) => candidate.kind === 'boxed-text').length, 0), headingCandidates: pages.reduce((n, page) => n + page.candidates.filter((candidate) => candidate.kind === 'heading').length, 0) }), warnings: Object.freeze(warnings) });
}
