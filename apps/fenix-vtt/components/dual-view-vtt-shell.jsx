'use client';

import { useMemo, useState } from 'react';
import { useFenixSession } from './session-provider.jsx';
import { VttShell } from './vtt-shell.jsx';
import { FirstPersonStage } from './first-person-stage.jsx';

export function DualViewVttShell({ onExitCampaign = null, onLogout = null }) {
  const [viewMode, setViewMode] = useState('top');
  const { state, campaign, membership, actors, activeScene } = useFenixSession();

  const actorId = membership?.role === 'gm' ? state.selectedActorId : membership?.actorId;
  const actor = useMemo(
    () => actors.find((item) => item.id === actorId) ?? null,
    [actorId, actors]
  );
  const token = useMemo(
    () => state.tokens.find((item) => (item.actorId ?? item.id) === actorId) ?? null,
    [actorId, state.tokens]
  );
  const firstPersonReady = Boolean(activeScene && actor && token);

  if (viewMode === 'first-person' && firstPersonReady) {
    return (
      <FirstPersonStage
        campaign={campaign}
        scene={activeScene}
        actor={actor}
        token={token}
        sessionId={state.sessionId}
        onBack={() => setViewMode('top')}
      />
    );
  }

  return (
    <div className="dual-view-shell">
      <VttShell onExitCampaign={onExitCampaign} onLogout={onLogout} />
      <div className="view-mode-switch" role="group" aria-label="Modo de visão">
        <span>Visão</span>
        <button type="button" className="active" aria-pressed="true">Top View</button>
        <button
          type="button"
          aria-pressed="false"
          disabled={!firstPersonReady || state.busy}
          onClick={() => setViewMode('first-person')}
          title={firstPersonReady ? `Abrir primeira pessoa de ${actor.name}` : 'Selecione um ator com token colocado na cena'}
        >
          1ª Pessoa
        </button>
      </div>
    </div>
  );
}
