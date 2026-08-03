import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeterministicNarrator,
  createSimulationSnapshot,
  runCompleteSessionSimulation,
  runLoadSimulation,
  summarizeSimulationReport
} from '../packages/session-simulator/src/index.js';

test('snapshot de simulação cria jogadores e Journal seguro', () => {
  const snapshot = createSimulationSnapshot({ campaignId: 'world-test', playerCount: 4 });
  assert.equal(snapshot.campaign.worldId, 'world-test');
  assert.equal(snapshot.visibleActors.filter((entry) => entry.type === 'character').length, 4);
  assert.equal(snapshot.sceneJournal.explicitLink, true);
});

test('narrador determinístico permite injetar falha transitória', async () => {
  const narrator = createDeterministicNarrator({ fail: { narrateRound: 1 } });
  await assert.rejects(() => narrator.narrateRound(), { code: 'SIMULATED_PROVIDER_FAILURE' });
  assert.match(await narrator.narrateRound(), /declarações/);
  assert.equal(narrator.calls.narrateRound, 2);
});

test('simulação completa produz relatório assinado', async () => {
  const report = await runCompleteSessionSimulation({ campaignId: 'world-complete-test', playerCount: 3 });
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.kind, 'COMPLETE_SESSION');
  assert.equal(report.signature.length, 64);
  assert.ok(report.assertions.length >= 10);
  assert.equal(summarizeSimulationReport(report).errors, 0);
});

test('teste de carga leve mede vazão e latência', async () => {
  const report = await runLoadSimulation({ concurrentSessions: 2, playerCount: 3, rounds: 1, narratorLatencyMs: 0 });
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.metrics.completedSessions, 2);
  assert.equal(report.metrics.completedRounds, 2);
  assert.ok(report.metrics.throughputOpsPerSecond > 0);
});
