'use client';

import { useState } from 'react';
import { MapStage } from './map-stage.jsx';

const scenes = [
  { id: '01', name: 'Portão Antigo', state: 'visited' },
  { id: '02', name: 'Salão das Colunas', state: 'active' },
  { id: '03', name: 'Câmara Norte', state: 'locked' }
];

const actors = [
  { name: 'Ayla', role: 'Jogadora', hp: '28 / 34' },
  { name: 'Dorian', role: 'Jogador', hp: '21 / 27' },
  { name: 'Guardião', role: 'NPC', hp: 'Oculto' }
];

export function VttShell() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);

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

        <div className="session-pill">
          <span className="status-dot" />
          <span>Sessão conectada</span>
          <strong>COLLECTING_ACTIONS</strong>
        </div>

        <div className="topbar-actions">
          <button type="button" className="ghost-button" onClick={() => setLeftOpen((value) => !value)}>
            Cenas
          </button>
          <button type="button" className="ghost-button" onClick={() => setRightOpen((value) => !value)}>
            Contexto
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
          <MapStage />
        </section>

        {rightOpen && !focusMode ? (
          <aside className="side-panel context-panel">
            <div className="panel-heading">
              <span className="eyebrow">Context Rail</span>
              <h2>Em cena</h2>
            </div>

            <div className="actor-stack">
              {actors.map((actor) => (
                <article className="actor-card" key={actor.name}>
                  <div className="actor-avatar">{actor.name.slice(0, 1)}</div>
                  <div className="actor-copy">
                    <strong>{actor.name}</strong>
                    <small>{actor.role}</small>
                  </div>
                  <span className="actor-hp">{actor.hp}</span>
                </article>
              ))}
            </div>

            <div className="ai-card">
              <div className="ai-card-heading">
                <span className="ai-orb" />
                <div>
                  <span className="eyebrow">AI Director</span>
                  <strong>Narrador pronto</strong>
                </div>
              </div>
              <p>Shared Core isolado do VTT. Entrada da próxima sala será convertida em evento universal.</p>
              <div className="ai-status-grid">
                <span>Safety <b>ON</b></span>
                <span>Quality <b>ON</b></span>
                <span>Novelty <b>ON</b></span>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <footer className="timeline-shell">
        <div className="timeline-heading">
          <div>
            <span className="eyebrow">Narration Timeline</span>
            <strong>Entrada no Salão das Colunas</strong>
          </div>
          <span className="audio-state">● text-ready · audio standby</span>
        </div>
        <p>
          A luz das tochas divide as colunas em faixas de sombra. Ao norte, uma única porta de madeira interrompe a parede de pedra e define o próximo ponto de decisão.
        </p>
        <div className="command-row">
          <span className="command-prompt">›</span>
          <input aria-label="Ação do personagem" placeholder="Descreva sua ação ou use / para comandos…" />
          <button type="button" className="send-button">Enviar ação</button>
        </div>
      </footer>
    </main>
  );
}
