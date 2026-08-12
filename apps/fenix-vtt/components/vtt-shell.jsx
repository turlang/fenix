'use client';

import { useMemo, useState } from 'react';
import { MapStage } from './map-stage.jsx';
import { useFenixSession } from './session-provider.jsx';

const scenes = [
  { id: '01', name: 'Portão Antigo', state: 'visited' },
  { id: '02', name: 'Salão das Colunas', state: 'active' },
  { id: '03', name: 'Câmara Norte', state: 'locked' }
];

const actors = [
  { id: 'hero-ayla', name: 'Ayla', role: 'Jogadora', hp: '28 / 34' },
  { id: 'hero-dorian', name: 'Dorian', role: 'Jogador', hp: '21 / 27' },
  { id: 'npc-warden', name: 'Guardião', role: 'NPC', hp: 'Oculto' }
];

export function VttShell() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  const [actionText, setActionText] = useState('');
  const {
    state,
    identity,
    connect,
    submitAction,
    moveToken,
    endSession,
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

  async function handleSessionButton() {
    try {
      if (sessionActive) await endSession();
      else await connect();
    } catch {
      // O provider já publicou o erro operacional no estado da UI.
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
      // O provider já publicou o erro operacional no estado da UI.
    }
  }

  return (
    <main className={`vtt-shell ${focusMode ? 'focus-mode' : ''}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">F</span>
          <div>
            <span className="eyebrow">Projeto Fênix</span>
            <strong>Mestre Orc VTT</strong>
          </div>
        </div>

        <div className={`session-pill ${state.connection === 'connected' ? '' : 'offline'}`}>
          <span className="status-dot" />
          <span>{state.connection === 'connected' ? 'Engine conectado' : 'Engine offline'}</span>
          <strong>{state.engineState}</strong>
          <span className={`realtime-badge ${realtimeReady ? 'online' : ''}`}>WS {state.realtime}</span>
        </div>

        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => setLeftOpen((value) => !value)}>
            Cenas
          </button>
          <button type="button" className="ghost-button" onClick={() => setRightOpen((value) => !value)}>
            Contexto
          </button>
          <button type="button" className="ghost-button" disabled={state.busy} onClick={handleSessionButton}>
            {sessionActive ? 'Encerrar sessão' : 'Iniciar sessão'}
          </button>
          <button type="button" className="primary-button" onClick={() => setFocusMode((value) => !value)}>
            {focusMode ? 'Modo mestre' : 'Foco jogador'}
          </button>
        </div>
      </header>

      <div className={`workspace ${leftOpen ? 'with-left' : ''} ${rightOpen ? 'with-right' : ''}`}>
        {leftOpen && !focusMode ? (
          <aside className="side-panel scene-panel">
            <div className="panel-heading">
              <span className="eyebrow">Navegação</span>
              <h2>Cenas</h2>
            </div>
            <nav className="scene-list" aria-label="Cenas da campanha">
              {scenes.map((scene) => (
                <button key={scene.id} type="button" className={`scene-row ${scene.state}`}>
                  <span className="scene-index">{scene.id}</span>
                  <span>
                    <strong>{scene.name}</strong>
                    <small>{scene.state === 'active' ? 'Cena ativa' : scene.state === 'locked' ? 'Não revelada' : 'Explorada'}</small>
                  </span>
                </button>
              ))}
            </nav>

            <div className="panel-section">
              <span className="eyebrow">Camadas</span>
              <div className="layer-row"><span>Grid</span><span className="mini-toggle active" /></div>
              <div className="layer-row"><span>Iluminação</span><span className="mini-toggle active" /></div>
              <div className="layer-row"><span>Fog of War</span><span className="mini-toggle" /></div>
            </div>
          </aside>
        ) : null}

        <section className="center-stage">
          <MapStage
            busy={state.busy}
            authoritativeTokens={state.tokens}
            onTokenMoved={moveToken}
            onSelectedActor={selectActor}
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
              {actors.map((actor) => (
                <button
                  type="button"
                  className={`actor-card ${state.selectedActorId === actor.id ? 'selected' : ''}`}
                  key={actor.id}
                  onClick={() => selectActor(actor.id)}
                >
                  <div className="actor-avatar">{actor.name.slice(0, 1)}</div>
                  <div className="actor-copy">
                    <strong>{actor.name}</strong>
                    <small>{actor.role}</small>
                  </div>
                  <span className="actor-hp">{actor.hp}</span>
                </button>
              ))}
            </div>

            <div className="ai-card">
              <div className="ai-card-heading">
                <span className="ai-orb" />
                <div>
                  <span className="eyebrow">AI Director</span>
                  <strong>{state.busy ? 'Processando evento' : sessionActive ? 'Narrador pronto' : 'Aguardando sessão'}</strong>
                </div>
              </div>
              <p>
                Shared Core conectado ao Session Gateway. Tokens, presença e narração são sincronizados por sessão sem acoplar WebSocket às regras.
              </p>
              <div className="ai-status-grid">
                <span>Safety <b>ON</b></span>
                <span>Quality <b>ON</b></span>
                <span>Novelty <b>ON</b></span>
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
          <div>
            <span className="eyebrow">Narration Timeline</span>
            <strong>{timeline[0]?.title ?? 'Aguardando narrativa do Engine'}</strong>
          </div>
          <span className="audio-state">● {state.busy ? 'processing' : timeline[0]?.audioState ?? 'standby'}</span>
        </div>

        <div className="timeline-list" aria-live="polite">
          {timeline.length ? timeline.map((entry) => (
            <article className="timeline-entry" key={entry.id}>
              <div>
                <span>{entry.title}</span>
                <small>{entry.type}</small>
              </div>
              <p>{entry.text}</p>
              {entry.audio ? (
                <button type="button" className="timeline-audio-button" onClick={() => replayAudio(entry.audio)}>
                  Reproduzir áudio
                </button>
              ) : null}
            </article>
          )) : (
            <p className="timeline-empty">Inicie a sessão ou mova um token para sincronizar o primeiro evento realtime.</p>
          )}
        </div>

        {state.error ? (
          <div className="engine-error" role="alert">
            <span>{state.error}</span>
            <button type="button" onClick={clearError}>Fechar</button>
          </div>
        ) : null}

        <form className="command-row" onSubmit={handleSubmit}>
          <span className="command-prompt">›</span>
          <input
            aria-label="Ação do personagem"
            placeholder={`Ação de ${selectedActor.name}…`}
            value={actionText}
            disabled={state.busy}
            onChange={(event) => setActionText(event.target.value)}
          />
          <button type="submit" className="send-button" disabled={state.busy || !actionText.trim()}>
            {state.busy ? 'Processando…' : 'Enviar ação'}
          </button>
        </form>
      </footer>
    </main>
  );
}
