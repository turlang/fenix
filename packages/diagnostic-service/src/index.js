import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import os from 'node:os';

export const DiagnosticLevels = Object.freeze(['PASS', 'WARN', 'FAIL', 'INFO']);
const BLOCKED_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|passphrase|secret|access[-_]?token|refresh[-_]?token|execution[-_]?token|rollback[-_]?token|private[-_]?key)/i;

function nowIso() { return new Date().toISOString(); }
function cleanText(value, limit = 1000) { return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit); }
function cleanId(value, fallback = 'default') { return cleanText(value, 200).replace(/[^A-Za-z0-9._:-]/g, '-') || fallback; }
function clone(value) { return value == null ? value : structuredClone(value); }
function sanitize(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return cleanText(value, 2500);
  if (depth >= 6) return '[limite de profundidade]';
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitize(entry, depth + 1));
  if (typeof value !== 'object') return cleanText(value, 500);
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 160)) {
    if (BLOCKED_KEY.test(key)) continue;
    result[cleanText(key, 120)] = sanitize(entry, depth + 1);
  }
  return result;
}
function requester(value = {}) {
  const normalized = { id: cleanId(value.id, 'anonymous'), name: cleanText(value.name, 300) || 'Usuário', isGM: Boolean(value.isGM) };
  if (!normalized.isGM) {
    const error = new Error('Somente o mestre pode executar diagnósticos completos.');
    error.code = 'DIAGNOSTIC_GM_REQUIRED'; error.statusCode = 403; throw error;
  }
  return normalized;
}
function check(id, label, level, message, details = null, group = 'ENGINE') {
  return { id, label, level: DiagnosticLevels.includes(level) ? level : 'INFO', message: cleanText(message, 1000), group, details: sanitize(details), checkedAt: nowIso() };
}
function byteSize(value) { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }

export class DiagnosticService {
  constructor({ engineVersion = 'unknown', runtime, narrator, neuralVoiceService, audioNarrationService, storagePaths = {}, logger = console, clock = Date.now, maxEvents = 300 } = {}) {
    this.engineVersion = engineVersion;
    this.runtime = runtime;
    this.narrator = narrator;
    this.neuralVoiceService = neuralVoiceService;
    this.audioNarrationService = audioNarrationService;
    this.storagePaths = Object.fromEntries(Object.entries(storagePaths).map(([key, value]) => [key, value ? resolve(value) : null]));
    this.logger = logger;
    this.clock = clock;
    this.startedAt = clock();
    this.maxEvents = Math.max(50, Math.min(1000, Number(maxEvents) || 300));
    this.events = [];
    this.metrics = { requests: 0, errors: 0, slowRequests: 0, lastLatencyMs: null, lastError: null, duplicateClientEvents: 0 };
    this.clientEventIds = new Set();
  }

  record(type, details = {}, level = 'INFO') {
    const event = { id: randomUUID(), at: nowIso(), type: cleanText(type, 120) || 'EVENT', level: DiagnosticLevels.includes(level) ? level : 'INFO', details: sanitize(details) };
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    if (event.level === 'FAIL') { this.metrics.errors += 1; this.metrics.lastError = event; }
    return clone(event);
  }

  recordRequest({ method, route, statusCode, latencyMs, error = null } = {}) {
    this.metrics.requests += 1;
    this.metrics.lastLatencyMs = Number.isFinite(latencyMs) ? Math.max(0, Math.round(latencyMs)) : null;
    if ((latencyMs ?? 0) >= 2000) this.metrics.slowRequests += 1;
    const level = error || Number(statusCode) >= 500 ? 'FAIL' : Number(statusCode) >= 400 || Number(latencyMs) >= 2000 ? 'WARN' : 'INFO';
    return this.record('HTTP_REQUEST', { method, route, statusCode, latencyMs: this.metrics.lastLatencyMs, error: error ? { code: error.code, message: error.message } : null }, level);
  }

  recordClientEvent(campaignId, input = {}) {
    const id = cleanId(input.eventId, randomUUID());
    if (this.clientEventIds.has(id)) { this.metrics.duplicateClientEvents += 1; return { duplicate: true }; }
    this.clientEventIds.add(id);
    if (this.clientEventIds.size > 1000) this.clientEventIds = new Set([...this.clientEventIds].slice(-500));
    return { duplicate: false, event: this.record('FOUNDRY_CLIENT', { campaignId: cleanId(campaignId), category: input.category, message: input.message, context: input.context }, input.level || 'INFO') };
  }

  async storageChecks() {
    const checks = [];
    for (const [id, filePath] of Object.entries(this.storagePaths)) {
      if (!filePath) continue;
      const parent = dirname(filePath);
      try {
        await mkdir(parent, { recursive: true });
        await access(parent, constants.R_OK | constants.W_OK);
        let file = null;
        try { const info = await stat(filePath); file = { exists: true, bytes: info.size, modifiedAt: info.mtime.toISOString() }; }
        catch { file = { exists: false, bytes: 0, modifiedAt: null }; }
        checks.push(check(`storage-${id}`, `Armazenamento: ${id}`, 'PASS', file.exists ? 'Arquivo acessível e diretório gravável.' : 'Diretório gravável; arquivo será criado quando necessário.', file, 'STORAGE'));
      } catch (error) {
        checks.push(check(`storage-${id}`, `Armazenamento: ${id}`, 'FAIL', 'O Engine não consegue ler ou gravar neste diretório.', { code: error.code }, 'STORAGE'));
      }
    }
    return checks;
  }

  async run(campaignId, { requester: requestUser, client = {} } = {}) {
    const user = requester(requestUser);
    const id = cleanId(campaignId);
    const runtime = sanitize(this.runtime?.getStatus?.() ?? {});
    const ai = sanitize(this.narrator?.getStatus?.() ?? { configured: false, providers: [] });
    const voice = sanitize(this.neuralVoiceService?.getStatus?.() ?? { enabled: false, configured: false, providers: [] });
    const checks = [];
    checks.push(check('engine-online', 'API do Mestre Orc', 'PASS', `Engine ${this.engineVersion} respondeu ao diagnóstico.`, { uptimeSeconds: Math.floor((this.clock() - this.startedAt) / 1000) }, 'ENGINE'));
    checks.push(check('campaign-match', 'Campanha reconhecida', runtime.campaignId && runtime.campaignId !== id ? 'FAIL' : runtime.campaignId ? 'PASS' : 'WARN', runtime.campaignId ? (runtime.campaignId === id ? 'A sessão pertence ao worldId atual.' : 'A sessão ativa pertence a outro worldId.') : 'Nenhuma sessão narrativa está ativa.', { requested: id, active: runtime.campaignId }, 'SESSION'));
    checks.push(check('scene-active', 'Scene reconhecida', runtime.sceneId || client.scene?.id ? 'PASS' : 'WARN', runtime.sceneId || client.scene?.id ? 'Scene ativa identificada.' : 'Nenhuma Scene ativa foi informada.', { engineSceneId: runtime.sceneId, clientSceneId: client.scene?.id }, 'SESSION'));
    checks.push(check('session-state', 'Sessão narrativa', runtime.state === 'ACTIVE' ? 'PASS' : 'WARN', runtime.state === 'ACTIVE' ? 'Sessão ativa e pronta para processar eventos.' : `Estado atual: ${runtime.state || 'IDLE'}.`, { state: runtime.state, round: runtime.round, combat: runtime.combat }, 'SESSION'));
    checks.push(check('ai-providers', 'Provedores de IA', ai.configured ? (ai.providers?.some?.((entry) => entry.state === 'OPEN') ? 'WARN' : 'PASS') : 'WARN', ai.configured ? 'Há pelo menos um provedor configurado.' : 'Nenhum provedor externo está configurado; recursos dependentes de IA usarão fallback quando disponível.', { primaryProvider: ai.primaryProvider, activeProvider: ai.activeProvider, order: ai.order, metrics: ai.metrics, providers: ai.providers }, 'PROVIDERS'));
    const audioEnabled = Boolean(this.audioNarrationService?.enabled);
    checks.push(check('audio-routing', 'Roteamento de áudio', audioEnabled ? 'PASS' : 'WARN', audioEnabled ? `Modo de áudio: ${this.audioNarrationService.mode || 'configurado'}.` : 'A saída de áudio do Engine está desativada.', { mode: this.audioNarrationService?.mode }, 'AUDIO'));
    checks.push(check('neural-voice', 'Voz neural', voice.configured ? 'PASS' : voice.enabled ? 'WARN' : 'INFO', voice.configured ? 'Há um provedor neural configurado.' : voice.enabled ? 'Voz neural habilitada, mas sem provedor completo.' : 'Voz neural desativada; o navegador pode usar TTS local.', voice, 'AUDIO'));
    const mic = client.microphone ?? {};
    checks.push(check('microphone-support', 'Microfone e reconhecimento de voz', !mic.supported ? 'WARN' : mic.permission === 'denied' ? 'FAIL' : mic.permission === 'granted' ? 'PASS' : 'WARN', !mic.supported ? 'O navegador não oferece a API de reconhecimento usada pelo módulo.' : mic.permission === 'denied' ? 'A permissão do microfone está bloqueada.' : mic.permission === 'granted' ? 'Microfone autorizado.' : 'A permissão ainda não foi concedida ou precisa ser testada.', mic, 'CLIENT'));
    checks.push(check('secure-context', 'Contexto seguro do navegador', client.browser?.secureContext === false ? 'WARN' : 'PASS', client.browser?.secureContext === false ? 'O navegador pode bloquear microfone fora de HTTPS ou localhost.' : 'Contexto compatível com recursos protegidos do navegador.', client.browser, 'CLIENT'));
    checks.push(check('foundry-version', 'Foundry VTT', String(client.foundry?.version || '').startsWith('13') ? 'PASS' : client.foundry?.version ? 'WARN' : 'INFO', client.foundry?.version ? `Foundry ${client.foundry.version} detectado.` : 'Versão do Foundry não informada.', client.foundry, 'CLIENT'));
    const latency = Number(client.apiLatencyMs);
    if (Number.isFinite(latency)) checks.push(check('api-latency', 'Latência entre Foundry e API', latency < 500 ? 'PASS' : latency < 2000 ? 'WARN' : 'FAIL', `${Math.round(latency)} ms na última medição.`, { latencyMs: Math.round(latency) }, 'NETWORK'));
    checks.push(...await this.storageChecks());
    const failCount = checks.filter((entry) => entry.level === 'FAIL').length;
    const warnCount = checks.filter((entry) => entry.level === 'WARN').length;
    const overall = failCount ? 'FAIL' : warnCount ? 'WARN' : 'PASS';
    const memory = process.memoryUsage();
    const report = {
      reportId: randomUUID(), campaignId: id, generatedAt: nowIso(), generatedBy: { id: user.id, name: user.name }, overall,
      summary: { pass: checks.filter((entry) => entry.level === 'PASS').length, warn: warnCount, fail: failCount, info: checks.filter((entry) => entry.level === 'INFO').length },
      checks,
      engine: { version: this.engineVersion, node: process.version, platform: process.platform, architecture: process.arch, uptimeSeconds: Math.floor((this.clock() - this.startedAt) / 1000), hostnameHash: createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12), memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal } },
      runtime,
      providers: { ai, voice },
      telemetry: { ...this.metrics, recentEvents: this.events.slice(-80).reverse() },
      client: sanitize(client)
    };
    this.record('DIAGNOSTIC_RUN', { campaignId: id, reportId: report.reportId, overall, summary: report.summary }, overall === 'FAIL' ? 'FAIL' : overall === 'WARN' ? 'WARN' : 'INFO');
    return report;
  }

  async snapshot(campaignId, options = {}) { return this.run(campaignId, options); }

  async exportReport(campaignId, options = {}) {
    const report = await this.run(campaignId, options);
    const content = JSON.stringify({ format: 'mestre-orc-diagnostic-report', formatVersion: 1, report }, null, 2);
    return { fileName: `mestre-orc-diagnostico-${cleanId(campaignId)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, mimeType: 'application/json', bytes: byteSize(content), sha256: createHash('sha256').update(content).digest('hex'), contentBase64: Buffer.from(content, 'utf8').toString('base64'), report };
  }
}

export function createDiagnosticService(options = {}) { return new DiagnosticService(options); }
export const diagnosticInternals = { sanitize, requester, check };
