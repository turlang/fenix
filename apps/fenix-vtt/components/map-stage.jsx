'use client';

import { useEffect, useRef, useState } from 'react';
import { WebGlMapRenderer, detectBrowserRendererBackend } from '../../../packages/webgl-map-renderer/src/index.js';
import {
  createDemoRoomEnteredEvent,
  demoScene,
  demoTokens,
  demoViewport,
  findRoomZone
} from '../lib/demo-scene.js';

function fitViewport(canvas, scene) {
  if (scene.id === demoScene.id) return demoViewport;
  const cssWidth = Math.max(1, canvas.clientWidth || scene.width || 1);
  const cssHeight = Math.max(1, canvas.clientHeight || scene.height || 1);
  const zoom = Math.min(cssWidth / scene.width, cssHeight / scene.height);
  const safeZoom = Math.min(4, Math.max(0.05, Number.isFinite(zoom) ? zoom : 1));
  const visibleWidth = cssWidth / safeZoom;
  const visibleHeight = cssHeight / safeZoom;
  return {
    x: Math.max(0, (scene.width - visibleWidth) / 2),
    y: Math.max(0, (scene.height - visibleHeight) / 2),
    zoom: safeZoom
  };
}

export function MapStage({
  scene = demoScene,
  authoritativeTokens = [],
  onTokenMoved = null,
  onSelectedActor = null,
  busy = false,
  canMoveAny = false,
  movableActorId = null
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const tokensRef = useRef(new Map(demoTokens.map((token) => [token.id, { ...token }])));
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);
  const [viewport, setViewport] = useState(scene.id === demoScene.id ? demoViewport : { x: 0, y: 0, zoom: 1 });
  const demoZonesEnabled = scene.id === demoScene.id;

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
      renderer.loadScene(scene);
      const nextViewport = fitViewport(canvas, scene);
      setViewport(nextViewport);
      renderer.setViewport(nextViewport);
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
  }, [scene]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !Array.isArray(authoritativeTokens)) return;
    for (const token of authoritativeTokens) {
      if (!token?.id || dragRef.current?.tokenId === token.id) continue;
      const merged = { ...(tokensRef.current.get(token.id) ?? {}), ...token };
      tokensRef.current.set(token.id, merged);
      renderer.upsertToken(merged);
    }
  }, [authoritativeTokens]);

  function roomZoneAt(point) {
    return demoZonesEnabled ? findRoomZone(point) : null;
  }

  function handlePointerDown(event) {
    if (busy) return;
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.token) return;
    const allowed = canMoveAny || (movableActorId && hit.token.id === movableActorId);
    if (!allowed) {
      setSelected(`${hit.token.name} · somente visualização`);
      return;
    }
    const currentZone = roomZoneAt({ x: hit.token.x, y: hit.token.y });
    dragRef.current = {
      tokenId: hit.token.id,
      roomId: currentZone?.room?.id ?? null,
      roomEntry: currentZone ? createDemoRoomEnteredEvent(currentZone) : null
    };
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

    const zone = roomZoneAt(hit.world);
    drag.roomId = zone?.room?.id ?? null;
    drag.roomEntry = zone ? createDemoRoomEnteredEvent(zone) : null;
  }

  function handlePointerUp(event) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!drag) return;
    const token = tokensRef.current.get(drag.tokenId);
    if (!token) return;
    void Promise.resolve(onTokenMoved?.(token, {
      roomEntry: drag.roomEntry,
      roomId: drag.roomId
    })).catch(() => undefined);
  }

  const backgroundStyle = scene.background ? {
    position: 'absolute',
    left: 0,
    top: 0,
    width: `${scene.width}px`,
    height: `${scene.height}px`,
    backgroundImage: `url("${scene.background}")`,
    backgroundSize: '100% 100%',
    backgroundPosition: '0 0',
    backgroundRepeat: 'no-repeat',
    transformOrigin: 'top left',
    transform: `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`,
    pointerEvents: 'none',
    zIndex: 0
  } : undefined;
  const gridSize = Math.max(8, Number(scene.grid?.size) || 70) * viewport.zoom;
  const gridStyle = {
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${-viewport.x * viewport.zoom}px ${-viewport.y * viewport.zoom}px`
  };

  return (
    <section className="map-stage" aria-label="Mapa tático">
      {scene.background ? (
        <div className="map-background-layer" style={backgroundStyle} aria-hidden="true" />
      ) : null}

      <div className="map-hud map-hud-top">
        <span className="status-dot" aria-hidden="true" />
        <span>Renderer: {backend}</span>
        <span className="hud-divider" />
        <span>{busy ? 'Engine processando…' : 'Realtime autoritativo'}</span>
      </div>

      <canvas
        ref={canvasRef}
        className="map-canvas"
        aria-label={`Canvas de ${scene.name}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      <div className="map-atmosphere" aria-hidden="true" />
      <div className="map-grid-overlay" style={gridStyle} aria-hidden="true" />
      <div className="map-room-label">
        <span className="eyebrow">Cena ativa</span>
        <strong>{scene.name}</strong>
        <small>{canMoveAny ? 'Mestre · controle de todos os tokens' : `Jogador · controle de ${movableActorId || 'nenhum token'}`}</small>
      </div>

      <div className="map-hud map-hud-bottom">
        <span>Selecionado</span>
        <strong>{selected}</strong>
      </div>

      {demoZonesEnabled ? (
        <div className="room-zone-hint" aria-hidden="true">
          <span>03</span>
          <strong>Câmara Norte</strong>
        </div>
      ) : null}

      {error ? <div className="map-error" role="status">{error}</div> : null}
    </section>
  );
}
