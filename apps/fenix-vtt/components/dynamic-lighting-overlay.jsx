'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  computeSceneLightPolygons,
  normalizeSceneLighting
} from '../../../packages/scene-lighting/src/index.js';
import { normalizeSceneElevation } from '../../../packages/scene-elevation/src/index.js';
import {
  normalizeTokenVisionProfiles,
  tokenVisionTint
} from '../../../packages/scene-vision/src/index.js';
import { useFenixSession } from './session-provider.jsx';

function lightId() {
  return globalThis.crypto?.randomUUID?.() ?? `light-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function editableLighting(input, scene) {
  const normalized = normalizeSceneLighting(input ?? {}, {
    sceneWidth: scene?.width,
    sceneHeight: scene?.height,
    idFactory: lightId
  });
  return {
    enabled: normalized.enabled,
    darkness: normalized.darkness,
    sources: normalized.sources.map((source) => ({ ...source }))
  };
}

function personalLightSources(scene) {
  const profiles = normalizeTokenVisionProfiles(scene?.visionProfiles ?? {}, {
    defaultRangeCells: Number(scene?.fog?.visionRangeCells) || 8
  });
  return Object.entries(profiles).flatMap(([actorId, profile]) => {
    if (!profile.personalLight.enabled) return [];
    return [{
      id: `vision-personal-${actorId}`.slice(0, 120),
      name: `Luz pessoal · ${actorId}`.slice(0, 120),
      enabled: true,
      x: 0,
      y: 0,
      elevation: profile.elevation,
      radiusCells: profile.personalLight.radiusCells,
      intensity: profile.personalLight.intensity,
      color: profile.personalLight.color,
      attachedTokenId: actorId
    }];
  });
}

export function DynamicLightingOverlay({
  scene,
  tokens = [],
  viewport,
  active = true,
  visionProfile = null,
  visionPolygon = []
}) {
  const rawId = useId();
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '') || 'lighting';
  const { isGm, state, updateSceneLighting } = useFenixSession();
  const [editorOpen, setEditorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => editableLighting(scene?.lighting, scene));
  const lightingSignature = JSON.stringify(scene?.lighting ?? {});
  const visionProfilesSignature = JSON.stringify(scene?.visionProfiles ?? {});
  const elevationSignature = JSON.stringify(scene?.elevation ?? {});
  const elevationConfig = useMemo(() => normalizeSceneElevation(scene?.elevation ?? {}), [elevationSignature]);

  useEffect(() => {
    if (!editorOpen) setDraft(editableLighting(scene?.lighting, scene));
  }, [scene?.id, lightingSignature, scene?.width, scene?.height, editorOpen]);

  const lighting = useMemo(() => {
    const base = normalizeSceneLighting(scene?.lighting ?? {}, {
      sceneWidth: scene?.width,
      sceneHeight: scene?.height,
      idFactory: lightId
    });
    const baseIds = new Set(base.sources.map((source) => source.id));
    const derived = personalLightSources(scene).filter((source) => !baseIds.has(source.id));
    return normalizeSceneLighting({
      enabled: base.enabled,
      darkness: base.darkness,
      sources: [...base.sources, ...derived].slice(0, 128)
    }, {
      sceneWidth: scene?.width,
      sceneHeight: scene?.height,
      idFactory: lightId
    });
  }, [lightingSignature, visionProfilesSignature, scene?.width, scene?.height, scene?.fog?.visionRangeCells]);

  const lights = useMemo(() => {
    if (!active || !lighting.enabled || !scene) return [];
    return computeSceneLightPolygons({
      lighting,
      walls: scene.walls ?? [],
      grid: scene.grid ?? {},
      sceneWidth: scene.width,
      sceneHeight: scene.height,
      tokens,
      verticalEnabled: elevationConfig.enabled
    });
  }, [active, lighting, scene, tokens, elevationConfig.enabled]);

  function addSource() {
    const selectedToken = (Array.isArray(tokens) ? tokens : []).find((token) => token?.id === state.selectedActorId) ?? null;
    setDraft((current) => ({
      ...current,
      sources: [...current.sources, {
        id: lightId(),
        name: `Luz ${current.sources.length + 1}`,
        enabled: true,
        x: selectedToken?.x ?? Math.round((Number(scene?.width) || 1000) / 2),
        y: selectedToken?.y ?? Math.round((Number(scene?.height) || 700) / 2),
        elevation: selectedToken?.elevation ?? 0,
        radiusCells: 6,
        intensity: 1,
        color: '#f2c66f',
        attachedTokenId: selectedToken?.id ?? null
      }]
    }));
  }

  function patchSource(sourceId, patch) {
    setDraft((current) => ({
      ...current,
      sources: current.sources.map((source) => source.id === sourceId ? { ...source, ...patch } : source)
    }));
  }

  async function saveLighting() {
    if (!isGm || !scene?.id || saving) return;
    setSaving(true);
    try {
      const normalized = normalizeSceneLighting(draft, {
        sceneWidth: scene.width,
        sceneHeight: scene.height,
        idFactory: lightId
      });
      const result = await updateSceneLighting(scene.id, normalized);
      setDraft(editableLighting(result?.scene?.lighting ?? normalized, scene));
      setEditorOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const overlay = active && lighting.enabled && scene && viewport ? (() => {
    const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`;
    const maskId = `darkness-mask-${id}`;
    const visionPoints = Array.isArray(visionPolygon)
      ? visionPolygon.map((point) => `${point.x},${point.y}`).join(' ')
      : '';
    const tint = tokenVisionTint(visionProfile?.mode);
    const remainingDarkness = Math.round(255 * (1 - tint.darknessBypass));
    const visionMaskFill = `rgb(${remainingDarkness},${remainingDarkness},${remainingDarkness})`;
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
            {visionPoints && tint.darknessBypass > 0 ? (
              <polygon points={visionPoints} fill={visionMaskFill} />
            ) : null}
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
  })() : null;

  if (!scene || !viewport) return null;

  return (
    <>
      {overlay}
      {isGm ? (
        <>
          <button
            type="button"
            className={`lighting-floating-button ${editorOpen ? 'active' : ''} ${lighting.enabled ? 'lighting-on' : ''}`}
            onClick={() => setEditorOpen((value) => !value)}
            title="Configurar iluminação dinâmica"
          >
            Luz {lighting.enabled ? 'ON' : 'OFF'}
          </button>
          {editorOpen ? (
            <div className="lighting-config-panel">
              <div className="lighting-config-heading">
                <strong>Iluminação dinâmica</strong>
                <small>{draft.sources.length} fontes manuais</small>
              </div>
              <label className="lighting-enable-toggle">
                <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} />
                Ativar escuridão e fontes nesta cena
              </label>
              <label>
                Escuridão ambiente
                <input type="number" min="0" max="0.98" step="0.05" value={draft.darkness} onChange={(event) => setDraft((current) => ({ ...current, darkness: event.target.value }))} />
              </label>

              <div className="lighting-source-list">
                {draft.sources.map((source) => (
                  <div className="lighting-source-row" key={source.id}>
                    <div className="lighting-source-heading">
                      <input type="text" value={source.name} onChange={(event) => patchSource(source.id, { name: event.target.value })} aria-label="Nome da fonte" />
                      <input type="color" value={source.color} onChange={(event) => patchSource(source.id, { color: event.target.value })} aria-label="Cor da fonte" />
                      <button type="button" onClick={() => setDraft((current) => ({ ...current, sources: current.sources.filter((item) => item.id !== source.id) }))}>Remover</button>
                    </div>
                    <div className="lighting-source-grid">
                      <label>Origem
                        <select value={source.attachedTokenId ?? ''} onChange={(event) => patchSource(source.id, { attachedTokenId: event.target.value || null })}>
                          <option value="">Fixa no mapa</option>
                          {(Array.isArray(tokens) ? tokens : []).map((token) => <option key={token.id} value={token.id}>{token.name ?? token.id}</option>)}
                        </select>
                      </label>
                      <label>Raio (células)<input type="number" min="1" max="60" value={source.radiusCells} onChange={(event) => patchSource(source.id, { radiusCells: event.target.value })} /></label>
                      <label>X<input type="number" value={source.x} disabled={Boolean(source.attachedTokenId)} onChange={(event) => patchSource(source.id, { x: event.target.value })} /></label>
                      <label>Y<input type="number" value={source.y} disabled={Boolean(source.attachedTokenId)} onChange={(event) => patchSource(source.id, { y: event.target.value })} /></label>
                      <label>Elevação Z<input type="number" min="-1000" max="10000" step="0.5" value={source.elevation} disabled={Boolean(source.attachedTokenId)} onChange={(event) => patchSource(source.id, { elevation: event.target.value })} /></label>
                      <label>Intensidade<input type="number" min="0.1" max="1" step="0.1" value={source.intensity} onChange={(event) => patchSource(source.id, { intensity: event.target.value })} /></label>
                      <label className="lighting-enable-toggle"><input type="checkbox" checked={source.enabled !== false} onChange={(event) => patchSource(source.id, { enabled: event.target.checked })} /> Fonte ativa</label>
                    </div>
                  </div>
                ))}
              </div>

              <button type="button" className="lighting-add-button" onClick={addSource}>+ Adicionar fonte na posição selecionada</button>
              <small className="lighting-config-help">Com elevação ativa, sombras respeitam a faixa vertical das paredes. Uma luz acima do topo de uma barreira não é ocluída por ela. Fontes anexadas acompanham também o Z do token.</small>
              <div className="lighting-config-actions">
                <button type="button" onClick={() => { setDraft(editableLighting(scene.lighting, scene)); setEditorOpen(false); }}>Cancelar</button>
                <button type="button" className="primary-button" disabled={saving || state.busy} onClick={saveLighting}>{saving ? 'Salvando…' : 'Salvar iluminação'}</button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
