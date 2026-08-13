import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDevelopmentPeerAuthorizer,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../packages/realtime-session-gateway/src/index.js';

function harness() {
  const calls = { rooms: 0 };
  const sessionService = {
    getStatus: () => ({ state: 'COLLECTING_ACTIONS', sessionId: 'session-1' }),
    async describeRoom() { calls.rooms += 1; return { state: 'COLLECTING_ACTIONS' }; },
    async processAction() { return { state: 'COLLECTING_ACTIONS' }; }
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

test('Hub aceita somente a posição segura e não narra sala atravessando parede', async () => {
  const { hub, gateway, calls } = harness();
  const gmEvents = [];
  const playerEvents = [];
  const gm = gateway.openPeer({
    sessionId: 'session-1', clientId: 'gm', role: 'gm', send: (event) => gmEvents.push(event)
  });
  const player = gateway.openPeer({
    sessionId: 'session-1', clientId: 'player', role: 'player', actorId: 'hero-ayla', send: (event) => playerEvents.push(event)
  });

  await gm.receive(JSON.stringify({
    type: 'SCENE_UPDATE',
    payload: {
      scene: {
        id: 'scene-1', name: 'Cripta', width: 420, height: 280,
        grid: { size: 70 },
        walls: [{ id: 'wall-1', kind: 'wall', a: { x: 140, y: 0 }, b: { x: 140, y: 280 } }],
        lighting: { enabled: false, sources: [] }
      }
    }
  }));

  await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    payload: { token: { id: 'hero-ayla', name: 'Ayla', x: 70, y: 140, size: 40 } }
  }));

  const result = await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    commandId: 'cross-wall',
    payload: {
      token: { id: 'hero-ayla', name: 'Ayla', x: 210, y: 140, size: 40 },
      roomId: 'secret-room',
      roomEntry: {
        room: { id: 'secret-room', name: 'Sala secreta' },
        source: { canonicalAnchor: true, text: 'Uma sala além da parede.', type: 'ROOM_READ_ALOUD' }
      }
    }
  }));

  assert.equal(result.collision.blocked, true);
  assert.equal(result.collision.wallId, 'wall-1');
  assert.ok(result.token.x <= 119.1);
  assert.equal(result.roomChanged, false);
  assert.equal(result.shouldNarrate, false);
  assert.equal(calls.rooms, 0);
  assert.equal(hub.getSnapshot('session-1').tokens[0].x, result.token.x);

  const movedEvent = gmEvents.filter((event) => event.type === 'TOKEN_MOVED').at(-1);
  assert.equal(movedEvent.payload.collision.blocked, true);
  assert.equal(movedEvent.payload.requested.x, 210);
  assert.equal(movedEvent.payload.token.x, result.token.x);

  const ack = playerEvents.filter((event) => event.type === 'ACK' && event.commandId === 'cross-wall').at(-1);
  assert.equal(ack.payload.collision.blocked, true);
  gm.disconnect();
  player.disconnect();
});

test('porta aberta permite movimento e porta fechada volta a bloquear', async () => {
  const { gateway } = harness();
  const gm = gateway.openPeer({ sessionId: 'session-1', clientId: 'gm', role: 'gm', send: () => undefined });
  const player = gateway.openPeer({ sessionId: 'session-1', clientId: 'player', role: 'player', actorId: 'hero-ayla', send: () => undefined });

  const scene = (doorState) => ({
    id: 'scene-1', name: 'Corredor', width: 420, height: 280,
    grid: { size: 70 },
    walls: [{ id: 'door-1', kind: 'door', doorState, a: { x: 140, y: 0 }, b: { x: 140, y: 280 } }],
    lighting: { enabled: false, sources: [] }
  });
  await gm.receive(JSON.stringify({ type: 'SCENE_UPDATE', payload: { scene: scene('open') } }));
  await player.receive(JSON.stringify({ type: 'TOKEN_MOVE', payload: { token: { id: 'hero-ayla', x: 70, y: 140, size: 40 } } }));
  const open = await player.receive(JSON.stringify({ type: 'TOKEN_MOVE', payload: { token: { id: 'hero-ayla', x: 210, y: 140, size: 40 } } }));
  assert.equal(open.collision.blocked, false);
  assert.equal(open.token.x, 210);

  await gm.receive(JSON.stringify({ type: 'SCENE_UPDATE', payload: { scene: scene('closed') } }));
  const closed = await player.receive(JSON.stringify({ type: 'TOKEN_MOVE', payload: { token: { id: 'hero-ayla', x: 70, y: 140, size: 40 } } }));
  assert.equal(closed.collision.blocked, true);
  assert.ok(closed.token.x >= 160.9, 'movendo do lado direito para a esquerda deve parar antes da porta');
});
