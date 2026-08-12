import assert from 'node:assert/strict';
import { createConfig } from '../packages/config/src/index.js';
import {
  createDevelopmentPeerAuthorizer,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../packages/realtime-session-gateway/src/index.js';
import { createApiApp } from '../apps/api/src/app.js';

function waitForType(socket, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error(`Timeout aguardando ${type}`));
    }, timeoutMs);
    function onMessage(raw) {
      const event = JSON.parse(raw.toString());
      if (event.type !== type) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(event);
    }
    socket.on('message', onMessage);
  });
}

const hub = new RealtimeSessionHub({ logger: {} });
const sessionService = {
  getStatus() {
    return { state: 'COLLECTING_ACTIONS', sessionId: 'integration-session', sceneId: 'scene-1' };
  },
  async start() { return this.getStatus(); },
  async processAction() { return { state: 'COLLECTING_ACTIONS' }; },
  async describeRoom(roomEntry) {
    await hub.publishNarration('A câmara permanece estreita entre duas colunas de pedra.', {
      sessionId: 'integration-session',
      type: 'ROOM_ENTRY',
      roomId: roomEntry.room.id,
      audio: null
    });
    return { state: 'COLLECTING_ACTIONS', room: roomEntry.room };
  },
  async end() { return { state: 'ENDED', sessionId: 'integration-session' }; }
};
const gateway = new RealtimeSessionGateway({
  hub,
  sessionService,
  authorizePeer: createDevelopmentPeerAuthorizer(),
  logger: {}
});
const config = createConfig({
  NODE_ENV: 'test',
  PORT: '3001',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000'
});
const app = await createApiApp({
  config,
  sessionService,
  narrator: null,
  audioNarrationService: null,
  realtimeGateway: gateway
});

let socket = null;
const hardTimeout = setTimeout(() => {
  console.error('Realtime WebSocket integration excedeu 10s.');
  socket?.terminate?.();
  process.exitCode = 1;
}, 10_000);
hardTimeout.unref?.();

try {
  await app.ready();
  socket = await app.injectWS('/v1/realtime?sessionId=integration-session&clientId=player-1&role=player&actorId=hero-ayla&name=Ayla');

  const statePromise = waitForType(socket, 'STATE_SYNC');
  socket.send(JSON.stringify({ type: 'REQUEST_STATE', commandId: 'state-1', payload: {} }));
  const state = await statePromise;
  assert.equal(state.payload.sessionId, 'integration-session');

  const tokenPromise = waitForType(socket, 'TOKEN_MOVED');
  const narrationPromise = waitForType(socket, 'NARRATION');
  socket.send(JSON.stringify({
    type: 'TOKEN_MOVE',
    commandId: 'move-1',
    payload: {
      token: { id: 'hero-ayla', name: 'Ayla', x: 1200, y: 220, size: 72 },
      roomId: '03',
      roomEntry: {
        room: { id: '03', name: 'Câmara Norte' },
        source: { canonicalAnchor: true, text: 'Duas colunas dividem a câmara.' }
      }
    }
  }));

  const tokenEvent = await tokenPromise;
  const narrationEvent = await narrationPromise;
  assert.equal(tokenEvent.payload.token.id, 'hero-ayla');
  assert.equal(narrationEvent.payload.metadata.roomId, '03');

  console.log('Realtime WebSocket integration OK');
} finally {
  clearTimeout(hardTimeout);
  if (socket) {
    socket.terminate?.();
    if (socket.readyState < 2) socket.close?.();
  }
  await app.close();
}
