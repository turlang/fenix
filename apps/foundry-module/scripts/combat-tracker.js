const PREFIXES = [
  ['BONUS_ACTION', /^(?:\[?\s*)?(?:a[cç][aã]o\s+b[oô]nus|b[oô]nus|bonus)(?:\s*\]?\s*[:\-—])?/i],
  ['REACTION', /^(?:\[?\s*)?(?:rea[cç][aã]o|reaction)(?:\s*\]?\s*[:\-—])?/i],
  ['MOVEMENT', /^(?:\[?\s*)?(?:movimento|movement|mover)(?:\s*\]?\s*[:\-—])?/i],
  ['FREE_ACTION', /^(?:\[?\s*)?(?:a[cç][aã]o\s+livre|free\s+action)(?:\s*\]?\s*[:\-—])?/i],
  ['ACTION', /^(?:\[?\s*)?(?:a[cç][aã]o|action)(?:\s*\]?\s*[:\-—])?/i]
];

function text(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function activationTypeFromMessage(message = {}) {
  const candidates = [
    message.flags?.dnd5e?.itemData?.system?.activation?.type,
    message.flags?.dnd5e?.item?.system?.activation?.type,
    message.flags?.dnd5e?.use?.activationType,
    message.flags?.dnd5e?.roll?.activationType,
    message.system?.activation?.type
  ].map((value) => String(value ?? '').toLowerCase()).filter(Boolean);
  const activation = candidates[0] ?? '';
  if (['bonus', 'bonusaction', 'bonus_action'].includes(activation)) return 'BONUS_ACTION';
  if (['reaction', 'reactiondamage', 'reactionmanual'].includes(activation)) return 'REACTION';
  if (['movement', 'move'].includes(activation)) return 'MOVEMENT';
  if (['special', 'free', 'freeaction'].includes(activation)) return 'FREE_ACTION';
  return null;
}

export function actionEconomyFromMessage(message = {}, content = '') {
  const activationType = activationTypeFromMessage(message);
  if (activationType) return activationType;
  const normalized = text(content);
  for (const [type, pattern] of PREFIXES) if (pattern.test(normalized)) return type;
  return 'ACTION';
}

export function stripActionEconomyPrefix(content = '') {
  let result = text(content);
  for (const [, pattern] of PREFIXES) {
    if (pattern.test(result)) return result.replace(pattern, '').trim() || result;
  }
  return result;
}

export function extractCombatRoll(message = {}) {
  const rolls = Array.isArray(message.rolls) ? message.rolls : [];
  const primary = rolls[0] ?? message.roll ?? null;
  const total = finiteNumber(primary?.total ?? message.flags?.dnd5e?.roll?.total);
  const formula = text(primary?.formula ?? primary?._formula, 300) || null;
  const damageTotal = finiteNumber(
    message.flags?.dnd5e?.damage?.total ??
    message.flags?.dnd5e?.roll?.damageTotal ??
    (rolls.length > 1 ? rolls.slice(1).reduce((sum, roll) => sum + (finiteNumber(roll?.total) ?? 0), 0) : null)
  );
  const critical = Boolean(message.flags?.dnd5e?.roll?.isCritical ?? message.flags?.dnd5e?.isCritical);
  const fumble = Boolean(message.flags?.dnd5e?.roll?.isFumble ?? message.flags?.dnd5e?.isFumble);
  return {
    total,
    formula,
    damageTotal,
    damageType: text(message.flags?.dnd5e?.damage?.type, 100) || null,
    outcome: critical ? 'CRITICAL' : fumble ? 'FUMBLE' : null,
    authoritative: total !== null || damageTotal !== null
  };
}

function itemMetadata(message = {}) {
  const itemId = text(
    message.flags?.dnd5e?.roll?.itemId ??
    message.flags?.dnd5e?.itemId ??
    message.flags?.dnd5e?.use?.itemId,
    200
  ) || null;
  const itemName = text(
    message.flags?.dnd5e?.itemData?.name ??
    message.flags?.dnd5e?.item?.name ??
    message.flags?.dnd5e?.roll?.itemName,
    300
  ) || null;
  return { itemId, itemName };
}

export function combatActionPayloadFromMessage(message = {}, { content = '', identity = {}, combat = {} } = {}) {
  const rawContent = text(content || message.content);
  const { itemId, itemName } = itemMetadata(message);
  const actionContent = stripActionEconomyPrefix(rawContent) || itemName || 'Ação de combate registrada.';
  return {
    content: actionContent,
    actorId: text(identity.actorId, 200),
    actorName: text(identity.actorName, 300) || null,
    tokenId: text(identity.tokenId, 200) || null,
    combatantId: text(identity.combatantId, 200) || null,
    combatId: text(combat.id ?? combat.combatId, 200),
    round: Math.max(0, Number(combat.round) || 0),
    turn: Number.isInteger(Number(combat.turn)) ? Math.max(0, Number(combat.turn)) : 0,
    economyType: actionEconomyFromMessage(message, rawContent),
    itemId,
    itemName,
    targetIds: Array.isArray(identity.targetIds) ? identity.targetIds : [],
    source: message.rolls?.length || message.roll || message.flags?.dnd5e ? 'SYSTEM_ROLL' : 'CHAT_DECLARATION',
    roll: extractCombatRoll(message)
  };
}

export function combatSnapshotFromDocument(combat) {
  if (!combat) return { id: null, started: false, round: 0, turn: null, activeCombatant: null, combatants: [] };
  const combatants = Array.from(combat.combatants?.contents ?? combat.combatants ?? []).map((entry) => ({
    id: String(entry.id ?? entry._id ?? ''),
    actorId: String(entry.actorId ?? entry.actor?.id ?? ''),
    tokenId: String(entry.tokenId ?? entry.token?.id ?? ''),
    name: String(entry.name ?? entry.actor?.name ?? entry.token?.name ?? 'Combatente'),
    initiative: finiteNumber(entry.initiative),
    defeated: Boolean(entry.defeated),
    hidden: Boolean(entry.hidden),
    disposition: finiteNumber(entry.token?.disposition ?? entry.token?.document?.disposition),
    actorType: String(entry.actor?.type ?? ''),
    isNpc: String(entry.actor?.type ?? '').toLowerCase() === 'npc'
  }));
  const currentId = String(combat.combatant?.id ?? combat.current?.combatantId ?? '');
  const activeCombatant = combatants.find((entry) => entry.id === currentId) ?? null;
  return {
    id: String(combat.id ?? combat._id ?? ''),
    sceneId: String(combat.scene?.id ?? combat.sceneId ?? ''),
    round: Math.max(0, Number(combat.round) || 0),
    turn: Number.isInteger(Number(combat.turn)) ? Math.max(0, Number(combat.turn)) : null,
    started: Boolean(combat.started ?? (combat.round > 0)),
    activeCombatant,
    combatants
  };
}

export function combatSnapshotKey(snapshot = {}) {
  return `${snapshot.id ?? 'combat'}:r${Number(snapshot.round) || 0}:t${Number(snapshot.turn) || 0}:${snapshot.activeCombatant?.id ?? 'unknown'}`;
}
