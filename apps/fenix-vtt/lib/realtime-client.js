import { resolveFenixApiBaseUrl } from './fenix-api-client.js';

const DEFAULT_RECONNECT_CODES = Object.freeze([1001, 1006, 1012]);

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveFenixRealtimeUrl(apiBaseUrl = resolveFenixApiBaseUrl()) {
  const url = new URL(apiBaseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v1/realtime';
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function createBrowserRealtimeIdentity({ storage = globalThis.sessionStorage } = {}) {
  let clientId = storage?.getItem?.('fenix.realtime.clientId') ?? null;
  if (!clientId) {
    clientId = randomId();
    storage?.setItem?.('fenix.realtime.clientId', clientId);
  }
  return Object.freeze({ clientId });
}

export class FenixRealtimeClient {
  constructor({
    apiBaseUrl = resolveFenixApiBaseUrl(),
    webSocketImpl = globalThis.WebSocket,
    identity = null,
    connectTimeoutMs = 8000,
    reconnectCodes = DEFAULT_RECONNECT_CODES,
    reconnectMaxAttempts = 4,
    reconnectBaseDelayMs = 250,
    reconnectMaxDelayMs = 2000
  } = {}) {
    if (typeof webSocketImpl !== 'function') throw new TypeError('WebSocket não está disponível.');
    this.WebSocketImpl = webSocketImpl;
    this.baseUrl = resolveFenixRealtimeUrl(apiBaseUrl);
    this.identity = identity ?? createBrowserRealtimeIdentity();
    this.connectTimeoutMs = Math.max(1000, Number(connectTimeoutMs) || 8000);
    this.reconnectCodes = new Set((reconnectCodes ?? DEFAULT_RECONNECT_CODES).map(Number));
    this.reconnectMaxAttempts = Math.max(0, Math.min(10, Number(reconnectMaxAttempts) || 0));
    this.reconnectBaseDelayMs = Math.max(1, Number(reconnectBaseDelayMs) || 250);
    this.reconnectMaxDelayMs = Math.max(this.reconnectBaseDelayMs, Number(reconnectMaxDelayMs) || 2000);
    this.socket = null;
    this.sessionId = null;
    this.listeners = new Set();
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.manualClose = false;
  }

  get connected() {
    return this.socket?.readyState === 1;
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener deve ser função.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(sessionId) {
    const id = String(sessionId ?? '').trim();
    if (!id) throw new TypeError('sessionId é obrigatório.');
    if (this.connected && this.sessionId === id) return this;

    this.#clearReconnectTimer();
    this.#closeSocket(1000, 'Replacing realtime connection');
    this.manualClose = false;
    this.reconnectAttempts = 0;
    this.sessionId = id;
    await this.#open(id, { reconnected: false });
    return this;
  }

  send(type, payload = {}, commandId = randomId()) {
    if (!this.connected) throw new Error('Canal realtime desconectado.');
    const message = { type, commandId, payload };
    this.socket.send(JSON.stringify(message));
    return commandId;
  }

  moveToken(token, { roomEntry = null, roomId = undefined } = {}) {
    const payload = { token, roomEntry };
    if (roomId !== undefined) payload.roomId = roomId;
    return this.send('TOKEN_MOVE', payload);
  }

  updateScene(scene) {
    return this.send('SCENE_UPDATE', { scene });
  }

  submitAction({ content, actorId = null } = {}) {
    return this.send('ACTION_SUBMIT', { content, actorId });
  }

  requestState() {
    return this.send('REQUEST_STATE');
  }

  ping() {
    return this.send('PING');
  }

  close() {
    this.manualClose = true;
    this.#clearReconnectTimer();
    this.reconnectAttempts = 0;
    this.sessionId = null;
    this.#closeSocket(1000, 'Client closing');
  }

  async #open(sessionId, { reconnected }) {
    if (this.manualClose || this.sessionId !== sessionId) return this;

    const url = new URL(this.baseUrl);
    url.searchParams.set('sessionId', sessionId);
    url.searchParams.set('clientId', this.identity.clientId);

    const socket = new this.WebSocketImpl(url.toString());
    this.socket = socket;

    let opening = true;
    let rejectOpening = null;
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      try {
        const message = JSON.parse(String(event.data ?? ''));
        this.#emit(message);
      } catch {
        this.#emit({ type: 'CLIENT_PROTOCOL_ERROR', payload: { message: 'Evento realtime inválido.' } });
      }
    };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      this.socket = null;
      if (opening) {
        rejectOpening?.(new Error('Canal realtime fechou durante a conexão.'));
        return;
      }
      this.#emit({
        type: 'CLIENT_DISCONNECTED',
        payload: { code: event.code ?? 1000, reason: event.reason ?? '' }
      });
      if (!this.manualClose && this.sessionId === sessionId && this.reconnectCodes.has(Number(event.code))) {
        this.#scheduleReconnect(sessionId, event.code);
      }
    };
    socket.onerror = () => {
      if (socket !== this.socket) return;
      if (opening) rejectOpening?.(new Error('Falha ao conectar o canal realtime.'));
      this.#emit({ type: 'CLIENT_SOCKET_ERROR', payload: { message: 'Falha no WebSocket.' } });
    };

    await new Promise((resolve, reject) => {
      rejectOpening = reject;
      const timeout = setTimeout(() => {
        if (socket === this.socket) socket.close?.(4001, 'Realtime connection timeout');
        reject(new Error('Tempo limite ao conectar o canal realtime.'));
      }, this.connectTimeoutMs);

      socket.onopen = () => {
        if (socket !== this.socket) {
          clearTimeout(timeout);
          return;
        }
        clearTimeout(timeout);
        opening = false;
        rejectOpening = null;
        this.reconnectAttempts = 0;
        this.#emit({
          type: 'CLIENT_CONNECTED',
          payload: { sessionId, reconnected: Boolean(reconnected) }
        });
        resolve();
      };
    });
    return this;
  }

  #scheduleReconnect(sessionId, closeCode) {
    if (this.manualClose || this.reconnectTimer || this.sessionId !== sessionId) return false;
    if (this.reconnectAttempts >= this.reconnectMaxAttempts) {
      this.#emit({
        type: 'CLIENT_RECONNECT_EXHAUSTED',
        payload: { sessionId, attempts: this.reconnectAttempts, closeCode }
      });
      return false;
    }

    const attempt = this.reconnectAttempts + 1;
    this.reconnectAttempts = attempt;
    const delayMs = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectBaseDelayMs * (2 ** Math.max(0, attempt - 1))
    );
    this.#emit({
      type: 'CLIENT_RECONNECTING',
      payload: { sessionId, attempt, delayMs, closeCode }
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.manualClose || this.sessionId !== sessionId || this.connected) return;
      void this.#open(sessionId, { reconnected: true }).catch(() => {
        if (!this.manualClose && this.sessionId === sessionId) this.#scheduleReconnect(sessionId, closeCode);
      });
    }, delayMs);
    return true;
  }

  #clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  #closeSocket(code, reason) {
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < 2) socket.close?.(code, reason);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Um listener defeituoso não pode derrubar o transporte realtime.
      }
    }
  }
}

export function createFenixRealtimeClient(options) {
  return new FenixRealtimeClient(options);
}
