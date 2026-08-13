'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  cellKeyToRect,
  computeVisibilityPolygon,
  mergeExploredCells,
  normalizeSceneFog,
  visibleGridCells
} from '../../../packages/scene-vision/src/index.js';
import { DynamicLightingOverlay } from './dynamic-lighting-overlay.jsx';

function exploredForActor(fog = {}, actorId = null) {
  if (!actorId) return [];
  if (Array.isArray(fog.exploredCells)) return fog.exploredCells;
  if (fog.exploredByActor && Array.isArray(fog.exploredByActor[actorId])) {
    return fog.exploredByActor[actorId];
  }
  return [];
}

function exploredPath(cells, grid) {
  return cells.map((key) => {
    const rect = cellKeyToRect(key, grid);
    if (!rect) return '';
    const x2 = rect.x + rect.width;
    const y2 = rect.y + rect.height;
    return `M${rect.x} ${rect.y}H${x2}V${y2}H${rect.x}Z`;
  }).join('');
}

export function FogOfWarOverlay({
  scene,
  tokens = [],
  actorId = null,
  viewport,
  active = false,
  transientToken = null
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '') || 'fog';
  const fog = useMemo(() => normalizeSceneFog(scene?.fog ?? {}), [
    scene?.fog?.enabled,
    scene?.fog?.visionRangeCells,
    scene?.fog?.exploredOpacity,
    scene?.fog?.unexploredOpacity
  ]);
  const persisted = useMemo(
    () => exploredForActor(scene?.fog, actorId),
    [scene?.fog, actorId]
  );
  const [exploredCells, setExploredCells] = useState(persisted);

  useEffect(() => {
    setExploredCells(persisted);
  }, [scene?.id, actorId, persisted]);

  const actorToken = useMemo(() => {
    if (transientToken?.id === actorId) return transientToken;
    return (Array.isArray(tokens) ? tokens : []).find((token) => token?.id === actorId) ?? null;
  }, [actorId, tokens, transientToken]);

  useEffect(() => {
    if (!active || !fog.enabled || !actorToken || !scene?.grid) return;
    const discovered = visibleGridCells({
      origin: actorToken,
      walls: scene.walls ?? [],
      grid: scene.grid,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      visionRangeCells: fog.visionRangeCells
    });
    setExploredCells((current) => [...mergeExploredCells(current, discovered)]);
  }, [
    active,
    actorToken?.x,
    actorToken?.y,
    actorToken?.id,
    fog.enabled,
    fog.visionRangeCells,
    scene?.id,
    scene?.width,
    scene?.height,
    scene?.grid?.size,
    scene?.grid?.offsetX,
    scene?.grid?.offsetY,
    scene?.walls
  ]);

  const visibility = useMemo(() => {
    if (!active || !fog.enabled || !actorToken) return [];
    return computeVisibilityPolygon({
      origin: actorToken,
      walls: scene.walls ?? [],
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      maxDistance: fog.visionRangeCells * (Number(scene.grid?.size) || 70)
    });
  }, [
    active,
    fog.enabled,
    fog.visionRangeCells,
    actorToken?.x,
    actorToken?.y,
    actorToken?.id,
    scene?.width,
    scene?.height,
    scene?.grid?.size,
    scene?.walls
  ]);

  if (!scene || !viewport) return null;

  const lightingTokens = transientToken?.id
    ? (Array.isArray(tokens) ? tokens : []).map((token) => token?.id === transientToken.id ? transientToken : token)
    : tokens;
  const lighting = (
    <DynamicLightingOverlay
      scene={scene}
      tokens={lightingTokens}
      viewport={viewport}
      active
    />
  );

  if (!active || !fog.enabled) return lighting;

  const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;
  const currentPoints = visibility.map((point) => `${point.x},${point.y}`).join(' ');
  const explored = exploredPath(exploredCells, scene.grid ?? {});
  const noToken = !actorToken || visibility.length < 3;
  const unexploredMask = `fog-unexplored-${id}`;
  const exploredMask = `fog-explored-${id}`;

  return (
    <>
      {lighting}
      <svg
        className="fog-of-war-overlay"
        width={scene.width}
        height={scene.height}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        style={{ transform }}
        aria-hidden="true"
      >
        <defs>
          <mask id={unexploredMask} maskUnits="userSpaceOnUse" x="0" y="0" width={scene.width} height={scene.height}>
            <rect width={scene.width} height={scene.height} fill="white" />
            {!noToken && explored ? <path d={explored} fill="black" /> : null}
            {!noToken && currentPoints ? <polygon points={currentPoints} fill="black" /> : null}
          </mask>
          <mask id={exploredMask} maskUnits="userSpaceOnUse" x="0" y="0" width={scene.width} height={scene.height}>
            <rect width={scene.width} height={scene.height} fill="black" />
            {!noToken && explored ? <path d={explored} fill="white" /> : null}
            {!noToken && currentPoints ? <polygon points={currentPoints} fill="black" /> : null}
          </mask>
        </defs>
        <rect
          className="fog-unexplored"
          width={scene.width}
          height={scene.height}
          opacity={fog.unexploredOpacity}
          mask={`url(#${unexploredMask})`}
        />
        {!noToken ? (
          <rect
            className="fog-explored"
            width={scene.width}
            height={scene.height}
            opacity={fog.exploredOpacity}
            mask={`url(#${exploredMask})`}
          />
        ) : null}
      </svg>
    </>
  );
}
