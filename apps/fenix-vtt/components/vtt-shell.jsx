'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapStage } from './map-stage.jsx';
import { SceneSettingsInspector } from './scene-settings-inspector.jsx';
import { useFenixSession } from './session-provider.jsx';
import { demoScene, demoTokens } from '../lib/demo-scene.js';
import {
  isEditableKeyboardTarget,
  requestedTokenFromKeyboard,
  resolveClientTokenMovement
} from '../lib/token-input-movement.js';

const actors = [
  { id: 'hero-ayla', name: 'Ayla', role: 'Jogadora', hp: '28 / 34' },
  { id: 'hero-dorian', name: 'Dorian', role: 'Jogador', hp: '21 / 27' },
  { id: 'npc-warden', name: 'Guardião', role: 'NPC', hp: 'Oculto' }
];

async function imageDimensions(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return result;
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível ler as dimensões do mapa.'));
    };
    image.src = url;
  });
}

export function VttShell({ onExitCampaign = null, onLogout = null }) {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [actionText, setActionText] = useState('');
  const [inviteActorId, setInviteActorId] = useState('hero-dorian');
  const [inviteUrl, setInviteUrl] = useState(null);
  const [sceneManagerOpen, setSceneManagerOpen] = useState(false);
  const [sceneUploadBusy, setSceneUploadBusy] = useState(false);
  const [sceneSource, setSceneSource] = useState('upload');
  const [sceneInspectorId, setSceneInspectorId] = useState(null);
  const {
    state,
    campaign,
    currentUser,
    membership,
    isGm,
    scenes,
    activeScene,
    connect,
    submitAction,
    moveToken,
    endSession,
    createInvite,
    createMapScene,
    createRemoteMapScene,
    activateScene,
    updateSceneGrid,
    updateSceneWalls,
    updateSceneElevation,
    updateSceneFog,
    resolveAssetUrl,
    selectActor,
    clearError,
    replayAudio
  } = useFenixSession();

  const selectedActor = useMemo(
    () => actors.find((actor) => actor.id === state.selectedActorId) ?? actors[0],
    [state.selectedActorId]
  );
  const inspectedScene = useMemo(
    () => scenes.find((scene) => scene.id === sceneInspectorId) ?? null,
    [sceneInspectorId, scenes]
  );
  const sessionActive = state.engineState === 'COLLECTING_ACTIONS';
  const timeline = state.timeline.slice(-4).reverse();
  const masterState = state.busy
    ? 'Narrando…'
    : sessionActive
      ? 'Observando a mesa'
      : state.connection === 'connected'
        ? 'Pronto para iniciar'
        : 'Reconectando';
  const mapScene = useMemo(() => {
    if (!activeScene) return demoScene;
    const realtimeScene = state.scene?.id === activeScene.id ? state.scene : null;
    return {
      ...activeScene,
      grid: realtimeScene?.grid ? { ...activeScene.grid, ...realtimeScene.grid } : activeScene.grid,
      walls: Array.isArray(realtimeScene?.walls) ? realtimeScene.walls : (activeScene.walls ?? []),
      lighting: realtimeScene?.lighting ? { ...activeScene.lighting, ...realtimeScene.lighting } : activeScene.lighting,
      elevation: realtimeScene?.elevation ? { ...activeScene.elevation, ...realtimeScene.elevation } : activeScene.elevation,
      regions: Array.isArray(realtimeScene?.regions) ? realtimeScene.regions : (activeScene.regions ?? []),
      background: activeScene.backgroundAssetId
        ? resolveAssetUrl(activeScene.backgroundAssetId)
        : null
    };
  }, [activeScene, resolveAssetUrl, state.scene]);

  function currentToken(actorId) {
    return state.tokens.find((token) => (token.actorId ?? token.id) === actorId)
      ?? demoTokens.find((token) => (token.actorId ?? token.id) === actorId)
      ?? null;
  }

  function resolveSafeToken(requestedToken) {
    const requestedActorId = requestedToken?.actorId ?? requestedToken?.id;
    const previousToken = currentToken(requestedActorId) ?? requestedToken;
    return resolveClientTokenMovement({
      previousToken,
      requestedToken,
      scene: mapScene,
      ignoreWalls: isGm
    });
  }

  async function handleMapTokenMoved(token, metadata = {}) {
    const resolved = resolveSafeToken(token);
    if (!resolved?.token) return false;
    const safeMetadata = resolved.collision?.blocked
      ? { roomEntry: null, roomId: undefined }
      : metadata;
    return moveToken(resolved.token, safeMetadata);
  }

  useEffect(() => {
    function handleKeyboardMove(event) {
      if (state.busy || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableKeyboardTarget(event.target)) return;

      const actorId = isGm ? state.selectedActorId : membership?.actorId;
      const token = currentToken(actorId);
      if (!token) return;

      const requested = requestedTokenFromKeyboard(token, event.key, {
        gridSize: mapScene.grid?.size,
        fullCell: event.shiftKey
      });
      if (!requested) return;

      event.preventDefault();
      const resolved = resolveSafeToken(requested);
      if (!resolved?.token) return;
      void Promise.resolve(moveToken(resolved.token)).catch(() => undefined);
    }

    window.addEventListener('keydown', handleKeyboardMove);
    return () => window.removeEventListener('keydown', handleKeyboardMove);
  }, [
    isGm,
    mapScene,
    membership?.actorId,
    moveToken,
    state.busy,
    state.selectedActorId,
    state.tokens
  ]);

  async function handleSessionButton() {
    try {
      if (sessionActive && isGm) await endSession();
      else await connect();
    } catch {
      // provider já publicou o erro operacional.
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const text = actionText.trim();
    if (!text || state.busy) return;
    try {
      await submitAction(text);
      setActionText('');
    } catch {
      // provider já publicou o erro operacional.
    }
  }

  async function handleInvite() {
    try {
      const result = await createInvite(inviteActorId);
      const base = `${window.location.origin}${window.location.pathname}`;
      const url = `${base}#invite=${encodeURIComponent(result.token)}`;
      setInviteUrl(url);
      await navigator.clipboard?.writeText?.(url);
    } catch {
      // provider/API já expõe o erro quando aplicável.
    }
  }

  async function handleCreateScene(event) {
    event.preventDefault();
    if (sceneUploadBusy) return;
    const form = new FormData(event.currentTarget);
    setSceneUploadBusy(true);
    try {
      const common = {
        name: form.get('name'),
        description: form.get('description'),
        gridSize: Number(form.get('gridSize')) || 70
      };
      if (sceneSource === 'url') {
        const url = String(form.get('mapUrl') ?? '').trim();
        if (!url) return;
        await createRemoteMapScene({ ...common, url });
      } else {
        const file = form.get('mapFile');
        if (!(file instanceof File) || !file.size) return;
        const dimensions = await imageDimensions(file);
        await createMapScene({
          ...common,
          file,
          width: dimensions.width,
          height: dimensions.height
        });
      }
      event.currentTarget.reset();
      setSceneSource('upload');
      setSceneManagerOpen(false);
    } catch {
      // provider já publicou o erro operacional.
    } finally {
      setSceneUploadBusy(false);
    }
  }

  function handleSceneContextMenu(event, scene) {
    event.preventDefault();
    event.stopPropagation();
    if (!isGm || state.busy) return;
    setSceneManagerOpen(false);
    setSceneInspectorId(scene.id);
  }

  async function handleActivateInspectedScene(sceneId) {
    await activateScene(sceneId);
    setSceneInspectorId(sceneId);
  }

  return (
    <main className={`vtt-shell ${focusMode ? 'focus-mode' : ''}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">F</span>
          <div>
            <span className="eyebrow">{campaign.title}</span>
            <strong>Fênix VTT</strong>
          </div>
        </div>

        <div className={`session-pill ${state.connection === 'connected' ? '' : 'offline'}`}>
          <span className="status-dot" />
          <span>Mestre Fênix</span>
          <strong>{masterState}</strong>
        </div>

        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => setLeftOpen((value) => !value)}>Cenas</button>
          <button type="button" className="ghost-button" onClick={() => setRightOpen((value) => !value)}>Contexto</button>
          <button type="button" className="ghost-button" disabled={state.busy} onClick={handleSessionButton}>
            {isGm ? (sessionActive ? 'Encerrar sessão' : 'Iniciar sessão') : (sessionActive ? 'Reconectar sessão' : 'Aguardar Mestre')}
          </button>
          <button type="button" className="primary-button" onClick={() => setFocusMode((value) => !value)}>
            {focusMode ? 'Painéis' : 'Foco jogador'}
          </button>
          <button type="button" className="ghost-button" onClick={onExitCampaign}>Campanhas</button>
          <button type="button" className="ghost-button" onClick={onLogout}>Sair</button>
        </div>
      </header>

      <div className={`workspace ${leftOpen ? 'with-left' : ''} ${rightOpen ? 'with-right' : ''}`}>
        {leftOpen && !focusMode ? (
          <aside className="side-panel scene-panel">
            <div className="panel-heading scene-panel-heading">
              <div><span className="eyebrow">Navegação</span><h2>Cenas</h2></div>
              {isGm ? (
                <button type="button" className="scene-add-button" onClick={() => setSceneManagerOpen((value) => !value)}>
                  {sceneManagerOpen ? 'Fechar' : '+ Mapa'}
                </button>
              ) : null}
            </div>

            {isGm && sceneManagerOpen ? (
              <form className="scene-manager-form" onSubmit={handleCreateScene}>
                <div className="scene-source-tabs" role="tablist" aria-label="Origem do mapa">
                  <button type="button" className={sceneSource === 'upload' ? 'active' : ''} onClick={() => setSceneSource('upload')}>Arquivo</button>
                  <button type="button" className={sceneSource === 'url' ? 'active' : ''} onClick={() => setSceneSource('url')}>URL</button>
                </div>
                <label>Nome da cena<input name="name" placeholder="Ex.: Templo em Ruínas" minLength={2} required /></label>
                {sceneSource === 'url' ? (
                  <label>Endereço HTTP/HTTPS<input name="mapUrl" type="url" inputMode="url" placeholder="https://exemplo.com/mapas/templo.webp" required /></label>
                ) : (
                  <label>Mapa<input name="mapFile" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
                )}
                <label>Grid (px)<input name="gridSize" type="number" min="8" max="500" defaultValue="70" required /></label>
                <label>Descrição visível<textarea name="description" rows="3" placeholder="O que os personagens percebem ao entrar nesta cena." /></label>
                <button className="primary-button" disabled={sceneUploadBusy || state.busy}>
                  {sceneUploadBusy ? (sceneSource === 'url' ? 'Importando URL…' : 'Enviando mapa…') : 'Criar cena'}
                </button>
                <small>{sceneSource === 'url' ? 'O Fênix salva uma cópia local do mapa para a campanha.' : 'PNG, JPG ou WEBP · até 15 MB.'}</small>
              </form>
            ) : null}

            <nav className="scene-list" aria-label="Cenas da campanha">
              {scenes.length ? scenes.map((scene, index) => {
                const active = activeScene?.id === scene.id;
                return (
                  <button
                    key={scene.id}
                    type="button"
                    className={`scene-row ${active ? 'active' : ''}`}
                    disabled={!isGm || state.busy}
                    onClick={() => {
                      setSceneInspectorId(null);
                      if (!active) void activateScene(scene.id);
                    }}
                    onContextMenu={(event) => handleSceneContextMenu(event, scene)}
                    title={isGm ? 'Clique para ativar · botão direito para configurar' : scene.name}
                  >
                    <span className="scene-index">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <strong>{scene.name}</strong>
                      <small>{active ? `Cena ativa · ${(scene.walls ?? []).length} paredes · ${(scene.regions ?? []).length} regiões` : `${scene.width} × ${scene.height}`}</small>
                    </span>
                  </button>
                );
              }) : (
                <div className="scene-empty-state">
                  <strong>Nenhum mapa enviado</strong>
                  <small>{isGm ? 'Use “+ Mapa” para criar sua primeira cena.' : 'Aguarde o Mestre configurar uma cena.'}</small>
                </div>
              )}
            </nav>

            {!scenes.length ? (
              <div className="demo-scene-note"><span>DEMO</span> Salão das Colunas exibido até o primeiro mapa ser enviado.</div>
            ) : null}

            <div className="panel-section">
              <span className="eyebrow">Identidade</span>
              <div className="identity-card">
                <strong>{currentUser.displayName}</strong>
                <small>{membership?.role === 'gm' ? 'Mestre da campanha' : `Jogador · ${membership?.actorId}`}</small>
              </div>
            </div>

            {isGm ? (
              <div className="panel-section invite-panel">
                <span className="eyebrow">Convite seguro</span>
                <select value={inviteActorId} onChange={(event) => setInviteActorId(event.target.value)}>
                  {actors.filter((actor) => actor.id.startsWith('hero-')).map((actor) => (
                    <option key={actor.id} value={actor.id}>{actor.name}</option>
                  ))}
                </select>
                <button type="button" className="ghost-button" onClick={handleInvite}>Gerar e copiar convite</button>
                {inviteUrl ? <small className="invite-link-preview">Link copiado · token de uso único</small> : null}
              </div>
            ) : null}
          </aside>
        ) : null}

        <section className="center-stage">
          <MapStage
            scene={mapScene}
            busy={state.busy}
            authoritativeTokens={state.tokens}
            onTokenMoved={handleMapTokenMoved}
            onSelectedActor={selectActor}
            onGridCalibrated={updateSceneGrid}
            onWallsChanged={updateSceneWalls}
            onFogChanged={updateSceneFog}
            canMoveAny={isGm}
            movableActorId={membership?.actorId ?? null}
            visionActorId={state.selectedActorId}
          />
          {isGm && inspectedScene ? (
            <SceneSettingsInspector
              scene={inspectedScene}
              active={activeScene?.id === inspectedScene.id}
              busy={state.busy}
              onClose={() => setSceneInspectorId(null)}
              onActivate={handleActivateInspectedScene}
              onUpdateElevation={updateSceneElevation}
            />
          ) : null}
        </section>

        {rightOpen && !focusMode ? (
          <aside className="side-panel context-panel">
            <div className="panel-heading context-heading-row">
              <div>
                <span className="eyebrow">Mesa</span>
                <h2>Em cena</h2>
              </div>
              <span className="presence-count">{state.presence.length} online</span>
            </div>

            <div className="presence-strip" aria-label="Participantes conectados">
              {state.presence.length ? state.presence.map((peer) => (
                <span className="presence-chip" key={peer.clientId} title={`${peer.displayName} · ${peer.role}`}>
                  <i />{peer.displayName}
                </span>
              )) : <span className="presence-empty">Aguardando participantes</span>}
            </div>

            <div className="actor-stack">
              {actors.map((actor) => {
                const selectable = isGm || actor.id === membership?.actorId;
                return (
                  <button
                    type="button"
                    className={`actor-card ${state.selectedActorId === actor.id ? 'selected' : ''}`}
                    key={actor.id}
                    disabled={!selectable}
                    onClick={() => selectActor(actor.id)}
                  >
                    <div className="actor-avatar">{actor.name.slice(0, 1)}</div>
                    <div className="actor-copy"><strong>{actor.name}</strong><small>{actor.role}</small></div>
                    <span className="actor-hp">{actor.hp}</span>
                  </button>
                );
              })}
            </div>

            <div className="ai-card">
              <div className="ai-card-heading">
                <span className="ai-orb" />
                <div>
                  <span className="eyebrow">Mestre Fênix</span>
                  <strong>{masterState}</strong>
                </div>
              </div>
              <p>Acompanha a cena, os personagens e as ações para decidir quando narrar, reagir ou permanecer em silêncio.</p>
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="timeline-shell">
        <div className="timeline-heading">
          <div><span className="eyebrow">{isGm ? 'Console do Mestre Fênix' : 'Narrativa da sessão'}</span><strong>{timeline[0]?.title ?? 'Aguardando o início da história'}</strong></div>
          <span className="audio-state">● {state.busy ? 'narrando' : timeline[0]?.audio ? 'áudio pronto' : 'aguardando'}</span>
        </div>

        <div className="timeline-list" aria-live="polite">
          {timeline.length ? timeline.map((entry) => {
            const targetActor = entry.actorId ? actors.find((actor) => actor.id === entry.actorId) : null;
            const privateLabel = isGm && entry.type === 'ROOM_ENTRY' && entry.actorId
              ? ` · Privado · ${targetActor?.name ?? entry.actorId}`
              : '';
            return (
              <article className="timeline-entry" key={entry.id}>
                <div><span>{entry.title}</span><small>{entry.type}{privateLabel}</small></div>
                <p>{entry.text}</p>
                {entry.audio ? <button type="button" className="timeline-audio-button" onClick={() => replayAudio(entry.audio)}>Reproduzir áudio</button> : null}
              </article>
            );
          }) : <p className="timeline-empty">{isGm ? 'Inicie a sessão para o Mestre Fênix acompanhar a mesa.' : 'Aguarde o mestre iniciar a sessão.'}</p>}
        </div>

        {state.error ? <div className="engine-error" role="alert"><span>{state.error}</span><button type="button" onClick={clearError}>Fechar</button></div> : null}

        <form className="command-row" onSubmit={handleSubmit}>
          <span className="command-prompt">›</span>
          <input
            aria-label="Ação do personagem"
            placeholder={`Ação de ${selectedActor.name}…`}
            value={actionText}
            disabled={state.busy || (!sessionActive && !isGm)}
            onChange={(event) => setActionText(event.target.value)}
          />
          <button type="submit" className="send-button" disabled={state.busy || !actionText.trim() || (!sessionActive && !isGm)}>
            {state.busy ? 'Narrando…' : 'Enviar ação'}
          </button>
        </form>
      </footer>
    </main>
  );
}
