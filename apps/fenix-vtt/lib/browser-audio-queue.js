function speechTextFromDirective(directive = {}) {
  const segments = Array.isArray(directive.segments) ? directive.segments : [];
  if (segments.length) {
    return segments
      .map((segment) => String(segment?.text ?? '').trim())
      .filter(Boolean)
      .join(' ');
  }
  return String(directive.text ?? '').trim();
}

export class BrowserAudioQueue {
  constructor({ speechSynthesis = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    this.speechSynthesis = speechSynthesis;
    this.Utterance = Utterance;
    this.queue = [];
    this.playing = false;
    this.destroyed = false;
  }

  get supported() {
    return Boolean(this.speechSynthesis && this.Utterance);
  }

  enqueue(directive) {
    if (this.destroyed || !directive) return false;
    const text = speechTextFromDirective(directive);
    if (!text) return false;
    this.queue.push({ directive, text });
    void this.#drain();
    return true;
  }

  clear() {
    this.queue.length = 0;
  }

  stop() {
    this.clear();
    this.speechSynthesis?.cancel?.();
    this.playing = false;
  }

  destroy() {
    this.stop();
    this.destroyed = true;
  }

  async #drain() {
    if (this.playing || this.destroyed || !this.supported) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    await new Promise((resolve) => {
      const utterance = new this.Utterance(next.text);
      utterance.lang = next.directive.language || 'pt-BR';
      utterance.rate = Number(next.directive.rate) || 0.9;
      utterance.pitch = Number(next.directive.pitch) || 0.85;
      utterance.volume = Number(next.directive.volume) || 1;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      this.speechSynthesis.speak(utterance);
    });
    this.playing = false;
    void this.#drain();
  }
}

export function createBrowserAudioQueue(options) {
  return new BrowserAudioQueue(options);
}
