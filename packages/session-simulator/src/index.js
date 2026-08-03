import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { createSessionRuntime } from '../../session-runtime/src/index.js';

const SILENT_LOGGER = Object.freeze({
  debug() {}, info() {}, log() {}, warn() {}, error() {}
});

const OPENING = `A galeria de pedra se estende sob arcos baixos, iluminada por duas chamas imóveis presas às paredes. A poeira cobre as lajes e suaviza as marcas antigas no chão. À frente, uma porta de madeira reforçada ocupa o centro do muro, enquanto um corredor estreito desaparece pela lateral direita. Nenhum movimento quebra a geometria do lugar. Entre as colunas, o caminho permanece aberto, mas cada passagem conduz para uma parte diferente das ruínas.\n\nO que vocês fazem?`;
const ROOM_ENTRY = `A passagem termina em uma câmara quadrada, marcada por pilares curtos e pedras deslocadas junto às paredes. Uma mesa partida ocupa o centro, cercada por fragmentos de cerâmica e tiras de tecido envelhecido. Ao fundo, uma porta estreita permanece fechada sob um arco rachado. A luz alcança apenas parte do piso e deixa o limite da próxima passagem recortado entre os blocos. A sala permanece imóvel, com espaço suficiente para avançar por mais de um caminho.`;
const ROUND_NARRATION = `[foco] As declarações se transformam em uma única sequência: a conversa prende a atenção do vigia enquanto a busca pelo mecanismo acompanha a parede. O grupo preserva espaço entre si, compara os sinais encontrados e termina a rodada diante da passagem ainda fechada.`;
const TURN_NARRATION = `[tenso] O movimento parte sem hesitação. A ação alcança o alvo indicado, o resultado confirmado define a troca e os combatentes reajustam suas posições antes que a iniciativa avance.`;
const ROUND_SUMMARY = `[foco] A rodada termina com o grupo mantendo a passagem, os adversários pressionados para trás e as posições claramente definidas para a próxima troca.`;

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function cleanPositiveInteger(value, fallback, { min = 1, max = 1000 } = {}) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

function percentile(values, percentileValue) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1));
  return Number(sorted[index].toFixed(3));
}

function roundMetric(value) {
  return Number(Number(value || 0).toFixed(3));
}

function compactError(error) {
  return {
    code: String(error?.code ?? 'SIMULATION_FAILED').slice(0, 120),
    message: String(error?.message ?? error ?? 'Falha desconhecida').replace(/\s+/g, ' ').trim().slice(0, 500)
  };
}

function assertion(condition, message, details = null) {
  if (condition) return;
  const error = new Error(message);
  error.code = 'SIMULATION_ASSERTION_FAILED';
  error.details = details;
  throw error;
}

export function createDeterministicNarrator({ latencyMs = 0, fail = {} } = {}) {
  const calls = {};
  const remainingFailures = new Map(Object.entries(fail).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));

  async function answer(method, value) {
    calls[method] = (calls[method] ?? 0) + 1;
    await sleep(latencyMs);
    const remaining = remainingFailures.get(method) ?? 0;
    if (remaining > 0) {
      remainingFailures.set(method, remaining - 1);
      const error = new Error(`Falha transitória simulada em ${method}.`);
      error.code = 'SIMULATED_PROVIDER_FAILURE';
      throw error;
    }
    return typeof value === 'function' ? value() : value;
  }

  return {
    calls,
    createOpening: () => answer('createOpening', OPENING),
    createRoomEntry: () => answer('createRoomEntry', ROOM_ENTRY),
    narrateRound: () => answer('narrateRound', ROUND_NARRATION),
    narrateResolution: () => answer('narrateResolution', ROUND_NARRATION),
    narrateCombatTurn: () => answer('narrateCombatTurn', TURN_NARRATION),
    narrateCombatRound: () => answer('narrateCombatRound', ROUND_SUMMARY),
    suggestAutomations: () => answer('suggestAutomations', JSON.stringify({ proposals: [] }))
  };
}

export function createSimulationSnapshot({ campaignId = 'simulation-world', playerCount = 5 } = {}) {
  const count = cleanPositiveInteger(playerCount, 5, { min: 1, max: 20 });
  const players = Array.from({ length: count }, (_, index) => ({
    id: `hero-${index + 1}`,
    name: `Aventureiro ${index + 1}`,
    type: 'character'
  }));
  return {
    activeScene: {
      id: 'scene-simulation-1',
      name: 'Galeria dos Ecos',
      description: 'Uma galeria de pedra liga a entrada às câmaras internas.'
    },
    campaign: { worldId: campaignId, title: 'Campanha de Simulação', systemId: 'dnd5e' },
    visibleActors: [...players, { id: 'npc-vigia', name: 'Vigia de Pedra', type: 'npc' }],
    narrationExclusions: { actorNames: players.map((entry) => entry.name) },
    sceneJournal: {
      id: 'journal-simulation-1',
      name: 'Galeria dos Ecos',
      explicitLink: true,
      selectedPage: {
        id: 'page-simulation-1',
        name: '1. Galeria dos Ecos',
        areaName: '1. Galeria dos Ecos',
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
        content: 'Uma galeria de pedra se estende sob arcos baixos. Duas chamas presas às paredes iluminam lajes cobertas de poeira. Uma porta de madeira reforçada ocupa o muro à frente, e um corredor estreito segue pela lateral direita. Colunas curtas dividem o espaço sem bloquear as duas passagens.'
      }
    }
  };
}

function createCombatSnapshot({ playerCount, activeIndex = 0, round = 1 } = {}) {
  const combatants = Array.from({ length: playerCount }, (_, index) => ({
    id: `combatant-${index + 1}`,
    actorId: `hero-${index + 1}`,
    name: `Aventureiro ${index + 1}`,
    actorType: 'character'
  }));
  combatants.push({ id: 'combatant-npc', actorId: 'npc-vigia', name: 'Vigia de Pedra', actorType: 'npc' });
  return {
    id: 'combat-simulation-1',
    sceneId: 'scene-simulation-1',
    round,
    turn: activeIndex,
    started: true,
    activeCombatant: combatants[activeIndex],
    combatants
  };
}

function createReport({ kind, campaignId, playerCount }) {
  return {
    schemaVersion: 1,
    kind,
    campaignId,
    playerCount,
    startedAt: new Date().toISOString(),
    completedAt: null,
    passed: false,
    durationMs: 0,
    operations: [],
    assertions: [],
    errors: [],
    metrics: {}
  };
}

async function measured(report, name, operation) {
  const startedAt = performance.now();
  try {
    const result = await operation();
    report.operations.push({ name, status: 'PASS', durationMs: roundMetric(performance.now() - startedAt) });
    return result;
  } catch (error) {
    report.operations.push({ name, status: 'FAIL', durationMs: roundMetric(performance.now() - startedAt), error: compactError(error) });
    throw error;
  }
}

function recordAssertion(report, name, condition, details = null) {
  assertion(condition, `Falha na verificação: ${name}`, details);
  report.assertions.push({ name, status: 'PASS', details });
}

export async function runCompleteSessionSimulation({
  campaignId = 'simulation-world',
  playerCount = 5,
  narratorLatencyMs = 0,
  injectTransientRoundFailure = false
} = {}) {
  const normalizedPlayers = cleanPositiveInteger(playerCount, 5, { min: 2, max: 12 });
  const report = createReport({ kind: 'COMPLETE_SESSION', campaignId, playerCount: normalizedPlayers });
  const startedAt = performance.now();
  const publications = [];
  const narrator = createDeterministicNarrator({
    latencyMs: Math.max(0, Number(narratorLatencyMs) || 0),
    fail: injectTransientRoundFailure ? { narrateRound: 1 } : {}
  });
  const runtime = createSessionRuntime({
    narrator,
    publishChat: async (content) => publications.push(String(content)),
    logger: SILENT_LOGGER
  });

  try {
    const snapshot = createSimulationSnapshot({ campaignId, playerCount: normalizedPlayers });
    const opening = await measured(report, 'session.start', () => runtime.start(snapshot));
    recordAssertion(report, 'sessão iniciou em coleta de ações', opening.state === 'COLLECTING_ACTIONS', { state: opening.state });

    const roomInput = {
      eventId: 'room:hero-1:chamber-2',
      scene: snapshot.activeScene,
      campaign: snapshot.campaign,
      room: { id: 'chamber-2', name: 'Câmara das Colunas' },
      source: {
        canonicalAnchor: true,
        type: 'ROOM_READ_ALOUD',
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
        text: 'Uma câmara quadrada contém pilares curtos, uma mesa partida e uma porta estreita sob um arco rachado. Fragmentos de cerâmica e tiras de tecido cobrem parte do piso.'
      },
      perception: {
        observer: { tokenId: 'token-hero-1', actorId: 'hero-1' },
        visionAvailable: true,
        sourceKind: 'LIGHT',
        blinded: false
      },
      visibleActors: []
    };
    const roomResults = await measured(report, 'room.entry.idempotent', () => Promise.all([
      runtime.describeRoom(roomInput),
      runtime.describeRoom(roomInput)
    ]));
    recordAssertion(report, 'entrada de sala duplicada foi bloqueada', roomResults.filter((entry) => entry.duplicate).length === 1, roomResults.map((entry) => entry.duplicate));

    const declarations = Array.from({ length: normalizedPlayers }, (_, index) => ({
      eventId: `round:1:actor:${index + 1}`,
      actorId: `hero-${index + 1}`,
      actorName: `Aventureiro ${index + 1}`,
      tokenId: `token-hero-${index + 1}`,
      content: index % 2 === 0 ? 'Examino a passagem em busca de sinais recentes.' : 'Mantenho atenção no vigia enquanto o grupo investiga.'
    }));
    await measured(report, 'round.actions.concurrent', () => Promise.all(declarations.map((entry) => runtime.processAction(entry))));
    const queuedStatus = runtime.getStatus();
    recordAssertion(report, 'uma declaração por personagem foi preservada', queuedStatus.round?.actionCount === normalizedPlayers, { actionCount: queuedStatus.round?.actionCount });

    let roundResolution;
    if (injectTransientRoundFailure) {
      let transientError = null;
      try {
        await measured(report, 'round.resolve.transient-failure', () => runtime.resolveRound({ eventId: 'round:1:resolve' }));
      } catch (error) {
        transientError = error;
      }
      recordAssertion(report, 'falha transitória foi observada', transientError?.code === 'SIMULATED_PROVIDER_FAILURE', compactError(transientError));
      const afterFailure = runtime.getStatus();
      recordAssertion(report, 'fila foi preservada após falha da IA', afterFailure.round?.actionCount === normalizedPlayers, { actionCount: afterFailure.round?.actionCount });
    }
    roundResolution = await measured(report, 'round.resolve', () => runtime.resolveRound({ eventId: 'round:1:resolve' }));
    recordAssertion(report, 'rodada consolidada resolveu todos os personagens', roundResolution.resolutions?.length === normalizedPlayers, { resolutions: roundResolution.resolutions?.length });

    const turnsToRun = Math.min(3, normalizedPlayers);
    for (let turnIndex = 0; turnIndex < turnsToRun; turnIndex += 1) {
      const combat = createCombatSnapshot({ playerCount: normalizedPlayers, activeIndex: turnIndex, round: 1 });
      await measured(report, `combat.sync.${turnIndex + 1}`, () => runtime.syncCombat(combat));
      const action = {
        eventId: `combat:1:${turnIndex}:action`,
        combatId: combat.id,
        round: 1,
        turn: turnIndex,
        combatantId: combat.activeCombatant.id,
        actorId: combat.activeCombatant.actorId,
        actorName: combat.activeCombatant.name,
        economyType: 'ACTION',
        content: 'Ataco o adversário mais próximo.',
        roll: { total: 15 + turnIndex, damageTotal: 5 + turnIndex, damageType: 'cortante', authoritative: true }
      };
      const duplicatedActions = await measured(report, `combat.action.idempotent.${turnIndex + 1}`, () => Promise.all([
        runtime.processCombatAction(action),
        runtime.processCombatAction(action)
      ]));
      recordAssertion(report, `ação duplicada do turno ${turnIndex + 1} foi bloqueada`, duplicatedActions.filter((entry) => entry.duplicate).length === 1);
      const turn = await measured(report, `combat.turn.resolve.${turnIndex + 1}`, () => runtime.resolveCombatTurn({
        eventId: `combat:1:${turnIndex}:resolve`,
        combatId: combat.id,
        round: 1,
        turn: turnIndex,
        combatantId: combat.activeCombatant.id,
        actorId: combat.activeCombatant.actorId,
        actorName: combat.activeCombatant.name
      }));
      recordAssertion(report, `turno ${turnIndex + 1} foi resolvido`, turn.turn?.resolved === true);
    }

    const summary = await measured(report, 'combat.round.summary', () => runtime.summarizeCombatRound({ eventId: 'combat:1:round:1:summary', round: 1 }));
    recordAssertion(report, 'resumo reuniu os turnos resolvidos', summary.turns?.length === turnsToRun, { turns: summary.turns?.length });
    await measured(report, 'combat.end', () => runtime.endCombat());

    const requester = { id: 'gm-simulation', name: 'Mestre de Teste', isGM: true };
    const created = await measured(report, 'automation.create', () => runtime.createAutomationProposal(campaignId, {
      actionType: 'CHAT_MESSAGE',
      title: 'Registrar conclusão da simulação',
      rationale: 'Validar o ciclo de aprovação sem executar alterações silenciosas.',
      payload: { content: 'A sessão automatizada foi concluída.', visibility: 'GM' },
      requester
    }));
    const approved = await measured(report, 'automation.approve', () => runtime.approveAutomationProposal(campaignId, created.proposal.id, {
      requester, expectedRevision: created.proposal.revision
    }));
    const claimed = await measured(report, 'automation.claim', () => runtime.claimAutomationExecution(campaignId, created.proposal.id, {
      requester, expectedRevision: approved.proposal.revision
    }));
    const executed = await measured(report, 'automation.complete', () => runtime.completeAutomationExecution(campaignId, created.proposal.id, {
      requester,
      expectedRevision: claimed.proposal.revision,
      executionToken: claimed.executionToken,
      success: true,
      receipt: { documentType: 'ChatMessage', documentId: 'simulation-message-1', createdByAutomation: true }
    }));
    recordAssertion(report, 'automação terminou executada após aprovação', executed.proposal.status === 'EXECUTED', { status: executed.proposal.status });

    const memory = await measured(report, 'memory.read', () => runtime.getCampaignMemory(campaignId));
    const memoryRecordCount = Object.values(memory.counts ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);
    recordAssertion(report, 'memória registrou eventos da sessão', memoryRecordCount > 0, memory.counts);

    const status = runtime.getStatus();
    recordAssertion(report, 'nenhuma operação idempotente ficou pendente', status.diagnostics?.pendingIdempotencyOperations === 0, status.diagnostics);
    recordAssertion(report, 'duplicações foram contabilizadas', status.diagnostics?.duplicateEventsBlocked >= turnsToRun + 1, status.diagnostics);
    await measured(report, 'session.end', () => runtime.end());

    report.metrics = {
      publications: publications.length,
      narratorCalls: narrator.calls,
      duplicateEventsBlocked: status.diagnostics?.duplicateEventsBlocked ?? 0,
      completedRounds: status.worldState?.completedRounds ?? 0,
      combatTurnsResolved: turnsToRun,
      operationLatencyMs: {
        p50: percentile(report.operations.map((entry) => entry.durationMs), 50),
        p95: percentile(report.operations.map((entry) => entry.durationMs), 95),
        max: roundMetric(Math.max(...report.operations.map((entry) => entry.durationMs), 0))
      }
    };
    report.passed = true;
  } catch (error) {
    report.errors.push({ ...compactError(error), details: error?.details ?? null });
    report.passed = false;
  } finally {
    report.completedAt = new Date().toISOString();
    report.durationMs = roundMetric(performance.now() - startedAt);
    report.signature = createHash('sha256').update(JSON.stringify({ ...report, signature: undefined })).digest('hex');
  }
  return report;
}

async function runLoadWorker({ workerId, playerCount, rounds, narratorLatencyMs }) {
  const campaignId = `load-world-${workerId}`;
  const narrator = createDeterministicNarrator({ latencyMs: narratorLatencyMs });
  const runtime = createSessionRuntime({ narrator, logger: SILENT_LOGGER });
  const latencies = [];
  let operations = 0;
  let errors = 0;
  const measure = async (operation) => {
    const startedAt = performance.now();
    try { return await operation(); }
    catch (error) { errors += 1; throw error; }
    finally { latencies.push(performance.now() - startedAt); operations += 1; }
  };

  await measure(() => runtime.start(createSimulationSnapshot({ campaignId, playerCount })));
  for (let round = 1; round <= rounds; round += 1) {
    const declarations = Array.from({ length: playerCount }, (_, index) => ({
      eventId: `load:${workerId}:round:${round}:actor:${index + 1}`,
      actorId: `hero-${index + 1}`,
      actorName: `Aventureiro ${index + 1}`,
      content: `Investigo a área durante a rodada ${round}.`
    }));
    await Promise.all(declarations.map((entry) => measure(() => runtime.processAction(entry))));
    await measure(() => runtime.resolveRound({ eventId: `load:${workerId}:round:${round}:resolve` }));
  }
  const status = runtime.getStatus();
  await measure(() => runtime.end());
  return { workerId, campaignId, operations, errors, latencies, status };
}

export async function runLoadSimulation({
  concurrentSessions = 6,
  playerCount = 8,
  rounds = 3,
  narratorLatencyMs = 1,
  thresholds = {}
} = {}) {
  const sessions = cleanPositiveInteger(concurrentSessions, 6, { min: 1, max: 30 });
  const players = cleanPositiveInteger(playerCount, 8, { min: 2, max: 20 });
  const roundCount = cleanPositiveInteger(rounds, 3, { min: 1, max: 20 });
  const report = createReport({ kind: 'LOAD', campaignId: 'multiple', playerCount: players });
  report.concurrentSessions = sessions;
  report.roundsPerSession = roundCount;
  const startedAt = performance.now();
  const heapBefore = process.memoryUsage().heapUsed;
  const limits = {
    maxErrorRate: Number.isFinite(Number(thresholds.maxErrorRate)) ? Number(thresholds.maxErrorRate) : 0,
    maxP95Ms: Number.isFinite(Number(thresholds.maxP95Ms)) ? Number(thresholds.maxP95Ms) : 500,
    maxHeapGrowthMb: Number.isFinite(Number(thresholds.maxHeapGrowthMb)) ? Number(thresholds.maxHeapGrowthMb) : 96
  };

  try {
    const results = await Promise.all(Array.from({ length: sessions }, (_, index) => runLoadWorker({
      workerId: index + 1,
      playerCount: players,
      rounds: roundCount,
      narratorLatencyMs: Math.max(0, Number(narratorLatencyMs) || 0)
    })));
    const durationMs = performance.now() - startedAt;
    const heapAfter = process.memoryUsage().heapUsed;
    const latencies = results.flatMap((entry) => entry.latencies);
    const operations = results.reduce((total, entry) => total + entry.operations, 0);
    const errors = results.reduce((total, entry) => total + entry.errors, 0);
    const errorRate = operations ? errors / operations : 0;
    const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);
    const p95 = percentile(latencies, 95);
    const throughput = durationMs > 0 ? operations / (durationMs / 1000) : operations;

    report.metrics = {
      operations,
      errors,
      errorRate: roundMetric(errorRate),
      throughputOpsPerSecond: roundMetric(throughput),
      latencyMs: {
        p50: percentile(latencies, 50),
        p95,
        p99: percentile(latencies, 99),
        max: roundMetric(Math.max(...latencies, 0))
      },
      heap: {
        beforeMb: roundMetric(heapBefore / (1024 * 1024)),
        afterMb: roundMetric(heapAfter / (1024 * 1024)),
        growthMb: roundMetric(heapGrowthMb)
      },
      completedSessions: results.length,
      completedRounds: results.reduce((total, entry) => total + (entry.status.worldState?.completedRounds ?? 0), 0)
    };

    recordAssertion(report, 'taxa de erro dentro do limite', errorRate <= limits.maxErrorRate, { errorRate, limit: limits.maxErrorRate });
    recordAssertion(report, 'latência p95 dentro do limite', p95 <= limits.maxP95Ms, { p95, limit: limits.maxP95Ms });
    recordAssertion(report, 'crescimento de heap dentro do limite', heapGrowthMb <= limits.maxHeapGrowthMb, { heapGrowthMb, limit: limits.maxHeapGrowthMb });
    recordAssertion(report, 'todas as sessões completaram as rodadas', report.metrics.completedRounds === sessions * roundCount, report.metrics);
    report.passed = true;
  } catch (error) {
    report.errors.push({ ...compactError(error), details: error?.details ?? null });
    report.passed = false;
  } finally {
    report.completedAt = new Date().toISOString();
    report.durationMs = roundMetric(performance.now() - startedAt);
    report.thresholds = limits;
    report.signature = createHash('sha256').update(JSON.stringify({ ...report, signature: undefined })).digest('hex');
  }
  return report;
}

export function summarizeSimulationReport(report) {
  return {
    kind: report.kind,
    passed: report.passed,
    durationMs: report.durationMs,
    operations: report.metrics?.operations ?? report.operations?.length ?? 0,
    assertions: report.assertions?.length ?? 0,
    errors: report.errors?.length ?? 0,
    metrics: report.metrics,
    signature: report.signature
  };
}
