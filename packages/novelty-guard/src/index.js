const STOPWORDS = new Set([
  'a','o','as','os','um','uma','uns','umas','de','da','do','das','dos','e','em','no','na','nos','nas',
  'por','para','com','sem','que','se','ao','aos','à','às','como','mais','menos','já','ainda','entre','sobre',
  'vocês','grupo','diante','fazem','fazer','então','agora','ali','aqui','seu','sua','seus','suas','este','esta'
]);

// Termos que normalmente precisam reaparecer porque pertencem ao cânone observável da cena.
// Eles não devem, sozinhos, fazer duas narrações parecerem repetidas.
const CANONICAL_SCENE_WORDS = new Set([
  'caverna','caverna','entrada','encosta','colina','riacho','agua','correnteza','curso','vegetacao','espinheiros',
  'espinho','trilha','caminho','passagem','margem','pedra','rocha','terreno','sombra','sombras','escuridao',
  'interior','exterior','abertura','local','lugar','goblins','goblin','floresta','mata','galhos','folhas'
]);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\[modo local de diagnostico[^\]]*\]/gi, ' ')
    .replace(/o que voces fazem\??\s*$/gi, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawTokens(value) {
  return normalize(value).split(' ').filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

function styleTokens(value) {
  const words = rawTokens(value).filter((word) => !CANONICAL_SCENE_WORDS.has(word));
  // Quando a cena é muito curta, preserve os tokens originais para evitar uma assinatura vazia.
  return words.length >= 5 ? words : rawTokens(value);
}

function ngrams(words, size) {
  const result = new Set();
  for (let index = 0; index <= words.length - size; index += 1) {
    result.add(words.slice(index, index + size).join(' '));
  }
  return result;
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 1;
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function paragraphStarts(value) {
  return String(value ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => styleTokens(paragraph).slice(0, 6).join(' '))
    .filter(Boolean);
}

function sentenceStarts(value) {
  return String(value ?? '')
    .split(/[.!?]+/)
    .map((sentence) => styleTokens(sentence).slice(0, 5).join(' '))
    .filter(Boolean);
}

function lengthProfile(value) {
  return String(value ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => rawTokens(paragraph).length)
    .filter((length) => length > 0);
}

function profileSimilarity(left, right) {
  if (!left.length || !right.length) return 0;
  const size = Math.max(left.length, right.length);
  const paddedLeft = [...left, ...Array(size - left.length).fill(0)];
  const paddedRight = [...right, ...Array(size - right.length).fill(0)];
  const difference = paddedLeft.reduce((total, value, index) => total + Math.abs(value - paddedRight[index]), 0);
  const scale = Math.max(1, paddedLeft.reduce((a, b) => a + b, 0), paddedRight.reduce((a, b) => a + b, 0));
  return Math.max(0, 1 - difference / scale);
}

function openingFingerprint(value) {
  const normalized = normalize(value);
  const words = styleTokens(value);
  return {
    normalized,
    words,
    paragraphStarts: paragraphStarts(value),
    sentenceStarts: sentenceStarts(value),
    profile: lengthProfile(value)
  };
}

export class NoveltyGuard {
  constructor({ threshold = 0.82 } = {}) {
    this.threshold = threshold;
  }

  compare(left, right) {
    const a = openingFingerprint(left);
    const b = openingFingerprint(right);
    if (!a.normalized || !b.normalized) return 0;
    if (a.normalized === b.normalized) return 1;

    const unigram = jaccard(new Set(a.words), new Set(b.words));
    const bigram = jaccard(ngrams(a.words, 2), ngrams(b.words, 2));
    const trigram = jaccard(ngrams(a.words, 3), ngrams(b.words, 3));
    const fourgram = jaccard(ngrams(a.words, 4), ngrams(b.words, 4));
    const starts = Math.max(
      jaccard(new Set(a.paragraphStarts), new Set(b.paragraphStarts)),
      jaccard(new Set(a.sentenceStarts), new Set(b.sentenceStarts))
    );
    const structure = profileSimilarity(a.profile, b.profile);

    // Frases e aberturas repetidas pesam muito mais do que substantivos canônicos da cena.
    const phraseScore = unigram * 0.10 + bigram * 0.20 + trigram * 0.30 + fourgram * 0.40;
    const openingScore = starts * 0.75 + bigram * 0.25;
    const structuralScore = structure * 0.22 + trigram * 0.78;

    return Math.max(phraseScore, openingScore, structuralScore);
  }

  compareStyleOnly(left, right) {
    return this.compare(left, right);
  }

  evaluate(candidate, history = []) {
    if (!history.length) {
      return {
        accepted: true,
        maxSimilarity: 0,
        threshold: this.threshold,
        matchedId: null,
        mode: 'STYLE_ONLY_V2'
      };
    }

    let maxSimilarity = 0;
    let matched = null;
    for (const entry of history) {
      const previous = typeof entry === 'string' ? entry : entry?.text;
      if (!previous) continue;
      const similarity = this.compare(candidate, previous);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        matched = entry;
      }
    }
    return {
      accepted: maxSimilarity < this.threshold,
      maxSimilarity,
      threshold: this.threshold,
      matchedId: matched?.id ?? null,
      mode: 'STYLE_ONLY_V2'
    };
  }

  fingerprint(value) {
    const words = styleTokens(value);
    return [...ngrams(words, 3)].slice(0, 120).join('|');
  }
}

export function createNoveltyGuard(options) {
  return new NoveltyGuard(options);
}
