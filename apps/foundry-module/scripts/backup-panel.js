export const BACKUP_BUTTON_ID = 'mestre-orc-backups';
export const BACKUP_PANEL_ID = 'mestre-orc-backup-panel';

function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML;
  if (escape) return escape(String(value ?? ''));
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function campaignId() { return String(game.world?.id ?? 'default'); }
function requester() { return { id: String(game.user?.id ?? ''), name: String(game.user?.name ?? 'Mestre'), isGM: Boolean(game.user?.isGM) }; }
function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'data desconhecida' : date.toLocaleString('pt-BR');
}
function listPath() {
  const user = requester();
  const query = new URLSearchParams({ requesterId: user.id, requesterName: user.name, isGM: String(user.isGM) });
  return `/v1/backups/${encodeURIComponent(campaignId())}?${query}`;
}
function backupCard(entry) {
  return `<article class="mestre-orc-backup-card" data-backup-id="${escapeHtml(entry.id)}">
    <header><div><span>${entry.automatic ? 'Snapshot automático' : entry.encrypted ? 'Backup criptografado' : 'Backup local'}</span><h3>${escapeHtml(entry.label || 'Backup')}</h3></div><i class="fa-solid ${entry.encrypted ? 'fa-lock' : 'fa-box-archive'}"></i></header>
    <p>${formatDate(entry.createdAt)} · ${formatBytes(entry.bytes)} · ${Number(entry.itemCount) || 0} registro(s)</p>
    <small>Engine ${escapeHtml(entry.engineVersion || 'desconhecida')} · ${Number(entry.sourceCount) || 0} fonte(s)</small>
    <footer>
      <button type="button" data-backup-action="export" data-backup-id="${escapeHtml(entry.id)}"><i class="fa-solid fa-download"></i> Exportar</button>
      <button type="button" data-backup-action="delete" data-backup-id="${escapeHtml(entry.id)}" class="danger"><i class="fa-solid fa-trash"></i> Excluir</button>
    </footer>
  </article>`;
}
function panelHtml(data) {
  const backups = data?.backups ?? [];
  return `<div id="${BACKUP_PANEL_ID}" class="mestre-orc-backup-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-backup-title">
    <section class="mestre-orc-backup-panel">
      <header class="mestre-orc-backup-header">
        <div><span>Marco 12 · integridade e recuperação</span><h2 id="mestre-orc-backup-title">Backup da campanha</h2><p>Exporte, valide e restaure os dados persistentes do Mestre Orc. Nenhuma restauração ocorre sem inspeção e confirmação.</p></div>
        <button type="button" data-backup-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
      </header>
      <main>
        <section class="mestre-orc-backup-actions">
          <form data-backup-form="create">
            <h3><i class="fa-solid fa-floppy-disk"></i> Criar snapshot</h3>
            <label>Identificação<input name="label" maxlength="200" placeholder="Ex.: antes da sessão 18"></label>
            <label>Senha opcional<input name="passphrase" type="password" maxlength="500" autocomplete="new-password" placeholder="Criptografa o arquivo com AES-256-GCM"></label>
            <button type="submit" class="primary"><i class="fa-solid fa-shield-halved"></i> Criar backup</button>
          </form>
          <form data-backup-form="import">
            <h3><i class="fa-solid fa-file-import"></i> Inspecionar arquivo</h3>
            <label>Arquivo .mobackup<input name="file" type="file" accept=".mobackup,application/json" required></label>
            <label>Senha do arquivo<input name="passphrase" type="password" maxlength="500" autocomplete="current-password"></label>
            <label class="mestre-orc-backup-check"><input name="allowCampaignRemap" type="checkbox"> Permitir restauração de outro worldId nesta campanha</label>
            <button type="submit"><i class="fa-solid fa-magnifying-glass"></i> Validar antes de restaurar</button>
          </form>
        </section>
        <section data-backup-preview class="mestre-orc-backup-preview" hidden></section>
        <section class="mestre-orc-backup-toolbar"><div><strong>${backups.length}</strong> backup(s) armazenado(s)</div><button type="button" data-backup-action="refresh"><i class="fa-solid fa-rotate"></i> Atualizar</button></section>
        <section class="mestre-orc-backup-list">${backups.length ? backups.map(backupCard).join('') : '<div class="mestre-orc-backup-empty"><i class="fa-solid fa-box-open"></i><p>Nenhum backup armazenado para esta campanha.</p></div>'}</section>
      </main>
      <footer class="mestre-orc-backup-policy"><i class="fa-solid fa-circle-info"></i><span>A restauração cria automaticamente um snapshot de segurança. Chaves de API e credenciais não entram no backup.</span></footer>
    </section>
  </div>`;
}
async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return btoa(binary);
}
function downloadBase64(contentBase64, fileName) {
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = fileName || `mestre-orc-${campaignId()}.mobackup`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function previewHtml(preview, restoreToken) {
  const manifest = (preview.manifest ?? []).map((entry) => `<li><span>${escapeHtml(entry.label || entry.id)}</span><b>${Number(entry.count) || 0}</b></li>`).join('');
  return `<header><div><span>Arquivo validado</span><h3>${escapeHtml(preview.label || 'Backup')}</h3></div><i class="fa-solid fa-circle-check"></i></header>
    <p>Origem: <strong>${escapeHtml(preview.sourceCampaignId)}</strong> → destino: <strong>${escapeHtml(preview.targetCampaignId)}</strong>${preview.remapped ? ' · remapeação autorizada' : ''}</p>
    <p>${formatDate(preview.createdAt)} · Engine ${escapeHtml(preview.engineVersion || 'desconhecida')} · ${preview.encrypted ? 'criptografado' : 'não criptografado'}</p>
    <ul>${manifest}</ul>
    <div class="mestre-orc-backup-restore-actions">
      <button type="button" data-backup-action="restore-merge" data-restore-token="${escapeHtml(restoreToken)}"><i class="fa-solid fa-code-merge"></i> Mesclar dados</button>
      <button type="button" data-backup-action="restore-replace" data-restore-token="${escapeHtml(restoreToken)}" class="danger"><i class="fa-solid fa-triangle-exclamation"></i> Substituir dados</button>
    </div>`;
}
async function loadPanel(request) { return request(listPath()); }
async function refreshPanel({ request }) {
  const current = document.getElementById(BACKUP_PANEL_ID);
  if (!current) return;
  const data = await loadPanel(request);
  const replacement = document.createElement('div'); replacement.innerHTML = panelHtml(data);
  current.replaceWith(replacement.firstElementChild);
  bindPanel({ request });
}
async function restoreBackup({ request, token, mode }) {
  const phrase = mode === 'REPLACE'
    ? 'A substituição remove do destino os registros que não existem no backup. Digite RESTAURAR para confirmar:'
    : 'A mesclagem mantém os dados atuais e aplica os registros do backup. Digite MESCLAR para confirmar:';
  const expected = mode === 'REPLACE' ? 'RESTAURAR' : 'MESCLAR';
  if (globalThis.prompt?.(phrase) !== expected) return;
  const result = await request(`/v1/backups/${encodeURIComponent(campaignId())}/restore`, {
    method: 'POST', body: JSON.stringify({ requester: requester(), restoreToken: token, mode })
  });
  ui.notifications?.info?.(`Mestre Orc: restauração ${mode === 'REPLACE' ? 'por substituição' : 'por mesclagem'} concluída. Snapshot automático: ${result.automaticBackup?.label ?? 'criado'}.`);
}
function bindPanel({ request }) {
  const panel = document.getElementById(BACKUP_PANEL_ID);
  if (!panel) return;
  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-backup-action]');
    if (!button) return;
    const action = button.dataset.backupAction;
    if (action === 'close') return panel.remove();
    if (action === 'refresh') return refreshPanel({ request });
    button.disabled = true;
    try {
      if (action === 'export') {
        const result = await request(`/v1/backups/${encodeURIComponent(campaignId())}/${encodeURIComponent(button.dataset.backupId)}/export`, { method: 'POST', body: JSON.stringify({ requester: requester() }) });
        downloadBase64(result.contentBase64, result.backup?.fileName);
      } else if (action === 'delete') {
        if (!globalThis.confirm?.('Excluir este arquivo de backup armazenado no servidor?')) return;
        await request(`/v1/backups/${encodeURIComponent(campaignId())}/${encodeURIComponent(button.dataset.backupId)}`, { method: 'DELETE', body: JSON.stringify({ requester: requester() }) });
        ui.notifications?.info?.('Mestre Orc: backup excluído.');
        await refreshPanel({ request });
      } else if (action === 'restore-merge' || action === 'restore-replace') {
        await restoreBackup({ request, token: button.dataset.restoreToken, mode: action === 'restore-replace' ? 'REPLACE' : 'MERGE' });
        await refreshPanel({ request });
      }
    } catch (error) { ui.notifications?.error?.(`Mestre Orc: ${error.message}`); }
    finally { button.disabled = false; }
  });
  panel.querySelector('[data-backup-form="create"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
    try {
      const values = new FormData(form);
      const result = await request(`/v1/backups/${encodeURIComponent(campaignId())}`, { method: 'POST', body: JSON.stringify({ requester: requester(), label: values.get('label'), passphrase: values.get('passphrase') }) });
      ui.notifications?.info?.(`Mestre Orc: backup criado — ${result.backup.label}.`);
      await refreshPanel({ request });
    } catch (error) { ui.notifications?.error?.(`Mestre Orc: ${error.message}`); }
    finally { submit.disabled = false; }
  });
  panel.querySelector('[data-backup-form="import"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget; const submit = form.querySelector('button[type="submit"]'); submit.disabled = true;
    try {
      const values = new FormData(form); const file = values.get('file');
      if (!(file instanceof File) || !file.size) throw new Error('Selecione um arquivo .mobackup.');
      const result = await request(`/v1/backups/${encodeURIComponent(campaignId())}/inspect`, { method: 'POST', body: JSON.stringify({ requester: requester(), contentBase64: await fileToBase64(file), passphrase: values.get('passphrase'), allowCampaignRemap: values.get('allowCampaignRemap') === 'on' }) });
      const preview = panel.querySelector('[data-backup-preview]');
      preview.hidden = false; preview.innerHTML = previewHtml(result.preview, result.restoreToken); preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (error) { ui.notifications?.error?.(`Mestre Orc: ${error.message}`); }
    finally { submit.disabled = false; }
  });
}
export async function openBackupPanel({ request }) {
  if (!game.user?.isGM) return ui.notifications?.warn?.('Mestre Orc: somente o mestre pode administrar backups.');
  document.getElementById(BACKUP_PANEL_ID)?.remove();
  try {
    const wrapper = document.createElement('div'); wrapper.innerHTML = panelHtml(await loadPanel(request)); document.body.append(wrapper.firstElementChild); bindPanel({ request });
  } catch (error) { ui.notifications?.error?.(`Mestre Orc: ${error.message}`); }
}
export function injectBackupButton({ root = document, request, findChatContainer } = {}) {
  if (!game.user?.isGM || document.getElementById(BACKUP_BUTTON_ID)) return false;
  const chat = findChatContainer?.(root) ?? document.querySelector('#chat');
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = BACKUP_BUTTON_ID; button.type = 'button'; button.dataset.mestreOrcAction = 'open-backups';
  button.innerHTML = '<i class="fa-solid fa-box-archive"></i><span>Backup da campanha</span>';
  button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); void openBackupPanel({ request }); };
  const anchor = document.getElementById('mestre-orc-automations') ?? document.getElementById('mestre-orc-tutors');
  if (anchor?.parentElement) anchor.insertAdjacentElement('afterend', button); else chat.prepend(button);
  return true;
}
