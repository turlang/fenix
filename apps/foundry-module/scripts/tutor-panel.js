export const TUTOR_BUTTON_ID = 'mestre-orc-tutors';
export const TUTOR_PANEL_ID = 'mestre-orc-tutor-panel';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function cleanObject(value, depth = 0) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (depth >= 4) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => cleanObject(entry, depth + 1));
  if (typeof value !== 'object') return String(value);
  const output = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    if (/(?:password|api.?key|authorization|cookie|credential)/i.test(key)) continue;
    output[key] = cleanObject(entry, depth + 1);
  }
  return output;
}

function documentData(document) {
  if (!document) return {};
  if (typeof document.toObject === 'function') return document.toObject(false);
  return cleanObject(document);
}

function itemTutorData(item) {
  const source = documentData(item);
  const system = source.system ?? {};
  return {
    id: source._id ?? source.id ?? item?.id ?? null,
    name: source.name ?? item?.name ?? 'Item',
    type: source.type ?? item?.type ?? 'item',
    quantity: system.quantity ?? null,
    equipped: system.equipped ?? null,
    attuned: system.attuned ?? system.attunement ?? null,
    activation: cleanObject(system.activation),
    uses: cleanObject(system.uses),
    ability: system.ability ?? null,
    actionType: system.actionType ?? null,
    damage: cleanObject(system.damage),
    range: cleanObject(system.range),
    target: cleanObject(system.target),
    duration: cleanObject(system.duration),
    level: system.level ?? null,
    preparation: cleanObject(system.preparation),
    description: String(system.description?.value ?? system.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1200)
  };
}

function classTutorData(item) {
  const source = itemTutorData(item);
  return { id: source.id, name: source.name, level: Number(item?.system?.levels ?? item?.system?.level ?? source.level) || null };
}

export function actorTutorSnapshot(actor) {
  if (!actor) return null;
  const source = documentData(actor);
  const system = source.system ?? actor.system ?? {};
  const items = actor.items?.contents ?? actor.items ?? source.items ?? [];
  const effects = actor.effects?.contents ?? actor.effects ?? source.effects ?? [];
  return {
    id: source._id ?? source.id ?? actor.id,
    uuid: actor.uuid ?? source.uuid ?? null,
    name: source.name ?? actor.name,
    type: source.type ?? actor.type,
    systemId: game.system?.id ?? 'generic',
    level: Number(system.details?.level ?? system.details?.level?.value ?? 0) || null,
    classes: [...items].filter((item) => item.type === 'class').map(classTutorData).slice(0, 20),
    abilities: cleanObject(system.abilities ?? {}),
    skills: cleanObject(system.skills ?? {}),
    attributes: cleanObject(system.attributes ?? {}),
    resources: cleanObject(system.resources ?? {}),
    traits: cleanObject(system.traits ?? {}),
    spells: [...items].filter((item) => item.type === 'spell').map(itemTutorData).slice(0, 80),
    items: [...items].filter((item) => item.type !== 'spell' && item.type !== 'class').map(itemTutorData).slice(0, 120),
    effects: [...effects].map((effect) => {
      const entry = documentData(effect);
      return { id: entry._id ?? entry.id ?? effect.id, name: entry.name ?? effect.name, disabled: Boolean(entry.disabled), duration: cleanObject(entry.duration) };
    }).slice(0, 60),
    rawSummary: {
      details: cleanObject(system.details ?? {}),
      currency: cleanObject(system.currency ?? {}),
      bonuses: cleanObject(system.bonuses ?? {})
    }
  };
}

function ownedActors() {
  const actors = game.actors?.contents ?? game.actors ?? [];
  return [...actors].filter((actor) => game.user?.isGM || actor.isOwner).sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
}

function preferredActor() {
  const controlled = canvas?.tokens?.controlled?.[0]?.actor ?? null;
  if (controlled && (game.user?.isGM || controlled.isOwner)) return controlled;
  if (game.user?.character && (game.user.isGM || game.user.character.isOwner)) return game.user.character;
  return ownedActors()[0] ?? null;
}

function requesterPayload() {
  return { id: String(game.user?.id ?? ''), name: String(game.user?.name ?? 'Usuário'), isGM: Boolean(game.user?.isGM) };
}

function campaignPayload() {
  return { worldId: String(game.world?.id ?? 'default'), title: String(game.world?.title ?? ''), systemId: String(game.system?.id ?? 'generic'), systemVersion: String(game.system?.version ?? '') };
}

function scenePayload() {
  const scene = game.scenes?.active ?? canvas?.scene ?? null;
  return scene ? {
    id: scene.id,
    name: scene.name,
    description: String(scene.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 2500),
    darkness: Number(scene.darkness) || 0,
    tokenCount: Number(scene.tokens?.size ?? scene.tokens?.contents?.length ?? 0),
    wallCount: Number(scene.walls?.size ?? scene.walls?.contents?.length ?? 0),
    lightCount: Number(scene.lights?.size ?? scene.lights?.contents?.length ?? 0)
  } : {};
}

function combatPayload() {
  const combat = game.combat;
  if (!combat) return { active: false };
  const combatants = combat.combatants?.contents ?? combat.combatants ?? [];
  return {
    active: Boolean(combat.started),
    id: combat.id,
    round: Number(combat.round) || 0,
    turn: Number(combat.turn) || 0,
    activeCombatant: combat.combatant ? { id: combat.combatant.id, name: combat.combatant.name, actorId: combat.combatant.actorId } : null,
    combatants: [...combatants].map((entry) => ({ id: entry.id, name: entry.name, actorId: entry.actorId, defeated: Boolean(entry.defeated), initiative: entry.initiative ?? null })).slice(0, 100)
  };
}

function partyPayload() {
  return ownedActors().filter((actor) => actor.type === 'character').map((actor) => {
    const snapshot = actorTutorSnapshot(actor);
    return { id: snapshot.id, name: snapshot.name, type: snapshot.type, level: snapshot.level, classes: snapshot.classes, attributes: snapshot.attributes };
  }).slice(0, 30);
}

function actorOptionsHtml(actors, selectedId) {
  return actors.map((actor) => `<option value="${escapeHtml(actor.id)}"${actor.id === selectedId ? ' selected' : ''}>${escapeHtml(actor.name)} · ${escapeHtml(actor.type || 'actor')}</option>`).join('');
}

function panelHtml({ actors, selectedActor, history = [] }) {
  const gm = Boolean(game.user?.isGM);
  return `
    <div id="${TUTOR_PANEL_ID}" class="mestre-orc-tutor-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-tutor-title">
      <section class="mestre-orc-tutor-panel">
        <header>
          <div><span>Orientação contextual</span><h2 id="mestre-orc-tutor-title">Tutores do Mestre Orc</h2><p>Explicações consultivas, sem alterações automáticas na ficha ou no mundo.</p></div>
          <button type="button" data-tutor-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <nav class="mestre-orc-tutor-tabs">
          <button type="button" data-tutor-mode="SHEET" class="active"><i class="fa-solid fa-address-card"></i> Tutor de Ficha</button>
          ${gm ? '<button type="button" data-tutor-mode="GM"><i class="fa-solid fa-hat-wizard"></i> Tutor de Mestre</button>' : ''}
        </nav>
        <main>
          <form class="mestre-orc-tutor-form" data-current-mode="SHEET">
            <label data-tutor-actor-field>Ficha consultada
              <select name="actorId" ${actors.length ? '' : 'disabled'}>${actorOptionsHtml(actors, selectedActor?.id)}</select>
            </label>
            <label>Pergunta
              <textarea name="question" rows="5" maxlength="3000" required placeholder="Ex.: Como funciona minha Classe de Armadura? Quais recursos ainda aparecem disponíveis?${gm ? ' Ou, no Tutor de Mestre: como destravar esta cena sem retirar a agência dos jogadores?' : ''}"></textarea>
            </label>
            <div class="mestre-orc-tutor-prompts" data-sheet-prompts>
              <button type="button" data-tutor-question="Explique os principais números desta ficha e de onde eles vêm.">Resumo da ficha</button>
              <button type="button" data-tutor-question="Quais ações e recursos desta ficha parecem disponíveis agora?">Opções de ação</button>
              <button type="button" data-tutor-question="Quais recursos da ficha devo conferir antes do próximo descanso?">Recursos</button>
            </div>
            <div class="mestre-orc-tutor-prompts" data-gm-prompts hidden>
              <button type="button" data-tutor-question="Quais são os fatos confirmados e as decisões pendentes nesta cena?">Ler a cena</button>
              <button type="button" data-tutor-question="Como posso melhorar o ritmo desta sessão sem forçar decisões dos jogadores?">Ritmo</button>
              <button type="button" data-tutor-question="Proponha uma arbitragem provisória e reversível para a situação atual.">Arbitragem</button>
            </div>
            <button type="submit" class="mestre-orc-tutor-submit" ${actors.length ? '' : 'disabled'}><i class="fa-solid fa-wand-magic-sparkles"></i> Consultar Tutor de Ficha</button>
          </form>
          <section class="mestre-orc-tutor-result" aria-live="polite">
            <div class="mestre-orc-tutor-empty"><i class="fa-solid fa-comments"></i><p>Faça uma pergunta. O tutor usará somente o contexto autorizado.</p></div>
          </section>
          <aside class="mestre-orc-tutor-history">
            <h3>Histórico privado</h3>
            <div>${history.slice(0, 12).map((entry) => `<button type="button" data-history-answer="${escapeHtml(entry.answer)}"><span>${escapeHtml(entry.mode === 'GM' ? 'Mestre' : entry.actorName || 'Ficha')}</span><strong>${escapeHtml(entry.question)}</strong></button>`).join('') || '<p>Nenhuma consulta registrada.</p>'}</div>
          </aside>
        </main>
      </section>
    </div>`;
}

function confidenceLabel(value) {
  return ({ HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' })[value] ?? 'Não informada';
}

function resultHtml(result) {
  const facts = result.sourceFacts ?? [];
  return `
    <article>
      <header><span>${result.mode === 'GM' ? 'Tutor de Mestre' : 'Tutor de Ficha'}</span><strong>Confiança ${escapeHtml(confidenceLabel(result.confidence))}</strong></header>
      <div class="mestre-orc-tutor-answer">${escapeHtml(result.answer).replaceAll('\n', '<br>')}</div>
      ${facts.length ? `<details><summary>Dados usados (${facts.length})</summary><ul>${facts.map((entry) => `<li><strong>${escapeHtml(entry.label)}</strong>: ${escapeHtml(entry.value)}</li>`).join('')}</ul></details>` : ''}
      ${(result.warnings ?? []).length ? `<section class="warnings"><h4>Atenção</h4><ul>${result.warnings.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section>` : ''}
      ${(result.suggestedActions ?? []).length ? `<section><h4>Próximos passos</h4><ol>${result.suggestedActions.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ol></section>` : ''}
      <footer><i class="fa-solid fa-shield-halved"></i> Nenhuma alteração foi aplicada automaticamente.</footer>
    </article>`;
}

export function closeTutorPanel() {
  document.getElementById(TUTOR_PANEL_ID)?.remove();
}

function selectMode(panel, mode) {
  const normalized = mode === 'GM' && game.user?.isGM ? 'GM' : 'SHEET';
  panel.querySelectorAll('[data-tutor-mode]').forEach((button) => button.classList.toggle('active', button.dataset.tutorMode === normalized));
  const form = panel.querySelector('.mestre-orc-tutor-form');
  form.dataset.currentMode = normalized;
  panel.querySelector('[data-tutor-actor-field]').hidden = normalized === 'GM';
  panel.querySelector('[data-sheet-prompts]').hidden = normalized !== 'SHEET';
  const gmPrompts = panel.querySelector('[data-gm-prompts]');
  if (gmPrompts) gmPrompts.hidden = normalized !== 'GM';
  const submit = panel.querySelector('.mestre-orc-tutor-submit');
  submit.innerHTML = normalized === 'GM'
    ? '<i class="fa-solid fa-hat-wizard"></i> Consultar Tutor de Mestre'
    : '<i class="fa-solid fa-wand-magic-sparkles"></i> Consultar Tutor de Ficha';
  submit.disabled = normalized === 'SHEET' && !ownedActors().length;
}

async function askTutor(panel, request) {
  const form = panel.querySelector('.mestre-orc-tutor-form');
  const mode = form.dataset.currentMode === 'GM' ? 'GM' : 'SHEET';
  const question = String(new FormData(form).get('question') ?? '').trim();
  if (question.length < 3) return ui.notifications?.warn?.('Mestre Orc: escreva uma pergunta mais completa.');
  const resultArea = panel.querySelector('.mestre-orc-tutor-result');
  const submit = panel.querySelector('.mestre-orc-tutor-submit');
  submit.disabled = true;
  resultArea.innerHTML = '<div class="mestre-orc-tutor-loading"><i class="fa-solid fa-spinner fa-spin"></i><p>Analisando apenas o contexto autorizado...</p></div>';
  try {
    const campaign = campaignPayload();
    let endpoint = `/v1/tutors/${encodeURIComponent(campaign.worldId)}/sheet`;
    let payload = null;
    if (mode === 'GM') {
      endpoint = `/v1/tutors/${encodeURIComponent(campaign.worldId)}/gm`;
      payload = { question, requester: requesterPayload(), campaign, scene: scenePayload(), combat: combatPayload(), party: partyPayload() };
    } else {
      const actorId = String(new FormData(form).get('actorId') ?? '');
      const actor = game.actors?.get?.(actorId) ?? ownedActors().find((entry) => entry.id === actorId);
      if (!actor || (!game.user?.isGM && !actor.isOwner)) throw new Error('Selecione uma ficha que você possua.');
      payload = {
        question,
        requester: requesterPayload(),
        access: { canView: Boolean(game.user?.isGM || actor.visible !== false), isOwner: Boolean(actor.isOwner), canEdit: Boolean(actor.isOwner) },
        actor: actorTutorSnapshot(actor),
        campaign
      };
    }
    const result = await request(endpoint, { method: 'POST', body: JSON.stringify(payload) });
    resultArea.innerHTML = resultHtml(result);
  } catch (error) {
    resultArea.innerHTML = `<div class="mestre-orc-tutor-error"><i class="fa-solid fa-triangle-exclamation"></i><p>${escapeHtml(error.message)}</p></div>`;
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  } finally {
    submit.disabled = mode === 'SHEET' && !ownedActors().length;
  }
}

function bindPanel(panel, request) {
  panel.addEventListener('click', (event) => {
    const close = event.target instanceof Element ? event.target.closest('[data-tutor-action="close"]') : null;
    if (close) return closeTutorPanel();
    const mode = event.target instanceof Element ? event.target.closest('[data-tutor-mode]') : null;
    if (mode) return selectMode(panel, mode.dataset.tutorMode);
    const prompt = event.target instanceof Element ? event.target.closest('[data-tutor-question]') : null;
    if (prompt) {
      panel.querySelector('textarea[name="question"]').value = prompt.dataset.tutorQuestion || '';
      panel.querySelector('textarea[name="question"]').focus();
      return;
    }
    const history = event.target instanceof Element ? event.target.closest('[data-history-answer]') : null;
    if (history) panel.querySelector('.mestre-orc-tutor-result').innerHTML = `<article><div class="mestre-orc-tutor-answer">${escapeHtml(history.dataset.historyAnswer)}</div><footer>Consulta anterior; nenhuma alteração automática.</footer></article>`;
  });
  panel.querySelector('.mestre-orc-tutor-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void askTutor(panel, request);
  });
  panel.addEventListener('click', (event) => { if (event.target === panel) closeTutorPanel(); });
}

export async function openTutorPanel({ request }) {
  try {
    const campaignId = String(game.world?.id ?? 'default');
    const query = new URLSearchParams({ requesterId: String(game.user?.id ?? ''), isGM: String(Boolean(game.user?.isGM)) });
    const history = await request(`/v1/tutors/${encodeURIComponent(campaignId)}/history?${query}`).catch(() => ({ entries: [] }));
    const actors = ownedActors();
    const selectedActor = preferredActor();
    closeTutorPanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml({ actors, selectedActor, history: history.entries ?? [] }));
    const panel = document.getElementById(TUTOR_PANEL_ID);
    if (panel) bindPanel(panel, request);
  } catch (error) {
    console.error('[Mestre Orc] falha ao abrir tutores', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectTutorButton({ root = document, request, findChatContainer }) {
  if (document.getElementById(TUTOR_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = TUTOR_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-tutors';
  button.innerHTML = '<i class="fa-solid fa-graduation-cap"></i><span>Tutores</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openTutorPanel({ request });
  };
  const maps = document.getElementById('mestre-orc-maps');
  const voice = document.getElementById('mestre-orc-voice-profiles');
  if (maps?.parentElement) maps.insertAdjacentElement('afterend', button);
  else if (voice?.parentElement) voice.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
