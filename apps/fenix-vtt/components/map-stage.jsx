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
import {
  fitViewport,
  gridScreenStyle,
  panViewport,
  zoomViewportAt
} from '../lib/map-viewport.js';

function sceneViewport(canvas, scene) {
  if (scene.id === demoScene.id) return demoViewport;
  return fitViewport({
    canvasWidth: canvas.clientWidth || scene.width,
    canvasHeight: canvas.clientHeight || scene.height,
    sceneWidth: scene.width,
    sceneHeight: scene.height
  });
}

function normalizedGrid(grid = {}) {
  return {
    size: Math.min(500, Math.max(8, Number(grid.size) || 70)),
    type: 'square',
    offsetX: Number.isFinite(Number(grid.offsetX)) ? Number(grid.offsetX) : 0,
    offsetY: Number.isFinite(Number(grid.offsetY)) ? Number(grid.offsetY) : 0,
    visible: grid.visible !== false
  };
}

export function MapStage({
  scene = demoScene,
  authoritativeTokens = [],
  onTokenMoved = null,
  onSelectedActor = null,
  onGridCalibrated = null,
  busy = false,
  canMoveAny = false,
  movableActorId = null
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const tokensRef = useRef(new Map(demoTokens.map((token) => [token.id, { ...token }])));
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);
  const [viewport, setViewport] = useState(scene.id === demoScene.id ? demoViewport : { x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState('select');
  const [gridEditorOpen, setGridEditorOpen] = useState(false);
  const [gridDraft, setGridDraft] = useState(() => normalizedGrid(scene.grid));
  const [gridSaving, setGridSaving] = useState(false);
  const demoZonesEnabled = scene.id === demoScene.id;

  useEffect(() => {
    setGridDraft(normalizedGrid(scene.grid));
    setGridEditorOpen(false);
  }, [scene.id, scene.grid]);

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
      const nextViewport = sceneViewport(canvas, scene);
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
    rendererRef.current?.setViewport(viewport);
  }, [viewport]);

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

  function viewportContext() {
    const canvas = canvasRef.current;
    return {
      canvasWidth: canvas?.clientWidth || scene.width,
      canvasHeight: canvas?.clientHeight || scene.height,
      sceneWidth: scene.width,
      sceneHeight: scene.height
    };
  }

  function applyPan(deltaX, deltaY) {
    setViewport((current) => panViewport(current, { deltaX, deltaY, ...viewportContext() }));
  }

  function applyZoom(factor, screenX = null, screenY = null) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const x = screenX ?? canvas.clientWidth / 2;
    const y = screenY ?? canvas.clientHeight / 2;
    setViewport((current) => zoomViewportAt(current, {
      factor,
      screenX: x,
      screenY: y,
      ...viewportContext()
    }));
  }

  function fitScene() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setViewport(fitViewport({
      canvasWidth: canvas.clientWidth || scene.width,
      canvasHeight: canvas.clientHeight || scene.height,
      sceneWidth: scene.width,
      sceneHeight: scene.height
    }));
  }

  function handleWheel(event) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    applyZoom(factor, event.clientX - rect.left, event.clientY - rect.top);
  }

  function handlePointerDown(event) {
    if (busy) return;
    const wantsPan = tool === 'pan' || event.button === 1;
    if (wantsPan) {
      panRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

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
    if (panRef.current) {
      const deltaX = event.clientX - panRef.current.x;
      const deltaY = event.clientY - panRef.current.y;
      panRef.current = { x: event.clientX, y: event.clientY };
      applyPan(deltaX, deltaY);
      return;
    }

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
    if (panRef.current) {
      panRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }

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

  async function saveGrid() {
    if (!onGridCalibrated || !canMoveAny || demoZonesEnabled || gridSaving) return;
    setGridSaving(true);
    try {
      await onGridCalibrated(scene.id, normalizedGrid(gridDraft));
      setGridEditorOpen(false);
    } finally {
      setGridSaving(false);
    }
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
  const gridScreen = gridScreenStyle(gridDraft, viewport);
  const gridStyle = {
    display: gridScreen.visible ? undefined : 'none',
    backgroundSize: `${gridScreen.size}px ${gridScreen.size}px`,
    backgroundPosition: `${gridScreen.x}px ${gridScreen.y}px`
  };

  return (
    <section className={`map-stage map-tool-${tool}`} aria-label="Mapa tático">
      {scene.background ? (
        <div className="map-background-layer" style={backgroundStyle} aria-hidden="true" />
      ) : null}

      <div className="map-camera-toolbar" role="toolbar" aria-label="Controles do mapa">
        <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Selecionar e mover tokens">↖</button>
        <button type="button" className={tool === 'pan' ? 'active' : ''} onClick={() => setTool('pan')} title="Mover câmera">✋</button>
        <span className="map-toolbar-divider" />
        <button type="button" onClick={() => applyZoom(1 / 1.2)} title="Diminuir zoom">−</button>
        <span className="map-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => applyZoom(1.2)} title="Aumentar zoom">+</button>
        <button type="button" onClick={fitScene} title="Ajustar mapa à tela">Ajustar</button>
        {canMoveAny && !demoZonesEnabled ? (
          <button type="button" className={gridEditorOpen ? 'active' : ''} onClick={() => setGridEditorOpen((value) => !value)} title="Calibrar grade">Grade</button>
        ) : null}
      </div>

      {gridEditorOpen ? (
        <div className="grid-calibration-panel">
          <div className="grid-calibration-heading"><strong>Calibrar grade</strong><small>Preview em tempo real</small></div>
          <label>Tamanho (px)<input type="number" min="8" max="500" step="1" value={gridDraft.size} onChange={(event) => setGridDraft((grid) => ({ ...grid, size: event.target.value }))} /></label>
          <div className="grid-calibration-row">
            <label>Offset X<input type="number" step="1" value={gridDraft.offsetX} onChange={(event) => setGridDraft((grid) => ({ ...grid, offsetX: event.target.value }))} /></label>
            <label>Offset Y<input type="number" step="1" value={gridDraft.offsetY} onChange={(event) => setGridDraft((grid) => ({ ...grid, offsetY: event.target.value }))} /></label>
          </div>
          <label className="grid-visible-toggle"><input type="checkbox" checked={gridDraft.visible !== false} onChange={(event) => setGridDraft((grid) => ({ ...grid, visible: event.target.checked }))} /> Mostrar grade</label>
          <div className="grid-calibration-actions">
            <button type="button" onClick={() => setGridDraft(normalizedGrid(scene.grid))}>Restaurar</button>
            <button type="button" className="primary-button" disabled={gridSaving || busy} onClick={saveGrid}>{gridSaving ? 'Salvando…' : 'Salvar grade'}</button>
          </div>
        </div>
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
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
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
