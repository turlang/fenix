import {
  READ_ALOUD_SELECTOR,
  extractMarkdownReadAloud
} from './read-aloud.js';
import { RoomTransitionTracker } from './room-transition-state.js';
import {
  actionMessageRejectionReason,
  isSupportedPlayerChatStyle
} from './chat-action-filter.js';
import {
  audioTargetsUser,
  normalizeRecipientUserIds,
  ownerUserIdsForToken
} from './audio-routing.js';
import {
  createTokenPerception,
  visibleTokensFrom
} from './token-vision.js';
import {
  parseCinematicSpeechScript,
  stripCinematicMarkers
} from './cinematic-speech.js';
import {
  normalizeVoiceTranscript,
  speechRecognitionSupported,
  VoiceInputController
} from './voice-input.js';
import {
  combatActionPayloadFromMessage,
  combatSnapshotFromDocument,
  combatSnapshotKey
} from './combat-tracker.js';
import {
  ADVENTURE_BUTTON_ID,
  injectAdventureLibraryButton,
  openAdventureLibraryPanel
} from './adventure-library-panel.js';
import {
  AI_PROVIDER_BUTTON_ID,
  injectAiProviderButton,
  openAiProviderPanel
} from './ai-provider-panel.js';
import {
  VOICE_PROFILE_BUTTON_ID,
  injectVoiceProfileButton,
  openVoiceProfilePanel
} from './voice-profile-panel.js';
import {
  GENERATOR_BUTTON_ID,
  injectGeneratorButton,
  openGeneratorPanel
} from './generator-panel.js';
import {
  MAP_BUTTON_ID,
  injectMapButton,
  openMapPanel
} from './map-panel.js';
import {
  TUTOR_BUTTON_ID,
  injectTutorButton,
  openTutorPanel
} from './tutor-panel.js';

const MODULE_ID = 'mestre-orc';
const MODULE_BUILD = '0.1.0-alpha.46';
const BUTTON_ID = 'mestre-orc-start';
const ROUND_BUTTON_ID = 'mestre-orc-resolve-round';
const AUDIO_BUTTON_ID = 'mestre-orc-audio-toggle';
const VOICE_BUTTON_ID = 'mestre-orc-voice-input';
const VOICE_PREVIEW_ID = 'mestre-orc-voice-preview';
const MEMORY_BUTTON_ID = 'mestre-orc-memory';
const MEMORY_PANEL_ID = 'mestre-orc-memory-panel';
const COMBAT_TURN_BUTTON_ID = 'mestre-orc-combat-turn';
const COMBAT_ROUND_BUTTON_ID = 'mestre-orc-combat-round';
const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const API_URL = 'http://localhost:3001';
let startInFlight = false;
let roundResolveInFlight = false;
let combatTurnResolveInFlight = false;
let combatRoundSummaryInFlight = false;
let lastCombatSnapshot = null;
let combatHookQueue = Promise.resolve();
let lastAudioDirectiveId = null;
let speechVoices = [];
let activeUtterance = null;
let activePauseTimer = null;
let activeNeuralAudio = null;
let activeNeuralObjectUrl = null;
let activeNarrationRun = 0;
let latestAudioDirective = null;
let voiceInputController = null;
let voiceSubmissionInFlight = false;
let latestVoicePreview = '';
let voiceSessionActive = false;
let roomCheckTimer = null;
let roomMonitorTimer = null;
const lastPlayerActionAtByActor = new Map();
const processedActionMessages = new Set();
const recentActionFingerprints = new Map();
const publishedNarrationKeys = new Set();
const recentAudioFingerprints = new Map();
const roomNarrationState = new RoomTransitionTracker();
const ROOM_MONITOR_INTERVAL_MS = 1500;
const AUDIO_DEDUPE_WINDOW_MS = 45000;
const ACTION_DEDUPE_WINDOW_MS = 30000;

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

function applyRoundButtonState(round = null, sessionActive = true) {
  const button = document.getElementById(ROUND_BUTTON_ID);
  if (!button) return;
  const actionCount = Math.max(0, Number(round?.actionCount) || 0);
  const roundNumber = Math.max(1, Number(round?.number) || 1);
  button.dataset.actionCount = String(actionCount);
  button.dataset.roundNumber = String(roundNumber);
  button.disabled = roundResolveInFlight || !sessionActive || actionCount < 1;
  button.innerHTML = roundResolveInFlight
    ? '<i class="fa-solid fa-spinner fa-spin"></i><span>Resolvendo rodada...</span>'
    : `<i class="fa-solid fa-dice-d20"></i><span>Resolver rodada ${roundNumber} (${actionCount})</span>`;
  button.title = actionCount
    ? `${actionCount} declaração(ões) pronta(s) para resolução consolidada.`
    : 'Aguardando declarações dos personagens.';
}

async function refreshRoundButton(round = null) {
  if (!game.user?.isGM) return;
  if (round) {
    applyRoundButtonState(round, Boolean(roomNarrationState.active));
    return;
  }
  const status = await request('/v1/session/status').catch(() => null);
  const active = status?.state === 'COLLECTING_ACTIONS' && Boolean(status.sessionId) && !status?.combat?.active;
  applyRoundButtonState(status?.round ?? null, active);
}


function applyCombatButtonState(combat = null, sessionActive = true) {
  const turnButton = document.getElementById(COMBAT_TURN_BUTTON_ID);
  const roundButton = document.getElementById(COMBAT_ROUND_BUTTON_ID);
  const active = Boolean(sessionActive && combat?.active);
  const turn = combat?.currentTurn ?? null;
  const round = combat?.currentRound ?? null;
  const actorName = combat?.activeCombatant?.name ?? turn?.actorName ?? 'combatente';
  const actionCount = Math.max(0, Number(turn?.actionCount) || 0);
  const roundNumber = Math.max(0, Number(combat?.round) || 0);

  if (turnButton) {
    turnButton.dataset.actionCount = String(actionCount);
    turnButton.disabled = combatTurnResolveInFlight || !active || !turn?.canResolve;
    turnButton.innerHTML = combatTurnResolveInFlight
      ? '<i class="fa-solid fa-spinner fa-spin"></i><span>Narrando turno...</span>'
      : `<i class="fa-solid fa-hand-fist"></i><span>Narrar turno — ${actorName} (${actionCount})</span>`;
    turnButton.title = active
      ? `${actionCount} evento(s) registrado(s) no turno ${Number(combat?.turn) + 1 || 1}.`
      : 'Aguardando um combate ativo no Combat Tracker.';
  }

  if (roundButton) {
    const resolvedTurnCount = Math.max(0, Number(round?.resolvedTurnCount) || 0);
    roundButton.disabled = combatRoundSummaryInFlight || !active || !round?.canSummarize;
    roundButton.innerHTML = combatRoundSummaryInFlight
      ? '<i class="fa-solid fa-spinner fa-spin"></i><span>Resumindo combate...</span>'
      : `<i class="fa-solid fa-shield-halved"></i><span>Resumo da rodada ${roundNumber} (${resolvedTurnCount})</span>`;
    roundButton.title = active
      ? `${resolvedTurnCount} turno(s) resolvido(s) disponíveis para o resumo.`
      : 'Aguardando um combate ativo no Combat Tracker.';
  }
}

async function refreshCombatButtons(combat = null) {
  if (!game.user?.isGM) return;
  if (combat) {
    applyCombatButtonState(combat, Boolean(roomNarrationState.active));
    return;
  }
  const status = await request('/v1/session/status').catch(() => null);
  const sessionActive = status?.state === 'COLLECTING_ACTIONS' && Boolean(status.sessionId);
  applyCombatButtonState(status?.combat ?? null, sessionActive);
  applyRoundButtonState(status?.round ?? null, sessionActive && !status?.combat?.active);
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
  game.settings.register(MODULE_ID, 'voiceInputEnabled', {
    name: 'Ativar entrada por voz',
    hint: 'Exibe o botão Falar ação no chat e usa o reconhecimento de voz disponível no navegador.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshVoiceInputButton()
  });
  game.settings.register(MODULE_ID, 'voiceInputLanguage', {
    name: 'Idioma do reconhecimento de voz',
    hint: 'Código de idioma usado pelo navegador, por exemplo pt-BR, en-US ou es-ES.',
    scope: 'client',
    config: true,
    type: String,
    default: 'pt-BR',
    onChange: (language) => voiceInputController?.setLanguage?.(language)
  });
  game.settings.register(MODULE_ID, 'voiceInputAutoSend', {
    name: 'Enviar transcrição automaticamente',
    hint: 'Quando ativado, publica a ação reconhecida no chat. Quando desativado, apenas preenche o campo de mensagem para revisão.',
    scope: 'client',
    config: true,
    type: Boolean,
    default: true
  });
  game.settings.register(MODULE_ID, 'combatAutoNarrateTurn', {
    name: 'Narrar turno ao avançar o Combat Tracker',
    hint: 'Resolve automaticamente os eventos registrados quando o mestre avança para o próximo combatente.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    restricted: true
  });
  game.settings.register(MODULE_ID, 'combatAutoSummarizeRound', {
    name: 'Resumir rodada de combate automaticamente',
    hint: 'Publica um resumo depois que o Combat Tracker avança para uma nova rodada.',
    scope: 'world',
    config: true,
    type: Boolean,
    default: true,
    restricted: true
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
  return stripCinematicMarkers(stripHtml(String(value ?? '')))
    .replace(/\[Modo[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableTextFingerprint(value) {
  const text = normalizeSpeechText(value).toLocaleLowerCase('pt-BR');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function sharedBrowserStorage() {
  try {
    return globalThis.localStorage ?? globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function claimBrowserPublication(category, key) {
  const normalized = String(key ?? '').trim();
  if (!normalized) return true;
  const storageKey = `${MODULE_ID}:${category}:${normalized}`;
  const storage = sharedBrowserStorage();
  try {
    if (storage?.getItem(storageKey)) return false;
    storage?.setItem(storageKey, String(Date.now()));
  } catch {
    // O Set local continua protegendo quando o armazenamento não está disponível.
  }
  return true;
}

function releaseBrowserPublication(category, key) {
  const normalized = String(key ?? '').trim();
  if (!normalized) return;
  const storage = sharedBrowserStorage();
  try {
    storage?.removeItem(`${MODULE_ID}:${category}:${normalized}`);
  } catch {
    // Nada a liberar quando o armazenamento não está disponível.
  }
}

function audioWasRecentlySpoken(text) {
  const fingerprint = stableTextFingerprint(text);
  const now = Date.now();
  const localTimestamp = recentAudioFingerprints.get(fingerprint) ?? 0;
  let storedTimestamp = 0;
  const storage = sharedBrowserStorage();
  try {
    storedTimestamp = Number(storage?.getItem(`${MODULE_ID}:audio-fingerprint:${fingerprint}`) ?? 0);
  } catch {
    // O cache em memória é suficiente como fallback.
  }
  const lastTimestamp = Math.max(localTimestamp, storedTimestamp);
  if (now - lastTimestamp < AUDIO_DEDUPE_WINDOW_MS) return true;
  recentAudioFingerprints.set(fingerprint, now);
  try {
    storage?.setItem(`${MODULE_ID}:audio-fingerprint:${fingerprint}`, String(now));
  } catch {
    // Ignora indisponibilidade do armazenamento da aba.
  }
  if (recentAudioFingerprints.size > 100) recentAudioFingerprints.delete(recentAudioFingerprints.keys().next().value);
  return false;
}

function stopNarrationAudio() {
  activeNarrationRun += 1;
  if (activePauseTimer) {
    clearTimeout(activePauseTimer);
    activePauseTimer = null;
  }
  if (activeNeuralAudio) {
    activeNeuralAudio.pause?.();
    activeNeuralAudio.src = '';
    activeNeuralAudio = null;
  }
  if (activeNeuralObjectUrl) {
    URL.revokeObjectURL?.(activeNeuralObjectUrl);
    activeNeuralObjectUrl = null;
  }
  if (supportsSpeechSynthesis()) window.speechSynthesis.cancel();
  activeUtterance = null;
}

function speakCinematicSegments(segments, directive, { source = 'unknown' } = {}) {
  const runId = activeNarrationRun;
  const language = String(directive.language ?? 'pt-BR');
  const voice = selectSpeechVoice(language);

  const playNext = (index) => {
    if (runId !== activeNarrationRun) return;
    const segment = segments[index];
    if (!segment) {
      activeUtterance = null;
      activePauseTimer = null;
      return;
    }

    if (segment.type === 'pause') {
      activePauseTimer = setTimeout(() => {
        activePauseTimer = null;
        playNext(index + 1);
      }, Math.max(0, Number(segment.duration) || 0));
      return;
    }

    const utterance = new SpeechSynthesisUtterance(segment.text);
    activeUtterance = utterance;
    utterance.lang = language;
    utterance.rate = segment.rate;
    utterance.pitch = segment.pitch;
    utterance.volume = segment.volume;
    if (voice) utterance.voice = voice;

    utterance.onstart = () => console.log('[Mestre Orc][Audio] trecho expressivo iniciado', {
      id: directive.id ?? null,
      source,
      marker: segment.marker,
      voice: utterance.voice?.name ?? 'padrão do navegador',
      language: utterance.lang,
      rate: utterance.rate,
      pitch: utterance.pitch,
      volume: utterance.volume
    });
    utterance.onend = () => {
      if (runId !== activeNarrationRun) return;
      if (activeUtterance === utterance) activeUtterance = null;
      playNext(index + 1);
    };
    utterance.onerror = (event) => {
      if (event.error === 'interrupted' || event.error === 'canceled') return;
      if (runId !== activeNarrationRun) return;
      if (activeUtterance === utterance) activeUtterance = null;
      console.error('[Mestre Orc][Audio] falha na reprodução expressiva', event.error ?? event);
      ui.notifications?.warn?.('Mestre Orc: não foi possível reproduzir a narração em áudio neste navegador.');
    };

    window.speechSynthesis.speak(utterance);
  };

  playNext(0);
}

function speakBrowserDirectivePrepared(directive, { source = 'unknown' } = {}) {
  if (!supportsSpeechSynthesis()) {
    console.warn('[Mestre Orc][Audio] SpeechSynthesis não está disponível neste navegador.');
    return false;
  }
  const segments = parseCinematicSpeechScript(directive.text, {
    rate: Number(audioSetting('audioRate', directive.rate ?? 0.9)),
    pitch: Number(audioSetting('audioPitch', directive.pitch ?? 0.85)),
    volume: Number(audioSetting('audioVolume', directive.volume ?? 1))
  });
  if (!segments.some((segment) => segment.type === 'speech')) return false;
  console.log('[Mestre Orc][Audio] roteiro expressivo preparado', {
    id: lastAudioDirectiveId,
    source,
    mode: 'browser-tts',
    segments: segments.length,
    pauses: segments.filter((segment) => segment.type === 'pause').length
  });
  speakCinematicSegments(segments, directive, { source });
  return true;
}

function base64AudioBlob(audioBase64, mimeType = 'audio/mpeg') {
  const binary = atob(String(audioBase64 ?? ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

async function speakNeuralDirectivePrepared(directive, { source = 'unknown' } = {}) {
  const runId = activeNarrationRun;
  try {
    const result = await request(directive.synthesisPath || '/v1/audio/synthesize', {
      method: 'POST',
      body: JSON.stringify({
        text: normalizeSpeechText(directive.text),
        campaignId: directive.campaignId || game.world?.id || 'default',
        profileId: directive.profileId || null,
        speakerType: directive.speakerType || 'NARRATOR',
        npcId: directive.npcId || null,
        npcName: directive.npcName || null,
        directiveId: directive.id || null
      })
    });
    if (runId !== activeNarrationRun) return false;
    if (!result?.audioBase64) throw new Error('O servidor não retornou áudio neural.');
    const blob = base64AudioBlob(result.audioBase64, result.mimeType);
    activeNeuralObjectUrl = URL.createObjectURL(blob);
    const audio = new Audio(activeNeuralObjectUrl);
    activeNeuralAudio = audio;
    audio.volume = Math.min(1, Math.max(0, Number(audioSetting('audioVolume', directive.volume ?? 1)) || 1));
    audio.onended = () => {
      if (activeNeuralAudio === audio) activeNeuralAudio = null;
      if (activeNeuralObjectUrl) URL.revokeObjectURL(activeNeuralObjectUrl);
      activeNeuralObjectUrl = null;
    };
    audio.onerror = () => {
      if (activeNeuralAudio === audio) activeNeuralAudio = null;
      if (activeNeuralObjectUrl) URL.revokeObjectURL(activeNeuralObjectUrl);
      activeNeuralObjectUrl = null;
    };
    console.log('[Mestre Orc][Audio] voz neural preparada', {
      id: directive.id ?? null,
      source,
      provider: result.provider,
      model: result.model,
      profileId: result.profile?.id ?? directive.profileId ?? null,
      cached: Boolean(result.cached),
      fallbackUsed: Boolean(result.fallbackUsed),
      aiGenerated: true
    });
    await audio.play();
    return true;
  } catch (error) {
    console.warn('[Mestre Orc][Audio] voz neural indisponível', { id: directive.id ?? null, source, message: error.message });
    if (runId !== activeNarrationRun) return false;
    if (directive.fallbackMode === 'browser-tts' && error.fallbackToBrowser !== false) {
      ui.notifications?.warn?.('Mestre Orc: voz neural indisponível; usando a voz local do navegador.');
      return speakBrowserDirectivePrepared({ ...directive, mode: 'browser-tts' }, { source: `${source}:fallback` });
    }
    ui.notifications?.warn?.('Mestre Orc: não foi possível reproduzir a voz neural e o fallback está desativado.');
    return false;
  }
}

function speakAudioDirective(directive, { force = false, source = 'unknown' } = {}) {
  if (!directive || !['browser-tts', 'neural-auto', 'neural-only'].includes(directive.mode)) return false;
  if (!force && !audioSetting('audioEnabled', true)) return false;

  const id = String(directive.id ?? '');
  if (id && id === lastAudioDirectiveId) return false;
  const fingerprintText = normalizeSpeechText(directive.text);
  if (!fingerprintText) return false;
  if (!force && audioWasRecentlySpoken(fingerprintText)) {
    console.log('[Mestre Orc][Audio] reprodução duplicada bloqueada', { id, source });
    return false;
  }

  lastAudioDirectiveId = id || crypto.randomUUID();
  stopNarrationAudio();
  if (directive.mode === 'browser-tts') return speakBrowserDirectivePrepared(directive, { source });
  void speakNeuralDirectivePrepared(directive, { source });
  return true;
}

function buildAudioDirective(audio, fallbackText, sceneId = null, publicationKey = '', recipientUserIds = null) {
  const source = audio && typeof audio === 'object' ? audio : {};
  const recipients = source.recipientUserIds !== undefined
    ? normalizeRecipientUserIds(source.recipientUserIds)
    : normalizeRecipientUserIds(recipientUserIds);
  return {
    id: source.id ?? crypto.randomUUID(),
    mode: source.mode ?? 'browser-tts',
    fallbackMode: source.fallbackMode ?? ((source.mode ?? 'browser-tts') === 'neural-only' ? null : 'browser-tts'),
    synthesisPath: source.synthesisPath ?? '/v1/audio/synthesize',
    text: source.text ?? fallbackText ?? '',
    language: source.language ?? 'pt-BR',
    rate: source.rate ?? 0.9,
    pitch: source.pitch ?? 0.85,
    volume: source.volume ?? 1,
    sceneId: source.sceneId ?? sceneId ?? null,
    sessionId: source.sessionId ?? null,
    campaignId: source.campaignId ?? game.world?.id ?? null,
    profileId: source.profileId ?? null,
    speakerType: source.speakerType ?? 'NARRATOR',
    npcId: source.npcId ?? null,
    npcName: source.npcName ?? null,
    aiGenerated: Boolean(source.aiGenerated ?? ((source.mode ?? 'browser-tts') !== 'browser-tts')),
    disclosure: source.disclosure ?? null,
    publicationKey: source.publicationKey ?? publicationKey ?? null,
    recipientUserIds: recipients
  };
}

function publishNarrationAudio(audio, fallbackText, sceneId = null, publicationKey = '', recipientUserIds = null) {
  const key = String(publicationKey ?? '').trim();
  const directive = buildAudioDirective(audio, fallbackText, sceneId, key, recipientUserIds);
  const shouldPlayLocally = audioTargetsUser(directive, game.user?.id);
  if (shouldPlayLocally) {
    if (!key || claimBrowserPublication('audio-publication', key)) {
      latestAudioDirective = directive;
      speakAudioDirective(directive, { source: 'local-publish' });
    } else {
      console.log('[Mestre Orc][Audio] diretiva duplicada bloqueada', { key });
    }
  }

  const recipients = normalizeRecipientUserIds(directive.recipientUserIds);
  const hasRecipient = recipients === null || recipients.length > 0;
  if (game.user?.isGM && audioSetting('audioBroadcast', true) && hasRecipient) {
    game.socket?.emit?.(SOCKET_CHANNEL, {
      type: 'narration-audio',
      senderId: game.user.id,
      audio: directive
    });
  }
  return directive;
}

function setVoiceSessionActive(active) {
  voiceSessionActive = Boolean(active);
  refreshVoiceInputButton();
}

function broadcastVoiceSessionStatus(active = roomNarrationState.active, round = null) {
  if (!game.user?.isGM) return;
  setVoiceSessionActive(active);
  game.socket?.emit?.(SOCKET_CHANNEL, {
    type: 'session-status',
    senderId: game.user?.id ?? null,
    active: Boolean(active),
    round
  });
}

function requestVoiceSessionStatus() {
  if (game.user?.isGM) return;
  game.socket?.emit?.(SOCKET_CHANNEL, {
    type: 'session-status-request',
    senderId: game.user?.id ?? null
  });
}

function installAudioSocket() {
  game.socket?.on?.(SOCKET_CHANNEL, (payload) => {
    if (payload?.type === 'session-status-request') {
      if (game.user?.isGM) broadcastVoiceSessionStatus(roomNarrationState.active);
      return;
    }
    if (payload?.type === 'session-status') {
      const sender = game.users?.get?.(payload.senderId);
      if (!sender?.isGM) {
        console.warn('[Mestre Orc][Voice] estado de sessão ignorado por não vir do GM', {
          senderId: payload.senderId ?? null
        });
        return;
      }
      setVoiceSessionActive(payload.active);
      return;
    }
    if (payload?.type !== 'narration-audio' || !payload.audio) return;
    if (payload.senderId && payload.senderId === game.user?.id) return;
    if (!audioTargetsUser(payload.audio, game.user?.id)) {
      console.debug('[Mestre Orc][Audio] diretiva destinada a outro usuário ignorada', {
        publicationKey: payload.audio.publicationKey ?? null
      });
      return;
    }
    const publicationKey = String(payload.audio.publicationKey ?? '').trim();
    if (publicationKey && !claimBrowserPublication('audio-publication', publicationKey)) {
      console.log('[Mestre Orc][Audio] socket duplicado bloqueado', { publicationKey });
      return;
    }
    latestAudioDirective = payload.audio;
    speakAudioDirective(payload.audio, { source: 'socket' });
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

function currentVoiceActorIdentity() {
  const speaker = ChatMessage.getSpeaker?.() ?? {};
  const controlledToken = canvas?.tokens?.controlled?.find?.((token) => token?.actor) ?? null;
  const actorId = String(speaker.actor ?? controlledToken?.actor?.id ?? game.user?.character?.id ?? '').trim();
  const actor = actorId ? game.actors?.get?.(actorId) ?? controlledToken?.actor ?? game.user?.character ?? null : null;
  const tokenId = String(speaker.token ?? controlledToken?.document?.id ?? controlledToken?.id ?? '').trim() || null;
  if (!actor?.id) return null;

  const ownsActor = Boolean(game.user?.isGM || actor.isOwner || actor.testUserPermission?.(game.user, 'OWNER'));
  if (!ownsActor) return null;

  return {
    actor,
    actorId: String(actor.id),
    actorName: String(actor.name ?? speaker.alias ?? game.user?.name ?? 'Personagem'),
    tokenId,
    speaker: {
      ...speaker,
      actor: String(actor.id),
      token: tokenId,
      alias: String(actor.name ?? speaker.alias ?? game.user?.name ?? 'Personagem')
    }
  };
}

function voiceComposerElement() {
  return document.querySelector('#chat-message, #chat-form textarea, .chat-form textarea, textarea[name="message"], [contenteditable="true"][data-placeholder]');
}

function fillVoiceTranscriptInComposer(transcript) {
  const composer = voiceComposerElement();
  if (!composer) return false;
  if ('value' in composer) composer.value = transcript;
  else composer.textContent = transcript;
  composer.dispatchEvent(new Event('input', { bubbles: true }));
  composer.focus?.();
  return true;
}

function setVoicePreview(text = '', { final = false } = {}) {
  latestVoicePreview = normalizeVoiceTranscript(text);
  const preview = document.getElementById(VOICE_PREVIEW_ID);
  if (!preview) return;
  preview.textContent = latestVoicePreview;
  preview.dataset.visible = String(Boolean(latestVoicePreview));
  preview.dataset.final = String(Boolean(final));
}

function refreshVoiceInputButton() {
  const button = document.getElementById(VOICE_BUTTON_ID);
  if (!button) return;
  const enabled = Boolean(audioSetting('voiceInputEnabled', true));
  const supported = speechRecognitionSupported(globalThis);
  const state = voiceInputController?.state ?? (supported ? 'idle' : 'unsupported');
  const processing = state === 'starting' || state === 'processing' || voiceSubmissionInFlight;
  button.dataset.state = voiceSubmissionInFlight ? 'submitting' : state;
  button.dataset.enabled = String(enabled);

  if (!enabled) {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-microphone-slash"></i><span>Entrada por voz desligada</span>';
    button.title = 'Ative a entrada por voz nas configurações do módulo.';
    return;
  }
  if (!supported || state === 'unsupported') {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-microphone-slash"></i><span>Voz indisponível</span>';
    button.title = 'Este navegador não oferece SpeechRecognition. Use Chrome ou Edge atualizado.';
    return;
  }
  if (!voiceSessionActive && state !== 'listening') {
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-microphone-lines-slash"></i><span>Inicie a sessão para falar</span>';
    button.title = 'A entrada por voz só registra ações durante uma sessão ativa do Mestre Orc.';
    return;
  }
  if (state === 'listening') {
    button.disabled = false;
    button.innerHTML = '<i class="fa-solid fa-stop"></i><span>Ouvindo… clique para parar</span>';
    button.title = 'Clique para encerrar a captura e enviar a transcrição.';
    return;
  }
  if (processing) {
    button.disabled = true;
    button.innerHTML = voiceSubmissionInFlight
      ? '<i class="fa-solid fa-spinner fa-spin"></i><span>Enviando ação…</span>'
      : '<i class="fa-solid fa-spinner fa-spin"></i><span>Transcrevendo…</span>';
    button.title = 'Processando a fala reconhecida.';
    return;
  }

  button.disabled = false;
  button.innerHTML = '<i class="fa-solid fa-microphone"></i><span>Falar ação</span>';
  button.title = 'Clique, dite a ação do personagem e clique novamente para parar.';
}

async function submitVoiceTranscript(rawTranscript) {
  const transcript = normalizeVoiceTranscript(rawTranscript);
  if (!transcript) throw new Error('nenhuma fala válida foi reconhecida.');
  const identity = currentVoiceActorIdentity();
  if (!identity) throw new Error('selecione um token próprio ou vincule um personagem ao seu usuário.');

  if (!Boolean(audioSetting('voiceInputAutoSend', true))) {
    if (!fillVoiceTranscriptInComposer(transcript)) throw new Error('o campo de mensagem do chat não foi encontrado.');
    setVoicePreview(transcript, { final: true });
    ui.notifications?.info?.('Mestre Orc: transcrição inserida no chat para revisão.');
    return { queued: false, draft: true, transcript };
  }

  voiceSubmissionInFlight = true;
  refreshVoiceInputButton();
  try {
    const escapeHTML = globalThis.foundry?.utils?.escapeHTML ?? ((value) => String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;'));
    const styles = globalThis.CONST?.CHAT_MESSAGE_STYLES ?? globalThis.CONST?.CHAT_MESSAGE_TYPES ?? {};
    const messageData = {
      speaker: identity.speaker,
      content: `<p>${escapeHTML(transcript)}</p>`,
      flags: {
        [MODULE_ID]: {
          voiceInput: true,
          language: String(audioSetting('voiceInputLanguage', 'pt-BR')),
          capturedAt: Date.now()
        }
      }
    };
    const textStyle = styles.IC ?? styles.OOC;
    if (textStyle != null) messageData.style = textStyle;
    await ChatMessage.create(messageData);
    setVoicePreview(transcript, { final: true });
    ui.notifications?.info?.(`Mestre Orc: ação de ${identity.actorName} reconhecida e enviada.`);
    return { queued: true, draft: false, transcript, actorId: identity.actorId };
  } finally {
    voiceSubmissionInFlight = false;
    refreshVoiceInputButton();
    setTimeout(() => {
      if (latestVoicePreview === transcript) setVoicePreview('');
    }, 5000);
  }
}

function ensureVoiceInputController() {
  if (voiceInputController) return voiceInputController;
  voiceInputController = new VoiceInputController({
    scope: globalThis,
    language: String(audioSetting('voiceInputLanguage', 'pt-BR')),
    onStateChange: () => refreshVoiceInputButton(),
    onInterim: (interim, finalText) => {
      const preview = normalizeVoiceTranscript([finalText, interim].filter(Boolean).join(' '));
      setVoicePreview(preview, { final: Boolean(finalText && !interim) });
    },
    onFinal: (transcript) => submitVoiceTranscript(transcript),
    onError: ({ code, message }) => {
      refreshVoiceInputButton();
      if (code === 'aborted') return;
      ui.notifications?.warn?.(`Mestre Orc: ${message}`);
    },
    logger: console
  });
  return voiceInputController;
}

function startOrStopVoiceInput() {
  const controller = ensureVoiceInputController();
  if (controller.state === 'listening') {
    controller.stop();
    refreshVoiceInputButton();
    return;
  }
  if (controller.state === 'starting' || controller.state === 'processing' || voiceSubmissionInFlight) return;
  if (!Boolean(audioSetting('voiceInputEnabled', true))) {
    ui.notifications?.warn?.('Mestre Orc: a entrada por voz está desativada nas configurações do módulo.');
    return;
  }
  if (!speechRecognitionSupported(globalThis)) {
    ui.notifications?.warn?.('Mestre Orc: reconhecimento de voz indisponível. Abra o Foundry no Chrome ou Edge atualizado.');
    return;
  }
  if (!voiceSessionActive) {
    ui.notifications?.warn?.('Mestre Orc: inicie a sessão antes de declarar uma ação por voz.');
    return;
  }
  const identity = currentVoiceActorIdentity();
  if (!identity) {
    ui.notifications?.warn?.('Mestre Orc: selecione um token próprio ou vincule um personagem ao seu usuário.');
    return;
  }

  // Evita que a narração TTS do Mestre Orc seja reconhecida como ação do jogador.
  stopNarrationAudio();
  setVoicePreview(`Ouvindo ${identity.actorName}…`);
  controller.setLanguage(String(audioSetting('voiceInputLanguage', 'pt-BR')));
  if (!controller.start()) {
    setVoicePreview('');
    refreshVoiceInputButton();
  }
}

function injectVoiceInputButton(root = document) {
  if (document.getElementById(VOICE_BUTTON_ID)) {
    refreshVoiceInputButton();
    return true;
  }
  const chat = findChatContainer(root);
  if (!chat) return false;

  const button = document.createElement('button');
  button.id = VOICE_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'voice-input';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    startOrStopVoiceInput();
  };

  const preview = document.createElement('div');
  preview.id = VOICE_PREVIEW_ID;
  preview.className = 'mestre-orc-voice-preview';
  preview.dataset.visible = 'false';
  preview.dataset.final = 'false';
  preview.setAttribute('aria-live', 'polite');

  const chatForm = chat.querySelector('#chat-form, .chat-form, form.chat-form');
  if (chatForm?.parentElement) {
    chatForm.parentElement.insertBefore(button, chatForm);
    chatForm.parentElement.insertBefore(preview, chatForm);
  } else {
    chat.append(button, preview);
  }
  refreshVoiceInputButton();
  return true;
}

const PRIVATE_JOURNAL_SELECTOR = [
  '.secret',
  '.gm-only',
  '.gmonly',
  '[data-visibility="gm"]',
  '[data-visible-to="gm"]',
  '[data-user-visibility="gm"]',
  '[hidden]',
  '[aria-hidden="true"]'
].join(', ');

function isPublicReadAloudElement(element) {
  return Boolean(element) && !element.closest?.(PRIVATE_JOURNAL_SELECTOR);
}

function findReadAloudElement(container, { allowBlockquote = false } = {}) {
  if (!container?.querySelectorAll) return null;
  const explicit = [
    ...(container.matches?.(READ_ALOUD_SELECTOR) ? [container] : []),
    ...container.querySelectorAll(READ_ALOUD_SELECTOR)
  ].find(isPublicReadAloudElement);
  if (explicit) return explicit;
  if (!allowBlockquote) return null;
  return [...container.querySelectorAll('blockquote')].find(isPublicReadAloudElement) ?? null;
}

function readAloudElementContent(element) {
  const content = stripHtml(element?.innerHTML ?? '');
  return content ? content.slice(0, 5000) : '';
}

function markdownReadAloud(page, options = {}) {
  const extracted = extractMarkdownReadAloud(page?.text?.markdown ?? '', options);
  const content = String(extracted?.content ?? '').replace(/\s+/g, ' ').trim();
  if (!content) return null;
  return { content: content.slice(0, 5000), areaName: extracted?.areaName ?? null };
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

function journalFolderDocument(journal) {
  if (journal?.folder && typeof journal.folder === 'object') return journal.folder;
  return journal?.folder ? game.folders?.get?.(journal.folder) ?? null : null;
}

function journalFolderName(journal) {
  return String(journalFolderDocument(journal)?.name ?? '').trim();
}

function journalFolderId(journal) {
  return String(journalFolderDocument(journal)?.id ?? journal?.folder?.id ?? journal?.folder ?? '').trim();
}

function leadingRoomNumber(value) {
  return String(value ?? '').trim().match(/^(\d+)\b/)?.[1] ?? null;
}

function journalBelongsToScene(scene, journal, relatedFolderId = '') {
  const folderName = journalFolderName(journal);
  const folderId = journalFolderId(journal);
  return namesRelated(scene?.name, journal?.name) ||
    namesRelated(scene?.name, folderName) ||
    Boolean(relatedFolderId && folderId && folderId === relatedFolderId);
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


function findJournalReadAloudPage(journal, sceneName) {
  const pages = journal?.pages?.contents ?? [];
  return pages.find((entry) => Boolean(extractStructuredReadAloud(entry, sceneName)))
    ?? pages.find((entry) => namesRelated(sceneName, entry?.name) && Boolean(extractFirstReadAloud(entry)))
    ?? pages.find((entry) => Boolean(extractFirstReadAloud(entry)))
    ?? null;
}

function findJournalDirectlyByScene(scene) {
  const journals = game.journal?.contents ?? [];
  const target = normalizeComparableName(scene?.name);
  if (!target) return null;

  const exact = journals.find((journal) => normalizeComparableName(journal?.name) === target);
  const related = exact ?? journals.find((journal) => namesRelated(scene?.name, journal?.name));
  const relatedFolderId = journalFolderId(related);
  const candidates = journals.filter((journal) => journalBelongsToScene(scene, journal, relatedFolderId));
  const matches = candidates.flatMap((journal) => {
    const page = findJournalReadAloudPage(journal, scene?.name);
    if (!page) return [];
    const exactName = normalizeComparableName(journal?.name) === target;
    const folderName = journalFolderName(journal);
    const roomNumber = leadingRoomNumber(journal?.name) ?? leadingRoomNumber(page?.name);
    const numericOrder = roomNumber ? Math.min(Number(roomNumber), 999) : 999;
    const score = (exactName ? 2000 : namesRelated(scene?.name, journal?.name) ? 900 : 0) +
      (normalizeComparableName(folderName) === target ? 1200 : namesRelated(scene?.name, folderName) ? 1000 : 0) +
      (roomNumber === '1' ? 300 : roomNumber ? Math.max(0, 100 - numericOrder) : 0);
    return [{ journal, page, exactName, score, numericOrder }];
  }).sort((left, right) => right.score - left.score || left.numericOrder - right.numericOrder);

  const selected = matches[0] ?? null;
  if (!selected && !related) return null;
  const journal = selected?.journal ?? related;
  const page = selected?.page ?? null;
  const exactName = selected?.exactName ?? Boolean(exact);
  const folderMatch = namesRelated(scene?.name, journalFolderName(journal));

  console.log('[Mestre Orc] Journal localizado diretamente no diretório', {
    scene: scene?.name ?? null,
    journal: journal.name,
    page: page?.name ?? null,
    folder: journalFolderName(journal) || null,
    exactName,
    usedNumberedEntry: Boolean(leadingRoomNumber(journal?.name))
  });

  return {
    journal,
    page,
    explicit: true,
    source: exactName
      ? 'journal-directory-exact'
      : folderMatch ? 'journal-directory-folder' : 'journal-directory-related'
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

  const readAloud = findReadAloudElement(startingArea, { allowBlockquote: true });
  const content = readAloudElementContent(readAloud);
  if (!content) return null;

  return {
    content,
    sceneSectionName: String(sceneSection.dataset?.rollNameAncestor ?? '').trim(),
    areaName: String(startingArea.dataset?.rollNameAncestor ?? '').trim(),
    extractionMode: 'STRUCTURED_READ_ALOUD'
  };
}


function extractFirstReadAloud(page) {
  const html = String(page?.text?.content ?? '');
  if (html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    const readAloud = findReadAloudElement(container, { allowBlockquote: true });
    const content = readAloudElementContent(readAloud);
    if (content) {
      const area = readAloud.closest?.('[data-roll-name-ancestor]');
      return {
        content,
        sceneSectionName: null,
        areaName: String(area?.dataset?.rollNameAncestor ?? page?.name ?? '').trim() || null,
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
      };
    }
  }

  const markdown = markdownReadAloud(page, { pageLabel: page?.name ?? '' });
  if (!markdown) return null;
  return {
    content: markdown.content,
    sceneSectionName: null,
    areaName: markdown.areaName ?? page?.name ?? null,
    extractionMode: 'MARKDOWN_BLOCKQUOTE_READ_ALOUD'
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
  const linkedJournal = game.journal?.get?.(document.entryId ?? document.entry?.id ?? document.entry?._id);
  const linkedPage = linkedJournal?.pages?.get?.(document.pageId ?? document.page?.id ?? document.page?._id);
  const labels = [
    document.label,
    document.text,
    document.name,
    marker?.tooltip?.text,
    marker?.tooltip?.textContent,
    marker?.label?.text,
    marker?.label?.textContent,
    document.page?.name,
    document.entry?.name,
    linkedPage?.name,
    linkedJournal?.name,
    marker?.page?.name,
    marker?.entry?.name
  ];
  for (const value of labels) {
    const number = String(value ?? '').match(/\d+/)?.[0] ?? null;
    if (number) return number;
  }
  return null;
}

function extractRoomReadAloud(page, roomLabel, journalName = '') {
  const html = String(page?.text?.content ?? '');
  const pageMatchesRoom = labelsRelated(roomLabel, page?.name);
  const journalMatchesRoom = labelsRelated(roomLabel, journalName);
  if (html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    const areas = [...container.querySelectorAll('[data-roll-name-ancestor]')];
    const area = areas.find((element) => labelsRelated(roomLabel, element.dataset?.rollNameAncestor));
    const readAloud = area
      ? findReadAloudElement(area, { allowBlockquote: true })
      : (pageMatchesRoom || journalMatchesRoom)
        ? findReadAloudElement(container, { allowBlockquote: true })
        : null;
    const content = readAloudElementContent(readAloud);
    if (content) {
      return {
        content,
        areaName: String(area?.dataset?.rollNameAncestor ?? (journalMatchesRoom ? journalName : page?.name) ?? `Sala ${roomLabel}`).trim(),
        extractionMode: area ? 'STRUCTURED_ROOM_READ_ALOUD' : 'NUMBERED_PAGE_READ_ALOUD'
      };
    }
  }

  const markdown = markdownReadAloud(page, {
    sectionLabel: roomLabel,
    pageLabel: journalMatchesRoom ? journalName : page?.name ?? ''
  });
  if (!markdown) return null;
  return {
    content: markdown.content,
    areaName: markdown.areaName ?? (journalMatchesRoom ? journalName : page?.name) ?? `Sala ${roomLabel}`,
    extractionMode: 'MARKDOWN_ROOM_READ_ALOUD'
  };
}

function findJournalSourceForRoom(scene, roomNumber) {
  const journals = game.journal?.contents ?? [];
  const exactSceneJournal = journals.find((journal) =>
    normalizeComparableName(journal?.name) === normalizeComparableName(scene?.name)
  );
  const relatedFolderId = journalFolderId(exactSceneJournal);
  const sceneJournals = journals.filter((journal) => journalBelongsToScene(scene, journal, relatedFolderId));
  const journalsToSearch = sceneJournals.length ? sceneJournals : journals;
  const candidates = [];
  for (const journal of journalsToSearch) {
    const sceneMatch = normalizeComparableName(journal?.name) === normalizeComparableName(scene?.name);
    const sceneRelated = sceneMatch || namesRelated(scene?.name, journal?.name);
    const folderRelated = namesRelated(scene?.name, journalFolderName(journal));
    for (const page of journal.pages?.contents ?? []) {
      const extracted = extractRoomReadAloud(page, roomNumber, journal?.name);
      if (!extracted?.content) continue;
      const pageNumber = String(page?.name ?? '').match(/\d+/)?.[0] ?? null;
      const journalNumber = leadingRoomNumber(journal?.name);
      const score = (sceneMatch ? 1200 : folderRelated ? 1000 : sceneRelated ? 800 : 0) +
        (pageNumber === roomNumber || journalNumber === roomNumber ? 300 : 0) +
        (namesRelated(scene?.name, page?.name) ? 50 : 0);
      candidates.push({ journal, page, extracted, score });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

function visiblePlayerTokens() {
  const renderedTokens = canvas?.tokens?.placeables ?? [];
  const sceneTokens = game.scenes?.active?.tokens?.contents ?? [];
  const tokens = renderedTokens.length ? renderedTokens : sceneTokens;
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

function roomMarkersForScene(scene = game.scenes?.active) {
  const renderedMarkers = canvas?.notes?.placeables ?? [];
  const sceneMarkers = scene?.notes?.contents ?? [];
  const markersById = new Map();
  for (const marker of sceneMarkers) {
    const document = marker?.document ?? marker;
    const id = String(document?.id ?? document?._id ?? crypto.randomUUID());
    markersById.set(id, marker);
  }
  for (const marker of renderedMarkers) {
    const document = marker?.document ?? marker;
    const id = String(document?.id ?? document?._id ?? crypto.randomUUID());
    // O objeto renderizado expõe tooltip/texto; o documento da Scene permanece
    // como fallback quando o canvas ainda não completou a renderização.
    markersById.set(id, marker);
  }
  return [...markersById.values()];
}

function tokenTrackingId(token) {
  const document = token?.document ?? token ?? {};
  return String(document.id ?? document._id ?? token?.id ?? '');
}

function roomOccupancyForToken(token, scene, markers) {
  const tokenId = tokenTrackingId(token);
  const marker = findRoomMarkerForToken(token, markers);
  const roomNumber = extractRoomNumberFromMarker(marker);
  return {
    tokenId,
    marker,
    roomNumber,
    roomKey: roomNumber ? `${scene.id}:room-${roomNumber}` : null
  };
}

function sceneTokensForVision(scene) {
  const tokensById = new Map();
  for (const [index, token] of (scene?.tokens?.contents ?? []).entries()) {
    tokensById.set(tokenTrackingId(token) || `scene-token-${index}`, token);
  }
  for (const [index, token] of (canvas?.tokens?.placeables ?? []).entries()) {
    tokensById.set(tokenTrackingId(token) || `rendered-token-${index}`, token);
  }
  return [...tokensById.values()];
}

function serializeRoomActor(actor) {
  return {
    id: String(actor?.id ?? actor?._id ?? '').trim(),
    name: String(actor?.name ?? '').trim(),
    type: String(actor?.type ?? 'npc').trim()
  };
}

function roomViewForToken(token, scene, markers, roomKey) {
  const gridSize = Number(canvas?.grid?.size ?? scene?.grid?.size ?? 100) || 100;
  const observerId = tokenTrackingId(token);
  const candidates = sceneTokensForVision(scene).filter((candidate) =>
    tokenTrackingId(candidate) !== observerId &&
    roomOccupancyForToken(candidate, scene, markers).roomKey === roomKey
  );
  const visibleTokens = visibleTokensFrom(token, candidates, { gridSize });
  const actorsById = new Map();
  for (const candidate of visibleTokens) {
    const actor = candidate?.document?.actor ?? candidate?.actor ?? null;
    if (!actor) continue;
    const serialized = serializeRoomActor(actor);
    const key = serialized.id || serialized.name;
    if (key) actorsById.set(key, serialized);
  }
  return {
    visibleActors: [...actorsById.values()],
    perception: createTokenPerception(token, visibleTokens)
  };
}

function tokenNarrationRecipientUserIds(token) {
  const ownerLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const users = game.users?.contents ?? game.users ?? [];
  return [...new Set(ownerUserIdsForToken(token, users, ownerLevel))];
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

function resetRoomNarrationState(sessionId = null) {
  clearTimeout(roomCheckTimer);
  roomCheckTimer = null;
  stopRoomMonitor();
  roomNarrationState.reset().activate(sessionId);
}

function stopRoomMonitor() {
  clearTimeout(roomMonitorTimer);
  roomMonitorTimer = null;
}

function startRoomMonitor() {
  stopRoomMonitor();
  if (!roomNarrationState.active || !game.user?.isGM) return;
  roomMonitorTimer = setTimeout(async () => {
    try {
      await checkRoomTransitions();
    } finally {
      if (roomNarrationState.active) startRoomMonitor();
    }
  }, ROOM_MONITOR_INTERVAL_MS);
}

function primeRoomOccupancy() {
  if (!game.user?.isGM || !roomNarrationState.active || !game.scenes?.active) return false;
  const scene = game.scenes.active;
  const tokens = visiblePlayerTokens();
  const markers = roomMarkersForScene(scene);
  const detectedRoomNumbers = markers.map(extractRoomNumberFromMarker).filter(Boolean);
  const occupancies = tokens
    .map((token) => roomOccupancyForToken(token, scene, markers))
    .filter((entry) => entry.tokenId && entry.roomKey);
  roomNarrationState.prime(scene.id, occupancies);
  console.log('[Mestre Orc][Room] posição inicial registrada sem narração duplicada', {
    sceneId: scene.id,
    tokens: tokens.length,
    markers: markers.length,
    occupancies: occupancies.map((entry) => ({ tokenId: entry.tokenId, roomNumber: entry.roomNumber }))
  });
  if (!tokens.length) {
    ui.notifications?.warn?.('Mestre Orc: nenhum token de personagem foi encontrado na cena ativa.');
  } else if (!detectedRoomNumbers.length) {
    ui.notifications?.warn?.('Mestre Orc: nenhum marcador numerado foi reconhecido na cena ativa.');
  } else if (!occupancies.length) {
    ui.notifications?.warn?.('Mestre Orc: os marcadores foram encontrados, mas nenhum token está próximo de uma sala numerada.');
  }
  startRoomMonitor();
  return true;
}

async function synchronizeRoomSessionState() {
  if (!game.user?.isGM) return false;
  const status = await request('/v1/session/status').catch(() => null);
  const active = status?.state === 'COLLECTING_ACTIONS' && Boolean(status.sessionId);
  if (active) resetRoomNarrationState(status.sessionId);
  else {
    stopRoomMonitor();
    roomNarrationState.reset();
  }
  if (active) {
    console.log('[Mestre Orc][Room] sessão ativa recuperada automaticamente', {
      sessionId: status.sessionId,
      sceneId: status.sceneId ?? null
    });
    primeRoomOccupancy();
  }
  applyRoundButtonState(status?.round ?? null, active);
  broadcastVoiceSessionStatus(active, status?.round ?? null);
  return active;
}

async function checkRoomTransitions() {
  if (!game.user?.isGM || !roomNarrationState.active || !game.scenes?.active || roomNarrationState.checking) return;
  const now = Date.now();
  if (now - roomNarrationState.lastRoomCheck < 1000) return;
  roomNarrationState.lastRoomCheck = now;
  roomNarrationState.checking = true;
  try {
    const scene = game.scenes.active;
    if (!roomNarrationState.primed || roomNarrationState.sceneId !== String(scene.id)) {
      primeRoomOccupancy();
      return;
    }

    const tokens = visiblePlayerTokens();
    const roomMarkers = roomMarkersForScene(scene);
    const detectedRoomNumbers = roomMarkers.map(extractRoomNumberFromMarker).filter(Boolean);
    console.log('[Mestre Orc][Room] verificando transição', {
      sceneId: scene.id,
      playerTokens: tokens.length,
      numberedRooms: detectedRoomNumbers.length,
      roomNumbers: [...new Set(detectedRoomNumbers)],
      sessionId: roomNarrationState.sessionId
    });

    for (const token of tokens) {
      const occupancy = roomOccupancyForToken(token, scene, roomMarkers);
      const observation = roomNarrationState.observe(occupancy.tokenId, occupancy.roomKey);
      if (!observation.entered || !observation.shouldNarrate || !occupancy.roomNumber) continue;
      if (!roomNarrationState.begin(observation.entryKey)) continue;

      console.log('[Mestre Orc][Room] entrada em nova sala detectada', {
        tokenId: occupancy.tokenId,
        previousRoom: observation.previous,
        roomNumber: occupancy.roomNumber,
        roomKey: occupancy.roomKey,
        entryKey: observation.entryKey
      });

      const journalSource = findJournalSourceForRoom(scene, occupancy.roomNumber);
      if (!journalSource) {
        roomNarrationState.fail(observation.entryKey);
        console.warn('[Mestre Orc][Room] sala detectada, mas sem read-aloud correspondente', {
          roomNumber: occupancy.roomNumber,
          scene: scene.name
        });
        ui.notifications?.warn?.(`Mestre Orc: sala ${occupancy.roomNumber} detectada, mas o read-aloud correspondente não foi encontrado.`);
        continue;
      }
      const { journal, page, extracted } = journalSource;
      const roomName = extracted.areaName || `Sala ${occupancy.roomNumber}`;
      const recipientUserIds = tokenNarrationRecipientUserIds(token);
      const { visibleActors, perception } = roomViewForToken(
        token,
        scene,
        roomMarkers,
        occupancy.roomKey
      );
      if (!recipientUserIds.length) {
        roomNarrationState.fail(observation.entryKey);
        console.warn('[Mestre Orc][Room] nenhum jogador OWNER encontrado para o token que entrou', {
          roomNumber: occupancy.roomNumber,
          tokenId: occupancy.tokenId
        });
        ui.notifications?.warn?.(`Mestre Orc: sala ${occupancy.roomNumber} detectada, mas o token não possui dono ativo para receber o sussurro e o áudio.`);
        continue;
      }
      const publicationKey = `room:${roomNarrationState.sessionId}:${occupancy.roomKey}:token:${occupancy.tokenId}`;
      const snapshot = {
        eventId: publicationKey,
        room: { id: occupancy.roomKey, name: roomName },
        source: {
          canonicalAnchor: true,
          text: extracted.content,
          type: 'ROOM_READ_ALOUD',
          extractionMode: extracted.extractionMode
        },
        scene: { id: scene.id, name: scene.name, description: stripHtml(scene.description ?? '') },
        campaign: { worldId: game.world?.id ?? '', title: game.world?.title ?? '' },
        visibleActors,
        narrationExclusions: { actorNames: sceneActorNames(scene) },
        perception
      };

      try {
        const result = await request('/v1/session/room-entry', { method: 'POST', body: JSON.stringify(snapshot) });
        if (result.duplicate) {
          roomNarrationState.complete(observation.entryKey);
          console.log('[Mestre Orc][Room] requisição duplicada bloqueada pelo Engine', {
            roomNumber: occupancy.roomNumber,
            roomKey: occupancy.roomKey,
            tokenId: occupancy.tokenId
          });
          break;
        }
        await publishNarrationChat(result.opening, publicationKey, recipientUserIds);
        publishNarrationAudio(
          result.audio,
          result.opening,
          scene.id,
          publicationKey,
          recipientUserIds
        );
        roomNarrationState.complete(observation.entryKey);
        console.log('[Mestre Orc][Room] transição narrada', {
          roomNumber: occupancy.roomNumber,
          roomName,
          journal: journal.name,
          page: page.name,
          tokenId: occupancy.tokenId,
          recipientUserIds,
          perceptionMode: perception.mode,
          visionSource: perception.sourceKind,
          visibleActorCount: visibleActors.length
        });
      } catch (error) {
        roomNarrationState.fail(observation.entryKey);
        console.error('[Mestre Orc][Room] falha ao narrar transição', {
          roomKey: occupancy.roomKey,
          tokenId: occupancy.tokenId,
          error
        });
        ui.notifications?.warn?.(`Mestre Orc: não foi possível narrar a sala ${occupancy.roomNumber}.`);
      }
      break;
    }
  } finally {
    roomNarrationState.checking = false;
  }
}

function scheduleRoomCheck() {
  if (!roomNarrationState.active || !game.user?.isGM) return;
  clearTimeout(roomCheckTimer);
  const wait = Math.max(0, 1000 - (Date.now() - roomNarrationState.lastRoomCheck));
  roomCheckTimer = setTimeout(() => void checkRoomTransitions(), wait);
}

function installRoomTracking() {
  Hooks.on('updateToken', (document, changes = {}) => {
    // Executa somente no cliente do GM, independentemente de quem moveu o token.
    if (!game.user?.isGM) return;
    if ('x' in changes || 'y' in changes) {
      console.log('[Mestre Orc][Room] movimento de token recebido', {
        tokenId: document?.id ?? document?._id ?? null,
        x: changes.x ?? document?.x ?? null,
        y: changes.y ?? document?.y ?? null
      });
    }
    scheduleRoomCheck();
  });
  Hooks.on('createToken', scheduleRoomCheck);
  Hooks.on('deleteToken', (document) => {
    roomNarrationState.tokenRooms.delete(String(document?.id ?? document?._id ?? ''));
    scheduleRoomCheck();
  });
  Hooks.on('updateNote', () => {
    roomNarrationState.primed = false;
    scheduleRoomCheck();
  });
  Hooks.on('renderScene', scheduleRoomCheck);
  Hooks.on('canvasReady', () => {
    roomNarrationState.primed = false;
    scheduleRoomCheck();
  });
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
  const candidate = message?.user ?? message?.author;
  const user = candidate && typeof candidate === 'object'
    ? candidate
    : game.users?.get?.(candidate ?? message?.userId ?? message?.author?.id);
  return Boolean(user?.isGM);
}

function playerActionIdentity(message) {
  const candidate = message?.user ?? message?.author;
  const user = candidate && typeof candidate === 'object'
    ? candidate
    : game.users?.get?.(candidate ?? message?.userId ?? message?.author?.id);
  const actorId = String(message?.speaker?.actor ?? user?.character?.id ?? '').trim();
  const tokenId = String(message?.speaker?.token ?? '').trim() || null;
  const actor = actorId ? game.actors?.get?.(actorId) : null;
  const actorName = String(actor?.name ?? message?.speaker?.alias ?? user?.name ?? '').trim() || null;
  const combatant = Array.from(game.combat?.combatants?.contents ?? game.combat?.combatants ?? [])
    .find((entry) => String(entry.actorId ?? entry.actor?.id ?? '') === actorId || (tokenId && String(entry.tokenId ?? entry.token?.id ?? '') === tokenId));
  const targetIds = [...(user?.targets ?? game.user?.targets ?? [])]
    .map((token) => String(token?.id ?? token?.document?.id ?? ''))
    .filter(Boolean);
  return {
    actorId, actorName, tokenId,
    combatantId: combatant ? String(combatant.id ?? combatant._id ?? '') : null,
    targetIds
  };
}

function claimPlayerActionContent(content, actorId = '') {
  const fingerprint = stableTextFingerprint(`${actorId}:${content}`);
  const now = Date.now();
  for (const [key, timestamp] of recentActionFingerprints) {
    if (now - timestamp >= ACTION_DEDUPE_WINDOW_MS) recentActionFingerprints.delete(key);
  }
  const previous = recentActionFingerprints.get(fingerprint) ?? 0;
  if (now - previous < ACTION_DEDUPE_WINDOW_MS) return false;
  recentActionFingerprints.set(fingerprint, now);
  return true;
}

async function syncCombatDocument(combat = game.combat) {
  if (!game.user?.isGM || !combat) return null;
  const snapshot = combatSnapshotFromDocument(combat);
  if (!snapshot.id || !snapshot.started) return null;
  const result = await request('/v1/session/combat/sync', {
    method: 'POST',
    body: JSON.stringify(snapshot)
  });
  lastCombatSnapshot = snapshot;
  await refreshCombatButtons(result?.combat ?? null);
  return result;
}

async function processCombatActionMessage(message, content, identity) {
  const snapshot = combatSnapshotFromDocument(game.combat);
  if (!snapshot.id || !snapshot.started || !snapshot.activeCombatant) return false;
  if (!identity.actorId) return false;
  const payload = combatActionPayloadFromMessage(message, { content, identity, combat: snapshot });
  if (!payload.content || payload.content.length < 2 || payload.content.startsWith('/')) return false;
  if (payload.economyType !== 'REACTION' && identity.actorId !== snapshot.activeCombatant.actorId) {
    console.debug('[Mestre Orc][Combat] mensagem ignorada porque não pertence ao combatente ativo', {
      actorId: identity.actorId, activeActorId: snapshot.activeCombatant.actorId, economyType: payload.economyType
    });
    return false;
  }
  if (!await ensureSessionActive()) return false;

  const messageId = String(message.id ?? message._id ?? '');
  const eventId = `combat-chat:${messageId || stableTextFingerprint(`${identity.actorId}:${payload.economyType}:${payload.content}`)}`;
  try {
    await syncCombatDocument(game.combat);
    const result = await request('/v1/session/combat/action', {
      method: 'POST',
      body: JSON.stringify({ ...payload, eventId })
    });
    if (!result?.duplicate) {
      const label = result?.replaced ? 'atualizada' : 'registrada';
      const typeLabels = { ACTION: 'ação', BONUS_ACTION: 'ação bônus', REACTION: 'reação', MOVEMENT: 'movimento', FREE_ACTION: 'ação livre' };
      ui.notifications?.info?.(`Mestre Orc: ${typeLabels[payload.economyType] ?? 'ação'} de ${identity.actorName ?? 'combatente'} ${label}.`);
    }
    await refreshCombatButtons(result?.combat ?? null);
    return true;
  } catch (error) {
    console.error('[Mestre Orc][Combat] falha ao registrar evento', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message || 'não foi possível registrar a ação de combate.'}`);
    return false;
  }
}

async function processPlayerActionMessage(message) {
  if (!game.user?.isGM || !roomNarrationState.active || !message) return;
  const messageId = String(message.id ?? message._id ?? '');
  if (messageId && processedActionMessages.has(messageId)) return;
  const voiceInputMessage = Boolean(message.flags?.[MODULE_ID]?.voiceInput);
  if (message.speaker?.alias === 'Mestre Orc') return;
  const combatActive = Boolean(game.combat?.started && game.combat?.combatant);
  if (!combatActive && messageAuthorIsGm(message) && !voiceInputMessage) return;
  const content = stripHtml(message.content ?? message.flavor ?? '').trim();
  const identity = playerActionIdentity(message);

  if (combatActive) {
    const accepted = await processCombatActionMessage(message, content, identity);
    if (accepted && messageId) {
      processedActionMessages.add(messageId);
      if (processedActionMessages.size > 250) processedActionMessages.delete(processedActionMessages.values().next().value);
    }
    return;
  }

  const rejectionReason = actionMessageRejectionReason(message, content);
  const chatStyles = globalThis.CONST?.CHAT_MESSAGE_STYLES ?? globalThis.CONST?.CHAT_MESSAGE_TYPES ?? {};
  if (rejectionReason || !isSupportedPlayerChatStyle(message, chatStyles)) {
    console.debug('[Mestre Orc][Action] mensagem automática ignorada', {
      messageId: messageId || null,
      reason: rejectionReason ?? 'UNSUPPORTED_CHAT_STYLE'
    });
    return;
  }
  if (content.length < 2 || content.startsWith('/')) return;

  if (!identity.actorId) {
    console.warn('[Mestre Orc][Action] declaração ignorada por não estar vinculada a um personagem', {
      messageId: messageId || null,
      userId: message?.user?.id ?? message?.user ?? null
    });
    ui.notifications?.warn?.('Mestre Orc: selecione ou vincule um personagem antes de declarar a ação.');
    return;
  }
  const now = Date.now();
  const previousActorActionAt = lastPlayerActionAtByActor.get(identity.actorId) ?? 0;
  if (now - previousActorActionAt < 500) return;
  if (!await ensureSessionActive()) return;
  if (!claimPlayerActionContent(content, identity.actorId)) {
    console.debug('[Mestre Orc][Action] conteúdo repetido do mesmo personagem ignorado', {
      messageId: messageId || null,
      actorId: identity.actorId
    });
    return;
  }
  lastPlayerActionAtByActor.set(identity.actorId, Date.now());
  if (messageId) {
    processedActionMessages.add(messageId);
    if (processedActionMessages.size > 250) processedActionMessages.delete(processedActionMessages.values().next().value);
  }

  try {
    const eventId = `chat:${messageId || stableTextFingerprint(`${identity.actorId}:${content}`)}`;
    const result = await request('/v1/session/action', {
      method: 'POST',
      body: JSON.stringify({
        content, actorId: identity.actorId, actorName: identity.actorName, tokenId: identity.tokenId, eventId
      })
    });
    if (result?.duplicate) {
      console.log('[Mestre Orc][Action] requisição duplicada bloqueada pelo Engine', { eventId });
      return;
    }
    await refreshRoundButton(result?.round ?? null);
    const actionLabel = result?.replaced ? 'atualizada' : 'registrada';
    ui.notifications?.info?.(`Mestre Orc: ação de ${identity.actorName ?? 'personagem'} ${actionLabel} para a rodada ${result?.round?.number ?? ''}.`);
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao registrar ação`, error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message || 'não foi possível registrar a ação do jogador.'}`);
  }
}

function installPlayerActionHook() {
  if (document.documentElement.dataset.mestreOrcActionHook === '1') return;
  document.documentElement.dataset.mestreOrcActionHook = '1';

  // Hook confiável no cliente do GM para mensagens criadas por qualquer jogador.
  Hooks.on('createChatMessage', (message) => void processPlayerActionMessage(message));
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

function openingActorsForScene(scene, sceneJournal) {
  const openingRoomNumber = leadingRoomNumber(sceneJournal?.selectedPage?.areaName)
    ?? leadingRoomNumber(sceneJournal?.selectedPage?.name);
  if (!openingRoomNumber) return [];

  const markers = roomMarkersForScene(scene);
  const actorsById = new Map();
  for (const token of sceneTokensForVision(scene)) {
    const document = token?.document ?? token ?? {};
    const actor = document.actor ?? token?.actor ?? null;
    if (document.hidden || !actor) continue;
    const occupancy = roomOccupancyForToken(token, scene, markers);
    if (occupancy.roomNumber !== openingRoomNumber) continue;
    const serialized = serializeRoomActor(actor);
    const key = serialized.id || serialized.name;
    if (key) actorsById.set(key, serialized);
  }
  return [...actorsById.values()];
}

function sceneActorNames(scene) {
  const names = new Set();
  for (const token of sceneTokensForVision(scene)) {
    const document = token?.document ?? token ?? {};
    const actor = document.actor ?? token?.actor ?? null;
    const name = String(actor?.name ?? '').trim();
    if (name) names.add(name);
  }
  return [...names];
}

async function collectSnapshot() {
  const scene = game.scenes?.active;
  if (!scene) throw new Error('Ative uma cena antes de iniciar a sessão.');

  const { journal, page, explicit, source } = await findSceneJournalReference(scene);
  const sceneJournal = serializeJournalReference(journal, page, scene, { explicit, source });
  const visibleActors = openingActorsForScene(scene, sceneJournal);
  const excludedActorNames = sceneActorNames(scene);
  if (!sceneJournal?.selectedPage?.content && !stripHtml(scene.description ?? '')) {
    throw new Error('Journal localizado, mas nenhuma caixa read-aloud segura foi encontrada para a cena ativa.');
  }
  console.log('[Mestre Orc] contexto de abertura coletado', {
    scene: scene.name,
    journal: sceneJournal?.name ?? null,
    page: sceneJournal?.selectedPage?.name ?? null,
    sceneSection: sceneJournal?.selectedPage?.sceneSectionName ?? null,
    area: sceneJournal?.selectedPage?.areaName ?? null,
    actorsInOpeningRoom: visibleActors.length,
    excludedSceneActorNames: excludedActorNames.length,
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
    narrationExclusions: { actorNames: excludedActorNames },
    sceneJournal
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `Engine respondeu HTTP ${response.status}.`);
    error.code = payload.code || `HTTP_${response.status}`;
    error.status = response.status;
    error.fallbackToBrowser = payload.fallbackToBrowser;
    error.failures = payload.failures;
    throw error;
  }
  return payload;
}



function memoryEscape(value) {
  const escapeHTML = globalThis.foundry?.utils?.escapeHTML;
  if (escapeHTML) return escapeHTML(String(value ?? ''));
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function memoryCollectionLabel(collection) {
  return ({ facts: 'Fatos', npcs: 'NPCs', relationships: 'Relações', quests: 'Missões', items: 'Itens' })[collection] ?? collection;
}

function memoryRecordTitle(collection, record = {}) {
  if (collection === 'facts') return record.text ?? 'Fato sem texto';
  if (collection === 'relationships') return `${record.actorName ?? record.actorId ?? 'Personagem'} → ${record.npcName ?? record.npcId ?? 'NPC'}`;
  return record.name ?? record.title ?? record.id ?? 'Registro';
}

function memoryRecordDetail(collection, record = {}) {
  if (collection === 'facts') return [record.category, record.source].filter(Boolean).join(' · ');
  if (collection === 'npcs') return [record.status, record.location].filter(Boolean).join(' · ');
  if (collection === 'relationships') return `${record.type ?? 'NEUTRAL'} · ${Number(record.score) || 0}`;
  if (collection === 'quests') return [record.status, record.objective].filter(Boolean).join(' · ');
  if (collection === 'items') return [record.status, `Qtd. ${Number(record.quantity) || 0}`, record.ownerActorName].filter(Boolean).join(' · ');
  return '';
}

function memoryActorOptions(type) {
  const actors = Array.from(game.actors ?? []).filter((actor) => {
    const actorType = String(actor?.type ?? '').toLowerCase();
    return type === 'npc' ? actorType === 'npc' : actorType !== 'npc';
  });
  return actors.map((actor) => `<option value="${memoryEscape(actor.id)}" data-name="${memoryEscape(actor.name)}">${memoryEscape(actor.name)}</option>`).join('');
}

function memoryRecords(snapshot, collection) {
  return Array.isArray(snapshot?.records?.[collection]) ? snapshot.records[collection] : [];
}

function memoryCollectionHtml(snapshot, collection) {
  const records = memoryRecords(snapshot, collection)
    .sort((left, right) => String(right.updatedAt ?? right.lastSeenAt ?? '').localeCompare(String(left.updatedAt ?? left.lastSeenAt ?? '')))
    .slice(0, 30);
  if (!records.length) return '<p class="mestre-orc-memory-empty">Nenhum registro.</p>';
  return `<ul class="mestre-orc-memory-list">${records.map((record) => `
    <li>
      <div>
        <strong>${memoryEscape(memoryRecordTitle(collection, record))}</strong>
        <small>${memoryEscape(memoryRecordDetail(collection, record))}</small>
      </div>
      <button type="button" class="mestre-orc-memory-delete" data-collection="${memoryEscape(collection)}" data-record-id="${memoryEscape(record.id)}" title="Remover registro"><i class="fa-solid fa-trash"></i></button>
    </li>`).join('')}</ul>`;
}

function memoryPanelHtml(snapshot) {
  const counts = snapshot?.counts ?? {};
  return `
    <div id="${MEMORY_PANEL_ID}" class="mestre-orc-memory-overlay" role="dialog" aria-modal="true" aria-labelledby="mestre-orc-memory-title">
      <section class="mestre-orc-memory-panel">
        <header>
          <div>
            <span class="mestre-orc-memory-kicker">Campanha ${memoryEscape(snapshot?.campaignId ?? game.world?.id ?? '')}</span>
            <h2 id="mestre-orc-memory-title">Memória persistente</h2>
            <p>Fatos e estados recuperados automaticamente após reiniciar o Engine.</p>
          </div>
          <button type="button" data-memory-action="close" aria-label="Fechar"><i class="fa-solid fa-xmark"></i></button>
        </header>

        <div class="mestre-orc-memory-stats">
          ${['facts', 'npcs', 'relationships', 'quests', 'items'].map((collection) => `
            <article><strong>${Number(counts[collection]) || 0}</strong><span>${memoryCollectionLabel(collection)}</span></article>`).join('')}
        </div>

        <div class="mestre-orc-memory-grid">
          ${['facts', 'npcs', 'relationships', 'quests', 'items'].map((collection) => `
            <section class="mestre-orc-memory-section">
              <h3>${memoryCollectionLabel(collection)}</h3>
              ${memoryCollectionHtml(snapshot, collection)}
            </section>`).join('')}
        </div>

        <form class="mestre-orc-memory-form">
          <h3>Adicionar ou atualizar registro</h3>
          <label>Categoria
            <select name="collection">
              <option value="facts">Fato</option>
              <option value="npcs">NPC</option>
              <option value="relationships">Relação</option>
              <option value="quests">Missão</option>
              <option value="items">Item</option>
            </select>
          </label>

          <div data-memory-fields="facts">
            <label>Fato<textarea name="factText" maxlength="4000" placeholder="Ex.: A ponte de Crimmor foi interditada."></textarea></label>
            <label>Categoria<input name="factCategory" maxlength="100" value="GENERAL"></label>
          </div>

          <div data-memory-fields="npcs" hidden>
            <label>Nome do NPC<input name="npcName" maxlength="300"></label>
            <label>Estado atual<input name="npcStatus" maxlength="500" placeholder="Ex.: ferido, desconfiado, desaparecido"></label>
            <label>Localização<input name="npcLocation" maxlength="300"></label>
          </div>

          <div data-memory-fields="relationships" hidden>
            <label>Personagem<select name="relationshipActorId"><option value="">Selecione</option>${memoryActorOptions('character')}</select></label>
            <label>NPC<select name="relationshipNpcId"><option value="">Selecione</option>${memoryActorOptions('npc')}</select></label>
            <label>Pontuação (-100 a 100)<input name="relationshipScore" type="number" min="-100" max="100" value="0"></label>
          </div>

          <div data-memory-fields="quests" hidden>
            <label>Título da missão<input name="questTitle" maxlength="400"></label>
            <label>Status<select name="questStatus"><option>ACTIVE</option><option>COMPLETED</option><option>FAILED</option><option>PAUSED</option></select></label>
            <label>Objetivo<textarea name="questObjective" maxlength="1500"></textarea></label>
          </div>

          <div data-memory-fields="items" hidden>
            <label>Nome do item<input name="itemName" maxlength="400"></label>
            <label>Responsável<select name="itemOwnerActorId"><option value="">Grupo</option>${memoryActorOptions('character')}</select></label>
            <label>Quantidade<input name="itemQuantity" type="number" min="0" max="9999" value="1"></label>
            <label>Status<select name="itemStatus"><option>CARRIED</option><option>STORED</option><option>USED</option><option>REMOVED</option></select></label>
          </div>

          <label class="mestre-orc-memory-visibility">Visibilidade
            <select name="visibility"><option value="known">Conhecida</option><option value="secret">Segredo do mestre</option></select>
          </label>
          <div class="mestre-orc-memory-form-actions">
            <button type="button" data-memory-action="refresh"><i class="fa-solid fa-rotate"></i> Atualizar</button>
            <button type="submit"><i class="fa-solid fa-floppy-disk"></i> Salvar registro</button>
          </div>
        </form>
      </section>
    </div>`;
}

function closeCampaignMemoryPanel() {
  document.getElementById(MEMORY_PANEL_ID)?.remove();
}

function memorySelectedName(select) {
  const option = select?.selectedOptions?.[0];
  return option?.dataset?.name || option?.textContent?.trim() || null;
}

function memoryRecordFromForm(form) {
  const data = new FormData(form);
  const collection = String(data.get('collection') ?? 'facts');
  const visibility = String(data.get('visibility') ?? 'known');
  if (collection === 'facts') return { collection, record: { text: data.get('factText'), category: data.get('factCategory'), visibility } };
  if (collection === 'npcs') return { collection, record: { name: data.get('npcName'), status: data.get('npcStatus'), location: data.get('npcLocation'), visibility } };
  if (collection === 'relationships') {
    const actorSelect = form.elements.relationshipActorId;
    const npcSelect = form.elements.relationshipNpcId;
    return { collection, record: {
      actorId: data.get('relationshipActorId'), actorName: memorySelectedName(actorSelect),
      npcId: data.get('relationshipNpcId'), npcName: memorySelectedName(npcSelect),
      score: Number(data.get('relationshipScore')) || 0, visibility
    } };
  }
  if (collection === 'quests') return { collection, record: {
    title: data.get('questTitle'), status: data.get('questStatus'), objective: data.get('questObjective'), visibility
  } };
  const ownerSelect = form.elements.itemOwnerActorId;
  return { collection, record: {
    name: data.get('itemName'), ownerActorId: data.get('itemOwnerActorId') || null,
    ownerActorName: data.get('itemOwnerActorId') ? memorySelectedName(ownerSelect) : null,
    quantity: Number(data.get('itemQuantity')) || 0, status: data.get('itemStatus'), visibility
  } };
}

function bindCampaignMemoryPanel(panel) {
  const form = panel.querySelector('.mestre-orc-memory-form');
  const collectionSelect = form?.elements?.collection;
  const updateFields = () => {
    const selected = String(collectionSelect?.value ?? 'facts');
    panel.querySelectorAll('[data-memory-fields]').forEach((element) => {
      element.hidden = element.dataset.memoryFields !== selected;
    });
  };
  collectionSelect?.addEventListener('change', updateFields);
  updateFields();

  panel.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('button') : null;
    if (!target) return;
    const action = target.dataset.memoryAction;
    if (action === 'close') return closeCampaignMemoryPanel();
    if (action === 'refresh') return openCampaignMemoryPanel();
    if (target.classList.contains('mestre-orc-memory-delete')) {
      const collection = target.dataset.collection;
      const recordId = target.dataset.recordId;
      if (!collection || !recordId) return;
      target.disabled = true;
      try {
        await request(`/v1/campaign-memory/${encodeURIComponent(game.world?.id ?? 'default')}/${encodeURIComponent(collection)}/${encodeURIComponent(recordId)}`, { method: 'DELETE' });
        ui.notifications?.info?.('Mestre Orc: registro removido da memória.');
        await openCampaignMemoryPanel();
      } catch (error) {
        target.disabled = false;
        ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
      }
    }
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const { collection, record } = memoryRecordFromForm(form);
      await request(`/v1/campaign-memory/${encodeURIComponent(game.world?.id ?? 'default')}/${encodeURIComponent(collection)}`, {
        method: 'POST',
        body: JSON.stringify(record)
      });
      ui.notifications?.info?.(`Mestre Orc: ${memoryCollectionLabel(collection)} atualizado(a).`);
      await openCampaignMemoryPanel();
    } catch (error) {
      submit.disabled = false;
      ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    }
  });
}

async function openCampaignMemoryPanel() {
  if (!game.user?.isGM) return;
  try {
    const campaignId = encodeURIComponent(game.world?.id ?? 'default');
    const snapshot = await request(`/v1/campaign-memory/${campaignId}`);
    closeCampaignMemoryPanel();
    document.body.insertAdjacentHTML('beforeend', memoryPanelHtml(snapshot));
    const panel = document.getElementById(MEMORY_PANEL_ID);
    if (!panel) return;
    bindCampaignMemoryPanel(panel);
    panel.addEventListener('click', (event) => {
      if (event.target === panel) closeCampaignMemoryPanel();
    });
  } catch (error) {
    console.error('[Mestre Orc] falha ao abrir memória persistente', error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  }
}

function narrationHtml(text) {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${foundry.utils.escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

async function publishNarrationChat(text, publicationKey = '', recipientUserIds = null) {
  const content = String(text ?? '').trim();
  if (!content) return false;
  const recipients = normalizeRecipientUserIds(recipientUserIds);
  if (recipients !== null && !recipients.length) {
    console.warn('[Mestre Orc][Chat] sussurro descartado porque não há destinatários', { publicationKey });
    return false;
  }
  const key = String(publicationKey ?? '').trim();
  if (key && (publishedNarrationKeys.has(key) || !claimBrowserPublication('chat-publication', key))) {
    console.info('[Mestre Orc][Chat] publicação duplicada bloqueada', { key });
    return false;
  }
  if (key) {
    publishedNarrationKeys.add(key);
    if (publishedNarrationKeys.size > 500) {
      publishedNarrationKeys.delete(publishedNarrationKeys.values().next().value);
    }
  }
  try {
    const messageData = { speaker: { alias: 'Mestre Orc' }, content: narrationHtml(content) };
    if (recipients !== null) messageData.whisper = recipients;
    await ChatMessage.create(messageData);
    return true;
  } catch (error) {
    if (key) {
      publishedNarrationKeys.delete(key);
      releaseBrowserPublication('chat-publication', key);
    }
    throw error;
  }
}

async function resolveRound(button) {
  if (roundResolveInFlight) return;
  roundResolveInFlight = true;
  const target = button ?? document.getElementById(ROUND_BUTTON_ID);
  try {
    applyRoundButtonState({
      number: Number(target?.dataset?.roundNumber) || 1,
      actionCount: Number(target?.dataset?.actionCount) || 0
    }, true);
    const status = await request('/v1/session/status');
    if (status?.state !== 'COLLECTING_ACTIONS' || !status.sessionId) {
      throw new Error('nenhuma sessão ativa está pronta para resolver a rodada.');
    }
    if (!status.round?.actionCount) {
      throw new Error('nenhuma ação foi declarada nesta rodada.');
    }

    const eventId = `round:${status.sessionId}:${status.round.number}`;
    const result = await request('/v1/session/round/resolve', {
      method: 'POST',
      body: JSON.stringify({ eventId })
    });
    if (!result?.duplicate && result?.narration) {
      const publicationKey = `round:${status.sessionId}:${result.resolvedRound}`;
      await publishNarrationChat(result.narration, publicationKey);
      publishNarrationAudio(
        result.audio,
        result.narration,
        game.scenes?.active?.id ?? null,
        publicationKey
      );
    }
    ui.notifications?.info?.(`Mestre Orc: rodada ${result?.resolvedRound ?? status.round.number} resolvida com ${result?.declarations?.length ?? status.round.actionCount} ação(ões).`);
    await refreshRoundButton(result?.round ?? null);
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao resolver rodada`, error);
    ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
  } finally {
    roundResolveInFlight = false;
    await refreshRoundButton();
  }
}


async function resolveCombatTurn(snapshot = null, { automatic = false } = {}) {
  if (combatTurnResolveInFlight) return null;
  combatTurnResolveInFlight = true;
  try {
    const status = await request('/v1/session/status');
    const combat = status?.combat;
    if (status?.state !== 'COLLECTING_ACTIONS' || !status.sessionId || !combat?.active) {
      if (automatic) return null;
      throw new Error('nenhum combate ativo está pronto para narrar o turno.');
    }
    if (!combat.currentTurn?.actionCount) {
      if (automatic) return null;
      throw new Error('nenhuma ação foi registrada neste turno.');
    }
    const reference = snapshot ?? {
      id: combat.combatId, round: combat.round, turn: combat.turn, activeCombatant: combat.activeCombatant
    };
    const eventId = `combat-turn:${reference.id}:${reference.round}:${reference.turn}:${reference.activeCombatant?.id ?? 'unknown'}`;
    const result = await request('/v1/session/combat/turn/resolve', {
      method: 'POST',
      body: JSON.stringify({
        eventId,
        combatId: reference.id,
        round: reference.round,
        turn: reference.turn,
        combatantId: reference.activeCombatant?.id ?? null,
        actorId: reference.activeCombatant?.actorId ?? null,
        actorName: reference.activeCombatant?.name ?? null
      })
    });
    if (!result?.duplicate && result?.narration) {
      const publicationKey = `combat-turn:${reference.id}:${reference.round}:${reference.turn}:${reference.activeCombatant?.id ?? 'unknown'}`;
      await publishNarrationChat(result.narration, publicationKey);
      publishNarrationAudio(result.audio, result.narration, game.scenes?.active?.id ?? null, publicationKey);
    }
    if (!automatic) {
      ui.notifications?.info?.(`Mestre Orc: turno de ${reference.activeCombatant?.name ?? 'combatente'} narrado.`);
    }
    await refreshCombatButtons(result?.combat ?? null);
    return result;
  } catch (error) {
    console.error('[Mestre Orc][Combat] falha ao narrar turno', error);
    if (!automatic) ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    return null;
  } finally {
    combatTurnResolveInFlight = false;
    await refreshCombatButtons();
  }
}

async function summarizeCombatRound(roundNumber = null, snapshot = null, { automatic = false } = {}) {
  if (combatRoundSummaryInFlight) return null;
  combatRoundSummaryInFlight = true;
  try {
    const status = await request('/v1/session/status');
    const combat = status?.combat;
    if (status?.state !== 'COLLECTING_ACTIONS' || !status.sessionId || !combat?.active) {
      if (automatic) return null;
      throw new Error('nenhum combate ativo está pronto para resumir a rodada.');
    }
    const targetRound = Math.max(0, Number(roundNumber ?? snapshot?.round ?? combat.round) || 0);
    const roundStatus = targetRound === combat.round ? combat.currentRound : null;
    if (roundStatus && !roundStatus.canSummarize) {
      if (automatic) return null;
      throw new Error('nenhum turno resolvido está disponível para o resumo.');
    }
    const eventId = `combat-round:${snapshot?.id ?? combat.combatId}:${targetRound}`;
    const result = await request('/v1/session/combat/round/summary', {
      method: 'POST',
      body: JSON.stringify({ eventId, round: targetRound })
    });
    if (!result?.duplicate && result?.narration) {
      const publicationKey = `combat-round:${snapshot?.id ?? combat.combatId}:${targetRound}`;
      await publishNarrationChat(result.narration, publicationKey);
      publishNarrationAudio(result.audio, result.narration, game.scenes?.active?.id ?? null, publicationKey);
    }
    if (!automatic) ui.notifications?.info?.(`Mestre Orc: rodada ${targetRound} do combate resumida.`);
    await refreshCombatButtons(result?.combat ?? null);
    return result;
  } catch (error) {
    console.error('[Mestre Orc][Combat] falha ao resumir rodada', error);
    if (!automatic) ui.notifications?.warn?.(`Mestre Orc: ${error.message}`);
    return null;
  } finally {
    combatRoundSummaryInFlight = false;
    await refreshCombatButtons();
  }
}

function enqueueCombatHook(operation) {
  combatHookQueue = combatHookQueue.then(operation, operation);
  return combatHookQueue;
}

async function reconcileCombatDocument(combat) {
  if (!game.user?.isGM || !roomNarrationState.active) return;
  const next = combatSnapshotFromDocument(combat);
  if (!next.id || !next.started) return;
  const previous = lastCombatSnapshot;
  const changedTurn = previous?.started && previous.id === next.id && combatSnapshotKey(previous) !== combatSnapshotKey(next);

  if (changedTurn) {
    const statusBeforeAdvance = await request('/v1/session/status').catch(() => null);
    const previousTurn = statusBeforeAdvance?.combat?.currentTurn ?? null;
    const hadPendingEvents = Boolean(previousTurn?.actionCount && !previousTurn?.resolved);
    let previousTurnReady = !hadPendingEvents;
    if (audioSetting('combatAutoNarrateTurn', true) && hadPendingEvents) {
      previousTurnReady = Boolean(await resolveCombatTurn(previous, { automatic: true }));
    }
    if (previous.round !== next.round && previousTurnReady && audioSetting('combatAutoSummarizeRound', true)) {
      await summarizeCombatRound(previous.round, previous, { automatic: true });
    }
  }

  const result = await request('/v1/session/combat/sync', {
    method: 'POST',
    body: JSON.stringify(next)
  }).catch((error) => {
    console.warn('[Mestre Orc][Combat] sincronização do Combat Tracker falhou', error);
    return null;
  });
  lastCombatSnapshot = next;
  await refreshCombatButtons(result?.combat ?? null);
}

async function closeCombatDocument(combat) {
  if (!game.user?.isGM || !roomNarrationState.active) return;
  const previous = lastCombatSnapshot ?? combatSnapshotFromDocument(combat);
  if (previous?.id) {
    const statusBeforeClose = await request('/v1/session/status').catch(() => null);
    const currentTurn = statusBeforeClose?.combat?.currentTurn ?? null;
    const hadPendingEvents = Boolean(currentTurn?.actionCount && !currentTurn?.resolved);
    let currentTurnReady = !hadPendingEvents;
    if (audioSetting('combatAutoNarrateTurn', true) && hadPendingEvents) {
      currentTurnReady = Boolean(await resolveCombatTurn(previous, { automatic: true }));
    }
    if (currentTurnReady && audioSetting('combatAutoSummarizeRound', true)) {
      await summarizeCombatRound(previous.round, previous, { automatic: true });
    }
  }
  await request('/v1/session/combat/end', { method: 'POST', body: '{}' }).catch(() => null);
  lastCombatSnapshot = null;
  await refreshCombatButtons({ active: false });
}

function installCombatTrackerHooks() {
  if (document.documentElement.dataset.mestreOrcCombatHooks === '1') return;
  document.documentElement.dataset.mestreOrcCombatHooks = '1';
  Hooks.on('combatStart', (combat) => void enqueueCombatHook(() => reconcileCombatDocument(combat)));
  Hooks.on('updateCombat', (combat) => void enqueueCombatHook(() => reconcileCombatDocument(combat)));
  Hooks.on('createCombatant', (combatant) => void enqueueCombatHook(() => reconcileCombatDocument(combatant?.parent ?? game.combat)));
  Hooks.on('deleteCombatant', (combatant) => void enqueueCombatHook(() => reconcileCombatDocument(combatant?.parent ?? game.combat)));
  Hooks.on('deleteCombat', (combat) => void enqueueCombatHook(() => closeCombatDocument(combat)));
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
      resetRoomNarrationState(currentStatus.sessionId);
      primeRoomOccupancy();
      await refreshRoundButton(currentStatus.round ?? null);
      broadcastVoiceSessionStatus(true, currentStatus.round ?? null);
      if (game.combat?.started) await syncCombatDocument(game.combat).catch(() => null);
      else await refreshCombatButtons(currentStatus.combat ?? null);
      if (button) button.innerHTML = '<i class="fa-solid fa-circle-check"></i><span>Sessão reconectada</span>';
      ui.notifications.info('Mestre Orc: sessão existente reconectada.');
      setTimeout(() => {
        if (button?.isConnected) { button.innerHTML = original; button.disabled = false; }
        startInFlight = false;
      }, 1800);
      return;
    }

    if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Lendo a cena ativa...</span>';
    const snapshot = await collectSnapshot();
    setVoiceSessionActive(false);
    resetRoomNarrationState();

    if (button) button.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Gerando abertura...</span>';
    const result = await request('/v1/session/start', {
      method: 'POST',
      body: JSON.stringify({ snapshot })
    });

    roomNarrationState.sessionId = result.sessionId ?? null;
    await publishNarrationChat(result.opening, `opening:${result.sessionId ?? 'unknown'}`);
    publishNarrationAudio(
      result.audio,
      result.opening,
      snapshot.activeScene?.id ?? null,
      `opening:${result.sessionId ?? 'unknown'}`
    );
    primeRoomOccupancy();
    await refreshRoundButton(result.round ?? null);
    broadcastVoiceSessionStatus(true, result.round ?? null);
    if (game.combat?.started) await syncCombatDocument(game.combat).catch(() => null);
    else await refreshCombatButtons(result.combat ?? null);
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
    stopRoomMonitor();
    roomNarrationState.reset();
    applyRoundButtonState(null, false);
    applyCombatButtonState(null, false);
    broadcastVoiceSessionStatus(false);
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


function injectResolveRoundButton(root = document) {
  if (!game.user?.isGM || document.getElementById(ROUND_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;

  const button = document.createElement('button');
  button.id = ROUND_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'resolve-round';
  button.dataset.actionCount = '0';
  button.dataset.roundNumber = '1';
  button.disabled = true;
  button.innerHTML = '<i class="fa-solid fa-dice-d20"></i><span>Resolver rodada 1 (0)</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void resolveRound(button);
  };

  const startButton = document.getElementById(BUTTON_ID);
  const audioButton = document.getElementById(AUDIO_BUTTON_ID);
  if (startButton?.parentElement) startButton.insertAdjacentElement('afterend', button);
  else if (audioButton?.parentElement) audioButton.parentElement.insertBefore(button, audioButton);
  else chat.prepend(button);
  void refreshRoundButton();
  console.log(`${MODULE_ID} | botão de resolver rodada inserido`);
  return true;
}


function injectCombatButtons(root = document) {
  if (!game.user?.isGM) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;
  let inserted = false;

  if (!document.getElementById(COMBAT_TURN_BUTTON_ID)) {
    const button = document.createElement('button');
    button.id = COMBAT_TURN_BUTTON_ID;
    button.type = 'button';
    button.dataset.mestreOrcAction = 'resolve-combat-turn';
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-hand-fist"></i><span>Narrar turno — aguardando combate</span>';
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void resolveCombatTurn(null, { automatic: false });
    };
    const roundButton = document.getElementById(ROUND_BUTTON_ID);
    if (roundButton?.parentElement) roundButton.insertAdjacentElement('afterend', button);
    else chat.prepend(button);
    inserted = true;
  }

  if (!document.getElementById(COMBAT_ROUND_BUTTON_ID)) {
    const button = document.createElement('button');
    button.id = COMBAT_ROUND_BUTTON_ID;
    button.type = 'button';
    button.dataset.mestreOrcAction = 'summarize-combat-round';
    button.disabled = true;
    button.innerHTML = '<i class="fa-solid fa-shield-halved"></i><span>Resumo da rodada de combate</span>';
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      void summarizeCombatRound(null, null, { automatic: false });
    };
    const turnButton = document.getElementById(COMBAT_TURN_BUTTON_ID);
    if (turnButton?.parentElement) turnButton.insertAdjacentElement('afterend', button);
    else chat.prepend(button);
    inserted = true;
  }

  void refreshCombatButtons();
  return inserted;
}


function injectMemoryButton(root = document) {
  if (!game.user?.isGM || document.getElementById(MEMORY_BUTTON_ID)) return false;
  const chat = findChatContainer(root);
  if (!chat) return false;

  const button = document.createElement('button');
  button.id = MEMORY_BUTTON_ID;
  button.type = 'button';
  button.dataset.mestreOrcAction = 'open-memory';
  button.innerHTML = '<i class="fa-solid fa-book-atlas"></i><span>Memória da campanha</span>';
  button.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openCampaignMemoryPanel();
  };

  const combatRoundButton = document.getElementById(COMBAT_ROUND_BUTTON_ID);
  const roundButton = document.getElementById(ROUND_BUTTON_ID);
  const audioButton = document.getElementById(AUDIO_BUTTON_ID);
  if (combatRoundButton?.parentElement) combatRoundButton.insertAdjacentElement('afterend', button);
  else if (roundButton?.parentElement) roundButton.insertAdjacentElement('afterend', button);
  else if (audioButton?.parentElement) audioButton.parentElement.insertBefore(button, audioButton);
  else chat.prepend(button);
  return true;
}

function installDelegatedStartHandler() {
  if (document.documentElement.dataset.mestreOrcDelegated === '1') return;
  document.documentElement.dataset.mestreOrcDelegated = '1';

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-mestre-orc-action="start-session"], [data-mestre-orc-action="resolve-round"], [data-mestre-orc-action="resolve-combat-turn"], [data-mestre-orc-action="summarize-combat-round"], [data-mestre-orc-action="open-memory"], [data-mestre-orc-action="open-adventure-library"], [data-mestre-orc-action="open-ai-providers"], [data-mestre-orc-action="open-voice-profiles"], [data-mestre-orc-action="open-generators"], [data-mestre-orc-action="open-maps"], [data-mestre-orc-action="open-tutors"], #mestre-orc-start, #mestre-orc-resolve-round, #mestre-orc-combat-turn, #mestre-orc-combat-round, #mestre-orc-memory, #mestre-orc-adventure-library, #mestre-orc-ai-providers, #mestre-orc-voice-profiles, #mestre-orc-generators, #mestre-orc-maps, #mestre-orc-tutors')
      : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    console.log('[Mestre Orc] handler delegado acionado', { action: target.dataset.mestreOrcAction });
    if (target.dataset.mestreOrcAction === 'resolve-round' || target.id === ROUND_BUTTON_ID) void resolveRound(target);
    else if (target.dataset.mestreOrcAction === 'resolve-combat-turn' || target.id === COMBAT_TURN_BUTTON_ID) void resolveCombatTurn(null, { automatic: false });
    else if (target.dataset.mestreOrcAction === 'summarize-combat-round' || target.id === COMBAT_ROUND_BUTTON_ID) void summarizeCombatRound(null, null, { automatic: false });
    else if (target.dataset.mestreOrcAction === 'open-memory' || target.id === MEMORY_BUTTON_ID) void openCampaignMemoryPanel();
    else if (target.dataset.mestreOrcAction === 'open-adventure-library' || target.id === ADVENTURE_BUTTON_ID) void openAdventureLibraryPanel({ request });
    else if (target.dataset.mestreOrcAction === 'open-ai-providers' || target.id === AI_PROVIDER_BUTTON_ID) void openAiProviderPanel({ request });
    else if (target.dataset.mestreOrcAction === 'open-voice-profiles' || target.id === VOICE_PROFILE_BUTTON_ID) void openVoiceProfilePanel({ request });
    else if (target.dataset.mestreOrcAction === 'open-generators' || target.id === GENERATOR_BUTTON_ID) void openGeneratorPanel({ request });
    else if (target.dataset.mestreOrcAction === 'open-maps' || target.id === MAP_BUTTON_ID) void openMapPanel({ request });
    else if (target.dataset.mestreOrcAction === 'open-tutors' || target.id === TUTOR_BUTTON_ID) void openTutorPanel({ request });
    else void startSession(target);
  }, true);
}

function scheduleInjection(root) {
  requestAnimationFrame(() => {
    injectStartButton(root);
    injectResolveRoundButton(root);
    injectCombatButtons(root);
    injectMemoryButton(root);
    injectAdventureLibraryButton({ root, request, findChatContainer });
    injectGeneratorButton({ root, request, findChatContainer });
    injectMapButton({ root, request, findChatContainer });
    injectTutorButton({ root, request, findChatContainer });
    injectAiProviderButton({ root, request, findChatContainer });
    injectVoiceProfileButton({ root, request, findChatContainer });
    injectAudioToggleButton(root);
    injectVoiceInputButton(root);
    setTimeout(() => {
      injectStartButton(document);
      injectResolveRoundButton(document);
      injectCombatButtons(document);
      injectMemoryButton(document);
      injectAdventureLibraryButton({ root: document, request, findChatContainer });
      injectGeneratorButton({ root: document, request, findChatContainer });
      injectMapButton({ root: document, request, findChatContainer });
      injectTutorButton({ root: document, request, findChatContainer });
      injectAiProviderButton({ root: document, request, findChatContainer });
      injectVoiceProfileButton({ root: document, request, findChatContainer });
      injectAudioToggleButton(document);
      injectVoiceInputButton(document);
    }, 250);
    setTimeout(() => {
      injectStartButton(document);
      injectResolveRoundButton(document);
      injectCombatButtons(document);
      injectMemoryButton(document);
      injectAdventureLibraryButton({ root: document, request, findChatContainer });
      injectGeneratorButton({ root: document, request, findChatContainer });
      injectMapButton({ root: document, request, findChatContainer });
      injectTutorButton({ root: document, request, findChatContainer });
      injectAiProviderButton({ root: document, request, findChatContainer });
      injectVoiceProfileButton({ root: document, request, findChatContainer });
      injectAudioToggleButton(document);
      injectVoiceInputButton(document);
    }, 1000);
  });
}


console.log('[Mestre Orc] main.js carregado', { version: MODULE_BUILD });

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

    tokenControls.tools.mestreOrcResolveRound = {
      name: 'mestreOrcResolveRound',
      title: 'Mestre Orc — Resolver rodada narrativa',
      icon: 'fa-solid fa-dice-d20',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] resolução de rodada acionada pelos controles da cena');
        void resolveRound(null);
      }
    };

    tokenControls.tools.mestreOrcCombatTurn = {
      name: 'mestreOrcCombatTurn',
      title: 'Mestre Orc — Narrar turno de combate',
      icon: 'fa-solid fa-hand-fist',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => void resolveCombatTurn(null, { automatic: false })
    };

    tokenControls.tools.mestreOrcCombatRound = {
      name: 'mestreOrcCombatRound',
      title: 'Mestre Orc — Resumo da rodada de combate',
      icon: 'fa-solid fa-shield-halved',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => void summarizeCombatRound(null, null, { automatic: false })
    };

    tokenControls.tools.mestreOrcMemory = {
      name: 'mestreOrcMemory',
      title: 'Mestre Orc — Memória da campanha',
      icon: 'fa-solid fa-book-atlas',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] memória da campanha aberta pelos controles da cena');
        void openCampaignMemoryPanel();
      }
    };

    tokenControls.tools.mestreOrcAdventureLibrary = {
      name: 'mestreOrcAdventureLibrary',
      title: 'Mestre Orc — Biblioteca da aventura',
      icon: 'fa-solid fa-book-open-reader',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] biblioteca da aventura aberta pelos controles da cena');
        void openAdventureLibraryPanel({ request });
      }
    };

    tokenControls.tools.mestreOrcGenerators = {
      name: 'mestreOrcGenerators',
      title: 'Mestre Orc — Forja de conteúdo',
      icon: 'fa-solid fa-wand-magic-sparkles',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] geradores abertos pelos controles da cena');
        void openGeneratorPanel({ request });
      }
    };

    tokenControls.tools.mestreOrcMaps = {
      name: 'mestreOrcMaps',
      title: 'Mestre Orc — Mapas automáticos e Scenes',
      icon: 'fa-solid fa-map',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] mapas abertos pelos controles da cena');
        void openMapPanel({ request });
      }
    };

    tokenControls.tools.mestreOrcTutors = {
      name: 'mestreOrcTutors',
      title: 'Mestre Orc — Tutor de Ficha e Tutor de Mestre',
      icon: 'fa-solid fa-graduation-cap',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] tutores abertos pelos controles da cena');
        void openTutorPanel({ request });
      }
    };

    tokenControls.tools.mestreOrcAiProviders = {
      name: 'mestreOrcAiProviders',
      title: 'Mestre Orc — Saúde dos provedores de IA',
      icon: 'fa-solid fa-tower-broadcast',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] painel de provedores aberto pelos controles da cena');
        void openAiProviderPanel({ request });
      }
    };

    tokenControls.tools.mestreOrcVoiceProfiles = {
      name: 'mestreOrcVoiceProfiles',
      title: 'Mestre Orc — Vozes do narrador e dos NPCs',
      icon: 'fa-solid fa-microphone-lines',
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => {
        console.log('[Mestre Orc] perfis de voz abertos pelos controles da cena');
        void openVoiceProfilePanel({ request });
      }
    };

    console.log('[Mestre Orc] botões adicionados aos controles da cena');
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
  installCombatTrackerHooks();
  ensureVoiceInputController();
  if (supportsSpeechSynthesis()) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', refreshSpeechVoices);
  }
});
Hooks.once('ready', () => {
  console.log('[Mestre Orc] módulo pronto', {
    build: MODULE_BUILD,
    installedVersion: game.modules?.get?.(MODULE_ID)?.version ?? null
  });
  ui.notifications?.info?.(`Mestre Orc ${MODULE_BUILD} carregado.`);
  installAudioSocket();
  scheduleInjection(document);
  if (game.user?.isGM) {
    void synchronizeRoomSessionState().then(() => {
      if (game.combat?.started) return reconcileCombatDocument(game.combat);
      return refreshCombatButtons();
    });
  }
  else {
    requestVoiceSessionStatus();
    setTimeout(requestVoiceSessionStatus, 1200);
    setTimeout(requestVoiceSessionStatus, 3500);
  }
});
Hooks.on('renderChatLog', (_app, html) => scheduleInjection(asElement(html) ?? document));
Hooks.on('renderSidebarTab', (app, html) => {
  const tabName = app?.tabName ?? app?.options?.id ?? '';
  if (String(tabName).toLowerCase().includes('chat')) scheduleInjection(asElement(html) ?? document);
});
