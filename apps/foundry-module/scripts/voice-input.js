export function normalizeVoiceTranscript(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .trim();
}

export function resolveSpeechRecognitionConstructor(scope = globalThis) {
  return scope?.SpeechRecognition ?? scope?.webkitSpeechRecognition ?? null;
}

export function speechRecognitionSupported(scope = globalThis) {
  return typeof resolveSpeechRecognitionConstructor(scope) === 'function';
}

export function speechRecognitionErrorMessage(code) {
  const normalized = String(code ?? '').trim().toLowerCase();
  const messages = {
    'not-allowed': 'permissão do microfone negada pelo navegador.',
    'service-not-allowed': 'o serviço de reconhecimento de voz foi bloqueado pelo navegador.',
    'audio-capture': 'nenhum microfone disponível foi encontrado.',
    'no-speech': 'nenhuma fala foi detectada.',
    network: 'o serviço de transcrição não respondeu. Verifique a conexão.',
    aborted: 'captura de voz cancelada.',
    'language-not-supported': 'o idioma configurado não é suportado pelo navegador.'
  };
  return messages[normalized] ?? 'não foi possível reconhecer a fala.';
}

export class VoiceInputController {
  constructor({
    scope = globalThis,
    language = 'pt-BR',
    onStateChange = () => {},
    onInterim = () => {},
    onFinal = () => {},
    onError = () => {},
    logger = console
  } = {}) {
    this.scope = scope;
    this.language = language;
    this.onStateChange = onStateChange;
    this.onInterim = onInterim;
    this.onFinal = onFinal;
    this.onError = onError;
    this.logger = logger;
    this.recognition = null;
    this.state = speechRecognitionSupported(scope) ? 'idle' : 'unsupported';
    this.finalChunks = [];
    this.interimTranscript = '';
    this.intentionalStop = false;
    this.abortedByUser = false;
    this.terminalError = null;
    this.finalDelivered = false;
  }

  setState(next) {
    if (this.state === next) return;
    this.state = next;
    this.onStateChange(next);
  }

  setLanguage(language) {
    this.language = normalizeVoiceTranscript(language) || 'pt-BR';
    if (this.recognition) this.recognition.lang = this.language;
  }

  start({ language = this.language } = {}) {
    if (this.state === 'unsupported') return false;
    if (['starting', 'listening', 'processing'].includes(this.state)) return false;

    const Recognition = resolveSpeechRecognitionConstructor(this.scope);
    if (typeof Recognition !== 'function') {
      this.setState('unsupported');
      return false;
    }

    this.finalChunks = [];
    this.interimTranscript = '';
    this.intentionalStop = false;
    this.abortedByUser = false;
    this.terminalError = null;
    this.finalDelivered = false;
    this.recognition = new Recognition();
    this.recognition.lang = normalizeVoiceTranscript(language) || 'pt-BR';
    this.recognition.continuous = false;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onstart = () => this.setState('listening');
    this.recognition.onspeechend = () => {
      if (this.state === 'listening') this.setState('processing');
      try { this.recognition?.stop?.(); } catch { /* já encerrado */ }
    };
    this.recognition.onresult = (event) => {
      let interim = '';
      for (let index = Number(event?.resultIndex) || 0; index < (event?.results?.length ?? 0); index += 1) {
        const result = event.results[index];
        const transcript = normalizeVoiceTranscript(result?.[0]?.transcript ?? '');
        if (!transcript) continue;
        if (result.isFinal) this.finalChunks.push(transcript);
        else interim = `${interim} ${transcript}`.trim();
      }
      this.interimTranscript = normalizeVoiceTranscript(interim);
      this.onInterim(this.interimTranscript, normalizeVoiceTranscript(this.finalChunks.join(' ')));
    };
    this.recognition.onerror = (event) => {
      const code = String(event?.error ?? 'unknown');
      this.terminalError = code;
      if (code === 'aborted' && this.intentionalStop) return;
      this.onError({ code, message: speechRecognitionErrorMessage(code), event });
    };
    this.recognition.onend = () => this.deliverFinalTranscript();

    try {
      this.setState('starting');
      this.recognition.start();
      return true;
    } catch (error) {
      this.logger?.error?.('[Mestre Orc][Voice] falha ao iniciar reconhecimento', error);
      this.onError({ code: 'start-failed', message: error?.message || speechRecognitionErrorMessage('unknown'), error });
      this.setState('idle');
      return false;
    }
  }

  stop() {
    if (this.state !== 'listening') return false;
    this.intentionalStop = true;
    this.setState('processing');
    try {
      this.recognition?.stop?.();
      return true;
    } catch {
      this.deliverFinalTranscript();
      return false;
    }
  }

  abort() {
    this.intentionalStop = true;
    this.abortedByUser = true;
    this.finalChunks = [];
    this.interimTranscript = '';
    this.finalDelivered = true;
    try { this.recognition?.abort?.(); } catch { /* já encerrado */ }
    this.recognition = null;
    this.setState(speechRecognitionSupported(this.scope) ? 'idle' : 'unsupported');
  }

  deliverFinalTranscript() {
    if (this.finalDelivered) return;
    this.finalDelivered = true;
    const transcript = normalizeVoiceTranscript(this.finalChunks.join(' '));
    this.interimTranscript = '';
    this.onInterim('', transcript);
    this.recognition = null;

    if (!transcript) {
      this.setState('idle');
      if (!this.abortedByUser && !this.terminalError) {
        this.onError({ code: 'no-speech', message: speechRecognitionErrorMessage('no-speech') });
      }
      return;
    }

    this.setState('processing');
    Promise.resolve(this.onFinal(transcript))
      .catch((error) => {
        this.logger?.error?.('[Mestre Orc][Voice] falha ao processar transcrição', error);
        this.onError({ code: 'submit-failed', message: error?.message || 'não foi possível enviar a transcrição.', error });
      })
      .finally(() => this.setState('idle'));
  }
}
