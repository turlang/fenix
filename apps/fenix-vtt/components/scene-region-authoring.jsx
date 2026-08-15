'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { snapScenePoint } from '../../../packages/scene-geometry/src/index.js';
import {
  SceneRegionKind,
  normalizeSceneRegions,
  pointInPolygon
} from '../../../packages/scene-elevation/src/index.js';

const REGION_LABELS = Object.freeze({
  [SceneRegionKind.FLOOR]: 'Piso',
  [SceneRegionKind.STAIRS]: 'Escada',
  [SceneRegionKind.RAMP]: 'Rampa'
});

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

function regionAtPoint(regions, point) {
  return [...regions]
    .sort((a, b) => Number(b.priority ?? 0) - Number(a.priority ?? 0))
    .find((region) => pointInPolygon(point, region.points)) ?? null;
}

function draftRegion({ kind, start, end, baseElevation, levelHeight, index }) {
  const points = rectanglePoints(start, end);
  const bounds = regionBounds({ points });
  const midY = (bounds.y1 + bounds.y2) / 2;
  const targetElevation = kind === SceneRegionKind.FLOOR
    ? Number(baseElevation)
    : Number(baseElevation) + Number(levelHeight || 3);
  return {
    id: randomRegionId(),
    name: `${REGION_LABELS[kind]} ${index + 1}`,
    kind,
    enabled: true,
    priority: 0,
    points,
    baseElevation: Number(baseElevation) || 0,
    targetElevation,
    axis: kind === SceneRegionKind.FLOOR ? null : {
      start: { x: bounds.x1, y: midY },
      end: { x: bounds.x2, y: midY }
    }
  };
}

function screenPoint(point, viewport) {
  return {
    x: (Number(point?.x) - Number(viewport?.x || 0)) * Number(viewport?.zoom || 1),
    y: (Number(point?.y) - Number(viewport?.y || 0)) * Number(viewport?.zoom || 1)
  };
}

export function SceneRegionAuthoring({
  scene,
  viewport,
  busy = false,
  onRegionsChanged,
  onClose
}) {
  const surfaceRef = useRef(null);
  const gestureRef = useRef(null);
  const [mode, setMode] = useState('select');
  const [snap, setSnap] = useState(true);
  const [visible, setVisible] = useState(true);
  const [regions, setRegions] = useState(() => cloneRegions(scene?.regions, scene));
  const [preview, setPreview] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const levels = useMemo(() => scene?.elevation?.levels ?? [{ id: 'ground', name: 'Térreo', elevation: 0 }], [scene?.elevation?.levels]);
  const [baseElevation, setBaseElevation] = useState(() => Number(levels[0]?.elevation) || 0);
  const selected = regions.find((region) => region.id === selectedId) ?? null;

  useEffect(() => {
    setRegions(cloneRegions(scene?.regions, scene));
    setPreview(null);
    setSelectedId(null);
    setDirty(false);
    setMode('select');
    gestureRef.current = null;
  }, [scene?.id, scene?.regions]);

  useEffect(() => {
    if (!levels.some((level) => Number(level.elevation) === Number(baseElevation))) {
      setBaseElevation(Number(levels[0]?.elevation) || 0);
    }
  }, [baseElevation, levels]);

  function worldPoint(event) {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    const zoom = Math.max(0.001, Number(viewport?.zoom) || 1);
    const raw = {
      x: Number(viewport?.x || 0) + (event.clientX - rect.left) / zoom,
      y: Number(viewport?.y || 0) + (event.clientY - rect.top) / zoom
    };
    const point = snap ? snapScenePoint(raw, scene?.grid ?? {}) : raw;
    return {
      x: Math.max(0, Math.min(Number(scene?.width) || 0, Number(point.x) || 0)),
      y: Math.max(0, Math.min(Number(scene?.height) || 0, Number(point.y) || 0))
    };
  }

  function beginGesture(event) {
    if (busy || event.button !== 0) return;
    const point = worldPoint(event);
    if (!point) return;

    if (mode === 'erase') {
      const target = regionAtPoint(regions, point);
      if (target) {
        setRegions((current) => current.filter((region) => region.id !== target.id));
        setSelectedId((current) => current === target.id ? null : current);
        setDirty(true);
      }
      event.preventDefault();
      return;
    }

    if ([SceneRegionKind.FLOOR, SceneRegionKind.STAIRS, SceneRegionKind.RAMP].includes(mode)) {
      gestureRef.current = { type: 'draw', kind: mode, start: point };
      setPreview(draftRegion({
        kind: mode,
        start: point,
        end: point,
        baseElevation,
        levelHeight: scene?.elevation?.levelHeight ?? 3,
        index: regions.length
      }));
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    const target = regionAtPoint(regions, point);
    setSelectedId(target?.id ?? null);
    event.preventDefault();
  }

  function moveGesture(event) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.type !== 'draw') return;
    const point = worldPoint(event);
    if (!point) return;
    setPreview(draftRegion({
      kind: gesture.kind,
      start: gesture.start,
      end: point,
      baseElevation,
      levelHeight: scene?.elevation?.levelHeight ?? 3,
      index: regions.length
    }));
  }

  function endGesture(event) {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!gesture || gesture.type !== 'draw' || !preview) return;
    const bounds = regionBounds(preview);
    if (bounds.x2 - bounds.x1 >= 4 && bounds.y2 - bounds.y1 >= 4) {
      const finalized = { ...preview, id: randomRegionId() };
      setRegions((current) => [...current, finalized]);
      setSelectedId(finalized.id);
      setDirty(true);
    }
    setPreview(null);
  }

  function patchSelected(patch) {
    if (!selectedId) return;
    setRegions((current) => current.map((region) => region.id === selectedId ? { ...region, ...patch } : region));
    setDirty(true);
  }

  function invertAxis() {
    if (!selected?.axis) return;
    patchSelected({ axis: { start: { ...selected.axis.end }, end: { ...selected.axis.start } } });
  }

  function revert() {
    setRegions(cloneRegions(scene?.regions, scene));
    setPreview(null);
    setSelectedId(null);
    setDirty(false);
    gestureRef.current = null;
  }

  async function save() {
    if (!onRegionsChanged || saving || busy || !dirty) return;
    setSaving(true);
    try {
      const normalized = normalizeSceneRegions(regions, {
        sceneWidth: scene.width,
        sceneHeight: scene.height
      });
      const result = await onRegionsChanged(scene.id, normalized);
      setRegions(cloneRegions(result?.scene?.regions ?? normalized, scene));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  const displayRegions = preview ? [...regions, preview] : regions;

  return (
    <div className="scene-region-authoring" aria-label="Authoring de pisos, escadas e rampas">
      <svg
        ref={surfaceRef}
        className="scene-region-surface"
        onPointerDown={beginGesture}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        onContextMenu={(event) => event.preventDefault()}
      >
        {visible ? displayRegions.map((region) => {
          const points = region.points.map((point) => screenPoint(point, viewport));
          const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
          const selectedClass = region.id === selectedId ? ' selected' : '';
          const previewClass = region === preview ? ' preview' : '';
          const axisStart = region.axis ? screenPoint(region.axis.start, viewport) : null;
          const axisEnd = region.axis ? screenPoint(region.axis.end, viewport) : null;
          return (
            <g key={region.id} className={`scene-region region-${region.kind}${selectedClass}${previewClass}`}>
              <polygon points={polygon} />
              {axisStart && axisEnd ? <line className="scene-region-axis" x1={axisStart.x} y1={axisStart.y} x2={axisEnd.x} y2={axisEnd.y} /> : null}
            </g>
          );
        }) : null}
      </svg>

      <aside className="scene-region-palette">
        <div className="scene-region-heading">
          <div><span className="eyebrow">Mapa / Regiões</span><strong>Pisos e transições</strong></div>
          <button type="button" onClick={onClose} aria-label="Fechar regiões">×</button>
        </div>

        <div className="scene-region-tools" role="toolbar" aria-label="Ferramentas de região">
          <button type="button" className={mode === 'select' ? 'active' : ''} onClick={() => setMode('select')}>Selecionar</button>
          <button type="button" className={mode === SceneRegionKind.FLOOR ? 'active' : ''} onClick={() => setMode(SceneRegionKind.FLOOR)}>Piso</button>
          <button type="button" className={mode === SceneRegionKind.STAIRS ? 'active' : ''} onClick={() => setMode(SceneRegionKind.STAIRS)}>Escada</button>
          <button type="button" className={mode === SceneRegionKind.RAMP ? 'active' : ''} onClick={() => setMode(SceneRegionKind.RAMP)}>Rampa</button>
          <button type="button" className={mode === 'erase' ? 'active danger' : 'danger'} onClick={() => setMode('erase')}>Apagar</button>
        </div>

        <div className="scene-region-options">
          <label>Nível base
            <select value={String(baseElevation)} onChange={(event) => setBaseElevation(Number(event.target.value))}>
              {levels.map((level) => <option key={level.id} value={String(level.elevation)}>{level.name} · {level.elevation} {scene?.elevation?.unit ?? 'm'}</option>)}
            </select>
          </label>
          <label className="scene-region-toggle"><input type="checkbox" checked={snap} onChange={(event) => setSnap(event.target.checked)} /> Snap na grade</label>
          <label className="scene-region-toggle"><input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} /> Mostrar regiões</label>
        </div>

        {selected ? (
          <div className="scene-region-inspector">
            <span className="eyebrow">Região selecionada</span>
            <label>Nome<input value={selected.name} onChange={(event) => patchSelected({ name: event.target.value })} /></label>
            <label>Tipo
              <select value={selected.kind} onChange={(event) => {
                const kind = event.target.value;
                const bounds = regionBounds(selected);
                const midY = (bounds.y1 + bounds.y2) / 2;
                patchSelected({
                  kind,
                  targetElevation: kind === SceneRegionKind.FLOOR ? Number(selected.baseElevation) : Number(selected.targetElevation),
                  axis: kind === SceneRegionKind.FLOOR ? null : (selected.axis ?? {
                    start: { x: bounds.x1, y: midY },
                    end: { x: bounds.x2, y: midY }
                  })
                });
              }}>
                <option value={SceneRegionKind.FLOOR}>Piso</option>
                <option value={SceneRegionKind.STAIRS}>Escada</option>
                <option value={SceneRegionKind.RAMP}>Rampa</option>
              </select>
            </label>
            <div className="scene-region-elevation-row">
              <label>Base<input type="number" step="0.25" value={selected.baseElevation} onChange={(event) => patchSelected({ baseElevation: Number(event.target.value) })} /></label>
              <label>Destino<input type="number" step="0.25" disabled={selected.kind === SceneRegionKind.FLOOR} value={selected.targetElevation} onChange={(event) => patchSelected({ targetElevation: Number(event.target.value) })} /></label>
            </div>
            <label>Prioridade<input type="number" min="-100" max="100" step="1" value={selected.priority} onChange={(event) => patchSelected({ priority: Number(event.target.value) })} /></label>
            <label className="scene-region-toggle"><input type="checkbox" checked={selected.enabled !== false} onChange={(event) => patchSelected({ enabled: event.target.checked })} /> Região ativa</label>
            {selected.axis ? <button type="button" className="scene-region-axis-button" onClick={invertAxis}>Inverter sentido da subida</button> : null}
          </div>
        ) : <div className="scene-region-help"><strong>Authoring direto</strong><small>Arraste no mapa para desenhar. Use Selecionar para editar uma região existente.</small></div>}

        <div className="scene-region-actions">
          <button type="button" disabled={!dirty || saving} onClick={revert}>Reverter</button>
          <button type="button" className="primary-button" disabled={!dirty || saving || busy} onClick={save}>{saving ? 'Salvando…' : 'Salvar regiões'}</button>
        </div>
      </aside>
    </div>
  );
}
