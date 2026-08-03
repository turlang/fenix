export const DIAGNOSTIC_BUTTON_ID = 'mestre-orc-diagnostics';
export const DIAGNOSTIC_PANEL_ID = 'mestre-orc-diagnostic-panel';

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (escape) return escape(String(value ?? ''));
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function campaignId() { return String(game.world?.id ?? 'default'); }
function requester() { return { id: String(game.user?.id ?? ''), name: String(game.user?.name ?? 'Mestre'), isGM: Boolean(game.user?.isGM) }; }
function moduleVersion() { return String(game.modules?.get?.('mestre-orc')?.version ?? 'desconhecida'); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR'); }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function levelIcon(level) { return level === 'PASS' ? 'fa-circle-check' : level === 'FAIL' ? 'fa-circle-xmark' : level === 'WARN' ? 'fa-triangle-exclamation' : 'fa-circle-info'; }
function isMissingRouteError(error) { return Number(error?.status) === 404 || /route\s+(?:get|post):.*not found/i.test(String(error?.message ?? '')); }

function compatibilityMessage(client = {}) {
  const engineVersion = String(client.clientHealthVersion ?? 'desconhecida');
  return `O módulo Foundry ${moduleVersion()} está conectado ao Engine ${engineVersion}, mas a rota de diagnóstico não existe nessa API. Atualize também o Engine, encerre o processo antigo e inicie novamente a API.`;
}

function addCompatibilityWarning(report, client, mode = 'LEGACY_GET') {
  const engineVersion = String(client?.clientHealthVersion ?? report?.engine?.version ?? 'desconhecida');
  const foundryVersion = moduleVersion();
  const mismatch = engineVersion !== 'desconhecida' && foundryVersion !== 'desconhecida' && engineVersion !== foundryVersion;
  const warning = {
    id: 'engine-module-compatibility',
    label: 'Compatibilidade Engine e módulo',
    level: mismatch || mode === 'LEGACY_GET' ? 'WARN' : 'PASS',
    message: mismatch
      ? `Módulo ${foundryVersion} e Engine ${engineVersion} estão em versões diferentes. Atualize os dois pacotes e reinicie a API.`
      : mode === 'LEGACY_GET'
        ? 'O diagnóstico foi aberto em modo de compatibilidade porque a rota completa não estava disponível.'
        : 'Engine e módulo usam a mesma versão.',
    group: 'COMPATIBILITY',
    details: { moduleVersion: foundryVersion, engineVersion, mode },
    checkedAt: new Date().toISOString()
  };
  const sourceChecks = Array.isArray(report?.checks) ? report.checks.filter((entry) => entry?.id !== warning.id) : [];
  const serverAlreadyChecked = sourceChecks.some((entry) => entry?.id === 'engine-module-version');
  const checks = mode === 'FULL_POST' && serverAlreadyChecked ? sourceChecks : [warning, ...sourceChecks];
  const summary = {
    pass: checks.filter((entry) => entry.level === 'PASS').length,
    warn: checks.filter((entry) => entry.level === 'WARN').length,
    fail: checks.filter((entry) => entry.level === 'FAIL').length,
    info: checks.filter((entry) => entry.level === 'INFO').length
  };
  return {
    ...report,
    checks,
    summary,
    overall: summary.fail ? 'FAIL' : summary.warn ? 'WARN' : 'PASS',
    compatibility: { moduleVersion: foundryVersion, engineVersion, mode, mismatch }
  };
}

async function microphonePermission() {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    return (await navigator.permissions.query({ name: 'microphone' })).state || 'unknown';
  } catch { return 'unknown'; }
}

export async function collectDiagnosticClientContext({ request } = {}) {
  const startedAt = performance.now();
  let health = null; let apiError = null;
  try { health = await request('/health'); } catch (error) { apiError = { code: error.code || 'API_UNREACHABLE', message: error.message }; }
  const apiLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  const selectedTokens = canvas?.tokens?.controlled ?? [];
  return {
    measuredAt: new Date().toISOString(), apiLatencyMs, apiError,
    browser: { userAgent: navigator.userAgent?.slice(0, 500), language: navigator.language, online: navigator.onLine, secureContext: globalThis.isSecureContext, speechSynthesis: Boolean(globalThis.speechSynthesis) },
    microphone: { supported: Boolean(Recognition && navigator.mediaDevices?.getUserMedia), recognitionApi: Boolean(Recognition), mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia), permission: await microphonePermission() },
    foundry: { version: String(game.version ?? game.release?.version ?? ''), systemId: String(game.system?.id ?? ''), systemVersion: String(game.system?.version ?? ''), moduleVersion: String(game.modules?.get?.('mestre-orc')?.version ?? ''), users: Number(game.users?.size ?? game.users?.contents?.length ?? 0) },
    world: { id: campaignId(), title: String(game.world?.title ?? ''), ready: Boolean(game.ready) },
    scene: { id: String(canvas?.scene?.id ?? game.scenes?.active?.id ?? ''), name: String(canvas?.scene?.name ?? game.scenes?.active?.name ?? ''), tokens: Number(canvas?.tokens?.placeables?.length ?? 0), selectedTokens: selectedTokens.length },
    combat: { active: Boolean(game.combat?.started), id: String(game.combat?.id ?? ''), round: Number(game.combat?.round ?? 0), turn: Number(game.combat?.turn ?? 0) },
    clientHealthVersion: health?.version ?? null
  };
}

function checkCard(item) {
  return `<article class="mestre-orc-diagnostic-check is-${escapeHtml(item.level.toLowerCase())}">
    <i class="fa-solid ${levelIcon(item.level)}"></i><div><header><span>${escapeHtml(item.group)}</span><strong>${escapeHtml(item.label)}</strong></header><p>${escapeHtml(item.message)}</p></div>
  </article>`;
}
function providerCard(provider, kind) {
  const state = provider.state || (provider.configured ? 'CONFIGURED' : 'NOT_CONFIGURED');
  return `<article><header><strong>${escapeHtml(provider.id || 'provedor')}</strong><span>${escapeHtml(state)}</span></header><p>${escapeHtml(provider.model || provider.defaultVoiceId || 'sem modelo/voz')}</p><small>${kind === 'AI' ? `${Number(provider.requests ?? provider.metrics?.requests) || 0} requisições` : provider.baseUrl || 'endpoint protegido'}</small></article>`;
}
function eventRows(events = []) {
  return events.length ? events.slice(0, 30).map((event) => `<tr><td>${formatDate(event.at)}</td><td>${escapeHtml(event.level)}</td><td>${escapeHtml(event.type)}</td><td>${escapeHtml(event.details?.message || event.details?.route || event.details?.category || 'evento registrado')}</td></tr>`).join('') : '<tr><td colspan="4">Nenhum evento recente.</td></tr>';
}
function panelHtml(report) {
  const summary = report.summary ?? {};
  const aiProviders = report.providers?.ai?.providers ?? [];
  const voiceProviders = report.providers?.voice?.providers ?? [];
  const diagnostics = report.runtime?.diagnostics ?? {};
  return `<div id="${DIAGNOSTIC_PANEL_ID}" class="mestre-orc-diagnostic-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-diagnostic-title">
    <section class="mestre-orc-diagnostic-panel">
      <header class="mestre-orc-diagnostic-header"><div><span>Marco 14 · observabilidade e suporte</span><h2 id="mestre-orc-diagnostic-title">Central de Diagnóstico</h2><p>Teste Engine, Foundry, sessão, microfone, IA, voz, rede e armazenamento sem expor credenciais.</p></div><button type="button" data-diagnostic-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button></header>
      <main>
        <section class="mestre-orc-diagnostic-overview is-${escapeHtml(String(report.overall || 'INFO').toLowerCase())}"><div><i class="fa-solid ${levelIcon(report.overall)}"></i><div><span>Estado geral</span><strong>${escapeHtml(report.overall)}</strong><small>${formatDate(report.generatedAt)}</small></div></div><div class="mestre-orc-diagnostic-score"><b>${Number(summary.pass) || 0}<span>Aprovados</span></b><b>${Number(summary.warn) || 0}<span>Atenções</span></b><b>${Number(summary.fail) || 0}<span>Falhas</span></b><b>${Number(summary.info) || 0}<span>Informativos</span></b></div></section>
        <section class="mestre-orc-diagnostic-actions"><button class="primary" type="button" data-diagnostic-action="run"><i class="fa-solid fa-stethoscope"></i> Executar diagnóstico completo</button><button type="button" data-diagnostic-action="export"><i class="fa-solid fa-file-export"></i> Exportar relatório sanitizado</button></section>
        <section class="mestre-orc-diagnostic-stats"><article><span>Latência</span><strong>${Number(report.client?.apiLatencyMs) || 0} ms</strong></article><article><span>Duplicados bloqueados</span><strong>${Number(diagnostics.duplicateEventsBlocked) || 0}</strong></article><article><span>Operações pendentes</span><strong>${Number(diagnostics.pendingIdempotencyOperations) || 0}</strong></article><article><span>Último erro</span><strong>${escapeHtml(diagnostics.lastError?.code || report.telemetry?.lastError?.details?.error?.code || 'nenhum')}</strong></article><article><span>Memória do Engine</span><strong>${formatBytes(report.engine?.memory?.rssBytes)}</strong></article></section>
        <section><h3>Verificações</h3><div class="mestre-orc-diagnostic-checks">${(report.checks ?? []).map(checkCard).join('')}</div></section>
        <section class="mestre-orc-diagnostic-provider-grid"><div><h3>IA</h3>${aiProviders.length ? aiProviders.map((entry) => providerCard(entry, 'AI')).join('') : '<p>Nenhum provedor configurado.</p>'}</div><div><h3>Voz neural</h3>${voiceProviders.length ? voiceProviders.map((entry) => providerCard(entry, 'VOICE')).join('') : '<p>Nenhum provedor configurado.</p>'}</div></section>
        <section><h3>Eventos recentes sanitizados</h3><div class="mestre-orc-diagnostic-log"><table><thead><tr><th>Horário</th><th>Nível</th><th>Evento</th><th>Resumo</th></tr></thead><tbody>${eventRows(report.telemetry?.recentEvents)}</tbody></table></div></section>
      </main>
      <footer><i class="fa-solid fa-user-shield"></i><span>Chaves, tokens, cookies, senhas e credenciais são removidos do relatório.</span></footer>
    </section>
  </div>`;
}
function downloadBase64(contentBase64, fileName) {
  const binary = atob(contentBase64); const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function runReport(request) {
  const client = await collectDiagnosticClientContext({ request });
  try {
    const report = await request(`/v1/diagnostics/${encodeURIComponent(campaignId())}/run`, { method: 'POST', body: JSON.stringify({ requester: requester(), client }) });
    return addCompatibilityWarning(report, client, 'FULL_POST');
  } catch (error) {
    if (!isMissingRouteError(error)) throw error;
    const user = requester();
    const query = new URLSearchParams({ requesterId: user.id, requesterName: user.name, isGM: String(user.isGM) });
    try {
      const report = await request(`/v1/diagnostics/${encodeURIComponent(campaignId())}?${query.toString()}`);
      return addCompatibilityWarning(report, client, 'LEGACY_GET');
    } catch (fallbackError) {
      if (!isMissingRouteError(fallbackError)) throw fallbackError;
      const compatibilityError = new Error(compatibilityMessage(client));
      compatibilityError.code = 'ENGINE_MODULE_VERSION_MISMATCH';
      compatibilityError.status = 409;
      throw compatibilityError;
    }
  }
}

function downloadJson(content, fileName) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportDiagnosticReport(request) {
  const client = await collectDiagnosticClientContext({ request });
  try {
    return await request(`/v1/diagnostics/${encodeURIComponent(campaignId())}/export`, { method: 'POST', body: JSON.stringify({ requester: requester(), client }) });
  } catch (error) {
    if (!isMissingRouteError(error)) throw error;
    const report = await runReport(request);
    const content = JSON.stringify({ format: 'mestre-orc-diagnostic-report-client-fallback', formatVersion: 1, generatedAt: new Date().toISOString(), report }, null, 2);
    return { localFallback: true, fileName: `mestre-orc-diagnostico-${campaignId()}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, content };
  }
}
function bindPanel({ request }) {
  const panel = document.getElementById(DIAGNOSTIC_PANEL_ID); if (!panel) return;
  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-diagnostic-action]'); if (!button) return;
    const action = button.dataset.diagnosticAction;
    if (action === 'close') return panel.remove();
    button.disabled = true;
    try {
      if (action === 'run') return await openDiagnosticPanel({ request });
      if (action === 'export') {
        const result = await exportDiagnosticReport(request);
        if (result.localFallback) downloadJson(result.content, result.fileName);
        else downloadBase64(result.contentBase64, result.fileName);
        ui.notifications?.info?.(result.localFallback ? 'Mestre Orc: relatório exportado em modo de compatibilidade.' : 'Mestre Orc: relatório de diagnóstico exportado.');
      }
    } catch (error) { ui.notifications?.error?.(`Mestre Orc: ${error.message}`); }
    finally { button.disabled = false; }
  });
}
export async function openDiagnosticPanel({ request }) {
  if (!game.user?.isGM) return ui.notifications?.warn?.('Mestre Orc: somente o mestre pode abrir a Central de Diagnóstico.');
  document.getElementById(DIAGNOSTIC_PANEL_ID)?.remove();
  try { const wrapper = document.createElement('div'); wrapper.innerHTML = panelHtml(await runReport(request)); document.body.append(wrapper.firstElementChild); bindPanel({ request }); }
  catch (error) { ui.notifications?.error?.(`Mestre Orc: diagnóstico indisponível — ${error.message}`); }
}
export function injectDiagnosticButton({ root = document, request, findChatContainer } = {}) {
  if (!game.user?.isGM || document.getElementById(DIAGNOSTIC_BUTTON_ID)) return false;
  const chat = findChatContainer?.(root) ?? document.querySelector('#chat'); if (!chat) return false;
  const button = document.createElement('button'); button.id = DIAGNOSTIC_BUTTON_ID; button.type = 'button'; button.dataset.mestreOrcAction = 'open-diagnostics'; button.innerHTML = '<i class="fa-solid fa-stethoscope"></i><span>Diagnóstico</span>';
  button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); void openDiagnosticPanel({ request }); };
  const anchor = document.getElementById('mestre-orc-backups'); if (anchor?.parentElement) anchor.insertAdjacentElement('afterend', button); else chat.prepend(button); return true;
}

export function installDiagnosticClientTelemetry({ request } = {}) {
  if (!game.user?.isGM || globalThis.__mestreOrcDiagnosticTelemetryInstalled) return false;
  globalThis.__mestreOrcDiagnosticTelemetryInstalled = true;
  const send = (category, message, context = {}) => {
    const text = String(message ?? '').replace(/(?:sk-|gsk_)[A-Za-z0-9_-]{12,}/g, '[credencial removida]').slice(0, 1800);
    if (!text) return;
    void request(`/v1/diagnostics/${encodeURIComponent(campaignId())}/events`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), eventId: crypto.randomUUID(), category, message: text, level: 'FAIL', context })
    }).catch(() => undefined);
  };
  globalThis.addEventListener?.('error', (event) => send('CLIENT_ERROR', event.message || event.error?.message, { file: event.filename?.split('/').pop(), line: event.lineno, column: event.colno }));
  globalThis.addEventListener?.('unhandledrejection', (event) => send('UNHANDLED_REJECTION', event.reason?.message || event.reason, { code: event.reason?.code }));
  globalThis.addEventListener?.('offline', () => send('NETWORK_OFFLINE', 'O navegador ficou offline.', {}));
  return true;
}
