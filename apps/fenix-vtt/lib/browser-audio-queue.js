const EMOTION_PROFILES = Object.freeze({
  neutral: Object.freeze({ rate: 1, pitch: 1, volume: 1 }),
  calmo: Object.freeze({ rate: 0.92, pitch: 0.98, volume: 0.96 }),
  tenso: Object.freeze({ rate: 0.94, pitch: 0.94, volume: 1 }),
  sussurro: Object.freeze({ rate: 0.84, pitch: 0.98, volume: 0.72 }),
  urgente: Object.freeze({ rate: 1.12, pitch: 1.03, volume: 1 })
});

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function speechUnits(value) {
  const text = normalizeText(value);
  if (!text) return [];
  const matches = text.match(/[^.!?…]+(?:[.!?…]+|$)/g);
  return (matches ?? [text]).map((item) => item.trim()).filter(Boolean);
}

function cadencePauseMs(text) {
  const value = String(text ?? '').trim();
  if (/…$/.test(value)) return 240;
  if (/[!?]$/.test(value)) return 150;
  if (/\.$/.test(value)) return 105;
  return 70;
}

export function createProsodyPlan(directive = {}) {
  const inputSegments = Array.isArray(directive.segments) && directive.segments.length
    ? directive.segments
    : [{ type: 'speech', emotion: 'neutral', text: directive.text }];
  const plan = [];

  for (const segment of inputSegments) {
    if (segment?.type === 'pause') {
      plan.push({
        type: 'pause',
        durationMs: clamp(segment.durationMs, 60, 2500, 350),
        explicit: true
      });
      continue;
    }

    if (segment?.type !== 'speech') continue;
    const emotion = EMOTION_PROFILES[segment.emotion] ? segment.emotion : 'neutral';
    const units = speechUnits(segment.text);
    units.forEach((text, index) => {
      plan.push({ type: 'speech', emotion, text });
      if (index < units.length - 1) {
        plan.push({
          type: 'pause',
          durationMs: cadencePauseMs(text),
          explicit: false
        });
      }
    });
  }

  return plan;
}

export function resolveSpeechSettings(directive = {}, segment = {}) {
  const profile = EMOTION_PROFILES[segment.emotion] ?? EMOTION_PROFILES.neutral;
  let rate = (Number(directive.rate) || 0.92) * profile.rate;
  let pitch = (Number(directive.pitch) || 0.95) * profile.pitch;
  const volume = (Number(directive.volume) || 1) * profile.volume;
  const text = String(segment.text ?? '').trim();

  if (/…$/.test(text)) rate *= 0.95;
  if (/\?$/.test(text)) pitch *= 1.025;
  if (/!$/.test(text)) rate *= 1.035;

  return {
    rate: clamp(rate, 0.68, 1.32, 0.92),
    pitch: clamp(pitch, 0.72, 1.24, 0.95),
    volume: clamp(volume, 0.35, 1, 1)
  };
}

function selectVoice(speechSynthesis, directive = {}) {
  const voices = speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return null;

  const preferredName = String(directive.voiceName ?? '').trim().toLowerCase();
  if (preferredName) {
    const preferred = voices.find((voice) => String(voice.name ?? '').toLowerCase() === preferredName);
    if (preferred) return preferred;
  }

  const language = String(directive.language || 'pt-BR').toLowerCase();
  const exact = voices.find((voice) => String(voice.lang ?? '').toLowerCase() === language);
  if (exact) return exact;

  const family = language.split('-')[0];
  return voices.find((voice) => String(voice.lang ?? '').toLowerCase().startsWith(`${family}-`))
    ?? voices.find((voice) => String(voice.lang ?? '').toLowerCase() === family)
    ?? null;
}

export class BrowserAudioQueue {
  constructor({ speechSynthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    this.speechSynthesis = speechSynthesis;
    this.Utterance = Utterance;
    this.queue = [];
    this.playing = false;
    this.destroyed = false;
    this.playbackToken = 0;
  }

  get supported() {
    return Boolean(this.speechSynthesis && this.Utterance);
  }

  enqueue(directive) {
    if (this.destroyed || !directive) return false;
    const plan = createProsodyPlan(directive);
    if (!plan.some((segment) => segment.type === 'speech' && segment.text)) return false;
    this.queue.push({ directive, plan });
    void this.#drain();
    return true;
  }

  clear() {
    this.queue.length = 0;
  }

  stop() {
    this.playbackToken += 1;
    this.clear();
    this.speechSynthesis?.cancel?.();
    this.playing = false;
  }

  destroy() {
    this.stop();
    this.destroyed = true;
  }

  async #speakSegment(directive, segment) {
    await new Promise((resolve) => {
      const utterance = new this.Utterance(segment.text);
      const settings = resolveSpeechSettings(directive, segment);
      utterance.lang = directive.language || 'pt-BR';
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;
      utterance.volume = settings.volume;
      const voice = selectVoice(this.speechSynthesis, directive);
      if (voice) utterance.voice = voice;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      this.speechSynthesis.speak(utterance);
    });
  }

  async #drain() {
    if (this.playing || this.destroyed || !this.supported) return;
    const next = this.queue.shift();
    if (!next) return;

    const token = this.playbackToken;
    this.playing = true;
    for (const segment of next.plan) {
      if (token !== this.playbackToken || this.destroyed) break;
      if (segment.type === 'pause') {
        await new Promise((resolve) => setTimeout(resolve, segment.durationMs));
        continue;
      }
      await this.#speakSegment(next.directive, segment);
    }

    if (token === this.playbackToken) {
      this.playing = false;
      void this.#drain();
    }
  }
}

export function createBrowserAudioQueue(options) {
  return new BrowserAudioQueue(options);
}
