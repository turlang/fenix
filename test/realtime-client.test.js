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

test('URL realtime deriva ws/wss do endpoint HTTP da API', () => {
  assert.equal(resolveFenixRealtimeUrl('http://localhost:3001'), 'ws://localhost:3001/v1/realtime');
  assert.equal(resolveFenixRealtimeUrl('https://fenix.example.com/api'), 'wss://fenix.example.com/v1/realtime');
});

test('identidade de navegador preserva clientId e permite modo player por query string', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const first = createBrowserRealtimeIdentity({
    locationLike: { search: '?role=player&actor=hero-ayla&name=Ana' },
    storage
  });
  const second = createBrowserRealtimeIdentity({
    locationLike: { search: '?role=player&actor=hero-ayla&name=Ana' },
    storage
  });

  assert.equal(first.role, 'player');
  assert.equal(first.actorId, 'hero-ayla');
  assert.equal(first.displayName, 'Ana');
  assert.equal(second.clientId, first.clientId);
});

test('cliente envia TOKEN_MOVE com posição e saída explícita de sala', async () => {
  FakeWebSocket.instances.length = 0;
  const client = new FenixRealtimeClient({
    apiBaseUrl: 'http://localhost:3001',
    webSocketImpl: FakeWebSocket,
    identity: {
      clientId: 'client-1',
      userId: 'user-1',
      displayName: 'Mestre',
      role: 'gm',
      actorId: null
    }
  });

  await client.connect('session-1');
  const socket = FakeWebSocket.instances[0];
  assert.match(socket.url, /sessionId=session-1/);
  assert.match(socket.url, /role=gm/);

  client.moveToken({ id: 'hero-ayla', name: 'Ayla', x: 10, y: 20, size: 72 }, { roomId: null });
  const sent = JSON.parse(socket.sent[0]);
  assert.equal(sent.type, 'TOKEN_MOVE');
  assert.equal(sent.payload.token.id, 'hero-ayla');
  assert.equal(sent.payload.roomId, null);

  const received = [];
  client.subscribe((event) => received.push(event));
  socket.emit({ type: 'TOKEN_MOVED', payload: { token: { id: 'hero-ayla', x: 30, y: 40 } } });
  assert.equal(received.at(-1).type, 'TOKEN_MOVED');
});
