'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { createBrowserAudioQueue } from '../lib/browser-audio-queue.js';
import { createInitialSessionState, createTimelineEntry, sessionReducer } from '../lib/session-state.js';
import { demoSessionSnapshot } from '../lib/demo-scene.js';

const FenixSessionContext = createContext(null);

function errorMessage(error) {
  if (!error) return 'Falha inesperada.';
  return error.code ? `${error.code}: ${error.message}` : error.message || 'Falha inesperada.';
}

export function FenixSessionProvider({ children }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const client = useMemo(() => createFenixApiClient(), []);
  const audioQueueRef = useRef(null);
  const lastRoomRef = useRef(null);

  useEffect(() => {
    audioQueueRef.current = createBrowserAudioQueue();
    let active = true;
    client.status()
      .then((status) => {
        if (active) dispatch({ type: 'ENGINE_STATUS', payload: status });
      })
      .catch(() => {
        if (active) dispatch({ type: 'CONNECTION_ERROR', disconnected: true, error: 'Engine offline. Inicie a API na porta 3001.' });
      });
    return () => {
      active = false;
      audioQueueRef.current?.destroy();
      audioQueueRef.current = null;
    };
  }, [client]);

  const enqueueAudio = useCallback((audio) => {
    if (audio) audioQueueRef.current?.enqueue(audio);
  }, []);

  const ensureSession = useCallback(async () => {
    const status = await client.status();
    if (status.state === 'COLLECTING_ACTIONS') {
      dispatch({ type: 'ENGINE_STATUS', payload: status });
      return status;
    }

    const started = await client.start(demoSessionSnapshot);
    const entry = createTimelineEntry({
      type: 'SESSION_OPENING',
      title: 'Abertura da cena',
      text: started.opening,
      audio: started.audio
    });
    dispatch({ type: 'SESSION_STARTED', payload: started, entry });
    enqueueAudio(started.audio);
    return started;
  }, [client, enqueueAudio]);

  const connect = useCallback(async () => {
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      return await ensureSession();
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [ensureSession]);

  const submitAction = useCallback(async (content) => {
    const text = String(content ?? '').trim();
    if (!text) return null;
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      await ensureSession();
      const result = await client.action({
        content: text,
        actorId: state.selectedActorId,
        messageId: globalThis.crypto?.randomUUID?.() ?? null
      });
      const entry = createTimelineEntry({
        type: 'ACTION_RESOLUTION',
        title: 'Resolução da ação',
        text: result.narration,
        audio: result.audio,
        actorId: state.selectedActorId
      });
      dispatch({ type: 'TIMELINE_APPEND', entry, engineState: result.state });
      enqueueAudio(result.audio);
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [client, enqueueAudio, ensureSession, state.selectedActorId]);

  const enterRoom = useCallback(async (event) => {
    const roomId = event?.room?.id ?? null;
    if (!roomId || lastRoomRef.current === roomId) return null;
    lastRoomRef.current = roomId;
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      await ensureSession();
      const result = await client.roomEntry(event);
      const entry = createTimelineEntry({
        type: 'ROOM_ENTRY',
        title: `Entrada em ${result.room?.name || event.room.name}`,
        text: result.opening,
        audio: result.audio,
        roomId
      });
      dispatch({ type: 'TIMELINE_APPEND', entry, roomId, engineState: result.state });
      enqueueAudio(result.audio);
      return result;
    } catch (error) {
      lastRoomRef.current = null;
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [client, enqueueAudio, ensureSession]);

  const endSession = useCallback(async () => {
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.end();
      lastRoomRef.current = null;
      audioQueueRef.current?.clear();
      dispatch({ type: 'SESSION_ENDED', payload: result });
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [client]);

  const value = useMemo(() => ({
    state,
    connect,
    submitAction,
    enterRoom,
    endSession,
    selectActor: (actorId) => dispatch({ type: 'SELECT_ACTOR', actorId }),
    clearError: () => dispatch({ type: 'CLEAR_ERROR' }),
    replayAudio: (audio) => enqueueAudio(audio)
  }), [connect, endSession, enqueueAudio, enterRoom, state, submitAction]);

  return <FenixSessionContext.Provider value={value}>{children}</FenixSessionContext.Provider>;
}

export function useFenixSession() {
  const context = useContext(FenixSessionContext);
  if (!context) throw new Error('useFenixSession deve ser usado dentro de FenixSessionProvider.');
  return context;
}
