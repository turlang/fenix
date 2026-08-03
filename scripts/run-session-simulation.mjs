import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runCompleteSessionSimulation, summarizeSimulationReport } from '../packages/session-simulator/src/index.js';

const report = await runCompleteSessionSimulation({
  campaignId: process.env.SIMULATION_CAMPAIGN_ID || 'cli-session-simulation',
  playerCount: Number(process.env.SIMULATION_PLAYERS) || 5,
  narratorLatencyMs: Number(process.env.SIMULATION_AI_LATENCY_MS) || 0,
  injectTransientRoundFailure: process.env.SIMULATION_TRANSIENT_FAILURE === 'true'
});

const target = process.env.SIMULATION_REPORT_FILE?.trim();
if (target) {
  const path = resolve(target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(summarizeSimulationReport(report), null, 2));
if (!report.passed) process.exitCode = 1;
