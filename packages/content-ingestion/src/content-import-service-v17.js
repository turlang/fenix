import { CampaignContentImportService } from './content-import-service.js';
import { buildFoundrySyncState, hashNativeSnapshot, markFoundrySyncResolutions } from './foundry-sync.js';
import { buildFoundryCompatibilityReport } from './foundry-live-compatibility.js';
import { promoteFoundryEntity, promotionCollection } from './native-entity-promotion.js';

function fail(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export class CampaignContentImportServiceV17 extends CampaignContentImportService {
  constructor(options = {}) {
    super(options);
    this.rollTableService = options.rollTableService ?? null;
  }

  campaignSystemId(campaignId) {
    return clean(this.campaignService.getRaw?.(campaignId)?.systemId, 120) || 'generic';
  }

  sourceSystemId(model) {
    return clean(model?.bridgeSync?.source?.systemId ?? model?.foundry?.systemId ?? model?.source?.systemId, 120) || 'unknown';
  }

  getNative({ campaignId, userId, promotion }) {
    if (promotion?.nativeType === 'actor' && this.actorService) {
      return this.actorService.get({ campaignId, userId, actorId: promotion.nativeId });
    }
    if (promotion?.nativeType === 'item' && this.itemService) {
      return this.itemService.get({ campaignId, userId, itemId: promotion.nativeId });
    }
    if (promotion?.nativeType === 'roll-table' && this.rollTableService) {
      return this.rollTableService.get({ campaignId, userId, rollTableId: promotion.nativeId });
    }
    return null;
  }

  nativeSnapshots({ campaignId, userId, promotions = [] } = {}) {
    const snapshots = {};
    for (const promotion of promotions) {
      try { snapshots[promotion.sourceUuid] = this.getNative({ campaignId, userId, promotion }); }
      catch { snapshots[promotion.sourceUuid] = null; }
    }
    return snapshots;
  }

  async syncFoundry({ campaignId, userId, adventureId, envelope, ...rest } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const previous = await this.store.getModel(campaignId, adventureId);
    if (!previous) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    const result = await super.syncFoundry({ campaignId, userId, adventureId, envelope, ...rest });
    const promotions = result.model.nativePromotions?.items ?? [];
    const nativeSnapshots = this.nativeSnapshots({ campaignId, userId, promotions });
    const compatibility = buildFoundryCompatibilityReport(envelope);
    const model = Object.freeze({
      ...result.model,
      foundryCompatibility: compatibility,
      bridgeSync: Object.freeze({
        ...(result.model.bridgeSync ?? {}),
        compatibility: envelope?.compatibility ? Object.freeze({ ...(envelope.compatibility ?? {}) }) : null
      }),
      sync: buildFoundrySyncState(previous, result.model, {
        nativeSnapshots,
        generatedAt: envelope?.source?.generatedAt
      })
    });
    const saved = await this.store.saveModel(campaignId, model);
    this.logger.info?.('[Fênix][Content] compatibilidade Foundry reportada', {
      campaignId,
      adventureId,
      status: compatibility.status,
      coreVersion: compatibility.observed.coreVersion,
      systemId: compatibility.observed.systemId,
      systemVersion: compatibility.observed.systemVersion,
      bridgeOperational: compatibility.bridgeOperational
    });
    return { model, sync: model.sync, compatibility, saved };
  }

  async promoteEntity({ campaignId, userId, adventureId, sourceUuid, actorType = 'npc' } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    const uuid = clean(sourceUuid, 600);
    const node = model.entityGraph?.nodes?.find((entry) => entry.sourceUuid === uuid);
    if (!node) throw fail('Entidade Foundry não encontrada.', 'FENIX_FOUNDRY_ENTITY_NOT_FOUND', 404);
    const promotions = [...(model.nativePromotions?.items ?? [])];
    const index = promotions.findIndex((item) => item.sourceUuid === uuid);
    const result = await promoteFoundryEntity({
      node,
      campaignId,
      userId,
      campaignSystemId: this.campaignSystemId(campaignId),
      sourceSystemId: this.sourceSystemId(model),
      actorService: this.actorService,
      itemService: this.itemService,
      rollTableService: this.rollTableService,
      existingPromotion: index >= 0 ? promotions[index] : null,
      actorType
    });
    if (index >= 0) promotions[index] = result.promotion;
    else promotions.push(result.promotion);
    const updated = Object.freeze({ ...model, nativePromotions: promotionCollection(promotions) });
    const saved = await this.store.saveModel(campaignId, updated);
    return { model: updated, native: result.native, promotion: result.promotion, mapping: result.mapping, saved };
  }

  async resolveFoundrySync({ campaignId, userId, adventureId, decisions } = {}) {
    this.authorize(campaignId, userId, 'gm');
    let model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    if (model.sync?.schema !== 'fenix.foundry-sync-state') throw fail('Não existe sync Foundry pendente.', 'FENIX_FOUNDRY_SYNC_REQUIRED', 409);
    const list = (Array.isArray(decisions) ? decisions : [decisions]).filter(Boolean);
    const sync = markFoundrySyncResolutions(model.sync, list);
    const promotions = [...(model.nativePromotions?.items ?? [])];

    for (const decision of list) {
      const uuid = clean(decision.sourceUuid, 600);
      const syncItem = model.sync.items.find((item) => item.sourceUuid === uuid);
      if (!syncItem || syncItem.state !== 'conflict') continue;
      const promotionIndex = promotions.findIndex((item) => item.sourceUuid === uuid);
      if (promotionIndex < 0) continue;
      const promotion = promotions[promotionIndex];
      if (decision.action === 'accept-source') {
        const node = model.entityGraph?.nodes?.find((entry) => entry.sourceUuid === uuid);
        if (!node) throw fail('A fonte foi removida; preserve ou desvincule a entidade nativa.', 'FENIX_FOUNDRY_SYNC_SOURCE_REMOVED', 409);
        const promoted = await promoteFoundryEntity({
          node,
          campaignId,
          userId,
          campaignSystemId: this.campaignSystemId(campaignId),
          sourceSystemId: this.sourceSystemId(model),
          actorService: this.actorService,
          itemService: this.itemService,
          rollTableService: this.rollTableService,
          existingPromotion: promotion
        });
        promotions[promotionIndex] = promoted.promotion;
      } else if (decision.action === 'detach') {
        promotions[promotionIndex] = Object.freeze({ ...promotion, status: 'detached', synchronizedAt: new Date().toISOString() });
      } else if (decision.action === 'keep-local') {
        let native = null;
        try { native = this.getNative({ campaignId, userId, promotion }); }
        catch { native = null; }
        promotions[promotionIndex] = Object.freeze({
          ...promotion,
          sourceHash: syncItem.sourceHash,
          baselineSourceHash: syncItem.sourceHash,
          baselineNativeHash: native ? hashNativeSnapshot(native) : promotion.baselineNativeHash,
          status: syncItem.reason === 'SOURCE_REMOVED_NATIVE_PRESERVED' ? 'detached' : 'linked',
          synchronizedAt: new Date().toISOString()
        });
      }
    }

    model = Object.freeze({ ...model, sync, nativePromotions: promotionCollection(promotions) });
    const saved = await this.store.saveModel(campaignId, model);
    return { model, sync, saved };
  }
}
