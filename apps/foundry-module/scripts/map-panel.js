export const MAP_BUTTON_ID = 'mestre-orc-maps';
export const MAP_PANEL_ID = 'mestre-orc-map-panel';

const STYLE_LABELS = {
  DUNGEON: 'Masmorra',
  CAVE: 'Caverna',
  CRYPT: 'Cripta',
  TEMPLE: 'Templo',
  SEWER: 'Esgoto',
  FORTRESS: 'Fortaleza',
  FOREST: 'Floresta',
  CITY: 'Cidade',
  GENERAL: 'Geral'
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function campaignId() {
  return String(game.world?.id ?? 'default');
}

function safeFileName(value) {
  return String(value ?? 'mapa')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'mapa';
}

function svgPreviewUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(String(svg ?? ''))}`;
}

function styleOptions(selected = 'DUNGEON') {
  return Object.entries(STYLE_LABELS)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`)
    .join('');
}

function dungeonOptions(artifacts = []) {
  const dungeons = artifacts.filter((entry) => entry.type === 'DUNGEON');
  return [
    '<option value="">Descrição direta (sem dungeon vinculada)</option>',
    ...dungeons.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.title)} · ${escapeHtml(entry.status === 'ACTIVE' ? 'ativo' : 'arquivado')}</option>`)
  ].join('');
}

function statusLabel(status) {
  if (status === 'SCENE_CREATED') return 'Scene criada';
  if (status === 'READY') return 'Pronto';
  return 'Rascunho';
}

function mapCards(snapshot) {
  const maps = Array.isArray(snapshot?.blueprints) ? snapshot.blueprints : [];
  if (!maps.length) return '<p class="mestre-orc-map-empty">Nenhuma planta gerada nesta campanha.</p>';
  return maps.map((map) => `
    <article class="mestre-orc-map-card" data-map-id="${escapeHtml(map.id)}">
      <header>
        <div><span>${escapeHtml(STYLE_LABELS[map.style] ?? map.style)}</span><strong>${escapeHtml(map.title)}</strong></div>
        <em class="${String(map.status).toLowerCase()}">${escapeHtml(statusLabel(map.status))}</em>
      </header>
      <p>${escapeHtml(map.summary)}</p>
      <dl>
        <div><dt>Áreas</dt><dd>${Number(map.rooms?.length) || 0}</dd></div>
        <div><dt>Portas</dt><dd>${Number(map.doors?.length) || 0}</dd></div>
        <div><dt>Luzes</dt><dd>${Number(map.lights?.length) || 0}</dd></div>
        <div><dt>Grade</dt><dd>${Number(map.dimensions?.columns) || 0}×${Number(map.dimensions?.rows) || 0}</dd></div>
      </dl>
      ${map.scene?.id ? `<small>Vinculado à Scene “${escapeHtml(map.scene.name)}”</small>` : `<small>Planta ${Number(map.sequence) || 1} · ${new Date(map.createdAt).toLocaleString('pt-BR')}</small>`}
      <footer>
        <button type="button" data-map-action="preview"><i class="fa-solid fa-eye"></i> Visualizar</button>
        ${map.scene?.id
          ? '<button type="button" data-map-action="open-scene"><i class="fa-solid fa-map-location-dot"></i> Abrir Scene</button>'
          : '<button type="button" data-map-action="create-scene"><i class="fa-solid fa-layer-group"></i> Criar Scene</button>'}
        <button type="button" data-map-action="delete" class="danger"><i class="fa-solid fa-trash"></i> Excluir planta</button>
      </footer>
    </article>`).join('');
}

function panelHtml(snapshot, generatorSnapshot) {
  const counts = snapshot?.counts ?? {};
  return `
    <div id="${MAP_PANEL_ID}" class="mestre-orc-map-overlay" role="dialog" aria-modal="true" aria-label="Mapas e Scenes">
      <section class="mestre-orc-map-panel">
        <header>
          <div>
            <span class="eyebrow">Marco 9</span>
            <h2><i class="fa-solid fa-map"></i> Mapas e Scenes</h2>
            <p>Gere uma planta vetorial e transforme-a em Scene editável com grade, paredes, portas, luzes, Journal e Notes numeradas.</p>
          </div>
          <button type="button" data-map-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="mestre-orc-map-stats">
          <div><strong>${Number(snapshot?.count) || 0}</strong><span>plantas</span></div>
          <div><strong>${Number(counts.READY) || 0}</strong><span>prontas</span></div>
          <div><strong>${Number(counts.SCENE_CREATED) || 0}</strong><span>Scenes</span></div>
        </div>
        <div class="mestre-orc-map-layout">
          <form class="mestre-orc-map-form">
            <h3>Nova planta</h3>
            <label>Dungeon de origem
              <select name="sourceArtifactId">${dungeonOptions(generatorSnapshot?.artifacts ?? [])}</select>
            </label>
            <label>Título opcional
              <input name="title" type="text" maxlength="300" placeholder="Cripta sob o mosteiro">
            </label>
            <div class="mestre-orc-map-form-grid">
              <label>Estilo
                <select name="style">${styleOptions()}</select>
              </label>
              <label>Áreas
                <input name="roomCount" type="number" min="2" max="80" value="8">
              </label>
              <label>Tamanho da grade
                <select name="gridSize"><option value="70">70 px</option><option value="100" selected>100 px</option><option value="140">140 px</option></select>
              </label>
            </div>
            <label>Descrição e restrições
              <textarea name="prompt" maxlength="4000" rows="7" placeholder="Mapa subterrâneo com entrada discreta, salão ritual, rota alternativa e objetivo final. Evite corredores lineares."></textarea>
            </label>
            <button type="submit"><i class="fa-solid fa-compass-drafting"></i> Gerar planta</button>
            <aside>
              <strong>Criação segura</strong>
              <p>Nenhuma Scene é criada automaticamente. Revise a planta e use “Criar Scene” quando estiver pronta. O mapa continua totalmente editável no Foundry.</p>
            </aside>
          </form>
          <section class="mestre-orc-map-archive">
            <div class="mestre-orc-map-archive-heading"><h3>Arquivo de plantas</h3><button type="button" data-map-action="refresh"><i class="fa-solid fa-rotate"></i></button></div>
            <div class="mestre-orc-map-list">${mapCards(snapshot)}</div>
          </section>
        </div>
      </section>
    </div>`;
}

export function closeMapPanel() {
  document.getElementById(MAP_PANEL_ID)?.remove();
  document.querySelector('.mestre-orc-map-preview-overlay')?.remove();
}

function previewHtml(map) {
  const roomRows = (map.rooms ?? []).map((room) => `
    <tr><td>${Number(room.number) || ''}</td><td><strong>${escapeHtml(room.label)}</strong><small>${escapeHtml(room.kind)}</small></td><td>${escapeHtml(room.light)}</td><td>${escapeHtml(room.description || 'Sem descrição')}</td></tr>`).join('');
  return `
    <div class="mestre-orc-map-preview-overlay" role="dialog" aria-modal="true">
      <section class="mestre-orc-map-preview">
        <header><div><span>${escapeHtml(STYLE_LABELS[map.style] ?? map.style)}</span><h3>${escapeHtml(map.title)}</h3></div><button type="button" data-map-preview-close><i class="fa-solid fa-xmark"></i></button></header>
        <div class="mestre-orc-map-preview-grid">
          <figure><img src="${svgPreviewUrl(map.svg)}" alt="Prévia vetorial de ${escapeHtml(map.title)}"><figcaption>${Number(map.dimensions?.columns) || 0} × ${Number(map.dimensions?.rows) || 0} células · ${Number(map.grid?.size) || 100}px</figcaption></figure>
          <div><p>${escapeHtml(map.summary)}</p><table><thead><tr><th>#</th><th>Área</th><th>Luz</th><th>Descrição</th></tr></thead><tbody>${roomRows}</tbody></table></div>
        </div>
      </section>
    </div>`;
}

function foundryConstant(path, fallback) {
  let current = globalThis.CONST;
  for (const part of path.split('.')) current = current?.[part];
  return current ?? fallback;
}

function wallDocuments(map) {
  const size = Number(map.grid?.size) || 100;
  const normal = foundryConstant('WALL_SENSE_TYPES.NORMAL', 1);
  const none = foundryConstant('WALL_DOOR_TYPES.NONE', 0);
  const door = foundryConstant('WALL_DOOR_TYPES.DOOR', 1);
  const secret = foundryConstant('WALL_DOOR_TYPES.SECRET', 2);
  const closed = foundryConstant('WALL_DOOR_STATES.CLOSED', 1);
  const locked = foundryConstant('WALL_DOOR_STATES.LOCKED', 2);
  const walls = (map.walls ?? []).map((entry) => ({
    c: [entry.x1 * size, entry.y1 * size, entry.x2 * size, entry.y2 * size],
    move: normal,
    sight: normal,
    light: normal,
    sound: normal,
    door: none,
    ds: closed,
    flags: { 'mestre-orc': { mapId: map.id, roomId: entry.roomId, kind: 'wall' } }
  }));
  const doors = (map.doors ?? []).map((entry) => ({
    c: [entry.x1 * size, entry.y1 * size, entry.x2 * size, entry.y2 * size],
    move: normal,
    sight: normal,
    light: normal,
    sound: normal,
    door: entry.type === 'SECRET' ? secret : door,
    ds: entry.locked ? locked : closed,
    flags: { 'mestre-orc': { mapId: map.id, roomId: entry.roomId, connectionId: entry.connectionId, kind: 'door' } }
  }));
  return [...walls, ...doors];
}

function lightDocuments(map) {
  const size = Number(map.grid?.size) || 100;
  return (map.lights ?? []).map((entry) => ({
    x: entry.x * size,
    y: entry.y * size,
    config: {
      bright: Number(entry.bright) * size,
      dim: Number(entry.dim) * size,
      color: entry.color,
      alpha: Number(entry.alpha) || 0.5,
      animation: { type: 'torch', speed: 2, intensity: 2, reverse: false }
    },
    hidden: false,
    flags: { 'mestre-orc': { mapId: map.id, roomId: entry.roomId } }
  }));
}

function journalPageData(map) {
  return (map.rooms ?? []).map((room) => ({
    name: `${Number(room.number) || ''}. ${room.label}`,
    type: 'text',
    text: {
      format: 1,
      content: [
        `<h1>${escapeHtml(room.label)}</h1>`,
        `<p>${escapeHtml(room.description || 'Área gerada pelo Mestre Orc.')}</p>`,
        room.readAloud ? `<h2>Leia em voz alta</h2><blockquote>${escapeHtml(room.readAloud)}</blockquote>` : '',
        room.secret ? `<h2>Segredo do mestre</h2><section class="secret">${escapeHtml(room.secret)}</section>` : ''
      ].join('')
    },
    flags: { 'mestre-orc': { mapId: map.id, roomId: room.id, roomNumber: room.number } }
  }));
}

async function uploadSvg(map) {
  const folder = `mestre-orc/maps/${safeFileName(game.world?.id ?? 'world')}`;
  const fileName = `${safeFileName(map.title)}-${String(map.id).slice(0, 8)}.svg`;
  if (!globalThis.FilePicker?.upload || typeof File !== 'function') {
    return { path: svgPreviewUrl(map.svg), mode: 'data-url' };
  }
  const segments = folder.split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try { await FilePicker.createDirectory('data', current, { notify: false }); } catch { /* já existe */ }
  }
  const file = new File([map.svg], fileName, { type: 'image/svg+xml' });
  const uploaded = await FilePicker.upload('data', folder, file, {}, { notify: false });
  const path = uploaded?.path ?? uploaded?.files?.[0] ?? null;
  if (!path) throw new Error('O Foundry não retornou o caminho do SVG enviado.');
  return { path, mode: 'upload' };
}

async function createJournal(map) {
  const existing = game.journal?.find?.((entry) => entry.getFlag?.('mestre-orc', 'mapId') === map.id);
  if (existing) return existing;
  const JournalClass = globalThis.JournalEntry ?? globalThis.CONFIG?.JournalEntry?.documentClass;
  if (!JournalClass?.create) throw new Error('A API de Journal do Foundry não está disponível.');
  return JournalClass.create({
    name: `Mapa — ${map.title}`,
    pages: journalPageData(map),
    ownership: { default: 0 },
    flags: { 'mestre-orc': { mapId: map.id, generated: true } }
  });
}

function noteDocuments(map, journal) {
  const size = Number(map.grid?.size) || 100;
  const pageByRoom = new Map((journal?.pages?.contents ?? []).map((page) => [page.getFlag?.('mestre-orc', 'roomId'), page]));
  return (map.notes ?? []).map((entry) => ({
    entryId: journal?.id,
    pageId: pageByRoom.get(entry.roomId)?.id ?? null,
    x: entry.x * size,
    y: entry.y * size,
    icon: 'icons/svg/book.svg',
    iconSize: Math.max(40, size * 0.55),
    text: String(entry.number),
    global: false,
    flags: { 'mestre-orc': { mapId: map.id, roomId: entry.roomId, roomNumber: entry.number } }
  }));
}

export async function createFoundrySceneFromBlueprint(map) {
  if (!game.user?.isGM) throw new Error('Somente o mestre pode criar Scenes.');
  const existing = game.scenes?.find?.((scene) => scene.getFlag?.('mestre-orc', 'mapId') === map.id);
  if (existing) return { scene: existing, journal: game.journal?.get?.(existing.getFlag?.('mestre-orc', 'journalId')), backgroundPath: existing.background?.src ?? null, existing: true };

  const upload = await uploadSvg(map);
  const journal = await createJournal(map);
  let scene = null;
  try {
    const SceneClass = globalThis.Scene ?? globalThis.CONFIG?.Scene?.documentClass;
    if (!SceneClass?.create) throw new Error('A API de Scene do Foundry não está disponível.');
    scene = await SceneClass.create({
      name: map.title,
      width: Number(map.dimensions?.width) || 4000,
      height: Number(map.dimensions?.height) || 3000,
      padding: 0,
      background: { src: upload.path },
      grid: {
        type: Number(map.grid?.type) || 1,
        size: Number(map.grid?.size) || 100,
        distance: Number(map.grid?.distance) || 5,
        units: map.grid?.units || 'ft'
      },
      tokenVision: true,
      fogExploration: true,
      globalLight: false,
      darkness: 0.75,
      initial: {
        x: (map.spawnPoints?.[0]?.x ?? 1) * (Number(map.grid?.size) || 100),
        y: (map.spawnPoints?.[0]?.y ?? 1) * (Number(map.grid?.size) || 100),
        scale: 1
      },
      flags: {
        'mestre-orc': {
          mapId: map.id,
          journalId: journal?.id ?? null,
          generated: true,
          sourceArtifactId: map.source?.artifactId ?? null,
          spawnPoints: map.spawnPoints ?? []
        }
      }
    });
    const walls = wallDocuments(map);
    if (walls.length) await scene.createEmbeddedDocuments('Wall', walls);
    const lights = lightDocuments(map);
    if (lights.length) await scene.createEmbeddedDocuments('AmbientLight', lights);
    const notes = noteDocuments(map, journal).filter((entry) => entry.entryId);
    if (notes.length) await scene.createEmbeddedDocuments('Note', notes);
    return { scene, journal, backgroundPath: upload.path, existing: false };
  } catch (error) {
    if (scene?.delete) await scene.delete().catch(() => {});
    throw error;
  }
}


async function confirmPlantDeletion() {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) {
    return DialogV2.confirm({
      window: { title: 'Excluir planta' },
      content: '<p>Excluir a planta do arquivo? A Scene já criada, o SVG enviado e o Journal não serão apagados.</p>',
      yes: { label: 'Excluir planta', icon: 'fa-solid fa-trash' },
      no: { label: 'Cancelar' },
      modal: true
    });
  }
  if (globalThis.Dialog?.confirm) {
    return globalThis.Dialog.confirm({
      title: 'Excluir planta',
      content: '<p>Excluir a planta do arquivo? A Scene já criada, o SVG enviado e o Journal não serão apagados.</p>'
    });
  }
  return globalThis.window?.confirm?.('Excluir a planta do arquivo? A Scene, o SVG e o Journal já criados não serão apagados.') ?? false;
}

async function refreshPanel(request) {
  const [snapshot, generators] = await Promise.all([
    request(`/v1/maps/${encodeURIComponent(campaignId())}`),
    request(`/v1/generators/${encodeURIComponent(campaignId())}?type=DUNGEON`).catch(() => ({ artifacts: [] }))
  ]);
  const current = document.getElementById(MAP_PANEL_ID);
  if (!current) return;
  const replacement = document.createElement('div');
  replacement.innerHTML = panelHtml(snapshot, generators);
  const next = replacement.firstElementChild;
  current.replaceWith(next);
  bindPanel(next, request);
}

async function loadMap(request, mapId) {
  const result = await request(`/v1/maps/${encodeURIComponent(campaignId())}/${encodeURIComponent(mapId)}`);
  return result.blueprint;
}

function bindPanel(panel, request) {
  panel.querySelector('[data-map-action="close"]')?.addEventListener('click', closeMapPanel);
  panel.querySelector('[data-map-action="refresh"]')?.addEventListener('click', () => void refreshPanel(request));
  panel.addEventListener('click', async (event) => {
    if (event.target === panel) return closeMapPanel();
    const button = event.target instanceof Element ? event.target.closest('[data-map-action]') : null;
    const card = button?.closest('[data-map-id]');
    if (!button || !card) return;
    const mapId = card.dataset.mapId;
    const action = button.dataset.mapAction;
    button.disabled = true;
    try {
      if (action === 'preview') {
        const map = await loadMap(request, mapId);
        document.body.insertAdjacentHTML('beforeend', previewHtml(map));
        document.querySelector('.mestre-orc-map-preview-overlay [data-map-preview-close]')?.addEventListener('click', () => document.querySelector('.mestre-orc-map-preview-overlay')?.remove());
        document.querySelector('.mestre-orc-map-preview-overlay')?.addEventListener('click', (previewEvent) => {
          if (previewEvent.target === previewEvent.currentTarget) previewEvent.currentTarget.remove();
        });
      } else if (action === 'create-scene') {
        const map = await loadMap(request, mapId);
        const created = await createFoundrySceneFromBlueprint(map);
        await request(`/v1/maps/${encodeURIComponent(campaignId())}/${encodeURIComponent(mapId)}/scene-created`, {
          method: 'POST',
          body: JSON.stringify({
            id: created.scene.id,
            name: created.scene.name,
            backgroundPath: created.backgroundPath,
            journalId: created.journal?.id ?? null
          })
        });
        ui.notifications?.info?.(created.existing
          ? `Mestre Orc: a Scene “${created.scene.name}” já existia e foi vinculada novamente.`
          : `Mestre Orc: Scene “${created.scene.name}” criada com paredes, portas, luzes e áreas numeradas.`);
        await created.scene.activate?.();
        await refreshPanel(request);
      } else if (action === 'open-scene') {
        const map = await loadMap(request, mapId);
        const scene = game.scenes?.get?.(map.scene?.id);
        if (!scene) throw new Error('A Scene vinculada não existe mais neste mundo.');
        await scene.activate?.();
      } else if (action === 'delete') {
        const confirmed = await confirmPlantDeletion();
        if (!confirmed) return;
        await request(`/v1/maps/${encodeURIComponent(campaignId())}/${encodeURIComponent(mapId)}`, { method: 'DELETE' });
        ui.notifications?.info?.('Mestre Orc: planta removida do arquivo.');
        await refreshPanel(request);
      }
    } catch (error) {
      console.error('[Mestre Orc][Maps] ação falhou', { action, error });
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
      button.disabled = false;
    }
  });

  const form = panel.querySelector('.mestre-orc-map-form');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Planejando mapa...';
    try {
      const sourceArtifactId = String(form.elements.sourceArtifactId.value ?? '').trim() || null;
      const prompt = String(form.elements.prompt.value ?? '').trim() || null;
      if (!sourceArtifactId && !prompt) throw new Error('Selecione uma dungeon ou descreva o mapa desejado.');
      const result = await request(`/v1/maps/${encodeURIComponent(campaignId())}/generate`, {
        method: 'POST',
        body: JSON.stringify({
          sourceArtifactId,
          title: String(form.elements.title.value ?? '').trim() || null,
          prompt,
          style: form.elements.style.value,
          roomCount: Number(form.elements.roomCount.value) || 8,
          gridSize: Number(form.elements.gridSize.value) || 100
        })
      });
      ui.notifications?.info?.(`Mestre Orc: planta “${result.blueprint?.title ?? 'mapa'}” gerada${result.fallback ? ' pelo layout procedural seguro' : ' com planejamento da IA'}.`);
      await refreshPanel(request);
    } catch (error) {
      submit.disabled = false;
      submit.innerHTML = '<i class="fa-solid fa-compass-drafting"></i> Gerar planta';
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });
}

export async function openMapPanel({ request }) {
  if (!game.user?.isGM) return;
  try {
    const [snapshot, generators] = await Promise.all([
      request(`/v1/maps/${encodeURIComponent(campaignId())}`),
      request(`/v1/generators/${encodeURIComponent(campaignId())}?type=DUNGEON`).catch(() => ({ artifacts: [] }))
    ]);
    closeMapPanel();
    document.body.insertAdjacentHTML('beforeend', panelHtml(snapshot, generators));
    const panel = document.getElementById(MAP_PANEL_ID);
    if (panel) bindPanel(panel, request);
  } catch (error) {
    console.error('[Mestre Orc][Maps] falha ao abrir painel', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

export function injectMapButton({ root = document, request, findChatContainer }) {
  if (!game.user?.isGM || document.getElementById(MAP_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  const button = document.createElement('button');
  button.id = MAP_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-maps';
  button.innerHTML = '<i class="fa-solid fa-map"></i><span>Mapas e Scenes</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openMapPanel({ request });
  };
  const generatorButton = document.getElementById('mestre-orc-generators');
  if (generatorButton?.parentElement) generatorButton.insertAdjacentElement('afterend', button);
  else chat.prepend(button);
  return true;
}
