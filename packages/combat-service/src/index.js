const ACTION_TYPES = new Set(['ACTION', 'BONUS_ACTION', 'REACTION', 'MOVEMENT', 'FREE_ACTION']);

function text(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function id(value, limit = 200) {
  return text(value, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeActionEconomy(value) {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (normalized === 'BONUS' || normalized === 'BONUS_ACTION' || normalized === 'ACAO_BONUS') return 'BONUS_ACTION';
  if (normalized === 'REACTION' || normalized === 'REACAO') return 'REACTION';
  if (normalized === 'MOVE' || normalized === 'MOVEMENT' || normalized === 'MOVIMENTO') return 'MOVEMENT';
  if (normalized === 'FREE' || normalized === 'FREE_ACTION' || normalized === 'ACAO_LIVRE') return 'FREE_ACTION';
  return ACTION_TYPES.has(normalized) ? normalized : 'ACTION';
}

function normalizeCombatant(value = {}) {
  const actorId = id(value.actorId ?? value.actor?.id);
  const combatantId = id(value.id ?? value.combatantId);
  if (!combatantId) return null;
  return {
    id: combatantId,
    actorId: actorId || null,
    tokenId: id(value.tokenId ?? value.token?.id) || null,
    name: text(value.name ?? value.actorName ?? value.tokenName, 300) || 'Combatente',
    initiative: finiteNumber(value.initiative),
    defeated: Boolean(value.defeated),
    hidden: Boolean(value.hidden),
    disposition: finiteNumber(value.disposition),
    isNpc: Boolean(value.isNpc ?? String(value.actorType ?? '').toLowerCase() === 'npc')
  };
}

export function normalizeCombatSnapshot(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const combatants = (Array.isArray(source.combatants) ? source.combatants : [])
    .map(normalizeCombatant)
    .filter(Boolean);
  const activeSource = source.activeCombatant && typeof source.activeCombatant === 'object'
    ? source.activeCombatant
    : combatants.find((entry) => entry.id === id(source.currentCombatantId));
  const activeCombatant = activeSource ? normalizeCombatant(activeSource) : null;
  const combatId = id(source.id ?? source.combatId);
  const round = Math.max(0, Number(source.round) || 0);
  const turn = Number.isInteger(Number(source.turn)) ? Math.max(0, Number(source.turn)) : null;
  const started = Boolean(source.started ?? source.active ?? (combatId && round > 0));
  return {
    id: combatId || null,
    sceneId: id(source.sceneId ?? source.scene?.id) || null,
    round,
    turn,
    started: Boolean(combatId && started),
    activeCombatant,
    combatants,
    updatedAt: new Date().toISOString()
  };
}

export function combatTurnKey(input = {}) {
  const snapshot = input.activeCombatant || input.combatants
    ? normalizeCombatSnapshot(input)
    : input;
  const combatId = id(snapshot?.id ?? snapshot?.combatId) || 'combat';
  const round = Math.max(0, Number(snapshot?.round) || 0);
  const turn = Number.isInteger(Number(snapshot?.turn)) ? Math.max(0, Number(snapshot.turn)) : 0;
  const combatantId = id(snapshot?.activeCombatant?.id ?? snapshot?.combatantId) || 'unknown';
  return `${combatId}:r${round}:t${turn}:${combatantId}`;
}

function normalizeRoll(value = {}) {
  const source = value && typeof value === 'object' ? value : {};
  const total = finiteNumber(source.total);
  const damageTotal = finiteNumber(source.damageTotal ?? source.damage);
  const outcome = text(source.outcome, 80).toUpperCase() || null;
  const allowedOutcome = new Set(['HIT', 'MISS', 'CRITICAL', 'FUMBLE', 'SUCCESS', 'FAILURE', 'UNKNOWN']);
  return {
    total,
    formula: text(source.formula, 300) || null,
    damageTotal,
    damageType: text(source.damageType, 100) || null,
    outcome: allowedOutcome.has(outcome) ? outcome : null,
    authoritative: Boolean(source.authoritative)
  };
}

export function normalizeCombatAction(value = {}) {
  const actorId = id(value.actorId);
  const content = text(value.content ?? value.description);
  if (!actorId) throw new Error('A ação de combate precisa estar vinculada a um personagem.');
  if (!content) throw new Error('Ação de combate vazia.');
  return {
    id: id(value.id ?? value.eventId) || crypto.randomUUID(),
    eventId: id(value.eventId, 300) || null,
    actorId,
    actorName: text(value.actorName, 300) || null,
    tokenId: id(value.tokenId) || null,
    combatantId: id(value.combatantId) || null,
    economyType: normalizeActionEconomy(value.economyType),
    content,
    itemId: id(value.itemId) || null,
    itemName: text(value.itemName, 300) || null,
    targetIds: [...new Set((Array.isArray(value.targetIds) ? value.targetIds : []).map((entry) => id(entry)).filter(Boolean))].slice(0, 30),
    source: text(value.source, 80).toUpperCase() || 'CHAT_DECLARATION',
    roll: normalizeRoll(value.roll),
    declaredAt: value.declaredAt || new Date().toISOString()
  };
}

function turnReference(value = {}, fallback = null) {
  const source = value && typeof value === 'object' ? value : {};
  const base = fallback ?? {};
  return {
    combatId: id(source.combatId ?? source.id ?? base.id),
    round: Math.max(0, Number(source.round ?? base.round) || 0),
    turn: Number.isInteger(Number(source.turn ?? base.turn)) ? Math.max(0, Number(source.turn ?? base.turn)) : 0,
    combatantId: id(source.combatantId ?? source.activeCombatant?.id ?? base.activeCombatant?.id),
    actorId: id(source.actorId ?? source.activeCombatant?.actorId ?? base.activeCombatant?.actorId) || null,
    actorName: text(source.actorName ?? source.activeCombatant?.name ?? base.activeCombatant?.name, 300) || null
  };
}

function keyFromReference(reference) {
  return `${reference.combatId || 'combat'}:r${reference.round}:t${reference.turn}:${reference.combatantId || 'unknown'}`;
}

export class CombatService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.reset();
  }

  reset() {
    this.snapshot = null;
    this.turns = new Map();
    this.roundSummaries = new Map();
    this.reactionUsage = new Set();
  }

  sync(input = {}) {
    const next = normalizeCombatSnapshot(input);
    if (!next.id || !next.started) {
      this.reset();
      return this.status();
    }
    if (this.snapshot?.id && this.snapshot.id !== next.id) this.reset();
    this.snapshot = next;
    const reference = turnReference({}, next);
    const key = keyFromReference(reference);
    if (!this.turns.has(key)) {
      this.turns.set(key, {
        key,
        ...reference,
        combatant: next.activeCombatant ? { ...next.activeCombatant } : null,
        actionsBySlot: new Map(),
        resolved: false,
        resolution: null,
        openedAt: new Date().toISOString()
      });
    }
    return this.status();
  }

  ensureActive() {
    if (!this.snapshot?.started || !this.snapshot?.id) throw new Error('Nenhum combate ativo foi sincronizado.');
    return this.snapshot;
  }

  getTurn(referenceInput = {}) {
    const snapshot = this.ensureActive();
    const reference = turnReference(referenceInput, snapshot);
    const key = keyFromReference(reference);
    return this.turns.get(key) ?? null;
  }

  ensureTurn(referenceInput = {}) {
    const snapshot = this.ensureActive();
    const reference = turnReference(referenceInput, snapshot);
    const key = keyFromReference(reference);
    let turn = this.turns.get(key);
    if (!turn) {
      const combatant = snapshot.combatants.find((entry) => entry.id === reference.combatantId)
        ?? (snapshot.activeCombatant?.id === reference.combatantId ? snapshot.activeCombatant : null);
      turn = {
        key,
        ...reference,
        actorId: reference.actorId || combatant?.actorId || null,
        actorName: reference.actorName || combatant?.name || null,
        combatant: combatant ? { ...combatant } : null,
        actionsBySlot: new Map(),
        resolved: false,
        resolution: null,
        openedAt: new Date().toISOString()
      };
      this.turns.set(key, turn);
    }
    return turn;
  }

  registerAction(input = {}) {
    const snapshot = this.ensureActive();
    const action = normalizeCombatAction(input);
    const requestedCombatId = id(input.combatId);
    const requestedRound = Number.isFinite(Number(input.round)) ? Math.max(0, Number(input.round)) : snapshot.round;
    const requestedTurn = Number.isInteger(Number(input.turn)) ? Math.max(0, Number(input.turn)) : snapshot.turn;
    if (requestedCombatId && requestedCombatId !== snapshot.id) throw new Error('A ação não pertence ao combate ativo.');
    if (requestedRound !== snapshot.round || requestedTurn !== snapshot.turn) throw new Error('A ação não pertence ao turno ativo.');

    const reference = turnReference({}, snapshot);
    const turn = this.ensureTurn(reference);
    if (turn.resolved) throw new Error('Este turno já foi resolvido.');

    const knownActor = snapshot.combatants.some((entry) => entry.actorId && entry.actorId === action.actorId);
    if (!knownActor) throw new Error('O personagem não pertence ao combate ativo.');
    const activeActorId = turn.actorId || turn.combatant?.actorId || null;
    if (action.economyType !== 'REACTION' && activeActorId && action.actorId !== activeActorId) {
      throw new Error(`Somente ${turn.actorName ?? 'o combatente ativo'} pode usar ação, bônus ou movimento neste turno.`);
    }
    if (action.economyType === 'REACTION') {
      const reactionKey = `${reference.combatId}:r${reference.round}:${action.actorId}`;
      const sameTurnSlot = `${action.actorId}:REACTION`;
      if (this.reactionUsage.has(reactionKey) && !turn.actionsBySlot.has(sameTurnSlot)) {
        throw new Error('Este personagem já utilizou a reação nesta rodada.');
      }
      this.reactionUsage.add(reactionKey);
    }

    const slot = `${action.actorId}:${action.economyType}`;
    const previous = turn.actionsBySlot.get(slot) ?? null;
    turn.actionsBySlot.set(slot, action);
    return {
      queued: true,
      replaced: Boolean(previous),
      action,
      combat: this.status(),
      turn: this.turnStatus(turn)
    };
  }

  turnStatus(turn = this.getTurn()) {
    if (!turn) return null;
    const actions = [...turn.actionsBySlot.values()];
    return {
      key: turn.key,
      combatId: turn.combatId,
      round: turn.round,
      turn: turn.turn,
      combatantId: turn.combatantId,
      actorId: turn.actorId,
      actorName: turn.actorName,
      openedAt: turn.openedAt,
      resolved: Boolean(turn.resolved),
      actionCount: actions.length,
      actions: actions.map((entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        actorName: entry.actorName,
        economyType: entry.economyType,
        itemName: entry.itemName,
        source: entry.source,
        declaredAt: entry.declaredAt
      })),
      canResolve: !turn.resolved && actions.length > 0
    };
  }

  actionsForTurn(referenceInput = {}) {
    const turn = this.getTurn(referenceInput);
    if (!turn) return [];
    const order = { MOVEMENT: 0, ACTION: 1, BONUS_ACTION: 2, FREE_ACTION: 3, REACTION: 4 };
    return [...turn.actionsBySlot.values()].sort((left, right) => {
      const economyOrder = (order[left.economyType] ?? 99) - (order[right.economyType] ?? 99);
      if (economyOrder !== 0) return economyOrder;
      return left.declaredAt.localeCompare(right.declaredAt);
    });
  }

  markTurnResolved(referenceInput = {}, resolution = {}) {
    const turn = this.ensureTurn(referenceInput);
    turn.resolved = true;
    turn.resolution = {
      ...resolution,
      resolvedAt: resolution.resolvedAt || new Date().toISOString()
    };
    return this.turnStatus(turn);
  }

  resolvedTurns(round = this.snapshot?.round) {
    const requestedRound = Math.max(0, Number(round) || 0);
    return [...this.turns.values()]
      .filter((turn) => turn.round === requestedRound && turn.resolved && turn.resolution)
      .sort((left, right) => left.turn - right.turn)
      .map((turn) => ({
        key: turn.key,
        combatId: turn.combatId,
        round: turn.round,
        turn: turn.turn,
        combatantId: turn.combatantId,
        actorId: turn.actorId,
        actorName: turn.actorName,
        combatant: turn.combatant,
        ...turn.resolution
      }));
  }

  markRoundSummarized(round, summary = {}) {
    const roundNumber = Math.max(0, Number(round) || 0);
    this.roundSummaries.set(roundNumber, {
      round: roundNumber,
      ...summary,
      summarizedAt: summary.summarizedAt || new Date().toISOString()
    });
    return this.roundSummaries.get(roundNumber);
  }

  roundStatus(round = this.snapshot?.round) {
    const roundNumber = Math.max(0, Number(round) || 0);
    const turns = this.resolvedTurns(roundNumber);
    return {
      round: roundNumber,
      resolvedTurnCount: turns.length,
      summarized: this.roundSummaries.has(roundNumber),
      canSummarize: turns.length > 0 && !this.roundSummaries.has(roundNumber)
    };
  }

  status() {
    if (!this.snapshot?.started) {
      return {
        active: false,
        combatId: null,
        sceneId: null,
        round: 0,
        turn: null,
        activeCombatant: null,
        currentTurn: null,
        currentRound: null
      };
    }
    return {
      active: true,
      combatId: this.snapshot.id,
      sceneId: this.snapshot.sceneId,
      round: this.snapshot.round,
      turn: this.snapshot.turn,
      activeCombatant: this.snapshot.activeCombatant ? { ...this.snapshot.activeCombatant } : null,
      combatantCount: this.snapshot.combatants.length,
      currentTurn: this.turnStatus(this.getTurn()),
      currentRound: this.roundStatus(this.snapshot.round)
    };
  }

  end() {
    const previous = this.status();
    this.reset();
    return previous;
  }
}

export const CombatActionType = Object.freeze({
  ACTION: 'ACTION',
  BONUS_ACTION: 'BONUS_ACTION',
  REACTION: 'REACTION',
  MOVEMENT: 'MOVEMENT',
  FREE_ACTION: 'FREE_ACTION'
});
