export const GENERATOR_BUTTON_ID = 'mestre-orc-generators';
export const GENERATOR_PANEL_ID = 'mestre-orc-generator-panel';

const TYPE_LABELS = {
  ADVENTURE: 'Aventura',
  NPC: 'NPC',
  DUNGEON: 'Dungeon'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? 'default');
}

function typeOptions(selected = 'ADVENTURE') {
  return Object.entries(TYPE_LABELS)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function statusLabel(status) {
  return status === 'ACTIVE' ? 'Ativo' : 'Arquivado';
}

function artifactsHtml(snapshot) {
  const artifacts = Array.isArray(snapshot?.artifacts) ? snapshot.artifacts : [];
  if (!artifacts.length) return '<p class="mestre-orc-generator-empty">Nenhum conteúdo gerado nesta campanha.</p>';
  return artifacts.map((artifact) => `
    <article class="mestre-orc-generator-card" data-artifact-id="${escapeHtml(artifact.id)}">
      <header>
        <div><span>${escapeHtml(TYPE_LABELS[artifact.type] ?? artifact.type)}</span><strong>${escapeHtml(artifact.title)}</strong></div>
        <em class="${artifact.status === 'ACTIVE' ? 'active' : 'archived'}">${statusLabel(artifact.status)}</em>
      </header>
      <p>${escapeHtml(artifact.summary)}</p>
      <div class="mestre-orc-generator-tags">${(artifact.tags ?? []).slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <small>Geração ${Number(artifact.source?.generationNumber) || 1} · ${new Date(artifact.createdAt).toLocaleString('pt-BR')}</small>
      <footer>
        <button type="button" data-generator-action="view"><i class="fa-solid fa-eye"></i> Ver</button>
        ${artifact.status === 'ACTIVE'
          ? '<button type="button" data-generator-action="archive"><i class="fa-solid fa-box-archive"></i> Arquivar</button>'
          : '<button type="button" data-generator-action="activate"><i class="fa-solid fa-bolt"></i> Ativar</button>'}
        <button type="button" data-generator-action="delete" class="danger"><i class="fa-solid fa-trash"></i></button>
      </footer>
    </article>`).join('');
}

function detailHtml(artifact) {
  return `
    <section class="mestre-orc-generator-detail" data-generator-detail>
      <header>
        <div><span>${escapeHtml(TYPE_LABELS[artifact.type] ?? artifact.type)} · ${statusLabel(artifact.status)}</span><h3>${escapeHtml(artifact.title)}</h3></div>
        <button type="button" data-generator-action="close-detail"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <p class="summary">${escapeHtml(artifact.summary)}</p>
      <div class="mestre-orc-generator-tags">${(artifact.tags ?? []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>
      <dl>
        ${Object.entries(artifact.metadata ?? {}).filter(([, value]) => value !== null && value !== '').map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}
      </dl>
      <pre>${escapeHtml(artifact.content)}</pre>
    </section>`;
}

function panelHtml(snapshot) {
  const counts = snapshot?.counts ?? {};
  return `
    <div id="${GENERATOR_PANEL_ID}" class="mestre-orc-generator-overlay" role="dialog" aria-modal="true">
      <section class="mestre-orc-generator-panel">
        <header class="mestre-orc-generator-header">
          <div><span>Campanha ${escapeHtml(snapshot?.campaignId ?? campaignId())}</span><h2>Forja de conteúdo</h2><p>Gere, arquive e ative aventuras, NPCs e dungeons sem repetir material anterior.</p></div>
          <button type="button" data-generator-action="close"><i class="fa-solid fa-xmark"></i></button>
        </header>

        <div class="mestre-orc-generator-stats">
          <article><strong>${Number(snapshot?.count) || 0}</strong><span>Total</span></article>
          <article><strong>${Number(counts.byType?.ADVENTURE) || 0}</strong><span>Aventuras</span></article>
          <article><strong>${Number(counts.byType?.NPC) || 0}</strong><span>NPCs</span></article>
          <article><strong>${Number(counts.byType?.DUNGEON) || 0}</strong><span>Dungeons</span></article>
          <article><strong>${Number(counts.byStatus?.ACTIVE) || 0}</strong><span>Ativos</span></article>
        </div>

        <form class="mestre-orc-generator-form">
          <h3>Nova geração</h3>
          <label>Tipo<select name="type">${typeOptions()}</select></label>
          <label>Sistema<input name="system" maxlength="120" value="D&D 5e"></label>
          <label>Tom<input name="tone" maxlength="200" value="medieval sombrio e cinematográfico"></label>
          <label>Faixa de nível<input name="levelRange" maxlength="80" placeholder="Ex.: 1–5"></label>
          <label>Jogadores<input name="playerCount" type="number" min="1" max="20" value="4"></label>
          <label>Extensão<select name="length"><option value="SHORT">Curta</option><option value="MEDIUM" selected>Média</option><option value="LONG">Longa</option></select></label>
          <label class="mestre-orc-generator-wide">Pedido do mestre<textarea name="brief" required minlength="10" maxlength="5000" rows="4" placeholder="Descreva o tema, objetivo, local, antagonista ou função desejada."></textarea></label>
          <label class="mestre-orc-generator-wide">Restrições<textarea name="constraints" maxlength="3000" rows="2" placeholder="Elementos obrigatórios ou proibidos, estilo, duração, limites..."></textarea></label>
          <label class="checkbox"><input name="includeSecrets" type="checkbox" checked> Incluir seção reservada ao mestre</label>
          <p><strong>Proteção contra repetição:</strong> cada resultado é comparado com todo o arquivo do mesmo tipo. Conteúdo semelhante é rejeitado e gerado novamente antes de ser salvo.</p>
          <button type="submit"><i class="fa-solid fa-wand-magic-sparkles"></i> Gerar e arquivar</button>
        </form>

        <section class="mestre-orc-generator-archive">
          <h3>Arquivo persistente</h3>
          <div class="mestre-orc-generator-grid">${artifactsHtml(snapshot)}</div>
        </section>
        <div data-generator-detail-host></div>
      </section>
    </div>`;
}

export function closeGeneratorPanel() {
  document.getElementById(GENERATOR_PANEL_ID)?.remove();
}

async function refreshPanel(request) {
  return openGeneratorPanel({ request });
}

function bindPanel(panel, request) {
  panel.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-generator-action]') : null;
    if (!button) return;
    const action = button.dataset.generatorAction;
    if (action === 'close') return closeGeneratorPanel();
    if (action === 'close-detail') {
      panel.querySelector('[data-generator-detail]')?.remove();
      return;
    }
    const artifactId = button.closest('[data-artifact-id]')?.dataset.artifactId;
    if (!artifactId) return;
    button.disabled = true;
    try {
      if (action === 'view') {
        const response = await request(`/v1/generators/${encodeURIComponent(campaignId())}/${encodeURIComponent(artifactId)}`);
        const host = panel.querySelector('[data-generator-detail-host]');
        host.innerHTML = detailHtml(response.artifact);
        host.querySelector('[data-generator-detail]')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        button.disabled = false;
        return;
      }
      if (action === 'activate') {
        const confirmed = await Dialog.confirm({
          title: 'Ativar conteúdo gerado',
          content: '<p>Aventuras e dungeons serão enviadas à Biblioteca como referência exclusiva do mestre. NPCs serão adicionados à memória como segredo.</p>'
        });
        if (!confirmed) { button.disabled = false; return; }
        await request(`/v1/generators/${encodeURIComponent(campaignId())}/${encodeURIComponent(artifactId)}/activate`, { method: 'POST' });
        ui.notifications?.info?.('Mestre Orc: conteúdo ativado com proteção de mestre.');
      } else if (action === 'archive') {
        await request(`/v1/generators/${encodeURIComponent(campaignId())}/${encodeURIComponent(artifactId)}/archive`, { method: 'POST' });
        ui.notifications?.info?.('Mestre Orc: conteúdo mantido no arquivo.');
      } else if (action === 'delete') {
        const confirmed = await Dialog.confirm({ title: 'Excluir geração', content: '<p>O registro será removido do arquivo de gerações. Integrações já ativadas não serão apagadas automaticamente.</p>' });
        if (!confirmed) { button.disabled = false; return; }
        await request(`/v1/generators/${encodeURIComponent(campaignId())}/${encodeURIComponent(artifactId)}`, { method: 'DELETE' });
        ui.notifications?.info?.('Mestre Orc: geração removida do arquivo.');
      }
      await refreshPanel(request);
    } catch (error) {
      button.disabled = false;
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });

  const form = panel.querySelector('.mestre-orc-generator-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando sem repetir...';
    try {
      const payload = {
        type: form.elements.type.value,
        brief: String(form.elements.brief.value ?? '').trim(),
        system: String(form.elements.system.value ?? '').trim(),
        tone: String(form.elements.tone.value ?? '').trim(),
        levelRange: String(form.elements.levelRange.value ?? '').trim() || null,
        playerCount: Number(form.elements.playerCount.value) || null,
        length: form.elements.length.value,
        includeSecrets: Boolean(form.elements.includeSecrets.checked),
        constraints: String(form.elements.constraints.value ?? '').trim() || null
      };
      const result = await request(`/v1/generators/${encodeURIComponent(campaignId())}/generate`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      ui.notifications?.info?.(`Mestre Orc: “${result.artifact?.title ?? 'conteúdo'}” gerado e arquivado em ${result.attempts ?? 1} tentativa(s).`);
      await refreshPanel(request);
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Gerar e arquivar';
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });
}

export async function openGeneratorPanel({ request }) {
  if (!game.user?.isGM) return;
  try {
    const snapshot = await request(`/v1/generators/${encodeURIComponent(campaignId())}`);
    closeGeneratorPanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml(snapshot));
    const panel = document.getElementById(GENERATOR_PANEL_ID);
    if (!panel) return;
    bindPanel(panel, request);
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeGeneratorPanel();
    });
  } catch (error) {
    console.error('[Mestre Orc] falha ao abrir geradores', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectGeneratorButton({ root = document, request, findChatContainer }) {
  if (!game.user?.isGM || document.getElementById(GENERATOR_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = GENERATOR_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-generators';
  button.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i><span>Forja de conteúdo</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openGeneratorPanel({ request });
  };
  const adventureButton = document.getElementById('mestre-orc-adventure-library');
  if (adventureButton?.parentElement) adventureButton.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
