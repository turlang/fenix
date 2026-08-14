import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDevelopmentPeerAuthorizer,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../packages/realtime-session-gateway/src/index.js';

function events(messages, type) {
  return messages.filter((event) => event.type === type);
}

function createHarness() {
  const calls = { rooms: 0, actions: 0, lastRoom: null };
  const sessionService = {
    getStatus() {
      return { state: 'COLLECTING_ACTIONS', sessionId: 'session-1', sceneId: 'scene-1' };
    },
    async describeRoom(input) {
      calls.rooms += 1;
      calls.lastRoom = input;
      return { state: 'COLLECTING_ACTIONS' };
    },
    async processAction() {
      calls.actions += 1;
      return { state: 'COLLECTING_ACTIONS' };
    }
  };
  const hub = new RealtimeSessionHub({ logger: {} });
  const gateway = new RealtimeSessionGateway({
    hub,
    sessionService,
    authorizePeer: createDevelopmentPeerAuthorizer(),
    logger: {}
  });
  return { hub, gateway, calls };
}

test('gateway separa presença e aplica autoridade por papel/actorId', async () => {
  const { gateway, hub } = createHarness();
  const gmMessages = [];
  const playerMessages = [];

  const gm = gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'gm-1',
    role: 'gm',
    displayName: 'Mestre',
    send: (event) => gmMessages.push(event)
  });
  const player = gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'player-1',
    role: 'player',
    actorId: 'hero-ayla',
    displayName: 'Ayla',
    send: (event) => playerMessages.push(event)
  });

  assert.equal(hub.getSnapshot('session-1').presence.length, 2);
  assert.equal(events(playerMessages, 'PRESENCE_UPDATED').at(-1).payload.presence.length, 2);

  await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    commandId: 'move-own',
    payload: { token: { id: 'hero-ayla', name: 'Ayla', x: 100, y: 120, size: 72 } }
  }));
  assert.equal(hub.getSnapshot('session-1').tokens[0].x, 100);
  assert.equal(events(gmMessages, 'TOKEN_MOVED').at(-1).payload.token.id, 'hero-ayla');

  await assert.rejects(
    player.receive(JSON.stringify({
      type: 'TOKEN_MOVE',
      payload: { token: { id: 'hero-dorian', name: 'Dorian', x: 200, y: 200, size: 72 } }
    })),
    (error) => error.code === 'REALTIME_TOKEN_FORBIDDEN'
  );

  await assert.rejects(
    player.receive(JSON.stringify({ type: 'SCENE_UPDATE', payload: { scene: { id: 'scene-2', name: 'Outra cena' } } })),
    (error) => error.code === 'REALTIME_SCENE_FORBIDDEN'
  );

  await gm.receive(JSON.stringify({
    type: 'SCENE_UPDATE',
    payload: {
      scene: {
        id: 'scene-2',
        name: 'Outra cena',
        width: 1200,
        height: 800,
        walls: [
          { id: 'wall-1', kind: 'wall', a: { x: 0, y: 0 }, b: { x: 120, y: 0 } },
          { id: 'door-1', kind: 'door', doorState: 'open', a: { x: 120, y: 0 }, b: { x: 200, y: 0 } }
        ]
      }
    }
  }));
  const realtimeScene = hub.getSnapshot('session-1').scene;
  assert.equal(realtimeScene.id, 'scene-2');
  assert.equal(realtimeScene.walls.length, 2);
  assert.equal(realtimeScene.walls[1].doorState, 'open');
  const playerSceneEvent = events(playerMessages, 'SCENE_UPDATED').at(-1);
  assert.equal(playerSceneEvent.payload.scene.walls[0].id, 'wall-1');
  assert.equal(playerSceneEvent.payload.scene.walls[1].kind, 'door');

  gm.disconnect();
  player.disconnect();
  assert.equal(hub.getSnapshot('session-1').presence.length, 0);
});

test('entrada de sala é deduplicada, identifica o personagem e reentrada narra novamente', async () => {
  const { gateway, calls } = createHarness();
  const player = gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'player-1',
    role: 'player',
    actorId: 'hero-ayla',
    displayName: 'Ayla',
    send: () => undefined
  });
  const roomEntry = {
    room: { id: '03', name: 'Câmara Norte' },
    source: { canonicalAnchor: true, text: 'Duas colunas baixas dividem a câmara.', type: 'ROOM_READ_ALOUD' }
  };

  const moveIntoRoom = JSON.stringify({
    type: 'TOKEN_MOVE',
    payload: {
      token: { id: 'hero-ayla', name: 'Ayla', x: 1200, y: 200, size: 72 },
      roomId: '03',
      roomEntry
    }
  });

  await player.receive(moveIntoRoom);
  await player.receive(moveIntoRoom);
  assert.equal(calls.rooms, 1);
  assert.equal(calls.lastRoom.actorId, 'hero-ayla');

  await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    payload: {
      token: { id: 'hero-ayla', name: 'Ayla', x: 800, y: 500, size: 72 },
      roomId: null,
      roomEntry: null
    }
  }));
  await player.receive(moveIntoRoom);
  assert.equal(calls.rooms, 2);
});

test('NarrationOutput realtime transmite texto e áudio somente aos peers da sessão', async () => {
  const { hub, gateway } = createHarness();
  const first = [];
  const second = [];
  gateway.openPeer({ sessionId: 'session-1', clientId: 'gm-1', role: 'gm', send: (event) => first.push(event) });
  gateway.openPeer({ sessionId: 'session-1', clientId: 'player-1', role: 'player', actorId: 'hero-ayla', send: (event) => second.push(event) });

  await hub.publishNarration('A porta ao norte permanece visível.', {
    sessionId: 'session-1',
    type: 'ROOM_ENTRY',
    roomId: '03',
    audio: { mode: 'browser-tts', text: 'A porta ao norte permanece visível.' }
  });

  for (const inbox of [first, second]) {
    const narration = events(inbox, 'NARRATION').at(-1);
    assert.equal(narration.payload.metadata.roomId, '03');
    assert.equal(narration.payload.metadata.audio.mode, 'browser-tts');
  }
});

test('narração privada de sala chega apenas ao personagem alvo e ao Mestre, inclusive no histórico', async () => {
  const { hub, gateway } = createHarness();
  const gmMessages = [];
  const aylaMessages = [];
  const dorianMessages = [];

  gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'gm-1',
    role: 'gm',
    displayName: 'Mestre',
    send: (event) => gmMessages.push(event)
  });
  gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'player-ayla',
    role: 'player',
    actorId: 'hero-ayla',
    displayName: 'Ayla',
    send: (event) => aylaMessages.push(event)
  });
  gateway.openPeer({
    sessionId: 'session-1',
    clientId: 'player-dorian',
    role: 'player',
    actorId: 'hero-dorian',
    displayName: 'Dorian',
    send: (event) => dorianMessages.push(event)
  });

  await hub.publishNarration('Você percebe uma inscrição junto à porta.', {
    sessionId: 'session-1',
    type: 'ROOM_ENTRY',
    roomId: '03',
    audienceActorId: 'hero-ayla',
    audio: { mode: 'browser-tts', text: 'Você percebe uma inscrição junto à porta.' }
  });

  assert.equal(events(gmMessages, 'NARRATION').length, 1);
  assert.equal(events(aylaMessages, 'NARRATION').length, 1);
  assert.equal(events(dorianMessages, 'NARRATION').length, 0);

  const gmHistory = hub.getSnapshot('session-1', { identity: { role: 'gm', actorId: null } }).narrations;
  const aylaHistory = hub.getSnapshot('session-1', { identity: { role: 'player', actorId: 'hero-ayla' } }).narrations;
  const dorianHistory = hub.getSnapshot('session-1', { identity: { role: 'player', actorId: 'hero-dorian' } }).narrations;

  assert.equal(gmHistory.length, 1);
  assert.equal(aylaHistory.length, 1);
  assert.equal(dorianHistory.length, 0);
});

test('identidade de desenvolvimento é recusada em produção sem autenticador real', () => {
  const { hub } = createHarness();
  const sessionService = {
    getStatus: () => ({ state: 'COLLECTING_ACTIONS', sessionId: 'session-1' }),
    describeRoom: async () => ({}),
    processAction: async () => ({})
  };
  const gateway = new RealtimeSessionGateway({
    hub,
    sessionService,
    authorizePeer: createDevelopmentPeerAuthorizer({ isProduction: true }),
    logger: {}
  });

  assert.throws(
    () => gateway.openPeer({ sessionId: 'session-1', clientId: 'gm-1', role: 'gm', send: () => undefined }),
    (error) => error.code === 'REALTIME_AUTH_REQUIRED'
  );
});