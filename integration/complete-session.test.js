import test from 'node:test';
import assert from 'node:assert/strict';
import { runCompleteSessionSimulation } from '../packages/session-simulator/src/index.js';

test('sessão automatizada percorre abertura, sala, rodada, combate, memória e automação', async () => {
  const report = await runCompleteSessionSimulation({ campaignId: 'integration-complete', playerCount: 5 });
  assert.equal(report.passed, true, JSON.stringify(report.errors));
  assert.equal(report.metrics.combatTurnsResolved, 3);
  assert.ok(report.metrics.publications >= 6);
  assert.ok(report.metrics.duplicateEventsBlocked >= 4);
});
