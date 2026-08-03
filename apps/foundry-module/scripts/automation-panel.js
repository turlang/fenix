export const AUTOMATION_BUTTON_ID = 'mestre-orc-automations';
export const AUTOMATION_PANEL_ID = 'mestre-orc-automation-panel';

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (escape) return escape(String(value ?? ''));
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? 'default');
}

function requester() {
  return { id: String(game.user?.id ?? ''), name: String(game.user?.name ?? 'Mestre'), isGM: Boolean(game.user?.isGM) };
}

function collectionValues(collection) {
  return collection?.contents ?? (Array.isArray(collection) ? collection : []);
}

function resourceContext(actor) {
  if (!actor) return null;
  const system = actor.system ?? {};
  const resources = {};
  for (const [key, value] of Object.entries(system.resources ?? {}).slice(0, 20)) {
    resources[key] = { value: value?.value ?? null, max: value?.max ?? null, label: value?.label ?? key };
  }
  return {
    id: actor.id,
    name: actor.name,
    type: actor.type,
    allowedPaths: {
      hp: { path: 'system.attributes.hp.value', value: system.attributes?.hp?.value ?? null, max: system.attributes?.hp?.max ?? null, temp: system.attributes?.hp?.temp ?? null },
      exhaustion: { path: 'system.attributes.exhaustion.value', value: system.attributes?.exhaustion?.value ?? null },
      resources,
      currency: system.currency ?? {}
    }
  };
}

function automationContext() {
  const scene = game.scenes?.active ?? canvas?.scene ?? null;
  const combat = game.combat ?? null;
  const selectedActor = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  return {
    campaign: { id: campaignId(), title: game.world?.title ?? '', systemId: game.system?.id ?? 'generic', systemVersion: game.system?.version ?? '' },
    scene: scene ? {
      id: scene.id, name: scene.name, width: scene.width ?? null, height: scene.height ?? null,
      center: { x: Number(canvas?.dimensions?.sceneX ?? 0) + Number(canvas?.dimensions?.sceneWidth ?? scene.width ?? 0) / 2, y: Number(canvas?.dimensions?.sceneY ?? 0) + Number(canvas?.dimensions?.sceneHeight ?? scene.height ?? 0) / 2 }
    } : null,
    combat: combat ? { id: combat.id, started: Boolean(combat.started), round: Number(combat.round) || 0, turn: Number(combat.turn) || 0, combatantId: combat.combatant?.id ?? null, combatantName: combat.combatant?.name ?? null } : null,
    selectedActor: resourceContext(selectedActor),
    journals: collectionValues(game.journal).slice(0, 60).map((entry) => ({
      id: entry.id, name: entry.name,
      pages: collectionValues(entry.pages).slice(0, 40).map((page) => ({ id: page.id, name: page.name, type: page.type }))
    })),
    users: collectionValues(game.users).filter((user) => user.active).slice(0, 50).map((user) => ({ id: user.id, name: user.name, isGM: Boolean(user.isGM) }))
  };
}

function statusLabel(status) {
  return ({
    PENDING: 'Pendente', APPROVED: 'Aprovada', EXECUTING: 'Executando', EXECUTED: 'Executada',
    FAILED: 'Falhou', REJECTED: 'Rejeitada', ROLLING_BACK: 'Revertendo', ROLLED_BACK: 'Revertida'
  })[status] ?? status;
}

function actionLabel(type) {
  return ({
    CHAT_MESSAGE: 'Mensagem no chat', CREATE_JOURNAL: 'Criar Journal', APPEND_JOURNAL_PAGE: 'Adicionar página',
    CREATE_SCENE_NOTE: 'Criar Note', UPDATE_ACTOR_RESOURCE: 'Atualizar recurso'
  })[type] ?? type;
}

function riskLabel(risk) {
  return ({ LOW: 'Risco baixo', MEDIUM: 'Risco médio', HIGH: 'Risco alto' })[risk] ?? risk;
}

function payloadPreview(payload) {
  return escapeHtml(JSON.stringify(payload ?? {}, null, 2));
}

function actionButtons(proposal) {
  if (proposal.status === 'PENDING') return `
    <button type="button" data-automation-action="approve" data-proposal-id="${escapeHtml(proposal.id)}"><i class="fa-solid fa-check"></i> Aprovar</button>
    <button type="button" data-automation-action="reject" data-proposal-id="${escapeHtml(proposal.id)}" class="danger"><i class="fa-solid fa-xmark"></i> Rejeitar</button>`;
  if (proposal.status === 'APPROVED') return `
    <button type="button" data-automation-action="execute" data-proposal-id="${escapeHtml(proposal.id)}" class="primary"><i class="fa-solid fa-play"></i> Executar agora</button>
    <button type="button" data-automation-action="reject" data-proposal-id="${escapeHtml(proposal.id)}" class="danger"><i class="fa-solid fa-xmark"></i> Rejeitar</button>`;
  if (proposal.status === 'FAILED') return `
    <button type="button" data-automation-action="approve" data-proposal-id="${escapeHtml(proposal.id)}"><i class="fa-solid fa-rotate-right"></i> Aprovar nova tentativa</button>
    <button type="button" data-automation-action="reject" data-proposal-id="${escapeHtml(proposal.id)}" class="danger"><i class="fa-solid fa-xmark"></i> Encerrar</button>`;
  if (proposal.status === 'EXECUTED' && proposal.reversible && proposal.execution?.receipt) return `
    <button type="button" data-automation-action="rollback" data-proposal-id="${escapeHtml(proposal.id)}" class="warning"><i class="fa-solid fa-rotate-left"></i> Desfazer</button>`;
  return '';
}

function proposalCard(proposal) {
  const warnings = (proposal.warnings ?? []).map((entry) => `<li>${escapeHtml(entry)}</li>`).join('');
  const executionError = proposal.execution?.error ? `<p class="mestre-orc-automation-error"><strong>Falha:</strong> ${escapeHtml(proposal.execution.error)}</p>` : '';
  const rollbackError = proposal.rollback?.error ? `<p class="mestre-orc-automation-error"><strong>Falha ao desfazer:</strong> ${escapeHtml(proposal.rollback.error)}</p>` : '';
  return `
    <article class="mestre-orc-automation-card" data-status="${escapeHtml(proposal.status)}" data-risk="${escapeHtml(proposal.risk)}">
      <header>
        <div><span>${escapeHtml(actionLabel(proposal.actionType))}</span><h3>${escapeHtml(proposal.title)}</h3></div>
        <div class="mestre-orc-automation-badges"><b>${escapeHtml(statusLabel(proposal.status))}</b><b>${escapeHtml(riskLabel(proposal.risk))}</b></div>
      </header>
      <p>${escapeHtml(proposal.rationale)}</p>
      ${warnings ? `<ul class="mestre-orc-automation-warnings">${warnings}</ul>` : ''}
      ${executionError}${rollbackError}
      <details><summary>Prévia dos dados afetados</summary><pre>${payloadPreview(proposal.payload)}</pre></details>
      <footer>
        <small>Origem: ${escapeHtml(proposal.source === 'AI' ? 'IA assistiva' : 'manual')} · revisão ${Number(proposal.revision) || 1} · reversível: ${proposal.reversible ? 'sim' : 'não'}</small>
        <div>${actionButtons(proposal)}</div>
      </footer>
    </article>`;
}

function panelHtml(data) {
  const proposals = data?.proposals ?? [];
  return `
    <div id="${AUTOMATION_PANEL_ID}" class="mestre-orc-automation-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-automation-title">
      <section class="mestre-orc-automation-panel">
        <header class="mestre-orc-automation-header">
          <div><span>Marco 11 · aprovação humana obrigatória</span><h2 id="mestre-orc-automation-title">Automações assistidas</h2><p>A IA propõe. O mestre revisa, aprova e executa. Nenhuma ação é aplicada silenciosamente.</p></div>
          <button type="button" data-automation-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <main>
          <form class="mestre-orc-automation-suggest-form">
            <label>O que você quer preparar ou alterar?
              <textarea name="goal" rows="4" maxlength="3000" required placeholder="Ex.: crie uma anotação privada com as consequências possíveis da cena; prepare uma mensagem sem spoilers para os jogadores; proponha a atualização exata de um recurso do token selecionado."></textarea>
            </label>
            <div class="mestre-orc-automation-presets">
              <button type="button" data-automation-preset="Crie um Journal privado com um plano de condução para a cena atual, sem revelar segredos no chat.">Plano da cena</button>
              <button type="button" data-automation-preset="Prepare uma mensagem curta e sem spoilers para publicar aos jogadores sobre a situação atual.">Mensagem aos jogadores</button>
              <button type="button" data-automation-preset="Analise o contexto e proponha somente ações pequenas, reversíveis e realmente necessárias.">Revisar contexto</button>
            </div>
            <button type="submit" class="primary"><i class="fa-solid fa-wand-magic-sparkles"></i> Gerar propostas para revisão</button>
          </form>
          <section class="mestre-orc-automation-toolbar">
            <div><strong>${Number(data?.total) || 0}</strong> proposta(s) arquivada(s)</div>
            <label>Filtrar <select data-automation-filter><option value="">Todas</option>${['PENDING','APPROVED','EXECUTING','EXECUTED','FAILED','REJECTED','ROLLING_BACK','ROLLED_BACK'].map((status) => `<option value="${status}">${statusLabel(status)}</option>`).join('')}</select></label>
            <button type="button" data-automation-action="refresh"><i class="fa-solid fa-rotate"></i> Atualizar</button>
          </section>
          <section class="mestre-orc-automation-queue" aria-live="polite">
            ${proposals.length ? proposals.map(proposalCard).join('') : '<div class="mestre-orc-automation-empty"><i class="fa-solid fa-list-check"></i><p>Nenhuma proposta. Descreva um objetivo para criar uma fila revisável.</p></div>'}
          </section>
        </main>
        <footer class="mestre-orc-automation-policy"><i class="fa-solid fa-shield-halved"></i><span>Alterações exigem aprovação e execução separadas. Todas as transições ficam auditadas no servidor.</span></footer>
      </section>
    </div>`;
}

async function confirmOperation({ title, content, yesLabel = 'Confirmar', danger = false } = {}) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title }, content,
      yes: { label: yesLabel, icon: danger ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-check' },
      no: { label: 'Cancelar', icon: 'fa-solid fa-xmark' }
    });
  }
  if (globalThis.Dialog?.confirm) {
    return new Promise((resolve) => Dialog.confirm({ title, content, yes: () => resolve(true), no: () => resolve(false), defaultYes: false }));
  }
  return globalThis.confirm?.(String(content).replace(/<[^>]+>/g, ' ')) ?? false;
}

function safeRichText(value) {
  return escapeHtml(String(value ?? '')).replace(/\r?\n/g, '<br>');
}

function getProperty(object, path) {
  const getter = globalThis.foundry?.utils?.getProperty;
  if (getter) return getter(object, path);
  return String(path).split('.').reduce((current, key) => current?.[key], object);
}

function automationProposalFlag(document) {
  return document?.getFlag?.('mestre-orc', 'automationProposalId')
    ?? document?.flags?.['mestre-orc']?.automationProposalId
    ?? null;
}

function assertAutomationOwnership(document, proposalId, label) {
  if (!document) return false;
  if (automationProposalFlag(document) !== proposalId) {
    throw new Error(`${label} não pertence mais a esta automação; a reversão foi bloqueada.`);
  }
  return true;
}

async function executeFoundryAction(proposal) {
  const payload = proposal.payload ?? {};
  if (proposal.actionType === 'CHAT_MESSAGE') {
    const users = collectionValues(game.users);
    const whisper = payload.visibility === 'GM'
      ? users.filter((user) => user.isGM).map((user) => user.id)
      : payload.visibility === 'WHISPER' ? payload.recipientUserIds ?? [] : [];
    const message = await ChatMessage.create({
      content: safeRichText(payload.content),
      flavor: payload.flavor ? safeRichText(payload.flavor) : undefined,
      whisper,
      speaker: ChatMessage.getSpeaker?.() ?? {},
      flags: { 'mestre-orc': { automationProposalId: proposal.id, generated: true } }
    });
    return { actionType: proposal.actionType, messageId: message.id };
  }

  if (proposal.actionType === 'CREATE_JOURNAL') {
    const JournalClass = globalThis.JournalEntry ?? globalThis.CONFIG?.JournalEntry?.documentClass;
    if (!JournalClass?.create) throw new Error('A API de Journal do Foundry não está disponível.');
    const journal = await JournalClass.create({
      name: payload.name,
      folder: payload.folderId ?? null,
      ownership: { default: 0 },
      pages: [{ name: payload.pageName || 'Notas', type: 'text', text: { content: safeRichText(payload.content) } }],
      flags: { 'mestre-orc': { automationProposalId: proposal.id, generated: true } }
    });
    return { actionType: proposal.actionType, journalId: journal.id };
  }

  if (proposal.actionType === 'APPEND_JOURNAL_PAGE') {
    const journal = game.journal?.get?.(payload.journalId);
    if (!journal?.createEmbeddedDocuments) throw new Error('O Journal indicado não foi encontrado.');
    const [page] = await journal.createEmbeddedDocuments('JournalEntryPage', [{
      name: payload.pageName, type: 'text', text: { content: safeRichText(payload.content) },
      flags: { 'mestre-orc': { automationProposalId: proposal.id, generated: true } }
    }]);
    return { actionType: proposal.actionType, journalId: journal.id, pageId: page.id };
  }

  if (proposal.actionType === 'CREATE_SCENE_NOTE') {
    const scene = game.scenes?.get?.(payload.sceneId) ?? game.scenes?.active ?? canvas?.scene;
    if (!scene?.createEmbeddedDocuments) throw new Error('A Scene indicada não foi encontrada.');
    if (!game.journal?.get?.(payload.journalId)) throw new Error('O Journal vinculado à Note não foi encontrado.');
    const [note] = await scene.createEmbeddedDocuments('Note', [{
      entryId: payload.journalId, pageId: payload.pageId ?? null,
      x: payload.x, y: payload.y, icon: payload.icon || 'icons/svg/book.svg', iconSize: 60,
      text: payload.label || '', global: false,
      flags: { 'mestre-orc': { automationProposalId: proposal.id, generated: true } }
    }]);
    return { actionType: proposal.actionType, sceneId: scene.id, noteId: note.id };
  }

  if (proposal.actionType === 'UPDATE_ACTOR_RESOURCE') {
    const actor = game.actors?.get?.(payload.actorId);
    if (!actor?.update) throw new Error('O Actor indicado não foi encontrado.');
    const previousValue = getProperty(actor, payload.path);
    if (typeof previousValue !== 'number') throw new Error('O caminho aprovado não aponta para um recurso numérico existente.');
    await actor.update({ [payload.path]: payload.value });
    return { actionType: proposal.actionType, actorId: actor.id, path: payload.path, previousValue, appliedValue: payload.value };
  }

  throw new Error('O tipo de ação não possui executor local autorizado.');
}

async function rollbackFoundryAction(proposal) {
  const receipt = proposal.execution?.receipt ?? {};
  if (proposal.actionType === 'CHAT_MESSAGE') {
    const message = game.messages?.get?.(receipt.messageId);
    if (assertAutomationOwnership(message, proposal.id, 'A mensagem')) await message.delete();
    return;
  }
  if (proposal.actionType === 'CREATE_JOURNAL') {
    const journal = game.journal?.get?.(receipt.journalId);
    if (assertAutomationOwnership(journal, proposal.id, 'O Journal')) await journal.delete();
    return;
  }
  if (proposal.actionType === 'APPEND_JOURNAL_PAGE') {
    const journal = game.journal?.get?.(receipt.journalId);
    const page = journal?.pages?.get?.(receipt.pageId);
    if (assertAutomationOwnership(page, proposal.id, 'A página do Journal')) {
      await journal.deleteEmbeddedDocuments('JournalEntryPage', [receipt.pageId]);
    }
    return;
  }
  if (proposal.actionType === 'CREATE_SCENE_NOTE') {
    const scene = game.scenes?.get?.(receipt.sceneId);
    const note = scene?.notes?.get?.(receipt.noteId);
    if (assertAutomationOwnership(note, proposal.id, 'A Note')) {
      await scene.deleteEmbeddedDocuments('Note', [receipt.noteId]);
    }
    return;
  }
  if (proposal.actionType === 'UPDATE_ACTOR_RESOURCE') {
    const actor = game.actors?.get?.(receipt.actorId);
    if (!actor?.update) throw new Error('O Actor original não foi encontrado para reversão.');
    const currentValue = getProperty(actor, receipt.path);
    if (currentValue !== receipt.appliedValue) {
      throw new Error('O recurso foi alterado depois da automação; a reversão foi bloqueada para não sobrescrever uma mudança posterior.');
    }
    await actor.update({ [receipt.path]: receipt.previousValue });
    return;
  }
  throw new Error('Não existe plano de reversão para esta ação.');
}

function setBusy(panel, busy, label = '') {
  panel.dataset.busy = String(Boolean(busy));
  for (const button of panel.querySelectorAll('button')) button.disabled = Boolean(busy);
  if (busy) ui.notifications?.info?.(label || 'Processando automação…');
}

async function loadQueue(request) {
  return request(`/v1/automations/${encodeURIComponent(campaignId())}`);
}

async function rerender(panel, request) {
  const filter = panel.querySelector('[data-automation-filter]')?.value ?? '';
  const data = await loadQueue(request);
  const replacement = document.createElement('div');
  replacement.innerHTML = panelHtml(data);
  panel.replaceWith(replacement.firstElementChild);
  const next = document.getElementById(AUTOMATION_PANEL_ID);
  bindPanel(next, request);
  const select = next.querySelector('[data-automation-filter]');
  if (select) { select.value = filter; applyFilter(next, filter); }
}

function applyFilter(panel, status) {
  for (const card of panel.querySelectorAll('.mestre-orc-automation-card')) {
    card.hidden = Boolean(status && card.dataset.status !== status);
  }
}

async function mutateProposal(panel, request, proposalId, action, body = {}) {
  setBusy(panel, true);
  try {
    await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/${action}`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), ...body })
    });
    await rerender(panel, request);
  } catch (error) {
    ui.notifications?.error?.(`Mestre Orc: ${error.message}`);
    setBusy(panel, false);
  }
}

async function executeProposal(panel, request, proposalId) {
  const detail = await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}`);
  const proposal = detail.proposal;
  const confirmed = await confirmOperation({
    title: `Executar — ${proposal.title}`,
    content: `<p><strong>${escapeHtml(riskLabel(proposal.risk))}.</strong> Esta ação modificará o Foundry agora.</p><pre>${payloadPreview(proposal.payload)}</pre><p>A aprovação já foi registrada; este é o segundo passo explícito.</p>`,
    yesLabel: proposal.risk === 'HIGH' ? 'Executar alteração de alto risco' : 'Executar agora',
    danger: proposal.risk === 'HIGH'
  });
  if (!confirmed) return;

  setBusy(panel, true, 'Executando ação aprovada…');
  let claim = null;
  try {
    claim = await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/execute/claim`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: proposal.revision })
    });
    const receipt = await executeFoundryAction(claim.proposal);
    await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/execute/result`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: claim.proposal.revision, executionToken: claim.executionToken, success: true, receipt })
    });
    ui.notifications?.info?.('Mestre Orc: automação executada e auditada.');
  } catch (error) {
    if (claim?.executionToken) {
      await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/execute/result`, {
        method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: claim.proposal.revision, executionToken: claim.executionToken, success: false, error: error.message })
      }).catch(() => {});
    }
    ui.notifications?.error?.(`Mestre Orc: ${error.message}`);
  }
  await rerender(panel, request).catch(() => setBusy(panel, false));
}

async function rollbackProposal(panel, request, proposalId) {
  const detail = await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}`);
  const proposal = detail.proposal;
  const confirmed = await confirmOperation({
    title: `Desfazer — ${proposal.title}`,
    content: '<p>O módulo tentará restaurar o estado anterior registrado no recibo da execução.</p>',
    yesLabel: 'Desfazer ação', danger: true
  });
  if (!confirmed) return;

  setBusy(panel, true, 'Desfazendo ação…');
  let claim = null;
  try {
    claim = await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/rollback/claim`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: proposal.revision })
    });
    await rollbackFoundryAction(claim.proposal);
    await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/rollback/result`, {
      method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: claim.proposal.revision, rollbackToken: claim.rollbackToken, success: true })
    });
    ui.notifications?.info?.('Mestre Orc: ação desfeita e auditoria atualizada.');
  } catch (error) {
    if (claim?.rollbackToken) {
      await request(`/v1/automations/${encodeURIComponent(campaignId())}/${encodeURIComponent(proposalId)}/rollback/result`, {
        method: 'POST', body: JSON.stringify({ requester: requester(), expectedRevision: claim.proposal.revision, rollbackToken: claim.rollbackToken, success: false, error: error.message })
      }).catch(() => {});
    }
    ui.notifications?.error?.(`Mestre Orc: ${error.message}`);
  }
  await rerender(panel, request).catch(() => setBusy(panel, false));
}

function bindPanel(panel, request) {
  if (!panel) return;
  panel.querySelector('[data-automation-filter]')?.addEventListener('change', (event) => applyFilter(panel, event.target.value));
  for (const preset of panel.querySelectorAll('[data-automation-preset]')) {
    preset.addEventListener('click', () => {
      const textarea = panel.querySelector('textarea[name="goal"]');
      if (textarea) { textarea.value = preset.dataset.automationPreset ?? ''; textarea.focus(); }
    });
  }
  panel.querySelector('.mestre-orc-automation-suggest-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const goal = String(new FormData(event.currentTarget).get('goal') ?? '').trim();
    if (!goal) return;
    setBusy(panel, true, 'Gerando propostas para revisão…');
    try {
      const result = await request(`/v1/automations/${encodeURIComponent(campaignId())}/suggest`, {
        method: 'POST', body: JSON.stringify({ goal, requester: requester(), context: automationContext() })
      });
      ui.notifications?.info?.(`${result.proposals?.length ?? 0} proposta(s) adicionada(s) à fila. Nenhuma foi executada.`);
      await rerender(panel, request);
    } catch (error) {
      ui.notifications?.error?.(`Mestre Orc: ${error.message}`);
      setBusy(panel, false);
    }
  });
  panel.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-automation-action]');
    if (!target) return;
    const action = target.dataset.automationAction;
    const proposalId = target.dataset.proposalId;
    if (action === 'close') return panel.remove();
    if (action === 'refresh') return rerender(panel, request);
    if (action === 'approve') return mutateProposal(panel, request, proposalId, 'approve');
    if (action === 'reject') {
      const confirmed = await confirmOperation({ title: 'Rejeitar proposta', content: '<p>A proposta será encerrada sem executar mudanças.</p>', yesLabel: 'Rejeitar', danger: true });
      if (confirmed) return mutateProposal(panel, request, proposalId, 'reject', { reason: 'Rejeitada pelo mestre no painel.' });
      return;
    }
    if (action === 'execute') return executeProposal(panel, request, proposalId);
    if (action === 'rollback') return rollbackProposal(panel, request, proposalId);
  });
}

export function injectAutomationButton({ root = document, findChatContainer } = {}) {
  if (!game.user?.isGM || document.getElementById(AUTOMATION_BUTTON_ID)) return false;
  const container = findChatContainer?.(root) ?? root.querySelector?.('#chat') ?? document.querySelector('#chat');
  if (!container) return false;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = AUTOMATION_BUTTON_ID;
  button.dataset.mestreOrcAction = 'open-automations';
  button.className = 'mestre-orc-secondary-button';
  button.innerHTML = '<i class="fa-solid fa-list-check"></i><span>Automações</span>';
  button.title = 'Abrir fila de automações que exigem aprovação do mestre.';
  const anchor = container.querySelector('.mestre-orc-tutor-button, #mestre-orc-tutors, .chat-form, #chat-form');
  if (anchor?.parentElement) anchor.parentElement.insertBefore(button, anchor);
  else container.prepend(button);
  return true;
}

export async function openAutomationPanel({ request } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn?.('Somente o mestre pode usar automações assistidas.');
    return null;
  }
  document.getElementById(AUTOMATION_PANEL_ID)?.remove();
  try {
    const data = await loadQueue(request);
    const wrapper = document.createElement('div');
    wrapper.innerHTML = panelHtml(data);
    const panel = wrapper.firstElementChild;
    document.body.append(panel);
    bindPanel(panel, request);
    return panel;
  } catch (error) {
    ui.notifications?.error?.(`Mestre Orc: ${error.message}`);
    return null;
  }
}

export const automationPanelInternals = {
  automationContext,
  resourceContext,
  executeFoundryAction,
  rollbackFoundryAction,
  automationProposalFlag,
  assertAutomationOwnership,
  safeRichText,
  statusLabel,
  actionLabel,
  riskLabel
};
