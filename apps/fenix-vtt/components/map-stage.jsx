'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { WebGlMapRenderer, detectBrowserRendererBackend } from '../../../packages/webgl-map-renderer/src/index.js';
import {
  SceneDoorState,
  SceneWallKind,
  cycleDoorState,
  pointToWallDistance,
  snapScenePoint
} from '../../../packages/scene-geometry/src/index.js';
import {
  SceneRegionKind,
  normalizeSceneRegions
} from '../../../packages/scene-elevation/src/index.js';
import { normalizeSceneFog } from '../../../packages/scene-vision/src/index.js';
import { FogOfWarOverlay } from './fog-of-war-overlay.jsx';
import { useFenixSession } from './session-provider.jsx';
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
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { resolveClientTokenMovement } from '../lib/token-input-movement.js';

const SceneLayer = Object.freeze({
  TOKENS: 'tokens',
  WALLS: 'walls',
  REGIONS: 'regions',
  FOG: 'fog',
  GRID: 'grid'
});

const REGION_LABELS = Object.freeze({
  [SceneRegionKind.FLOOR]: 'Piso',
  [SceneRegionKind.STAIRS]: 'Escada',
  [SceneRegionKind.RAMP]: 'Rampa'
});

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

function cloneWalls(walls) {
  return Array.isArray(walls) ? walls.map((wall) => ({
    ...wall,
    a: { ...wall.a },
    b: { ...wall.b }
  })) : [];
}

function cloneRegions(regions, scene) {
  try {
    return normalizeSceneRegions(regions ?? [], {
      sceneWidth: scene?.width,
      sceneHeight: scene?.height
    }).map((region) => ({
      ...region,
      points: region.points.map((point) => ({ ...point })),
      axis: region.axis ? {
        start: { ...region.axis.start },
        end: { ...region.axis.end }
      } : null
    }));
  } catch {
    return [];
  }
}

function randomWallId() {
  return globalThis.crypto?.randomUUID?.() ?? `wall-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function randomRegionId() {
  return globalThis.crypto?.randomUUID?.() ?? `region-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function rectanglePoints(a, b) {
  const left = Math.min(Number(a.x), Number(b.x));
  const right = Math.max(Number(a.x), Number(b.x));
  const top = Math.min(Number(a.y), Number(b.y));
  const bottom = Math.max(Number(a.y), Number(b.y));
  return [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];
}

function regionBounds(region) {
  const xs = region?.points?.map((point) => Number(point.x)) ?? [0];
  const ys = region?.points?.map((point) => Number(point.y)) ?? [0];
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys)
  };
}

function regionCenter(region) {
  const b = regionBounds(region);
  return { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
}

function pointInPolygon(point, points = []) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = Number(points[i]?.x); const yi = Number(points[i]?.y);
    const xj = Number(points[j]?.x); const yj = Number(points[j]?.y);
    const intersects = ((yi > point.y) !== (yj > point.y))
      && (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function regionAtPoint(regions, point) {
  return [...regions]
    .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0))
    .find((region) => pointInPolygon(point, region.points)) ?? null;
}

function regionForRectangle({ kind, start, end, baseElevation, levelHeight, id = randomRegionId(), name = null }) {
  const points = rectanglePoints(start, end);
  const b = regionBounds({ points });
  const midY = (b.y1 + b.y2) / 2;
  const targetElevation = kind === SceneRegionKind.FLOOR
    ? baseElevation
    : baseElevation + levelHeight;
  return {
    id,
    name: name ?? `${REGION_LABELS[kind]} novo`,
    kind,
    enabled: true,
    priority: 0,
    points,
    baseElevation,
    targetElevation,
    axis: kind === SceneRegionKind.FLOOR ? null : {
      start: { x: b.x1, y: midY },
      end: { x: b.x2, y: midY }
    }
  };
}

function translatedRegion(region, dx, dy, scene) {
  const b = regionBounds(region);
  const safeDx = Math.max(-b.x1, Math.min(Number(scene.width) - b.x2, dx));
  const safeDy = Math.max(-b.y1, Math.min(Number(scene.height) - b.y2, dy));
  return {
    ...region,
    points: region.points.map((point) => ({ x: point.x + safeDx, y: point.y + safeDy })),
    axis: region.axis ? {
      start: { x: region.axis.start.x + safeDx, y: region.axis.start.y + safeDy },
      end: { x: region.axis.end.x + safeDx, y: region.axis.end.y + safeDy }
    } : null
  };
}

export function MapStage({
  scene = demoScene,
  authoritativeTokens = [],
  onTokenMoved = null,
  onSelectedActor = null,
  onGridCalibrated = null,
  onWallsChanged = null,
  onFogChanged = null,
  busy = false,
  canMoveAny = false,
  movableActorId = null,
  visionActorId = null
}) {
  const { campaign } = useFenixSession();
  const regionClient = useMemo(() => createFenixApiClient(), []);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const panRef = useRef(null);
  const regionGestureRef = useRef(null);
  const tokensRef = useRef(new Map(demoTokens.map((token) => [token.id, { ...token }])));
  const [backend, setBackend] = useState('detecting');
  const [selected, setSelected] = useState('Ayla');
  const [error, setError] = useState(null);
  const [viewport, setViewport] = useState(scene.id === demoScene.id ? demoViewport : { x: 0, y: 0, zoom: 1 });
  const [activeLayer, setActiveLayer] = useState(SceneLayer.TOKENS);
  const [tool, setTool] = useState('select');
  const [gridEditorOpen, setGridEditorOpen] = useState(false);
  const [gridDraft, setGridDraft] = useState(() => normalizedGrid(scene.grid));
  const [gridSaving, setGridSaving] = useState(false);
  const [wallEditorOpen, setWallEditorOpen] = useState(false);
  const [wallMode, setWallMode] = useState('wall');
  const [doorState, setDoorState] = useState(SceneDoorState.CLOSED);
  const [snapWalls, setSnapWalls] = useState(true);
  const [wallDraft, setWallDraft] = useState(() => cloneWalls(scene.walls));
  const [wallStart, setWallStart] = useState(null);
  const [wallHistory, setWallHistory] = useState([]);
  const [wallsSaving, setWallsSaving] = useState(false);
  const [fogEditorOpen, setFogEditorOpen] = useState(false);
  const [fogDraft, setFogDraft] = useState(() => normalizeSceneFog(scene.fog ?? {}));
  const [fogSaving, setFogSaving] = useState(false);
  const [fogPreview, setFogPreview] = useState(false);
  const [resetExploration, setResetExploration] = useState(false);
  const [dragVisionToken, setDragVisionToken] = useState(null);
  const [regionMode, setRegionMode] = useState('select');
  const [snapRegions, setSnapRegions] = useState(true);
  const [regionVisible, setRegionVisible] = useState(true);
  const [regionDraft, setRegionDraft] = useState(() => cloneRegions(scene.regions, scene));
  const [regionPreview, setRegionPreview] = useState(null);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [regionsDirty, setRegionsDirty] = useState(false);
  const [regionsSaving, setRegionsSaving] = useState(false);
  const demoZonesEnabled = scene.id === demoScene.id;
  const regionSignature = JSON.stringify(scene.regions ?? []);

  const interactionScene = useMemo(() => ({ ...scene, regions: regionDraft }), [scene, regionDraft]);

  useEffect(() => {
    setGridDraft(normalizedGrid(scene.grid));
    setGridEditorOpen(false);
    setWallDraft(cloneWalls(scene.walls));
    setWallHistory([]);
    setWallStart(null);
    setWallEditorOpen(false);
    setFogDraft(normalizeSceneFog(scene.fog ?? {}));
    setFogEditorOpen(false);
    setFogPreview(false);
    setResetExploration(false);
    setDragVisionToken(null);
    setActiveLayer(SceneLayer.TOKENS);
    setTool('select');
    setRegionMode('select');
    setRegionDraft(cloneRegions(scene.regions, scene));
    setRegionPreview(null);
    setSelectedRegionId(null);
    setRegionsDirty(false);
    setRegionVisible(true);
    regionGestureRef.current = null;
  }, [scene.id, scene.grid?.size, scene.grid?.offsetX, scene.grid?.offsetY, scene.grid?.visible]);

  useEffect(() => {
    if (!wallEditorOpen) setWallDraft(cloneWalls(scene.walls));
  }, [scene.walls, wallEditorOpen]);

  useEffect(() => {
    if (!fogEditorOpen) setFogDraft(normalizeSceneFog(scene.fog ?? {}));
  }, [scene.fog, fogEditorOpen]);

  useEffect(() => {
    if (!regionsDirty) setRegionDraft(cloneRegions(scene.regions, scene));
  }, [regionSignature, scene.width, scene.height, regionsDirty]);

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

  function activateLayer(layer) {
    setActiveLayer(layer);
    setTool('select');
    setGridEditorOpen(layer === SceneLayer.GRID);
    setWallEditorOpen(layer === SceneLayer.WALLS);
    setFogEditorOpen(layer === SceneLayer.FOG);
    setFogPreview(false);
    setWallStart(null);
    setRegionPreview(null);
    regionGestureRef.current = null;
    if (layer === SceneLayer.REGIONS) setRegionVisible(true);
  }

  function boundedWallPoint(point) {
    const base = snapWalls ? snapScenePoint(point, gridDraft) : point;
    return {
      x: Math.max(0, Math.min(scene.width, Number(base.x) || 0)),
      y: Math.max(0, Math.min(scene.height, Number(base.y) || 0))
    };
  }

  function boundedRegionPoint(point) {
    const base = snapRegions ? snapScenePoint(point, gridDraft) : point;
    return {
      x: Math.max(0, Math.min(scene.width, Number(base.x) || 0)),
      y: Math.max(0, Math.min(scene.height, Number(base.y) || 0))
    };
  }

  function rememberAndSetWalls(nextWalls) {
    setWallHistory((history) => [...history.slice(-19), cloneWalls(wallDraft)]);
    setWallDraft(cloneWalls(nextWalls));
  }

  function nearestWall(point, { doorsOnly = false } = {}) {
    const candidates = doorsOnly ? wallDraft.filter((wall) => wall.kind === SceneWallKind.DOOR) : wallDraft;
    let nearest = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const wall of candidates) {
      const next = pointToWallDistance(point, wall);
      if (next < distance) {
        distance = next;
        nearest = wall;
      }
    }
    return distance <= 14 / Math.max(0.1, viewport.zoom) ? nearest : null;
  }

  function handleWallAuthoring(event) {
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.world) return false;
    const point = boundedWallPoint(hit.world);

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

    if (!wallStart) {
      setWallStart(point);
      return true;
    }

    if (Math.hypot(point.x - wallStart.x, point.y - wallStart.y) >= 2) {
      const kind = wallMode === 'door' ? SceneWallKind.DOOR : SceneWallKind.WALL;
      rememberAndSetWalls([...wallDraft, {
        id: randomWallId(),
        kind,
        a: wallStart,
        b: point,
        doorState: kind === SceneWallKind.DOOR ? doorState : null
      }]);
    }
    setWallStart(null);
    return true;
  }

  function authoringBaseElevation() {
    const token = (Array.isArray(authoritativeTokens) ? authoritativeTokens : [])
      .find((item) => item?.id === visionActorId);
    return Number.isFinite(Number(token?.elevation)) ? Number(token.elevation) : 0;
  }

  function makeRegion(kind, start, end, id = randomRegionId()) {
    return regionForRectangle({
      kind,
      start,
      end,
      id,
      baseElevation: authoringBaseElevation(),
      levelHeight: Number(scene.elevation?.levelHeight) || 3,
      name: `${REGION_LABELS[kind]} ${regionDraft.length + 1}`
    });
  }

  function handleRegionPointerDown(event) {
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.world) return false;
    const point = boundedRegionPoint(hit.world);

    if (regionMode === 'erase') {
      const target = regionAtPoint(regionDraft, point);
      if (target) {
        setRegionDraft((current) => current.filter((region) => region.id !== target.id));
        setSelectedRegionId((current) => current === target.id ? null : current);
        setRegionsDirty(true);
      }
      return true;
    }

    if ([SceneRegionKind.FLOOR, SceneRegionKind.STAIRS, SceneRegionKind.RAMP].includes(regionMode)) {
      regionGestureRef.current = { type: 'draw', kind: regionMode, start: point };
      setRegionPreview(makeRegion(regionMode, point, point));
      event.currentTarget.setPointerCapture?.(event.pointerId);
      return true;
    }

    const target = regionAtPoint(regionDraft, point);
    setSelectedRegionId(target?.id ?? null);
    if (target) {
      regionGestureRef.current = {
        type: 'move',
        regionId: target.id,
        start: point,
        original: cloneRegions([target], scene)[0]
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    return true;
  }

  function handleRegionPointerMove(event) {
    const gesture = regionGestureRef.current;
    if (!gesture) return false;
    const hit = rendererRef.current?.hitTest(event);
    if (!hit?.world) return true;
    const point = boundedRegionPoint(hit.world);

    if (gesture.type === 'draw') {
      setRegionPreview(makeRegion(gesture.kind, gesture.start, point));
      return true;
    }

    if (gesture.type === 'move' && gesture.original) {
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      const moved = translatedRegion(gesture.original, dx, dy, scene);
      setRegionDraft((current) => current.map((region) => region.id === moved.id ? moved : region));
      setRegionsDirty(true);
      return true;
    }

    return false;
  }

  function handleRegionPointerUp(event) {
    const gesture = regionGestureRef.current;
    regionGestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!gesture) return false;

    if (gesture.type === 'draw' && regionPreview) {
      const b = regionBounds(regionPreview);
      if (b.x2 - b.x1 >= 4 && b.y2 - b.y1 >= 4) {
        const finalized = { ...regionPreview, id: randomRegionId() };
        setRegionDraft((current) => [...current, finalized]);
        setSelectedRegionId(finalized.id);
        setRegionsDirty(true);
      }
      setRegionPreview(null);
    }
    return true;
  }

  function handlePointerDown(event) {
    if (busy) return;
    const wantsPan = (activeLayer === SceneLayer.TOKENS && tool === 'pan') || event.button === 1;
    if (wantsPan) {
      panRef.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    if (canMoveAny && activeLayer === SceneLayer.REGIONS && event.button === 0) {
      if (handleRegionPointerDown(event)) {
        event.preventDefault();
        return;
      }
    }

    if (canMoveAny && activeLayer === SceneLayer.WALLS && event.button === 0) {
      if (handleWallAuthoring(event)) {
        event.preventDefault();
        return;
      }
    }

    if (activeLayer !== SceneLayer.TOKENS) return;

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
    setDragVisionToken({ ...hit.token });
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

    if (activeLayer === SceneLayer.REGIONS && regionGestureRef.current) {
      handleRegionPointerMove(event);
      return;
    }

    const renderer = rendererRef.current;
    const drag = dragRef.current;
    if (!renderer || !drag || busy || activeLayer !== SceneLayer.TOKENS) return;
    const hit = renderer.hitTest(event);
    const current = tokensRef.current.get(drag.tokenId);
    if (!current || !hit?.world) return;

    const requested = { ...current, x: hit.world.x, y: hit.world.y };
    const resolved = resolveClientTokenMovement({
      previousToken: current,
      requestedToken: requested,
      scene: interactionScene,
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

    if (activeLayer === SceneLayer.REGIONS && regionGestureRef.current) {
      handleRegionPointerUp(event);
      return;
    }

    const drag = dragRef.current;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!drag || activeLayer !== SceneLayer.TOKENS) {
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
      activateLayer(SceneLayer.TOKENS);
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
    } finally {
      setWallsSaving(false);
    }
  }

  async function saveFog() {
    if (!onFogChanged || !canMoveAny || demoZonesEnabled || fogSaving) return;
    setFogSaving(true);
    try {
      const result = await onFogChanged(scene.id, {
        ...normalizeSceneFog(fogDraft),
        resetExploration
      });
      setFogDraft(normalizeSceneFog(result?.scene?.fog ?? fogDraft));
      setResetExploration(false);
    } finally {
      setFogSaving(false);
    }
  }

  async function saveRegions() {
    if (!canMoveAny || demoZonesEnabled || regionsSaving || !campaign?.id) return;
    setRegionsSaving(true);
    try {
      const normalized = normalizeSceneRegions(regionDraft, {
        sceneWidth: scene.width,
        sceneHeight: scene.height
      });
      const result = await regionClient.updateSceneRegions(campaign.id, scene.id, normalized);
      setRegionDraft(cloneRegions(result?.scene?.regions ?? normalized, scene));
      setRegionsDirty(false);
      setError(null);
    } catch (cause) {
      setError(cause?.message || 'Não foi possível salvar as regiões desta cena.');
    } finally {
      setRegionsSaving(false);
    }
  }

  function cancelWalls() {
    setWallDraft(cloneWalls(scene.walls));
    setWallHistory([]);
    setWallStart(null);
  }

  function undoWallChange() {
    setWallHistory((history) => {
      if (!history.length) return history;
      setWallDraft(cloneWalls(history[history.length - 1]));
      return history.slice(0, -1);
    });
    setWallStart(null);
  }

  function cancelRegions() {
    setRegionDraft(cloneRegions(scene.regions, scene));
    setRegionPreview(null);
    setSelectedRegionId(null);
    setRegionsDirty(false);
    regionGestureRef.current = null;
  }

  function patchSelectedRegion(patch) {
    if (!selectedRegionId) return;
    setRegionDraft((current) => current.map((region) => region.id === selectedRegionId ? { ...region, ...patch } : region));
    setRegionsDirty(true);
  }

  function changeSelectedRegionKind(nextKind) {
    if (!selectedRegionId) return;
    setRegionDraft((current) => current.map((region) => {
      if (region.id !== selectedRegionId) return region;
      const b = regionBounds(region);
      const midY = (b.y1 + b.y2) / 2;
      return {
        ...region,
        kind: nextKind,
        targetElevation: nextKind === SceneRegionKind.FLOOR ? region.baseElevation : region.targetElevation,
        axis: nextKind === SceneRegionKind.FLOOR ? null : (region.axis ?? {
          start: { x: b.x1, y: midY },
          end: { x: b.x2, y: midY }
        })
      };
    }));
    setRegionsDirty(true);
  }

  function reverseSelectedRegion() {
    if (!selectedRegionId) return;
    setRegionDraft((current) => current.map((region) => {
      if (region.id !== selectedRegionId || !region.axis) return region;
      return {
        ...region,
        baseElevation: region.targetElevation,
        targetElevation: region.baseElevation,
        axis: { start: { ...region.axis.end }, end: { ...region.axis.start } }
      };
    }));
    setRegionsDirty(true);
  }

  function deleteSelectedRegion() {
    if (!selectedRegionId) return;
    setRegionDraft((current) => current.filter((region) => region.id !== selectedRegionId));
    setSelectedRegionId(null);
    setRegionsDirty(true);
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
  const gridStyle = {
    display: gridScreen.visible ? undefined : 'none',
    backgroundSize: `${gridScreen.size}px ${gridScreen.size}px`,
    backgroundPosition: `${gridScreen.x}px ${gridScreen.y}px`
  };
  const fogEnabled = scene.fog?.enabled === true;
  const fogActive = fogEnabled && (!canMoveAny || fogPreview);
  const resolvedVisionActorId = canMoveAny ? visionActorId : movableActorId;
  const selectedRegion = regionDraft.find((region) => region.id === selectedRegionId) ?? null;
  const regionTransform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;
  const showRegionOverlay = canMoveAny && activeLayer === SceneLayer.REGIONS && regionVisible;

  return (
    <section className={`map-stage map-tool-${tool} layer-${activeLayer} ${canMoveAny ? 'has-gm-controls' : ''}`} aria-label="Mapa tático">
      {scene.background ? (
        <div className="map-background-layer" style={backgroundStyle} aria-hidden="true" />
      ) : null}

      <div className="map-camera-toolbar" role="toolbar" aria-label="Câmera do mapa">
        <button type="button" onClick={() => applyZoom(1 / 1.2)} title="Diminuir zoom">−</button>
        <span className="map-zoom-readout">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" onClick={() => applyZoom(1.2)} title="Aumentar zoom">+</button>
        <button type="button" onClick={fitScene} title="Ajustar mapa à tela">Ajustar</button>
      </div>

      {canMoveAny && !demoZonesEnabled ? (
        <>
          <nav className="scene-layer-controls" aria-label="Camadas da cena">
            <button type="button" className={activeLayer === SceneLayer.TOKENS ? 'active' : ''} onClick={() => activateLayer(SceneLayer.TOKENS)} title="Controles de Tokens"><span>◉</span><small>Tokens</small></button>
            <button type="button" className={activeLayer === SceneLayer.WALLS ? 'active' : ''} onClick={() => activateLayer(SceneLayer.WALLS)} title="Camada de Paredes"><span>╱</span><small>Paredes</small></button>
            <button type="button" className={activeLayer === SceneLayer.REGIONS ? 'active' : ''} onClick={() => activateLayer(SceneLayer.REGIONS)} title="Camada de Regiões"><span>▦</span><small>Regiões</small></button>
            <button type="button" className={activeLayer === SceneLayer.FOG ? 'active' : ''} onClick={() => activateLayer(SceneLayer.FOG)} title="Fog of War"><span>◐</span><small>Fog</small></button>
            <button type="button" className={activeLayer === SceneLayer.GRID ? 'active' : ''} onClick={() => activateLayer(SceneLayer.GRID)} title="Configuração da Grade"><span>#</span><small>Grade</small></button>
          </nav>

          <div className="scene-tool-palette" role="toolbar" aria-label="Ferramentas da camada ativa">
            <div className="scene-tool-palette-title">
              <strong>{activeLayer === SceneLayer.TOKENS ? 'Tokens' : activeLayer === SceneLayer.WALLS ? 'Paredes' : activeLayer === SceneLayer.REGIONS ? 'Regiões' : activeLayer === SceneLayer.FOG ? 'Fog' : 'Grade'}</strong>
              <small>{activeLayer === SceneLayer.REGIONS ? `${regionDraft.length} regiões` : activeLayer === SceneLayer.WALLS ? `${wallDraft.length} segmentos` : ''}</small>
            </div>

            {activeLayer === SceneLayer.TOKENS ? <>
              <button type="button" className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')} title="Selecionar e mover tokens"><span>↖</span>Selecionar</button>
              <button type="button" className={tool === 'pan' ? 'active' : ''} onClick={() => setTool('pan')} title="Mover câmera"><span>✋</span>Pan</button>
            </> : null}

            {activeLayer === SceneLayer.WALLS ? <>
              <button type="button" className={wallMode === 'wall' ? 'active' : ''} onClick={() => { setWallMode('wall'); setWallStart(null); }}><span>╱</span>Parede</button>
              <button type="button" className={wallMode === 'door' ? 'active' : ''} onClick={() => { setWallMode('door'); setWallStart(null); }}><span>▯</span>Porta</button>
              <button type="button" className={wallMode === 'door-state' ? 'active' : ''} onClick={() => { setWallMode('door-state'); setWallStart(null); }}><span>↻</span>Estado</button>
              <button type="button" className={wallMode === 'erase' ? 'active danger' : 'danger'} onClick={() => { setWallMode('erase'); setWallStart(null); }}><span>⌫</span>Apagar</button>
              <button type="button" className={snapWalls ? 'toggle-on' : ''} onClick={() => setSnapWalls((value) => !value)}><span>⌗</span>Snap</button>
            </> : null}

            {activeLayer === SceneLayer.REGIONS ? <>
              <button type="button" className={regionMode === 'select' ? 'active' : ''} onClick={() => setRegionMode('select')}><span>↖</span>Selecionar</button>
              <button type="button" className={regionMode === SceneRegionKind.FLOOR ? 'active' : ''} onClick={() => setRegionMode(SceneRegionKind.FLOOR)}><span>▰</span>Piso</button>
              <button type="button" className={regionMode === SceneRegionKind.STAIRS ? 'active' : ''} onClick={() => setRegionMode(SceneRegionKind.STAIRS)}><span>▟</span>Escada</button>
              <button type="button" className={regionMode === SceneRegionKind.RAMP ? 'active' : ''} onClick={() => setRegionMode(SceneRegionKind.RAMP)}><span>◢</span>Rampa</button>
              <button type="button" className={regionMode === 'erase' ? 'active danger' : 'danger'} onClick={() => setRegionMode('erase')}><span>⌫</span>Apagar</button>
              <button type="button" className={regionVisible ? 'toggle-on' : ''} onClick={() => setRegionVisible((value) => !value)}><span>◉</span>Mostrar</button>
              <button type="button" className={snapRegions ? 'toggle-on' : ''} onClick={() => setSnapRegions((value) => !value)}><span>⌗</span>Snap</button>
            </> : null}

            {activeLayer === SceneLayer.FOG ? <>
              <button type="button" className={fogEditorOpen ? 'active' : ''} onClick={() => setFogEditorOpen(true)}><span>⚙</span>Configurar</button>
              <button type="button" className={fogPreview ? 'active' : ''} disabled={!fogEnabled || !resolvedVisionActorId} onClick={() => setFogPreview((value) => !value)}><span>◉</span>Visão</button>
            </> : null}

            {activeLayer === SceneLayer.GRID ? <>
              <button type="button" className="active" onClick={() => setGridEditorOpen(true)}><span>#</span>Calibrar</button>
              <button type="button" className={gridDraft.visible !== false ? 'toggle-on' : ''} onClick={() => setGridDraft((grid) => ({ ...grid, visible: grid.visible === false }))}><span>◫</span>Mostrar</button>
            </> : null}
          </div>
        </>
      ) : null}

      {gridEditorOpen && activeLayer === SceneLayer.GRID ? (
        <div className="grid-calibration-panel scene-layer-inspector">
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

      {wallEditorOpen && activeLayer === SceneLayer.WALLS ? (
        <div className="wall-authoring-panel scene-layer-inspector">
          <div className="wall-authoring-heading">
            <div><strong>Paredes e portas</strong><small>{wallMode === 'wall' || wallMode === 'door' ? 'Clique no início e no fim do segmento' : 'Clique diretamente no segmento'}</small></div>
            <span>{wallStart ? 'Ponto inicial' : 'Pronto'}</span>
          </div>
          <div className="wall-authoring-options">
            <label><input type="checkbox" checked={snapWalls} onChange={(event) => setSnapWalls(event.target.checked)} /> Snap na grade</label>
            <label>Nova porta
              <select value={doorState} onChange={(event) => setDoorState(event.target.value)} disabled={wallMode !== 'door'}>
                <option value={SceneDoorState.CLOSED}>Fechada</option>
                <option value={SceneDoorState.OPEN}>Aberta</option>
                <option value={SceneDoorState.LOCKED}>Trancada</option>
              </select>
            </label>
          </div>
          <div className="wall-authoring-actions">
            <button type="button" disabled={!wallHistory.length} onClick={undoWallChange}>Desfazer</button>
            <button type="button" onClick={cancelWalls}>Reverter</button>
            <button type="button" className="primary-button" disabled={wallsSaving || busy} onClick={saveWalls}>{wallsSaving ? 'Salvando…' : 'Salvar'}</button>
          </div>
        </div>
      ) : null}

      {fogEditorOpen && activeLayer === SceneLayer.FOG ? (
        <div className="fog-config-panel scene-layer-inspector">
          <div className="fog-config-heading"><strong>Fog of War</strong><small>Visão por token</small></div>
          <label className="fog-config-toggle"><input type="checkbox" checked={fogDraft.enabled} onChange={(event) => setFogDraft((fog) => ({ ...fog, enabled: event.target.checked }))} /> Ativar Fog nesta cena</label>
          <label>Alcance de visão (células)<input type="number" min="1" max="60" step="1" value={fogDraft.visionRangeCells} onChange={(event) => setFogDraft((fog) => ({ ...fog, visionRangeCells: event.target.value }))} /></label>
          <div className="fog-config-row">
            <label>Opacidade explorada<input type="number" min="0" max="0.95" step="0.05" value={fogDraft.exploredOpacity} onChange={(event) => setFogDraft((fog) => ({ ...fog, exploredOpacity: event.target.value }))} /></label>
            <label>Opacidade não vista<input type="number" min="0" max="1" step="0.05" value={fogDraft.unexploredOpacity} onChange={(event) => setFogDraft((fog) => ({ ...fog, unexploredOpacity: event.target.value }))} /></label>
          </div>
          <label className="fog-reset-toggle"><input type="checkbox" checked={resetExploration} onChange={(event) => setResetExploration(event.target.checked)} /> Limpar áreas exploradas ao salvar</label>
          <small className="fog-config-help">Paredes e portas fechadas/trancadas bloqueiam a linha de visão. Portas abertas deixam a visão passar.</small>
          <div className="fog-config-actions">
            <button type="button" onClick={() => { setFogDraft(normalizeSceneFog(scene.fog ?? {})); setResetExploration(false); }}>Reverter</button>
            <button type="button" className="primary-button" disabled={fogSaving || busy} onClick={saveFog}>{fogSaving ? 'Salvando…' : 'Salvar Fog'}</button>
          </div>
        </div>
      ) : null}

      {activeLayer === SceneLayer.REGIONS && canMoveAny ? (
        <aside className="scene-region-legend" aria-label="Legenda e propriedades das regiões">
          <div className="scene-region-legend-heading">
            <div><strong>Regiões</strong><small>Selecione no mapa ou na lista</small></div>
            <span>{regionDraft.length}</span>
          </div>
          <div className="scene-region-list">
            {regionDraft.length ? regionDraft.map((region) => (
              <button type="button" key={region.id} className={`${selectedRegionId === region.id ? 'active' : ''} region-${region.kind}`} onClick={() => { setSelectedRegionId(region.id); setRegionMode('select'); }}>
                <span className="region-swatch" />
                <span><strong>{region.name}</strong><small>{REGION_LABELS[region.kind]} · {region.kind === SceneRegionKind.FLOOR ? `Z ${Number(region.baseElevation).toFixed(1)}` : `Z ${Number(region.baseElevation).toFixed(1)} → ${Number(region.targetElevation).toFixed(1)}`}</small></span>
              </button>
            )) : <div className="scene-region-empty"><strong>Nenhuma região</strong><small>Escolha Piso, Escada ou Rampa e arraste no mapa.</small></div>}
          </div>

          {selectedRegion ? (
            <div className="scene-region-inspector">
              <div className="scene-region-inspector-heading"><strong>Propriedades</strong><button type="button" className="danger" onClick={deleteSelectedRegion}>Excluir</button></div>
              <label>Nome<input value={selectedRegion.name} onChange={(event) => patchSelectedRegion({ name: event.target.value })} /></label>
              <label>Tipo<select value={selectedRegion.kind} onChange={(event) => changeSelectedRegionKind(event.target.value)}><option value={SceneRegionKind.FLOOR}>Piso</option><option value={SceneRegionKind.STAIRS}>Escada</option><option value={SceneRegionKind.RAMP}>Rampa</option></select></label>
              <div className="scene-region-inspector-grid">
                <label>Z inicial<input type="number" step="0.25" value={selectedRegion.baseElevation} onChange={(event) => patchSelectedRegion({ baseElevation: event.target.value, ...(selectedRegion.kind === SceneRegionKind.FLOOR ? { targetElevation: event.target.value } : {}) })} /></label>
                {selectedRegion.kind !== SceneRegionKind.FLOOR ? <label>Z final<input type="number" step="0.25" value={selectedRegion.targetElevation} onChange={(event) => patchSelectedRegion({ targetElevation: event.target.value })} /></label> : null}
                <label>Prioridade<input type="number" min="-100" max="100" value={selectedRegion.priority} onChange={(event) => patchSelectedRegion({ priority: event.target.value })} /></label>
              </div>
              <label className="scene-region-enabled"><input type="checkbox" checked={selectedRegion.enabled !== false} onChange={(event) => patchSelectedRegion({ enabled: event.target.checked })} /> Região ativa</label>
              {selectedRegion.kind !== SceneRegionKind.FLOOR ? <button type="button" onClick={reverseSelectedRegion}>↔ Inverter subida</button> : null}
              <small>Arraste a região selecionada no mapa para reposicionar. Coordenadas ficam implícitas no canvas.</small>
            </div>
          ) : <div className="scene-region-selection-help"><strong>Authoring direto</strong><small>Desenhe por arraste. Depois selecione a região para mover ou ajustar Z, tipo e prioridade.</small></div>}

          <div className="scene-region-actions">
            <button type="button" disabled={!regionsDirty} onClick={cancelRegions}>Reverter</button>
            <button type="button" className="primary-button" disabled={!regionsDirty || regionsSaving || busy} onClick={saveRegions}>{regionsSaving ? 'Salvando…' : 'Salvar regiões'}</button>
          </div>
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
        onContextMenu={(event) => event.preventDefault()}
      />

      <FogOfWarOverlay
        scene={scene}
        tokens={authoritativeTokens}
        actorId={resolvedVisionActorId}
        viewport={viewport}
        active={fogActive}
        transientToken={dragVisionToken}
      />

      {showRegionOverlay ? (
        <svg className="scene-region-authoring-overlay" width={scene.width} height={scene.height} viewBox={`0 0 ${scene.width} ${scene.height}`} style={{ transform: regionTransform }} aria-label="Regiões da cena">
          <defs>
            <marker id="scene-region-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker>
          </defs>
          {regionDraft.map((region) => {
            const c = regionCenter(region);
            const selectedClass = selectedRegionId === region.id ? ' selected' : '';
            return <g key={region.id} className={`scene-region-group region-${region.kind}${selectedClass}`}>
              <polygon className="scene-region-shape" points={region.points.map((point) => `${point.x},${point.y}`).join(' ')} />
              {region.axis ? <line className="scene-region-axis" x1={region.axis.start.x} y1={region.axis.start.y} x2={region.axis.end.x} y2={region.axis.end.y} markerEnd="url(#scene-region-arrow)" /> : null}
              <text className="scene-region-label" x={c.x} y={c.y - 6} textAnchor="middle">{region.name}</text>
              <text className="scene-region-label secondary" x={c.x} y={c.y + 10} textAnchor="middle">{region.kind === SceneRegionKind.FLOOR ? `Z ${Number(region.baseElevation).toFixed(1)}` : `Z ${Number(region.baseElevation).toFixed(1)} → ${Number(region.targetElevation).toFixed(1)}`}</text>
              {selectedRegionId === region.id ? region.points.map((point, index) => <circle key={`${region.id}-handle-${index}`} className="scene-region-handle" cx={point.x} cy={point.y} r="5" />) : null}
            </g>;
          })}
          {regionPreview ? <polygon className={`scene-region-shape preview region-${regionPreview.kind}`} points={regionPreview.points.map((point) => `${point.x},${point.y}`).join(' ')} /> : null}
          {(Array.isArray(authoritativeTokens) ? authoritativeTokens : []).map((token) => Number.isFinite(Number(token?.elevation)) ? (
            <g className="scene-region-token-z" key={`z-${token.id}`} transform={`translate(${Number(token.x) + 18} ${Number(token.y) - 24})`}><rect x="0" y="0" width="50" height="18" rx="6" /><text x="25" y="12" textAnchor="middle">Z {Number(token.elevation).toFixed(1)}</text></g>
          ) : null)}
        </svg>
      ) : null}

      {canMoveAny && activeLayer === SceneLayer.WALLS ? (
        <svg className="wall-authoring-overlay" aria-label="Geometria de paredes da cena">
          {wallDraft.map((wall) => {
            const a = screenPoint(wall.a);
            const b = screenPoint(wall.b);
            const stateClass = wall.kind === SceneWallKind.DOOR ? ` door-${wall.doorState}` : '';
            return <line key={wall.id} className={`wall-segment wall-${wall.kind}${stateClass}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
          })}
          {wallStart ? (() => {
            const point = screenPoint(wallStart);
            return <circle className="wall-start-handle" cx={point.x} cy={point.y} r="5" />;
          })() : null}
        </svg>
      ) : null}

      <div className="map-atmosphere" aria-hidden="true" />
      <div className="map-grid-overlay" style={gridStyle} aria-hidden="true" />
      <div className="map-room-label">
        <span className="eyebrow">Cena ativa</span>
        <strong>{scene.name}</strong>
        <small>{canMoveAny ? 'Mestre · camadas de authoring' : `Jogador · controle de ${movableActorId || 'nenhum token'}`}</small>
      </div>

      <div className="map-hud map-hud-bottom">
        <span>{activeLayer === SceneLayer.REGIONS ? 'Região' : activeLayer === SceneLayer.WALLS ? 'Paredes' : activeLayer === SceneLayer.FOG ? 'Fog' : activeLayer === SceneLayer.GRID ? 'Grade' : 'Selecionado'}</span>
        <strong>{activeLayer === SceneLayer.REGIONS ? (selectedRegion?.name ?? `${regionDraft.length} regiões`) : activeLayer === SceneLayer.WALLS ? `${wallDraft.length} segmentos` : fogPreview ? `Visão: ${resolvedVisionActorId || 'selecione um ator'}` : selected}</strong>
      </div>

      {demoZonesEnabled ? (
        <div className="room-zone-hint" aria-hidden="true"><span>03</span><strong>Câmara Norte</strong></div>
      ) : null}

      {error ? <div className="map-error" role="status">{error}</div> : null}
    </section>
  );
}