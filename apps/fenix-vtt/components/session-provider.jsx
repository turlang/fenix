'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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

function runtimeScene(scene) {
  if (!scene) return structuredClone(demoSessionSnapshot.activeScene);
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description ?? '',
    width: scene.width,
    height: scene.height,
    grid: structuredClone(scene.grid ?? { size: 70, type: 'square', offsetX: 0, offsetY: 0, visible: true }),
    walls: structuredClone(scene.walls ?? []),
    lighting: structuredClone(scene.lighting ?? { enabled: false, darkness: 0.78, sources: [] })
  };
}

function snapshotForCampaign(campaign, scene = null) {
  const activeScene = runtimeScene(scene);
  const snapshot = {
    ...structuredClone(demoSessionSnapshot),
    activeScene,
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

  if (scene) {
    snapshot.sceneJournal = {
      id: `fenix-scene-${scene.id}`,
      name: scene.name,
      explicitLink: true,
      selectedPage: {
        name: scene.name,
        areaName: scene.name,
        canonicalAnchor: true,
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
        content: scene.description || `Cena tática: ${scene.name}.`
      }
    };
  }
  return snapshot;
}

export function FenixSessionProvider({ children, campaign, currentUser }) {
  const [state, dispatch] = useReducer(sessionReducer, undefined, createInitialSessionState);
  const [sceneCatalog, setSceneCatalog] = useState({ scenes: [], assets: [], activeSceneId: null });
  const client = useMemo(() => createFenixApiClient(), []);
  const audioQueueRef = useRef(null);
  const realtimeRef = useRef(null);
  const hydrateHistoryRef = useRef(false);
  const lastRoomRef = useRef(null);
  const membership = campaign?.membership ?? null;
  const isGm = membership?.role === 'gm';
  const activeScene = sceneCatalog.scenes.find((scene) => scene.id === sceneCatalog.activeSceneId) ?? sceneCatalog.scenes[0] ?? null;

  const enqueueAudio = useCallback((audio) => {
    if (audio) audioQueueRef.current?.enqueue(audio);
  }, []);

  const refreshScenes = useCallback(async () => {
    const catalog = await client.listScenes(campaign.id);
    setSceneCatalog({
      scenes: Array.isArray(catalog.scenes) ? catalog.scenes : [],
      assets: Array.isArray(catalog.assets) ? catalog.assets : [],
      activeSceneId: catalog.activeSceneId ?? catalog.scenes?.[0]?.id ?? null
    });
    return catalog;
  }, [campaign.id, client]);

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
        void refreshScenes().catch((error) => {
          dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
        });
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
  }, [appendRealtimeNarration, refreshScenes]);

  const connectRealtime = useCallback(async (sessionId, { hydrateHistory = false, seedWorld = false } = {}) => {
    const realtime = realtimeRef.current;
    if (!realtime || !sessionId) return false;
    hydrateHistoryRef.current = hydrateHistory;
    dispatch({ type: 'REALTIME_CONNECTION', status: 'connecting', error: null });
    try {
      await realtime.connect(sessionId);
      dispatch({ type: 'REALTIME_CONNECTION', status: 'connected', error: null });
      if (seedWorld && isGm) {
        realtime.updateScene(runtimeScene(activeScene));
        for (const token of demoTokens) realtime.moveToken(token, { roomId: null });
      }
      return true;
    } catch (error) {
      dispatch({ type: 'REALTIME_CONNECTION', status: 'disconnected', error: errorMessage(error) });
      return false;
    }
  }, [activeScene, isGm]);

  useEffect(() => {
    audioQueueRef.current = createBrowserAudioQueue();
    let active = true;
    let unsubscribeRealtime = () => undefined;
    if (membership?.actorId) dispatch({ type: 'SELECT_ACTOR', actorId: membership.actorId });

    void refreshScenes().catch((error) => {
      if (active) dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
    });

    try {
      const realtime = createFenixRealtimeClient();
      realtimeRef.current = realtime;
      unsubscribeRealtime = realtime.subscribe(handleRealtimeEvent);
    } catch {
      realtimeRef.current = null;
      dispatch({ type: 'REALTIME_CONNECTION', status: 'unavailable' });
    }

    client.status(campaign.id)
      .then(async (status) => {
        if (!active) return;
        dispatch({ type: 'ENGINE_STATUS', payload: status });
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
  }, [campaign.id, client, handleRealtimeEvent, membership?.actorId, refreshScenes]);

  const ensureSession = useCallback(async () => {
    const status = await client.status(campaign.id);
    if (status.state === 'COLLECTING_ACTIONS') {
      dispatch({ type: 'ENGINE_STATUS', payload: status });
      await connectRealtime(status.sessionId, { hydrateHistory: true });
      return status;
    }

    if (!isGm) throw new Error('Aguarde o mestre iniciar a sessão desta campanha.');
    const snapshot = snapshotForCampaign(campaign, activeScene);
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
  }, [activeScene, campaign, client, connectRealtime, enqueueAudio, isGm]);

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
        messageId: globalThis.crypto?.randomUUID?.() ?? null,
        campaignId: campaign.id
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
  }, [campaign.id, client, enqueueAudio, ensureSession, state.selectedActorId]);

  const enterRoom = useCallback(async (event) => {
    const roomId = event?.room?.id ?? null;
    if (!roomId || lastRoomRef.current === roomId) return null;
    lastRoomRef.current = roomId;
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      await ensureSession();
      const result = await client.roomEntry(event, campaign.id);
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
  }, [campaign.id, client, enqueueAudio, ensureSession]);

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
      const result = await client.end(campaign.id);
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
  }, [campaign.id, client, isGm]);

  const createInvite = useCallback(async (actorId) => {
    if (!isGm) throw new Error('Somente o mestre pode criar convites.');
    return client.createInvite(campaign.id, actorId);
  }, [campaign.id, client, isGm]);

  const createMapScene = useCallback(async ({ file, name, description, width, height, gridSize }) => {
    if (!isGm) throw new Error('Somente o mestre pode criar cenas.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const uploaded = await client.uploadMapAsset(campaign.id, file);
      const created = await client.createScene(campaign.id, {
        name,
        description,
        assetId: uploaded.asset.id,
        width,
        height,
        gridSize
      });
      await refreshScenes();
      return created;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm, refreshScenes]);

  const createRemoteMapScene = useCallback(async ({ url, name, description, gridSize }) => {
    if (!isGm) throw new Error('Somente o mestre pode criar cenas.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const imported = await client.importMapUrl(campaign.id, url);
      const asset = imported.asset;
      const created = await client.createScene(campaign.id, {
        name,
        description,
        assetId: asset.id,
        width: asset.width,
        height: asset.height,
        gridSize
      });
      await refreshScenes();
      return created;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm, refreshScenes]);

  const activateScene = useCallback(async (sceneId) => {
    if (!isGm) return false;
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.activateScene(campaign.id, sceneId);
      setSceneCatalog((current) => ({ ...current, activeSceneId: result.activeSceneId }));
      const scene = sceneCatalog.scenes.find((item) => item.id === result.activeSceneId);
      if (scene && realtimeRef.current?.connected) realtimeRef.current.updateScene(runtimeScene(scene));
      lastRoomRef.current = null;
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm, sceneCatalog.scenes]);

  const updateSceneGrid = useCallback(async (sceneId, grid) => {
    if (!isGm) throw new Error('Somente o mestre pode calibrar a grade.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.updateSceneGrid(campaign.id, sceneId, grid);
      setSceneCatalog((current) => ({
        ...current,
        scenes: current.scenes.map((scene) => scene.id === result.scene.id ? result.scene : scene)
      }));
      if (result.activeSceneId === result.scene.id && realtimeRef.current?.connected) {
        realtimeRef.current.updateScene(runtimeScene(result.scene));
      }
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm]);

  const updateSceneWalls = useCallback(async (sceneId, walls) => {
    if (!isGm) throw new Error('Somente o mestre pode editar paredes e portas.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.updateSceneWalls(campaign.id, sceneId, walls);
      setSceneCatalog((current) => ({
        ...current,
        scenes: current.scenes.map((scene) => scene.id === result.scene.id ? result.scene : scene)
      }));
      if (result.activeSceneId === result.scene.id && realtimeRef.current?.connected) {
        realtimeRef.current.updateScene(runtimeScene(result.scene));
      }
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm]);

  const updateSceneFog = useCallback(async (sceneId, fog) => {
    if (!isGm) throw new Error('Somente o mestre pode configurar o Fog of War.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.updateSceneFog(campaign.id, sceneId, fog);
      setSceneCatalog((current) => ({
        ...current,
        scenes: current.scenes.map((scene) => scene.id === result.scene.id ? result.scene : scene)
      }));
      if (result.activeSceneId === result.scene.id && realtimeRef.current?.connected) {
        realtimeRef.current.updateScene(runtimeScene(result.scene));
      }
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm]);

  const updateSceneLighting = useCallback(async (sceneId, lighting) => {
    if (!isGm) throw new Error('Somente o mestre pode configurar a iluminação dinâmica.');
    dispatch({ type: 'REQUEST_BEGIN' });
    try {
      const result = await client.updateSceneLighting(campaign.id, sceneId, lighting);
      setSceneCatalog((current) => ({
        ...current,
        scenes: current.scenes.map((scene) => scene.id === result.scene.id ? result.scene : scene)
      }));
      if (result.activeSceneId === result.scene.id && realtimeRef.current?.connected) {
        realtimeRef.current.updateScene(runtimeScene(result.scene));
      }
      return result;
    } catch (error) {
      dispatch({ type: 'CONNECTION_ERROR', disconnected: false, error: errorMessage(error) });
      throw error;
    } finally {
      dispatch({ type: 'REQUEST_END' });
    }
  }, [campaign.id, client, isGm]);

  const selfPresence = state.presence.find((peer) => peer.userId === currentUser?.id) ?? null;
  const value = useMemo(() => ({
    state,
    campaign,
    currentUser,
    membership,
    isGm,
    identity: selfPresence ?? membership,
    scenes: sceneCatalog.scenes,
    activeScene,
    connect,
    submitAction,
    enterRoom,
    moveToken,
    endSession,
    createInvite,
    createMapScene,
    createRemoteMapScene,
    activateScene,
    updateSceneGrid,
    updateSceneWalls,
    updateSceneFog,
    updateSceneLighting,
    resolveAssetUrl: (assetId) => client.assetUrl(campaign.id, assetId),
    selectActor: (actorId) => {
      if (isGm || actorId === membership?.actorId) dispatch({ type: 'SELECT_ACTOR', actorId });
    },
    clearError: () => dispatch({ type: 'CLEAR_ERROR' }),
    replayAudio: (audio) => enqueueAudio(audio)
  }), [activeScene, activateScene, campaign, client, connect, createInvite, createMapScene, createRemoteMapScene, currentUser, endSession, enqueueAudio, enterRoom, isGm, membership, moveToken, sceneCatalog.scenes, selfPresence, state, submitAction, updateSceneFog, updateSceneGrid, updateSceneLighting, updateSceneWalls]);

  return <FenixSessionContext.Provider value={value}>{children}</FenixSessionContext.Provider>;
}

export function useFenixSession() {
  const context = useContext(FenixSessionContext);
  if (!context) throw new Error('useFenixSession deve ser usado dentro de FenixSessionProvider.');
  return context;
}
