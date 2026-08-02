export const READ_ALOUD_SELECTORS = Object.freeze([
  '.ve-rd__b-inset--readaloud',
  '.rd__b-inset--readaloud',
  '.rd__b-inset--read-aloud',
  '.read-aloud',
  '.readaloud',
  '[data-read-aloud]',
  '[data-readaloud]',
  '[class*="readaloud" i]',
  '[class*="read-aloud" i]'
]);

export const READ_ALOUD_SELECTOR = READ_ALOUD_SELECTORS.join(', ');

function normalizeLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function labelsRelated(left, right) {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return false;
  const leftNumber = a.match(/\d+/)?.[0] ?? null;
  const rightNumber = b.match(/\d+/)?.[0] ?? null;
  if (leftNumber && rightNumber) return leftNumber === rightNumber;
  return a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

function markdownHeading(line) {
  const match = String(line ?? '').match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  return { depth: match[1].length, label: match[2].trim() };
}

function cleanMarkdownText(value) {
  return String(value ?? '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\[![A-Z-]+\]\s*/i, '')
    .replace(/[`*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstQuotedBlock(lines, start, end) {
  const parts = [];
  let started = false;

  for (let index = start; index < end; index += 1) {
    const match = String(lines[index] ?? '').match(/^\s*>\s?(.*)$/);
    if (match) {
      started = true;
      const cleaned = cleanMarkdownText(match[1]);
      if (cleaned) parts.push(cleaned);
      continue;
    }
    if (started && String(lines[index] ?? '').trim()) break;
  }

  return cleanMarkdownText(parts.join(' '));
}

/**
 * Extrai somente o primeiro bloco de citação Markdown. Quando uma sala é
 * informada, restringe a busca à seção numerada correspondente ou a uma
 * página cujo próprio nome corresponda à sala.
 */
export function extractMarkdownReadAloud(markdown, { sectionLabel = '', pageLabel = '' } = {}) {
  const lines = String(markdown ?? '').split(/\r?\n/);
  if (!lines.length) return null;

  let start = 0;
  let end = lines.length;
  let areaName = String(pageLabel ?? '').trim() || null;

  if (sectionLabel) {
    let headingIndex = -1;
    let headingDepth = 7;
    for (let index = 0; index < lines.length; index += 1) {
      const heading = markdownHeading(lines[index]);
      if (!heading || !labelsRelated(sectionLabel, heading.label)) continue;
      headingIndex = index;
      headingDepth = heading.depth;
      areaName = heading.label;
      break;
    }

    if (headingIndex >= 0) {
      start = headingIndex + 1;
      for (let index = start; index < lines.length; index += 1) {
        const heading = markdownHeading(lines[index]);
        if (heading && heading.depth <= headingDepth) {
          end = index;
          break;
        }
      }
    } else if (!labelsRelated(sectionLabel, pageLabel)) {
      return null;
    }
  }

  const content = firstQuotedBlock(lines, start, end);
  if (!content) return null;
  return { content, areaName };
}
