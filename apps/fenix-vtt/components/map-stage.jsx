'use client';

import { useEffect, useRef, useState } from 'react';
import { WebGlMapRenderer, detectBrowserRendererBackend } from '../../../packages/webgl-map-renderer/src/index.js';
import {
  createDemoRoomEnteredEvent,
  demoScene,
  demoTokens,
  findRoomZone
} from '../lib/demo-scene.js';

export function MapStage({ onRoomEntered = null, onSelectedActor = null, busy = false }) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const tokensRef = useRef(new Map(demoTokens.map((token) => [token.id, { ...token }])));
  const tokenZoneRef = useRef(new Map());
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const detected = detectBrowserRendererBackend({ navigatorLike: navigator, canvas });
    if (detected === 'headless') {
      setBackend('unavailable');
      setError('Este navegador não oferece WebGL2 para o mapa do Fênix.');
      return undefined;
    }

    let renderer;
    try {
      renderer = new WebGlMapRenderer({ canvas });
      setBackend(detected === 'webgpu' ? 'webgl2 · WebGPU ready' : 'webgl2');
      rendererRef.current = renderer;
      renderer.loadScene(demoScene);
      renderer.setViewport({ x: 230, y: 160, zoom: 0.82 });
      for (const token of tokensRef.current.values()) renderer.upsertToken(token);

      const loop = () => {
        renderer.render();
        frameRef.current = requestAnimationFrame(loop);
      };
      frameRef.current = requestAnimationFrame(loop);
    } catch (cause) {
      setBackend('error');
      setError(cause.message || 'Falha ao iniciar o renderer do mapa.');
    }

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      renderer?.destroy();
      rendererRef.current = null;
    };
  }, []);

  function handlePointerDown(event) {
    if (busy) return;
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.token) return;
    dragRef.current = { tokenId: hit.token.id };
    setSelected(hit.token.name);
    onSelectedActor?.(hit.token.id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handlePointerMove(event) {
    const renderer = rendererRef.current;
    const drag = dragRef.current;
    if (!renderer || !drag || busy) return;
    const hit = renderer.hitTest(event);
    const current = tokensRef.current.get(drag.tokenId);
    if (!current) return;

    const moved = { ...current, x: hit.world.x, y: hit.world.y };
    tokensRef.current.set(moved.id, moved);
    renderer.upsertToken(moved);

    const zone = findRoomZone(hit.world);
    const previousZoneId = tokenZoneRef.current.get(moved.id) ?? null;
    const nextZoneId = zone?.id ?? null;
    if (previousZoneId === nextZoneId) return;
    tokenZoneRef.current.set(moved.id, nextZoneId);

    if (zone && moved.id.startsWith('hero-')) {
      const eventPayload = createDemoRoomEnteredEvent(zone);
      void Promise.resolve(onRoomEntered?.(eventPayload)).catch(() => undefined);
    }
  }

  function handlePointerUp(event) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }

  return (
    <section className="map-stage" aria-label="Mapa tático">
      <div className="map-hud map-hud-top">
        <span className="status-dot" aria-hidden="true" />
        <span>Renderer: {backend}</span>
        <span className="hud-divider" />
        <span>{busy ? 'Engine processando…' : '60 FPS alvo'}</span>
      </div>

      <canvas
        ref={canvasRef}
        className="map-canvas"
        aria-label="Canvas do Salão das Colunas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="map-atmosphere" aria-hidden="true" />
      <div className="map-grid-overlay" aria-hidden="true" />
      <div className="map-room-label">
        <span className="eyebrow">Cena ativa</span>
        <strong>Salão das Colunas</strong>
        <small>Arraste Ayla até a Câmara Norte · nordeste</small>
      </div>

      <div className="map-hud map-hud-bottom">
        <span>Selecionado</span>
        <strong>{selected}</strong>
      </div>

      <div className="room-zone-hint" aria-hidden="true">
        <span>03</span>
        <strong>Câmara Norte</strong>
      </div>

      {error ? <div className="map-error" role="status">{error}</div> : null}
    </section>
  );
}
