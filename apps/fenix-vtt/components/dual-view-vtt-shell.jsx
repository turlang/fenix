'use client';

import { useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { useFenixSession } from './session-provider.jsx';
import { VttShell } from './vtt-shell.jsx';
import { FirstPersonStage } from './first-person-stage.jsx';
import { ContentReviewWorkspace } from './content-review-workspace.jsx';

export function DualViewVttShell({ onExitCampaign = null, onLogout = null }) {
  const [viewMode, setViewMode] = useState('top');
  const [contentOpen, setContentOpen] = useState(false);
  const [renderAvailability, setRenderAvailability] = useState('checking');
  const client = useMemo(() => createFenixApiClient(), []);
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
  const firstPersonEnabled = firstPersonReady && renderAvailability === 'available';
  const isGm = membership?.role === 'gm';

  useEffect(() => {
    let active = true;
    client.health()
      .then((health) => {
        if (!active) return;
        setRenderAvailability(health?.remoteRender === 'gpu-broker' ? 'available' : 'disabled');
      })
      .catch(() => {
        if (active) setRenderAvailability('unavailable');
      });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (viewMode === 'first-person' && !firstPersonEnabled) setViewMode('top');
  }, [firstPersonEnabled, viewMode]);

  if (viewMode === 'first-person' && firstPersonEnabled) {
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

  const firstPersonTitle = !firstPersonReady
    ? 'Selecione um ator com token colocado na cena'
    : renderAvailability === 'checking'
      ? 'Verificando disponibilidade do Render Node…'
      : renderAvailability !== 'available'
        ? 'Primeira pessoa indisponível: Render Node não configurado neste ambiente'
        : `Abrir primeira pessoa de ${actor.name}`;

  return (
    <div className="dual-view-shell">
      <VttShell onExitCampaign={onExitCampaign} onLogout={onLogout} />
      <div className="view-mode-switch" role="group" aria-label="Modo de visão e ferramentas do Mestre">
        <span>Visão</span>
        <button type="button" className="active" aria-pressed="true">Top View</button>
        <button
          type="button"
          aria-pressed="false"
          disabled={!firstPersonEnabled || state.busy}
          onClick={() => setViewMode('first-person')}
          title={firstPersonTitle}
        >
          1ª Pessoa
        </button>
        {isGm ? (
          <button type="button" aria-pressed={contentOpen} onClick={() => setContentOpen(true)} disabled={state.busy}>
            Importador
          </button>
        ) : null}
      </div>
      {isGm && contentOpen ? <ContentReviewWorkspace campaignId={campaign.id} onClose={() => setContentOpen(false)} /> : null}
    </div>
  );
}
