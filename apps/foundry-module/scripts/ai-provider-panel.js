export const AI_PROVIDER_BUTTON_ID = 'mestre-orc-ai-providers';
export const AI_PROVIDER_PANEL_ID = 'mestre-orc-ai-provider-panel';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function stateLabel(state) {
  return ({ CLOSED: 'Disponível', OPEN: 'Circuito aberto', HALF_OPEN: 'Testando recuperação' })[state] ?? String(state || 'Desconhecido');
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR');
}

function providersHtml(snapshot) {
  const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : [];
  if (!providers.length) return '<p class="mestre-orc-ai-empty">Nenhum provedor configurado na API.</p>';
  return providers.map((provider, index) => {
    const active = provider.id === snapshot.activeProvider;
    return `
      <article class="mestre-orc-ai-provider" data-provider-state="${escapeHtml(provider.state)}">
        <header>
          <div>
            <strong>${escapeHtml(provider.id)}</strong>
            <span>${index === 0 ? 'Primário' : `Fallback ${index}`}${active ? ' · Ativo' : ''}</span>
          </div>
          <span class="mestre-orc-ai-state">${escapeHtml(stateLabel(provider.state))}</span>
        </header>
        <dl>
          <div><dt>Modelo</dt><dd>${escapeHtml(provider.model || 'não informado')}</dd></div>
          <div><dt>Requisições</dt><dd>${Number(provider.requests) || 0}</dd></div>
          <div><dt>Sucessos</dt><dd>${Number(provider.successes) || 0}</dd></div>
          <div><dt>Falhas</dt><dd>${Number(provider.failures) || 0}</dd></div>
          <div><dt>Latência recente</dt><dd>${provider.lastLatencyMs == null ? '—' : `${Number(provider.lastLatencyMs)} ms`}</dd></div>
          <div><dt>Falhas consecutivas</dt><dd>${Number(provider.consecutiveFailures) || 0}/${Number(provider.failureThreshold) || 0}</dd></div>
          <div><dt>Último sucesso</dt><dd>${escapeHtml(dateLabel(provider.lastSuccessAt))}</dd></div>
          <div><dt>Próxima tentativa</dt><dd>${escapeHtml(dateLabel(provider.nextRetryAt))}</dd></div>
        </dl>
        ${provider.lastErrorMessage ? `<p class="mestre-orc-ai-error"><strong>${escapeHtml(provider.lastErrorCode || 'Erro')}:</strong> ${escapeHtml(provider.lastErrorMessage)}</p>` : ''}
        <button type="button" data-ai-provider-reset="${escapeHtml(provider.id)}">
          <i class="fa-solid fa-rotate-right"></i> Rearmar circuito
        </button>
      </article>`;
  }).join('');
}

function panelHtml(snapshot) {
  const metrics = snapshot?.metrics ?? {};
  const configured = Boolean(snapshot?.configured);
  return `
    <div id="${AI_PROVIDER_PANEL_ID}" class="mestre-orc-ai-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-ai-title">
      <section class="mestre-orc-ai-panel">
        <header class="mestre-orc-ai-header">
          <div>
            <span>Resiliência narrativa</span>
            <h2 id="mestre-orc-ai-title">Saúde dos provedores de IA</h2>
            <p>Fallback automático e circuit breaker sem exposição de credenciais.</p>
          </div>
          <button type="button" data-ai-provider-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="mestre-orc-ai-summary">
          <article><strong>${configured ? escapeHtml(snapshot.primaryProvider || '—') : '—'}</strong><span>Primário</span></article>
          <article><strong>${escapeHtml(snapshot?.activeProvider || '—')}</strong><span>Último ativo</span></article>
          <article><strong>${Number(metrics.successes) || 0}</strong><span>Sucessos</span></article>
          <article><strong>${Number(metrics.fallbackSuccesses) || 0}</strong><span>Fallbacks</span></article>
          <article><strong>${Number(metrics.failures) || 0}</strong><span>Falhas totais</span></article>
        </div>
        <p class="mestre-orc-ai-order"><strong>Ordem:</strong> ${escapeHtml((snapshot?.order ?? []).join(' → ') || 'nenhum provedor configurado')}</p>
        <section class="mestre-orc-ai-list">${providersHtml(snapshot)}</section>
        <footer>
          <button type="button" data-ai-provider-action="refresh"><i class="fa-solid fa-arrows-rotate"></i> Atualizar métricas</button>
        </footer>
      </section>
    </div>`;
}

export function closeAiProviderPanel() {
  document.getElementById(AI_PROVIDER_PANEL_ID)?.remove();
}

function bindPanel(panel, request) {
  panel.addEventListener('click', async (event) => {
    const action = event.target instanceof Element ? event.target.closest('[data-ai-provider-action]') : null;
    if (action?.dataset.aiProviderAction === 'close') return closeAiProviderPanel();
    if (action?.dataset.aiProviderAction === 'refresh') return openAiProviderPanel({ request });

    const resetButton = event.target instanceof Element ? event.target.closest('[data-ai-provider-reset]') : null;
    if (!resetButton) return;
    const providerId = resetButton.dataset.aiProviderReset;
    if (!providerId) return;
    resetButton.disabled = true;
    try {
      await request(`/v1/ai/providers/${encodeURIComponent(providerId)}/reset`, { method: 'POST' });
      ui.notifications?.info?.(`Mestre Orc: circuito ${providerId} rearmado.`);
      await openAiProviderPanel({ request });
    } catch (error) {
      resetButton.disabled = false;
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });
}

export async function openAiProviderPanel({ request }) {
  if (!game.user?.isGM) return;
  try {
    const snapshot = await request('/v1/ai/providers');
    closeAiProviderPanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml(snapshot));
    const panel = document.getElementById(AI_PROVIDER_PANEL_ID);
    if (!panel) return;
    bindPanel(panel, request);
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeAiProviderPanel();
    });
  } catch (error) {
    console.error('[Mestre Orc] falha ao consultar provedores de IA', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectAiProviderButton({ root = document, request, findChatContainer }) {
  if (!game.user?.isGM || document.getElementById(AI_PROVIDER_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = AI_PROVIDER_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-ai-providers';
  button.innerHTML = '<i class="fa-solid fa-tower-broadcast"></i><span>Saúde da IA</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openAiProviderPanel({ request });
  };
  const adventureButton = document.getElementById('mestre-orc-adventure-library');
  if (adventureButton?.parentElement) adventureButton.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
