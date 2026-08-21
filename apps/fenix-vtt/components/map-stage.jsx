'use client';

import { useEffect, useRef, useState } from 'react';
import { WebGlMapRenderer, detectBrowserRendererBackend } from '../../../packages/webgl-map-renderer/src/index.js';
import {
  SceneDoorState,
  SceneWallKind,
  cycleDoorState,
  pointToWallDistance,
  snapScenePoint
} from '../../../packages/scene-geometry/src/index.js';
import { normalizeSceneFog } from '../../../packages/scene-vision/src/index.js';
import { ActorSheetInspector } from './actor-sheet-inspector.jsx';
import { FogOfWarOverlay } from './fog-of-war-overlay.jsx';
import { SceneContextControls } from './scene-context-controls.jsx';
import { SceneRegionAuthoring } from './scene-region-authoring.jsx';
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
import { resolveClientTokenMovement } from '../lib/token-input-movement.js';

const GRID_PRESETS = ['#FFFFFF', '#111111', '#E6B153', '#E85D5D', '#5DADE8', '#67C587', '#A98BFF'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sceneViewport(canvas, scene) {
  if (scene.id === demoScene.id) return demoViewport;
  return fitViewport({
    canvasWidth: canvas.clientWidth || scene.width,
    canvasHeight: canvas.clientHeight || scene.height,
    sceneWidth: scene.width,
    sceneHeight: scene.height
  });
}

function normalizeGridColor(value) {
  const candidate = String(value ?? '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(candidate) ? candidate : '#D9DEE4';
}

function normalizedGrid(grid = {}) {
  const opacity = Number(grid.opacity);
  const lineWidth = Number(grid.lineWidth);
  return {
    size: Math.min(500, Math.max(8, Number(grid.size) || 70)),
    type: 'square',
    offsetX: Number.isFinite(Number(grid.offsetX)) ? Number(grid.offsetX) : 0,
    offsetY: Number.isFinite(Number(grid.offsetY)) ? Number(grid.offsetY) : 0,
    visible: grid.visible !== false,
    color: normalizeGridColor(grid.color),
    opacity: Number.isFinite(opacity) ? clamp(opacity, 0.05, 1) : 0.55,
    lineWidth: Number.isFinite(lineWidth) ? clamp(lineWidth, 0.5, 4) : 1
  };
}

function rgbaFromHex(hex, opacity) {
  const normalized = normalizeGridColor(hex).slice(1);
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${clamp(Number(opacity) || 0.55, 0.05, 1)})`;
}

function cloneWalls(walls) {
  return Array.isArray(walls) ? walls.map((wall) => ({
    ...wall,
    a: { ...wall.a },
    b: { ...wall.b }
  })) : [];
}

function randomWallId() {
  return globalThis.crypto?.randomUUID?.() ?? `wall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tokenIdentity(token = {}) {
  const tokenId = String(token.tokenId ?? token.id ?? '').trim();
  const actorId = String(token.actorId ?? tokenId).trim();
  const sheetId = String(token.sheetId ?? actorId).trim();
  return {
    tokenId,
    actorId,
    sheetId,
    systemId: String(token.systemId ?? 'generic').trim() || 'generic'
  };
}

function numberLabel(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : fallback;
}

function samePoint(a, b, tolerance = 0.01) {
  return Math.hypot(Number(a?.x) - Number(b?.x), Number(a?.y) - Number(b?.y)) <= tolerance;
}

function projectPointToWall(point, wall) {
  const ax = Number(wall?.a?.x) || 0;
  const ay = Number(wall?.a?.y) || 0;
  const bx = Number(wall?.b?.x) || 0;
  const by = Number(wall?.b?.y) || 0;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 0.0001) return { point: { x: ax, y: ay }, t: 0, length: 0 };
  const t = clamp(((Number(point.x) - ax) * dx + (Number(point.y) - ay) * dy) / lengthSquared, 0, 1);
  return {
    point: { x: ax + dx * t, y: ay + dy * t },
    t,
    length: Math.sqrt(lengthSquared)
  };
}

function pointAlongWall(wall, t) {
  return {
    x: Number(wall.a.x) + (Number(wall.b.x) - Number(wall.a.x)) * t,
    y: Number(wall.a.y) + (Number(wall.b.y) - Number(wall.a.y)) * t
  };
}

function constrainWallAngle(start, point) {
  if (!start) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.001) return point;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: start.x + Math.cos(angle) * distance,
    y: start.y + Math.sin(angle) * distance
  };
}

function tokenPlacementPoint(point, grid, free = false) {
  if (free) return { x: Number(point.x), y: Number(point.y) };
  const normalized = normalizedGrid(grid);
  const size = normalized.size;
  const x = normalized.offsetX + (Math.floor((Number(point.x) - normalized.offsetX) / size) + 0.5) * size;
  const y = normalized.offsetY + (Math.floor((Number(point.y) - normalized.offsetY) / size) + 0.5) * size;
  return { x, y };
}

export function MapStage({
  scene = demoScene,
  authoritativeTokens = [],
  onTokenMoved = null,
  onSelectedActor = null,
  onGridCalibrated = null,
  onWallsChanged = null,
  onRegionsChanged = null,
  onFogChanged = null,
  busy = false,
  canMoveAny = false,
  movableActorId = null,
  controlledActorName = null,
  visionActorId = null,
  placementActor = null,
  onPlaceActor = null,
  onCancelPlacement = null
}) {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const gridDragRef = useRef(null);
  const tokensRef = useRef(new Map(demoTokens.map((token) => [token.id, { ...token }])));
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);
  const [viewport, setViewport] = useState(scene.id === demoScene.id ? demoViewport : { x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState('select');
  const [controlContext, setControlContext] = useState('tokens');
  const [toolPaletteOpen, setToolPaletteOpen] = useState(false);
  const [gridEditorOpen, setGridEditorOpen] = useState(false);
  const [gridDraft, setGridDraft] = useState(() => normalizedGrid(scene.grid));
  const [gridSaving, setGridSaving] = useState(false);
  const [wallEditorOpen, setWallEditorOpen] = useState(false);
  const [wallMode, setWallMode] = useState('wall');
  const [doorState, setDoorState] = useState(SceneDoorState.CLOSED);
  const [snapWalls, setSnapWalls] = useState(true);
  const [snapVertices, setSnapVertices] = useState(true);
  const [wallDraft, setWallDraft] = useState(() => cloneWalls(scene.walls));
  const [wallStart, setWallStart] = useState(null);
  const [wallHover, setWallHover] = useState(null);
  const [wallHistory, setWallHistory] = useState([]);
  const [wallsSaving, setWallsSaving] = useState(false);
  const [regionEditorOpen, setRegionEditorOpen] = useState(false);
  const [fogEditorOpen, setFogEditorOpen] = useState(false);
  const [fogDraft, setFogDraft] = useState(() => normalizeSceneFog(scene.fog ?? {}));
  const [fogSaving, setFogSaving] = useState(false);
  const [fogPreview, setFogPreview] = useState(false);
  const [resetExploration, setResetExploration] = useState(false);
  const [dragVisionToken, setDragVisionToken] = useState(null);
  const [contextInspector, setContextInspector] = useState(null);
  const [placementPreview, setPlacementPreview] = useState(null);
  const demoZonesEnabled = scene.id === demoScene.id;

  useEffect(() => {
    setGridDraft(normalizedGrid(scene.grid));
    setGridEditorOpen(false);
    setWallDraft(cloneWalls(scene.walls));
    setWallHistory([]);
    setWallStart(null);
    setWallHover(null);
    setWallEditorOpen(false);
    setRegionEditorOpen(false);
    setFogDraft(normalizeSceneFog(scene.fog ?? {}));
    setFogEditorOpen(false);
    setFogPreview(false);
    setResetExploration(false);
    setDragVisionToken(null);
    setContextInspector(null);
    setControlContext('tokens');
    setToolPaletteOpen(false);
    setTool('select');
    setPlacementPreview(null);
  }, [scene.id]);

  useEffect(() => {
    if (!gridEditorOpen) setGridDraft(normalizedGrid(scene.grid));
  }, [scene.grid, gridEditorOpen]);

  useEffect(() => {
    if (!wallEditorOpen) setWallDraft(cloneWalls(scene.walls));
  }, [scene.walls, wallEditorOpen]);

  useEffect(() => {
    if (!fogEditorOpen) setFogDraft(normalizeSceneFog(scene.fog ?? {}));
  }, [scene.fog, fogEditorOpen]);

  useEffect(() => {
    if (!placementActor) setPlacementPreview(null);
  }, [placementActor]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== 'Escape') return;
      if (placementActor) {
        setPlacementPreview(null);
        onCancelPlacement?.();
        return;
      }
      if (wallEditorOpen && wallStart) {
        setWallStart(null);
        setWallHover(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancelPlacement, placementActor, wallEditorOpen, wallStart]);

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
  }, [scene.id, scene.background, scene.width, scene.height]);

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
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    applyZoom(factor, event.clientX - rect.left, event.clientY - rect.top);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [scene.id, scene.width, scene.height]);

  function nearestVertex(point) {
    let nearest = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const wall of wallDraft) {
      for (const vertex of [wall.a, wall.b]) {
        const next = Math.hypot(point.x - vertex.x, point.y - vertex.y);
        if (next < distance) {
          distance = next;
          nearest = vertex;
        }
      }
    }
    return distance <= 12 / Math.max(0.1, viewport.zoom) ? nearest : null;
  }

  function boundedWallPoint(point, { constrain = false } = {}) {
    let base = snapWalls ? snapScenePoint(point, gridDraft) : point;
    if (constrain && wallStart) base = constrainWallAngle(wallStart, base);
    if (snapVertices) {
      const vertex = nearestVertex(base);
      if (vertex) base = vertex;
    }
    return {
      x: Math.max(0, Math.min(scene.width, Number(base.x) || 0)),
      y: Math.max(0, Math.min(scene.height, Number(base.y) || 0))
    };
  }

  function rememberAndSetWalls(nextWalls) {
    setWallHistory((history) => [...history.slice(-29), cloneWalls(wallDraft)]);
    setWallDraft(cloneWalls(nextWalls));
  }

  function nearestWall(point, { doorsOnly = false, wallsOnly = false } = {}) {
    const candidates = wallDraft.filter((wall) => {
      if (doorsOnly) return wall.kind === SceneWallKind.DOOR;
      if (wallsOnly) return wall.kind === SceneWallKind.WALL;
      return true;
    });
    let nearest = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const wall of candidates) {
      const next = pointToWallDistance(point, wall);
      if (next < distance) {
        distance = next;
        nearest = wall;
      }
    }
    return distance <= 16 / Math.max(0.1, viewport.zoom) ? nearest : null;
  }

  function insertDoorIntoWall(wall, clickPoint) {
    const projection = projectPointToWall(clickPoint, wall);
    if (!wall || projection.length < 8) return false;
    const desiredLength = Math.min(Math.max(16, normalizedGrid(gridDraft).size), projection.length * 0.72);
    const halfT = desiredLength / projection.length / 2;
    const startT = clamp(projection.t - halfT, 0.02, 0.96);
    const endT = clamp(projection.t + halfT, 0.04, 0.98);
    if (endT - startT <= 0.02) return false;
    const doorA = pointAlongWall(wall, startT);
    const doorB = pointAlongWall(wall, endT);
    const replacement = [];
    if (Math.hypot(doorA.x - wall.a.x, doorA.y - wall.a.y) >= 2) {
      replacement.push({ ...wall, id: wall.id, a: { ...wall.a }, b: doorA, kind: SceneWallKind.WALL, doorState: null });
    }
    replacement.push({
      id: randomWallId(),
      kind: SceneWallKind.DOOR,
      a: doorA,
      b: doorB,
      doorState
    });
    if (Math.hypot(wall.b.x - doorB.x, wall.b.y - doorB.y) >= 2) {
      replacement.push({ ...wall, id: randomWallId(), a: doorB, b: { ...wall.b }, kind: SceneWallKind.WALL, doorState: null });
    }
    const index = wallDraft.findIndex((item) => item.id === wall.id);
    if (index < 0) return false;
    rememberAndSetWalls([
      ...wallDraft.slice(0, index),
      ...replacement,
      ...wallDraft.slice(index + 1)
    ]);
    return true;
  }

  function handleWallAuthoring(event) {
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.world) return false;
    const point = boundedWallPoint(hit.world, { constrain: event.shiftKey });

    if (wallMode === 'erase') {
      const nearest = nearestWall(point);
      if (nearest) rememberAndSetWalls(wallDraft.filter((wall) => wall.id !== nearest.id));
      setWallStart(null);
      return true;
    }

    if (wallMode === 'door-state') {
      const nearest = nearestWall(point, { doorsOnly: true });
      if (nearest) {
        rememberAndSetWalls(wallDraft.map((wall) => wall.id === nearest.id
          ? { ...wall, doorState: cycleDoorState(wall.doorState) }
          : wall));
      }
      setWallStart(null);
      return true;
    }

    if (wallMode === 'door') {
      const wall = nearestWall(hit.world, { wallsOnly: true });
      if (wall) insertDoorIntoWall(wall, hit.world);
      setWallStart(null);
      return true;
    }

    if (!wallStart) {
      setWallStart(point);
      setWallHover(point);
      return true;
    }

    if (Math.hypot(point.x - wallStart.x, point.y - wallStart.y) >= 2) {
      rememberAndSetWalls([...wallDraft, {
        id: randomWallId(),
        kind: SceneWallKind.WALL,
        a: wallStart,
        b: point,
        doorState: null
      }]);
      setWallStart(point);
      setWallHover(point);
    }
    return true;
  }

  function handlePointerDown(event) {
    if (busy || event.button === 2 || regionEditorOpen) return;
    const wantsPan = tool === 'pan' || event.button === 1;
    if (wantsPan) {
      panRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    const hit = rendererRef.current?.hitTest(event);

    if (placementActor && canMoveAny && event.button === 0) {
      if (!hit?.world) return;
      const point = tokenPlacementPoint(hit.world, gridDraft, event.altKey);
      setPlacementPreview(point);
      void Promise.resolve(onPlaceActor?.(point)).catch((cause) => setError(cause?.message ?? 'Não foi possível colocar o token.'));
      event.preventDefault();
      return;
    }

    if (gridEditorOpen && canMoveAny && event.button === 0) {
      gridDragRef.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: Number(gridDraft.offsetX) || 0,
        offsetY: Number(gridDraft.offsetY) || 0
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (wallEditorOpen && canMoveAny && event.button === 0) {
      if (handleWallAuthoring(event)) {
        event.preventDefault();
        return;
      }
    }

    if (!hit?.token) return;
    const identity = tokenIdentity(hit.token);
    const allowed = canMoveAny || (movableActorId && identity.actorId === movableActorId);
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
    setContextInspector(null);
    setSelected(hit.token.name);
    setDragVisionToken({ ...hit.token });
    onSelectedActor?.(identity.actorId);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function handleContextMenu(event) {
    event.preventDefault();
    if (busy || regionEditorOpen) return;
    if (wallEditorOpen && wallStart) {
      setWallStart(null);
      setWallHover(null);
      return;
    }
    const hit = rendererRef.current?.hitTest(event);
    if (hit?.token) {
      const token = { ...(tokensRef.current.get(hit.token.id) ?? {}), ...hit.token };
      const identity = tokenIdentity(token);
      const allowed = canMoveAny || (movableActorId && identity.actorId === movableActorId);
      if (!allowed) {
        setSelected(`${token.name} · somente visualização`);
        return;
      }
      setControlContext('tokens');
      setSelected(token.name);
      onSelectedActor?.(identity.actorId);
      setContextInspector({ type: 'token', token });
      return;
    }
    if (canMoveAny) {
      setControlContext('map');
      setContextInspector({ type: 'scene', scene });
    }
  }

  function handlePointerMove(event) {
    if (panRef.current) {
      const deltaX = event.clientX - panRef.current.x;
      const deltaY = event.clientY - panRef.current.y;
      panRef.current = { x: event.clientX, y: event.clientY };
      applyPan(deltaX, deltaY);
      return;
    }

    if (gridDragRef.current) {
      const dx = (event.clientX - gridDragRef.current.x) / Math.max(0.1, viewport.zoom);
      const dy = (event.clientY - gridDragRef.current.y) / Math.max(0.1, viewport.zoom);
      setGridDraft((grid) => ({
        ...grid,
        offsetX: Math.round((gridDragRef.current.offsetX + dx) * 100) / 100,
        offsetY: Math.round((gridDragRef.current.offsetY + dy) * 100) / 100
      }));
      return;
    }

    const renderer = rendererRef.current;
    if (!renderer) return;
    const hit = renderer.hitTest(event);

    if (placementActor && hit?.world) {
      setPlacementPreview(tokenPlacementPoint(hit.world, gridDraft, event.altKey));
      return;
    }

    if (wallEditorOpen && canMoveAny && hit?.world) {
      setWallHover(boundedWallPoint(hit.world, { constrain: event.shiftKey }));
      return;
    }

    const drag = dragRef.current;
    if (!drag || busy || regionEditorOpen) return;
    const current = tokensRef.current.get(drag.tokenId);
    if (!current || !hit?.world) return;

    const requested = { ...current, x: hit.world.x, y: hit.world.y };
    const resolved = resolveClientTokenMovement({
      previousToken: current,
      requestedToken: requested,
      scene,
      ignoreWalls: canMoveAny
    });
    const moved = resolved?.token ?? requested;
    tokensRef.current.set(moved.id, moved);
    renderer.upsertToken(moved);
    setDragVisionToken(moved);

    const zone = roomZoneAt({ x: moved.x, y: moved.y });
    drag.roomId = zone?.room?.id ?? null;
    drag.roomEntry = zone ? createDemoRoomEnteredEvent(zone) : null;
  }

  function handlePointerUp(event) {
    if (panRef.current) {
      panRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }

    if (gridDragRef.current) {
      gridDragRef.current = null;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
      return;
    }

    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!drag || wallEditorOpen || regionEditorOpen) {
      setDragVisionToken(null);
      return;
    }
    const token = tokensRef.current.get(drag.tokenId);
    if (!token) {
      setDragVisionToken(null);
      return;
    }
    void Promise.resolve(onTokenMoved?.(token, {
      roomEntry: drag.roomEntry,
      roomId: drag.roomId
    })).catch(() => undefined).finally(() => setDragVisionToken(null));
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

  async function saveWalls() {
    if (!onWallsChanged || !canMoveAny || demoZonesEnabled || wallsSaving) return;
    setWallsSaving(true);
    try {
      const result = await onWallsChanged(scene.id, wallDraft);
      setWallDraft(cloneWalls(result?.scene?.walls ?? wallDraft));
      setWallHistory([]);
      setWallStart(null);
      setWallHover(null);
      setWallEditorOpen(false);
    } finally {
      setWallsSaving(false);
    }
  }

  async function saveFog() {
    if (!onFogChanged || !canMoveAny || demoZonesEnabled || fogSaving) return;
    setFogSaving(true);
    try {
      const normalized = normalizeSceneFog(fogDraft);
      const result = await onFogChanged(scene.id, {
        enabled: normalized.enabled,
        exploredOpacity: normalized.exploredOpacity,
        unexploredOpacity: normalized.unexploredOpacity,
        resetExploration
      });
      setFogDraft(normalizeSceneFog(result?.scene?.fog ?? fogDraft));
      setResetExploration(false);
      setFogEditorOpen(false);
    } finally {
      setFogSaving(false);
    }
  }

  function cancelWalls() {
    setWallDraft(cloneWalls(scene.walls));
    setWallHistory([]);
    setWallStart(null);
    setWallHover(null);
    setWallEditorOpen(false);
  }

  function undoWallChange() {
    setWallHistory((history) => {
      if (!history.length) return history;
      setWallDraft(cloneWalls(history[history.length - 1]));
      return history.slice(0, -1);
    });
    setWallStart(null);
    setWallHover(null);
  }

  function closeSceneEditors() {
    setGridEditorOpen(false);
    setWallEditorOpen(false);
    setRegionEditorOpen(false);
    setFogEditorOpen(false);
    setFogPreview(false);
    setWallStart(null);
    setWallHover(null);
  }

  function activateTokenTool(nextTool = 'select') {
    setControlContext('tokens');
    setToolPaletteOpen(true);
    setContextInspector(null);
    closeSceneEditors();
    setTool(nextTool === 'pan' ? 'pan' : 'select');
  }

  function openSceneTool(nextTool) {
    setControlContext('map');
    setToolPaletteOpen(true);
    setContextInspector(null);
    setGridEditorOpen(nextTool === 'grid');
    setWallEditorOpen(nextTool === 'walls');
    setRegionEditorOpen(nextTool === 'regions');
    setFogEditorOpen(nextTool === 'fog');
    setFogPreview(false);
    setWallStart(null);
    setWallHover(null);
    setTool(nextTool === 'pan' ? 'pan' : 'select');
  }

  function toggleControlContext(nextContext) {
    if (nextContext === controlContext) {
      setToolPaletteOpen((value) => !value);
      return;
    }
    setControlContext(nextContext);
    setToolPaletteOpen(true);
    setContextInspector(null);
    if (nextContext === 'tokens') {
      closeSceneEditors();
      setTool('select');
    }
  }

  function toggleVisionPreview() {
    setControlContext('map');
    setToolPaletteOpen(true);
    setGridEditorOpen(false);
    setWallEditorOpen(false);
    setRegionEditorOpen(false);
    setFogEditorOpen(false);
    setContextInspector(null);
    setTool('select');
    setFogPreview((value) => !value);
  }

  function nudgeGrid(field, delta) {
    setGridDraft((grid) => ({ ...grid, [field]: Math.round((Number(grid[field]) + delta) * 100) / 100 }));
  }

  function screenPoint(point) {
    return {
      x: (Number(point?.x) - viewport.x) * viewport.zoom,
      y: (Number(point?.y) - viewport.y) * viewport.zoom
    };
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
  const gridLineColor = rgbaFromHex(gridDraft.color, gridEditorOpen ? Math.max(gridDraft.opacity, 0.72) : gridDraft.opacity);
  const lineWidth = Math.max(0.5, Number(gridDraft.lineWidth) || 1);
  const gridStyle = {
    display: gridScreen.visible ? undefined : 'none',
    backgroundSize: `${gridScreen.size}px ${gridScreen.size}px`,
    backgroundPosition: `${gridScreen.x}px ${gridScreen.y}px`,
    backgroundImage: `linear-gradient(to right, ${gridLineColor} ${lineWidth}px, transparent ${lineWidth}px), linear-gradient(to bottom, ${gridLineColor} ${lineWidth}px, transparent ${lineWidth}px)`
  };
  const fogEnabled = scene.fog?.enabled === true;
  const fogActive = fogEnabled && (!canMoveAny || fogPreview);
  const resolvedVisionActorId = canMoveAny ? visionActorId : movableActorId;
  const inspectedToken = contextInspector?.type === 'token' ? contextInspector.token : null;
  const placementScreen = placementPreview ? screenPoint(placementPreview) : null;
  const placementSize = normalizedGrid(gridDraft).size * viewport.zoom;

  return (
    <section className={`map-stage map-tool-${tool} context-${controlContext} ${wallEditorOpen ? 'wall-authoring-active' : ''} ${gridEditorOpen ? 'grid-authoring-active' : ''} ${regionEditorOpen ? 'region-authoring-active' : ''} ${placementActor ? 'token-placement-active' : ''}`} aria-label="Mapa tático">
      {scene.background ? (
        <div className="map-background-layer" style={backgroundStyle} aria-hidden="true" />
      ) : null}

      <SceneContextControls
        canEditMap={canMoveAny}
        demoMode={demoZonesEnabled}
        context={controlContext}
        paletteOpen={toolPaletteOpen}
        tool={tool}
        gridEditorOpen={gridEditorOpen}
        wallEditorOpen={wallEditorOpen}
        regionEditorOpen={regionEditorOpen}
        fogEditorOpen={fogEditorOpen}
        fogPreview={fogPreview}
        fogEnabled={fogEnabled}
        visionAvailable={Boolean(resolvedVisionActorId)}
        zoomPercent={Math.round(viewport.zoom * 100)}
        onToggleContext={toggleControlContext}
        onTokenTool={activateTokenTool}
        onMapTool={openSceneTool}
        onToggleVision={toggleVisionPreview}
        onZoomOut={() => applyZoom(1 / 1.2)}
        onZoomIn={() => applyZoom(1.2)}
        onFit={fitScene}
      />

      {placementActor ? (
        <div className="token-placement-banner" role="status">
          <div><span className="eyebrow">Colocar token</span><strong>{placementActor.name}</strong></div>
          <small>Clique no mapa para posicionar · Alt = posição livre · Esc = cancelar</small>
          <button type="button" onClick={() => onCancelPlacement?.()}>Cancelar</button>
        </div>
      ) : null}

      {gridEditorOpen ? (
        <div className="grid-calibration-panel">
          <div className="grid-calibration-heading"><strong>Calibrar grade</strong><small>Preview em tempo real · arraste a grade no mapa</small></div>
          <label>Tamanho (px)<input type="number" min="8" max="500" step="1" value={gridDraft.size} onChange={(event) => setGridDraft((grid) => ({ ...grid, size: event.target.value }))} /></label>
          <div className="grid-calibration-row">
            <label>Offset X<input type="number" step="1" value={gridDraft.offsetX} onChange={(event) => setGridDraft((grid) => ({ ...grid, offsetX: event.target.value }))} /></label>
            <label>Offset Y<input type="number" step="1" value={gridDraft.offsetY} onChange={(event) => setGridDraft((grid) => ({ ...grid, offsetY: event.target.value }))} /></label>
          </div>
          <div className="grid-nudge-controls" aria-label="Ajuste fino da grade">
            <button type="button" onClick={() => nudgeGrid('offsetX', -1)}>X −1</button>
            <button type="button" onClick={() => nudgeGrid('offsetX', 1)}>X +1</button>
            <button type="button" onClick={() => nudgeGrid('offsetY', -1)}>Y −1</button>
            <button type="button" onClick={() => nudgeGrid('offsetY', 1)}>Y +1</button>
            <button type="button" onClick={() => nudgeGrid('size', -1)}>− tamanho</button>
            <button type="button" onClick={() => nudgeGrid('size', 1)}>+ tamanho</button>
          </div>
          <div className="grid-appearance-row">
            <label>Cor da linha<input type="color" value={gridDraft.color} onChange={(event) => setGridDraft((grid) => ({ ...grid, color: event.target.value.toUpperCase() }))} /></label>
            <label>Opacidade <strong>{Math.round(Number(gridDraft.opacity) * 100)}%</strong><input type="range" min="0.05" max="1" step="0.05" value={gridDraft.opacity} onChange={(event) => setGridDraft((grid) => ({ ...grid, opacity: Number(event.target.value) }))} /></label>
            <label>Espessura <strong>{numberLabel(gridDraft.lineWidth, 1)}px</strong><input type="range" min="0.5" max="4" step="0.5" value={gridDraft.lineWidth} onChange={(event) => setGridDraft((grid) => ({ ...grid, lineWidth: Number(event.target.value) }))} /></label>
          </div>
          <div className="grid-color-presets" aria-label="Cores rápidas da grade">
            {GRID_PRESETS.map((color) => <button key={color} type="button" title={color} aria-label={`Usar ${color}`} style={{ background: color }} onClick={() => setGridDraft((grid) => ({ ...grid, color }))} />)}
          </div>
          <label className="grid-visible-toggle"><input type="checkbox" checked={gridDraft.visible !== false} onChange={(event) => setGridDraft((grid) => ({ ...grid, visible: event.target.checked }))} /> Mostrar grade</label>
          <div className="grid-calibration-actions">
            <button type="button" onClick={() => setGridDraft(normalizedGrid(scene.grid))}>Restaurar</button>
            <button type="button" className="primary-button" disabled={gridSaving || busy} onClick={saveGrid}>{gridSaving ? 'Salvando…' : 'Salvar grade'}</button>
          </div>
        </div>
      ) : null}

      {wallEditorOpen ? (
        <div className="wall-authoring-panel">
          <div className="wall-authoring-heading">
            <div><strong>Paredes e portas</strong><small>{wallDraft.length} segmentos · desenho contínuo com preview</small></div>
            <span>{wallStart ? 'Desenhando · Esc encerra' : 'Pronto'}</span>
          </div>
          <div className="wall-authoring-tools">
            <button type="button" className={wallMode === 'wall' ? 'active' : ''} onClick={() => { setWallMode('wall'); setWallStart(null); }}>Parede</button>
            <button type="button" className={wallMode === 'door' ? 'active' : ''} onClick={() => { setWallMode('door'); setWallStart(null); }}>Porta na parede</button>
            <button type="button" className={wallMode === 'door-state' ? 'active' : ''} onClick={() => { setWallMode('door-state'); setWallStart(null); }}>Alternar porta</button>
            <button type="button" className={wallMode === 'erase' ? 'active danger' : 'danger'} onClick={() => { setWallMode('erase'); setWallStart(null); }}>Apagar</button>
          </div>
          <small className="wall-authoring-help">Parede: clique para iniciar e continue clicando para criar segmentos conectados. Shift trava em ângulos de 45°. Porta: clique diretamente sobre uma parede existente.</small>
          <div className="wall-authoring-options">
            <label><input type="checkbox" checked={snapWalls} onChange={(event) => setSnapWalls(event.target.checked)} /> Snap na grade</label>
            <label><input type="checkbox" checked={snapVertices} onChange={(event) => setSnapVertices(event.target.checked)} /> Snap em vértices</label>
            <label>Nova porta
              <select value={doorState} onChange={(event) => setDoorState(event.target.value)} disabled={wallMode !== 'door'}>
                <option value={SceneDoorState.CLOSED}>Fechada</option>
                <option value={SceneDoorState.OPEN}>Aberta</option>
                <option value={SceneDoorState.LOCKED}>Trancada</option>
              </select>
            </label>
          </div>
          <div className="wall-authoring-actions">
            <button type="button" disabled={!wallStart} onClick={() => { setWallStart(null); setWallHover(null); }}>Encerrar traçado</button>
            <button type="button" disabled={!wallHistory.length} onClick={undoWallChange}>Desfazer</button>
            <button type="button" onClick={cancelWalls}>Cancelar</button>
            <button type="button" className="primary-button" disabled={wallsSaving || busy} onClick={saveWalls}>{wallsSaving ? 'Salvando…' : 'Salvar paredes'}</button>
          </div>
        </div>
      ) : null}

      {fogEditorOpen ? (
        <div className="fog-config-panel">
          <div className="fog-config-heading"><strong>Fog of War</strong><small>Memória da cena</small></div>
          <label className="fog-config-toggle"><input type="checkbox" checked={fogDraft.enabled} onChange={(event) => setFogDraft((fog) => ({ ...fog, enabled: event.target.checked }))} /> Ativar Fog nesta cena</label>
          <div className="fog-config-row">
            <label>Opacidade explorada<input type="number" min="0" max="0.95" step="0.05" value={fogDraft.exploredOpacity} onChange={(event) => setFogDraft((fog) => ({ ...fog, exploredOpacity: event.target.value }))} /></label>
            <label>Opacidade não vista<input type="number" min="0" max="1" step="0.05" value={fogDraft.unexploredOpacity} onChange={(event) => setFogDraft((fog) => ({ ...fog, unexploredOpacity: event.target.value }))} /></label>
          </div>
          <label className="fog-reset-toggle"><input type="checkbox" checked={resetExploration} onChange={(event) => setResetExploration(event.target.checked)} /> Limpar áreas exploradas ao salvar</label>
          <small className="fog-config-help">Fog guarda apenas o que já foi explorado. Alcance e sentidos vêm da Ficha + Sistema RPG; paredes e portas continuam definindo a linha de visão.</small>
          <div className="fog-config-actions">
            <button type="button" onClick={() => { setFogDraft(normalizeSceneFog(scene.fog ?? {})); setResetExploration(false); setFogEditorOpen(false); }}>Cancelar</button>
            <button type="button" className="primary-button" disabled={fogSaving || busy} onClick={saveFog}>{fogSaving ? 'Salvando…' : 'Salvar Fog'}</button>
          </div>
        </div>
      ) : null}

      {contextInspector ? (
        <aside className="map-context-inspector" aria-label={contextInspector.type === 'token' ? 'Configurações do token' : 'Configurações da cena'}>
          <div className="map-context-inspector-heading">
            <div>
              <span className="eyebrow">{contextInspector.type === 'token' ? 'Token / Entidade' : 'Mapa / Cena'}</span>
              <strong>{contextInspector.type === 'token' ? inspectedToken?.name : scene.name}</strong>
            </div>
            <button type="button" className="context-close-button" onClick={() => setContextInspector(null)} aria-label="Fechar configurações">×</button>
          </div>

          {contextInspector.type === 'token' ? (
            <ActorSheetInspector
              token={inspectedToken}
              onApplied={async () => {
                if (inspectedToken) await onTokenMoved?.(inspectedToken, {});
              }}
            />
          ) : (
            <>
              <div className="context-inspector-section">
                <span className="eyebrow">Configurações da cena</span>
                <dl className="context-definition-list">
                  <div><dt>Dimensões</dt><dd>{scene.width} × {scene.height}px</dd></div>
                  <div><dt>Grade</dt><dd>{normalizedGrid(scene.grid).size}px</dd></div>
                  <div><dt>Escala</dt><dd>1 célula = {numberLabel(scene.grid?.distanceMeters, 1.5)} m</dd></div>
                  <div><dt>Paredes/portas</dt><dd>{(scene.walls ?? []).length}</dd></div>
                  <div><dt>Regiões</dt><dd>{(scene.regions ?? []).length}</dd></div>
                  <div><dt>Fog</dt><dd>{scene.fog?.enabled ? 'Ativo' : 'Desligado'}</dd></div>
                  <div><dt>Luz</dt><dd>{scene.lighting?.enabled ? 'Ativa' : 'Desligada'}</dd></div>
                </dl>
              </div>
              {!demoZonesEnabled ? (
                <div className="context-inspector-actions">
                  <button type="button" onClick={() => openSceneTool('grid')}>Grade e escala</button>
                  <button type="button" onClick={() => openSceneTool('walls')}>Paredes e portas</button>
                  <button type="button" onClick={() => openSceneTool('regions')}>Pisos, escadas e rampas</button>
                  <button type="button" onClick={() => openSceneTool('fog')}>Fog / exploração</button>
                </div>
              ) : null}
              <p className="context-inspector-note">Mapa guarda geometria e ambiente. Regras de personagem não pertencem à cena.</p>
            </>
          )}
        </aside>
      ) : null}

      <div className="map-hud map-hud-top">
        <span className="status-dot" aria-hidden="true" />
        <span>Renderer: {backend}</span>
        <span className="hud-divider" />
        <span>{busy ? 'Engine processando…' : 'Realtime autoritativo'}</span>
        {!demoZonesEnabled ? <><span className="hud-divider" /><span className={`fog-status-chip ${fogEnabled ? 'active' : ''}`}>FOG {fogEnabled ? 'ON' : 'OFF'}</span></> : null}
      </div>

      <canvas
        ref={canvasRef}
        className="map-canvas"
        aria-label={`Canvas de ${scene.name}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        onDoubleClick={() => {
          if (wallEditorOpen && wallStart) {
            setWallStart(null);
            setWallHover(null);
          }
        }}
      />

      <FogOfWarOverlay
        scene={scene}
        tokens={authoritativeTokens}
        actorId={resolvedVisionActorId}
        viewport={viewport}
        active={fogActive}
        transientToken={dragVisionToken}
      />

      {canMoveAny && regionEditorOpen ? (
        <SceneRegionAuthoring
          scene={scene}
          viewport={viewport}
          busy={busy}
          onRegionsChanged={onRegionsChanged}
          onClose={() => setRegionEditorOpen(false)}
        />
      ) : null}

      {canMoveAny && wallEditorOpen ? (
        <svg className="wall-authoring-overlay" aria-label="Geometria de paredes da cena">
          {wallDraft.map((wall) => {
            const a = screenPoint(wall.a);
            const b = screenPoint(wall.b);
            const stateClass = wall.kind === SceneWallKind.DOOR ? ` door-${wall.doorState}` : '';
            return (
              <g key={wall.id}>
                <line className={`wall-segment wall-${wall.kind}${stateClass}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
                <circle className="wall-vertex-handle" cx={a.x} cy={a.y} r="3.5" />
                <circle className="wall-vertex-handle" cx={b.x} cy={b.y} r="3.5" />
              </g>
            );
          })}
          {wallStart && wallHover && !samePoint(wallStart, wallHover) ? (() => {
            const a = screenPoint(wallStart);
            const b = screenPoint(wallHover);
            return <line className="wall-preview-segment" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })() : null}
          {wallStart ? (() => {
            const point = screenPoint(wallStart);
            return <circle className="wall-start-handle" cx={point.x} cy={point.y} r="5" />;
          })() : null}
        </svg>
      ) : null}

      {placementActor && placementScreen ? (
        <div
          className="token-placement-preview"
          style={{
            left: `${placementScreen.x - placementSize / 2}px`,
            top: `${placementScreen.y - placementSize / 2}px`,
            width: `${Math.max(24, placementSize)}px`,
            height: `${Math.max(24, placementSize)}px`
          }}
          aria-hidden="true"
        >
          <span>{String(placementActor.name || '?').slice(0, 1).toUpperCase()}</span>
        </div>
      ) : null}

      <div className="map-atmosphere" aria-hidden="true" />
      <div className="map-grid-overlay" style={gridStyle} aria-hidden="true" />
      <div className="map-room-label">
        <span className="eyebrow">Cena ativa</span>
        <strong>{scene.name}</strong>
        <small>{canMoveAny ? 'Mestre · controle de todos os tokens' : controlledActorName ? `Jogador · você controla ${controlledActorName}` : `Jogador · controle de ${movableActorId || 'nenhum token'}`}</small>
      </div>

      <div className="map-hud map-hud-bottom">
        <span>Selecionado</span>
        <strong>{placementActor ? `Posicionando ${placementActor.name}` : regionEditorOpen ? `${(scene.regions ?? []).length} regiões` : wallEditorOpen ? `${wallDraft.length} segmentos` : fogPreview ? `Visão: ${resolvedVisionActorId || 'selecione um ator'}` : selected}</strong>
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
