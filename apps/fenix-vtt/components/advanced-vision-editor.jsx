'use client';

import { useEffect, useMemo, useState } from 'react';
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

export function AdvancedVisionEditor({ scene, actorId = null, tokens = [] }) {
  const { isGm, state, updateSceneFog } = useFenixSession();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => editableProfile(scene, actorId));
  const profileSignature = JSON.stringify(scene?.visionProfiles?.[actorId] ?? {});
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

  useEffect(() => {
    if (!open) setDraft(editableProfile(scene, actorId));
  }, [scene?.id, actorId, profileSignature, scene?.fog?.visionRangeCells, open]);

  if (!scene || !actorId) return null;

  if (!isGm) {
    return (
      <div className={`advanced-vision-chip vision-${current.mode}`}>
        {MODE_LABELS[current.mode]} · {current.rangeCells}c
      </div>
    );
  }

  function patchPersonalLight(patch) {
    setDraft((value) => ({
      ...value,
      personalLight: { ...value.personalLight, ...patch }
    }));
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
      const result = await updateSceneFog(scene.id, {
        ...fog,
        visionProfiles: {
          ...profiles,
          [actorId]: nextProfile
        }
      });
      setDraft(editableProfile(result?.scene ?? scene, actorId));
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`advanced-vision-button ${open ? 'active' : ''} vision-${current.mode}`}
        onClick={() => setOpen((value) => !value)}
        title="Configurar sentidos do personagem selecionado"
      >
        Sentidos · {MODE_LABELS[current.mode]}
      </button>

      {open ? (
        <div className="advanced-vision-panel">
          <div className="advanced-vision-heading">
            <div>
              <strong>Visão do personagem</strong>
              <small>{actor?.name ?? actorId}</small>
            </div>
            <span>{current.rangeCells} células</span>
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
            <label>Elevação / Z
              <input type="number" min="-1000" max="10000" step="0.5" value={draft.elevation} onChange={(event) => setDraft((value) => ({ ...value, elevation: event.target.value }))} />
            </label>
          </div>

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

          <small className="advanced-vision-help">
            Visão normal depende da iluminação. Visão no escuro e infravisão reduzem a escuridão dentro do LOS, mas paredes e portas continuam bloqueando. Elevação já é persistida para o próximo motor 3D/Z; ainda não altera a oclusão neste marco.
          </small>

          <div className="advanced-vision-actions">
            <button type="button" onClick={() => { setDraft(editableProfile(scene, actorId)); setOpen(false); }}>Cancelar</button>
            <button type="button" className="primary-button" disabled={saving || state.busy} onClick={save}>{saving ? 'Salvando…' : 'Salvar sentidos'}</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
