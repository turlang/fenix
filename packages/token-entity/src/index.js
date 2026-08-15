const MAX_COORDINATE = 1_000_000;

export const TokenEntityKind = Object.freeze({
  CHARACTER: 'character',
  NPC: 'npc',
  CREATURE: 'creature',
  VEHICLE: 'vehicle',
  OBJECT: 'object'
});

const ENTITY_KINDS = new Set(Object.values(TokenEntityKind));

function boundedText(value, maxLength = 200, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function finiteCoordinate(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(-MAX_COORDINATE, Math.min(MAX_COORDINATE, number));
}

function finitePositive(value, fallback = 1, { min = 0.1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeEntityKind(value) {
  const kind = boundedText(value, 40).toLowerCase();
  return ENTITY_KINDS.has(kind) ? kind : TokenEntityKind.CHARACTER;
}

export function normalizeTokenEntity(input = {}) {
  const tokenId = boundedText(input.tokenId ?? input.id, 200);
  if (!tokenId) throw new TypeError('tokenId é obrigatório.');

  // Compatibilidade: cenas antigas usavam token.id como actorId.
  const actorId = boundedText(input.actorId, 200) || tokenId;
  const sheetId = boundedText(input.sheetId, 200) || actorId;

  return Object.freeze({
    tokenId,
    actorId,
    sheetId,
    systemId: boundedText(input.systemId, 120, 'generic') || 'generic',
    kind: normalizeEntityKind(input.kind ?? input.entityType),
    name: boundedText(input.name, 200, actorId) || actorId,
    image: boundedText(input.image, 2000) || null,
    footprint: Object.freeze({
      widthCells: finitePositive(input.footprint?.widthCells ?? input.widthCells, 1, { min: 0.25, max: 20 }),
      heightCells: finitePositive(input.footprint?.heightCells ?? input.heightCells, 1, { min: 0.25, max: 20 })
    })
  });
}

export function normalizeTokenPlacement(input = {}) {
  const tokenId = boundedText(input.tokenId ?? input.id, 200);
  if (!tokenId) throw new TypeError('tokenId é obrigatório.');

  return Object.freeze({
    tokenId,
    sceneId: boundedText(input.sceneId, 200) || null,
    x: finiteCoordinate(input.x),
    y: finiteCoordinate(input.y),
    elevation: finiteCoordinate(input.elevation),
    rotation: finiteCoordinate(input.rotation),
    visible: input.visible !== false,
    hidden: input.hidden === true
  });
}

export function normalizeTokenRuntime(input = {}) {
  const entity = normalizeTokenEntity(input.entity ?? input);
  const placement = normalizeTokenPlacement({
    ...(input.placement ?? input),
    tokenId: entity.tokenId
  });

  return Object.freeze({
    id: entity.tokenId,
    tokenId: entity.tokenId,
    actorId: entity.actorId,
    sheetId: entity.sheetId,
    systemId: entity.systemId,
    entityType: entity.kind,
    name: entity.name,
    image: entity.image,
    footprint: entity.footprint,
    x: placement.x,
    y: placement.y,
    elevation: placement.elevation,
    rotation: placement.rotation,
    visible: placement.visible,
    hidden: placement.hidden
  });
}

export function tokenBelongsToActor(tokenInput, actorId) {
  const token = normalizeTokenRuntime(tokenInput);
  return token.actorId === boundedText(actorId, 200);
}
