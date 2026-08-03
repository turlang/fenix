export const CENTRAL_BUTTON_ID = 'mestre-orc-central';
export const CENTRAL_PANEL_ID = 'mestre-orc-central-panel';
export const CENTRAL_DOCK_ID = 'mestre-orc-command-dock';

const GROUPS = [
  { id: 'overview', label: 'Visão geral', icon: 'fa-solid fa-grid-2', gmOnly: false },
  { id: 'session', label: 'Sessão', icon: 'fa-solid fa-hat-wizard', gmOnly: true },
  { id: 'narration', label: 'Narração', icon: 'fa-solid fa-microphone-lines', gmOnly: false },
  { id: 'combat', label: 'Combate', icon: 'fa-solid fa-shield-halved', gmOnly: true },
  { id: 'campaign', label: 'Campanha', icon: 'fa-solid fa-book-atlas', gmOnly: true },
  { id: 'creation', label: 'Criação', icon: 'fa-solid fa-wand-magic-sparkles', gmOnly: true },
  { id: 'assistants', label: 'Assistentes', icon: 'fa-solid fa-graduation-cap', gmOnly: false },
  { id: 'system', label: 'Sistema', icon: 'fa-solid fa-sliders', gmOnly: true }
];

const TOOLS = [
  {
    id: 'start-session', group: 'session', title: 'Iniciar sessão', icon: 'fa-solid fa-play', action: 'startSession', gmOnly: true,
    description: 'Abre a sessão narrativa, publica a introdução e ativa o monitoramento de salas.'
  },
  {
    id: 'resolve-round', group: 'session', title: 'Resolver rodada', icon: 'fa-solid fa-dice-d20', action: 'resolveRound', gmOnly: true,
    description: 'Consolida as declarações fora de combate em uma única resolução narrativa.', statusKey: 'round'
  },
  {
    id: 'voice-input', group: 'narration', title: 'Falar ação', icon: 'fa-solid fa-microphone', action: 'voiceInput', gmOnly: false,
    description: 'Captura a ação do personagem por voz e envia a transcrição para a fila ativa.', statusKey: 'voice'
  },
  {
    id: 'toggle-audio', group: 'narration', title: 'Áudio local', icon: 'fa-solid fa-volume-high', action: 'toggleAudio', gmOnly: false,
    description: 'Liga ou desliga a reprodução das narrações neste navegador.', statusKey: 'audio', keepOpen: true
  },
  {
    id: 'combat-turn', group: 'combat', title: 'Narrar turno', icon: 'fa-solid fa-hand-fist', action: 'resolveCombatTurn', gmOnly: true,
    description: 'Resolve e narra os eventos confirmados do combatente ativo.', statusKey: 'combatTurn'
  },
  {
    id: 'combat-round', group: 'combat', title: 'Resumo da rodada', icon: 'fa-solid fa-shield-halved', action: 'summarizeCombatRound', gmOnly: true,
    description: 'Produz um resumo cinematográfico dos turnos concluídos.', statusKey: 'combatRound'
  },
  {
    id: 'memory', group: 'campaign', title: 'Memória', icon: 'fa-solid fa-brain', action: 'openMemory', gmOnly: true,
    description: 'Administra fatos, NPCs, relações, missões e itens persistentes.'
  },
  {
    id: 'library', group: 'campaign', title: 'Biblioteca', icon: 'fa-solid fa-book-open-reader', action: 'openLibrary', gmOnly: true,
    description: 'Importa e consulta aventuras com proteção contra spoilers.'
  },
  {
    id: 'generators', group: 'creation', title: 'Forja de conteúdo', icon: 'fa-solid fa-wand-magic-sparkles', action: 'openGenerators', gmOnly: true,
    description: 'Gera e arquiva aventuras, NPCs e dungeons sem repetição.'
  },
  {
    id: 'maps', group: 'creation', title: 'Mapas e Scenes', icon: 'fa-solid fa-map', action: 'openMaps', gmOnly: true,
    description: 'Planeja mapas vetoriais e cria Scenes editáveis no Foundry.'
  },
  {
    id: 'tutors', group: 'assistants', title: 'Tutores', icon: 'fa-solid fa-graduation-cap', action: 'openTutors', gmOnly: false,
    description: 'Abre o Tutor de Ficha e, para o mestre, o Tutor de Mestre.'
  },
  {
    id: 'automations', group: 'assistants', title: 'Automações', icon: 'fa-solid fa-list-check', action: 'openAutomations', gmOnly: true,
    description: 'Revisa propostas, aprova execuções e desfaz operações seguras.'
  },
  {
    id: 'ai-providers', group: 'system', title: 'Provedores de IA', icon: 'fa-solid fa-tower-broadcast', action: 'openAiProviders', gmOnly: true,
    description: 'Acompanha fallback, circuit breaker, falhas e latência dos provedores.'
  },
  {
    id: 'voice-profiles', group: 'system', title: 'Vozes neurais', icon: 'fa-solid fa-wave-square', action: 'openVoiceProfiles', gmOnly: true,
    description: 'Configura perfis do narrador e dos NPCs sem expor credenciais.'
  },
  {
    id: 'backups', group: 'system', title: 'Backup', icon: 'fa-solid fa-box-archive', action: 'openBackups', gmOnly: true,
    description: 'Exporta, inspeciona e restaura dados persistentes com segurança.'
  },
  {
    id: 'diagnostics', group: 'system', title: 'Diagnóstico', icon: 'fa-solid fa-stethoscope', action: 'openDiagnostics', gmOnly: true,
    description: 'Executa verificações de rede, sessão, microfone, IA, voz e armazenamento.'
  }
];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? game.world?.title ?? 'default-world');
}

function closeCentralPanel() {
  const overlay = document.getElementById(CENTRAL_PANEL_ID)?.closest('.mestre-orc-central-overlay');
  if (!overlay) return;
  if (overlay._mestreOrcKeyHandler) document.removeEventListener('keydown', overlay._mestreOrcKeyHandler, true);
  overlay.remove();
}

function formatLatency(value) {
  const latency = Number(value);
  return Number.isFinite(latency) && latency >= 0 ? `${Math.round(latency)} ms` : '—';
}

function statusTone(value) {
  return value === true ? 'is-ok' : value === false ? 'is-danger' : 'is-neutral';
}

function availableGroups(isGM) {
  return GROUPS.filter((group) => isGM || !group.gmOnly);
}

function availableTools(isGM) {
  return TOOLS.filter((tool) => isGM || !tool.gmOnly);
}

function toolDisabledReason(tool, state) {
  const sessionActive = Boolean(state?.server?.sessionActive);
  const combatActive = Boolean(state?.server?.combatActive);
  const actionCount = Number(state?.server?.roundActionCount ?? 0);
  const turnCanResolve = Boolean(state?.server?.combatTurnCanResolve);
  const roundCanSummarize = Boolean(state?.server?.combatRoundCanSummarize);

  if (tool.id === 'resolve-round' && (!sessionActive || combatActive || actionCount < 1)) return 'Aguardando declarações fora de combate.';
  if (tool.id === 'combat-turn' && (!sessionActive || !combatActive || !turnCanResolve)) return 'Aguardando eventos no turno ativo.';
  if (tool.id === 'combat-round' && (!sessionActive || !combatActive || !roundCanSummarize)) return 'Aguardando turnos resolvidos.';
  if (tool.id === 'voice-input' && !state?.client?.voiceSupported) return 'Reconhecimento de voz indisponível neste navegador.';
  if (tool.id === 'voice-input' && !state?.client?.voiceSessionActive) return 'A sessão precisa estar ativa.';
  return null;
}

function toolBadge(tool, state) {
  if (tool.statusKey === 'round') return `${Number(state?.server?.roundActionCount ?? 0)} ações`;
  if (tool.statusKey === 'combatTurn') return `${Number(state?.server?.combatTurnActionCount ?? 0)} eventos`;
  if (tool.statusKey === 'combatRound') return `${Number(state?.server?.combatResolvedTurns ?? 0)} turnos`;
  if (tool.statusKey === 'audio') return state?.client?.audioEnabled ? 'Ligado' : 'Desligado';
  if (tool.statusKey === 'voice') return state?.client?.voiceListening ? 'Ouvindo' : 'Pronto';
  return null;
}

function renderNavigation(groups, activeGroup) {
  return groups.map((group) => `
    <button type="button" class="mestre-orc-central-nav-item ${group.id === activeGroup ? 'is-active' : ''}" data-central-group="${group.id}">
      <i class="${group.icon}" aria-hidden="true"></i><span>${escapeHtml(group.label)}</span>
    </button>`).join('');
}

function renderOverview(state, tools) {
  const server = state?.server ?? {};
  const client = state?.client ?? {};
  const quickIds = client.isGM
    ? ['start-session', 'resolve-round', 'combat-turn', 'diagnostics']
    : ['voice-input', 'toggle-audio', 'tutors'];
  const quick = tools.filter((tool) => quickIds.includes(tool.id));
  return `
    <section class="mestre-orc-central-hero">
      <div>
        <span class="mestre-orc-central-eyebrow">Painel operacional</span>
        <h2>${client.isGM ? 'Controle sua campanha em um só lugar' : 'Ferramentas do seu personagem'}</h2>
        <p>${client.isGM
          ? 'Sessão, narração, combate, campanha, criação e infraestrutura organizados sem poluir o chat ou a barra da Scene.'
          : 'Use voz, áudio e o Tutor de Ficha sem precisar procurar controles espalhados.'}</p>
      </div>
      <div class="mestre-orc-central-orb ${statusTone(server.apiOnline)}" aria-label="Estado geral">
        <i class="fa-solid ${server.apiOnline ? 'fa-signal' : 'fa-triangle-exclamation'}"></i>
        <strong>${server.apiOnline ? 'Engine conectado' : 'Engine indisponível'}</strong>
        <span>${formatLatency(server.apiLatencyMs)}</span>
      </div>
    </section>
    <section class="mestre-orc-central-status-grid" aria-label="Resumo do sistema">
      <article class="${statusTone(server.sessionActive)}"><i class="fa-solid fa-circle-play"></i><div><span>Sessão</span><strong>${server.sessionActive ? 'Ativa' : 'Parada'}</strong></div></article>
      <article class="${statusTone(Boolean(client.sceneId))}"><i class="fa-solid fa-image"></i><div><span>Scene</span><strong>${escapeHtml(client.sceneName || 'Nenhuma')}</strong></div></article>
      <article class="${statusTone(server.combatActive)}"><i class="fa-solid fa-shield-halved"></i><div><span>Combate</span><strong>${server.combatActive ? `Rodada ${Number(server.combatRound || 0)}` : 'Inativo'}</strong></div></article>
      <article class="${statusTone(client.voiceSupported)}"><i class="fa-solid fa-microphone-lines"></i><div><span>Voz</span><strong>${client.voiceSupported ? 'Disponível' : 'Indisponível'}</strong></div></article>
    </section>
    <section class="mestre-orc-central-section">
      <header><div><span>Ações rápidas</span><h3>O que precisa de atenção agora</h3></div></header>
      <div class="mestre-orc-central-tool-grid is-quick">${quick.map((tool) => renderTool(tool, state)).join('')}</div>
    </section>
    <section class="mestre-orc-central-section">
      <header><div><span>Estado atual</span><h3>Campanha e usuário</h3></div></header>
      <dl class="mestre-orc-central-facts">
        <div><dt>Campanha</dt><dd>${escapeHtml(client.worldName || campaignId())}</dd></div>
        <div><dt>Usuário</dt><dd>${escapeHtml(client.userName || 'Usuário')}</dd></div>
        <div><dt>Perfil</dt><dd>${client.isGM ? 'Mestre' : 'Jogador'}</dd></div>
        <div><dt>Versão</dt><dd>${escapeHtml(client.moduleVersion || '—')}</dd></div>
      </dl>
    </section>`;
}

function renderTool(tool, state) {
  const disabledReason = toolDisabledReason(tool, state);
  const badge = toolBadge(tool, state);
  return `
    <button type="button" class="mestre-orc-central-tool" data-central-action="${tool.action}" ${disabledReason ? 'disabled' : ''} title="${escapeHtml(disabledReason || tool.description)}">
      <span class="mestre-orc-central-tool-icon"><i class="${tool.icon}" aria-hidden="true"></i></span>
      <span class="mestre-orc-central-tool-copy"><strong>${escapeHtml(tool.title)}</strong><small>${escapeHtml(disabledReason || tool.description)}</small></span>
      ${badge ? `<span class="mestre-orc-central-badge">${escapeHtml(badge)}</span>` : '<i class="fa-solid fa-chevron-right mestre-orc-central-chevron" aria-hidden="true"></i>'}
    </button>`;
}

function renderGroup(groupId, state, tools) {
  if (groupId === 'overview') return renderOverview(state, tools);
  const group = GROUPS.find((entry) => entry.id === groupId) ?? GROUPS[0];
  const entries = tools.filter((tool) => tool.group === group.id);
  return `
    <section class="mestre-orc-central-group-heading">
      <span>${escapeHtml(group.label)}</span>
      <h2>${escapeHtml(group.label)}</h2>
      <p>${group.id === 'session' ? 'Controle o ciclo da sessão e das rodadas narrativas.' :
        group.id === 'narration' ? 'Ajuste como você fala, ouve e acompanha as narrações.' :
        group.id === 'combat' ? 'Conduza turnos e resumos sem alterar resultados mecânicos.' :
        group.id === 'campaign' ? 'Organize o conhecimento persistente e o material importado.' :
        group.id === 'creation' ? 'Crie conteúdo revisável antes de ativá-lo na campanha.' :
        group.id === 'assistants' ? 'Receba orientação e execute propostas somente após aprovação.' :
        'Monitore provedores, vozes, backups e saúde técnica.'}</p>
    </section>
    <section class="mestre-orc-central-tool-grid">${entries.map((tool) => renderTool(tool, state)).join('')}</section>`;
}

async function loadState({ request, getClientState }) {
  const client = await Promise.resolve(getClientState?.()).catch(() => ({}));
  const startedAt = performance.now?.() ?? Date.now();
  const status = await request?.('/v1/session/status').catch(() => null);
  const elapsed = (performance.now?.() ?? Date.now()) - startedAt;
  return {
    client: client ?? {},
    server: {
      apiOnline: Boolean(status),
      apiLatencyMs: status ? elapsed : null,
      sessionActive: status?.state === 'COLLECTING_ACTIONS' && Boolean(status?.sessionId),
      combatActive: Boolean(status?.combat?.active),
      combatRound: status?.combat?.round ?? 0,
      combatTurnCanResolve: Boolean(status?.combat?.currentTurn?.canResolve),
      combatRoundCanSummarize: Boolean(status?.combat?.currentRound?.canSummarize),
      combatTurnActionCount: Number(status?.combat?.currentTurn?.actionCount ?? 0),
      combatResolvedTurns: Number(status?.combat?.currentRound?.resolvedTurnCount ?? 0),
      roundActionCount: Number(status?.round?.actionCount ?? 0),
      raw: status
    }
  };
}

export async function openCentralPanel({ request, actions = {}, getClientState } = {}) {
  closeCentralPanel();
  let activeGroup = 'overview';
  let state = await loadState({ request, getClientState });
  const isGM = Boolean(state.client?.isGM);
  const groups = availableGroups(isGM);
  const tools = availableTools(isGM);

  const overlay = document.createElement('div');
  overlay.className = 'mestre-orc-central-overlay';
  overlay.innerHTML = `
    <section id="${CENTRAL_PANEL_ID}" class="mestre-orc-central-panel" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-central-title">
      <aside class="mestre-orc-central-sidebar">
        <header>
          <span class="mestre-orc-central-logo"><i class="fa-solid fa-hat-wizard"></i></span>
          <div><strong>Mestre Orc</strong><small>Central de campanha</small></div>
        </header>
        <nav aria-label="Áreas da Central">${renderNavigation(groups, activeGroup)}</nav>
        <footer>
          <span class="mestre-orc-central-connection ${statusTone(state.server.apiOnline)}"><i class="fa-solid fa-circle"></i>${state.server.apiOnline ? 'Engine conectado' : 'Engine offline'}</span>
          <small>${escapeHtml(state.client?.moduleVersion || '')}</small>
        </footer>
      </aside>
      <div class="mestre-orc-central-workspace">
        <header class="mestre-orc-central-topbar">
          <div><span>${escapeHtml(state.client?.worldName || campaignId())}</span><strong id="mestre-orc-central-title">Central Mestre Orc</strong></div>
          <div>
            <button type="button" data-central-command="refresh" title="Atualizar estados"><i class="fa-solid fa-rotate"></i></button>
            <button type="button" data-central-command="close" title="Fechar Central"><i class="fa-solid fa-xmark"></i></button>
          </div>
        </header>
        <main class="mestre-orc-central-content">${renderGroup(activeGroup, state, tools)}</main>
      </div>
    </section>`;

  const content = () => overlay.querySelector('.mestre-orc-central-content');
  const render = () => {
    const main = content();
    if (main) main.innerHTML = renderGroup(activeGroup, state, tools);
    overlay.querySelectorAll('[data-central-group]').forEach((button) => button.classList.toggle('is-active', button.dataset.centralGroup === activeGroup));
    const connection = overlay.querySelector('.mestre-orc-central-connection');
    if (connection) {
      connection.className = `mestre-orc-central-connection ${statusTone(state.server.apiOnline)}`;
      connection.innerHTML = `<i class="fa-solid fa-circle"></i>${state.server.apiOnline ? 'Engine conectado' : 'Engine offline'}`;
    }
  };

  const refresh = async () => {
    const refreshButton = overlay.querySelector('[data-central-command="refresh"]');
    refreshButton?.classList.add('is-loading');
    state = await loadState({ request, getClientState });
    render();
    refreshButton?.classList.remove('is-loading');
  };

  overlay.addEventListener('click', async (event) => {
    if (event.target === overlay) return closeCentralPanel();
    const command = event.target.closest?.('[data-central-command]')?.dataset.centralCommand;
    if (command === 'close') return closeCentralPanel();
    if (command === 'refresh') return refresh();

    const groupButton = event.target.closest?.('[data-central-group]');
    if (groupButton) {
      activeGroup = groupButton.dataset.centralGroup || 'overview';
      render();
      return;
    }

    const actionButton = event.target.closest?.('[data-central-action]');
    if (!actionButton || actionButton.disabled) return;
    const actionName = actionButton.dataset.centralAction;
    const tool = tools.find((entry) => entry.action === actionName);
    const handler = actions?.[actionName];
    if (typeof handler !== 'function') return;

    actionButton.disabled = true;
    actionButton.classList.add('is-loading');
    try {
      if (!tool?.keepOpen) closeCentralPanel();
      await handler();
      if (tool?.keepOpen && document.getElementById(CENTRAL_PANEL_ID)) await refresh();
    } catch (error) {
      console.error('[Mestre Orc][Central] ação falhou', { actionName, error });
      ui.notifications?.error?.(`Mestre Orc: ${error?.message ?? 'não foi possível concluir a ação.'}`);
      actionButton.disabled = false;
      actionButton.classList.remove('is-loading');
    }
  });

  const keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeCentralPanel();
      document.removeEventListener('keydown', keyHandler, true);
    }
  };
  overlay._mestreOrcKeyHandler = keyHandler;
  document.addEventListener('keydown', keyHandler, true);
  document.body.append(overlay);
  overlay.querySelector('[data-central-command="close"]')?.focus?.();
}

export function injectCentralButton({ root = document, findChatContainer, open } = {}) {
  if (document.getElementById(CENTRAL_BUTTON_ID)) return true;
  const chat = findChatContainer?.(root) ?? document.querySelector('#chat, [data-tab="chat"], .chat-sidebar');
  if (!chat) return false;

  let dock = document.getElementById(CENTRAL_DOCK_ID);
  if (!dock) {
    dock = document.createElement('div');
    dock.id = CENTRAL_DOCK_ID;
    dock.className = 'mestre-orc-command-dock';
    const chatForm = chat.querySelector('#chat-form, .chat-form, form.chat-form');
    if (chatForm?.parentElement) chatForm.parentElement.insertBefore(dock, chatForm);
    else chat.prepend(dock);
  }

  const button = document.createElement('button');
  button.id = CENTRAL_BUTTON_ID;
  button.type = 'button';
  button.className = 'mestre-orc-command-dock-main';
  button.dataset.mestreOrcAction = 'open-central';
  button.innerHTML = '<i class="fa-solid fa-hat-wizard" aria-hidden="true"></i><span>Central Mestre Orc</span><i class="fa-solid fa-grid-2" aria-hidden="true"></i>';
  button.title = 'Abrir a Central Mestre Orc';
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void open?.();
  });
  dock.prepend(button);
  return true;
}

export const centralPanelInternals = {
  GROUPS,
  TOOLS,
  toolDisabledReason,
  toolBadge,
  renderTool,
  availableGroups,
  availableTools
};
