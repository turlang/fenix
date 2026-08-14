import { createHash } from 'node:crypto';

const PROVIDER_IDS = ['elevenlabs', 'openai', 'compatible'];
const MIME_BY_FORMAT = {
  mp3: 'audio/mpeg', opus: 'audio/ogg', aac: 'audio/aac', flac: 'audio/flac', wav: 'audio/wav', pcm: 'audio/L16'
};

function text(value, limit = 4096) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, limit);
}

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function safeError(error, fallbackCode = 'VOICE_PROVIDER_FAILED') {
  const status = Number(error?.status ?? error?.statusCode) || null;
  const code = text(error?.code, 80) || (status ? `HTTP_${status}` : fallbackCode);
  let message = text(error?.message, 300) || 'O provedor de voz não respondeu.';
  message = message
    .replace(/(?:sk|xi)-[A-Za-z0-9_-]{8,}/g, '[credencial removida]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [removido]');
  return { code, message, status };
}

function parseOrder(value) {
  const order = String(value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return [...new Set(order.filter((entry) => PROVIDER_IDS.includes(entry)))];
}

function providerConfigFromEnv(env = process.env) {
  return {
    elevenlabs: {
      id: 'elevenlabs',
      enabled: Boolean(env.ELEVENLABS_API_KEY),
      apiKey: env.ELEVENLABS_API_KEY ?? '',
      baseUrl: String(env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io/v1').replace(/\/$/, ''),
      model: env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
      voiceId: env.ELEVENLABS_TTS_VOICE_ID || '',
      outputFormat: env.ELEVENLABS_TTS_OUTPUT_FORMAT || 'mp3_44100_128'
    },
    openai: {
      id: 'openai',
      enabled: Boolean(env.OPENAI_API_KEY),
      apiKey: env.OPENAI_API_KEY ?? '',
      baseUrl: String(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
      voiceId: env.OPENAI_TTS_VOICE || 'marin',
      format: env.OPENAI_TTS_FORMAT || 'mp3'
    },
    compatible: {
      id: 'compatible',
      enabled: Boolean(env.COMPATIBLE_TTS_BASE_URL),
      apiKey: env.COMPATIBLE_TTS_API_KEY ?? '',
      baseUrl: String(env.COMPATIBLE_TTS_BASE_URL || '').replace(/\/$/, ''),
      model: env.COMPATIBLE_TTS_MODEL || 'tts-1',
      voiceId: env.COMPATIBLE_TTS_VOICE || 'alloy',
      format: env.COMPATIBLE_TTS_FORMAT || 'mp3'
    }
  };
}

function cacheKey(textValue, provider, profile) {
  return createHash('sha256').update(JSON.stringify({
    text: textValue,
    provider,
    voiceId: profile?.voiceId,
    model: profile?.model,
    language: profile?.language,
    instructions: profile?.instructions,
    speed: profile?.speed,
    stability: profile?.stability,
    similarityBoost: profile?.similarityBoost,
    style: profile?.style,
    useSpeakerBoost: profile?.useSpeakerBoost
  })).digest('hex');
}

async function responseError(response) {
  const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  const error = new Error(payload?.error?.message || payload?.detail?.message || payload?.message || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload?.error?.code || payload?.code || `HTTP_${response.status}`;
  return error;
}

export class NeuralVoiceService {
  constructor({
    enabled = true,
    order = ['elevenlabs', 'openai', 'compatible'],
    providers = providerConfigFromEnv(),
    fetchImpl = globalThis.fetch,
    timeoutMs = 45_000,
    maxCharacters = 4096,
    maxAudioBytes = 12 * 1024 * 1024,
    cacheTtlMs = 10 * 60 * 1000,
    logger = console
  } = {}) {
    this.enabled = Boolean(enabled);
    this.order = [...new Set(order.filter((entry) => PROVIDER_IDS.includes(entry)))];
    this.providers = providers;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = clamp(timeoutMs, 1000, 120_000, 45_000);
    this.maxCharacters = clamp(maxCharacters, 100, 4096, 4096);
    this.maxAudioBytes = clamp(maxAudioBytes, 64 * 1024, 24 * 1024 * 1024, 12 * 1024 * 1024);
    this.cacheTtlMs = clamp(cacheTtlMs, 0, 60 * 60 * 1000, 10 * 60 * 1000);
    this.logger = logger;
    this.cache = new Map();
    this.inFlight = new Map();
    this.metrics = { requests: 0, successes: 0, failures: 0, cacheHits: 0, fallbackSuccesses: 0, lastProvider: null };
  }

  configuredProviders() {
    return this.order.filter((providerId) => this.providers[providerId]?.enabled);
  }

  getStatus() {
    const configured = this.configuredProviders();
    return {
      enabled: this.enabled,
      configured: this.enabled && configured.length > 0,
      order: configured,
      lastProvider: this.metrics.lastProvider,
      metrics: { ...this.metrics },
      providers: this.order.map((providerId) => {
        const provider = this.providers[providerId] ?? {};
        return {
          id: providerId,
          configured: Boolean(provider.enabled),
          model: provider.model || null,
          defaultVoiceId: provider.voiceId || null,
          baseUrl: (() => { try { return provider.baseUrl ? new URL(provider.baseUrl).origin : null; } catch { return null; } })()
        };
      })
    };
  }

  providerOrder(profile = null) {
    const preferred = String(profile?.provider ?? '').toLowerCase();
    if (preferred === 'browser') return [];
    const candidates = preferred && PROVIDER_IDS.includes(preferred)
      ? [preferred, ...this.order.filter((entry) => entry !== preferred)]
      : this.order;
    return candidates.filter((providerId) => this.providers[providerId]?.enabled);
  }

  async synthesize({ text: input, profile = null } = {}) {
    const normalizedText = text(input, this.maxCharacters);
    if (!this.enabled) throw Object.assign(new Error('A voz neural está desativada.'), { code: 'NEURAL_VOICE_DISABLED', statusCode: 503 });
    if (!normalizedText) throw Object.assign(new Error('O texto para voz está vazio.'), { code: 'VOICE_TEXT_EMPTY', statusCode: 400 });
    const order = this.providerOrder(profile);
    if (!order.length) throw Object.assign(new Error('Nenhum provedor de voz neural está configurado.'), { code: 'VOICE_NOT_CONFIGURED', statusCode: 503 });

    this.metrics.requests += 1;
    const failures = [];
    for (let index = 0; index < order.length; index += 1) {
      const providerId = order[index];
      const key = cacheKey(normalizedText, providerId, profile);
      const cached = this.cache.get(key);
      if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
        this.metrics.cacheHits += 1;
        this.metrics.successes += 1;
        this.metrics.lastProvider = providerId;
        return { ...cached.result, cached: true };
      }
      if (this.inFlight.has(key)) {
        this.metrics.cacheHits += 1;
        const result = await this.inFlight.get(key);
        return { ...result, cached: true };
      }

      const promise = this.#synthesizeWith(providerId, normalizedText, profile)
        .then((result) => {
          this.cache.set(key, { cachedAt: Date.now(), result });
          return result;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, promise);

      try {
        const result = await promise;
        this.metrics.successes += 1;
        if (index > 0) this.metrics.fallbackSuccesses += 1;
        this.metrics.lastProvider = providerId;
        return { ...result, cached: false, fallbackUsed: index > 0 };
      } catch (error) {
        const sanitized = safeError(error);
        failures.push({ provider: providerId, ...sanitized });
        this.logger.warn?.('[Mestre Orc][NeuralVoice] provedor indisponível', { provider: providerId, code: sanitized.code, status: sanitized.status });
      }
    }

    this.metrics.failures += 1;
    const error = new Error('Nenhum provedor de voz neural conseguiu gerar o áudio.');
    error.code = 'ALL_VOICE_PROVIDERS_FAILED';
    error.statusCode = 502;
    error.failures = failures;
    throw error;
  }

  async #synthesizeWith(providerId, input, profile) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const effectiveProfile = profile && String(profile.provider || '').toLowerCase() !== providerId
        ? { ...profile, voiceId: null, model: null }
        : profile;
      let response;
      if (providerId === 'elevenlabs') response = await this.#elevenLabs(input, effectiveProfile, controller.signal);
      else response = await this.#openAiCompatible(providerId, input, effectiveProfile, controller.signal);
      if (!response.ok) throw await responseError(response);
      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer.byteLength) throw Object.assign(new Error('O provedor retornou áudio vazio.'), { code: 'EMPTY_AUDIO' });
      if (arrayBuffer.byteLength > this.maxAudioBytes) throw Object.assign(new Error('O áudio gerado excedeu o limite permitido.'), { code: 'AUDIO_TOO_LARGE' });
      const config = this.providers[providerId];
      const format = providerId === 'elevenlabs'
        ? String(config.outputFormat || 'mp3').split('_')[0]
        : String(profile?.format || config.format || 'mp3');
      return {
        provider: providerId,
        model: effectiveProfile?.model || config.model || null,
        voiceId: effectiveProfile?.voiceId || config.voiceId || null,
        mimeType: response.headers.get('content-type')?.split(';')[0] || MIME_BY_FORMAT[format] || 'audio/mpeg',
        audioBase64: Buffer.from(arrayBuffer).toString('base64'),
        byteLength: arrayBuffer.byteLength,
        aiGenerated: true,
        disclosure: 'Voz gerada por inteligência artificial.'
      };
    } catch (error) {
      if (error?.name === 'AbortError') {
        const timeout = new Error(`Tempo limite de ${this.timeoutMs} ms excedido.`);
        timeout.code = 'VOICE_TIMEOUT';
        timeout.status = 504;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async #openAiCompatible(providerId, input, profile, signal) {
    const config = this.providers[providerId];
    const headers = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const model = profile?.model || config.model;
    const body = {
      model,
      input,
      voice: profile?.voiceId || config.voiceId,
      response_format: profile?.format || config.format || 'mp3',
      speed: clamp(profile?.speed, 0.25, 4, 1)
    };
    if (profile?.instructions && !/^tts-1(?:-hd)?$/i.test(model)) body.instructions = text(profile.instructions, 4096);
    return this.fetchImpl(`${config.baseUrl}/audio/speech`, {
      method: 'POST', headers, body: JSON.stringify(body), signal
    });
  }

  async #elevenLabs(input, profile, signal) {
    const config = this.providers.elevenlabs;
    const voiceId = profile?.voiceId || config.voiceId;
    if (!voiceId) throw Object.assign(new Error('O voiceId da ElevenLabs não foi configurado.'), { code: 'VOICE_ID_REQUIRED' });
    const language = String(profile?.language || '').split('-')[0].toLowerCase();
    const query = new URLSearchParams({ output_format: config.outputFormat || 'mp3_44100_128' });
    const body = {
      text: input,
      model_id: profile?.model || config.model,
      voice_settings: {
        stability: clamp(profile?.stability, 0, 1, 0.5),
        similarity_boost: clamp(profile?.similarityBoost, 0, 1, 0.75),
        style: clamp(profile?.style, 0, 1, 0),
        use_speaker_boost: profile?.useSpeakerBoost !== false,
        speed: clamp(profile?.speed, 0.7, 1.2, 1)
      }
    };
    if (language && language !== 'pt') body.language_code = language;
    return this.fetchImpl(`${config.baseUrl}/text-to-speech/${encodeURIComponent(voiceId)}?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': config.apiKey },
      body: JSON.stringify(body),
      signal
    });
  }
}

export function createNeuralVoiceServiceFromEnv({ logger = console, fetchImpl = globalThis.fetch } = {}) {
  const providers = providerConfigFromEnv(process.env);
  const configuredOrder = parseOrder(process.env.VOICE_PROVIDER_ORDER);
  return new NeuralVoiceService({
    enabled: bool(process.env.NEURAL_VOICE_ENABLED, true),
    order: configuredOrder.length ? configuredOrder : PROVIDER_IDS,
    providers,
    fetchImpl,
    timeoutMs: process.env.VOICE_PROVIDER_TIMEOUT_MS || 45_000,
    maxCharacters: process.env.VOICE_MAX_CHARACTERS || 4096,
    maxAudioBytes: process.env.VOICE_MAX_AUDIO_BYTES || 12 * 1024 * 1024,
    cacheTtlMs: process.env.VOICE_CACHE_TTL_MS || 10 * 60 * 1000,
    logger
  });
}

export const neuralVoiceInternals = { providerConfigFromEnv, parseOrder, safeError, cacheKey, MIME_BY_FORMAT };
