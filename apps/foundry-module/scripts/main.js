const MODULE_ID = 'mestre-orc';
const BUTTON_ID = 'mestre-orc-start';
const AUDIO_BUTTON_ID = 'mestre-orc-audio-toggle';
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const API_URL = 'http://localhost:3001';
let startInFlight = false;
let lastAudioDirectiveId = null;
let speechVoices = [];
let activeUtterance = null;
let latestAudioDirective = null;

function asElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function findChatContainer(root = document) {
  return root.querySelector?.('#chat') || root.querySelector?.('[data-tab="chat"]') ||
    root.querySelector?.('.chat-sidebar') || document.querySelector('#chat') ||
    document.querySelector('[data-tab="chat"]') || document.querySelector('.chat-sidebar');
}



function registerAudioSettings() {
  game.settings.register(MODULE_ID, 'audioEnabled', {
    name: 'Ativar narração em áudio',
    hint: 'Reproduz localmente as narrações do Mestre Orc usando a voz disponível no navegador.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshAudioToggleButton()
  });
  game.settings.register(MODULE_ID, 'audioBroadcast', {
    name: 'Transmitir áudio para os jogadores',
    hint: 'Quando o mestre inicia uma narração, envia o texto aos clientes para reprodução local sincronizada.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    restricted: true
  });
  game.settings.register(MODULE_ID, 'audioVoice', {
    name: 'Nome da voz TTS',
    hint: 'Nome exato de uma voz instalada no navegador. Vazio seleciona automaticamente uma voz em português.',
    scope: 'client',
    config: true,
    type: String,
    default: ''
  });
  game.settings.register(MODULE_ID, 'audioRate', {
    name: 'Velocidade da voz',
    scope: 'client',
    config: true,
    type: Number,
    default: 0.9,
    range: { min: 0.5, max: 1.5, step: 0.05 }
  });
  game.settings.register(MODULE_ID, 'audioPitch', {
    name: 'Tom da voz',
    scope: 'client',
    config: true,
    type: Number,
    default: 0.85,
    range: { min: 0, max: 2, step: 0.05 }
  });
  game.settings.register(MODULE_ID, 'audioVolume', {
    name: 'Volume da narração',
    scope: 'client',
    config: true,
    type: Number,
    default: 1,
    range: { min: 0, max: 1, step: 0.05 }
  });
}

function audioSetting(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function supportsSpeechSynthesis() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function refreshSpeechVoices() {
  if (!supportsSpeechSynthesis()) return [];
  speechVoices = window.speechSynthesis.getVoices?.() ?? [];
  return speechVoices;
}

function selectSpeechVoice(language = 'pt-BR') {
  const voices = speechVoices.length ? speechVoices : refreshSpeechVoices();
  const configured = String(audioSetting('audioVoice', '')).trim().toLowerCase();
  if (configured) {
    const exact = voices.find((voice) => String(voice.name ?? '').trim().toLowerCase() === configured);
    if (exact) return exact;
  }

  const normalizedLanguage = String(language || 'pt-BR').toLowerCase();
  return voices.find((voice) => String(voice.lang ?? '').toLowerCase() === normalizedLanguage)
    ?? voices.find((voice) => String(voice.lang ?? '').toLowerCase().startsWith('pt-br'))
    ?? voices.find((voice) => String(voice.lang ?? '').toLowerCase().startsWith('pt'))
    ?? voices.find((voice) => voice.default)
    ?? null;
}

function normalizeSpeechText(value) {
  return stripHtml(String(value ?? ''))
    .replace(/\[Modo[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stopNarrationAudio() {
  if (!supportsSpeechSynthesis()) return;
  window.speechSynthesis.cancel();
  activeUtterance = null;
}

function speakAudioDirective(directive, { force = false } = {}) {
  if (!directive || directive.mode !== 'browser-tts') return false;
  if (!force && !audioSetting('audioEnabled', true)) return false;
  if (!supportsSpeechSynthesis()) {
    console.warn('[Mestre Orc][Audio] SpeechSynthesis não está disponível neste navegador.');
    return false;
  }

  const id = String(directive.id ?? '');
  if (id && id === lastAudioDirectiveId) return false;
  const text = normalizeSpeechText(directive.text);
  if (!text) return false;

  lastAudioDirectiveId = id || crypto.randomUUID();
  stopNarrationAudio();

  const utterance = new SpeechSynthesisUtterance(text);
  activeUtterance = utterance;
  utterance.lang = String(directive.language ?? 'pt-BR');
  utterance.rate = Number(audioSetting('audioRate', directive.rate ?? 0.9));
  utterance.pitch = Number(audioSetting('audioPitch', directive.pitch ?? 0.85));
  utterance.volume = Number(audioSetting('audioVolume', directive.volume ?? 1));
  const voice = selectSpeechVoice(utterance.lang);
  if (voice) utterance.voice = voice;

  utterance.onstart = () => console.log('[Mestre Orc][Audio] reprodução iniciada', {
    id: lastAudioDirectiveId,
    voice: utterance.voice?.name ?? 'padrão do navegador',
    language: utterance.lang
  });
  utterance.onend = () => {
    if (activeUtterance === utterance) activeUtterance = null;
  };
  utterance.onerror = (event) => {
    if (event.error === 'interrupted' || event.error === 'canceled') return;
    if (activeUtterance === utterance) activeUtterance = null;
    console.error('[Mestre Orc][Audio] falha na reprodução', event.error ?? event);
    ui.notifications?.warn?.('Mestre Orc: não foi possível reproduzir a narração em áudio neste navegador.');
  };

  window.speechSynthesis.speak(utterance);
  return true;
}

function buildAudioDirective(audio, fallbackText, sceneId = null) {
  const source = audio && typeof audio === 'object' ? audio : {};
  return {
    id: source.id ?? crypto.randomUUID(),
    mode: source.mode ?? 'browser-tts',
    text: source.text ?? fallbackText ?? '',
    language: source.language ?? 'pt-BR',
    rate: source.rate ?? 0.9,
    pitch: source.pitch ?? 0.85,
    volume: source.volume ?? 1,
    sceneId: source.sceneId ?? sceneId ?? null,
    sessionId: source.sessionId ?? null
  };
}

function publishNarrationAudio(audio, fallbackText, sceneId = null) {
  const directive = buildAudioDirective(audio, fallbackText, sceneId);
  latestAudioDirective = directive;
  speakAudioDirective(directive);

  if (game.user?.isGM && audioSetting('audioBroadcast', true)) {
    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: 'narration-audio',
      senderId: game.user.id,
      audio: directive
    });
  }
  return directive;
}

function installAudioSocket() {
  game.socket?.on?.(SOCKET_CHANNEL, (payload) => {
    if (payload?.type !== 'narration-audio' || !payload.audio) return;
    if (payload.senderId && payload.senderId === game.user?.id) return;
    latestAudioDirective = payload.audio;
    speakAudioDirective(payload.audio);
  });
}

function refreshAudioToggleButton() {
  const button = document.getElementById(AUDIO_BUTTON_ID);
  if (!button) return;
  const enabled = Boolean(audioSetting('audioEnabled', true));
  button.dataset.enabled = String(enabled);
  button.innerHTML = enabled
    ? '<i class="fa-solid fa-volume-high" aria-hidden="true"></i><span>Áudio ligado</span>'
    : '<i class="fa-solid fa-volume-xmark" aria-hidden="true"></i><span>Áudio desligado</span>';
  button.title = enabled ? 'Desativar narração em áudio neste navegador' : 'Ativar narração em áudio neste navegador';
}

function injectAudioToggleButton(root = document) {
  if (document.getElementById(AUDIO_BUTTON_ID)) {
    refreshAudioToggleButton();
    return true;
  }
  const chat = findChatContainer(root);
  if (!chat) return false;

  const button = document.createElement('button');
  button.id = AUDIO_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'toggle-audio';
  button.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const next = !Boolean(audioSetting('audioEnabled', true));
    await game.settings.set(MODULE_ID, 'audioEnabled', next);
    if (!next) stopNarrationAudio();
    if (next && latestAudioDirective) {
      lastAudioDirectiveId = null;
      speakAudioDirective(latestAudioDirective, { force: true });
    }
    refreshAudioToggleButton();
    ui.notifications.info(`Mestre Orc: áudio ${next ? 'ativado' : 'desativado'} neste navegador.`);
  };
  refreshAudioToggleButton();

  const startButton = document.getElementById(BUTTON_ID);
  const chatForm = chat.querySelector('#chat-form, .chat-form, form.chat-form');
  if (startButton?.parentElement) startButton.insertAdjacentElement('afterend', button);
  else if (chatForm?.parentElement) chatForm.parentElement.insertBefore(button, chatForm);
  else chat.prepend(button);
  refreshAudioToggleButton();
  return true;
}

function stripHtml(value) {
  const element = document.createElement('div');
  element.innerHTML = String(value ?? '');
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeSceneName(value) {
  return String(value ?? '')
    .replace(/\s*\((player|gm|jogador|mestre)\s*version\)\s*$/i, '')
    .replace(/\s*[-–—]\s*(player|gm|jogador|mestre)\s*$/i, '')
    .trim().toLowerCase();
}

function journalPageContent(page) {
  if (!page) return '';
  return stripHtml(page.text?.content ?? page.text?.markdown ?? '');
}

function normalizeComparableName(value) {
  return normalizeSceneName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();
}

function namesRelated(left, right) {
  const a = normalizeComparableName(left);
  const b = normalizeComparableName(right);
  if (!a || !b) return false;
  return a === b || (a.length >= 5 && b.includes(a)) || (b.length >= 5 && a.includes(b));
}

function findFlagValues(value, path = [], results = []) {
  if (value == null || path.length > 8) return results;
  if (typeof value === 'string') {
    const key = path.join('.').toLowerCase();
    if (/(journal|entry|page)/.test(key) && value.trim()) results.push({ key, value: value.trim() });
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findFlagValues(item, [...path, String(index)], results));
    return results;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) findFlagValues(child, [...path, key], results);
  }
  return results;
}

async function resolveJournalReferenceCandidate(candidate) {
  const value = candidate?.value;
  if (!value) return null;

  if (/^(JournalEntry|JournalEntryPage)\./.test(value)) {
    const document = await fromUuid(value).catch(() => null);
    if (document?.documentName === 'JournalEntryPage') return { journal: document.parent, page: document };
    if (document?.documentName === 'JournalEntry') return { journal: document, page: null };
  }

  const page = game.journal?.contents
    ?.flatMap((journal) => journal.pages?.contents ?? [])
    ?.find((entry) => entry.id === value || entry.uuid === value);
  if (page) return { journal: page.parent, page };

  const journal = game.journal?.get(value) ?? game.journal?.contents?.find((entry) => entry.uuid === value);
  if (journal) return { journal, page: null };
  return null;
}


function findJournalDirectlyByScene(scene) {
  const journals = game.journal?.contents ?? [];
  const target = normalizeComparableName(scene?.name);
  if (!target) return null;

  const exact = journals.find((journal) => normalizeComparableName(journal?.name) === target);
  const related = exact ?? journals.find((journal) => namesRelated(scene?.name, journal?.name));
  if (!related) return null;

  const pages = related.pages?.contents ?? [];
  const page = pages.find((entry) => Boolean(extractStructuredReadAloud(entry, scene?.name)))
    ?? pages.find((entry) => namesRelated(scene?.name, entry?.name) && Boolean(extractFirstReadAloud(entry)))
    ?? pages.find((entry) => Boolean(extractFirstReadAloud(entry)))
    ?? null;

  console.log('[Mestre Orc] Journal localizado diretamente no diretório', {
    scene: scene?.name ?? null,
    journal: related.name,
    page: page?.name ?? null,
    exactName: Boolean(exact)
  });

  return {
    journal: related,
    page,
    explicit: true,
    source: exact ? 'journal-directory-exact' : 'journal-directory-related'
  };
}

async function findConfiguredSceneJournalReference(scene) {
  const rawScene = typeof scene?.toObject === 'function' ? scene.toObject() : scene?._source ?? {};
  const candidates = [
    ...findFlagValues(scene.flags ?? {}),
    ...findFlagValues(rawScene ?? {})
  ];
  candidates.sort((left, right) => {
    const score = (candidate) => /page/.test(candidate.key) ? 20 : /journal/.test(candidate.key) ? 10 : 0;
    return score(right) - score(left);
  });

  for (const candidate of candidates) {
    const resolved = await resolveJournalReferenceCandidate(candidate);
    if (resolved?.journal) {
      console.log('[Mestre Orc] vínculo de Journal encontrado nas flags da Scene', candidate.key, candidate.value);
      return { ...resolved, explicit: true, source: `scene.flags.${candidate.key}` };
    }
  }
  return null;
}


function pageContainsSceneSection(page, sceneName) {
  const html = String(page?.text?.content ?? '');
  if (!html) return false;
  const container = document.createElement('div');
  container.innerHTML = html;
  return Boolean(findStructuredSceneSection(container, sceneName));
}

function findPageContainingSceneSection(journal, sceneName) {
  return (journal?.pages?.contents ?? []).find((page) => pageContainsSceneSection(page, sceneName)) ?? null;
}

function findStructuredSceneSection(container, sceneName) {
  const expected = normalizeComparableName(sceneName);
  const candidates = [...container.querySelectorAll('[data-roll-name-ancestor]')];
  return candidates.find((element) =>
    normalizeComparableName(element.dataset?.rollNameAncestor) === expected
  ) ?? candidates.find((element) => namesRelated(sceneName, element.dataset?.rollNameAncestor));
}

function findStartingArea(sceneSection) {
  const candidates = [...sceneSection.querySelectorAll('[data-roll-name-ancestor]')]
    .filter((element) => element !== sceneSection);
  return candidates.find((element) => /^1\.\s+/.test(String(element.dataset?.rollNameAncestor ?? '').trim()))
    ?? candidates.find((element) => /^\d+\.\s+/.test(String(element.dataset?.rollNameAncestor ?? '').trim()))
    ?? null;
}

function extractStructuredReadAloud(page, sceneName) {
  const html = String(page?.text?.content ?? '');
  if (!html) return null;

  const container = document.createElement('div');
  container.innerHTML = html;
  const sceneSection = findStructuredSceneSection(container, sceneName);
  if (!sceneSection) return null;

  const startingArea = findStartingArea(sceneSection);
  if (!startingArea) return null;

  const readAloud = startingArea.querySelector('.ve-rd__b-inset--readaloud');
  const content = stripHtml(readAloud?.innerHTML ?? '');
  if (!content) return null;

  return {
    content: content.slice(0, 5000),
    sceneSectionName: String(sceneSection.dataset?.rollNameAncestor ?? '').trim(),
    areaName: String(startingArea.dataset?.rollNameAncestor ?? '').trim(),
    extractionMode: 'STRUCTURED_READ_ALOUD'
  };
}


function extractFirstReadAloud(page) {
  const html = String(page?.text?.content ?? '');
  if (!html) return null;

  const container = document.createElement('div');
  container.innerHTML = html;
  const readAloud = container.querySelector('.ve-rd__b-inset--readaloud');
  const content = stripHtml(readAloud?.innerHTML ?? '');
  if (!content) return null;

  const area = readAloud.closest?.('[data-roll-name-ancestor]');
  return {
    content: content.slice(0, 5000),
    sceneSectionName: null,
    areaName: String(area?.dataset?.rollNameAncestor ?? page?.name ?? '').trim() || null,
    extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
  };
}

function extractSceneSectionFromPage(page, sceneName) {
  // Regra de segurança: somente caixas read-aloud podem alimentar a abertura.
  // Nunca converta cabeçalhos, texto plano ou a página inteira em narração.
  return extractStructuredReadAloud(page, sceneName) ?? extractFirstReadAloud(page);
}

async function findSceneJournalReference(scene) {
  const direct = findJournalDirectlyByScene(scene);
  if (direct) return direct;

  const configured = await findConfiguredSceneJournalReference(scene);
  if (configured) return configured;

  const linkedUuid = scene.getFlag?.(MODULE_ID, 'journalUuid');
  if (linkedUuid) {
    const linked = await fromUuid(linkedUuid).catch(() => null);
    if (linked?.documentName === 'JournalEntryPage') return { journal: linked.parent, page: linked, explicit: true, source: 'mestre-orc flag' };
    if (linked?.documentName === 'JournalEntry') return { journal: linked, page: null, explicit: true, source: 'mestre-orc flag' };
  }

  for (const note of scene.notes?.contents ?? []) {
    const page = note.page ?? (note.pageId ? await fromUuid(`JournalEntry.${note.entryId}.JournalEntryPage.${note.pageId}`).catch(() => null) : null);
    const journal = page?.parent ?? note.entry ?? (note.entryId ? game.journal?.get(note.entryId) : null);
    if (journal) return { journal, page: page ?? null, explicit: true, source: 'scene note' };
  }

  const journals = game.journal?.contents ?? [];
  const journal = journals.find((entry) => namesRelated(scene.name, entry.name)) ?? null;
  if (!journal) return { journal: null, page: null, explicit: false, source: 'none' };

  const pages = journal.pages?.contents ?? [];
  const page = pages.find((entry) => namesRelated(scene.name, entry.name))
    ?? findPageContainingSceneSection(journal, scene.name)
    ?? null;
  return { journal, page, explicit: false, source: page ? 'content match' : 'name match' };
}

function serializeJournalReference(journal, page, scene, { explicit = false, source = 'unknown' } = {}) {
  if (!journal) return null;
  const resolvedPage = page ?? findPageContainingSceneSection(journal, scene.name);
  if (!page && resolvedPage) {
    console.log('[Mestre Orc] página localizada pelo conteúdo estruturado da Scene', {
      scene: scene.name,
      journal: journal.name,
      page: resolvedPage.name
    });
  }
  const pages = (journal.pages?.contents ?? []).map((entry) => ({
    id: entry.id,
    uuid: entry.uuid,
    name: entry.name,
    content: journalPageContent(entry),
    flags: entry.flags ?? {}
  }));
  const selectedDocument = resolvedPage ?? null;
  const extractedSection = selectedDocument
    ? extractSceneSectionFromPage(selectedDocument, scene.name)
    : null;
  const selectedPage = selectedDocument ? {
    id: selectedDocument.id,
    uuid: selectedDocument.uuid,
    name: selectedDocument.name,
    content: extractedSection?.content ?? '',
    fullPageContentAvailable: Boolean(journalPageContent(selectedDocument)),
    sectionMatchedScene: Boolean(extractedSection?.content),
    sceneSectionName: extractedSection?.sceneSectionName ?? null,
    areaName: extractedSection?.areaName ?? null,
    extractionMode: extractedSection?.extractionMode ?? null,
    flags: selectedDocument.flags ?? {}
  } : null;

  return {
    id: journal.id,
    uuid: journal.uuid,
    name: journal.name,
    flags: journal.flags ?? {},
    explicitLink: Boolean(explicit),
    linkSource: source,
    selectedPage,
    // Conteúdo integral do Journal nunca é enviado ao narrador.
    // Regras e segredos permanecem disponíveis no Foundry, fora do payload de abertura.
    content: ''
  };
}

function serializeActor(actor) {
  return {
    id: actor.id,
    uuid: actor.uuid,
    name: actor.name,
    type: actor.type,
    system: actor.system ?? {},
    flags: actor.flags ?? {}
  };
}

async function collectSnapshot() {
  const scene = game.scenes?.active;
  if (!scene) throw new Error('Ative uma cena antes de iniciar a sessão.');

  const { journal, page, explicit, source } = await findSceneJournalReference(scene);
  const visibleActors = [];
  const seen = new Set();
  for (const token of scene.tokens?.contents ?? []) {
    if (token.hidden || !token.actor || seen.has(token.actor.id)) continue;
    seen.add(token.actor.id);
    visibleActors.push(serializeActor(token.actor));
  }

  const sceneJournal = serializeJournalReference(journal, page, scene, { explicit, source });
  if (!sceneJournal?.selectedPage?.content && !stripHtml(scene.description ?? '')) {
    throw new Error('Journal localizado, mas nenhuma caixa read-aloud segura foi encontrada para a cena ativa.');
  }
  console.log('[Mestre Orc] contexto de abertura coletado', {
    scene: scene.name,
    journal: sceneJournal?.name ?? null,
    page: sceneJournal?.selectedPage?.name ?? null,
    sceneSection: sceneJournal?.selectedPage?.sceneSectionName ?? null,
    area: sceneJournal?.selectedPage?.areaName ?? null,
    extractionMode: sceneJournal?.selectedPage?.extractionMode ?? null,
    contentPreview: sceneJournal?.selectedPage?.content?.slice(0, 180) ?? ''
  });

  return {
    activeScene: {
      id: scene.id,
      uuid: scene.uuid,
      name: scene.name,
      description: stripHtml(scene.getFlag?.(MODULE_ID, 'description') ?? scene.description ?? ''),
      darkness: scene.environment?.darknessLevel ?? scene.darkness ?? 0,
      flags: scene.flags ?? {}
    },
    campaign: {
      worldId: game.world?.id ?? '',
      title: game.world?.title ?? '',
      systemId: game.system?.id ?? '',
      systemVersion: game.system?.version ?? ''
    },
    visibleActors,
    sceneJournal
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `Engine respondeu HTTP ${response.status}.`);
  return payload;
}

function narrationHtml(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${foundry.utils.escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function startSession(button) {
  if (startInFlight) return;
  startInFlight = true;
  console.log('[Mestre Orc] clique recebido: iniciar sessão');
  const original = button?.innerHTML ?? '';
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Lendo a cena ativa...</span>';
    }
    const snapshot = await collectSnapshot();

    if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Gerando abertura...</span>';
    const result = await request('/v1/session/start', {
      method: 'POST',
      body: JSON.stringify({ snapshot })
    });

    await ChatMessage.create({
      speaker: { alias: 'Mestre Orc' },
      content: narrationHtml(result.opening)
    });
    publishNarrationAudio(result.audio, result.opening, snapshot.activeScene?.id ?? null);
    if (button) button.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Sessão iniciada</span>';
    ui.notifications.info('Mestre Orc: abertura publicada no chat.');
    if (button) {
      setTimeout(() => {
        if (button?.isConnected) { button.innerHTML = original; button.disabled = false; }
        startInFlight = false;
      }, 1800);
    } else {
      startInFlight = false;
    }
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao iniciar`, error);
    ui.notifications.error(`Mestre Orc: ${error.message}`);
    if (button?.isConnected) {
      button.innerHTML = original;
      button.disabled = false;
    }
    startInFlight = false;
  }
}

function injectStartButton(root = document) {
  if (!game.user?.isGM || document.getElementById(BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.innerHTML = '<i class="fa-solid fa-hat-wizard" aria-hidden="true"></i><span>Mestre Orc — Iniciar sessão</span>';
  button.dataset.mestreOrcAction = 'start-session';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void startSession(button);
  };
  button.addEventListener('pointerup', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
  });

  const chatForm = chat.querySelector('#chat-form, .chat-form, form.chat-form');
  const chatLog = chat.querySelector('#chat-log, .chat-log, ol.chat-log');
  if (chatForm?.parentElement) chatForm.parentElement.insertBefore(button, chatForm);
  else if (chatLog?.parentElement) chatLog.parentElement.insertBefore(button, chatLog.nextSibling);
  else chat.prepend(button);
  console.log(`${MODULE_ID} | botão de início inserido`);
  return true;
}


function installDelegatedStartHandler() {
  if (document.documentElement.dataset.mestreOrcDelegated === '1') return;
  document.documentElement.dataset.mestreOrcDelegated = '1';

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-mestre-orc-action="start-session"], #mestre-orc-start')
      : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    console.log('[Mestre Orc] handler delegado acionado');
    void startSession(target);
  }, true);
}

function scheduleInjection(root) {
  requestAnimationFrame(() => {
    injectStartButton(root);
    injectAudioToggleButton(root);
    setTimeout(() => { injectStartButton(document); injectAudioToggleButton(document); }, 250);
    setTimeout(() => { injectStartButton(document); injectAudioToggleButton(document); }, 1000);
  });
}


console.log('[Mestre Orc] main.js carregado');

Hooks.on('getSceneControlButtons', (controls) => {
  try {
    if (!game.user?.isGM) return;
    const tokenControls = controls?.tokens;
    if (!tokenControls?.tools) {
      console.warn('[Mestre Orc] controle de tokens indisponível');
      return;
    }

    tokenControls.tools.mestreOrcStart = {
      name: 'mestreOrcStart',
      title: 'Mestre Orc — Iniciar sessão',
      icon: 'fa-solid fa-hat-wizard',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] botão dos controles de cena acionado');
        void startSession(null);
      }
    };

    console.log('[Mestre Orc] botão adicionado aos controles da cena');
  } catch (error) {
    console.error('[Mestre Orc] falha ao registrar controle da cena', error);
  }
});

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | módulo MVP inicializado`);
  registerAudioSettings();
  installDelegatedStartHandler();
  if (supportsSpeechSynthesis()) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoices);
  }
});
Hooks.once('ready', () => {
  installAudioSocket();
  scheduleInjection(document);
});
Hooks.on('renderChatLog', (_app, html) => scheduleInjection(asElement(html) ?? document));
Hooks.on('renderSidebarTab', (app, html) => {
  const tabName = app?.tabName ?? app?.options?.id ?? '';
  if (String(tabName).toLowerCase().includes('chat')) scheduleInjection(asElement(html) ?? document);
});

let roomNarrationState = {
  active: false,
  sessionId: null,
  narratedRooms: new Set(),
  lastRoomCheck: 0,
  lastReportedIds: new Set()
};

function resetRoomNarrationState(sessionId) {
  roomNarrationState = {
    active: true,
    sessionId: sessionId ?? crypto.randomUUID(),
    narratedRooms: new Set(),
    lastRoomCheck: Date.now(),
    lastReportedIds: new Set()
  };
}

function stopRoomNarrationState() {
  roomNarrationState = {
    active: false,
    sessionId: null,
    narratedRooms: new Set(),
    lastRoomCheck: 0,
    lastReportedIds: new Set()
  };
}

function noteBounds(note) {
  const raw = note?.toObject?.() ?? note ?? {};
  return {
    x: Number(raw.x ?? 0),
    y: Number(raw.y ?? 0),
    width: Number(raw.width ?? 0),
    height: Number(raw.height ?? 0)
  };
}

function tokenCenterPixels(token) {
  const raw = token?.toObject?.() ?? token?.document?.toObject?.() ?? token?.document ?? token ?? {};
  const x = Number(raw.x ?? 0);
  const y = Number(raw.y ?? 0);
  const scene = game.scenes?.active;
  const grid = scene?.grid;
  if (!grid) return { px: x, py: y };
  const size = Number(grid.gridSize ?? grid?.squareSize ?? 100);
  const ratio = Number(grid.ratio ?? 1);
  return {
    px: x * size * ratio,
    py: y * size * ratio
  };
}

function isTokenInsideNote(token, note) {
  if (!token || !note) return false;
  const center = tokenCenterPixels(token);
  const bounds = noteBounds(note);
  return center.px >= bounds.x
    && center.px <= bounds.x + bounds.width
    && center.py >= bounds.y
    && center.py <= bounds.y + bounds.height;
}

function findNoteContainingToken(token, notes) {
  if (!token || !notes?.length) return null;
  return notes.find((note) => isTokenInsideNote(token, note)) ?? null;
}

function extractNoteRoomLabel(note) {
  const text = String(note?.text ?? note?.name ?? '').trim();
  if (!text) return null;
  const cleaned = text.replace(/\s*\(player|gm|jogador|mestre\s*version\)\s*$/i, '').trim();
  return cleaned || null;
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/\s*\((player|gm|jogador|mestre)\s*version\)\s*$/i, '')
    .replace(/\s*[-–—]\s*(player|gm|jogador|mestre)\s*$/i, '')
    .trim().toLowerCase();
}

function labelsRelated(left, right) {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return false;
  const numberA = a.match(/\d+/);
  const numberB = b.match(/\d+/);
  if (numberA && numberB) return numberA[0] === numberB[0];
  return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
}

function findJournalPageForNote(note, journal) {
  if (!note || !journal) return null;
  const noteLabel = extractNoteRoomLabel(note);
  if (!noteLabel) return null;

  const pages = journal.pages?.contents ?? [];
  const exact = pages.find((page) => labelsRelated(noteLabel, page.name));
  if (exact) return exact;

  const anyByLabel = pages.find((page) => {
    const content = journalPageContent(page).toLowerCase();
    return content.includes(noteLabel.toLowerCase()) || page.name.toLowerCase().includes(noteLabel.toLowerCase());
  });
  return anyByLabel ?? null;
}

function visiblePlayerTokens() {
  const scene = game.scenes?.active;
  if (!scene) return [];
  const tokens = scene.tokens?.contents ?? [];
  return tokens.filter((token) => !token.hidden && token.actor);
}

async function checkRoomTransitions() {
  const scene = game.scenes?.active;
  if (!scene || !roomNarrationState.active) return;
  const notes = scene.notes?.contents ?? [];
  if (!notes.length) return;

  const journal = game.journal?.contents?.find((entry) => namesRelated(scene.name, entry.name)) ?? null;
  const tokens = visiblePlayerTokens();
  if (!tokens.length) return;

  for (const token of tokens) {
    const note = findNoteContainingToken(token, notes);
    if (!note) continue;
    const roomLabel = extractNoteRoomLabel(note);
    if (!roomLabel) continue;
    const roomKey = `${scene.id}:${normalizeLabel(roomLabel)}`;
    if (roomNarrationState.narratedRooms.has(roomKey)) continue;
    const page = findJournalPageForNote(note, journal);
    if (!page) continue;
    const readAloud = extractStructuredReadAloud(page, scene.name) ?? extractFirstReadAloud(page);
    if (!readAloud?.content) continue;

    const snapshot = {
      activeScene: {
        id: scene.id,
        uuid: scene.uuid,
        name: scene.name,
        description: stripHtml(game.scenes.active.getFlag?.(MODULE_ID, 'description') ?? scene.description ?? ''),
        darkness: scene.environment?.darknessLevel ?? scene.darkness ?? 0,
        flags: scene.flags ?? {}
      },
      campaign: {
        worldId: game.world?.id ?? '',
        title: game.world?.title ?? '',
        systemId: game.system?.id ?? '',
        systemVersion: game.system?.version ?? ''
      },
      visibleActors: tokens.filter((t) => !t.hidden && t.actor && t.id === token.id).map((actor) => serializeActor(token.actor)),
      room: { id: note.id, name: roomLabel },
      source: {
        type: readAloud.extractionMode,
        name: page.name,
        text: readAloud.content.slice(0, 5000),
        canonicalAnchor: true,
        extractionMode: readAloud.extractionMode,
        sceneSectionName: readAloud.sceneSectionName,
        areaName: readAloud.areaName
      }
    };

    try {
      const result = await request('/v1/session/room-entry', {
        method: 'POST',
        body: JSON.stringify(snapshot)
      });
      roomNarrationState.narratedRooms.add(roomKey);
      await ChatMessage.create({
        speaker: { alias: 'Mestre Orc' },
        content: narrationHtml(result.opening)
      });
      publishNarrationAudio(result.audio, result.opening, scene.id);
      ui.notifications.info(`Mestre Orc: ${roomLabel}`);
    } catch (error) {
      console.error(`${MODULE_ID} | falha ao descrever sala`, error);
    }
    break;
  }
}

function scheduleRoomCheck() {
  if (!roomNarrationState.active) return;
  const now = Date.now();
  if (now - roomNarrationState.lastRoomCheck < 1000) return;
  roomNarrationState.lastRoomCheck = now;
  void checkRoomTransitions();
}

function installRoomTracking() {
  if (document.documentElement.dataset.mestreOrcRoomTracking === '1') return;
  document.documentElement.dataset.mestreOrcRoomTracking = '1';

  Hooks.on('updateToken', (_token, options, userId) => {
    if (userId && userId !== game.user?.id) return;
    scheduleRoomCheck();
  });

  Hooks.on('deleteToken', () => scheduleRoomCheck());
  Hooks.on('createToken', () => scheduleRoomCheck());
  Hooks.on('renderScene', () => scheduleRoomCheck());
  Hooks.on('onConflictResolution', () => scheduleRoomCheck());
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | módulo MVP inicializado`);
  registerAudioSettings();
  installDelegatedStartHandler();
  installRoomTracking();
  if (supportsSpeechSynthesis()) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoices);
  }
});

Hooks.once('ready', () => {
  installAudioSocket();
  scheduleInjection(document);
});

Hooks.on('renderChatLog', (_app, html) => scheduleInjection(asElement(html) ?? document));
Hooks.on('renderSidebarTab', (app, html) => {
  const tabName = app?.tabName ?? app?.options?.id ?? '';
  if (String(tabName).toLowerCase().includes('chat')) scheduleInjection(asElement(html) ?? document);
});




const originalStartSession = startSession;
startSession = async function(button) {
  if (startInFlight) return;
  startInFlight = true;
  console.log('[Mestre Orc] clique recebido: iniciar sessão');
  const original = button?.innerHTML ?? '';
  try {
    if (button) {
      button.disabled = true;
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Lendo a cena ativa...</span>';
    }
    const snapshot = await collectSnapshot();
    resetRoomNarrationState();

    if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Gerando abertura...</span>';
    const result = await request('/v1/session/start', {
      method: 'POST',
      body: JSON.stringify({ snapshot })
    });

    await ChatMessage.create({
      speaker: { alias: 'Mestre Orc' },
      content: narrationHtml(result.opening)
    });
    publishNarrationAudio(result.audio, result.opening, snapshot.activeScene?.id ?? null);
    if (button) button.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Sessão iniciada</span>';
    ui.notifications.info('Mestre Orc: abertura publicada no chat.');
    if (button) {
      setTimeout(() => {
        if (button?.isConnected) { button.innerHTML = original; button.disabled = false; }
        startInFlight = false;
      }, 1800);
    } else {
      startInFlight = false;
    }
    void checkRoomTransitions();
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao iniciar`, error);
    ui.notifications.error(`Mestre Orc: ${error.message}`);
    if (button?.isConnected) {
      button.innerHTML = original;
      button.disabled = false;
    }
    startInFlight = false;
  }
};
