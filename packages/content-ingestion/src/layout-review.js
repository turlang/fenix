import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {
  compileAdventureDocument,
  extractDigitalPdf,
  localizeAdventureModel
} from './index.js';

function layoutError(message, code, details = null) {
  const error = new Error(message);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw layoutError('PDF deve ser fornecido como Buffer, Uint8Array ou ArrayBuffer.', 'FENIX_PDF_LAYOUT_INPUT_INVALID');
}

function clean(value) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function decodeStream(dict, raw) {
  if (!raw) return null;
  if (/\/Filter\s*\/FlateDecode\b/.test(dict) || /\/Filter\s*\[[^\]]*\/FlateDecode\b[^\]]*\]/s.test(dict)) {
    try { return zlib.inflateSync(raw); }
    catch { return null; }
  }
  if (/\/Filter\b/.test(dict)) return null;
  return raw;
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
    const streamMatch = /stream(?:\r\n|\n|\r)/.exec(body);
    let dict = body.trim();
    let decodedStream = null;
    if (streamMatch) {
      const streamStart = streamMatch.index + streamMatch[0].length;
      const endStream = body.indexOf('endstream', streamStart);
      if (endStream >= 0) {
        dict = body.slice(0, streamMatch.index).trim();
        let raw = body.slice(streamStart, endStream);
        if (raw.endsWith('\r\n')) raw = raw.slice(0, -2);
        else if (raw.endsWith('\n') || raw.endsWith('\r')) raw = raw.slice(0, -1);
        decodedStream = decodeStream(dict, Buffer.from(raw, 'latin1'));
      }
    }
    objects.set(Number(match[1]), {
      id: Number(match[1]),
      body,
      dict,
      decodedStream
    });
    pattern.lastIndex = end + 6;
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
  const root = catalog ? refFromKey(catalog.body, 'Pages') : null;
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
  if (root) walk(root);
  if (ordered.length) return ordered;
  return [...objects.values()]
    .filter((object) => /\/Type\s*\/Page\b/.test(object.body) && !/\/Type\s*\/Pages\b/.test(object.body))
    .sort((a, b) => a.id - b.id)
    .map((object) => object.id);
}

function pageContentRefs(pageBody) {
  const refs = refsFromArray(pageBody, 'Contents');
  if (refs.length) return refs;
  const one = refFromKey(pageBody, 'Contents');
  return one ? [one] : [];
}

function mediaBox(pageBody) {
  const match = /\/MediaBox\s*\[\s*([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s+([+-]?[\d.]+)\s*\]/.exec(pageBody);
  if (!match) return Object.freeze({ x: 0, y: 0, width: 612, height: 792 });
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  return Object.freeze({ x: x1, y: y1, width: Math.max(1, x2 - x1), height: Math.max(1, y2 - y1) });
}

function parseLiteral(text, start) {
  const bytes = [];
  let depth = 1;
  let index = start + 1;
  while (index < text.length && depth > 0) {
    const char = text[index];
    if (char === '\\') {
      const next = text[index + 1];
      const escapes = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (next in escapes) { bytes.push(escapes[next]); index += 2; continue; }
      if (next === '\r' && text[index + 2] === '\n') { index += 3; continue; }
      if (next === '\n' || next === '\r') { index += 2; continue; }
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

function tokenize(text) {
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
        const parsed = parseLiteral(text, index);
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

function decodeBasicString(buffer) {
  if (!buffer?.length) return '';
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const units = [];
    for (let i = 2; i + 1 < buffer.length; i += 2) units.push((buffer[i] << 8) | buffer[i + 1]);
    return String.fromCharCode(...units);
  }
  return buffer.toString('latin1');
}

function numberOperands(operands) {
  return operands.filter((item) => item.type === 'number').map((item) => item.value);
}

function contentGeometry(buffer) {
  if (!buffer) return { runs: [], rectangles: [], warnings: ['content-stream-unavailable'] };
  const tokens = tokenize(buffer.toString('latin1'));
  const runs = [];
  const rectangles = [];
  const warnings = [];
  let operands = [];
  let inText = false;
  let fontAlias = null;
  let fontSize = 12;
  let x = 0;
  let y = 0;
  let leading = 0;

  const advanceLine = () => { y -= leading || Math.max(12, fontSize * 1.2); };
  const emit = (token) => {
    if (token?.type !== 'string') return;
    const value = clean(decodeBasicString(token.value));
    if (!value) return;
    const width = Math.max(fontSize * 0.35, value.length * fontSize * 0.48);
    runs.push({
      id: stableId('run', runs.length, x, y, value),
      text: value,
      x,
      y,
      width,
      height: Math.max(1, fontSize * 1.15),
      fontAlias,
      fontSize
    });
    x += width;
  };

  for (const token of tokens) {
    if (token.type !== 'keyword') { operands.push(token); continue; }
    const op = token.value;
    if (op === 'BT') { inText = true; operands = []; continue; }
    if (op === 'ET') { inText = false; operands = []; continue; }

    if (!inText && op === 're') {
      const values = numberOperands(operands).slice(-4);
      if (values.length === 4) {
        const [rx, ry, width, height] = values;
        rectangles.push({ id: stableId('rect', rectangles.length, rx, ry, width, height), x: rx, y: ry, width, height });
      }
      operands = [];
      continue;
    }

    if (!inText) { operands = []; continue; }
    if (op === 'Tf') {
      fontAlias = operands.find((item) => item.type === 'name')?.value ?? fontAlias;
      const size = [...operands].reverse().find((item) => item.type === 'number')?.value;
      if (Number.isFinite(size) && size > 0) fontSize = size;
    } else if (op === 'Td' || op === 'TD') {
      const values = numberOperands(operands).slice(-2);
      if (values.length === 2) {
        x += values[0];
        y += values[1];
        if (op === 'TD') leading = -values[1];
      }
    } else if (op === 'Tm') {
      const values = numberOperands(operands).slice(-6);
      if (values.length === 6) { x = values[4]; y = values[5]; }
    } else if (op === 'TL') {
      const value = numberOperands(operands).at(-1);
      if (Number.isFinite(value)) leading = value;
    } else if (op === 'T*') {
      advanceLine();
    } else if (op === 'Tj') {
      emit(operands.at(-1));
    } else if (op === 'TJ') {
      const array = operands.at(-1);
      if (array?.type === 'array') {
        for (const item of array.value) {
          if (item.type === 'string') emit(item);
          else if (item.type === 'number' && item.value < -120) x += fontSize * 0.35;
        }
      }
    } else if (op === "'") {
      advanceLine();
      emit(operands.at(-1));
    } else if (op === '"') {
      advanceLine();
      emit([...operands].reverse().find((item) => item.type === 'string'));
    }
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

function groupRunsIntoLines(runs, extractedText) {
  const ordered = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const groups = [];
  for (const run of ordered) {
    const tolerance = Math.max(2, run.fontSize * 0.38);
    let group = groups.find((item) => Math.abs(item.y - run.y) <= tolerance);
    if (!group) {
      group = { y: run.y, runs: [] };
      groups.push(group);
    }
    group.runs.push(run);
  }
  groups.sort((a, b) => b.y - a.y);
  const extractedLines = String(extractedText ?? '').split('\n').map(clean).filter(Boolean);
  const canMap = groups.length > 0 && Math.abs(extractedLines.length - groups.length) <= Math.max(2, Math.ceil(groups.length * 0.25));
  return groups.map((group, index) => {
    group.runs.sort((a, b) => a.x - b.x);
    const raw = clean(group.runs.map((run) => run.text).join(' '));
    const mapped = canMap ? extractedLines[index] : '';
    const text = mapped || raw;
    const minX = Math.min(...group.runs.map((run) => run.x));
    const maxX = Math.max(...group.runs.map((run) => run.x + run.width));
    const maxFont = Math.max(...group.runs.map((run) => run.fontSize));
    return Object.freeze({
      id: stableId('line', index, group.y, text),
      text,
      rawText: raw,
      x: minX,
      y: group.y,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxFont * 1.2),
      fontSize: maxFont,
      fontAliases: Object.freeze([...new Set(group.runs.map((run) => run.fontAlias).filter(Boolean))]),
      mappingConfidence: mapped ? 1 : raw ? 0.58 : 0.2
    });
  });
}

function containsLine(rect, line) {
  const pad = 4;
  const baseline = line.y;
  return line.x >= rect.x - pad && line.x <= rect.x + rect.width + pad &&
    baseline >= rect.y - pad && baseline <= rect.y + rect.height + pad;
}

const READ_LABEL = /^(?:read\s*aloud|boxed\s*text|player\s*text|leia\s+em\s+voz\s+alta|texto\s+para\s+os\s+jogadores|narra[cç][aã]o)\s*[:—-]?/i;
const HEADING_PATTERN = /^(?:chapter|cap[ií]tulo|chapitre|area|room|sala|área)\b|^\d+[A-Za-z]?[.:-]\s+\S+/i;

function analyzePage({ pageNumber, media, lines, rectangles, warnings }) {
  const fontSamples = [];
  for (const line of lines) {
    const weight = Math.max(1, Math.min(20, Math.ceil(line.text.length / 12)));
    for (let i = 0; i < weight; i += 1) fontSamples.push(line.fontSize);
  }
  const bodyFontSize = median(fontSamples);
  const candidates = [];

  for (const line of lines) {
    if (line.text.length > 140) continue;
    const ratio = bodyFontSize > 0 ? line.fontSize / bodyFontSize : 1;
    if (ratio < 1.25 || line.fontSize < bodyFontSize + 1.5) continue;
    let confidence = 0.68 + Math.min(0.18, (ratio - 1.25) * 0.35);
    if (HEADING_PATTERN.test(line.text)) confidence += 0.12;
    candidates.push(Object.freeze({
      id: stableId('layout-heading', pageNumber, line.id),
      kind: 'heading',
      proposedType: 'section-heading',
      text: line.text,
      confidence: Math.min(0.98, confidence),
      pageNumber,
      bounds: Object.freeze({ x: line.x, y: line.y, width: line.width, height: line.height }),
      evidence: Object.freeze({ method: 'font-size', bodyFontSize, fontSize: line.fontSize, ratio, mappingConfidence: line.mappingConfidence })
    }));
  }

  for (const rectangle of rectangles) {
    if (rectangle.width < media.width * 0.22 || rectangle.height < bodyFontSize * 1.5) continue;
    if (rectangle.width > media.width * 0.96 && rectangle.height > media.height * 0.8) continue;
    const inside = lines.filter((line) => containsLine(rectangle, line));
    if (!inside.length) continue;
    const text = clean(inside.sort((a, b) => b.y - a.y || a.x - b.x).map((line) => line.text).join(' '));
    if (text.length < 24) continue;
    const mappingConfidence = inside.reduce((sum, line) => sum + line.mappingConfidence, 0) / inside.length;
    let confidence = 0.78;
    if (inside.length >= 2) confidence += 0.07;
    if (text.length >= 60) confidence += 0.05;
    if (rectangle.width < media.width * 0.9) confidence += 0.03;
    if (rectangle.height < media.height * 0.45) confidence += 0.02;
    if (READ_LABEL.test(text)) confidence += 0.12;
    if (mappingConfidence < 0.75) confidence -= 0.12;
    confidence = Math.max(0.4, Math.min(0.99, confidence));
    candidates.push(Object.freeze({
      id: stableId('layout-box', pageNumber, rectangle.id, text),
      kind: 'boxed-text',
      proposedType: 'read-aloud',
      text: text.replace(READ_LABEL, '').trim(),
      confidence,
      pageNumber,
      bounds: Object.freeze({ x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }),
      evidence: Object.freeze({
        method: 'enclosing-rectangle',
        rectangleId: rectangle.id,
        lineIds: Object.freeze(inside.map((line) => line.id)),
        bodyFontSize,
        mappingConfidence,
        labeled: READ_LABEL.test(text)
      })
    }));
  }

  return Object.freeze({
    pageNumber,
    mediaBox: media,
    bodyFontSize,
    lines: Object.freeze(lines),
    rectangles: Object.freeze(rectangles.map((item) => Object.freeze({ ...item }))),
    candidates: Object.freeze(candidates.sort((a, b) => b.confidence - a.confidence)),
    warnings: Object.freeze(warnings)
  });
}

export function extractPdfLayoutSemantics(input, { documentId = null, extractedDocument = null } = {}) {
  const buffer = asBuffer(input);
  const extracted = extractedDocument ?? extractDigitalPdf(buffer, { documentId });
  const { objects } = parseObjects(buffer);
  const ids = pageOrder(objects);
  const pages = [];
  const warnings = [];
  for (let index = 0; index < ids.length; index += 1) {
    const pageObject = objects.get(ids[index]);
    if (!pageObject) continue;
    const geometry = { runs: [], rectangles: [], warnings: [] };
    for (const contentId of pageContentRefs(pageObject.body)) {
      const content = objects.get(contentId);
      if (!content?.decodedStream) {
        geometry.warnings.push(`stream-${contentId}-unavailable`);
        continue;
      }
      const part = contentGeometry(content.decodedStream);
      geometry.runs.push(...part.runs);
      geometry.rectangles.push(...part.rectangles);
      geometry.warnings.push(...part.warnings);
    }
    const extractedPage = extracted.pages[index];
    const lines = groupRunsIntoLines(geometry.runs, extractedPage?.text ?? '');
    pages.push(analyzePage({
      pageNumber: index + 1,
      media: mediaBox(pageObject.body),
      lines,
      rectangles: geometry.rectangles,
      warnings: [...new Set(geometry.warnings)]
    }));
  }
  if (pages.length !== extracted.pageCount) warnings.push('layout-page-count-mismatch');
  return Object.freeze({
    schema: 'fenix.pdf-layout-semantics',
    version: 1,
    documentId: extracted.documentId,
    pageCount: extracted.pageCount,
    pages: Object.freeze(pages),
    stats: Object.freeze({
      lines: pages.reduce((sum, page) => sum + page.lines.length, 0),
      rectangles: pages.reduce((sum, page) => sum + page.rectangles.length, 0),
      candidates: pages.reduce((sum, page) => sum + page.candidates.length, 0),
      boxedTextCandidates: pages.reduce((sum, page) => sum + page.candidates.filter((item) => item.kind === 'boxed-text').length, 0),
      headingCandidates: pages.reduce((sum, page) => sum + page.candidates.filter((item) => item.kind === 'heading').length, 0)
    }),
    warnings: Object.freeze(warnings)
  });
}

function canonical(value) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function duplicateReadAloud(model, text) {
  const target = canonical(text);
  if (!target) return false;
  for (const chunk of model.chunks ?? []) {
    if (chunk.type !== 'read-aloud') continue;
    const existing = canonical(chunk.originalText);
    if (existing === target || (existing.length > 20 && target.includes(existing)) || (target.length > 20 && existing.includes(target))) return true;
  }
  return false;
}

function sectionForPage(model, pageNumber) {
  const candidates = (model.sections ?? []).filter((section) => section.source?.page === pageNumber);
  return candidates.findLast?.((section) => section.kind === 'area') ?? candidates.at(-1) ?? model.sections?.[0] ?? null;
}

function sourceForCandidate(model, candidate, section) {
  return Object.freeze({
    type: 'pdf',
    documentId: model.source?.documentId,
    page: candidate.pageNumber,
    section: section?.title ?? `Page ${candidate.pageNumber}`,
    bounds: candidate.bounds
  });
}

function reviewSummary(items) {
  return Object.freeze({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    autoAccepted: items.filter((item) => item.status === 'accepted' && item.decision?.mode === 'auto').length
  });
}

export function attachLayoutReview(model, layout, { reviewThreshold = 0.65, autoAcceptConfidence = 0.97 } = {}) {
  if (model?.schema !== 'fenix.adventure-model') throw layoutError('Adventure Model inválido.', 'FENIX_LAYOUT_ADVENTURE_MODEL_INVALID');
  if (layout?.schema !== 'fenix.pdf-layout-semantics') throw layoutError('Layout semântico inválido.', 'FENIX_LAYOUT_DOCUMENT_INVALID');
  const chunks = [...(model.chunks ?? [])];
  const readAloud = [...(model.entities?.readAloud ?? [])];
  const items = [];

  for (const page of layout.pages ?? []) {
    for (const candidate of page.candidates ?? []) {
      if (candidate.kind !== 'boxed-text' || candidate.proposedType !== 'read-aloud') continue;
      if (candidate.confidence < reviewThreshold || !candidate.text || duplicateReadAloud(model, candidate.text)) continue;
      const section = sectionForPage(model, candidate.pageNumber);
      const sectionId = section?.id ?? stableId(model.id, 'page-section', candidate.pageNumber);
      const sectionTitle = section?.title ?? `Page ${candidate.pageNumber}`;
      const source = sourceForCandidate(model, candidate, section);
      const reviewId = stableId('review', model.id, candidate.id);
      const chunkId = stableId('layout-chunk', model.id, candidate.id);
      const autoAccepted = candidate.confidence >= autoAcceptConfidence && candidate.evidence?.mappingConfidence >= 0.9;
      const status = autoAccepted ? 'accepted' : 'pending';
      const chunk = Object.freeze({
        id: chunkId,
        type: autoAccepted ? 'read-aloud' : 'layout-candidate',
        proposedType: 'read-aloud',
        sectionId,
        sectionTitle,
        visibility: autoAccepted ? 'player' : 'gm',
        revealKey: null,
        originalText: candidate.text,
        localized: {},
        reviewStatus: status,
        classification: Object.freeze({ method: 'pdf-layout', confidence: candidate.confidence, candidateId: candidate.id, evidence: candidate.evidence }),
        source
      });
      chunks.push(chunk);
      if (autoAccepted) {
        readAloud.push(Object.freeze({ id: chunkId, sectionId, originalText: chunk.originalText, source, classification: chunk.classification }));
      }
      items.push(Object.freeze({
        id: reviewId,
        chunkId,
        status,
        proposedType: 'read-aloud',
        confidence: candidate.confidence,
        originalText: candidate.text,
        sectionId,
        sectionTitle,
        source,
        evidence: candidate.evidence,
        decision: autoAccepted ? Object.freeze({ action: 'accept', mode: 'auto', reason: `confidence>=${autoAcceptConfidence}` }) : null
      }));
    }
  }

  const review = Object.freeze({
    schema: 'fenix.content-review-queue',
    version: 1,
    adventureId: model.id,
    policy: Object.freeze({ reviewThreshold, autoAcceptConfidence, failClosedForPlayers: true }),
    summary: reviewSummary(items),
    items: Object.freeze(items)
  });

  return Object.freeze({
    ...model,
    entities: Object.freeze({ ...model.entities, readAloud: Object.freeze(readAloud) }),
    chunks: Object.freeze(chunks),
    layout: Object.freeze({ schema: layout.schema, version: layout.version, documentId: layout.documentId, pageCount: layout.pageCount, stats: layout.stats, pages: layout.pages, warnings: layout.warnings }),
    review,
    stats: Object.freeze({ ...model.stats, chunks: chunks.length, readAloud: readAloud.length, layoutCandidates: layout.stats?.candidates ?? 0, reviewPending: review.summary.pending })
  });
}

export function applyAdventureReviewDecisions(model, decisions = []) {
  if (model?.review?.schema !== 'fenix.content-review-queue') throw layoutError('Adventure Model não possui fila de revisão v1.1.', 'FENIX_REVIEW_QUEUE_REQUIRED');
  const decisionList = Array.isArray(decisions) ? decisions : [decisions];
  const chunks = [...(model.chunks ?? [])];
  const readAloud = [...(model.entities?.readAloud ?? [])];
  const items = [...model.review.items];

  for (const decision of decisionList) {
    const reviewId = String(decision?.reviewId ?? decision?.id ?? '').trim();
    const action = String(decision?.action ?? '').toLowerCase();
    if (!reviewId || !['accept', 'reject'].includes(action)) throw layoutError('Decisão de revisão inválida.', 'FENIX_REVIEW_DECISION_INVALID');
    const itemIndex = items.findIndex((item) => item.id === reviewId);
    if (itemIndex < 0) throw layoutError('Item de revisão não encontrado.', 'FENIX_REVIEW_ITEM_NOT_FOUND', { reviewId });
    const item = items[itemIndex];
    if (item.status !== 'pending') continue;
    const chunkIndex = chunks.findIndex((chunk) => chunk.id === item.chunkId);
    if (chunkIndex < 0) throw layoutError('Chunk associado à revisão não foi encontrado.', 'FENIX_REVIEW_CHUNK_NOT_FOUND', { chunkId: item.chunkId });
    const chunk = chunks[chunkIndex];

    if (action === 'accept') {
      if (item.proposedType !== 'read-aloud') throw layoutError('Tipo proposto ainda não possui aplicador.', 'FENIX_REVIEW_TYPE_UNSUPPORTED');
      const accepted = Object.freeze({ ...chunk, type: 'read-aloud', visibility: 'player', reviewStatus: 'accepted' });
      chunks[chunkIndex] = accepted;
      if (!readAloud.some((entry) => entry.id === accepted.id)) {
        readAloud.push(Object.freeze({ id: accepted.id, sectionId: accepted.sectionId, originalText: accepted.originalText, source: accepted.source, classification: accepted.classification }));
      }
    } else {
      chunks[chunkIndex] = Object.freeze({ ...chunk, type: 'gm-prose', visibility: 'gm', reviewStatus: 'rejected' });
    }

    items[itemIndex] = Object.freeze({
      ...item,
      status: action === 'accept' ? 'accepted' : 'rejected',
      decision: Object.freeze({ action, mode: 'gm-review', reason: clean(decision.reason) || null })
    });
  }

  const review = Object.freeze({ ...model.review, summary: reviewSummary(items), items: Object.freeze(items) });
  return Object.freeze({
    ...model,
    entities: Object.freeze({ ...model.entities, readAloud: Object.freeze(readAloud) }),
    chunks: Object.freeze(chunks),
    review,
    stats: Object.freeze({ ...model.stats, chunks: chunks.length, readAloud: readAloud.length, reviewPending: review.summary.pending })
  });
}

export async function importDigitalPdfAdventureV11(input, options = {}) {
  const extracted = extractDigitalPdf(input, options);
  let model = compileAdventureDocument(extracted, options);
  const layout = extractPdfLayoutSemantics(input, { documentId: extracted.documentId, extractedDocument: extracted });
  model = attachLayoutReview(model, layout, options);
  if (options.localize === false) return model;
  return localizeAdventureModel(model, options);
}
