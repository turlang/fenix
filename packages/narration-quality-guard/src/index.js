const DECISION_ENDING = /(?:\s*O que vocês fazem\?\s*)+$/i;

const SPECULATIVE_PATTERNS = [
  /\bcomo se\b/i,
  /\bparece(?:m)? (?:que|esconder|guardar|observar|esperar)\b/i,
  /\bsensa[cç][aã]o de que\b/i,
  /\balgo importante\b/i,
  /\bsegredos?\b/i,
  /\bmist[eé]rios?\b/i,
  /\bpress[aá]gio\b/i,
  /\bamea[cç]a invis[ií]vel\b/i,
  /\b[aà] espreita\b/i
];

const UNSUPPORTED_DETAIL_TERMS = [
  'chuva', 'vento', 'neblina', 'névoa', 'tempestade', 'luar', 'musgo',
  'sangue', 'fumaça', 'cinzas', 'pegadas', 'vozes', 'sussurros', 'uivos',
  'cadáver', 'cadáveres', 'fogo', 'brasas', 'aroma', 'perfume'
];

const AGENCY_VERBS = [
  'sente', 'sentem', 'pensa', 'pensam', 'decide', 'decidem', 'espera', 'esperam',
  'deseja', 'desejam', 'teme', 'temem', 'acredita', 'acreditam', 'imagina', 'imaginam',
  'quer', 'querem', 'sabe', 'sabem', 'avança', 'avançam', 'recua', 'recuam',
  'se aproxima', 'se aproximam', 'prepara', 'preparam', 'olha fixo', 'olham fixos',
  'mantém os olhos', 'mantêm os olhos', 'olhos fixos', 'olhar fixo', 'aguarda', 'aguardam'
];

const MOTIF_TERMS = [
  'caverna', 'entrada', 'riacho', 'água', 'correnteza', 'vegetação', 'espinheiros',
  'sombras', 'escuridão', 'caminho', 'trilha', 'colina'
];

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function bodyWithoutDecision(value) {
  return String(value ?? '').trim().replace(DECISION_ENDING, '').trim();
}

function countWords(value) {
  return (String(value ?? '').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function paragraphs(value) {
  return bodyWithoutDecision(value)
    .split(/\n\s*\n+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function sentences(value) {
  return bodyWithoutDecision(value)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function repeatedSentenceOpenings(value) {
  const openings = sentences(value).map((sentence) => {
    const words = normalize(sentence).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
    return words.slice(0, 4).join(' ');
  }).filter((item) => item.split(' ').length >= 3);
  const seen = new Set();
  const repeated = [];
  for (const opening of openings) {
    if (seen.has(opening)) repeated.push(opening);
    seen.add(opening);
  }
  return [...new Set(repeated)];
}

function findAgencyViolations(value, actorNames = []) {
  const normalized = normalize(value);
  const violations = [];
  for (const actorName of actorNames.filter(Boolean)) {
    const actor = normalize(actorName).trim();
    if (!actor) continue;
    const actorPattern = new RegExp(`\\b${escapeRegExp(actor)}\\b`, 'i');
    for (const sentence of sentences(normalized)) {
      if (!actorPattern.test(sentence)) continue;
      const verb = AGENCY_VERBS.find((candidate) => {
        const normalizedVerb = normalize(candidate).trim();
        const verbPattern = new RegExp(`\\b${escapeRegExp(normalizedVerb)}\\b`, 'i');
        return verbPattern.test(sentence);
      });
      if (verb) violations.push({ actor: actorName, verb });
    }
  }
  return violations;
}

function findUnsupportedDetails(candidate, sourceText) {
  const candidateNormalized = normalize(candidate);
  const sourceNormalized = normalize(sourceText);
  return UNSUPPORTED_DETAIL_TERMS.filter((term) => {
    const normalizedTerm = normalize(term);
    return candidateNormalized.includes(normalizedTerm) && !sourceNormalized.includes(normalizedTerm);
  });
}

function repeatedMotifs(value) {
  const normalized = normalize(value);
  const repeated = [];
  for (const term of MOTIF_TERMS) {
    const token = normalize(term);
    const matches = normalized.match(new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g')) ?? [];
    if (matches.length > 2) repeated.push({ term, count: matches.length });
  }
  return repeated;
}

export class NarrationQualityGuard {
  constructor({ minWords = 80, maxWords = 150, maxParagraphs = 3, requireDecisionEnding = true } = {}) {
    this.minWords = minWords;
    this.maxWords = maxWords;
    this.maxParagraphs = maxParagraphs;
    this.requireDecisionEnding = requireDecisionEnding;
  }

  evaluate(candidate, context = {}) {
    const text = String(candidate ?? '').trim();
    const sourceText = context.source?.text ?? '';
    const actorNames = (context.visibleActors ?? []).map((actor) => actor?.name).filter(Boolean);
    const wordCount = countWords(bodyWithoutDecision(text));
    const paragraphCount = paragraphs(text).length;
    const issues = [];
    const hardIssues = [];

    if (this.requireDecisionEnding && !/O que vocês fazem\?\s*$/i.test(text)) hardIssues.push('DECISION_ENDING_MISSING');
    if (wordCount < this.minWords) issues.push(`WORD_COUNT_LOW:${wordCount}`);
    if (wordCount > this.maxWords) issues.push(`WORD_COUNT_HIGH:${wordCount}`);
    if (wordCount > this.maxWords + 40) hardIssues.push('EXCESSIVE_LENGTH');
    if (wordCount < 35) hardIssues.push('INSUFFICIENT_NARRATION');
    if (paragraphCount < 2) issues.push(`PARAGRAPH_COUNT_LOW:${paragraphCount}`);
    if (paragraphCount > this.maxParagraphs) issues.push(`PARAGRAPH_COUNT_HIGH:${paragraphCount}`);
    if (paragraphCount > this.maxParagraphs + 1) hardIssues.push('EXCESSIVE_PARAGRAPHS');

    const agencyViolations = findAgencyViolations(text, actorNames);
    if (agencyViolations.length) hardIssues.push('PLAYER_AGENCY_VIOLATION');

    const speculative = SPECULATIVE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
    if (speculative.length) hardIssues.push('UNSUPPORTED_SPECULATION');

    const unsupportedDetails = findUnsupportedDetails(text, sourceText);
    if (unsupportedDetails.length) hardIssues.push('UNSUPPORTED_DETAIL');

    const openings = repeatedSentenceOpenings(text);
    if (openings.length) issues.push('REPEATED_SENTENCE_OPENING');

    const motifs = repeatedMotifs(text);
    if (motifs.length) issues.push('REPEATED_CANONICAL_MOTIF');

    const penalty = hardIssues.length * 100 + issues.length * 10 +
      Math.max(0, wordCount - this.maxWords) + Math.max(0, this.minWords - wordCount) +
      Math.max(0, paragraphCount - this.maxParagraphs) * 15;

    return {
      accepted: hardIssues.length === 0 && issues.length === 0,
      hardSafe: hardIssues.length === 0,
      issues,
      hardIssues,
      penalty,
      metrics: {
        wordCount,
        paragraphCount,
        agencyViolations,
        speculativePatterns: speculative,
        unsupportedDetails,
        repeatedOpenings: openings,
        repeatedMotifs: motifs
      }
    };
  }
}

export function createNarrationQualityGuard(options) {
  return new NarrationQualityGuard(options);
}

export const qualityGuardInternals = {
  bodyWithoutDecision,
  countWords,
  paragraphs,
  findAgencyViolations,
  findUnsupportedDetails
};
