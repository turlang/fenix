'use client';

import { useMemo, useState } from 'react';
import { MapStage } from './map-stage.jsx';
import { useFenixSession } from './session-provider.jsx';
import { demoScene } from '../lib/demo-scene.js';

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
  const {
    state,
    identity,
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
    activateScene,
    updateSceneGrid,
    resolveAssetUrl,
    selectActor,
    clearError,
    replayAudio
  } = useFenixSession();

  const selectedActor = useMemo(
    () => actors.find((actor) => actor.id === state.selectedActorId) ?? actors[0],
    [state.selectedActorId]
  );
  const sessionActive = state.engineState === 'COLLECTING_ACTIONS';
  const timeline = state.timeline.slice(-4).reverse();
  const realtimeReady = state.realtime === 'connected';
  const mapScene = useMemo(() => {
    if (!activeScene) return demoScene;
    const realtimeGrid = state.scene?.id === activeScene.id ? state.scene.grid : null;
    return {
      ...activeScene,
      grid: realtimeGrid ? { ...activeScene.grid, ...realtimeGrid } : activeScene.grid,
      background: activeScene.backgroundAssetId
        ? resolveAssetUrl(activeScene.backgroundAssetId)
        : null
    };
  }, [activeScene, resolveAssetUrl, state.scene]);

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
    const file = form.get('mapFile');
    if (!(file instanceof File) || !file.size) return;
    setSceneUploadBusy(true);
    try {
      const dimensions = await imageDimensions(file);
      await createMapScene({
        file,
        name: form.get('name'),
        description: form.get('description'),
        width: dimensions.width,
        height: dimensions.height,
        gridSize: Number(form.get('gridSize')) || 70
      });
      event.currentTarget.reset();
      setSceneManagerOpen(false);
    } catch {
      // provider já publicou o erro operacional.
    } finally {
      setSceneUploadBusy(false);
    }
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
          <span>{state.connection === 'connected' ? 'Engine conectado' : 'Engine offline'}</span>
          <strong>{state.engineState}</strong>
          <span className={`realtime-badge ${realtimeReady ? 'online' : ''}`}>WS {state.realtime}</span>
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
                <label>Nome da cena<input name="name" placeholder="Ex.: Templo em Ruínas" minLength={2} required /></label>
                <label>Mapa<input name="mapFile" type="file" accept="image/png,image/jpeg,image/webp" required /></label>
                <label>Grid (px)<input name="gridSize" type="number" min="8" max="500" defaultValue="70" required /></label>
                <label>Descrição visível<textarea name="description" rows="3" placeholder="O que os personagens percebem ao entrar nesta cena." /></label>
                <button className="primary-button" disabled={sceneUploadBusy || state.busy}>
                  {sceneUploadBusy ? 'Enviando mapa…' : 'Criar cena'}
                </button>
                <small>PNG, JPG ou WEBP · até 15 MB.</small>
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
                    onClick={() => !active && activateScene(scene.id)}
                  >
                    <span className="scene-index">{String(index + 1).padStart(2, '0')}</span>
                    <span>
                      <strong>{scene.name}</strong>
                      <small>{active ? 'Cena ativa' : `${scene.width} × ${scene.height}`}</small>
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
            onTokenMoved={moveToken}
            onSelectedActor={selectActor}
            onGridCalibrated={updateSceneGrid}
            canMoveAny={isGm}
            movableActorId={membership?.actorId ?? null}
          />
        </section>

        {rightOpen && !focusMode ? (
          <aside className="side-panel context-panel">
            <div className="panel-heading context-heading-row">
              <div>
                <span className="eyebrow">Context Rail</span>
                <h2>Em cena</h2>
              </div>
              <span className="presence-count">{state.presence.length} online</span>
            </div>

            <div className="presence-strip" aria-label="Participantes conectados">
              {state.presence.length ? state.presence.map((peer) => (
                <span className="presence-chip" key={peer.clientId} title={`${peer.displayName} · ${peer.role}`}>
                  <i />{peer.displayName}
                </span>
              )) : <span className="presence-empty">Realtime ainda não conectado</span>}
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
                  <span className="eyebrow">AI Director</span>
                  <strong>{state.busy ? 'Processando evento' : sessionActive ? 'Narrador pronto' : 'Aguardando sessão'}</strong>
                </div>
              </div>
              <p>Shared Core conectado ao Session Gateway. Identidade, tokens e campanha são autorizados no servidor.</p>
              <div className="ai-status-grid">
                <span>Safety <b>ON</b></span><span>Quality <b>ON</b></span><span>Novelty <b>ON</b></span>
              </div>
              <div className="realtime-meta">
                <span>{identity?.role === 'player' ? 'PLAYER' : 'GM'} CLIENT</span>
                <span>REV {state.revision}</span>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="timeline-shell">
        <div className="timeline-heading">
          <div><span className="eyebrow">Narration Timeline</span><strong>{timeline[0]?.title ?? 'Aguardando narrativa do Engine'}</strong></div>
          <span className="audio-state">● {state.busy ? 'processing' : timeline[0]?.audioState ?? 'standby'}</span>
        </div>

        <div className="timeline-list" aria-live="polite">
          {timeline.length ? timeline.map((entry) => (
            <article className="timeline-entry" key={entry.id}>
              <div><span>{entry.title}</span><small>{entry.type}</small></div>
              <p>{entry.text}</p>
              {entry.audio ? <button type="button" className="timeline-audio-button" onClick={() => replayAudio(entry.audio)}>Reproduzir áudio</button> : null}
            </article>
          )) : <p className="timeline-empty">{isGm ? 'Inicie a sessão para abrir a narrativa persistente.' : 'Aguarde o mestre iniciar a sessão.'}</p>}
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
            {state.busy ? 'Processando…' : 'Enviar ação'}
          </button>
        </form>
      </footer>
    </main>
  );
}