export const ADVENTURE_BUTTON_ID = 'mestre-orc-adventure-library';
export const ADVENTURE_PANEL_ID = 'mestre-orc-adventure-library-panel';

const MODE_LABELS = {
  REFERENCE_ONLY: 'Somente referência do mestre',
  READ_ALOUD_ONLY: 'Apenas seções “leia em voz alta”',
  PLAYER_SAFE: 'Documento liberado para narração'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? 'default');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.onload = () => {
      const value = String(reader.result ?? '');
      resolve(value.includes(',') ? value.slice(value.indexOf(',') + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

function modeOptions(selected = 'REFERENCE_ONLY') {
  return Object.entries(MODE_LABELS)
    .map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function documentsHtml(snapshot) {
  const documents = Array.isArray(snapshot?.documents) ? snapshot.documents : [];
  if (!documents.length) return '<p class="mestre-orc-adventure-empty">Nenhum documento importado.</p>';
  return documents.map((document) => `
    <article class="mestre-orc-adventure-document" data-document-id="${escapeHtml(document.id)}">
      <div class="mestre-orc-adventure-document-main">
        <strong>${escapeHtml(document.title)}</strong>
        <small>${escapeHtml(document.fileName)} · ${Number(document.wordCount) || 0} palavras · ${Number(document.chunkCount) || 0} trechos</small>
        <div class="mestre-orc-adventure-badges">
          <span class="safe">${Number(document.safeChunkCount) || 0} seguros</span>
          <span class="secret">${Number(document.secretChunkCount) || 0} reservados</span>
          <span>${escapeHtml(document.extractionMethod ?? '')}</span>
        </div>
        ${(document.warnings ?? []).map((warning) => `<em>${escapeHtml(warning)}</em>`).join('')}
      </div>
      <label>Uso
        <select data-adventure-mode>${modeOptions(document.mode)}</select>
      </label>
      <button type="button" data-adventure-action="delete" title="Remover documento"><i class="fa-solid fa-trash"></i></button>
    </article>`).join('');
}

function searchResultsHtml(results = []) {
  if (!results.length) return '<p class="mestre-orc-adventure-empty">Nenhum trecho encontrado.</p>';
  return results.map((result) => `
    <article class="mestre-orc-adventure-result">
      <header><strong>${escapeHtml(result.document?.title)}</strong><span class="${result.chunk?.access === 'PLAYER_SAFE' ? 'safe' : 'secret'}">${result.chunk?.access === 'PLAYER_SAFE' ? 'Seguro' : 'Mestre'}</span></header>
      <small>${escapeHtml(result.chunk?.heading ?? 'Seção')} · relevância ${Number(result.score || 0).toFixed(2)}</small>
      <p>${escapeHtml(result.chunk?.text ?? '')}</p>
    </article>`).join('');
}

function panelHtml(snapshot) {
  return `
    <div id="${ADVENTURE_PANEL_ID}" class="mestre-orc-adventure-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-adventure-title">
      <section class="mestre-orc-adventure-panel">
        <header class="mestre-orc-adventure-header">
          <div>
            <span>Campanha ${escapeHtml(snapshot?.campaignId ?? campaignId())}</span>
            <h2 id="mestre-orc-adventure-title">Biblioteca da aventura</h2>
            <p>Importe material e controle exatamente o que pode chegar à narração.</p>
          </div>
          <button type="button" data-adventure-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>

        <div class="mestre-orc-adventure-stats">
          <article><strong>${Number(snapshot?.documentCount) || 0}</strong><span>Documentos</span></article>
          <article><strong>${Number(snapshot?.chunkCount) || 0}</strong><span>Trechos</span></article>
          <article><strong>${Number(snapshot?.safeChunkCount) || 0}</strong><span>Seguros</span></article>
          <article><strong>${Number(snapshot?.secretChunkCount) || 0}</strong><span>Reservados</span></article>
        </div>

        <form class="mestre-orc-adventure-import">
          <h3>Importar material</h3>
          <label>Arquivo
            <input name="file" type="file" required accept=".txt,.md,.html,.htm,.docx,.pdf,text/plain,text/markdown,text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
          </label>
          <label>Título opcional<input name="title" maxlength="300" placeholder="Usa o nome do arquivo quando vazio"></label>
          <label>Proteção inicial<select name="mode">${modeOptions('REFERENCE_ONLY')}</select></label>
          <p><strong>Seguro por padrão:</strong> “Somente referência” nunca envia o conteúdo à IA. “Leia em voz alta” libera apenas seções identificadas. “Documento liberado” exige revisão do mestre.</p>
          <button type="submit"><i class="fa-solid fa-file-arrow-up"></i> Importar</button>
        </form>

        <section class="mestre-orc-adventure-documents">
          <h3>Documentos indexados</h3>
          ${documentsHtml(snapshot)}
        </section>

        <form class="mestre-orc-adventure-search">
          <label>Pesquisar na aventura<input name="query" maxlength="500" placeholder="Ex.: anjo triste, porta de cobre, contrabandistas"></label>
          <label class="checkbox"><input name="safeOnly" type="checkbox"> Mostrar apenas trechos seguros</label>
          <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Pesquisar</button>
        </form>
        <section data-adventure-results class="mestre-orc-adventure-results"><p class="mestre-orc-adventure-empty">Digite uma busca para consultar o material.</p></section>
      </section>
    </div>`;
}

export function closeAdventureLibraryPanel() {
  document.getElementById(ADVENTURE_PANEL_ID)?.remove();
}

async function refreshPanel(request) {
  return openAdventureLibraryPanel({ request });
}

function bindPanel(panel, request) {
  panel.addEventListener('click', async (event) => {
    const actionButton = event.target instanceof Element ? event.target.closest('[data-adventure-action]') : null;
    if (!actionButton) return;
    const action = actionButton.dataset.adventureAction;
    if (action === 'close') return closeAdventureLibraryPanel();
    if (action === 'delete') {
      const documentElement = actionButton.closest('[data-document-id]');
      const documentId = documentElement?.dataset.documentId;
      if (!documentId) return;
      const confirmed = await Dialog.confirm({
        title: 'Remover documento',
        content: '<p>O índice e todos os trechos deste documento serão removidos.</p>'
      });
      if (!confirmed) return;
      actionButton.disabled = true;
      try {
        await request(`/v1/adventure-library/${encodeURIComponent(campaignId())}/${encodeURIComponent(documentId)}`, { method: 'DELETE' });
        ui.notifications?.info?.('Mestre Orc: documento removido.');
        await refreshPanel(request);
      } catch (error) {
        actionButton.disabled = false;
        ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
      }
    }
  });

  panel.addEventListener('change', async (event) => {
    const select = event.target instanceof HTMLSelectElement && event.target.matches('[data-adventure-mode]') ? event.target : null;
    if (!select) return;
    const documentId = select.closest('[data-document-id]')?.dataset.documentId;
    if (!documentId) return;
    select.disabled = true;
    try {
      await request(`/v1/adventure-library/${encodeURIComponent(campaignId())}/${encodeURIComponent(documentId)}/mode`, {
        method: 'POST',
        body: JSON.stringify({ mode: select.value })
      });
      ui.notifications?.info?.('Mestre Orc: proteção do documento atualizada.');
      await refreshPanel(request);
    } catch (error) {
      select.disabled = false;
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });

  const importForm = panel.querySelector('.mestre-orc-adventure-import');
  importForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = importForm.elements.file?.files?.[0];
    if (!file) return ui.notifications?.warn?.('Mestre Orc: selecione um arquivo.');
    const submit = importForm.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Importando...';
    try {
      const contentBase64 = await fileToBase64(file);
      const result = await request(`/v1/adventure-library/${encodeURIComponent(campaignId())}/import`, {
        method: 'POST',
        body: JSON.stringify({
          fileName: file.name,
          title: String(importForm.elements.title?.value ?? '').trim(),
          mimeType: file.type || '',
          mode: importForm.elements.mode?.value || 'REFERENCE_ONLY',
          contentBase64
        })
      });
      ui.notifications?.info?.(result.duplicate
        ? 'Mestre Orc: este documento já estava importado.'
        : `Mestre Orc: ${result.document?.chunkCount ?? 0} trechos indexados.`);
      await refreshPanel(request);
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-file-arrow-up"></i> Importar';
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });

  const searchForm = panel.querySelector('.mestre-orc-adventure-search');
  searchForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = String(searchForm.elements.query?.value ?? '').trim();
    if (!query) return;
    const resultsContainer = panel.querySelector('[data-adventure-results]');
    resultsContainer.innerHTML = '<p class="mestre-orc-adventure-empty"><i class="fa-solid fa-spinner fa-spin"></i> Pesquisando...</p>';
    try {
      const safeOnly = Boolean(searchForm.elements.safeOnly?.checked);
      const response = await request(`/v1/adventure-library/${encodeURIComponent(campaignId())}/search?q=${encodeURIComponent(query)}&limit=12&safeOnly=${safeOnly}`);
      resultsContainer.innerHTML = searchResultsHtml(response.results ?? []);
    } catch (error) {
      resultsContainer.innerHTML = `<p class="mestre-orc-adventure-empty">${escapeHtml(error.message)}</p>`;
    }
  });
}

export async function openAdventureLibraryPanel({ request }) {
  if (!game.user?.isGM) return;
  try {
    const snapshot = await request(`/v1/adventure-library/${encodeURIComponent(campaignId())}`);
    closeAdventureLibraryPanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml(snapshot));
    const panel = document.getElementById(ADVENTURE_PANEL_ID);
    if (!panel) return;
    bindPanel(panel, request);
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeAdventureLibraryPanel();
    });
  } catch (error) {
    console.error('[Mestre Orc] falha ao abrir biblioteca da aventura', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectAdventureLibraryButton({ root = document, request, findChatContainer }) {
  if (!game.user?.isGM || document.getElementById(ADVENTURE_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = ADVENTURE_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-adventure-library';
  button.innerHTML = '<i class="fa-solid fa-book-open-reader"></i><span>Biblioteca da aventura</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openAdventureLibraryPanel({ request });
  };
  const memoryButton = document.getElementById('mestre-orc-memory');
  if (memoryButton?.parentElement) memoryButton.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
