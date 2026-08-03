import test from 'node:test';
import assert from 'node:assert/strict';
import { runCompleteSessionSimulation } from '../packages/session-simulator/src/index.js';

test('sessão recupera falha transitória da IA sem perder declarações', async () => {
  const report = await runCompleteSessionSimulation({
    campaignId: 'integration-failure-recovery',
    playerCount: 4,
    injectTransientRoundFailure: true
  });
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.metrics.narratorCalls.narrateRound, 2);
  assert.ok(report.assertions.some((entry) => entry.name.includes('fila foi preservada')));
});
