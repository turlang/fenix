import { resolveFenixApiBaseUrl } from './fenix-api-client.js';

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

export function createBrowserRealtimeIdentity({
  locationLike = globalThis.location,
  storage = globalThis.sessionStorage
} = {}) {
  const params = new URLSearchParams(locationLike?.search ?? '');
  const role = params.get('role') === 'player' ? 'player' : 'gm';
  const actorId = params.get('actor') || (role === 'player' ? 'hero-ayla' : null);
  let clientId = storage?.getItem?.('fenix.realtime.clientId') ?? null;
  if (!clientId) {
    clientId = randomId();
    storage?.setItem?.('fenix.realtime.clientId', clientId);
  }
  return Object.freeze({
    clientId,
    userId: clientId,
    displayName: params.get('name') || (role === 'gm' ? 'Mestre' : 'Jogador'),
    role,
    actorId
  });
}

export class FenixRealtimeClient {
  constructor({
    apiBaseUrl = resolveFenixApiBaseUrl(),
    webSocketImpl = globalThis.WebSocket,
    identity = null,
    connectTimeoutMs = 8000
  } = {}) {
    if (typeof webSocketImpl !== 'function') throw new TypeError('WebSocket não está disponível.');
    this.WebSocketImpl = webSocketImpl;
    this.baseUrl = resolveFenixRealtimeUrl(apiBaseUrl);
    this.identity = identity ?? createBrowserRealtimeIdentity();
    this.connectTimeoutMs = Math.max(1000, Number(connectTimeoutMs) || 8000);
    this.socket = null;
    this.sessionId = null;
    this.listeners = new Set();
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
    this.close();

    const url = new URL(this.baseUrl);
    url.searchParams.set('sessionId', id);
    url.searchParams.set('clientId', this.identity.clientId);
    url.searchParams.set('userId', this.identity.userId);
    url.searchParams.set('name', this.identity.displayName);
    url.searchParams.set('role', this.identity.role);
    if (this.identity.actorId) url.searchParams.set('actorId', this.identity.actorId);

    const socket = new this.WebSocketImpl(url.toString());
    this.socket = socket;
    this.sessionId = id;

    let opening = true;
    let rejectOpening = null;
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data ?? ''));
        this.#emit(message);
      } catch {
        this.#emit({ type: 'CLIENT_PROTOCOL_ERROR', payload: { message: 'Evento realtime inválido.' } });
      }
    };
    socket.onclose = (event) => {
      if (opening) rejectOpening?.(new Error('Canal realtime fechou durante a conexão.'));
      this.#emit({
        type: 'CLIENT_DISCONNECTED',
        payload: { code: event.code ?? 1000, reason: event.reason ?? '' }
      });
    };
    socket.onerror = () => {
      if (opening) rejectOpening?.(new Error('Falha ao conectar o canal realtime.'));
      this.#emit({ type: 'CLIENT_SOCKET_ERROR', payload: { message: 'Falha no WebSocket.' } });
    };

    await new Promise((resolve, reject) => {
      rejectOpening = reject;
      const timeout = setTimeout(() => {
        socket.close?.(4001, 'Realtime connection timeout');
        reject(new Error('Tempo limite ao conectar o canal realtime.'));
      }, this.connectTimeoutMs);

      socket.onopen = () => {
        clearTimeout(timeout);
        opening = false;
        rejectOpening = null;
        this.#emit({ type: 'CLIENT_CONNECTED', payload: { sessionId: id } });
        resolve();
      };
    });
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
    const socket = this.socket;
    this.socket = null;
    this.sessionId = null;
    if (socket && socket.readyState < 2) socket.close?.(1000, 'Client closing');
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
