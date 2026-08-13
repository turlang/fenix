'use client';

import { useEffect, useState } from 'react';
import { SceneRegionKind } from '../../../packages/scene-elevation/src/index.js';
import { useFenixSession } from './session-provider.jsx';

function center(points = []) {
  if (!points.length) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, point) => sum + Number(point.x || 0), 0) / points.length,
    y: points.reduce((sum, point) => sum + Number(point.y || 0), 0) / points.length
  };
}

export function FloorRegionOverlay({ scene, tokens = [], viewport }) {
  const { isGm } = useFenixSession();
  const [visible, setVisible] = useState(false);

  useEffect(() => setVisible(false), [scene?.id]);
  if (!isGm || !scene || !viewport) return null;

  const regions = Array.isArray(scene.regions) ? scene.regions : [];
  const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;

  return (
    <>
      <button
        type="button"
        className={`floor-region-overlay-toggle ${visible ? 'active' : ''}`}
        onClick={() => setVisible((value) => !value)}
        title="Mostrar pisos, escadas, rampas e elevação dos tokens"
      >
        Pisos · {regions.length}
      </button>

      <svg
        className="floor-region-overlay floor-region-live-overlay"
        width={scene.width}
        height={scene.height}
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        style={{ transform }}
        aria-hidden="true"
      >
        <defs>
          <marker id="floor-region-live-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" />
          </marker>
        </defs>

        {visible ? regions.filter((region) => region?.enabled !== false).map((region) => {
          const label = center(region.points);
          const z = region.kind === SceneRegionKind.FLOOR
            ? `Z ${Number(region.baseElevation || 0).toFixed(1)}`
            : `Z ${Number(region.baseElevation || 0).toFixed(1)} → ${Number(region.targetElevation || 0).toFixed(1)}`;
          return (
            <g key={region.id}>
              <polygon className={`floor-region-shape region-${region.kind}`} points={region.points.map((point) => `${point.x},${point.y}`).join(' ')} />
              {region.axis ? <line className="floor-region-axis" x1={region.axis.start.x} y1={region.axis.start.y} x2={region.axis.end.x} y2={region.axis.end.y} markerEnd="url(#floor-region-live-arrow)" /> : null}
              <text className="floor-region-label" x={label.x} y={label.y - 5} textAnchor="middle">{region.name}</text>
              <text className="floor-region-label" x={label.x} y={label.y + 9} textAnchor="middle">{z}</text>
            </g>
          );
        }) : null}

        {(Array.isArray(tokens) ? tokens : []).map((token) => {
          if (!token?.id || !Number.isFinite(Number(token.elevation))) return null;
          return (
            <g className="floor-region-token-z" key={`token-z-${token.id}`} transform={`translate(${Number(token.x) + 18} ${Number(token.y) - 24})`}>
              <rect x="0" y="0" width="50" height="18" rx="6" />
              <text x="25" y="12" textAnchor="middle">Z {Number(token.elevation).toFixed(1)}</text>
            </g>
          );
        })}
      </svg>
    </>
  );
}
