'use client';

import { useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';

function errorMessage(error) {
  return error?.code ? `${error.code}: ${error.message}` : error?.message || 'Falha ao abrir a visão em primeira pessoa.';
}

export function FirstPersonStage({ campaign, scene, actor, token, sessionId = null, onBack }) {
  const client = useMemo(() => createFenixApiClient({ timeoutMs: 20000 }), []);
  const [renderSession, setRenderSession] = useState(null);
  const [status, setStatus] = useState('allocating');
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let renderSessionId = null;

    async function open() {
      setStatus('allocating');
      setError(null);
      try {
        const payload = await client.request(`/v1/campaigns/${encodeURIComponent(campaign.id)}/render-sessions`, {
          method: 'POST',
          timeoutMs: 30000,
          body: {
            sceneId: scene.id,
            actorId: actor.id,
            tokenId: token.tokenId ?? token.id,
            sessionId,
            preferredCodecs: ['av1', 'h264'],
            targetFps: 60,
            maxWidth: 1920,
            maxHeight: 1080
          }
        });
        if (!active) {
          if (payload?.session?.renderSessionId) {
            void client.request(`/v1/campaigns/${encodeURIComponent(campaign.id)}/render-sessions/${encodeURIComponent(payload.session.renderSessionId)}`, { method: 'DELETE' }).catch(() => undefined);
          }
          return;
        }
        renderSessionId = payload?.session?.renderSessionId ?? null;
        setRenderSession(payload?.session ?? null);
        setStatus(payload?.session?.descriptor?.playerUrl ? 'stream-ready' : 'gpu-ready');
      } catch (cause) {
        if (!active) return;
        setStatus('error');
        setError(errorMessage(cause));
      }
    }

    void open();
    return () => {
      active = false;
      if (renderSessionId) {
        void client.request(`/v1/campaigns/${encodeURIComponent(campaign.id)}/render-sessions/${encodeURIComponent(renderSessionId)}`, { method: 'DELETE' }).catch(() => undefined);
      }
    };
  }, [actor.id, campaign.id, client, scene.id, sessionId, token.id, token.tokenId]);

  const descriptor = renderSession?.descriptor ?? null;
  const playerUrl = descriptor?.playerUrl ?? null;

  return (
    <main className="first-person-stage">
      <header className="first-person-toolbar">
        <div>
          <span className="eyebrow">Fênix · Cloud Render</span>
          <strong>Primeira pessoa · {actor.name}</strong>
          <small>{scene.name} · Token {token.tokenId ?? token.id}</small>
        </div>
        <div className="first-person-toolbar-actions">
          <span className={`first-person-status ${status}`}>{status === 'allocating' ? 'Alocando GPU…' : status === 'stream-ready' ? 'Stream ativo' : status === 'gpu-ready' ? 'GPU pronta' : 'Indisponível'}</span>
          <button type="button" className="primary-button" onClick={onBack}>Top View</button>
        </div>
      </header>

      <section className="first-person-viewport">
        {playerUrl ? (
          <iframe
            className="first-person-player"
            src={playerUrl}
            title={`Primeira pessoa de ${actor.name}`}
            allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write"
            allowFullScreen
            referrerPolicy="no-referrer"
          />
        ) : status === 'allocating' ? (
          <div className="first-person-empty">
            <span className="first-person-loader" />
            <strong>Reservando uma GPU para {actor.name}</strong>
            <p>O navegador continua como cliente fino. O mundo 3D será executado no Render Node.</p>
          </div>
        ) : error ? (
          <div className="first-person-empty error">
            <strong>Primeira pessoa indisponível</strong>
            <p>{error}</p>
            <small>A Top View permanece disponível e nenhum estado da cena foi perdido.</small>
          </div>
        ) : (
          <div className="first-person-empty">
            <strong>Render Node conectado</strong>
            <p>A sessão GPU foi criada, mas o node ainda não publicou um Player URL para o cliente WebRTC.</p>
            <dl>
              <div><dt>Transporte</dt><dd>{descriptor?.transport ?? 'webrtc'}</dd></div>
              <div><dt>Renderer</dt><dd>{descriptor?.renderer ?? 'remote-3d-runtime'}</dd></div>
              <div><dt>Região</dt><dd>{descriptor?.region ?? 'não informada'}</dd></div>
            </dl>
          </div>
        )}
      </section>
    </main>
  );
}
