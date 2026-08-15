import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AuthoritativeRealtimeSessionGateway,
  AuthoritativeRealtimeSessionHub
} from '../packages/authoritative-token-runtime/src/index.js';

const gm = Object.freeze({ clientId: 'gm-1', userId: 'gm-user', role: 'gm', actorId: null });
const ayla = Object.freeze({ clientId: 'player-a', userId: 'user-a', role: 'player', actorId: 'hero-ayla' });
const dorian = Object.freeze({ clientId: 'player-d', userId: 'user-d', role: 'player', actorId: 'hero-dorian' });

function scene() {
  return {
    id: 'scene-1',
    name: 'Templo',
    width: 500,
    height: 300,
    grid: { size: 50 },
    elevation: { enabled: true, unit: 'm', verticalStep: 1, levelHeight: 3 },
    regions: [{
      id: 'stairs-1',
      kind: 'stairs',
      points: [
        { x: 40, y: 80 },
        { x: 240, y: 80 },
        { x: 240, y: 180 },
        { x: 40, y: 180 }
      ],
      baseElevation: 0,
      targetElevation: 4,
      axis: { start: { x: 40, y: 130 }, end: { x: 240, y: 130 } }
    }],
    walls: [{
      id: 'low-wall',
      kind: 'wall',
      a: { x: 300, y: 0 },
      b: { x: 300, y: 300 },
      bottomElevation: 0,
      topElevation: 3
    }],
    lighting: { enabled: false, sources: [] }
  };
}

function seedAyla(hub, overrides = {}) {
  return hub.applyTokenMove('session-1', gm, {
    token: {
      id: 'token-ayla',
      actorId: 'hero-ayla',
      sheetId: 'sheet-ayla',
      systemId: 'dnd5e',
      name: 'Ayla',
      x: 50,
      y: 130,
      elevation: 0,
      height: 1.7,
      movementMode: 'ground',
      size: 40,
      ...overrides
    }
  });
}

test('tokenId, actorId, sheetId e systemId permanecem separados e autoritativos', () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());
  seedAyla(hub);

  const moved = hub.applyTokenMove('session-1', ayla, {
    token: {
      id: 'token-ayla',
      actorId: 'hero-dorian',
      sheetId: 'sheet-forged',
      systemId: 'forged-system',
      x: 140,
      y: 130,
      elevation: 99,
      height: 20,
      movementMode: 'flying'
    }
  });

  assert.equal(moved.token.tokenId, 'token-ayla');
  assert.equal(moved.token.actorId, 'hero-ayla');
  assert.equal(moved.token.sheetId, 'sheet-ayla');
  assert.equal(moved.token.systemId, 'dnd5e');
  assert.equal(moved.token.height, 1.7);
  assert.equal(moved.token.movementMode, 'ground');
  assert.equal(moved.token.elevation, 2);
});

test('jogador não move token associado a outro ator', () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());
  seedAyla(hub);
  hub.applyTokenMove('session-1', gm, {
    token: {
      id: 'token-dorian', actorId: 'hero-dorian', sheetId: 'sheet-dorian', systemId: 'dnd5e',
      x: 80, y: 40, elevation: 0, size: 40
    }
  });

  assert.throws(
    () => hub.applyTokenMove('session-1', ayla, { token: { id: 'token-dorian', x: 100, y: 40 } }),
    (error) => error?.code === 'REALTIME_TOKEN_FORBIDDEN' && error?.statusCode === 403
  );
});

test('token separado do ator precisa ser associado pelo Mestre antes do jogador usar', () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());

  assert.throws(
    () => hub.applyTokenMove('session-1', ayla, { token: { id: 'unbound-token', x: 100, y: 100 } }),
    (error) => error?.code === 'REALTIME_TOKEN_ASSOCIATION_REQUIRED'
  );

  const legacy = hub.applyTokenMove('session-1', ayla, { token: { id: 'hero-ayla', x: 100, y: 100 } });
  assert.equal(legacy.token.actorId, 'hero-ayla');
  assert.equal(legacy.token.sheetId, 'hero-ayla');
});

test('voo do jogador limita Z por passo e não aceita spoof de modo ou altura', () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());
  seedAyla(hub, { movementMode: 'flying', elevation: 3.2, x: 250, y: 40 });

  const moved = hub.applyTokenMove('session-1', ayla, {
    token: {
      id: 'token-ayla',
      x: 360,
      y: 40,
      elevation: 99,
      movementMode: 'ground',
      height: 20
    }
  });

  assert.equal(moved.token.movementMode, 'flying');
  assert.equal(moved.token.height, 1.7);
  assert.equal(moved.token.elevation, 4.2);
  assert.equal(moved.collision.blocked, false);
});

test('parede baixa continua bloqueando token no chão', () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());
  seedAyla(hub, { x: 250, y: 40, elevation: 0 });

  const moved = hub.applyTokenMove('session-1', ayla, {
    token: { id: 'token-ayla', x: 360, y: 40 }
  });

  assert.equal(moved.collision.blocked, true);
  assert.equal(moved.collision.wallId, 'low-wall');
  assert.ok(moved.token.x < 300);
});

test('gateway usa actorId da entidade ao gerar percepção privada', async () => {
  const hub = new AuthoritativeRealtimeSessionHub();
  hub.applySceneUpdate('session-1', gm, scene());
  seedAyla(hub, { x: 50, y: 40 });
  let described = null;
  const sessionService = {
    getStatus: () => ({ sessionId: 'session-1', state: 'COLLECTING_ACTIONS' }),
    processAction: async () => ({ state: 'COLLECTING_ACTIONS' }),
    describeRoom: async (event) => { described = event; return { state: 'COLLECTING_ACTIONS' }; }
  };
  const gateway = new AuthoritativeRealtimeSessionGateway({ hub, sessionService, authorizePeer: (input) => input });

  await gateway.handleCommand('session-1', ayla, {
    type: 'TOKEN_MOVE',
    commandId: 'move-1',
    payload: {
      token: { id: 'token-ayla', x: 80, y: 40 },
      roomId: 'room-1',
      roomEntry: { room: { id: 'room-1', name: 'Sala Um' } }
    }
  });

  assert.equal(described.actorId, 'hero-ayla');
});

test('snapshot persistido e hidratação preservam vínculo entidade e Z', () => {
  const first = new AuthoritativeRealtimeSessionHub();
  first.applySceneUpdate('session-1', gm, scene());
  seedAyla(first, { movementMode: 'flying', elevation: 2 });
  const snapshot = first.getPersistentSnapshot('session-1');

  const second = new AuthoritativeRealtimeSessionHub();
  second.hydrateSession('session-1', snapshot);
  const token = second.getSnapshot('session-1').tokens[0];

  assert.equal(token.tokenId, 'token-ayla');
  assert.equal(token.actorId, 'hero-ayla');
  assert.equal(token.sheetId, 'sheet-ayla');
  assert.equal(token.systemId, 'dnd5e');
  assert.equal(token.elevation, 2);
  assert.equal(second.getSnapshot('session-1').scene.regions[0].kind, SceneRegionKind.STAIRS);
});
