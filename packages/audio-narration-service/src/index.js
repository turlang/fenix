function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function normalizeCinematicText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortText(value, limit = 300) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeMode(value) {
  const mode = String(value || 'browser-tts').trim().toLowerCase();
  return ['browser-tts', 'neural-auto', 'neural-only'].includes(mode) ? mode : 'browser-tts';
}

export class AudioNarrationService {
  constructor({
    enabled = true,
    mode = 'browser-tts',
    language = 'pt-BR',
    rate = 0.9,
    pitch = 0.85,
    volume = 1,
    synthesisPath = '/v1/audio/synthesize',
    logger = console
  } = {}) {
    this.enabled = Boolean(enabled);
    this.mode = normalizeMode(mode);
    this.language = String(language || 'pt-BR');
    this.rate = clamp(rate, 0.5, 2, 0.9);
    this.pitch = clamp(pitch, 0, 2, 0.85);
    this.volume = clamp(volume, 0, 1, 1);
    this.synthesisPath = String(synthesisPath || '/v1/audio/synthesize');
    this.logger = logger;
  }

  createDirective(text, metadata = {}) {
    if (!this.enabled) return null;
    const normalizedText = normalizeCinematicText(text);
    if (!normalizedText) return null;

    const speakerType = String(metadata.speakerType ?? (metadata.npcId ? 'NPC' : 'NARRATOR')).toUpperCase();
    const directive = {
      id: crypto.randomUUID(),
      mode: this.mode,
      fallbackMode: this.mode === 'neural-only' ? null : 'browser-tts',
      synthesisPath: this.mode === 'browser-tts' ? null : this.synthesisPath,
      text: normalizedText,
      language: this.language,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
      sceneId: metadata.sceneId ?? null,
      sessionId: metadata.sessionId ?? null,
      campaignId: shortText(metadata.campaignId ?? metadata.worldId, 200) || null,
      profileId: shortText(metadata.profileId, 200) || null,
      speakerType: speakerType === 'NPC' ? 'NPC' : 'NARRATOR',
      npcId: shortText(metadata.npcId, 200) || null,
      npcName: shortText(metadata.npcName, 300) || null,
      aiGenerated: this.mode !== 'browser-tts',
      disclosure: this.mode !== 'browser-tts' ? 'Voz gerada por inteligência artificial.' : null,
      createdAt: new Date().toISOString()
    };

    this.logger.info?.('[Mestre Orc][Audio] diretiva de narração criada', {
      id: directive.id,
      mode: directive.mode,
      language: directive.language,
      sceneId: directive.sceneId,
      speakerType: directive.speakerType,
      npcId: directive.npcId,
      characters: normalizedText.length
    });

    return directive;
  }
}

export function createAudioNarrationServiceFromEnv({ logger = console } = {}) {
  const enabled = !/^(0|false|off|disabled)$/i.test(String(process.env.MESTRE_ORC_AUDIO_ENABLED ?? 'true'));
  return new AudioNarrationService({
    enabled,
    mode: process.env.MESTRE_ORC_AUDIO_MODE ?? 'browser-tts',
    language: process.env.MESTRE_ORC_AUDIO_LANGUAGE ?? 'pt-BR',
    rate: process.env.MESTRE_ORC_AUDIO_RATE ?? 0.9,
    pitch: process.env.MESTRE_ORC_AUDIO_PITCH ?? 0.85,
    volume: process.env.MESTRE_ORC_AUDIO_VOLUME ?? 1,
    synthesisPath: process.env.MESTRE_ORC_AUDIO_SYNTHESIS_PATH ?? '/v1/audio/synthesize',
    logger
  });
}

export const audioNarrationInternals = { normalizeCinematicText, normalizeMode };
