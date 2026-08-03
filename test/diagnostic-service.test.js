import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiagnosticService, diagnosticInternals } from '../packages/diagnostic-service/src/index.js';

function gm() { return { id: 'gm-1', name: 'Mestre', isGM: true }; }
function service(options = {}) {
  return new DiagnosticService({
    engineVersion: '0.1.0-alpha.49',
    runtime: { getStatus: () => ({ state: 'ACTIVE', campaignId: 'world-1', sceneId: 'scene-1', diagnostics: { duplicateEventsBlocked: 2, pendingIdempotencyOperations: 0 } }) },
    narrator: { getStatus: () => ({ configured: true, primaryProvider: 'groq', activeProvider: 'groq', providers: [{ id: 'groq', state: 'CLOSED', configured: true }], metrics: { requests: 3 } }) },
    neuralVoiceService: { getStatus: () => ({ enabled: true, configured: true, providers: [{ id: 'openai', configured: true }] }) },
    audioNarrationService: { enabled: true, mode: 'neural-auto' },
    ...options
  });
}

test('diagnóstico completo combina Engine, sessão, cliente, IA, voz e armazenamento', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mestre-orc-diagnostic-'));
  try {
    const report = await service({ storagePaths: { memory: join(dir, 'campaign-memory.json') } }).run('world-1', {
      requester: gm(), client: { apiLatencyMs: 42, foundry: { version: '13.351' }, browser: { secureContext: true }, microphone: { supported: true, permission: 'granted' }, scene: { id: 'scene-1' } }
    });
    assert.equal(report.overall, 'PASS');
    assert.equal(report.engine.version, '0.1.0-alpha.49');
    assert.ok(report.checks.some((entry) => entry.id === 'microphone-support' && entry.level === 'PASS'));
    assert.ok(report.checks.some((entry) => entry.id === 'storage-memory' && entry.level === 'PASS'));
    assert.equal(report.runtime.diagnostics.duplicateEventsBlocked, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('diagnóstico exige requester GM', async () => {
  await assert.rejects(() => service().run('world-1', { requester: { id: 'p1', isGM: false } }), (error) => error.code === 'DIAGNOSTIC_GM_REQUIRED' && error.statusCode === 403);
});

test('worldId divergente e microfone negado produzem falha', async () => {
  const report = await service({ runtime: { getStatus: () => ({ state: 'ACTIVE', campaignId: 'other-world', sceneId: null }) } }).run('world-1', {
    requester: gm(), client: { microphone: { supported: true, permission: 'denied' }, browser: { secureContext: true }, foundry: { version: '13' } }
  });
  assert.equal(report.overall, 'FAIL');
  assert.ok(report.checks.some((entry) => entry.id === 'campaign-match' && entry.level === 'FAIL'));
  assert.ok(report.checks.some((entry) => entry.id === 'microphone-support' && entry.level === 'FAIL'));
});

test('telemetria limita eventos, registra latência e sanitiza erros', () => {
  const diagnostic = service({ maxEvents: 50 });
  for (let index = 0; index < 70; index += 1) diagnostic.recordRequest({ method: 'GET', route: `/route/${index}`, statusCode: index === 69 ? 500 : 200, latencyMs: index === 68 ? 2500 : 10, error: index === 69 ? Object.assign(new Error('falha segura'), { code: 'BROKEN' }) : null });
  assert.equal(diagnostic.events.length, 50);
  assert.equal(diagnostic.metrics.requests, 70);
  assert.equal(diagnostic.metrics.slowRequests, 1);
  assert.equal(diagnostic.metrics.lastError.details.error.code, 'BROKEN');
});

test('evento de cliente duplicado é bloqueado e contabilizado', () => {
  const diagnostic = service();
  assert.equal(diagnostic.recordClientEvent('world-1', { eventId: 'same', category: 'MIC', message: 'erro', level: 'WARN' }).duplicate, false);
  assert.equal(diagnostic.recordClientEvent('world-1', { eventId: 'same', category: 'MIC', message: 'erro', level: 'WARN' }).duplicate, true);
  assert.equal(diagnostic.metrics.duplicateClientEvents, 1);
});

test('exportação produz JSON Base64 com SHA-256 e sem credenciais', async () => {
  const result = await service().exportReport('world-1', { requester: gm(), client: { apiKey: 'sk-very-secret', password: 'hidden', microphone: { supported: false } } });
  const text = Buffer.from(result.contentBase64, 'base64').toString('utf8');
  assert.match(result.fileName, /mestre-orc-diagnostico-world-1/);
  assert.equal(result.sha256.length, 64);
  assert.match(text, /mestre-orc-diagnostic-report/);
  assert.doesNotMatch(text, /sk-very-secret|hidden/);
});

test('sanitização remove chaves sensíveis em qualquer profundidade', () => {
  const clean = diagnosticInternals.sanitize({ ok: 1, nested: { Authorization: 'Bearer secret', accessToken: 'x', value: 'visível' } });
  assert.deepEqual(clean, { ok: 1, nested: { value: 'visível' } });
});
