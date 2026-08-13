import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDevelopmentPeerAuthorizer,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../packages/realtime-session-gateway/src/index.js';

function harness({ resolveTokenVerticalState = null } = {}) {
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
    resolveTokenVerticalState,
    logger: {}
  });
  return { hub, gateway, calls };
}

function finiteWall() {
  return {
    id: 'wall-1',
    kind: 'wall',
    a: { x: 140, y: 0 },
    b: { x: 140, y: 280 },
    bottomElevation: 0,
    topElevation: 3
  };
}

function verticalState(movementMode = 'flying', elevation = 0) {
  return {
    sceneElevation: {
      enabled: true,
      unit: 'm',
      levelHeight: 3,
      verticalStep: 1,
      defaultWallBottom: 0,
      defaultWallTop: 3,
      levels: [{ id: 'ground', name: 'Térreo', elevation: 0 }, { id: 'upper', name: 'Alto', elevation: 4 }]
    },
    profile: { elevation, height: 1.8, movementMode }
  };
}

test('Hub aceita somente a posição segura do jogador e não narra sala atravessando parede', async () => {
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
  assert.equal(result.collision.ignoredWalls, false);
  assert.ok(result.token.x <= 119.1);
  assert.equal(result.roomChanged, false);
  assert.equal(result.shouldNarrate, false);
  assert.equal(calls.rooms, 0);
  assert.equal(hub.getSnapshot('session-1').tokens[0].x, result.token.x);

  const movedEvent = gmEvents.filter((event) => event.type === 'TOKEN_MOVED').at(-1);
  assert.equal(movedEvent.payload.collision.blocked, true);
  assert.equal(movedEvent.payload.collision.ignoredWalls, false);
  assert.equal(movedEvent.payload.requested.x, 210);
  assert.equal(movedEvent.payload.token.x, result.token.x);

  const ack = playerEvents.filter((event) => event.type === 'ACK' && event.commandId === 'cross-wall').at(-1);
  assert.equal(ack.payload.collision.blocked, true);
  assert.equal(ack.payload.collision.ignoredWalls, false);
  gm.disconnect();
  player.disconnect();
});

test('Mestre atravessa paredes em noclip mas continua limitado às bordas da cena', async () => {
  const { gateway } = harness();
  const gmEvents = [];
  const gm = gateway.openPeer({
    sessionId: 'session-1', clientId: 'gm', role: 'gm', send: (event) => gmEvents.push(event)
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

  await gm.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    payload: { token: { id: 'hero-ayla', name: 'Ayla', x: 70, y: 140, size: 40 } }
  }));
  const acrossWall = await gm.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    commandId: 'gm-cross-wall',
    payload: { token: { id: 'hero-ayla', name: 'Ayla', x: 210, y: 140, size: 40 } }
  }));

  assert.equal(acrossWall.collision.blocked, false);
  assert.equal(acrossWall.collision.ignoredWalls, true);
  assert.equal(acrossWall.token.x, 210);
  const movedEvent = gmEvents.filter((event) => event.type === 'TOKEN_MOVED').at(-1);
  assert.equal(movedEvent.payload.collision.ignoredWalls, true);

  const outsideScene = await gm.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    payload: { token: { id: 'hero-ayla', name: 'Ayla', x: 999, y: 140, size: 40 } }
  }));
  assert.equal(outsideScene.collision.boundaryAdjusted, true);
  assert.ok(outsideScene.token.x < 420);
  gm.disconnect();
});

test('porta aberta permite movimento do jogador e porta fechada volta a bloquear', async () => {
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

test('jogador voador não pode forjar Z alto para atravessar parede em um único comando', async () => {
  const { gateway } = harness({ resolveTokenVerticalState: () => verticalState('flying', 0) });
  const gm = gateway.openPeer({ sessionId: 'session-1', clientId: 'gm', role: 'gm', send: () => undefined });
  const events = [];
  const player = gateway.openPeer({ sessionId: 'session-1', clientId: 'player', role: 'player', actorId: 'hero-ayla', send: (event) => events.push(event) });
  await gm.receive(JSON.stringify({
    type: 'SCENE_UPDATE', payload: { scene: {
      id: 'scene-1', name: 'Muralha baixa', width: 420, height: 280,
      grid: { size: 70 }, walls: [finiteWall()], lighting: { enabled: false, sources: [] }
    } }
  }));
  await player.receive(JSON.stringify({ type: 'TOKEN_MOVE', payload: { token: { id: 'hero-ayla', x: 70, y: 140, elevation: 0, size: 40 } } }));
  const forged = await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE', commandId: 'forged-z',
    payload: { token: { id: 'hero-ayla', x: 210, y: 140, elevation: 999, size: 40 } }
  }));
  assert.equal(forged.token.elevation, 1, 'servidor deve limitar a subida a um passo vertical');
  assert.equal(forged.collision.blocked, true, 'Z aceito ainda cruza a parede 0..3');
  assert.equal(forged.collision.verticalEnabled, true);
  const ack = events.find((event) => event.type === 'ACK' && event.commandId === 'forged-z');
  assert.equal(ack.payload.elevation, 1);
  assert.equal(ack.payload.movementMode, 'flying');
});

test('voo autoritativo em passos consegue passar por cima de parede finita', async () => {
  const { gateway } = harness({ resolveTokenVerticalState: () => verticalState('flying', 0) });
  const gm = gateway.openPeer({ sessionId: 'session-1', clientId: 'gm', role: 'gm', send: () => undefined });
  const player = gateway.openPeer({ sessionId: 'session-1', clientId: 'player', role: 'player', actorId: 'hero-ayla', send: () => undefined });
  await gm.receive(JSON.stringify({
    type: 'SCENE_UPDATE', payload: { scene: {
      id: 'scene-1', name: 'Muralha baixa', width: 420, height: 280,
      grid: { size: 70 }, walls: [finiteWall()], lighting: { enabled: false, sources: [] }
    } }
  }));
  let token = { id: 'hero-ayla', x: 70, y: 140, elevation: 0, size: 40 };
  await player.receive(JSON.stringify({ type: 'TOKEN_MOVE', payload: { token } }));
  for (const elevation of [1, 2, 3, 4]) {
    const raised = await player.receive(JSON.stringify({
      type: 'TOKEN_MOVE', payload: { token: { ...token, elevation } }
    }));
    token = raised.token;
  }
  assert.equal(token.elevation, 4);
  const across = await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE', payload: { token: { ...token, x: 210, y: 140 } }
  }));
  assert.equal(across.collision.blocked, false);
  assert.equal(across.token.x, 210);
  assert.equal(across.token.elevation, 4);
});

test('modo solo ignora Z arbitrário enviado pelo jogador e fixa elevação do perfil', async () => {
  const { gateway } = harness({ resolveTokenVerticalState: () => verticalState('ground', 4) });
  const gm = gateway.openPeer({ sessionId: 'session-1', clientId: 'gm', role: 'gm', send: () => undefined });
  const player = gateway.openPeer({ sessionId: 'session-1', clientId: 'player', role: 'player', actorId: 'hero-ayla', send: () => undefined });
  await gm.receive(JSON.stringify({
    type: 'SCENE_UPDATE', payload: { scene: {
      id: 'scene-1', name: 'Ponte', width: 420, height: 280,
      grid: { size: 70 }, walls: [finiteWall()], lighting: { enabled: false, sources: [] }
    } }
  }));
  const moved = await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE', payload: { token: { id: 'hero-ayla', x: 210, y: 140, elevation: 999, size: 40 } }
  }));
  assert.equal(moved.token.elevation, 4);
  assert.equal(moved.token.movementMode, 'ground');
  assert.equal(moved.collision.blocked, false, 'personagem em nível Z=4 deve passar acima da parede 0..3');
});
