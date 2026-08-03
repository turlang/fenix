import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoadSimulation } from '../packages/session-simulator/src/index.js';

test('múltiplas campanhas executam rodadas concorrentes sem falhas', async () => {
  const report = await runLoadSimulation({
    concurrentSessions: 4,
    playerCount: 6,
    rounds: 2,
    narratorLatencyMs: 1,
    thresholds: { maxP95Ms: 750, maxHeapGrowthMb: 128, maxErrorRate: 0 }
  });
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.metrics.completedSessions, 4);
  assert.equal(report.metrics.completedRounds, 8);
  assert.equal(report.metrics.errors, 0);
});
