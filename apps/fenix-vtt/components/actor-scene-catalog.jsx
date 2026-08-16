'use client';

import { useMemo, useState } from 'react';

function actorToken(tokens, actorId) {
  return (Array.isArray(tokens) ? tokens : []).find((token) => (token.actorId ?? token.id) === actorId) ?? null;
}

function distanceLabel(entry) {
  const value = Number(typeof entry === 'number' ? entry : entry?.distance);
  return Number.isFinite(value) && value > 0 ? `${Math.round(value * 10) / 10} m` : '—';
}

function hpLabel(actor) {
  const hp = actor?.sheet?.attributes?.hp;
  if (hp && typeof hp === 'object') {
    const current = Number(hp.current ?? hp.value);
    const max = Number(hp.max);
    if (Number.isFinite(current) && Number.isFinite(max)) return `${current} / ${max}`;
    if (Number.isFinite(current)) return String(current);
  }
  const direct = Number(hp);
  return Number.isFinite(direct) ? String(direct) : null;
}

function roleLabel(actor) {
  return actor?.kind === 'npc' ? 'NPC' : 'Personagem';
}

export function ActorSceneCatalog({
  actors = [],
  tokens = [],
  selectedActorId = null,
  membershipActorId = null,
  isGm = false,
  busy = false,
  hasActiveScene = false,
  onSelect = null,
  onCreate = null,
  onPlace = null
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [placingActorId, setPlacingActorId] = useState(null);
  const [status, setStatus] = useState(null);
  const visibleActors = useMemo(
    () => isGm ? actors : actors.filter((actor) => actor.id === membershipActorId),
    [actors, isGm, membershipActorId]
  );

  async function handleCreate(event) {
    event.preventDefault();
    if (!isGm || creating || busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    if (!name) return;
    setCreating(true);
    setStatus(null);
    try {
      const actor = await onCreate?.({
        name,
        kind: String(form.get('kind') ?? 'character') === 'npc' ? 'npc' : 'character'
      });
      event.currentTarget.reset();
      setCreateOpen(false);
      if (actor?.id) onSelect?.(actor.id);
    } catch (error) {
      setStatus(error?.message ?? 'Não foi possível criar o ator.');
    } finally {
      setCreating(false);
    }
  }

  async function handlePlace(actorId) {
    if (!isGm || busy || placingActorId) return;
    setPlacingActorId(actorId);
    setStatus(null);
    try {
      await onPlace?.(actorId);
      onSelect?.(actorId);
    } catch (error) {
      setStatus(error?.message ?? 'Não foi possível colocar o token na cena.');
    } finally {
      setPlacingActorId(null);
    }
  }

  return (
    <section className="actor-catalog" aria-label="Atores da campanha">
      <div className="actor-catalog-toolbar">
        <span>{visibleActors.length} {visibleActors.length === 1 ? 'entidade' : 'entidades'}</span>
        {isGm ? (
          <button type="button" className="actor-catalog-add" onClick={() => { setCreateOpen((value) => !value); setStatus(null); }}>
            {createOpen ? 'Fechar' : '+ Ator'}
          </button>
        ) : null}
      </div>

      {isGm && createOpen ? (
        <form className="actor-create-form" onSubmit={handleCreate}>
          <label>Nome<input name="name" minLength={2} maxLength={160} placeholder="Ex.: Seraphina" autoFocus required /></label>
          <label>Tipo<select name="kind" defaultValue="character"><option value="character">Personagem</option><option value="npc">NPC</option></select></label>
          <button type="submit" className="primary-button" disabled={creating || busy}>{creating ? 'Criando…' : 'Criar ficha'}</button>
          <small>A ficha nasce com o sistema da campanha e pode ser refinada pelo inspector do token.</small>
        </form>
      ) : null}

      <div className="actor-stack real-actor-stack">
        {visibleActors.length ? visibleActors.map((actor) => {
          const token = actorToken(tokens, actor.id);
          const selectable = isGm || actor.id === membershipActorId;
          const walk = actor?.resolved?.movement?.speeds?.walk ?? actor?.sheet?.movement?.speeds?.walk;
          const senseName = actor?.resolved?.vision?.preferredSense ?? actor?.sheet?.vision?.preferredSense ?? 'normal';
          const sense = actor?.resolved?.vision?.senses?.[senseName] ?? actor?.sheet?.vision?.senses?.[senseName];
          const hp = hpLabel(actor);
          return (
            <div className={`actor-catalog-row ${token ? 'in-scene' : ''}`} key={actor.id}>
              <button
                type="button"
                className={`actor-card ${selectedActorId === actor.id ? 'selected' : ''}`}
                disabled={!selectable}
                onClick={() => onSelect?.(actor.id)}
              >
                <div className="actor-avatar">{String(actor.name || actor.id).slice(0, 1).toUpperCase()}</div>
                <div className="actor-copy">
                  <strong>{actor.name || actor.id}</strong>
                  <small>{roleLabel(actor)} · mov. {distanceLabel(walk)} · visão {distanceLabel(sense)}</small>
                </div>
                <span className="actor-hp">{hp ?? (token ? 'Na cena' : 'Fora')}</span>
              </button>
              {isGm ? (
                <button
                  type="button"
                  className={`actor-scene-action ${token ? 'present' : ''}`}
                  disabled={Boolean(token) || busy || !hasActiveScene || placingActorId === actor.id}
                  onClick={() => handlePlace(actor.id)}
                  title={!hasActiveScene ? 'Crie ou ative um mapa antes de colocar tokens.' : token ? 'Token já associado a este ator.' : 'Criar token e associar à ficha deste ator.'}
                >
                  {placingActorId === actor.id ? 'Colocando…' : token ? 'Na cena' : 'Colocar'}
                </button>
              ) : null}
            </div>
          );
        }) : (
          <div className="actor-catalog-empty">
            <strong>{isGm ? 'Nenhum ator cadastrado' : 'Sua ficha ainda não foi criada'}</strong>
            <small>{isGm ? 'Crie o primeiro personagem ou NPC. O VTT não depende mais de personagens demo.' : 'Peça ao Mestre para criar e associar sua ficha.'}</small>
          </div>
        )}
      </div>

      {isGm && visibleActors.length && !hasActiveScene ? <small className="actor-catalog-hint">Crie ou ative um mapa para colocar tokens na mesa.</small> : null}
      {status ? <div className="actor-catalog-status" role="status">{status}</div> : null}
    </section>
  );
}
