import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runLoadSimulation, summarizeSimulationReport } from '../packages/session-simulator/src/index.js';

const report = await runLoadSimulation({
  concurrentSessions: Number(process.env.LOAD_SESSIONS) || 6,
  playerCount: Number(process.env.LOAD_PLAYERS) || 8,
  rounds: Number(process.env.LOAD_ROUNDS) || 3,
  narratorLatencyMs: Number(process.env.LOAD_AI_LATENCY_MS) || 1,
  thresholds: {
    maxErrorRate: process.env.LOAD_MAX_ERROR_RATE,
    maxP95Ms: process.env.LOAD_MAX_P95_MS,
    maxHeapGrowthMb: process.env.LOAD_MAX_HEAP_GROWTH_MB
  }
});

const target = process.env.LOAD_REPORT_FILE?.trim();
if (target) {
  const path = resolve(target);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
console.log(JSON.stringify(summarizeSimulationReport(report), null, 2));
if (!report.passed) process.exitCode = 1;
