import crypto from 'node:crypto';
import { compileAdventureDocument, localizeAdventureModel } from './index.js';

function fail(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 10000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function decodeHtmlEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value ?? '').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (all, entity) => {
    if (entity[0] === '#') {
      const hex = entity[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : all;
    }
    return named[entity.toLowerCase()] ?? all;
  });
}

function stripTags(value) {
  return decodeHtmlEntities(String(value ?? '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReferences(html) {
  const refs = [];
  const seen = new Set();
  for (const match of String(html ?? '').matchAll(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/g)) {
    const uuid = clean(match[1], 500);
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    refs.push(Object.freeze({ type: 'uuid', uuid, label: clean(match[2], 300) || null }));
  }
  for (const match of String(html ?? '').matchAll(/data-(?:uuid|entity-uuid)=["']([^"']+)["']/gi)) {
    const uuid = clean(match[1], 500);
    if (!uuid || seen.has(uuid)) continue;
    seen.add(uuid);
    refs.push(Object.freeze({ type: 'uuid', uuid, label: null }));
  }
  return refs;
}

function semanticTextFromHtml(html) {
  let source = String(html ?? '');
  source = source.replace(/<(div|section|aside|blockquote)\b([^>]*)class=["']([^"']*(?:readaloud|read-aloud|read_aloud)[^"']*)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
    (_all, _tag, _before, _classes, _after, inner) => `\nRead Aloud: ${stripTags(inner)}\n`);
  source = source.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_all, level, inner) => {
    const title = stripTags(inner);
    if (!title) return '\n';
    return Number(level) <= 2 ? `\nChapter: ${title}\n` : `\nArea: ${title}\n`;
  });
  source = source.replace(/@UUID\[([^\]]+)\](?:\{([^}]+)\})?/g, (_all, uuid, label) => label || uuid);
  source = source.replace(/<(?:br|hr)\s*\/?\s*>/gi, '\n');
  source = source.replace(/<\/(?:p|div|section|article|aside|blockquote|li|table|tr)>/gi, '\n');
  source = source.replace(/<li\b[^>]*>/gi, '• ');
  source = decodeHtmlEntities(source.replace(/<[^>]+>/g, ' '));
  return source.split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function rootJournalUuid(input, journalId) {
  const candidates = [
    input?.uuid,
    input?._stats?.uuid,
    input?.flags?.core?.sourceId,
    input?._stats?.compendiumSource
  ].map((value) => clean(value, 500)).filter(Boolean);
  const journal = candidates.find((value) => value.startsWith('JournalEntry.'));
  return journal || `JournalEntry.${journalId}`;
}

function normalizeJournal(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('JSON do Foundry inválido.', 'FENIX_FOUNDRY_JSON_INVALID');
  const journalId = clean(input._id || input.id, 200);
  if (!journalId) throw fail('JournalEntry sem _id/id.', 'FENIX_FOUNDRY_JOURNAL_ID_REQUIRED');
  const pages = Array.isArray(input.pages) ? input.pages : [];
  if (!pages.length) throw fail('JournalEntry não possui páginas importáveis.', 'FENIX_FOUNDRY_JOURNAL_PAGES_REQUIRED');
  const journalUuid = rootJournalUuid(input, journalId);
  const normalizedPages = pages.map((page, index) => {
    const pageId = clean(page?._id || page?.id, 200) || stableId(journalId, 'page', index + 1);
    const pageUuid = clean(page?.uuid, 500) || `${journalUuid}.JournalEntryPage.${pageId}`;
    const html = clean(page?.text?.content ?? page?.content ?? '', 5_000_000);
    const text = page?.type === 'text' || html ? semanticTextFromHtml(html) : '';
    return Object.freeze({
      pageNumber: index + 1,
      pageId,
      pageUuid,
      name: clean(page?.name, 500) || `Page ${index + 1}`,
      type: clean(page?.type, 100) || 'text',
      html,
      text,
      references: Object.freeze(extractReferences(html)),
      sort: Number(page?.sort) || index
    });
  }).filter((page) => page.text);
  if (!normalizedPages.length) throw fail('JournalEntry não possui conteúdo textual utilizável.', 'FENIX_FOUNDRY_JOURNAL_TEXT_REQUIRED');
  return Object.freeze({
    journalId,
    journalUuid,
    name: clean(input.name, 500) || 'Foundry Journal',
    folder: clean(input.folder, 500) || null,
    systemId: clean(input?._stats?.systemId ?? input?.systemId, 200) || null,
    systemVersion: clean(input?._stats?.systemVersion ?? input?.systemVersion, 100) || null,
    coreVersion: clean(input?._stats?.coreVersion ?? input?.coreVersion, 100) || null,
    pages: Object.freeze(normalizedPages)
  });
}

function foundryProvenance(source, pageMap, journal) {
  const page = pageMap.get(Number(source?.page)) ?? journal.pages[0];
  return Object.freeze({
    type: 'foundry-journal-page',
    documentId: journal.journalUuid,
    page: Number(source?.page) || page.pageNumber,
    section: source?.section ?? page.name,
    journalId: journal.journalId,
    journalUuid: journal.journalUuid,
    pageId: page.pageId,
    pageUuid: page.pageUuid
  });
}

function remapList(list, pageMap, journal) {
  return Object.freeze((list ?? []).map((item) => Object.freeze({ ...item, source: foundryProvenance(item.source, pageMap, journal) })));
}

export async function importFoundryJournalJson(input, options = {}) {
  let payload = input;
  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    try { payload = JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input); }
    catch { throw fail('Arquivo JSON do Foundry não pôde ser lido.', 'FENIX_FOUNDRY_JSON_PARSE_FAILED'); }
  }
  const journal = normalizeJournal(payload);
  const document = Object.freeze({
    schema: 'fenix.foundry-journal-document',
    version: 1,
    documentId: journal.journalUuid,
    pageCount: journal.pages.length,
    pages: Object.freeze(journal.pages.map((page) => Object.freeze({ pageNumber: page.pageNumber, objectId: page.pageId, text: page.text })))
  });
  let base = compileAdventureDocument(document, {
    title: options.title || journal.name,
    sourceLanguage: options.sourceLanguage ?? null
  });
  const pageMap = new Map(journal.pages.map((page) => [page.pageNumber, page]));
  base = Object.freeze({
    ...base,
    source: Object.freeze({
      type: 'foundry-journal',
      documentId: journal.journalUuid,
      journalId: journal.journalId,
      journalUuid: journal.journalUuid,
      pageCount: journal.pages.length,
      systemId: journal.systemId,
      systemVersion: journal.systemVersion,
      coreVersion: journal.coreVersion
    }),
    chapters: remapList(base.chapters, pageMap, journal),
    sections: remapList(base.sections, pageMap, journal),
    entities: Object.freeze({
      readAloud: remapList(base.entities?.readAloud, pageMap, journal),
      gmNotes: remapList(base.entities?.gmNotes, pageMap, journal),
      secrets: remapList(base.entities?.secrets, pageMap, journal),
      checks: remapList(base.entities?.checks, pageMap, journal),
      treasures: remapList(base.entities?.treasures, pageMap, journal)
    }),
    chunks: Object.freeze(base.chunks.map((chunk) => Object.freeze({ ...chunk, source: foundryProvenance(chunk.source, pageMap, journal) }))),
    foundry: Object.freeze({
      schema: 'fenix.foundry-journal-source',
      version: 1,
      journalId: journal.journalId,
      journalUuid: journal.journalUuid,
      pages: Object.freeze(journal.pages.map((page) => Object.freeze({
        pageId: page.pageId,
        pageUuid: page.pageUuid,
        name: page.name,
        type: page.type,
        sort: page.sort,
        originalHtml: page.html,
        references: page.references
      }))),
      references: Object.freeze(journal.pages.flatMap((page) => page.references.map((reference) => Object.freeze({ ...reference, pageUuid: page.pageUuid }))))
    }),
    ingestion: Object.freeze({ version: '1.3', extractionMode: 'foundry-json', adapter: 'foundry-journal-v1' })
  });
  if (options.localize === false) return base;
  return localizeAdventureModel(base, options);
}
