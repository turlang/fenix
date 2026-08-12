'use client';

import { useEffect, useRef, useState } from 'react';
import { WebGlMapRenderer, detectBrowserRendererBackend } from '../../../packages/webgl-map-renderer/src/index.js';
import { demoScene, demoTokens } from '../lib/demo-scene.js';

export function MapStage() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const detected = detectBrowserRendererBackend({ navigatorLike: navigator, canvas });
    setBackend(detected);
    if (detected === 'headless') {
      setError('Este navegador não oferece WebGL2 para o mapa do Fênix.');
      return undefined;
    }

    let renderer;
    try {
      // WebGPU será implementado como outro adapter do mesmo MapRendererPort.
      // Até lá, WebGL2 permanece como baseline de produção mesmo em navegadores com WebGPU.
      renderer = new WebGlMapRenderer({ canvas });
      rendererRef.current = renderer;
      renderer.loadScene(demoScene);
      renderer.setViewport({ x: 230, y: 160, zoom: 0.82 });
      for (const token of demoTokens) renderer.upsertToken(token);

      const loop = () => {
        renderer.render();
        frameRef.current = requestAnimationFrame(loop);
      };
      frameRef.current = requestAnimationFrame(loop);
    } catch (cause) {
      setError(cause.message || 'Falha ao iniciar o renderer do mapa.');
    }

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, []);

  function handlePointerDown(event) {
    const hit = rendererRef.current?.hitTest(event);
    if (hit?.token) setSelected(hit.token.name);
  }

  return (
    <section className="map-stage" aria-label="Mapa tático">
      <div className="map-hud map-hud-top">
        <span className="status-dot" aria-hidden="true" />
        <span>Renderer: {backend}</span>
        <span className="hud-divider" />
        <span>60 FPS alvo</span>
      </div>

      <canvas
        ref={canvasRef}
        className="map-canvas"
        aria-label="Canvas do Salão das Colunas"
        onPointerDown={handlePointerDown}
      />

      <div className="map-atmosphere" aria-hidden="true" />
      <div className="map-grid-overlay" aria-hidden="true" />
      <div className="map-room-label">
        <span className="eyebrow">Cena ativa</span>
        <strong>Salão das Colunas</strong>
        <small>Grid 80 · exploração</small>
      </div>

      <div className="map-hud map-hud-bottom">
        <span>Selecionado</span>
        <strong>{selected}</strong>
      </div>

      {error ? <div className="map-error" role="status">{error}</div> : null}
    </section>
  );
}
