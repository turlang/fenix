import { createSceneOpeningContextBuilder } from '../../scene-opening-context/src/index.js';
import { createOpeningNarrativePlanner } from '../../opening-narrative-planner/src/index.js';
import { createNoveltyGuard } from '../../novelty-guard/src/index.js';
import { InMemoryNarrationMemory } from '../../narration-memory/src/index.js';
import { createNarrationQualityGuard } from '../../narration-quality-guard/src/index.js';

const FORBIDDEN_NARRATION_PATTERNS = [
  /modo local de diagn[oó]stico/i,
  /DM'?s eyes only/i,
  /Adventure Maps?/i,
  /The Cragmaw tribe/i,
  /has orders from/i,
  /poorly defended caravans/i,
  /Game Master(?:'s)? notes?/i,
  /Journal Entry(?: Page)?/i,
  /data-roll-name-ancestor/i,
  /ve-rd__b-inset/i
];

const MECHANICAL_ROOM_PATTERNS = [
  ['REPORT_OPENING', /\ba sala (?:apresenta|possui|cont[eé]m|disp[oõ]e de)\b/i],
  ['REPORT_SPACE', /\bo (?:espa[cç]o|ambiente|recinto) (?:apresenta|permanece|possui|cont[eé]m)\b/i],
  ['EXISTENCE_REPORT', /(?:^|[^\p{L}\p{N}_])(?:h[aá]|existe(?:m)?|encontra(?:m)?-se|localiza(?:m)?-se|pode(?:m)? ser (?:visto|vistos|vista|vistas|observado|observados|observada|observadas))(?=$|[^\p{L}\p{N}_])/iu],
  ['VISIBLE_ELEMENTS', /\b(?:elementos?|detalhes?) (?:vis[ií]veis|confirmados)\b/i],
  ['POSSIBILITY_FRAMING', /(?:^|\s)[eé] poss[ií]vel (?:ver|observar|notar|perceber)\b/i],
  ['READING_FRAMING', /\b(?:oferece|oferecendo|permite) (?:ao grupo )?uma (?:leitura|vis[aã]o)\b/i],
  ['SPACE_ORGANIZATION', /\borganiz(?:a|am|ado|ada|ando) o espa[cç]o\b/i],
  ['TOLD_EMOTION', /\b(?:(?:criando|causando|provocando|refor[cç]ando) (?:um|uma) (?:ambiente|atmosfera|clima|sensa[cç][aã]o)|(?:a|uma) (?:tens[aã]o|atmosfera) (?:paira|toma conta))\b/i],
  ['OBSERVER_FRAMING', /\b(?:voc[eê]s?|o personagem) (?:v[eê]|veem|observa|observam|nota|notam|percebe|percebem)\b/i],
  ['VISION_TECHNICALITY', /\b(?:token|linha de vis[aã]o|campo de vis[aã]o|raio de vis[aã]o|grade do mapa|marcador da sala)\b/i]
];

const ROOM_NARRATIVE_DIRECTIONS = Object.freeze([
  Object.freeze({
    tone: 'tensão contida, produzida pela pausa e pela ordem dos detalhes',
    opening: 'abra com uma frase breve sobre a imagem concreta mais forte',
    movement: 'avance do primeiro plano para o fundo, alternando uma frase curta e outra mais ampla',
    closing: 'encerre sobre um limite visível — passagem, porta, sombra ou obstáculo confirmado — sem explicar sua importância'
  }),
  Object.freeze({
    tone: 'descoberta intensa, sem declarar perigo ou controlar emoções',
    opening: 'comece por um detalhe próximo e deixe a escala do lugar surgir depois',
    movement: 'conduza o olhar por contraste de luz, altura, distância ou geometria que esteja na âncora',
    closing: 'termine na imagem mais carregada de expectativa que já esteja confirmada'
  }),
  Object.freeze({
    tone: 'inquietação sóbria, criada apenas pela cadência',
    opening: 'entre direto na cena com um verbo concreto e sem introdução explicativa',
    movement: 'revele dois detalhes conectados, com comprimentos de frase claramente diferentes',
    closing: 'faça a última frase desacelerar sobre um detalhe imóvel e visível'
  }),
  Object.freeze({
    tone: 'assombro cauteloso, apoiado na escala e no enquadramento visíveis',
    opening: 'comece pelo panorama e corte rapidamente para um detalhe específico',
    movement: 'use a progressão espacial para unir os fatos, nunca uma enumeração',
    closing: 'pare antes de interpretar a cena, deixando a imagem final sustentar a tensão'
  }),
  Object.freeze({
    tone: 'urgência contida, com linguagem concisa e pulsação crescente',
    opening: 'abra com o elemento que mais interrompe ou domina o recorte visível',
    movement: 'encadeie o restante como um movimento de câmera contínuo',
    closing: 'feche com uma frase curta sobre o último detalhe alcançado pela visão'
  })
]);

function createServiceError(message, { statusCode = 500, code = 'NARRATION_FAILED' } = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeWords(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function stableHash(value) {
  let result = 2166136261;
  for (const character of String(value ?? '')) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function createRoomNarrativeDirection(sceneKey, attempt = 0) {
  const index = (stableHash(sceneKey) + Math.max(0, Number(attempt) || 0)) % ROOM_NARRATIVE_DIRECTIONS.length;
  const direction = ROOM_NARRATIVE_DIRECTIONS[index];
  return { ...direction, signature: `room-style-${index + 1}` };
}

function escapeRegExp(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniqueActorNames(values) {
  const names = [];
  const normalized = new Set();
  for (const value of values ?? []) {
    const name = String(value ?? '').trim();
    const key = name.toLocaleLowerCase('pt-BR');
    if (name.length < 2 || normalized.has(key)) continue;
    normalized.add(key);
    names.push(name);
  }
  return names.sort((left, right) => right.length - left.length);
}

function actorNamePattern(name) {
  return new RegExp(`(^|[^\\p{L}\\p{N}_])(${escapeRegExp(name)})(?=$|[^\\p{L}\\p{N}_])`, 'giu');
}

export function redactActorNames(value, actorNames = []) {
  let text = String(value ?? '');
  for (const name of uniqueActorNames(actorNames)) {
    text = text.replace(actorNamePattern(name), '$1[personagem]');
  }
  return text;
}

export function evaluateActorNameSafety(candidate, actorNames = []) {
  const text = String(candidate ?? '');
  const mentions = uniqueActorNames(actorNames).filter((name) => actorNamePattern(name).test(text));
  return {
    safe: mentions.length === 0,
    issues: mentions.map(() => 'PLAYER_ACTOR_NAME_MENTIONED'),
    mentions
  };
}

function containsCopiedRun(candidate, source, size = 9) {
  const candidateWords = normalizeWords(candidate);
  const sourceWords = normalizeWords(source);
  if (candidateWords.length < size || sourceWords.length < size) return false;

  const sourceRuns = new Set();
  for (let index = 0; index <= sourceWords.length - size; index += 1) {
    sourceRuns.add(sourceWords.slice(index, index + size).join(' '));
  }
  for (let index = 0; index <= candidateWords.length - size; index += 1) {
    if (sourceRuns.has(candidateWords.slice(index, index + size).join(' '))) return true;
  }
  return false;
}

export function evaluateOpeningSafety(candidate, sourceText) {
  const text = String(candidate ?? '').trim();
  const issues = [];
  if (!text) issues.push('EMPTY_NARRATION');
  for (const pattern of FORBIDDEN_NARRATION_PATTERNS) {
    if (pattern.test(text)) issues.push(`FORBIDDEN_PATTERN:${pattern.source}`);
  }
  if (containsCopiedRun(text, sourceText)) issues.push('SOURCE_TEXT_COPIED');
  return { safe: issues.length === 0, issues };
}

function narrationReferenceSource(context, sourceText) {
  const imported = (context?.adventure?.references ?? []).map((entry) => entry?.text).filter(Boolean);
  return [sourceText, ...imported].filter(Boolean).join('\n\n');
}

function evaluateSafetyWithActorExclusions(candidate, sourceText, actorNames) {
  const contentSafety = evaluateOpeningSafety(candidate, sourceText);
  const actorSafety = evaluateActorNameSafety(candidate, actorNames);
  return {
    safe: contentSafety.safe && actorSafety.safe,
    issues: [...contentSafety.issues, ...actorSafety.issues],
    actorMentions: actorSafety.mentions
  };
}

export function evaluateRoomNarrationStyle(candidate, { sourceText = '', allowCanonicalNonVisual = false } = {}) {
  const text = String(candidate ?? '').trim();
  const issues = [];
  if (!text) issues.push('EMPTY_NARRATION');
  for (const [code, pattern] of MECHANICAL_ROOM_PATTERNS) {
    if (pattern.test(text)) issues.push(code);
  }
  const inventoryLists = text.match(/(?:,[^.!?;,]{2,}){2,}\s+(?:e|ou)\s+[^.!?]+[.!?]/giu) ?? [];
  if (inventoryLists.length) issues.push('INVENTORY_LIST');

  const sentenceWordCounts = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeWords(sentence).length)
    .filter(Boolean);
  const rhythmRange = sentenceWordCounts.length
    ? Math.max(...sentenceWordCounts) - Math.min(...sentenceWordCounts)
    : 0;
  if (sentenceWordCounts.length >= 3 && rhythmRange <= 2) issues.push('UNIFORM_SENTENCE_RHYTHM');

  const nonVisualTerms = [
    'som', 'sons', 'eco', 'ecos', 'silêncio', 'rangido', 'rangidos', 'gotejo', 'gotejar',
    'murmúrio', 'murmúrios', 'voz', 'vozes', 'passos', 'cheiro', 'odor', 'aroma',
    'frio', 'calor', 'temperatura'
  ];
  const canonicalText = String(sourceText ?? '');
  const unsupportedNonVisualTerms = nonVisualTerms.filter((term) => {
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${term}(?=$|[^\\p{L}\\p{N}_])`, 'iu');
    if (!pattern.test(text)) return false;
    return !allowCanonicalNonVisual || !pattern.test(canonicalText);
  });
  if (unsupportedNonVisualTerms.length) issues.push('NON_VISUAL_ROOM_DETAIL');

  return {
    natural: issues.length === 0,
    issues,
    metrics: {
      sentenceWordCounts,
      rhythmRange,
      inventoryListCount: inventoryLists.length,
      nonVisualTerms: unsupportedNonVisualTerms
    }
  };
}

function ensureDecisionEnding(value) {
  const text = String(value ?? '').trim().replace(/(?:\s*O que vocês fazem\?\s*)+$/i, '').trim();
  return `${text}\n\nO que vocês fazem?`;
}

const DYNAMIC_META_PATTERNS = Object.freeze([
  ['FOUNDRY_META', /\b(?:Foundry|Combat Tracker|resultado de regras|estado mec[aâ]nico)\b/i],
  ['ROLL_META', /\b(?:rolagem (?:foi )?confirmada|total\s*[:=]?\s*-?\d+|dano\s*[:=]?\s*-?\d+|CD\s*\d+)\b/i],
  ['GENERIC_CLIFFHANGER', /\b(?:o que vir[aá] a seguir|o momento [eé] de expectativa|resta saber|s[oó] o tempo dir[aá]|a cena aguarda o pr[oó]ximo passo)\b/i],
  ['ROBOTIC_RESULT', /\b(?:o resultado [eé] claro|a a[cç][aã]o declarada|a rodada produz um resultado)\b/i]
]);

function hasAuthoritativeMechanics(resolutions = []) {
  return (resolutions ?? []).some((resolution) => {
    const result = resolution?.rules?.result;
    const roll = resolution?.rules?.combat?.roll ?? resolution?.action?.roll;
    return Boolean(result?.authoritative) || Boolean(roll?.authoritative && (
      roll.total !== null && roll.total !== undefined ||
      roll.damageTotal !== null && roll.damageTotal !== undefined ||
      roll.outcome
    ));
  });
}

function dynamicMarkerMetrics(text) {
  const markers = [...String(text ?? '').matchAll(/\[([^\]]{1,50})\]/g)];
  let misplaced = 0;
  for (const marker of markers) {
    const before = String(text ?? '').slice(0, marker.index).trimEnd().slice(-1);
    if (before && !/[.!?…—:]/.test(before)) misplaced += 1;
  }
  return {
    count: markers.length,
    stacked: /\[[^\]]+\]\s*\[[^\]]+\]/.test(text),
    misplaced
  };
}

export function evaluateDynamicNarration(candidate, {
  authoritativeMechanics = false,
  allowQuestionEnding = false
} = {}) {
  const text = String(candidate ?? '').trim();
  const hardIssues = [];
  const issues = [];
  if (!text) hardIssues.push('EMPTY_NARRATION');
  for (const [code, pattern] of DYNAMIC_META_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (code === 'ROLL_META' && authoritativeMechanics) issues.push(code);
    else if (code === 'ROLL_META' || code === 'FOUNDRY_META') hardIssues.push(code);
    else issues.push(code);
  }
  if (!allowQuestionEnding && /\?\s*$/.test(text)) issues.push('QUESTION_ENDING');
  const markerMetrics = dynamicMarkerMetrics(text);
  if (markerMetrics.count > 3) issues.push('EXCESSIVE_MARKERS');
  if (markerMetrics.stacked) issues.push('STACKED_MARKERS');
  if (markerMetrics.misplaced > 0) issues.push('MID_SENTENCE_MARKER');
  return {
    accepted: hardIssues.length === 0 && issues.length === 0,
    hardSafe: hardIssues.length === 0,
    hardIssues,
    issues,
    markerMetrics,
    penalty: hardIssues.length * 100 + issues.length * 10
  };
}

function dynamicFeedback(evaluation) {
  const descriptions = {
    EMPTY_NARRATION: 'produza uma narração completa',
    FOUNDRY_META: 'remova qualquer menção a Foundry, Combat Tracker, regras ou bastidores',
    ROLL_META: 'não leia números nem diga que uma rolagem foi confirmada; transforme somente resultados autoritativos em consequência narrativa',
    GENERIC_CLIFFHANGER: 'substitua a expectativa genérica por uma imagem concreta do estado atual da cena',
    ROBOTIC_RESULT: 'abandone fórmulas mecânicas como “o resultado é claro” e escreva com oralidade natural',
    QUESTION_ENDING: 'encerre com uma imagem ou estado concreto, sem pergunta',
    EXCESSIVE_MARKERS: 'use no máximo três marcações expressivas',
    STACKED_MARKERS: 'não empilhe marcações',
    MID_SENTENCE_MARKER: 'coloque marcações somente no início de frases ou entre períodos completos'
  };
  return [...evaluation.hardIssues, ...evaluation.issues].map((issue) => descriptions[issue] ?? issue);
}

function createRecord({ context, openingContext, sceneKey, plan, candidate, evaluation, quality, noveltyStatus, guard }) {
  return {
    id: crypto.randomUUID(),
    sceneKey,
    campaignId: context.campaign?.worldId ?? null,
    sceneId: openingContext.scene?.id ?? null,
    sceneName: openingContext.scene?.name ?? null,
    areaName: openingContext.source?.areaName ?? null,
    sourceType: openingContext.source?.type ?? null,
    plan,
    text: candidate,
    fingerprint: guard.fingerprint(candidate),
    similarityToHistory: evaluation.maxSimilarity,
    quality: quality ? {
      status: quality.accepted ? 'accepted' : 'best-effort',
      issues: quality.issues,
      hardIssues: quality.hardIssues,
      metrics: quality.metrics
    } : null,
    noveltyStatus,
    noveltyMode: evaluation.mode ?? 'STYLE_ONLY_V2',
    createdAt: new Date().toISOString()
  };
}

export class NarrationService {
  constructor({
    provider = null,
    openingContextBuilder = null,
    openingPlanner = null,
    noveltyGuard = null,
    qualityGuard = null,
    roomQualityGuard = null,
    narrationMemory = null,
    maxOpeningAttempts = 5,
    maxDynamicAttempts = 3,
    logger = console
  } = {}) {
    this.provider = provider;
    this.logger = logger;
    this.openingContextBuilder = openingContextBuilder ?? createSceneOpeningContextBuilder({ logger });
    this.openingPlanner = openingPlanner ?? createOpeningNarrativePlanner();
    this.noveltyGuard = noveltyGuard ?? createNoveltyGuard();
    this.qualityGuard = qualityGuard ?? createNarrationQualityGuard();
    this.roomQualityGuard = roomQualityGuard ?? createNarrationQualityGuard({ minWords: 50, maxWords: 120, minimumHardWords: 25, minParagraphs: 1, maxParagraphs: 2 });
    this.narrationMemory = narrationMemory ?? new InMemoryNarrationMemory();
    this.maxOpeningAttempts = Math.max(1, Number(maxOpeningAttempts) || 5);
    this.maxDynamicAttempts = Math.max(1, Number(maxDynamicAttempts) || 3);
  }

  async narrateDynamic(operation, payload, { authoritativeMechanics = false } = {}) {
    const attempts = [];
    for (let attempt = 0; attempt < this.maxDynamicAttempts; attempt += 1) {
      const candidate = String(await this.provider[operation]({
        ...payload,
        qualityFeedback: attempts.length ? dynamicFeedback(attempts.at(-1).evaluation) : []
      }) ?? '').trim();
      const evaluation = evaluateDynamicNarration(candidate, { authoritativeMechanics });
      attempts.push({ candidate, evaluation });
      if (evaluation.accepted) return candidate;
      this.logger.warn?.('[Mestre Orc][DynamicNarration] tentativa rejeitada', {
        operation,
        attempt: attempt + 1,
        hardIssues: evaluation.hardIssues,
        issues: evaluation.issues,
        markerMetrics: evaluation.markerMetrics
      });
    }
    const best = [...attempts]
      .filter((entry) => entry.evaluation.hardSafe)
      .sort((left, right) => left.evaluation.penalty - right.evaluation.penalty)[0];
    if (best) return best.candidate;
    throw createServiceError('A IA não produziu uma narração segura e natural após as tentativas de correção.', {
      statusCode: 502,
      code: 'NARRATION_QUALITY_FAILED'
    });
  }

  async createOpening(context) {
    try {
      if (!this.provider?.createOpening) {
        throw createServiceError(
          'A Groq não está configurada. Crie o arquivo .env com GROQ_API_KEY e GROQ_MODEL e reinicie o Engine.',
          { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
        );
      }

      const openingContext = this.openingContextBuilder.build(context);
      if (!openingContext.source?.canonicalAnchor || !openingContext.source?.text) {
        throw createServiceError(
          'Nenhuma caixa read-aloud segura chegou ao Engine. A abertura não será publicada.',
          { statusCode: 422, code: 'READ_ALOUD_REQUIRED' }
        );
      }

      const sceneKey = this.openingPlanner.buildSceneKey(openingContext);
      const history = await this.narrationMemory.list(sceneKey, { limit: 20 });
      const attempts = [];
      const forbiddenActorNames = uniqueActorNames([
        ...(openingContext.narrationExclusions?.actorNames ?? []),
        ...(openingContext.visibleActors ?? []).map((actor) => actor?.name)
      ]);
      const { narrationExclusions: _openingExclusions, ...providerOpeningContext } = openingContext;

      for (let attempt = 0; attempt < this.maxOpeningAttempts; attempt += 1) {
        const planHistory = [...history, ...attempts.filter((item) => item.safety?.safe).map((item) => ({ plan: item.plan }))];
        const plan = this.openingPlanner.createPlan({ context: openingContext, history: planHistory, attempt });
        const avoidOpenings = [
          ...history.slice(-6).map((entry) => ({
            id: entry.id,
            planSignature: entry.plan?.signature ?? null,
            excerpt: redactActorNames(String(entry.text ?? ''), forbiddenActorNames).slice(0, 700),
            source: 'history'
          })),
          ...attempts.filter((entry) => entry.safety?.safe).slice(-3).map((entry, index) => ({
            id: `current-attempt-${index + 1}`,
            planSignature: entry.plan?.signature ?? null,
            excerpt: String(entry.candidate ?? '').slice(0, 700),
            source: 'current-run'
          }))
        ];
        const providerContext = {
          ...providerOpeningContext,
          // A abertura é ambiental. Nomes de tokens da Scene nunca chegam ao provedor.
          visibleActors: [],
          narrativePlan: plan,
          novelty: {
            attempt: attempt + 1,
            priorCount: history.length,
            rejectedThisRun: attempts.length,
            forceContrast: attempt === this.maxOpeningAttempts - 1,
            avoidOpenings
          },
          quality: {
            target: {
              minWords: this.qualityGuard.minWords,
              maxWords: this.qualityGuard.maxWords,
              maxParagraphs: this.qualityGuard.maxParagraphs
            },
            rejected: attempts.slice(-3).map((entry) => ({
              issues: entry.quality?.issues ?? [],
              hardIssues: entry.quality?.hardIssues ?? [],
              metrics: entry.quality?.metrics ?? null
            }))
          }
        };

        const generated = await this.provider.createOpening(providerContext);
        const candidate = ensureDecisionEnding(generated);
        const safety = evaluateSafetyWithActorExclusions(candidate, openingContext.source.text, forbiddenActorNames);

        if (!safety.safe) {
          attempts.push({ candidate, safety, plan, evaluation: null });
          this.logger.warn?.('[Mestre Orc][SafetyGuard] narração rejeitada antes da publicação', {
            sceneKey,
            attempt: attempt + 1,
            issues: safety.issues,
            plan: plan.signature
          });
          continue;
        }

        const quality = this.qualityGuard.evaluate(candidate, openingContext);
        if (!quality.hardSafe) {
          attempts.push({ candidate, safety, quality, evaluation: null, plan });
          this.logger.warn?.('[Mestre Orc][QualityGuard] narração rejeitada por violação grave', {
            sceneKey,
            attempt: attempt + 1,
            hardIssues: quality.hardIssues,
            metrics: quality.metrics,
            plan: plan.signature
          });
          continue;
        }

        const evaluation = this.noveltyGuard.evaluate(candidate, history);
        attempts.push({ candidate, safety, quality, evaluation, plan });

        this.logger.info?.('[Mestre Orc][QualityGuard] abertura avaliada', {
          sceneKey,
          attempt: attempt + 1,
          accepted: quality.accepted,
          issues: quality.issues,
          metrics: quality.metrics,
          plan: plan.signature
        });
        this.logger.info?.('[Mestre Orc][NoveltyGuard] abertura avaliada', {
          sceneKey,
          attempt: attempt + 1,
          priorCount: history.length,
          accepted: evaluation.accepted,
          maxSimilarity: Number(evaluation.maxSimilarity.toFixed(3)),
          threshold: evaluation.threshold,
          mode: evaluation.mode,
          plan: plan.signature
        });

        if (!quality.accepted || !evaluation.accepted) continue;

        const record = createRecord({
          context,
          openingContext,
          sceneKey,
          plan,
          candidate,
          evaluation,
          quality,
          noveltyStatus: 'accepted',
          guard: this.noveltyGuard
        });
        await this.narrationMemory.append(record);
        return candidate;
      }

      const safeAttempts = attempts.filter((item) => item.safety?.safe && item.quality?.hardSafe && item.evaluation);
      const best = [...safeAttempts].sort((left, right) => {
        const qualityDifference = left.quality.penalty - right.quality.penalty;
        return qualityDifference || left.evaluation.maxSimilarity - right.evaluation.maxSimilarity;
      })[0];
      if (!best) {
        const hadSafetyFailure = attempts.some((item) => !item.safety?.safe);
        throw createServiceError(
          hadSafetyFailure
            ? 'A IA não produziu uma narração segura: foi detectada cópia do texto-fonte ou vazamento de conteúdo do mestre.'
            : 'A IA não produziu uma narração utilizável sem controlar personagens ou inventar detalhes não confirmados.',
          { statusCode: 502, code: hadSafetyFailure ? 'NARRATION_SAFETY_FAILED' : 'NARRATION_QUALITY_FAILED' }
        );
      }

      this.logger.warn?.('[Mestre Orc][QualityGuard] limite ideal não alcançado; publicando a melhor versão sem violações graves', {
        sceneKey,
        attempts: attempts.length,
        qualityIssues: best.quality.issues,
        qualityMetrics: best.quality.metrics,
        similarity: Number(best.evaluation.maxSimilarity.toFixed(3)),
        threshold: best.evaluation.threshold,
        plan: best.plan.signature
      });

      const record = createRecord({
        context,
        openingContext,
        sceneKey,
        plan: best.plan,
        candidate: best.candidate,
        evaluation: best.evaluation,
        quality: best.quality,
        noveltyStatus: 'best-effort',
        guard: this.noveltyGuard
      });
      await this.narrationMemory.append(record);
      return best.candidate;
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha na abertura', { message: error.message, code: error.code });
      throw error;
    }
  }

  async describeRoom(roomContext) {
    try {
      if (!this.provider?.createRoomEntry) {
        throw createServiceError('A Groq não está configurada para narrar a entrada da sala.', {
          statusCode: 503,
          code: 'AI_NOT_CONFIGURED'
        });
      }
      if (!roomContext?.room?.name || !roomContext?.source?.canonicalAnchor || !roomContext?.source?.text) {
        throw createServiceError('A sala precisa de nome e âncora read-aloud canônica.', {
          statusCode: 422,
          code: 'ROOM_READ_ALOUD_REQUIRED'
        });
      }

      const sceneId = roomContext.scene?.id ?? 'scene-unknown';
      const roomName = String(roomContext.room.name).trim();
      const normalizedRoom = normalizeWords(roomName).join('-') || 'room-unknown';
      const sceneKey = `room:${sceneId}:${normalizedRoom}`;
      const history = await this.narrationMemory.list(sceneKey, { limit: 20 });
      const attempts = [];
      const roomActors = roomContext.visibleActors ?? [];
      const characterNameKeys = new Set(
        roomActors
          .filter((actor) => String(actor?.type ?? '').toLowerCase() === 'character')
          .map((actor) => String(actor?.name ?? '').trim().toLocaleLowerCase('pt-BR'))
          .filter(Boolean)
      );
      const narratableActors = roomActors.filter((actor) => {
        const type = String(actor?.type ?? '').toLowerCase();
        const nameKey = String(actor?.name ?? '').trim().toLocaleLowerCase('pt-BR');
        return type !== 'character' && nameKey && !characterNameKeys.has(nameKey);
      });
      const allowedActorNameKeys = new Set(
        narratableActors.map((actor) => String(actor.name).trim().toLocaleLowerCase('pt-BR'))
      );
      const forbiddenActorNames = uniqueActorNames([
        ...(roomContext.narrationExclusions?.actorNames ?? []).filter((name) =>
          !allowedActorNameKeys.has(String(name ?? '').trim().toLocaleLowerCase('pt-BR'))
        ),
        ...roomActors
          .filter((actor) => String(actor?.type ?? '').toLowerCase() === 'character')
          .map((actor) => actor?.name)
      ]);
      const { narrationExclusions: _roomExclusions, ...providerRoomContext } = roomContext;

      for (let attempt = 0; attempt < this.maxOpeningAttempts; attempt += 1) {
        const styleDirection = createRoomNarrativeDirection(sceneKey, attempt);
        const providerContext = {
          ...providerRoomContext,
          // Somente NPCs comprovadamente visíveis podem participar da descrição.
          visibleActors: narratableActors,
          styleDirection,
          novelty: {
            attempt: attempt + 1,
            priorCount: history.length,
            forceContrast: attempt === this.maxOpeningAttempts - 1,
            avoidOpenings: [
              ...history.slice(-6).map((entry) => ({
                id: entry.id,
                excerpt: redactActorNames(entry.text, forbiddenActorNames),
                source: 'history'
              })),
              ...attempts.filter((entry) => entry.safety?.safe).slice(-3).map((entry, index) => ({
                id: `current-attempt-${index + 1}`,
                excerpt: entry.candidate,
                source: 'current-run'
              }))
            ]
          },
          quality: {
            target: {
              minWords: this.roomQualityGuard.minWords,
              maxWords: this.roomQualityGuard.maxWords,
              maxParagraphs: this.roomQualityGuard.maxParagraphs
            },
            rejected: attempts.slice(-3).map((entry) => ({
              issues: entry.quality?.issues ?? [],
              hardIssues: entry.quality?.hardIssues ?? [],
              styleIssues: entry.style?.issues ?? []
            }))
          }
        };
        const candidate = String(await this.provider.createRoomEntry(providerContext) ?? '')
          .trim()
          .replace(/(?:\s*O que vocês fazem\?\s*)+$/i, '')
          .trim();
        const safety = evaluateSafetyWithActorExclusions(
          candidate,
          narrationReferenceSource(roomContext, roomContext.source.text),
          forbiddenActorNames
        );
        if (!safety.safe) {
          attempts.push({ candidate, safety, styleDirection });
          continue;
        }
        const quality = this.roomQualityGuard.evaluate(candidate, roomContext, { requireDecisionEnding: false });
        const style = evaluateRoomNarrationStyle(candidate, {
          sourceText: roomContext.source.text,
          allowCanonicalNonVisual: Boolean(roomContext.perception?.blinded)
        });
        if (!quality.hardSafe || !style.natural) {
          attempts.push({ candidate, safety, quality, style, styleDirection });
          this.logger.warn?.('[Mestre Orc][RoomQuality] descrição de sala rejeitada', {
            sceneKey,
            attempt: attempt + 1,
            hardIssues: quality.hardIssues,
            styleIssues: style.issues,
            metrics: quality.metrics,
            styleMetrics: style.metrics,
            styleDirection: styleDirection.signature
          });
          continue;
        }
        const evaluation = this.noveltyGuard.evaluate(candidate, history);
        attempts.push({ candidate, safety, quality, style, evaluation, styleDirection });
        if (!quality.accepted || !evaluation.accepted) continue;

        await this.narrationMemory.append({
          id: crypto.randomUUID(),
          sceneKey,
          campaignId: roomContext.campaign?.worldId ?? null,
          sceneId,
          sceneName: roomContext.scene?.name ?? null,
          areaName: roomName,
          sourceType: roomContext.source?.type ?? 'ROOM_READ_ALOUD',
          text: candidate,
          fingerprint: this.noveltyGuard.fingerprint(candidate),
          similarityToHistory: evaluation.maxSimilarity,
          quality: {
            status: 'accepted',
            issues: quality.issues,
            hardIssues: quality.hardIssues,
            styleIssues: style.issues,
            styleMetrics: style.metrics,
            metrics: quality.metrics
          },
          styleDirection,
          noveltyStatus: 'accepted',
          createdAt: new Date().toISOString()
        });
        return candidate;
      }

      const safe = attempts.filter((entry) =>
        entry.safety?.safe && entry.quality?.hardSafe && entry.style?.natural && entry.evaluation
      );
      const best = [...safe].sort((left, right) =>
        left.quality.penalty - right.quality.penalty || left.evaluation.maxSimilarity - right.evaluation.maxSimilarity
      )[0];
      if (!best) {
        const safetyFailure = attempts.some((entry) => !entry.safety?.safe);
        throw createServiceError(
          safetyFailure ? 'A descrição da sala copiou ou vazou conteúdo reservado.' : 'A descrição da sala falhou nos controles de qualidade.',
          { statusCode: 502, code: safetyFailure ? 'NARRATION_SAFETY_FAILED' : 'NARRATION_QUALITY_FAILED' }
        );
      }
      await this.narrationMemory.append({
        id: crypto.randomUUID(), sceneKey, campaignId: roomContext.campaign?.worldId ?? null,
        sceneId, sceneName: roomContext.scene?.name ?? null, areaName: roomName,
        sourceType: roomContext.source?.type ?? 'ROOM_READ_ALOUD', text: best.candidate,
        fingerprint: this.noveltyGuard.fingerprint(best.candidate), similarityToHistory: best.evaluation.maxSimilarity,
        quality: {
          status: 'best-effort',
          issues: best.quality.issues,
          hardIssues: best.quality.hardIssues,
          styleIssues: best.style.issues,
          styleMetrics: best.style.metrics,
          metrics: best.quality.metrics
        },
        styleDirection: best.styleDirection,
        noveltyStatus: 'best-effort', createdAt: new Date().toISOString()
      });
      return best.candidate;
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha na entrada da sala', { message: error.message, code: error.code });
      throw error;
    }
  }

  async narrateRound({ roundNumber, resolutions = [], npcCoordination = {}, worldState = {}, context }) {
    try {
      if (!resolutions.length) {
        throw createServiceError('A rodada não possui ações para narrar.', { statusCode: 400, code: 'EMPTY_ROUND' });
      }
      if (this.provider?.narrateRound) {
        return await this.narrateDynamic('narrateRound', {
          roundNumber, resolutions, npcCoordination, worldState, context
        }, { authoritativeMechanics: hasAuthoritativeMechanics(resolutions) });
      }
      if (resolutions.length === 1 && this.provider?.narrateResolution) {
        const [resolution] = resolutions;
        return await this.narrateDynamic('narrateResolution', {
          intent: resolution.intent,
          rules: resolution.rules,
          relationship: resolution.relationship,
          context
        }, { authoritativeMechanics: hasAuthoritativeMechanics(resolutions) });
      }
      throw createServiceError(
        'A Groq não está configurada para narrar a resolução consolidada da rodada.',
        { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
      );
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha na rodada consolidada', { message: error.message });
      throw error;
    }
  }


  async narrateCombatTurn({ combat, turn, resolutions = [], context }) {
    try {
      if (!resolutions.length) {
        throw createServiceError('O turno não possui ações para narrar.', { statusCode: 400, code: 'EMPTY_COMBAT_TURN' });
      }
      if (this.provider?.narrateCombatTurn) {
        return await this.narrateDynamic('narrateCombatTurn', {
          combat, turn, resolutions, context
        }, { authoritativeMechanics: hasAuthoritativeMechanics(resolutions) });
      }
      throw createServiceError(
        'A Groq não está configurada para narrar o turno de combate.',
        { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
      );
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha no turno de combate', { message: error.message });
      throw error;
    }
  }

  async narrateCombatRound({ combat, roundNumber, turns = [], context }) {
    try {
      if (!turns.length) {
        throw createServiceError('A rodada não possui turnos resolvidos para resumir.', { statusCode: 400, code: 'EMPTY_COMBAT_ROUND' });
      }
      if (this.provider?.narrateCombatRound) {
        const resolutions = turns.flatMap((turn) => turn.resolutions ?? []);
        return await this.narrateDynamic('narrateCombatRound', {
          combat, roundNumber, turns, context
        }, { authoritativeMechanics: hasAuthoritativeMechanics(resolutions) });
      }
      throw createServiceError(
        'A Groq não está configurada para resumir a rodada de combate.',
        { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
      );
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha no resumo do combate', { message: error.message });
      throw error;
    }
  }

  async narrateResolution({ intent, rules, relationship, context }) {
    try {
      if (this.provider?.narrateResolution) {
        return await this.narrateDynamic('narrateResolution', {
          intent, rules, relationship, context
        }, { authoritativeMechanics: hasAuthoritativeMechanics([{ rules }]) });
      }
      throw createServiceError(
        'A Groq não está configurada para narrar a resolução da ação.',
        { statusCode: 503, code: 'AI_NOT_CONFIGURED' }
      );
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha na resolução', { message: error.message });
      throw error;
    }
  }
}
