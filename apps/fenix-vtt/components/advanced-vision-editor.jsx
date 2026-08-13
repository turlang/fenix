'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  SceneRegionKind,
  TokenMovementMode,
  levelForElevation,
  normalizeSceneElevation,
  normalizeSceneRegions
} from '../../../packages/scene-elevation/src/index.js';
import {
  TokenVisionMode,
  normalizeSceneFog,
  normalizeTokenVisionProfile,
  normalizeTokenVisionProfiles
} from '../../../packages/scene-vision/src/index.js';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { useFenixSession } from './session-provider.jsx';

const MODE_LABELS = Object.freeze({
  [TokenVisionMode.NORMAL]: 'Normal',
  [TokenVisionMode.DARKVISION]: 'Visão no escuro',
  [TokenVisionMode.INFRAVISION]: 'Infravisão'
});
const REGION_LABELS = Object.freeze({
  [SceneRegionKind.FLOOR]: 'Piso',
  [SceneRegionKind.STAIRS]: 'Escada',
  [SceneRegionKind.RAMP]: 'Rampa'
});

function editableProfile(scene, actorId) {
  const fog = normalizeSceneFog(scene?.fog ?? {});
  const profile = normalizeTokenVisionProfile(scene?.visionProfiles?.[actorId] ?? {}, { defaultRangeCells: fog.visionRangeCells });
  return { ...profile, personalLight: { ...profile.personalLight } };
}
function editableElevation(scene) {
  const normalized = normalizeSceneElevation(scene?.elevation ?? {});
  return { ...normalized, levels: normalized.levels.map((level) => ({ ...level })) };
}
function editableRegions(scene) {
  try {
    return normalizeSceneRegions(scene?.regions ?? [], { sceneWidth: scene?.width, sceneHeight: scene?.height }).map((region) => ({
      ...region,
      points: region.points.map((point) => ({ ...point })),
      axis: region.axis ? { start: { ...region.axis.start }, end: { ...region.axis.end } } : null
    }));
  } catch { return []; }
}
function levelId() { return globalThis.crypto?.randomUUID?.()?.slice(0, 18) ?? `level-${Date.now()}`; }
function regionId() { return globalThis.crypto?.randomUUID?.()?.slice(0, 18) ?? `region-${Date.now()}`; }
function bounds(region) {
  const xs = region.points.map((point) => Number(point.x));
  const ys = region.points.map((point) => Number(point.y));
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}
function rectanglePoints(x1, y1, x2, y2) {
  const left = Math.min(Number(x1), Number(x2)); const right = Math.max(Number(x1), Number(x2));
  const top = Math.min(Number(y1), Number(y2)); const bottom = Math.max(Number(y1), Number(y2));
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
}

export function AdvancedVisionEditor({ scene, actorId = null, tokens = [] }) {
  const { isGm, state, campaign, updateSceneFog, updateSceneWalls, moveToken } = useFenixSession();
  const client = useMemo(() => createFenixApiClient(), []);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wallSaving, setWallSaving] = useState(false);
  const [draft, setDraft] = useState(() => editableProfile(scene, actorId));
  const [sceneDraft, setSceneDraft] = useState(() => editableElevation(scene));
  const [regionsDraft, setRegionsDraft] = useState(() => editableRegions(scene));
  const profileSignature = JSON.stringify(scene?.visionProfiles?.[actorId] ?? {});
  const elevationSignature = JSON.stringify(scene?.elevation ?? {});
  const regionsSignature = JSON.stringify(scene?.regions ?? []);
  const actor = useMemo(() => (Array.isArray(tokens) ? tokens : []).find((token) => token?.id === actorId) ?? null, [tokens, actorId]);
  const current = useMemo(() => normalizeTokenVisionProfile(scene?.visionProfiles?.[actorId] ?? {}, {
    defaultRangeCells: normalizeSceneFog(scene?.fog ?? {}).visionRangeCells
  }), [scene?.fog?.visionRangeCells, profileSignature, actorId]);
  const sceneElevation = useMemo(() => normalizeSceneElevation(scene?.elevation ?? {}), [elevationSignature]);
  const currentElevation = Number.isFinite(Number(actor?.elevation)) ? Number(actor.elevation) : current.elevation;
  const currentLevel = levelForElevation(sceneElevation, currentElevation);

  useEffect(() => {
    if (!open) {
      setDraft(editableProfile(scene, actorId));
      setSceneDraft(editableElevation(scene));
      setRegionsDraft(editableRegions(scene));
    }
  }, [scene?.id, actorId, profileSignature, elevationSignature, regionsSignature, scene?.fog?.visionRangeCells, open]);

  if (!scene || !actorId) return null;

  function patchPersonalLight(patch) { setDraft((value) => ({ ...value, personalLight: { ...value.personalLight, ...patch } })); }
  function patchLevel(id, patch) { setSceneDraft((value) => ({ ...value, levels: value.levels.map((level) => level.id === id ? { ...level, ...patch } : level) })); }
  function patchRegion(id, patch) { setRegionsDraft((value) => value.map((region) => region.id === id ? { ...region, ...patch } : region)); }
  function patchRegionBounds(id, patch) {
    setRegionsDraft((value) => value.map((region) => {
      if (region.id !== id) return region;
      const currentBounds = { ...bounds(region), ...patch };
      const points = rectanglePoints(currentBounds.x1, currentBounds.y1, currentBounds.x2, currentBounds.y2);
      const midY = (Number(currentBounds.y1) + Number(currentBounds.y2)) / 2;
      const axis = region.kind === SceneRegionKind.FLOOR ? null : {
        start: { x: Number(currentBounds.x1), y: midY },
        end: { x: Number(currentBounds.x2), y: midY }
      };
      return { ...region, points, axis };
    }));
  }
  function addLevel() {
    setSceneDraft((value) => {
      const last = value.levels[value.levels.length - 1];
      return { ...value, levels: [...value.levels, { id: levelId(), name: `Nível ${value.levels.length + 1}`, elevation: Number(last?.elevation ?? 0) + Number(value.levelHeight || 3) }] };
    });
  }
  function addRegion(kind) {
    const size = Number(scene.grid?.size) || 70;
    const cx = Number(actor?.x ?? scene.width / 2); const cy = Number(actor?.y ?? scene.height / 2);
    const x1 = Math.max(0, cx - size); const y1 = Math.max(0, cy - size);
    const x2 = Math.min(scene.width, cx + size); const y2 = Math.min(scene.height, cy + size);
    const baseElevation = currentElevation;
    const targetElevation = kind === SceneRegionKind.FLOOR ? baseElevation : baseElevation + Number(sceneDraft.levelHeight || 3);
    setRegionsDraft((value) => [...value, {
      id: regionId(),
      name: `${REGION_LABELS[kind]} ${value.length + 1}`,
      kind,
      enabled: true,
      priority: 0,
      points: rectanglePoints(x1, y1, x2, y2),
      baseElevation,
      targetElevation,
      axis: kind === SceneRegionKind.FLOOR ? null : { start: { x: x1, y: (y1 + y2) / 2 }, end: { x: x2, y: (y1 + y2) / 2 } }
    }]);
  }
  function changeRegionKind(id, nextKind) {
    setRegionsDraft((value) => value.map((region) => {
      if (region.id !== id) return region;
      const b = bounds(region); const midY = (b.y1 + b.y2) / 2;
      return {
        ...region,
        kind: nextKind,
        targetElevation: nextKind === SceneRegionKind.FLOOR ? region.baseElevation : region.targetElevation,
        axis: nextKind === SceneRegionKind.FLOOR ? null : (region.axis ?? { start: { x: b.x1, y: midY }, end: { x: b.x2, y: midY } })
      };
    }));
  }
  function reverseRegion(id) {
    setRegionsDraft((value) => value.map((region) => region.id !== id || !region.axis ? region : ({
      ...region,
      baseElevation: region.targetElevation,
      targetElevation: region.baseElevation,
      axis: { start: { ...region.axis.end }, end: { ...region.axis.start } }
    })));
  }

  async function moveVertical(direction) {
    if (!actor || !sceneElevation.enabled || current.movementMode !== TokenMovementMode.FLYING || state.busy) return;
    await moveToken({ ...actor, elevation: currentElevation + direction * sceneElevation.verticalStep, height: current.height, movementMode: current.movementMode });
  }

  async function save() {
    if (saving || !actorId) return;
    setSaving(true);
    try {
      const fog = normalizeSceneFog(scene.fog ?? {});
      const profiles = normalizeTokenVisionProfiles(scene.visionProfiles ?? {}, { defaultRangeCells: fog.visionRangeCells });
      const nextProfile = normalizeTokenVisionProfile(draft, { defaultRangeCells: fog.visionRangeCells });
      const nextElevation = normalizeSceneElevation(sceneDraft);
      const nextRegions = normalizeSceneRegions(regionsDraft, { sceneWidth: scene.width, sceneHeight: scene.height });
      await client.updateSceneRegions(campaign.id, scene.id, nextRegions);
      const result = await updateSceneFog(scene.id, {
        ...fog,
        visionProfiles: { ...profiles, [actorId]: nextProfile },
        sceneElevation: nextElevation
      });
      if (actor) await moveToken({ ...actor, elevation: nextProfile.elevation, height: nextProfile.height, movementMode: nextProfile.movementMode });
      setDraft(editableProfile(result?.scene ?? scene, actorId));
      setSceneDraft(editableElevation(result?.scene ?? scene));
      setRegionsDraft(editableRegions(result?.scene ?? scene));
      setOpen(false);
    } finally { setSaving(false); }
  }

  async function applyDefaultWallBand() {
    if (!isGm || wallSaving || !scene?.walls?.length) return;
    setWallSaving(true);
    try {
      const config = normalizeSceneElevation(sceneDraft);
      await updateSceneWalls(scene.id, scene.walls.map((wall) => ({ ...wall, bottomElevation: config.defaultWallBottom, topElevation: config.defaultWallTop })));
    } finally { setWallSaving(false); }
  }

  const flightControls = sceneElevation.enabled && current.movementMode === TokenMovementMode.FLYING ? (
    <div className="vertical-flight-controls">
      <button type="button" disabled={!actor || state.busy} onClick={() => void moveVertical(-1)} title="Descer um passo vertical">−Z</button>
      <span>{currentElevation.toFixed(2)} {sceneElevation.unit} · {currentLevel?.name ?? 'nível livre'}</span>
      <button type="button" disabled={!actor || state.busy} onClick={() => void moveVertical(1)} title="Subir um passo vertical">+Z</button>
    </div>
  ) : null;

  if (!isGm) {
    return <div className={`advanced-vision-chip vision-${current.mode} ${flightControls ? 'with-flight' : ''}`}><span>{MODE_LABELS[current.mode]} · {current.rangeCells}c · Z {currentElevation.toFixed(1)}</span>{flightControls}</div>;
  }

  return (
    <>
      <button type="button" className={`advanced-vision-button ${open ? 'active' : ''} vision-${current.mode}`} onClick={() => setOpen((value) => !value)} title="Configurar sentidos, níveis, pisos e elevação do personagem selecionado">
        Sentidos · {MODE_LABELS[current.mode]} · Z {currentElevation.toFixed(1)}
      </button>

      {open ? (
        <div className="advanced-vision-panel elevation-panel">
          <div className="advanced-vision-heading"><div><strong>Visão e elevação</strong><small>{actor?.name ?? actorId}</small></div><span>{currentLevel?.name ?? 'nível livre'} · Z {currentElevation.toFixed(1)}</span></div>
          <label>Modo de visão<select value={draft.mode} onChange={(event) => setDraft((value) => ({ ...value, mode: event.target.value }))}><option value={TokenVisionMode.NORMAL}>Normal</option><option value={TokenVisionMode.DARKVISION}>Visão no escuro</option><option value={TokenVisionMode.INFRAVISION}>Infravisão</option></select></label>
          <div className="advanced-vision-grid">
            <label>Alcance (células)<input type="number" min="1" max="60" value={draft.rangeCells} onChange={(event) => setDraft((value) => ({ ...value, rangeCells: event.target.value }))} /></label>
            <label>Elevação base / Z<input type="number" min="-1000" max="10000" step="0.5" value={draft.elevation} onChange={(event) => setDraft((value) => ({ ...value, elevation: event.target.value }))} /></label>
            <label>Altura do corpo<input type="number" min="0.2" max="20" step="0.1" value={draft.height} onChange={(event) => setDraft((value) => ({ ...value, height: event.target.value }))} /></label>
            <label>Movimento vertical<select value={draft.movementMode} onChange={(event) => setDraft((value) => ({ ...value, movementMode: event.target.value }))}><option value={TokenMovementMode.GROUND}>Solo / piso automático</option><option value={TokenMovementMode.FLYING}>Voo / Z variável</option></select></label>
          </div>
          {flightControls}

          <label className="advanced-vision-toggle"><input type="checkbox" checked={draft.personalLight.enabled} onChange={(event) => patchPersonalLight({ enabled: event.target.checked })} />Fonte de luz pessoal anexada ao token</label>
          {draft.personalLight.enabled ? <div className="advanced-vision-grid"><label>Raio da luz<input type="number" min="1" max="60" value={draft.personalLight.radiusCells} onChange={(event) => patchPersonalLight({ radiusCells: event.target.value })} /></label><label>Intensidade<input type="number" min="0.1" max="1" step="0.1" value={draft.personalLight.intensity} onChange={(event) => patchPersonalLight({ intensity: event.target.value })} /></label><label>Cor<input type="color" value={draft.personalLight.color} onChange={(event) => patchPersonalLight({ color: event.target.value })} /></label></div> : null}

          <div className="elevation-section">
            <div className="elevation-section-heading"><div><strong>Níveis da cena</strong><small>2.5D · pontes, mezaninos, voo</small></div><label className="advanced-vision-toggle"><input type="checkbox" checked={sceneDraft.enabled} onChange={(event) => setSceneDraft((value) => ({ ...value, enabled: event.target.checked }))} /> Ativo</label></div>
            <div className="advanced-vision-grid">
              <label>Altura entre níveis<input type="number" min="0.5" max="100" step="0.5" value={sceneDraft.levelHeight} onChange={(event) => setSceneDraft((value) => ({ ...value, levelHeight: event.target.value }))} /></label>
              <label>Passo de voo<input type="number" min="0.25" step="0.25" value={sceneDraft.verticalStep} onChange={(event) => setSceneDraft((value) => ({ ...value, verticalStep: event.target.value }))} /></label>
              <label>Parede padrão · base<input type="number" step="0.5" value={sceneDraft.defaultWallBottom} onChange={(event) => setSceneDraft((value) => ({ ...value, defaultWallBottom: event.target.value }))} /></label>
              <label>Parede padrão · topo<input type="number" step="0.5" value={sceneDraft.defaultWallTop} onChange={(event) => setSceneDraft((value) => ({ ...value, defaultWallTop: event.target.value }))} /></label>
            </div>
            <div className="elevation-level-list">
              {sceneDraft.levels.map((level) => <div className="elevation-level-row" key={level.id}><input aria-label="Nome do nível" value={level.name} onChange={(event) => patchLevel(level.id, { name: event.target.value })} /><input aria-label="Elevação do nível" type="number" step="0.5" value={level.elevation} onChange={(event) => patchLevel(level.id, { elevation: event.target.value })} /><button type="button" disabled={sceneDraft.levels.length <= 1} onClick={() => setSceneDraft((value) => ({ ...value, levels: value.levels.filter((item) => item.id !== level.id) }))}>×</button></div>)}
            </div>
            <div className="elevation-tools"><button type="button" onClick={addLevel}>+ Nível</button><button type="button" disabled={!scene.walls?.length || wallSaving} onClick={() => void applyDefaultWallBand()}>{wallSaving ? 'Aplicando…' : 'Aplicar faixa padrão às paredes'}</button></div>
          </div>

          <div className="elevation-section floor-region-section">
            <div className="elevation-section-heading"><div><strong>Pisos e transições</strong><small>regiões privadas do Mestre</small></div><span>{regionsDraft.length} regiões</span></div>
            <div className="elevation-tools"><button type="button" onClick={() => addRegion(SceneRegionKind.FLOOR)}>+ Piso</button><button type="button" onClick={() => addRegion(SceneRegionKind.STAIRS)}>+ Escada</button><button type="button" onClick={() => addRegion(SceneRegionKind.RAMP)}>+ Rampa</button></div>
            <div className="floor-region-list">
              {regionsDraft.map((region) => {
                const b = bounds(region);
                return <div className={`floor-region-row region-${region.kind}`} key={region.id}>
                  <div className="floor-region-heading"><input value={region.name} onChange={(event) => patchRegion(region.id, { name: event.target.value })} /><select value={region.kind} onChange={(event) => changeRegionKind(region.id, event.target.value)}><option value={SceneRegionKind.FLOOR}>Piso</option><option value={SceneRegionKind.STAIRS}>Escada</option><option value={SceneRegionKind.RAMP}>Rampa</option></select><button type="button" onClick={() => setRegionsDraft((value) => value.filter((item) => item.id !== region.id))}>×</button></div>
                  <label className="advanced-vision-toggle"><input type="checkbox" checked={region.enabled !== false} onChange={(event) => patchRegion(region.id, { enabled: event.target.checked })} />Ativa</label>
                  <div className="floor-region-coordinates">
                    <label>X1<input type="number" value={b.x1} onChange={(event) => patchRegionBounds(region.id, { x1: event.target.value })} /></label><label>Y1<input type="number" value={b.y1} onChange={(event) => patchRegionBounds(region.id, { y1: event.target.value })} /></label><label>X2<input type="number" value={b.x2} onChange={(event) => patchRegionBounds(region.id, { x2: event.target.value })} /></label><label>Y2<input type="number" value={b.y2} onChange={(event) => patchRegionBounds(region.id, { y2: event.target.value })} /></label>
                  </div>
                  <div className="advanced-vision-grid"><label>Z inicial<input type="number" step="0.25" value={region.baseElevation} onChange={(event) => patchRegion(region.id, { baseElevation: event.target.value, ...(region.kind === SceneRegionKind.FLOOR ? { targetElevation: event.target.value } : {}) })} /></label>{region.kind !== SceneRegionKind.FLOOR ? <label>Z final<input type="number" step="0.25" value={region.targetElevation} onChange={(event) => patchRegion(region.id, { targetElevation: event.target.value })} /></label> : null}<label>Prioridade<input type="number" min="-100" max="100" value={region.priority} onChange={(event) => patchRegion(region.id, { priority: event.target.value })} /></label></div>
                  {region.kind !== SceneRegionKind.FLOOR ? <button type="button" className="region-reverse-button" onClick={() => reverseRegion(region.id)}>↔ Inverter subida</button> : null}
                </div>;
              })}
            </div>
          </div>

          <small className="advanced-vision-help">Piso fixa o Z de tokens em Solo. Escada e Rampa interpolam automaticamente entre Z inicial e Z final conforme o token cruza a região. Tokens em Voo ignoram pisos. A geometria das regiões é enviada somente ao Mestre; o Engine calcula a transição do jogador.</small>
          <div className="advanced-vision-actions"><button type="button" onClick={() => { setDraft(editableProfile(scene, actorId)); setSceneDraft(editableElevation(scene)); setRegionsDraft(editableRegions(scene)); setOpen(false); }}>Cancelar</button><button type="button" className="primary-button" disabled={saving || state.busy} onClick={save}>{saving ? 'Salvando…' : 'Salvar sentidos, níveis e pisos'}</button></div>
        </div>
      ) : null}
    </>
  );
}
