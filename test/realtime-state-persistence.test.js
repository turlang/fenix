import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeSessionHub } from '../packages/realtime-session-gateway/src/index.js';

const gm = Object.freeze({
  clientId: 'gm-client',
  userId: 'gm-user',
  displayName: 'Mestre',
  role: 'gm',
  actorId: null
});

test('cena, tokens, sala e narração sobrevivem à hidratação do hub realtime', async () => {
  let persisted = null;
  const hub1 = new RealtimeSessionHub({
    logger: {},
    persistSnapshot: async (_sessionId, snapshot) => { persisted = structuredClone(snapshot); }
  });

  hub1.applySceneUpdate('session-1', gm, {
    id: 'scene-1',
    name: 'Salão',
    width: 1600,
    height: 1000,
    grid: { size: 80 }
  });
  const moved = hub1.applyTokenMove('session-1', gm, {
    token: { id: 'hero-ayla', name: 'Ayla', x: 1200, y: 220, size: 72 },
    roomId: '03'
  });
  assert.equal(moved.roomChanged, true);
  await hub1.persistSession('session-1');
  await hub1.publishNarration('A Câmara Norte permanece silenciosa.', {
    sessionId: 'session-1',
    type: 'ROOM_ENTRY',
    roomId: '03'
  });

  assert.ok(persisted);
  assert.equal(persisted.scene.id, 'scene-1');
  assert.equal(persisted.tokens[0].id, 'hero-ayla');
  assert.equal(persisted.tokenRooms['hero-ayla'], '03');
  assert.equal(persisted.narrations.length, 1);

  const hub2 = new RealtimeSessionHub({ logger: {} });
  hub2.hydrateSession('session-1', persisted);
  const snapshot = hub2.getSnapshot('session-1');
  assert.equal(snapshot.scene.id, 'scene-1');
  assert.equal(snapshot.tokens[0].x, 1200);
  assert.equal(snapshot.narrations[0].content, 'A Câmara Norte permanece silenciosa.');

  const sameRoom = hub2.applyTokenMove('session-1', gm, {
    token: { id: 'hero-ayla', name: 'Ayla', x: 1210, y: 230, size: 72 },
    roomId: '03',
    roomEntry: { room: { id: '03', name: 'Câmara Norte' } }
  });
  assert.equal(sameRoom.roomChanged, false);
  assert.equal(sameRoom.shouldNarrate, false, 'hidratação deve preservar deduplicação de sala');
});
