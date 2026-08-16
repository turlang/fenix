'use client';

import { useEffect, useMemo, useState } from 'react';
import { createFenixApiClient } from '../lib/fenix-api-client.js';
import { useFenixSession } from './session-provider.jsx';

const SENSES = [
  ['normal', 'Visão normal'],
  ['darkvision', 'Visão no escuro'],
  ['low-light', 'Baixa luminosidade'],
  ['blindsight', 'Percepção sem visão'],
  ['tremorsense', 'Sentido sísmico']
];

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function distance(entry) {
  return numeric(typeof entry === 'number' ? entry : entry?.distance, 0);
}

function actorDraft(actor, token) {
  const sheet = actor?.sheet ?? {};
  const movement = sheet.movement ?? actor?.resolved?.movement ?? {};
  const vision = sheet.vision ?? actor?.resolved?.vision ?? token?.vision ?? {};
  return {
    name: actor?.name ?? token?.name ?? token?.actorId ?? token?.id ?? 'Personagem',
    kind: actor?.kind ?? token?.entityType ?? 'character',
    sheetId: actor?.sheetId ?? token?.sheetId ?? '',
    systemId: actor?.systemId ?? token?.systemId ?? 'generic',
    height: numeric(sheet.height ?? token?.height, 1.8),
    eyeHeight: numeric(vision.eyeHeight, 1.6),
    preferredSense: vision.preferredSense ?? 'normal',
    walk: distance(movement.speeds?.walk),
    swim: distance(movement.speeds?.swim),
    fly: distance(movement.speeds?.fly),
    senses: Object.fromEntries(SENSES.map(([key]) => [key, distance(vision.senses?.[key])])),
    attributes: { ...(sheet.attributes ?? {}) },
    conditions: [...(Array.isArray(sheet.conditions) ? sheet.conditions : [])],
    metadata: { ...(sheet.metadata ?? {}) }
  };
}

function actorPayload(draft) {
  const senses = Object.fromEntries(SENSES.map(([key]) => [key, {
    distance: Math.max(0, numeric(draft.senses[key], 0)),
    unit: 'm',
    enabled: numeric(draft.senses[key], 0) > 0
  }]));
  return {
    name: draft.name,
    sheetId: draft.sheetId || undefined,
    systemId: draft.systemId || 'generic',
    kind: draft.kind === 'npc' ? 'npc' : 'character',
    sheet: {
      height: Math.max(0.2, numeric(draft.height, 1.8)),
      movement: {
        defaultMode: 'walk',
        speeds: {
          walk: { distance: Math.max(0, numeric(draft.walk, 0)), unit: 'm' },
          swim: { distance: Math.max(0, numeric(draft.swim, 0)), unit: 'm' },
          fly: { distance: Math.max(0, numeric(draft.fly, 0)), unit: 'm' }
        }
      },
      vision: {
        enabled: true,
        eyeHeight: Math.max(0.1, numeric(draft.eyeHeight, 1.6)),
        preferredSense: draft.preferredSense,
        senses
      },
      attributes: draft.attributes,
      conditions: draft.conditions,
      metadata: draft.metadata
    }
  };
}

export function ActorSheetInspector({ token, onApplied = null }) {
  const { campaign, isGm, refreshActors } = useFenixSession();
  const client = useMemo(() => createFenixApiClient(), []);
  const actorId = String(token?.actorId ?? token?.id ?? '').trim();
  const [actor, setActor] = useState(null);
  const [draft, setDraft] = useState(() => actorDraft(null, token));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setStatus(null);
    client.getActor(campaign.id, actorId).then((result) => {
      if (!mounted) return;
      setActor(result.actor);
      setDraft(actorDraft(result.actor, token));
    }).catch((error) => {
      if (!mounted) return;
      if (error?.code === 'CAMPAIGN_ACTOR_NOT_FOUND' && isGm) {
        setActor(null);
        setDraft(actorDraft(null, token));
      } else {
        setStatus(error?.message ?? 'Não foi possível carregar a ficha.');
      }
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [actorId, campaign.id, client, isGm, token]);

  function field(name, value) {
    setStatus(null);
    setDraft((current) => ({ ...current, [name]: value }));
  }

  function sense(name, value) {
    setStatus(null);
    setDraft((current) => ({ ...current, senses: { ...current.senses, [name]: value } }));
  }

  async function save() {
    if (!isGm || saving) return;
    setSaving(true);
    setStatus(null);
    try {
      const result = await client.upsertActor(campaign.id, actorId, actorPayload(draft));
      setActor(result.actor);
      setDraft(actorDraft(result.actor, token));
      await refreshActors?.();
      setStatus('Ficha salva e reaplicada ao token.');
      await onApplied?.(result.actor);
    } catch (error) {
      setStatus(error?.message ?? 'Não foi possível salvar a ficha.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="actor-sheet-state">Carregando ficha…</div>;

  return (
    <div className="actor-sheet-editor">
      {!actor && isGm ? <p className="actor-sheet-callout">Dados legados detectados. Salvar cria uma ficha persistente para esta entidade.</p> : null}
      <div className="actor-sheet-grid two-columns">
        <label>Nome<input value={draft.name} disabled={!isGm} onChange={(event) => field('name', event.target.value)} /></label>
        <label>Tipo<select value={draft.kind} disabled={!isGm} onChange={(event) => field('kind', event.target.value)}><option value="character">Personagem</option><option value="npc">NPC</option></select></label>
        <label>Altura corporal (m)<input type="number" min="0.2" max="20" step="0.05" value={draft.height} disabled={!isGm} onChange={(event) => field('height', event.target.value)} /></label>
      </div>

      <section className="actor-sheet-section">
        <strong>Deslocamento</strong>
        <div className="actor-sheet-grid three-columns">
          <label>Caminhada (m)<input type="number" min="0" step="0.5" value={draft.walk} disabled={!isGm} onChange={(event) => field('walk', event.target.value)} /></label>
          <label>Natação (m)<input type="number" min="0" step="0.5" value={draft.swim} disabled={!isGm} onChange={(event) => field('swim', event.target.value)} /></label>
          <label>Voo (m)<input type="number" min="0" step="0.5" value={draft.fly} disabled={!isGm} onChange={(event) => field('fly', event.target.value)} /></label>
        </div>
      </section>

      <section className="actor-sheet-section">
        <strong>Visão e sentidos</strong>
        <div className="actor-sheet-grid two-columns">
          <label>Altura dos olhos (m)<input type="number" min="0.1" max="20" step="0.05" value={draft.eyeHeight} disabled={!isGm} onChange={(event) => field('eyeHeight', event.target.value)} /></label>
          <label>Sentido preferido<select value={draft.preferredSense} disabled={!isGm} onChange={(event) => field('preferredSense', event.target.value)}>{SENSES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {SENSES.map(([key, label]) => <label key={key}>{label} (m)<input type="number" min="0" step="0.5" value={draft.senses[key]} disabled={!isGm} onChange={(event) => sense(key, event.target.value)} /></label>)}
        </div>
      </section>

      <details className="actor-sheet-technical"><summary>Identidade técnica</summary><small>{actorId} · {draft.sheetId || `sheet-${actorId}`} · {draft.systemId}</small></details>
      {status ? <div className="actor-sheet-state">{status}</div> : null}
      {isGm ? <button type="button" className="primary-button actor-sheet-save" disabled={saving} onClick={save}>{saving ? 'Salvando…' : 'Salvar ficha'}</button> : <p className="context-inspector-note">Ficha em modo de leitura. Alterações são controladas pelo Mestre.</p>}
    </div>
  );
}
