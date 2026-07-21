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
let roomCheckTimer = null;
let lastPlayerActionAt = 0;
const processedActionMessages = new Set();
const roomNarrationState = {
  active: false,
  sessionId: null,
  narratedRooms: new Set(),
  lastRoomCheck: 0
};

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

function normalizeLabel(value) {
  return normalizeComparableName(value);
}

function labelsRelated(left, right) {
  const a = normalizeLabel(left);
  const b = normalizeLabel(right);
  if (!a || !b) return false;
  const leftNumber = a.match(/\d+/)?.[0] ?? null;
  const rightNumber = b.match(/\d+/)?.[0] ?? null;
  if (leftNumber && rightNumber) return leftNumber === rightNumber;
  return a === b || (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
}

function roomMarkerBounds(marker) {
  const document = marker?.document ?? marker ?? {};
  const gridSize = Number(canvas?.grid?.size ?? game.scenes?.active?.grid?.size ?? 100) || 100;
  const width = Math.max(Number(document.width ?? document.iconSize ?? gridSize) || gridSize, gridSize * 2);
  const height = Math.max(Number(document.height ?? document.iconSize ?? gridSize) || gridSize, gridSize * 2);
  return {
    // Em Foundry, x/y da Note representam o centro do ícone.
    x: Number(document.x ?? 0) - width / 2,
    y: Number(document.y ?? 0) - height / 2,
    width,
    height
  };
}

function tokenCenterPixels(token) {
  const document = token?.document ?? token ?? {};
  const gridSize = Number(canvas?.grid?.size ?? game.scenes?.active?.grid?.size ?? 100) || 100;
  return {
    x: Number(document.x ?? 0) + Number(document.width ?? 1) * gridSize / 2,
    y: Number(document.y ?? 0) + Number(document.height ?? 1) * gridSize / 2
  };
}

function isTokenInsideRoomMarker(token, marker) {
  const point = tokenCenterPixels(token);
  const bounds = roomMarkerBounds(marker);
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

function extractRoomNumberFromMarker(marker) {
  const document = marker?.document ?? marker ?? {};
  const raw = String(document.label ?? document.text ?? document.name ?? '').trim();
  return raw.match(/\d+/)?.[0] ?? null;
}

function extractRoomReadAloud(page, roomLabel) {
  const html = String(page?.text?.content ?? '');
  if (!html) return null;
  const container = document.createElement('div');
  container.innerHTML = html;
  const areas = [...container.querySelectorAll('[data-roll-name-ancestor]')];
  const area = areas.find((element) => labelsRelated(roomLabel, element.dataset?.rollNameAncestor));
  const pageMatchesRoom = labelsRelated(roomLabel, page?.name);
  const readAloud = area?.querySelector('.ve-rd__b-inset--readaloud')
    ?? (pageMatchesRoom ? container.querySelector('.ve-rd__b-inset--readaloud') : null);
  const content = stripHtml(readAloud?.innerHTML ?? '');
  if (!content) return null;
  return {
    content: content.slice(0, 5000),
    areaName: String(area?.dataset?.rollNameAncestor ?? page?.name ?? `Sala ${roomLabel}`).trim(),
    extractionMode: area ? 'STRUCTURED_ROOM_READ_ALOUD' : 'NUMBERED_PAGE_READ_ALOUD'
  };
}

function findJournalSourceForRoom(scene, roomNumber) {
  const candidates = [];
  for (const journal of game.journal?.contents ?? []) {
    const sceneMatch = normalizeComparableName(journal?.name) === normalizeComparableName(scene?.name);
    const sceneRelated = sceneMatch || namesRelated(scene?.name, journal?.name);
    for (const page of journal.pages?.contents ?? []) {
      const extracted = extractRoomReadAloud(page, roomNumber);
      if (!extracted?.content) continue;
      const pageNumber = String(page?.name ?? '').match(/\d+/)?.[0] ?? null;
      const score = (sceneMatch ? 1000 : sceneRelated ? 800 : 0) +
        (pageNumber === roomNumber ? 150 : 0) +
        (namesRelated(scene?.name, page?.name) ? 50 : 0);
      candidates.push({ journal, page, extracted, score });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

function visiblePlayerTokens() {
  const tokens = canvas?.tokens?.placeables ?? [];
  const candidates = tokens.filter((token) => {
    const document = token.document ?? token;
    const actor = document.actor ?? token.actor;
    const ownership = Object.entries(actor?.ownership ?? {}).some(([userId, level]) =>
      userId !== 'default' && Number(level) >= 3 && !game.users?.get?.(userId)?.isGM
    );
    const controlled = Boolean(token.controlled || canvas?.tokens?.controlled?.includes?.(token));
    const playerCharacter = String(actor?.type ?? '').toLowerCase() === 'character';
    return !document.hidden && Boolean(actor) && Boolean(actor?.hasPlayerOwner || ownership || controlled || playerCharacter);
  });
  if (candidates.length) return candidates;
  // Fallback de diagnóstico: permite testar com um token do GM quando não há PC na cena.
  return tokens.filter((token) => {
    const document = token.document ?? token;
    return !document.hidden && Boolean(document.actor ?? token.actor);
  });
}

function findRoomMarkerForToken(token, markers) {
  const point = tokenCenterPixels(token);
  const candidates = markers.filter((marker) => extractRoomNumberFromMarker(marker));
  const ranked = candidates.map((marker) => {
    const document = marker.document ?? marker;
    return {
      marker,
      distance: Math.hypot(point.x - Number(document.x ?? 0), point.y - Number(document.y ?? 0))
    };
  }).sort((left, right) => left.distance - right.distance);

  const containing = candidates.filter((marker) => isTokenInsideRoomMarker(token, marker)).sort((left, right) => {
    const a = left.document ?? left;
    const b = right.document ?? right;
    return Math.hypot(point.x - Number(a.x ?? 0), point.y - Number(a.y ?? 0)) -
      Math.hypot(point.x - Number(b.x ?? 0), point.y - Number(b.y ?? 0));
  })[0];
  if (containing) return containing;

  // O marcador numérico é um ponto central, não o contorno da sala. Quando o token
  // está longe do número, use o marcador mais próximo dentro de oito células.
  const gridSize = Number(canvas?.grid?.size ?? game.scenes?.active?.grid?.size ?? 100) || 100;
  return ranked[0]?.distance <= gridSize * 8 ? ranked[0].marker : null;
}

function resetRoomNarrationState() {
  roomNarrationState.active = true;
  roomNarrationState.sessionId = null;
  roomNarrationState.narratedRooms.clear();
  roomNarrationState.lastRoomCheck = 0;
}

async function synchronizeRoomSessionState() {
  if (!game.user?.isGM) return false;
  const status = await request('/v1/session/status').catch(() => null);
  const active = status?.state === 'COLLECTING_ACTIONS' && Boolean(status.sessionId);
  roomNarrationState.active = active;
  roomNarrationState.sessionId = active ? status.sessionId : null;
  if (active) {
    console.info('[Mestre Orc][Room] sessão ativa recuperada automaticamente', {
      sessionId: status.sessionId,
      sceneId: status.sceneId ?? null
    });
    scheduleRoomCheck();
  }
  return active;
}

async function checkRoomTransitions() {
  if (!game.user?.isGM || !roomNarrationState.active || !game.scenes?.active) return;
  const now = Date.now();
  if (now - roomNarrationState.lastRoomCheck < 1000) return;
  roomNarrationState.lastRoomCheck = now;

  const scene = game.scenes.active;
  const tokens = visiblePlayerTokens();
  const roomMarkers = canvas?.notes?.placeables ?? scene.notes?.contents ?? [];
  console.info('[Mestre Orc][Room] verificando transição', {
    sceneId: scene.id,
    playerTokens: tokens.length,
    numberedRooms: roomMarkers.filter((marker) => extractRoomNumberFromMarker(marker)).length,
    sessionId: roomNarrationState.sessionId
  });
  for (const token of tokens) {
    const roomMarker = findRoomMarkerForToken(token, roomMarkers);
    if (!roomMarker) continue;
    const roomNumber = extractRoomNumberFromMarker(roomMarker);
    if (!roomNumber) continue;
    const roomKey = `${scene.id}:room-${roomNumber}`;
    if (roomNarrationState.narratedRooms.has(roomKey)) continue;

    const journalSource = findJournalSourceForRoom(scene, roomNumber);
    if (!journalSource) {
      console.warn('[Mestre Orc][Room] sala numerada sem seção correspondente no Journal', {
        roomNumber,
        scene: scene.name
      });
      continue;
    }
    const { journal, page, extracted } = journalSource;
    const roomName = extracted.areaName || `Sala ${roomNumber}`;

    const visibleActors = visiblePlayerTokens()
      .filter((entry) => entry.document?.actor ?? entry.actor)
      .map((entry) => serializeActor(entry.document?.actor ?? entry.actor));
    const snapshot = {
      room: { id: roomKey, name: roomName },
      source: {
        canonicalAnchor: true,
        text: extracted.content,
        type: 'ROOM_READ_ALOUD',
        extractionMode: extracted.extractionMode
      },
      scene: { id: scene.id, name: scene.name, description: stripHtml(scene.description ?? '') },
      campaign: { worldId: game.world?.id ?? '', title: game.world?.title ?? '' },
      visibleActors
    };

    try {
      const result = await request('/v1/session/room-entry', { method: 'POST', body: JSON.stringify(snapshot) });
      roomNarrationState.narratedRooms.add(roomKey);
      await ChatMessage.create({ speaker: { alias: 'Mestre Orc' }, content: narrationHtml(result.opening) });
      publishNarrationAudio(result.audio, result.opening, scene.id);
      console.info('[Mestre Orc][Room] transição narrada', {
        roomNumber,
        roomName,
        journal: journal.name,
        page: page.name
      });
    } catch (error) {
      console.error('[Mestre Orc][Room] falha ao narrar transição', { roomKey, error });
      ui.notifications?.warn?.(`Mestre Orc: não foi possível narrar a sala ${roomNumber}.`);
    }
    break;
  }
}

function scheduleRoomCheck() {
  if (!roomNarrationState.active || !game.user?.isGM) return;
  clearTimeout(roomCheckTimer);
  const wait = Math.max(0, 1000 - (Date.now() - roomNarrationState.lastRoomCheck));
  roomCheckTimer = setTimeout(() => void checkRoomTransitions(), wait);
}

function installRoomTracking() {
  Hooks.on('updateToken', () => {
    // Executa somente no cliente do GM, independentemente de quem moveu o token.
    if (!game.user?.isGM) return;
    scheduleRoomCheck();
  });
  Hooks.on('createToken', scheduleRoomCheck);
  Hooks.on('deleteToken', scheduleRoomCheck);
  Hooks.on('updateNote', scheduleRoomCheck);
  Hooks.on('renderScene', scheduleRoomCheck);
  Hooks.on('canvasReady', scheduleRoomCheck);
  Hooks.on('onConflictResolution', scheduleRoomCheck);
}

async function ensureSessionActive() {
  if (!roomNarrationState.active) return false;
  try {
    const status = await request('/v1/session/status');
    return status?.state === 'COLLECTING_ACTIONS';
  } catch {
    return false;
  }
}

function messageAuthorIsGm(message) {
  const user = message?.user ?? game.users?.get?.(message?.userId ?? message?.author?.id);
  return Boolean(user?.isGM);
}

async function processPlayerActionMessage(message) {
  if (!game.user?.isGM || !roomNarrationState.active || !message) return;
  const messageId = String(message.id ?? message._id ?? '');
  if (messageId && processedActionMessages.has(messageId)) return;
  if (message.speaker?.alias === 'Mestre Orc' || messageAuthorIsGm(message)) return;
  const content = stripHtml(message.content ?? '').trim();
  if (content.length < 2 || content.startsWith('/')) return;

  const now = Date.now();
  if (now - lastPlayerActionAt < 500) return;
  if (!await ensureSessionActive()) return;
  lastPlayerActionAt = Date.now();
  if (messageId) {
    processedActionMessages.add(messageId);
    if (processedActionMessages.size > 250) processedActionMessages.delete(processedActionMessages.values().next().value);
  }

  try {
    const result = await request('/v1/session/action', {
      method: 'POST',
      body: JSON.stringify({
        content,
        actorId: message.speaker?.actor ?? message.speaker?.token ?? message.speaker?.id ?? null
      })
    });
    if (!result?.narration) return;
    await ChatMessage.create({ speaker: { alias: 'Mestre Orc' }, content: narrationHtml(result.narration) });
    publishNarrationAudio(result.audio, result.narration, game.scenes?.active?.id ?? null);
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao processar ação`, error);
    ui.notifications?.warn?.('Mestre Orc: não foi possível processar a ação do jogador.');
  }
}

function installPlayerActionHook() {
  if (document.documentElement.dataset.mestreOrcActionHook === '1') return;
  document.documentElement.dataset.mestreOrcActionHook = '1';

  // Hook confiável no cliente do GM para mensagens criadas por qualquer jogador.
  Hooks.on('createChatMessage', (message) => void processPlayerActionMessage(message));

  // Compatibilidade com instalações que encaminham o hook de composição ao GM.
  Hooks.on('chatMessage', (_chatLog, rawMessage, chatData = {}) => {
    if (typeof rawMessage !== 'string') return;
    void processPlayerActionMessage({
      content: rawMessage,
      speaker: chatData.speaker ?? {},
      user: game.user
    });
  });
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
      button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Verificando sessão...</span>';
    }

    const currentStatus = await request('/v1/session/status').catch(() => null);
    if (currentStatus?.state === 'COLLECTING_ACTIONS' && currentStatus.sessionId) {
      resetRoomNarrationState();
      roomNarrationState.sessionId = currentStatus.sessionId;
      if (button) button.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Sessão reconectada</span>';
      ui.notifications.info('Mestre Orc: sessão existente reconectada.');
      void checkRoomTransitions();
      setTimeout(() => {
        if (button?.isConnected) { button.innerHTML = original; button.disabled = false; }
        startInFlight = false;
      }, 1800);
      return;
    }

    if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Lendo a cena ativa...</span>';
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
    roomNarrationState.sessionId = result.sessionId ?? null;
    void checkRoomTransitions();
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
  installRoomTracking();
  installPlayerActionHook();
  if (supportsSpeechSynthesis()) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoices);
  }
});
Hooks.once('ready', () => {
  installAudioSocket();
  scheduleInjection(document);
  void synchronizeRoomSessionState();
});
Hooks.on('renderChatLog', (_app, html) => scheduleInjection(asElement(html) ?? document));
Hooks.on('renderSidebarTab', (app, html) => {
  const tabName = app?.tabName ?? app?.options?.id ?? '';
  if (String(tabName).toLowerCase().includes('chat')) scheduleInjection(asElement(html) ?? document);
});
