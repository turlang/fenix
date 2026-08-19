import crypto from 'node:crypto';

function clean(value) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function id(...parts) { return crypto.createHash('sha256').update(parts.join('\u241f')).digest('hex').slice(0, 24); }
function canonical(value) { return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function fail(message, code) { const error = new Error(message); error.code = code; return error; }

function summary(items) {
  return Object.freeze({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
    autoAccepted: items.filter((item) => item.status === 'accepted' && item.decision?.mode === 'auto').length
  });
}

function duplicateReadAloud(model, text) {
  const target = canonical(text);
  return (model.chunks ?? []).some((chunk) => {
    if (chunk.type !== 'read-aloud') return false;
    const existing = canonical(chunk.originalText);
    return existing === target || (existing.length > 20 && target.includes(existing)) || (target.length > 20 && existing.includes(target));
  });
}

function sectionForPage(model, pageNumber) {
  const sections = (model.sections ?? []).filter((section) => section.source?.page === pageNumber);
  return sections.findLast?.((section) => section.kind === 'area') ?? sections.at(-1) ?? model.sections?.[0] ?? null;
}

export function attachLayoutReview(model, layout, { reviewThreshold = 0.65, autoAcceptConfidence = 0.97 } = {}) {
  if (model?.schema !== 'fenix.adventure-model') throw fail('Adventure Model inválido.', 'FENIX_LAYOUT_ADVENTURE_MODEL_INVALID');
  if (layout?.schema !== 'fenix.pdf-layout-semantics') throw fail('Layout semântico inválido.', 'FENIX_LAYOUT_DOCUMENT_INVALID');
  const chunks = [...(model.chunks ?? [])];
  const readAloud = [...(model.entities?.readAloud ?? [])];
  const items = [];

  for (const page of layout.pages ?? []) for (const candidate of page.candidates ?? []) {
    if (candidate.kind !== 'boxed-text' || candidate.proposedType !== 'read-aloud') continue;
    if (candidate.confidence < reviewThreshold || !candidate.text || duplicateReadAloud(model, candidate.text)) continue;
    const section = sectionForPage(model, candidate.pageNumber);
    const sectionId = section?.id ?? id(model.id, 'page-section', candidate.pageNumber);
    const sectionTitle = section?.title ?? `Page ${candidate.pageNumber}`;
    const source = Object.freeze({ type: 'pdf', documentId: model.source?.documentId, page: candidate.pageNumber, section: sectionTitle, bounds: candidate.bounds });
    const reviewId = id('review', model.id, candidate.id);
    const chunkId = id('layout-chunk', model.id, candidate.id);
    const autoAccepted = candidate.confidence >= autoAcceptConfidence && candidate.evidence?.mappingConfidence >= 0.9;
    const status = autoAccepted ? 'accepted' : 'pending';
    const classification = Object.freeze({ method: 'pdf-layout', confidence: candidate.confidence, candidateId: candidate.id, evidence: candidate.evidence });
    const chunk = Object.freeze({ id: chunkId, type: autoAccepted ? 'read-aloud' : 'layout-candidate', proposedType: 'read-aloud', sectionId, sectionTitle, visibility: autoAccepted ? 'player' : 'gm', revealKey: null, originalText: candidate.text, localized: {}, reviewStatus: status, classification, source });
    chunks.push(chunk);
    if (autoAccepted) readAloud.push(Object.freeze({ id: chunkId, sectionId, originalText: chunk.originalText, source, classification }));
    items.push(Object.freeze({ id: reviewId, chunkId, status, proposedType: 'read-aloud', confidence: candidate.confidence, originalText: candidate.text, sectionId, sectionTitle, source, evidence: candidate.evidence, decision: autoAccepted ? Object.freeze({ action: 'accept', mode: 'auto', reason: `confidence>=${autoAcceptConfidence}` }) : null }));
  }

  const review = Object.freeze({ schema: 'fenix.content-review-queue', version: 1, adventureId: model.id, policy: Object.freeze({ reviewThreshold, autoAcceptConfidence, failClosedForPlayers: true }), summary: summary(items), items: Object.freeze(items) });
  return Object.freeze({ ...model, entities: Object.freeze({ ...model.entities, readAloud: Object.freeze(readAloud) }), chunks: Object.freeze(chunks), layout: Object.freeze(layout), review, stats: Object.freeze({ ...model.stats, chunks: chunks.length, readAloud: readAloud.length, layoutCandidates: layout.stats?.candidates ?? 0, reviewPending: review.summary.pending }) });
}

export function applyAdventureReviewDecisions(model, decisions = []) {
  if (model?.review?.schema !== 'fenix.content-review-queue') throw fail('Adventure Model não possui fila de revisão v1.1.', 'FENIX_REVIEW_QUEUE_REQUIRED');
  const list = Array.isArray(decisions) ? decisions : [decisions];
  const chunks = [...(model.chunks ?? [])];
  const readAloud = [...(model.entities?.readAloud ?? [])];
  const items = [...model.review.items];

  for (const decision of list) {
    const reviewId = String(decision?.reviewId ?? decision?.id ?? '').trim();
    const action = String(decision?.action ?? '').toLowerCase();
    if (!reviewId || !['accept', 'reject'].includes(action)) throw fail('Decisão de revisão inválida.', 'FENIX_REVIEW_DECISION_INVALID');
    const itemIndex = items.findIndex((item) => item.id === reviewId);
    if (itemIndex < 0) throw fail('Item de revisão não encontrado.', 'FENIX_REVIEW_ITEM_NOT_FOUND');
    const item = items[itemIndex];
    if (item.status !== 'pending') continue;
    const chunkIndex = chunks.findIndex((chunk) => chunk.id === item.chunkId);
    if (chunkIndex < 0) throw fail('Chunk associado à revisão não encontrado.', 'FENIX_REVIEW_CHUNK_NOT_FOUND');
    const chunk = chunks[chunkIndex];
    if (action === 'accept') {
      const accepted = Object.freeze({ ...chunk, type: 'read-aloud', visibility: 'player', reviewStatus: 'accepted' });
      chunks[chunkIndex] = accepted;
      if (!readAloud.some((entry) => entry.id === accepted.id)) readAloud.push(Object.freeze({ id: accepted.id, sectionId: accepted.sectionId, originalText: accepted.originalText, source: accepted.source, classification: accepted.classification }));
    } else {
      chunks[chunkIndex] = Object.freeze({ ...chunk, type: 'gm-prose', visibility: 'gm', reviewStatus: 'rejected' });
    }
    items[itemIndex] = Object.freeze({ ...item, status: action === 'accept' ? 'accepted' : 'rejected', decision: Object.freeze({ action, mode: 'gm-review', reason: clean(decision.reason) || null }) });
  }

  const review = Object.freeze({ ...model.review, summary: summary(items), items: Object.freeze(items) });
  return Object.freeze({ ...model, entities: Object.freeze({ ...model.entities, readAloud: Object.freeze(readAloud) }), chunks: Object.freeze(chunks), review, stats: Object.freeze({ ...model.stats, chunks: chunks.length, readAloud: readAloud.length, reviewPending: review.summary.pending }) });
}
