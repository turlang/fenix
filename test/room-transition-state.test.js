import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomTransitionTracker } from '../apps/foundry-module/scripts/room-transition-state.js';

test('posição inicial é registrada sem produzir segunda narração', () => {
  const tracker = new RoomTransitionTracker().activate('session-1');
  tracker.prime('scene-1', [{ tokenId: 'token-1', roomKey: 'scene-1:room-2' }]);

  const sameRoom = tracker.observe('token-1', 'scene-1:room-2');
  assert.equal(sameRoom.entered, false);
  assert.equal(sameRoom.shouldNarrate, false);

  const nextRoom = tracker.observe('token-1', 'scene-1:room-4');
  assert.equal(nextRoom.entered, true);
  assert.equal(nextRoom.shouldNarrate, true);
  assert.equal(nextRoom.previous, 'scene-1:room-2');
});

test('cada token recebe cada sala uma única vez por sessão', () => {
  const tracker = new RoomTransitionTracker().activate('session-1');
  tracker.prime('scene-1', [{ tokenId: 'token-1', roomKey: 'scene-1:room-1' }]);
  const entry = tracker.observe('token-1', 'scene-1:room-3');

  assert.equal(entry.shouldNarrate, true);
  assert.equal(tracker.begin(entry.entryKey), true);
  tracker.complete(entry.entryKey);
  tracker.observe('token-1', null);

  const reentry = tracker.observe('token-1', 'scene-1:room-3');
  assert.equal(reentry.entered, true);
  assert.equal(reentry.shouldNarrate, false);

  const otherToken = tracker.observe('token-2', 'scene-1:room-3');
  assert.equal(otherToken.entered, true);
  assert.equal(otherToken.shouldNarrate, true);
  assert.notEqual(otherToken.entryKey, entry.entryKey);
});

test('requisições simultâneas da mesma entrada são bloqueadas sem bloquear outro token', () => {
  const tracker = new RoomTransitionTracker().activate('session-1');
  tracker.prime('scene-1', []);
  const first = tracker.observe('token-1', 'scene-1:room-5');
  assert.equal(first.shouldNarrate, true);
  assert.equal(tracker.begin(first.entryKey), true);
  assert.equal(tracker.begin(first.entryKey), false);

  const second = tracker.observe('token-2', 'scene-1:room-5');
  assert.equal(second.shouldNarrate, true);
  assert.equal(tracker.begin(second.entryKey), true);
});

test('falha permite nova tentativa após outro movimento', () => {
  const tracker = new RoomTransitionTracker().activate('session-1');
  tracker.prime('scene-1', [{ tokenId: 'token-1', roomKey: 'scene-1:room-1' }]);
  const entry = tracker.observe('token-1', 'scene-1:room-6');
  tracker.begin(entry.entryKey);
  tracker.fail(entry.entryKey);
  tracker.rollback('token-1', entry.previous);

  const retry = tracker.observe('token-1', 'scene-1:room-6');
  assert.equal(retry.shouldNarrate, true);
});
