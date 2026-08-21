import { createHash } from 'node:crypto';
import { hashNativeSnapshot } from './foundry-sync.js';
import { defaultSystemNativeMappingRegistry } from './system-native-mapping.js';

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

export function createActorPromotionInput(node, {
  campaignSystemId = null,
  sourceSystemId = null,
  actorType = 'npc',
  mappingRegistry = defaultSystemNativeMappingRegistry
} = {}) {
  if (!node || !['actor', 'npc'].includes(node.kind)) throw promotionError('Entidade não pode ser promovida para Actor.', 'FENIX_ENTITY_PROMOTION_ACTOR_INVALID');
  const targetSystemId = clean(campaignSystemId, 120) || 'generic';
  const mapped = mappingRegistry.mapActor({ node, targetSystemId, sourceSystemId, actorType });
  return Object.freeze({
    actorId: stableNativeId('actor', node.sourceUuid),
    sheetId: stableNativeId('sheet', node.sourceUuid),
    systemId: targetSystemId,
    name: clean(node.name, 160) || 'Imported Actor',
    kind: clean(mapped.kind ?? actorType, 60) || 'npc',
    image: null,
    sheet: Object.freeze({
      ...(mapped.sheet ?? {}),
      metadata: Object.freeze({
        ...(mapped.sheet?.metadata ?? {}),
        importedFrom: 'foundry',
        sourceUuid: node.sourceUuid,
        sourceHash: node.sourceHash,
        sourceKind: node.kind,
        sourceSubtype: node.subtype ?? null,
        mapping: mapped.mapping
      })
    }),
    mapping: mapped.mapping
  });
}

export function createItemPromotionInput(node, {
  campaignSystemId = null,
  sourceSystemId = null,
  mappingRegistry = defaultSystemNativeMappingRegistry
} = {}) {
  if (!node || !['item', 'spell'].includes(node.kind)) throw promotionError('Entidade não pode ser promovida para Item.', 'FENIX_ENTITY_PROMOTION_ITEM_INVALID');
  const targetSystemId = clean(campaignSystemId, 120) || 'generic';
  const mapped = mappingRegistry.mapItem({ node, targetSystemId, sourceSystemId });
  return Object.freeze({
    itemId: stableNativeId('item', node.sourceUuid),
    sourceUuid: node.sourceUuid,
    sourceHash: node.sourceHash,
    name: clean(node.name, 160) || 'Imported Item',
    kind: clean(mapped.kind ?? node.kind, 60) || 'item',
    systemId: targetSystemId,
    image: null,
    data: Object.freeze({
      ...(mapped.data ?? {}),
      mapping: mapped.mapping
    }),
    mapping: mapped.mapping
  });
}

export function createRollTablePromotionInput(node, {
  campaignSystemId = null,
  sourceSystemId = null,
  mappingRegistry = defaultSystemNativeMappingRegistry
} = {}) {
  if (!node || node.kind !== 'roll-table') throw promotionError('Entidade não pode ser promovida para RollTable.', 'FENIX_ENTITY_PROMOTION_ROLL_TABLE_INVALID');
  const targetSystemId = clean(campaignSystemId, 120) || 'generic';
  const mapped = mappingRegistry.mapRollTable({ node, targetSystemId, sourceSystemId });
  return Object.freeze({
    rollTableId: stableNativeId('roll-table', node.sourceUuid),
    sourceUuid: node.sourceUuid,
    sourceHash: node.sourceHash,
    name: clean(node.name, 160) || 'Imported RollTable',
    systemId: targetSystemId,
    formula: mapped.data?.formula ?? null,
    replacement: mapped.data?.replacement !== false,
    results: Object.freeze([...(mapped.data?.results ?? [])]),
    mapping: mapped.mapping
  });
}

export function promotionCollection(items = []) {
  return Object.freeze({
    schema: 'fenix.native-entity-promotions',
    version: 3,
    policy: Object.freeze({
      gmApprovalRequired: true,
      automaticOverwrite: false,
      sourceRemovalDeletesNative: false,
      systemMappingIsNotRulesAuthority: true,
      rollTableExecutionIsRuntimeAuthority: true
    }),
    items: Object.freeze(items.map((item) => Object.freeze(item)))
  });
}

export async function promoteFoundryEntity({
  node,
  campaignId,
  userId,
  campaignSystemId = null,
  sourceSystemId = null,
  actorService = null,
  itemService = null,
  rollTableService = null,
  existingPromotion = null,
  actorType = 'npc',
  mappingRegistry = defaultSystemNativeMappingRegistry,
  now = () => new Date().toISOString()
} = {}) {
  if (!node?.sourceUuid) throw promotionError('Entidade Foundry inválida.', 'FENIX_ENTITY_PROMOTION_SOURCE_REQUIRED');
  let nativeType;
  let native;
  let mapping;
  if (['actor', 'npc'].includes(node.kind)) {
    if (!actorService) throw promotionError('Actor Service indisponível.', 'FENIX_ENTITY_PROMOTION_ACTOR_SERVICE_REQUIRED', 503);
    nativeType = 'actor';
    const input = createActorPromotionInput(node, { campaignSystemId, sourceSystemId, actorType, mappingRegistry });
    mapping = input.mapping;
    native = await actorService.upsert({ campaignId, userId, ...input, actorId: existingPromotion?.nativeId ?? input.actorId });
  } else if (['item', 'spell'].includes(node.kind)) {
    if (!itemService) throw promotionError('Item Service indisponível.', 'FENIX_ENTITY_PROMOTION_ITEM_SERVICE_REQUIRED', 503);
    nativeType = 'item';
    const input = createItemPromotionInput(node, { campaignSystemId, sourceSystemId, mappingRegistry });
    mapping = input.mapping;
    native = await itemService.upsertSource({ campaignId, userId, ...input, itemId: existingPromotion?.nativeId ?? input.itemId });
  } else if (node.kind === 'roll-table') {
    if (!rollTableService) throw promotionError('RollTable Service indisponível.', 'FENIX_ENTITY_PROMOTION_ROLL_TABLE_SERVICE_REQUIRED', 503);
    nativeType = 'roll-table';
    const input = createRollTablePromotionInput(node, { campaignSystemId, sourceSystemId, mappingRegistry });
    mapping = input.mapping;
    native = await rollTableService.upsertSource({ campaignId, userId, ...input, rollTableId: existingPromotion?.nativeId ?? input.rollTableId });
  } else {
    throw promotionError('Tipo de entidade ainda não possui promoção nativa.', 'FENIX_ENTITY_PROMOTION_KIND_UNSUPPORTED', 409);
  }
  return Object.freeze({
    native,
    mapping,
    promotion: Object.freeze({
      sourceUuid: node.sourceUuid,
      sourceHash: node.sourceHash,
      nativeType,
      nativeId: native.id,
      baselineSourceHash: node.sourceHash,
      baselineNativeHash: hashNativeSnapshot(native),
      mapping,
      status: 'linked',
      promotedAt: existingPromotion?.promotedAt ?? now(),
      synchronizedAt: now()
    })
  });
}
