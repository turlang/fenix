'use client';

import { useEffect, useMemo, useState } from 'react';
import { normalizeSceneElevation } from '../../../packages/scene-elevation/src/index.js';
import { normalizeSceneScale } from '../../../packages/scene-scale/src/index.js';

function cloneElevation(scene) {
  const normalized = normalizeSceneElevation(scene?.elevation ?? {});
  return {
    ...normalized,
    levels: normalized.levels.map((level) => ({ ...level }))
  };
}

function nextLevelId(levels) {
  let index = levels.length + 1;
  while (levels.some((level) => level.id === `level-${index}`)) index += 1;
  return `level-${index}`;
}

export function SceneSettingsInspector({
  scene,
  active = false,
  busy = false,
  onClose,
  onActivate,
  onUpdateElevation,
  onOpenMapTool = null
}) {
  const [draft, setDraft] = useState(() => cloneElevation(scene));
  const [saving, setSaving] = useState(false);
  const scale = useMemo(() => normalizeSceneScale(scene?.scale ?? {}), [scene?.scale]);

  useEffect(() => {
    setDraft(cloneElevation(scene));
  }, [scene?.id, scene?.elevation]);

  if (!scene) return null;

  async function saveElevation() {
    if (!onUpdateElevation || saving || busy) return;
    setSaving(true);
    try {
      const result = await onUpdateElevation(scene.id, draft);
      setDraft(cloneElevation(result?.scene ?? scene));
    } finally {
      setSaving(false);
    }
  }

  function updateLevel(index, patch) {
    setDraft((current) => ({
      ...current,
      levels: current.levels.map((level, levelIndex) => levelIndex === index ? { ...level, ...patch } : level)
    }));
  }

  function addLevel() {
    setDraft((current) => {
      const id = nextLevelId(current.levels);
      const last = current.levels[current.levels.length - 1];
      return {
        ...current,
        levels: [...current.levels, {
          id,
          name: `Nível ${current.levels.length + 1}`,
          elevation: Number(last?.elevation ?? 0) + Number(current.levelHeight || 3)
        }]
      };
    });
  }

  function removeLevel(index) {
    setDraft((current) => ({
      ...current,
      levels: current.levels.length <= 1
        ? current.levels
        : current.levels.filter((_, levelIndex) => levelIndex !== index)
    }));
  }

  return (
    <aside className="map-context-inspector scene-settings-inspector" aria-label={`Configurações da cena ${scene.name}`}>
      <div className="map-context-inspector-heading">
        <div>
          <span className="eyebrow">Mapa / Cena</span>
          <strong>{scene.name}</strong>
          <small>{active ? 'Cena ativa' : 'Cena da campanha'}</small>
        </div>
        <button type="button" className="context-close-button" onClick={onClose} aria-label="Fechar configurações">×</button>
      </div>

      <div className="context-inspector-section">
        <span className="eyebrow">Ambiente físico</span>
        <dl className="context-definition-list">
          <div><dt>Dimensões</dt><dd>{scene.width} × {scene.height}px</dd></div>
          <div><dt>Grade</dt><dd>{Number(scene.grid?.size) || 70}px</dd></div>
          <div><dt>Escala</dt><dd>1 célula = {scale.distancePerCell} {scale.unit}</dd></div>
          <div><dt>Paredes/portas</dt><dd>{(scene.walls ?? []).length}</dd></div>
          <div><dt>Regiões</dt><dd>{(scene.regions ?? []).length}</dd></div>
          <div><dt>Fog</dt><dd>{scene.fog?.enabled ? 'Ativo' : 'Desligado'}</dd></div>
          <div><dt>Luz</dt><dd>{scene.lighting?.enabled ? 'Ativa' : 'Desligada'}</dd></div>
        </dl>
      </div>

      <div className="scene-physical-settings">
        <div className="scene-physical-heading">
          <div><span className="eyebrow">Altura / níveis</span><strong>Espaço 2.5D</strong></div>
          <label className="scene-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /> Ativo</label>
        </div>

        <div className="scene-physical-grid">
          <label>Altura por nível<input type="number" min="0.5" max="100" step="0.25" value={draft.levelHeight} onChange={(event) => setDraft((current) => ({ ...current, levelHeight: event.target.value }))} /><span>{draft.unit}</span></label>
          <label>Passo vertical<input type="number" min="0.25" max={Math.max(0.25, Number(draft.levelHeight) || 3)} step="0.25" value={draft.verticalStep} onChange={(event) => setDraft((current) => ({ ...current, verticalStep: event.target.value }))} /><span>{draft.unit}</span></label>
          <label>Parede: base<input type="number" step="0.25" value={draft.defaultWallBottom} onChange={(event) => setDraft((current) => ({ ...current, defaultWallBottom: event.target.value }))} /><span>{draft.unit}</span></label>
          <label>Parede: topo<input type="number" step="0.25" value={draft.defaultWallTop} onChange={(event) => setDraft((current) => ({ ...current, defaultWallTop: event.target.value }))} /><span>{draft.unit}</span></label>
        </div>

        <div className="scene-level-list">
          <div className="scene-level-list-heading"><span>Níveis</span><button type="button" onClick={addLevel}>+ Nível</button></div>
          {draft.levels.map((level, index) => (
            <div className="scene-level-row" key={level.id}>
              <input aria-label={`Nome do nível ${index + 1}`} value={level.name} onChange={(event) => updateLevel(index, { name: event.target.value })} />
              <input aria-label={`Elevação do nível ${index + 1}`} type="number" step="0.25" value={level.elevation} onChange={(event) => updateLevel(index, { elevation: event.target.value })} />
              <span>{draft.unit}</span>
              <button type="button" disabled={draft.levels.length <= 1} onClick={() => removeLevel(index)} aria-label={`Remover ${level.name}`}>×</button>
            </div>
          ))}
        </div>

        <button type="button" className="primary-button context-inspector-primary" disabled={saving || busy} onClick={saveElevation}>
          {saving ? 'Salvando…' : 'Salvar altura e níveis'}
        </button>
      </div>

      {active && onOpenMapTool ? (
        <div className="context-inspector-actions">
          <button type="button" onClick={() => onOpenMapTool('grid')}>Grade e escala</button>
          <button type="button" onClick={() => onOpenMapTool('walls')}>Paredes e portas</button>
          <button type="button" onClick={() => onOpenMapTool('regions')}>Pisos / escadas</button>
          <button type="button" onClick={() => onOpenMapTool('fog')}>Fog / visão</button>
        </div>
      ) : !active ? (
        <button type="button" className="primary-button context-inspector-primary" disabled={busy} onClick={() => onActivate?.(scene.id)}>
          Ativar cena para editar no mapa
        </button>
      ) : null}

      <p className="context-inspector-note">Use “Configurar” na lista de cenas para reabrir estas opções a qualquer momento. Botão direito também abre o objeto no contexto. Dados de personagem continuam fora da cena; visão e movimento vêm da ficha + sistema de RPG.</p>
    </aside>
  );
}
