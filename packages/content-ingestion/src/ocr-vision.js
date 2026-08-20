import crypto from 'node:crypto';

function fail(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function previewText(value, max = 4_000_000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, Math.max(1, Number(max) || 4_000_000)) : '';
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function clamp01(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
}

function bounds(value = {}) {
  const x = Number(value.x) || 0;
  const y = Number(value.y) || 0;
  const width = Math.max(0, Number(value.width) || 0);
  const height = Math.max(0, Number(value.height) || 0);
  return Object.freeze({ x, y, width, height });
}

function normalizeBlock(raw, documentId, pageNumber, index) {
  const text = clean(raw?.text);
  if (!text) return null;
  const confidence = clamp01(raw?.confidence, 0);
  const kind = ['text', 'heading', 'read-aloud', 'table', 'caption'].includes(raw?.kind) ? raw.kind : 'text';
  const proposedType = raw?.proposedType === 'read-aloud' || kind === 'read-aloud' ? 'read-aloud' : 'gm-prose';
  return Object.freeze({
    id: clean(raw?.id) || stableId('ocr-block', documentId, pageNumber, index, text),
    pageNumber,
    text,
    confidence,
    kind,
    proposedType,
    bounds: bounds(raw?.bounds),
    language: clean(raw?.language) || null,
    preview: raw?.preview && typeof raw.preview === 'object'
      ? Object.freeze({
          mimeType: clean(raw.preview.mimeType) || null,
          dataUrl: previewText(raw.preview.dataUrl, 2_000_000) || null,
          assetId: clean(raw.preview.assetId) || null
        })
      : null
  });
}

function normalizePage(raw, documentId, index) {
  const pageNumber = Math.max(1, Number(raw?.pageNumber) || index + 1);
  const blocks = (Array.isArray(raw?.blocks) ? raw.blocks : [])
    .map((block, blockIndex) => normalizeBlock(block, documentId, pageNumber, blockIndex))
    .filter(Boolean);
  return Object.freeze({
    pageNumber,
    width: Math.max(1, Number(raw?.width) || 1),
    height: Math.max(1, Number(raw?.height) || 1),
    confidence: clamp01(raw?.confidence, blocks.length ? blocks.reduce((sum, block) => sum + block.confidence, 0) / blocks.length : 0),
    blocks: Object.freeze(blocks),
    preview: raw?.preview && typeof raw.preview === 'object'
      ? Object.freeze({
          mimeType: clean(raw.preview.mimeType) || null,
          dataUrl: previewText(raw.preview.dataUrl, 4_000_000) || null,
          assetId: clean(raw.preview.assetId) || null
        })
      : null
  });
}

export function normalizeOcrVisionDocument(payload, { documentId = null } = {}) {
  if (!payload || !Array.isArray(payload.pages) || !payload.pages.length) {
    throw fail('Provider OCR/Vision não retornou páginas utilizáveis.', 'FENIX_OCR_DOCUMENT_INVALID');
  }
  const id = clean(documentId) || clean(payload.documentId) || stableId('ocr-document', JSON.stringify(payload.pages).slice(0, 200_000));
  const pages = payload.pages.map((page, index) => normalizePage(page, id, index));
  const blockCount = pages.reduce((sum, page) => sum + page.blocks.length, 0);
  const characterCount = pages.reduce((sum, page) => sum + page.blocks.reduce((inner, block) => inner + block.text.length, 0), 0);
  if (!blockCount || characterCount < 8) throw fail('OCR/Vision não encontrou texto suficiente.', 'FENIX_OCR_TEXT_REQUIRED');
  return Object.freeze({
    schema: 'fenix.ocr-vision-document',
    version: 1,
    documentId: id,
    provider: clean(payload.provider) || null,
    language: clean(payload.language) || null,
    pageCount: pages.length,
    blockCount,
    characterCount,
    pages: Object.freeze(pages)
  });
}

export function buildTrustedTextDocumentFromOcr(ocrDocument, { trustedConfidence = 0.92 } = {}) {
  if (ocrDocument?.schema !== 'fenix.ocr-vision-document') throw fail('Documento OCR/Vision inválido.', 'FENIX_OCR_DOCUMENT_REQUIRED');
  const threshold = clamp01(trustedConfidence, 0.92);
  const pages = ocrDocument.pages.map((page) => {
    const trusted = page.blocks.filter((block) => block.confidence >= threshold);
    return Object.freeze({
      pageNumber: page.pageNumber,
      objectId: null,
      text: trusted.map((block) => block.text).join('\n')
    });
  });
  const extractedCharacters = pages.reduce((sum, page) => sum + page.text.length, 0);
  return Object.freeze({
    schema: 'fenix.pdf-text-document',
    version: 1,
    documentId: ocrDocument.documentId,
    pageCount: pages.length,
    extractedCharacters,
    pages: Object.freeze(pages),
    extraction: Object.freeze({ method: 'ocr-vision', trustedConfidence: threshold })
  });
}

function reviewSummary(items) {
  return Object.freeze({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    rejected: items.filter((item) => item.status === 'rejected').length
  });
}

export function attachOcrReview(model, ocrDocument, { trustedConfidence = 0.92, minimumReviewConfidence = 0.35 } = {}) {
  if (model?.schema !== 'fenix.adventure-model') throw fail('Adventure Model inválido.', 'FENIX_OCR_ADVENTURE_MODEL_INVALID');
  const trusted = clamp01(trustedConfidence, 0.92);
  const minimum = clamp01(minimumReviewConfidence, 0.35);
  const chunks = [...(model.chunks ?? [])];
  const items = [];

  for (const page of ocrDocument.pages ?? []) {
    for (const block of page.blocks ?? []) {
      if (block.confidence >= trusted || block.confidence < minimum) continue;
      const section = (model.sections ?? []).findLast?.((entry) => entry.source?.page === page.pageNumber)
        ?? (model.sections ?? []).find((entry) => entry.source?.page === page.pageNumber)
        ?? null;
      const sectionId = section?.id ?? stableId(model.id, 'ocr-page', page.pageNumber);
      const sectionTitle = section?.title ?? `Page ${page.pageNumber}`;
      const chunkId = stableId('ocr-review-chunk', model.id, block.id);
      const reviewId = stableId('ocr-review', model.id, block.id);
      const source = Object.freeze({
        type: 'pdf-ocr',
        documentId: ocrDocument.documentId,
        page: page.pageNumber,
        section: sectionTitle,
        bounds: block.bounds,
        preview: block.preview ?? page.preview ?? null
      });
      chunks.push(Object.freeze({
        id: chunkId,
        type: 'ocr-candidate',
        proposedType: block.proposedType,
        sectionId,
        sectionTitle,
        visibility: 'gm',
        revealKey: null,
        originalText: block.text,
        localized: {},
        reviewStatus: 'pending',
        classification: Object.freeze({
          method: 'ocr-vision',
          confidence: block.confidence,
          blockId: block.id,
          blockKind: block.kind
        }),
        source
      }));
      items.push(Object.freeze({
        id: reviewId,
        chunkId,
        blockId: block.id,
        status: 'pending',
        proposedType: block.proposedType,
        confidence: block.confidence,
        originalText: block.text,
        editedText: null,
        sectionId,
        sectionTitle,
        source,
        decision: null
      }));
    }
  }

  return Object.freeze({
    ...model,
    chunks: Object.freeze(chunks),
    ocr: Object.freeze({
      document: ocrDocument,
      review: Object.freeze({
        schema: 'fenix.ocr-review-queue',
        version: 1,
        adventureId: model.id,
        policy: Object.freeze({ trustedConfidence: trusted, minimumReviewConfidence: minimum, failClosedForPlayers: true }),
        summary: reviewSummary(items),
        items: Object.freeze(items)
      })
    }),
    stats: Object.freeze({
      ...model.stats,
      chunks: chunks.length,
      ocrPages: ocrDocument.pageCount,
      ocrBlocks: ocrDocument.blockCount,
      ocrReviewPending: items.length
    })
  });
}

export function applyOcrReviewDecisions(model, decisions = []) {
  const queue = model?.ocr?.review;
  if (queue?.schema !== 'fenix.ocr-review-queue') throw fail('Adventure Model não possui fila OCR.', 'FENIX_OCR_REVIEW_QUEUE_REQUIRED');
  const list = Array.isArray(decisions) ? decisions : [decisions];
  const chunks = [...(model.chunks ?? [])];
  const readAloud = [...(model.entities?.readAloud ?? [])];
  const items = [...queue.items];

  for (const decision of list) {
    const reviewId = clean(decision?.reviewId ?? decision?.id);
    const action = clean(decision?.action).toLowerCase();
    if (!reviewId || !['accept', 'reject'].includes(action)) throw fail('Decisão OCR inválida.', 'FENIX_OCR_REVIEW_DECISION_INVALID');
    const itemIndex = items.findIndex((item) => item.id === reviewId);
    if (itemIndex < 0) throw fail('Item OCR não encontrado.', 'FENIX_OCR_REVIEW_ITEM_NOT_FOUND', 404);
    const item = items[itemIndex];
    if (item.status !== 'pending') continue;
    const chunkIndex = chunks.findIndex((chunk) => chunk.id === item.chunkId);
    if (chunkIndex < 0) throw fail('Chunk OCR não encontrado.', 'FENIX_OCR_REVIEW_CHUNK_NOT_FOUND', 404);
    const editedText = clean(decision?.text) || chunks[chunkIndex].originalText;
    if (action === 'accept') {
      const type = item.proposedType === 'read-aloud' ? 'read-aloud' : 'gm-prose';
      const visibility = type === 'read-aloud' ? 'player' : 'gm';
      chunks[chunkIndex] = Object.freeze({ ...chunks[chunkIndex], type, visibility, originalText: editedText, reviewStatus: 'accepted' });
      if (type === 'read-aloud' && !readAloud.some((entry) => entry.id === item.chunkId)) {
        readAloud.push(Object.freeze({ id: item.chunkId, sectionId: item.sectionId, originalText: editedText, source: item.source, classification: chunks[chunkIndex].classification }));
      }
    } else {
      chunks[chunkIndex] = Object.freeze({ ...chunks[chunkIndex], type: 'gm-prose', visibility: 'gm', reviewStatus: 'rejected' });
    }
    items[itemIndex] = Object.freeze({
      ...item,
      status: action === 'accept' ? 'accepted' : 'rejected',
      editedText: action === 'accept' ? editedText : null,
      decision: Object.freeze({ action, mode: 'gm-review', reason: clean(decision?.reason) || null })
    });
  }

  const review = Object.freeze({ ...queue, summary: reviewSummary(items), items: Object.freeze(items) });
  return Object.freeze({
    ...model,
    entities: Object.freeze({ ...model.entities, readAloud: Object.freeze(readAloud) }),
    chunks: Object.freeze(chunks),
    ocr: Object.freeze({ ...model.ocr, review }),
    stats: Object.freeze({ ...model.stats, chunks: chunks.length, readAloud: readAloud.length, ocrReviewPending: review.summary.pending })
  });
}

export function createHttpOcrVisionProvider({ baseUrl, apiKey = '', timeoutMs = 120_000, fetchImpl = globalThis.fetch } = {}) {
  if (!baseUrl) throw fail('FENIX_OCR_VISION_BASE_URL é obrigatório.', 'FENIX_OCR_PROVIDER_URL_REQUIRED');
  if (typeof fetchImpl !== 'function') throw fail('fetch indisponível para OCR/Vision.', 'FENIX_OCR_PROVIDER_FETCH_REQUIRED');
  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/v1/ocr/pdf`;
  return Object.freeze({
    id: 'http-ocr-vision',
    async extractPdf({ buffer, documentId = null, languageHint = null } = {}) {
      if (!Buffer.isBuffer(buffer)) throw fail('buffer PDF é obrigatório para OCR.', 'FENIX_OCR_PROVIDER_INPUT_INVALID');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 120_000));
      try {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ documentId, languageHint, mimeType: 'application/pdf', dataBase64: buffer.toString('base64') }),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw fail(payload?.message || `OCR/Vision respondeu HTTP ${response.status}.`, 'FENIX_OCR_PROVIDER_HTTP_ERROR', response.status);
        return normalizeOcrVisionDocument({ ...payload, provider: payload.provider || 'http-ocr-vision' }, { documentId });
      } catch (error) {
        if (error?.name === 'AbortError') throw fail('OCR/Vision excedeu o timeout.', 'FENIX_OCR_PROVIDER_TIMEOUT', 504);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  });
}

export function createOcrVisionProviderFromEnv({ fetchImpl = globalThis.fetch } = {}) {
  const baseUrl = process.env.FENIX_OCR_VISION_BASE_URL?.trim();
  if (!baseUrl) return null;
  return createHttpOcrVisionProvider({
    baseUrl,
    apiKey: process.env.FENIX_OCR_VISION_API_KEY?.trim() || '',
    timeoutMs: Number(process.env.FENIX_OCR_VISION_TIMEOUT_MS) || 120_000,
    fetchImpl
  });
}
