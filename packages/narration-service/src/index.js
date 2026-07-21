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

function ensureDecisionEnding(value) {
  const text = String(value ?? '').trim().replace(/(?:\s*O que vocês fazem\?\s*)+$/i, '').trim();
  return `${text}\n\nO que vocês fazem?`;
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
    logger = console
  } = {}) {
    this.provider = provider;
    this.logger = logger;
    this.openingContextBuilder = openingContextBuilder ?? createSceneOpeningContextBuilder({ logger });
    this.openingPlanner = openingPlanner ?? createOpeningNarrativePlanner();
    this.noveltyGuard = noveltyGuard ?? createNoveltyGuard();
    this.qualityGuard = qualityGuard ?? createNarrationQualityGuard();
    this.roomQualityGuard = roomQualityGuard ?? createNarrationQualityGuard({ minWords: 20, maxWords: 120, minimumHardWords: 20, minParagraphs: 1, maxParagraphs: 2 });
    this.narrationMemory = narrationMemory ?? new InMemoryNarrationMemory();
    this.maxOpeningAttempts = Math.max(1, Number(maxOpeningAttempts) || 5);
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

      for (let attempt = 0; attempt < this.maxOpeningAttempts; attempt += 1) {
        const planHistory = [...history, ...attempts.filter((item) => item.safety?.safe).map((item) => ({ plan: item.plan }))];
        const plan = this.openingPlanner.createPlan({ context: openingContext, history: planHistory, attempt });
        const avoidOpenings = [
          ...history.slice(-6).map((entry) => ({
            id: entry.id,
            planSignature: entry.plan?.signature ?? null,
            excerpt: String(entry.text ?? '').slice(0, 700),
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
          ...openingContext,
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
        const safety = evaluateOpeningSafety(candidate, openingContext.source.text);

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

      for (let attempt = 0; attempt < this.maxOpeningAttempts; attempt += 1) {
        const providerContext = {
          ...roomContext,
          novelty: {
            attempt: attempt + 1,
            priorCount: history.length,
            forceContrast: attempt === this.maxOpeningAttempts - 1,
            avoidOpenings: [
              ...history.slice(-6).map((entry) => ({ id: entry.id, excerpt: entry.text, source: 'history' })),
              ...attempts.filter((entry) => entry.safety?.safe).slice(-3).map((entry, index) => ({
                id: `current-attempt-${index + 1}`,
                excerpt: entry.candidate,
                source: 'current-run'
              }))
            ]
          }
        };
        const candidate = String(await this.provider.createRoomEntry(providerContext) ?? '')
          .trim()
          .replace(/(?:\s*O que vocês fazem\?\s*)+$/i, '')
          .trim();
        const safety = evaluateOpeningSafety(candidate, roomContext.source.text);
        if (!safety.safe) {
          attempts.push({ candidate, safety });
          continue;
        }
        const quality = this.roomQualityGuard.evaluate(candidate, roomContext, { requireDecisionEnding: false });
        if (!quality.hardSafe) {
          attempts.push({ candidate, safety, quality });
          continue;
        }
        const evaluation = this.noveltyGuard.evaluate(candidate, history);
        attempts.push({ candidate, safety, quality, evaluation });
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
          quality: { status: 'accepted', issues: quality.issues, hardIssues: quality.hardIssues, metrics: quality.metrics },
          noveltyStatus: 'accepted',
          createdAt: new Date().toISOString()
        });
        return candidate;
      }

      const safe = attempts.filter((entry) => entry.safety?.safe && entry.quality?.hardSafe && entry.evaluation);
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
        quality: { status: 'best-effort', issues: best.quality.issues, hardIssues: best.quality.hardIssues, metrics: best.quality.metrics },
        noveltyStatus: 'best-effort', createdAt: new Date().toISOString()
      });
      return best.candidate;
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Narration] falha na entrada da sala', { message: error.message, code: error.code });
      throw error;
    }
  }

  async narrateResolution({ intent, rules, relationship, context }) {
    try {
      if (this.provider?.narrateResolution) {
        return await this.provider.narrateResolution({ intent, rules, relationship, context });
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
