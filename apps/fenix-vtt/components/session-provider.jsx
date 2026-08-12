'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { createBrowserAudioQueue } from '../lib/browser-audio-queue.js';
import { createFenixRealtimeClient } from '../lib/realtime-client.js';
import { createInitialSessionState, createTimelineEntry, sessionReducer } from '../lib/session-state.js';
import { demoSessionSnapshot, demoTokens } from '../lib/demo-scene.js';

const FenixSessionContext = createContext(null);

function errorMessage(error) {
  if (!error) return 'Falha inesperada.';
  return error.code ? `${error.code}: ${error.message}` : error.message || 'Falha inesperada.';
}

function narrationTitle(metadata = {}) {
  if (metadata.type === 'SESSION_OPENING') return 'Abertura da cena';
  if (metadata.type === 'ROOM_ENTRY') return `Entrada na sala ${metadata.roomId ?? ''}`.trim();
  if (metadata.type === 'ACTION_RESOLUTION') return 'Resolução da ação';
  return 'Narração do Engine';
}

function snapshotForCampaign(campaign) {
  return {
    ...structuredClone(demoSessionSnapshot),
    campaign: {
      worldId: campaign.id,
      title: campaign.title
    },
    metadata: {
      ...(demoSessionSnapshot.metadata ?? {}),
      campaignId: campaign.id,
      source: 'fenix-vtt',
      mode: 'standalone'
    }
  };
}

export function FenixSessionProvider({ children, campaign, currentUser }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const client = useMemo(() => createFenixApiClient(), []);
  const audioQueueRef = useRef(null);
  const realtimeRef = useRef(null);
  const hydrateHistoryRef = useRef(false);
  const lastRoomRef = useRef(null);
  const membership = campaign?.membership ?? null;
  const isGm = membership?.role === 'gm';

  const enqueueAudio = useCallback((audio) => {
    if (audio) audioQueueRef.current?.enqueue(audio);
  }, []);

  const appendRealtimeNarration = useCallback((payload) => {
    const content = String(payload?.content ?? '').trim();
    if (!content) return;
    const metadata = payload.metadata ?? {};
    const entry = createTimelineEntry({
      type: metadata.type ?? 'NARRATION',
      title: narrationTitle(metadata),
      text: content,
      audio: metadata.audio ?? null,
      roomId: metadata.roomId ?? null,
      actorId: metadata.actorId ?? null,
      sourceEventId: payload.id ?? null,
      createdAt: payload.createdAt ?? null
    });
    dispatch({
      type: 'TIMELINE_APPEND',
      entry,
      roomId: metadata.roomId ?? null,
      engineState: 'COLLECTING_ACTIONS'
    });
    enqueueAudio(metadata.audio ?? null);
  }, [enqueueAudio]);

  const handleRealtimeEvent = useCallback((event) => {
    switch (event?.type) {
      case 'CLIENT_CONNECTED':
        dispatch({ type: 'REALTIME_CONNECTION', status: 'connected', error: null });
        break;
      case 'CLIENT_DISCONNECTED':
        dispatch({ type: 'REALTIME_CONNECTION', status: 'disconnected' });
        break;
      case 'CLIENT_SOCKET_ERROR':
      case 'CLIENT_PROTOCOL_ERROR':
        dispatch({ type: 'REALTIME_CONNECTION', status: 'degraded', error: event.payload?.message ?? 'Falha realtime.' });
        break;
      case 'STATE_SYNC':
        dispatch({ type: 'REALTIME_SYNC', payload: event.payload });
        if (hydrateHistoryRef.current && Array.isArray(event.payload?.narrations)) {
          for (const narration of event.payload.narrations) appendRealtimeNarration(narration);
        }
        hydrateHistoryRef.current = false;
        break;
      case 'PRESENCE_UPDATED':
        dispatch({ type: 'REALTIME_PRESENCE', presence: event.payload?.presence });
        break;
      case 'TOKEN_MOVED':
        dispatch({ type: 'REALTIME_TOKEN', token: event.payload?.token, revision: event.payload?.revision });
        break;
      case 'SCENE_UPDATED':
        dispatch({ type: 'REALTIME_SCENE', scene: event.payload?.scene, revision: event.payload?.revision });
        break;
      case 'NARRATION':
        appendRealtimeNarration(event.payload);
        break;
      case 'ACK':
        dispatch({ type: 'REQUEST_END' });
        break;
      case 'ERROR':
        dispatch({ type: 'REQUEST_END' });
        dispatch({
          type: 'CONNECTION_ERROR',
          disconnected: false,
          error: `${event.payload?.code ?? 'REALTIME_ERROR'}: ${event.payload?.message ?? 'Falha realtime.'}`
        });
        break;
      default:
        break;
    }
  }, [appendRealtimeNarration]);

  const connectRealtime = useCallback(async (sessionId, { hydrateHistory = false, seedWorld = false } = {}) => {
    const realtime = realtimeRef.current;
    if (!realtime || !sessionId) return false;
    hydrateHistoryRef.current = hydrateHistory;
    dispatch({ type: 'REALTIME_CONNECTION', status: 'connecting', error: null });
    try {
      await realtime.connect(sessionId);
      dispatch({ type: 'REALTIME_CONNECTION', status: 'connected', error: null });
      if (seedWorld && isGm) {
        realtime.updateScene(demoSessionSnapshot.activeScene);
        for (const token of demoTokens) realtime.moveToken(token, { roomId: null });
      }
      return true;
    } catch (error) {
      dispatch({ type: 'REALTIME_CONNECTION', status: 'disconnected', error: errorMessage(error) });
      return false;
    }
  }, [isGm]);

  useEffect(() => {
    audioQueueRef.current = createBrowserAudioQueue();
    let active = true;
    let unsubscribeRealtime = () => undefined;
    if (membership?.actorId) dispatch({ type: 'SELECT_ACTOR', actorId: membership.actorId });

    try {
      const realtime = createFenixRealtimeClient();
      realtimeRef.current = realtime;
      unsubscribeRealtime = realtime.subscribe(handleRealtimeEvent);
    } catch {
      realtimeRef.current = null;
      dispatch({ type: 'REALTIME_CONNECTION', status: 'unavailable' });
    }

    client.status()
      .then(async (status) => {
        if (!active) return;
        dispatch({ type: 'ENGINE_STATUS', payload: status });
        if (status.state === 'COLLECTING_ACTIONS' && status.campaignId && status.campaignId !== campaign.id) {
          dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: 'Outra campanha possui a sessão ativa neste Engine.' });
          return;
        }
        if (status.state === 'COLLECTING_ACTIONS' && status.sessionId && realtimeRef.current) {
          hydrateHistoryRef.current = true;
          try {
            await realtimeRef.current.connect(status.sessionId);
          } catch (error) {
            if (active) dispatch({ type: 'REALTIME_CONNECTION', status: 'disconnected', error: errorMessage(error) });
          }
        }
      })
      .catch((error) => {
        if (active) dispatch({ type: 'CONNECTION_ERROR', disconnected: true, error: errorMessage(error) });
      });

    return () => {
      active = false;
      unsubscribeRealtime();
      realtimeRef.current?.close();
      realtimeRef.current = null;
      audioQueueRef.current?.destroy();
      audioQueueRef.current = null;
    };
  }, [campaign.id, client, handleRealtimeEvent, membership?.actorId]);

  const ensureSession = useCallback(async () => {
    const status = await client.status();
    if (status.state === 'COLLECTING_ACTIONS') {
      if (status.campaignId && status.campaignId !== campaign.id) {
        throw new Error('Outra campanha possui a sessão ativa neste Engine.');
      }
      dispatch({ type: 'ENGINE_STATUS', payload: status });
      await connectRealtime(status.sessionId, { hydrateHistory: true });
      return status;
    }

    if (!isGm) throw new Error('Aguarde o mestre iniciar a sessão desta campanha.');
    const snapshot = snapshotForCampaign(campaign);
    const started = await client.start(snapshot, campaign.id);
    const entry = createTimelineEntry({
      type: 'SESSION_OPENING',
      title: 'Abertura da cena',
      text: started.opening,
      audio: started.audio
    });
    dispatch({ type: 'SESSION_STARTED', payload: started, entry });
    enqueueAudio(started.audio);
    await connectRealtime(started.sessionId, { hydrateHistory: false, seedWorld: true });
    return started;
  }, [campaign, client, connectRealtime, enqueueAudio, isGm]);

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
    let submittedRealtime = false;
    try {
      await ensureSession();
      const realtime = realtimeRef.current;
      if (realtime?.connected) {
        realtime.submitAction({ content: text, actorId: state.selectedActorId });
        submittedRealtime = true;
        return { state: 'PENDING_REALTIME', transport: 'websocket' };
      }
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
      if (!submittedRealtime) dispatch({ type: 'REQUEST_END' });
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
      if (!realtimeRef.current?.connected) {
        const entry = createTimelineEntry({
          type: 'ROOM_ENTRY',
          title: `Entrada em ${result.room?.name || event.room.name}`,
          text: result.opening,
          audio: result.audio,
          roomId
        });
        dispatch({ type: 'TIMELINE_APPEND', entry, roomId, engineState: result.state });
        enqueueAudio(result.audio);
      }
      return result;
    } catch (error) {
      lastRoomRef.current = null;
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [client, enqueueAudio, ensureSession]);

  const moveToken = useCallback(async (token, { roomEntry = null, roomId = undefined } = {}) => {
    if (!isGm && membership?.actorId && token.id !== membership.actorId) return false;
    const normalizedToken = { ...token };
    dispatch({ type: 'REALTIME_TOKEN', token: normalizedToken, revision: state.revision });
    if (realtimeRef.current?.connected) {
      if (roomEntry) dispatch({ type: 'REQUEST_BEGIN' });
      try {
        realtimeRef.current.moveToken(normalizedToken, { roomEntry, roomId });
        return true;
      } catch (error) {
        if (roomEntry) dispatch({ type: 'REQUEST_END' });
        dispatch({ type: 'REALTIME_CONNECTION', status: 'degraded', error: errorMessage(error) });
      }
    }
    if (roomEntry) await enterRoom(roomEntry);
    return false;
  }, [enterRoom, isGm, membership?.actorId, state.revision]);

  const endSession = useCallback(async () => {
    if (!isGm) return null;
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.end();
      lastRoomRef.current = null;
      realtimeRef.current?.close();
      audioQueueRef.current?.clear();
      dispatch({ type: 'SESSION_ENDED', payload: result });
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: error?.code === 'FENIX_API_UNREACHABLE', error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [client, isGm]);

  const createInvite = useCallback(async (actorId) => {
    if (!isGm) throw new Error('Somente o mestre pode criar convites.');
    return client.createInvite(campaign.id, actorId);
  }, [campaign.id, client, isGm]);

  const selfPresence = state.presence.find((peer) => peer.userId === currentUser?.id) ?? null;
  const value = useMemo(() => ({
    state,
    campaign,
    currentUser,
    membership,
    isGm,
    identity: selfPresence ?? membership,
    connect,
    submitAction,
    enterRoom,
    moveToken,
    endSession,
    createInvite,
    selectActor: (actorId) => {
      if (isGm || actorId === membership?.actorId) dispatch({ type: 'SELECT_ACTOR', actorId });
    },
    clearError: () => dispatch({ type: 'CLEAR_ERROR' }),
    replayAudio: (audio) => enqueueAudio(audio)
  }), [campaign, connect, createInvite, currentUser, endSession, enqueueAudio, enterRoom, isGm, membership, moveToken, selfPresence, state, submitAction]);

  return <FenixSessionContext.Provider value={value}>{children}</FenixSessionContext.Provider>;
}

export function useFenixSession() {
  const context = useContext(FenixSessionContext);
  if (!context) throw new Error('useFenixSession deve ser usado dentro de FenixSessionProvider.');
  return context;
}
