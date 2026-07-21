function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export class AudioNarrationService {
  constructor({
    enabled = true,
    mode = 'browser-tts',
    language = 'pt-BR',
    rate = 0.9,
    pitch = 0.85,
    volume = 1,
    logger = console
  } = {}) {
    this.enabled = Boolean(enabled);
    this.mode = String(mode || 'browser-tts');
    this.language = String(language || 'pt-BR');
    this.rate = clamp(rate, 0.5, 2, 0.9);
    this.pitch = clamp(pitch, 0, 2, 0.85);
    this.volume = clamp(volume, 0, 1, 1);
    this.logger = logger;
  }

  createDirective(text, metadata = {}) {
    if (!this.enabled) return null;
    const normalizedText = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!normalizedText) return null;

    const directive = {
      id: crypto.randomUUID(),
      mode: this.mode,
      text: normalizedText,
      language: this.language,
      rate: this.rate,
      pitch: this.pitch,
      volume: this.volume,
      sceneId: metadata.sceneId ?? null,
      sessionId: metadata.sessionId ?? null,
      createdAt: new Date().toISOString()
    };

    this.logger.info?.('[Mestre Orc][Audio] diretiva de narração criada', {
      id: directive.id,
      mode: directive.mode,
      language: directive.language,
      sceneId: directive.sceneId,
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
    logger
  });
}
