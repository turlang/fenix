'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  cellKeyToRect,
  computeVisibilityPolygon,
  mergeExploredCells,
  normalizeSceneFog,
  resolveTokenVisionProfile,
  tokenVisionTint,
  visibleGridCells
} from '../../../packages/scene-vision/src/index.js';
import { eyeElevation, normalizeSceneElevation } from '../../../packages/scene-elevation/src/index.js';
import { AdvancedVisionEditor } from './advanced-vision-editor.jsx';
import { DynamicLightingOverlay } from './dynamic-lighting-overlay.jsx';

function exploredForActor(fog = {}, actorId = null) {
  if (!actorId) return [];
  if (Array.isArray(fog.exploredCells)) return fog.exploredCells;
  if (fog.exploredByActor && Array.isArray(fog.exploredByActor[actorId])) {
    return fog.exploredByActor[actorId];
  }
  return [];
}

function sameCells(first, second) {
  if (first === second) return true;
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) return false;
  return first.every((value, index) => value === second[index]);
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
  const elevationSignature = JSON.stringify(scene?.elevation ?? {});
  const elevationConfig = useMemo(() => normalizeSceneElevation(scene?.elevation ?? {}), [elevationSignature]);
  const visionProfileSignature = JSON.stringify(scene?.visionProfiles?.[actorId] ?? {});
  const visionProfile = useMemo(() => resolveTokenVisionProfile({
    scene,
    actorId,
    fallbackRangeCells: fog.visionRangeCells
  }), [scene?.id, actorId, fog.visionRangeCells, visionProfileSignature]);
  const persisted = useMemo(
    () => exploredForActor(scene?.fog, actorId),
    [scene?.fog, actorId]
  );
  const [exploredCells, setExploredCells] = useState(persisted);

  useEffect(() => {
    setExploredCells((current) => sameCells(current, persisted) ? current : [...persisted]);
  }, [scene?.id, actorId, persisted]);

  const actorToken = useMemo(() => {
    if (transientToken?.id === actorId) return transientToken;
    return (Array.isArray(tokens) ? tokens : []).find((token) => token?.id === actorId) ?? null;
  }, [actorId, tokens, transientToken]);
  const observerElevation = eyeElevation(visionProfile, actorToken?.elevation ?? visionProfile.elevation);

  useEffect(() => {
    if (!active || !fog.enabled || !actorToken || !scene?.grid) return;
    const discovered = visibleGridCells({
      origin: actorToken,
      walls: scene.walls ?? [],
      grid: scene.grid,
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      visionRangeCells: visionProfile.rangeCells,
      verticalEnabled: elevationConfig.enabled,
      originElevation: observerElevation,
      targetElevation: observerElevation
    });
    setExploredCells((current) => {
      const merged = mergeExploredCells(current, discovered);
      return sameCells(current, merged) ? current : [...merged];
    });
  }, [
    active,
    actorToken?.x,
    actorToken?.y,
    actorToken?.elevation,
    actorToken?.id,
    fog.enabled,
    visionProfile.rangeCells,
    observerElevation,
    elevationConfig.enabled,
    scene?.id,
    scene?.width,
    scene?.height,
    scene?.grid?.size,
    scene?.grid?.offsetX,
    scene?.grid?.offsetY,
    scene?.walls
  ]);

  const visibility = useMemo(() => {
    if (!actorToken || !scene) return [];
    return computeVisibilityPolygon({
      origin: actorToken,
      walls: scene.walls ?? [],
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      maxDistance: visionProfile.rangeCells * (Number(scene.grid?.size) || 70),
      verticalEnabled: elevationConfig.enabled,
      elevation: observerElevation
    });
  }, [
    visionProfile.rangeCells,
    observerElevation,
    elevationConfig.enabled,
    actorToken?.x,
    actorToken?.y,
    actorToken?.elevation,
    actorToken?.id,
    scene?.width,
    scene?.height,
    scene?.grid?.size,
    scene?.walls
  ]);

  const lightingTokens = useMemo(() => {
    if (!transientToken?.id) return tokens;
    return (Array.isArray(tokens) ? tokens : []).map((token) => token?.id === transientToken.id ? transientToken : token);
  }, [tokens, transientToken]);

  if (!scene || !viewport) return null;

  const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;
  const currentPoints = visibility.map((point) => `${point.x},${point.y}`).join(' ');
  const tint = tokenVisionTint(visionProfile.mode);
  const advancedVisionEffect = active && currentPoints && tint.opacity > 0 ? (
    <svg
      className="fog-of-war-overlay advanced-vision-effect"
      width={scene.width}
      height={scene.height}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      style={{ transform }}
      aria-hidden="true"
    >
      <polygon
        className={`vision-mode-overlay vision-${visionProfile.mode}`}
        points={currentPoints}
        fill={tint.color}
        opacity={tint.opacity}
      />
    </svg>
  ) : null;

  const lighting = (
    <DynamicLightingOverlay
      scene={scene}
      tokens={lightingTokens}
      viewport={viewport}
      active={true}
      visionProfile={active ? visionProfile : null}
      visionPolygon={active ? visibility : []}
    />
  );
  const editor = <AdvancedVisionEditor scene={scene} actorId={actorId} tokens={lightingTokens} />;

  if (!active || !fog.enabled) {
    return <>{lighting}{editor}</>;
  }

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
      {advancedVisionEffect}
      {editor}
    </>
  );
}
