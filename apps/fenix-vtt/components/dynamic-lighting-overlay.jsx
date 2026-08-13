'use client';

import { useId, useMemo } from 'react';
import {
  computeSceneLightPolygons,
  normalizeSceneLighting
} from '../../../packages/scene-lighting/src/index.js';

export function DynamicLightingOverlay({
  scene,
  tokens = [],
  viewport,
  active = true
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '') || 'lighting';
  const lighting = useMemo(() => normalizeSceneLighting(scene?.lighting ?? {}, {
    sceneWidth: scene?.width,
    sceneHeight: scene?.height,
    idFactory: () => 'light'
  }), [scene?.lighting, scene?.width, scene?.height]);

  const lights = useMemo(() => {
    if (!active || !lighting.enabled || !scene) return [];
    return computeSceneLightPolygons({
      lighting,
      walls: scene.walls ?? [],
      grid: scene.grid ?? {},
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      tokens
    });
  }, [active, lighting, scene, tokens]);

  if (!active || !lighting.enabled || !scene || !viewport) return null;

  const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;
  const maskId = `darkness-mask-${id}`;

  return (
    <svg
      className="dynamic-lighting-overlay"
      width={scene.width}
      height={scene.height}
      viewBox={`0 0 ${scene.width} ${scene.height}`}
      style={{ transform }}
      aria-hidden="true"
    >
      <defs>
        {lights.map(({ source, origin, radius }) => (
          <radialGradient
            key={`gradient-${source.id}`}
            id={`light-gradient-${id}-${source.id}`}
            gradientUnits="userSpaceOnUse"
            cx={origin.x}
            cy={origin.y}
            r={radius}
          >
            <stop offset="0%" stopColor="black" stopOpacity={source.intensity} />
            <stop offset="62%" stopColor="black" stopOpacity={Math.max(0.15, source.intensity * 0.62)} />
            <stop offset="100%" stopColor="white" stopOpacity="1" />
          </radialGradient>
        ))}
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={scene.width} height={scene.height}>
          <rect width={scene.width} height={scene.height} fill="white" />
          {lights.map(({ source, polygon }) => {
            const points = polygon.map((point) => `${point.x},${point.y}`).join(' ');
            return points ? (
              <polygon
                key={`mask-${source.id}`}
                points={points}
                fill={`url(#light-gradient-${id}-${source.id})`}
              />
            ) : null;
          })}
        </mask>
      </defs>

      <rect
        className="dynamic-lighting-darkness"
        width={scene.width}
        height={scene.height}
        opacity={lighting.darkness}
        mask={`url(#${maskId})`}
      />

      {lights.map(({ source, polygon }) => {
        const points = polygon.map((point) => `${point.x},${point.y}`).join(' ');
        if (!points) return null;
        return (
          <polygon
            key={`glow-${source.id}`}
            className="dynamic-lighting-glow"
            points={points}
            fill={source.color}
            opacity={Math.min(0.16, source.intensity * 0.16)}
          />
        );
      })}
    </svg>
  );
}
