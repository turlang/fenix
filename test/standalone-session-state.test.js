import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialSessionState,
  createTimelineEntry,
  sessionReducer
} from '../apps/fenix-vtt/lib/session-state.js';

test('store standalone acompanha sessão, ator e timeline', () => {
  let state = createInitialSessionState();
  state = sessionReducer(state, {
    type: 'ENGINE_STATUS',
    payload: { state: 'COLLECTING_ACTIONS', sessionId: 'session-1', sceneId: 'scene-1' }
  });
  state = sessionReducer(state, { type: 'SELECT_ACTOR', actorId: 'hero-dorian' });
  const entry = createTimelineEntry({ type: 'ROOM_ENTRY', title: 'Câmara Norte', text: 'A sala se revela em silêncio.', roomId: '03' });
  state = sessionReducer(state, { type: 'TIMELINE_APPEND', entry, roomId: '03' });

  assert.equal(state.connection, 'connected');
  assert.equal(state.engineState, 'COLLECTING_ACTIONS');
  assert.equal(state.selectedActorId, 'hero-dorian');
  assert.equal(state.lastRoomId, '03');
  assert.equal(state.timeline.length, 1);
  assert.equal(state.timeline[0].audioState, 'text-ready');
});

test('store encerra sessão sem apagar histórico narrativo', () => {
  const entry = createTimelineEntry({ type: 'SESSION_OPENING', title: 'Abertura', text: 'O salão se abre diante do grupo.' });
  const active = {
    ...createInitialSessionState(),
    connection: 'connected',
    engineState: 'COLLECTING_ACTIONS',
    sessionId: 'session-1',
    timeline: [entry],
    lastRoomId: '03'
  };
  const ended = sessionReducer(active, { type: 'SESSION_ENDED', payload: { state: 'ENDED' } });
  assert.equal(ended.engineState, 'ENDED');
  assert.equal(ended.sessionId, null);
  assert.equal(ended.lastRoomId, null);
  assert.equal(ended.timeline.length, 1);
});
