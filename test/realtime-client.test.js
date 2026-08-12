import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBrowserRealtimeIdentity,
  FenixRealtimeClient,
  resolveFenixRealtimeUrl
} from '../apps/fenix-vtt/lib/realtime-client.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
    });
  }

  send(message) {
    this.sent.push(message);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  emit(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function waitFor(predicate, timeoutMs = 250) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout aguardando reconnect realtime'));
      setTimeout(tick, 2);
    };
    tick();
  });
}

test('URL realtime deriva ws/wss do endpoint HTTP da API', () => {
  assert.equal(resolveFenixRealtimeUrl('http://localhost:3001'), 'ws://localhost:3001/v1/realtime');
  assert.equal(resolveFenixRealtimeUrl('https://fenix.example.com/api'), 'wss://fenix.example.com/v1/realtime');
});

test('identidade de navegador preserva apenas clientId e não aceita autoridade por URL', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const first = createBrowserRealtimeIdentity({ storage });
  const second = createBrowserRealtimeIdentity({ storage });

  assert.deepEqual(Object.keys(first), ['clientId']);
  assert.equal(second.clientId, first.clientId);
  assert.equal(first.role, undefined);
  assert.equal(first.actorId, undefined);
});

test('cliente WebSocket envia somente sessionId e clientId na URL', async () => {
  FakeWebSocket.instances.length = 0;
  const client = new FenixRealtimeClient({
    apiBaseUrl: 'http://localhost:3001',
    webSocketImpl: FakeWebSocket,
    identity: { clientId: 'client-1' }
  });

  await client.connect('session-1');
  const socket = FakeWebSocket.instances[0];
  const url = new URL(socket.url);
  assert.equal(url.searchParams.get('sessionId'), 'session-1');
  assert.equal(url.searchParams.get('clientId'), 'client-1');
  assert.equal(url.searchParams.has('role'), false);
  assert.equal(url.searchParams.has('actorId'), false);
  assert.equal(url.searchParams.has('userId'), false);

  client.moveToken({ id: 'hero-ayla', name: 'Ayla', x: 10, y: 20, size: 72 }, { roomId: null });
  const sent = JSON.parse(socket.sent[0]);
  assert.equal(sent.type, 'TOKEN_MOVE');
  assert.equal(sent.payload.token.id, 'hero-ayla');
  assert.equal(sent.payload.roomId, null);

  const received = [];
  client.subscribe((event) => received.push(event));
  socket.emit({ type: 'TOKEN_MOVED', payload: { token: { id: 'hero-ayla', x: 30, y: 40 } } });
  assert.equal(received.at(-1).type, 'TOKEN_MOVED');
  client.close();
});

test('cliente reconecta no mesmo endpoint público após 1012 de troca de owner', async () => {
  FakeWebSocket.instances.length = 0;
  const events = [];
  const client = new FenixRealtimeClient({
    apiBaseUrl: 'http://ingress.example:3001',
    webSocketImpl: FakeWebSocket,
    identity: { clientId: 'client-failover' },
    reconnectMaxAttempts: 3,
    reconnectBaseDelayMs: 1,
    reconnectMaxDelayMs: 4
  });
  client.subscribe((event) => events.push(event));

  await client.connect('session-failover');
  const first = FakeWebSocket.instances[0];
  first.close(1012, 'Runtime owner changed');

  await waitFor(() => FakeWebSocket.instances.length === 2 && client.connected);
  const second = FakeWebSocket.instances[1];
  assert.equal(second.url, first.url);
  assert.equal(new URL(second.url).searchParams.get('sessionId'), 'session-failover');
  assert.equal(events.some((event) => event.type === 'CLIENT_RECONNECTING'), true);
  assert.equal(events.some((event) => event.type === 'CLIENT_CONNECTED' && event.payload?.reconnected === true), true);
  client.close();
});

test('fechamento manual não agenda reconnect', async () => {
  FakeWebSocket.instances.length = 0;
  const client = new FenixRealtimeClient({
    apiBaseUrl: 'http://localhost:3001',
    webSocketImpl: FakeWebSocket,
    identity: { clientId: 'client-manual' },
    reconnectBaseDelayMs: 1
  });

  await client.connect('session-manual');
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(FakeWebSocket.instances.length, 1);
});
