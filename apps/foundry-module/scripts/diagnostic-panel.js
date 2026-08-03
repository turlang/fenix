export const DIAGNOSTIC_BUTTON_ID = 'mestre-orc-diagnostics';
export const DIAGNOSTIC_PANEL_ID = 'mestre-orc-diagnostic-panel';

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (escape) return escape(String(value ?? ''));
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function campaignId() { return String(game.world?.id ?? 'default'); }
function requester() { return { id: String(game.user?.id ?? ''), name: String(game.user?.name ?? 'Mestre'), isGM: Boolean(game.user?.isGM) }; }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR'); }
function formatBytes(value) { const bytes = Number(value) || 0; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function levelIcon(level) { return level === 'PASS' ? 'fa-circle-check' : level === 'FAIL' ? 'fa-circle-xmark' : level === 'WARN' ? 'fa-triangle-exclamation' : 'fa-circle-info'; }

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
  return request(`/v1/diagnostics/${encodeURIComponent(campaignId())}/run`, { method: 'POST', body: JSON.stringify({ requester: requester(), client }) });
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
        const client = await collectDiagnosticClientContext({ request });
        const result = await request(`/v1/diagnostics/${encodeURIComponent(campaignId())}/export`, { method: 'POST', body: JSON.stringify({ requester: requester(), client }) });
        downloadBase64(result.contentBase64, result.fileName); ui.notifications?.info?.('Mestre Orc: relatório de diagnóstico exportado.');
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
