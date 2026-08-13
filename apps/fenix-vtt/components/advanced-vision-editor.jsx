'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  TokenMovementMode,
  levelForElevation,
  normalizeSceneElevation
} from '../../../packages/scene-elevation/src/index.js';
import {
  TokenVisionMode,
  normalizeSceneFog,
  normalizeTokenVisionProfile,
  normalizeTokenVisionProfiles
} from '../../../packages/scene-vision/src/index.js';
import { useFenixSession } from './session-provider.jsx';

const MODE_LABELS = Object.freeze({
  [TokenVisionMode.NORMAL]: 'Normal',
  [TokenVisionMode.DARKVISION]: 'Visão no escuro',
  [TokenVisionMode.INFRAVISION]: 'Infravisão'
});

function editableProfile(scene, actorId) {
  const fog = normalizeSceneFog(scene?.fog ?? {});
  const profile = normalizeTokenVisionProfile(scene?.visionProfiles?.[actorId] ?? {}, {
    defaultRangeCells: fog.visionRangeCells
  });
  return {
    ...profile,
    personalLight: { ...profile.personalLight }
  };
}

function editableElevation(scene) {
  const normalized = normalizeSceneElevation(scene?.elevation ?? {});
  return {
    ...normalized,
    levels: normalized.levels.map((level) => ({ ...level }))
  };
}

function levelId() {
  return globalThis.crypto?.randomUUID?.()?.slice(0, 18) ?? `level-${Date.now()}`;
}

export function AdvancedVisionEditor({ scene, actorId = null, tokens = [] }) {
  const { isGm, state, updateSceneFog, updateSceneWalls, moveToken } = useFenixSession();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [wallSaving, setWallSaving] = useState(false);
  const [draft, setDraft] = useState(() => editableProfile(scene, actorId));
  const [sceneDraft, setSceneDraft] = useState(() => editableElevation(scene));
  const profileSignature = JSON.stringify(scene?.visionProfiles?.[actorId] ?? {});
  const elevationSignature = JSON.stringify(scene?.elevation ?? {});
  const actor = useMemo(
    () => (Array.isArray(tokens) ? tokens : []).find((token) => token?.id === actorId) ?? null,
    [tokens, actorId]
  );
  const current = useMemo(
    () => normalizeTokenVisionProfile(scene?.visionProfiles?.[actorId] ?? {}, {
      defaultRangeCells: normalizeSceneFog(scene?.fog ?? {}).visionRangeCells
    }),
    [scene?.fog?.visionRangeCells, profileSignature, actorId]
  );
  const sceneElevation = useMemo(() => normalizeSceneElevation(scene?.elevation ?? {}), [elevationSignature]);
  const currentElevation = Number.isFinite(Number(actor?.elevation)) ? Number(actor.elevation) : current.elevation;
  const currentLevel = levelForElevation(sceneElevation, currentElevation);

  useEffect(() => {
    if (!open) {
      setDraft(editableProfile(scene, actorId));
      setSceneDraft(editableElevation(scene));
    }
  }, [scene?.id, actorId, profileSignature, elevationSignature, scene?.fog?.visionRangeCells, open]);

  if (!scene || !actorId) return null;

  function patchPersonalLight(patch) {
    setDraft((value) => ({
      ...value,
      personalLight: { ...value.personalLight, ...patch }
    }));
  }

  function patchLevel(id, patch) {
    setSceneDraft((value) => ({
      ...value,
      levels: value.levels.map((level) => level.id === id ? { ...level, ...patch } : level)
    }));
  }

  function addLevel() {
    setSceneDraft((value) => {
      const last = value.levels[value.levels.length - 1];
      return {
        ...value,
        levels: [...value.levels, {
          id: levelId(),
          name: `Nível ${value.levels.length + 1}`,
          elevation: Number(last?.elevation ?? 0) + Number(value.levelHeight || 3)
        }]
      };
    });
  }

  async function moveVertical(direction) {
    if (!actor || !sceneElevation.enabled || current.movementMode !== TokenMovementMode.FLYING || state.busy) return;
    const step = sceneElevation.verticalStep;
    await moveToken({
      ...actor,
      elevation: currentElevation + direction * step,
      height: current.height,
      movementMode: current.movementMode
    });
  }

  async function save() {
    if (saving || !actorId) return;
    setSaving(true);
    try {
      const fog = normalizeSceneFog(scene.fog ?? {});
      const profiles = normalizeTokenVisionProfiles(scene.visionProfiles ?? {}, {
        defaultRangeCells: fog.visionRangeCells
      });
      const nextProfile = normalizeTokenVisionProfile(draft, {
        defaultRangeCells: fog.visionRangeCells
      });
      const nextElevation = normalizeSceneElevation(sceneDraft);
      const result = await updateSceneFog(scene.id, {
        ...fog,
        visionProfiles: {
          ...profiles,
          [actorId]: nextProfile
        },
        sceneElevation: nextElevation
      });
      if (actor) {
        await moveToken({
          ...actor,
          elevation: nextProfile.elevation,
          height: nextProfile.height,
          movementMode: nextProfile.movementMode
        });
      }
      setDraft(editableProfile(result?.scene ?? scene, actorId));
      setSceneDraft(editableElevation(result?.scene ?? scene));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function applyDefaultWallBand() {
    if (!isGm || wallSaving || !scene?.walls?.length) return;
    setWallSaving(true);
    try {
      const config = normalizeSceneElevation(sceneDraft);
      await updateSceneWalls(scene.id, scene.walls.map((wall) => ({
        ...wall,
        bottomElevation: config.defaultWallBottom,
        topElevation: config.defaultWallTop
      })));
    } finally {
      setWallSaving(false);
    }
  }

  const flightControls = sceneElevation.enabled && current.movementMode === TokenMovementMode.FLYING ? (
    <div className="vertical-flight-controls">
      <button type="button" disabled={!actor || state.busy} onClick={() => void moveVertical(-1)} title="Descer um passo vertical">−Z</button>
      <span>{currentElevation.toFixed(2)} {sceneElevation.unit} · {currentLevel?.name ?? 'nível livre'}</span>
      <button type="button" disabled={!actor || state.busy} onClick={() => void moveVertical(1)} title="Subir um passo vertical">+Z</button>
    </div>
  ) : null;

  if (!isGm) {
    return (
      <div className={`advanced-vision-chip vision-${current.mode} ${flightControls ? 'with-flight' : ''}`}>
        <span>{MODE_LABELS[current.mode]} · {current.rangeCells}c · Z {currentElevation.toFixed(1)}</span>
        {flightControls}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`advanced-vision-button ${open ? 'active' : ''} vision-${current.mode}`}
        onClick={() => setOpen((value) => !value)}
        title="Configurar sentidos, níveis e elevação do personagem selecionado"
      >
        Sentidos · {MODE_LABELS[current.mode]} · Z {currentElevation.toFixed(1)}
      </button>

      {open ? (
        <div className="advanced-vision-panel elevation-panel">
          <div className="advanced-vision-heading">
            <div>
              <strong>Visão e elevação</strong>
              <small>{actor?.name ?? actorId}</small>
            </div>
            <span>{currentLevel?.name ?? 'nível livre'} · Z {currentElevation.toFixed(1)}</span>
          </div>

          <label>Modo de visão
            <select value={draft.mode} onChange={(event) => setDraft((value) => ({ ...value, mode: event.target.value }))}>
              <option value={TokenVisionMode.NORMAL}>Normal</option>
              <option value={TokenVisionMode.DARKVISION}>Visão no escuro</option>
              <option value={TokenVisionMode.INFRAVISION}>Infravisão</option>
            </select>
          </label>

          <div className="advanced-vision-grid">
            <label>Alcance (células)
              <input type="number" min="1" max="60" value={draft.rangeCells} onChange={(event) => setDraft((value) => ({ ...value, rangeCells: event.target.value }))} />
            </label>
            <label>Elevação base / Z
              <input type="number" min="-1000" max="10000" step="0.5" value={draft.elevation} onChange={(event) => setDraft((value) => ({ ...value, elevation: event.target.value }))} />
            </label>
            <label>Altura do corpo
              <input type="number" min="0.2" max="20" step="0.1" value={draft.height} onChange={(event) => setDraft((value) => ({ ...value, height: event.target.value }))} />
            </label>
            <label>Movimento vertical
              <select value={draft.movementMode} onChange={(event) => setDraft((value) => ({ ...value, movementMode: event.target.value }))}>
                <option value={TokenMovementMode.GROUND}>Solo / nível fixo</option>
                <option value={TokenMovementMode.FLYING}>Voo / Z variável</option>
              </select>
            </label>
          </div>

          {flightControls}

          <label className="advanced-vision-toggle">
            <input type="checkbox" checked={draft.personalLight.enabled} onChange={(event) => patchPersonalLight({ enabled: event.target.checked })} />
            Fonte de luz pessoal anexada ao token
          </label>

          {draft.personalLight.enabled ? (
            <div className="advanced-vision-grid">
              <label>Raio da luz
                <input type="number" min="1" max="60" value={draft.personalLight.radiusCells} onChange={(event) => patchPersonalLight({ radiusCells: event.target.value })} />
              </label>
              <label>Intensidade
                <input type="number" min="0.1" max="1" step="0.1" value={draft.personalLight.intensity} onChange={(event) => patchPersonalLight({ intensity: event.target.value })} />
              </label>
              <label>Cor
                <input type="color" value={draft.personalLight.color} onChange={(event) => patchPersonalLight({ color: event.target.value })} />
              </label>
            </div>
          ) : null}

          <div className="elevation-section">
            <div className="elevation-section-heading">
              <div><strong>Níveis da cena</strong><small>2.5D · pontes, mezaninos, voo</small></div>
              <label className="advanced-vision-toggle"><input type="checkbox" checked={sceneDraft.enabled} onChange={(event) => setSceneDraft((value) => ({ ...value, enabled: event.target.checked }))} /> Ativo</label>
            </div>
            <div className="advanced-vision-grid">
              <label>Altura entre níveis
                <input type="number" min="0.5" max="100" step="0.5" value={sceneDraft.levelHeight} onChange={(event) => setSceneDraft((value) => ({ ...value, levelHeight: event.target.value }))} />
              </label>
              <label>Passo de voo
                <input type="number" min="0.25" step="0.25" value={sceneDraft.verticalStep} onChange={(event) => setSceneDraft((value) => ({ ...value, verticalStep: event.target.value }))} />
              </label>
              <label>Parede padrão · base
                <input type="number" step="0.5" value={sceneDraft.defaultWallBottom} onChange={(event) => setSceneDraft((value) => ({ ...value, defaultWallBottom: event.target.value }))} />
              </label>
              <label>Parede padrão · topo
                <input type="number" step="0.5" value={sceneDraft.defaultWallTop} onChange={(event) => setSceneDraft((value) => ({ ...value, defaultWallTop: event.target.value }))} />
              </label>
            </div>

            <div className="elevation-level-list">
              {sceneDraft.levels.map((level) => (
                <div className="elevation-level-row" key={level.id}>
                  <input aria-label="Nome do nível" value={level.name} onChange={(event) => patchLevel(level.id, { name: event.target.value })} />
                  <input aria-label="Elevação do nível" type="number" step="0.5" value={level.elevation} onChange={(event) => patchLevel(level.id, { elevation: event.target.value })} />
                  <button type="button" disabled={sceneDraft.levels.length <= 1} onClick={() => setSceneDraft((value) => ({ ...value, levels: value.levels.filter((item) => item.id !== level.id) }))}>×</button>
                </div>
              ))}
            </div>
            <div className="elevation-tools">
              <button type="button" onClick={addLevel}>+ Nível</button>
              <button type="button" disabled={!scene.walls?.length || wallSaving} onClick={() => void applyDefaultWallBand()}>{wallSaving ? 'Aplicando…' : 'Aplicar faixa padrão às paredes'}</button>
            </div>
          </div>

          <small className="advanced-vision-help">
            Com 2.5D ativo, paredes só bloqueiam movimento, visão e luz quando a altura do token/raio cruza a faixa vertical da barreira. Para uma ponte, use um nível elevado para quem está sobre ela e paredes/guarda-corpos nessa mesma faixa. Paredes legadas continuam infinitas até você aplicar uma faixa finita explicitamente.
          </small>

          <div className="advanced-vision-actions">
            <button type="button" onClick={() => { setDraft(editableProfile(scene, actorId)); setSceneDraft(editableElevation(scene)); setOpen(false); }}>Cancelar</button>
            <button type="button" className="primary-button" disabled={saving || state.busy} onClick={save}>{saving ? 'Salvando…' : 'Salvar sentidos e níveis'}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
