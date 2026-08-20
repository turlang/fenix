import { createHash } from 'node:crypto';
import { hashNativeSnapshot } from './foundry-sync.js';

function promotionError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function stableNativeId(prefix, sourceUuid) {
  const digest = createHash('sha256').update(String(sourceUuid)).digest('hex').slice(0, 16);
  return `${prefix}-foundry-${digest}`;
}

function numeric(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function movementFromFacts(facts = {}) {
  const source = facts.movement && typeof facts.movement === 'object' ? facts.movement : {};
  const speeds = {};
  for (const mode of ['walk', 'fly', 'swim', 'climb', 'burrow']) {
    const value = numeric(source[mode]);
    if (value != null && value >= 0) speeds[mode] = value;
  }
  return Object.keys(speeds).length ? { unit: 'ft', speeds, defaultMode: speeds.walk != null ? 'walk' : Object.keys(speeds)[0] } : {};
}

export function createActorPromotionInput(node, { campaignSystemId = null, actorType = 'npc' } = {}) {
  if (!node || !['actor', 'npc'].includes(node.kind)) throw promotionError('Entidade não pode ser promovida para Actor.', 'FENIX_ENTITY_PROMOTION_ACTOR_INVALID');
  const attributes = {};
  if (node.facts?.hp != null) attributes.hp = structuredClone(node.facts.hp);
  if (node.facts?.ac != null) attributes.ac = structuredClone(node.facts.ac);
  if (node.facts?.cr != null) attributes.cr = node.facts.cr;
  if (node.facts?.type != null) attributes.creatureType = structuredClone(node.facts.type);
  return Object.freeze({
    actorId: stableNativeId('actor', node.sourceUuid),
    sheetId: stableNativeId('sheet', node.sourceUuid),
    systemId: clean(campaignSystemId, 120) || 'generic',
    name: clean(node.name, 160) || 'Imported Actor',
    kind: clean(actorType, 60) || 'npc',
    image: null,
    sheet: Object.freeze({
      movement: movementFromFacts(node.facts),
      attributes: Object.freeze(attributes),
      metadata: Object.freeze({
        importedFrom: 'foundry',
        sourceUuid: node.sourceUuid,
        sourceHash: node.sourceHash,
        sourceKind: node.kind,
        sourceSubtype: node.subtype ?? null
      })
    })
  });
}

export function createItemPromotionInput(node, { campaignSystemId = null } = {}) {
  if (!node || !['item', 'spell'].includes(node.kind)) throw promotionError('Entidade não pode ser promovida para Item.', 'FENIX_ENTITY_PROMOTION_ITEM_INVALID');
  return Object.freeze({
    itemId: stableNativeId('item', node.sourceUuid),
    sourceUuid: node.sourceUuid,
    sourceHash: node.sourceHash,
    name: clean(node.name, 160) || 'Imported Item',
    kind: node.kind,
    systemId: clean(campaignSystemId, 120) || 'generic',
    image: null,
    data: Object.freeze({
      text: clean(node.text, 6000),
      facts: Object.freeze({ ...(node.facts ?? {}) }),
      sourceSubtype: node.subtype ?? null
    })
  });
}

export function promotionCollection(items = []) {
  return Object.freeze({
    schema: 'fenix.native-entity-promotions',
    version: 1,
    policy: Object.freeze({ gmApprovalRequired: true, automaticOverwrite: false, sourceRemovalDeletesNative: false }),
    items: Object.freeze(items.map((item) => Object.freeze(item)))
  });
}

export async function promoteFoundryEntity({
  node,
  campaignId,
  userId,
  campaignSystemId = null,
  actorService = null,
  itemService = null,
  existingPromotion = null,
  actorType = 'npc',
  now = () => new Date().toISOString()
} = {}) {
  if (!node?.sourceUuid) throw promotionError('Entidade Foundry inválida.', 'FENIX_ENTITY_PROMOTION_SOURCE_REQUIRED');
  let nativeType;
  let native;
  if (['actor', 'npc'].includes(node.kind)) {
    if (!actorService) throw promotionError('Actor Service indisponível.', 'FENIX_ENTITY_PROMOTION_ACTOR_SERVICE_REQUIRED', 503);
    nativeType = 'actor';
    const input = createActorPromotionInput(node, { campaignSystemId, actorType });
    native = await actorService.upsert({ campaignId, userId, ...input, actorId: existingPromotion?.nativeId ?? input.actorId });
  } else if (['item', 'spell'].includes(node.kind)) {
    if (!itemService) throw promotionError('Item Service indisponível.', 'FENIX_ENTITY_PROMOTION_ITEM_SERVICE_REQUIRED', 503);
    nativeType = 'item';
    const input = createItemPromotionInput(node, { campaignSystemId });
    native = await itemService.upsertSource({ campaignId, userId, ...input, itemId: existingPromotion?.nativeId ?? input.itemId });
  } else {
    throw promotionError('Tipo de entidade ainda não possui promoção nativa.', 'FENIX_ENTITY_PROMOTION_KIND_UNSUPPORTED', 409);
  }
  return Object.freeze({
    native,
    promotion: Object.freeze({
      sourceUuid: node.sourceUuid,
      sourceHash: node.sourceHash,
      nativeType,
      nativeId: native.id,
      baselineSourceHash: node.sourceHash,
      baselineNativeHash: hashNativeSnapshot(native),
      status: 'linked',
      promotedAt: existingPromotion?.promotedAt ?? now(),
      synchronizedAt: now()
    })
  });
}
