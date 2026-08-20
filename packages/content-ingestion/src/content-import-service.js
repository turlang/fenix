import { localizeAdventureModel } from './index.js';
import { importPdfAdventureV13 } from './importer-v13.js';
import { importFoundryPackageJson } from './importer-v14.js';
import { reconcileFoundryEntityGraph } from './foundry-entity-graph.js';
import { applyAdventureSceneBindingDecisions, proposeAdventureSceneBindings } from './scene-binding.js';
import { extractPdfImageAssets } from './pdf-image-extraction.js';
import { buildFoundrySyncState, hashNativeSnapshot, markFoundrySyncResolutions } from './foundry-sync.js';
import { promoteFoundryEntity, promotionCollection } from './native-entity-promotion.js';

function fail(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 300) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function decodeBase64(value) {
  const encoded = String(value ?? '').replace(/\s+/g, '');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw fail('Conteúdo Base64 inválido.', 'FENIX_CONTENT_BASE64_INVALID');
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw fail('Conteúdo Base64 inválido.', 'FENIX_CONTENT_BASE64_INVALID');
  }
  return buffer;
}

function extractedAssetCollection(model, items) {
  return Object.freeze({
    schema: 'fenix.extracted-content-assets',
    version: 1,
    policy: Object.freeze({ gmReviewRequiredForScenePromotion: true, authoritativeGeometryMutation: false }),
    items: Object.freeze(items.map((item) => Object.freeze(item)))
  });
}

export class CampaignContentImportService {
  constructor({
    campaignService,
    store,
    translator = null,
    ocrProvider = null,
    sceneService = null,
    actorService = null,
    itemService = null,
    logger = console
  } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!store) throw new TypeError('store semântico é obrigatório.');
    this.campaignService = campaignService;
    this.store = store;
    this.translator = translator;
    this.ocrProvider = ocrProvider;
    this.sceneService = sceneService;
    this.actorService = actorService;
    this.itemService = itemService;
    this.logger = logger;
  }

  authorize(campaignId, userId, role = 'gm') {
    return this.campaignService.requireRole(campaignId, userId, role);
  }

  async list({ campaignId, userId } = {}) {
    this.authorize(campaignId, userId, 'gm');
    return {
      campaignId: String(campaignId),
      storeDriver: this.store.driver ?? 'unknown',
      models: await this.store.listModels(campaignId)
    };
  }

  async get({ campaignId, userId, adventureId } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    return { model };
  }

  async #attachBindingReview({ campaignId, userId, model, preserveBindings = null } = {}) {
    if (!this.sceneService || typeof this.sceneService.list !== 'function') return model;
    const sceneState = await this.sceneService.list({ campaignId, userId });
    const queue = proposeAdventureSceneBindings(model, sceneState.scenes ?? []);
    return Object.freeze({
      ...model,
      bindings: preserveBindings ?? model.bindings ?? Object.freeze({ sceneRegions: Object.freeze([]) }),
      bindingReview: queue
    });
  }

  async #nativeSnapshots({ campaignId, userId, promotions = [] } = {}) {
    const snapshots = {};
    for (const promotion of promotions) {
      try {
        if (promotion.nativeType === 'actor' && this.actorService) {
          snapshots[promotion.sourceUuid] = this.actorService.get({ campaignId, userId, actorId: promotion.nativeId });
        } else if (promotion.nativeType === 'item' && this.itemService) {
          snapshots[promotion.sourceUuid] = this.itemService.get({ campaignId, userId, itemId: promotion.nativeId });
        }
      } catch {
        snapshots[promotion.sourceUuid] = null;
      }
    }
    return snapshots;
  }

  #campaignSystemId(campaignId) {
    return clean(this.campaignService.getRaw?.(campaignId)?.systemId, 120) || 'generic';
  }

  async #storeExtractedPdfAssets({ campaignId, userId, buffer, model, minimumImagePixels = 80_000 } = {}) {
    const extracted = extractPdfImageAssets(buffer, {
      documentId: model.source?.documentId,
      minimumPixels: minimumImagePixels
    });
    const discovery = new Map((model.assets?.pdfImages?.images ?? []).map((image) => [Number(image.objectId), image]));
    const items = [];
    for (const image of extracted.assets) {
      const candidate = discovery.get(Number(image.objectId)) ?? null;
      const mapCandidate = candidate?.mapCandidate === true;
      let campaignAsset = null;
      let storageError = null;
      if (mapCandidate && this.sceneService) {
        try {
          campaignAsset = await this.sceneService.uploadMap({
            campaignId,
            userId,
            fileName: image.fileName,
            mimeType: image.mimeType,
            dataBase64: image.buffer.toString('base64')
          });
        } catch (error) {
          storageError = { code: error?.code || 'FENIX_ASSET_STORE_FAILED', message: error?.message || 'Falha ao armazenar asset.' };
        }
      }
      items.push({
        id: image.id,
        objectId: image.objectId,
        width: image.width,
        height: image.height,
        pixels: image.pixels,
        mimeType: image.mimeType,
        extraction: image.extraction,
        mapCandidate,
        mapConfidence: Number(candidate?.mapConfidence) || 0,
        status: campaignAsset ? 'review' : mapCandidate ? 'storage-pending' : 'reference',
        campaignAssetId: campaignAsset?.id ?? null,
        storageError,
        promotedSceneId: null,
        source: image.source
      });
    }
    return Object.freeze({
      ...model,
      assets: Object.freeze({
        ...(model.assets ?? {}),
        extractedImages: extractedAssetCollection(model, items)
      }),
      stats: Object.freeze({
        ...(model.stats ?? {}),
        extractedImages: items.length,
        storedMapCandidates: items.filter((item) => item.campaignAssetId).length
      })
    });
  }

  async importPdf({
    campaignId,
    userId,
    fileName,
    dataBase64,
    title = null,
    targetLanguage = 'pt-BR',
    localize = true,
    reviewThreshold = 0.65,
    autoAcceptConfidence = 0.97,
    ocrTrustedConfidence = 0.92,
    ocrMinimumReviewConfidence = 0.35,
    minimumImagePixels = 80_000
  } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const normalizedFileName = clean(fileName, 300);
    if (!/\.pdf$/i.test(normalizedFileName)) throw fail('Este endpoint aceita somente PDF.', 'FENIX_CONTENT_PDF_REQUIRED');
    const buffer = decodeBase64(dataBase64);
    const shouldLocalize = localize !== false;
    let model = await importPdfAdventureV13(buffer, {
      title: clean(title, 300) || normalizedFileName.replace(/\.pdf$/i, ''),
      targetLanguage: clean(targetLanguage, 30) || 'pt-BR',
      localize: shouldLocalize,
      translator: this.translator,
      ocrProvider: this.ocrProvider,
      reviewThreshold,
      autoAcceptConfidence,
      ocrTrustedConfidence,
      ocrMinimumReviewConfidence,
      minimumImagePixels
    });
    const previous = await this.store.getModel(campaignId, model.id);
    model = await this.#storeExtractedPdfAssets({ campaignId, userId, buffer, model, minimumImagePixels });
    model = await this.#attachBindingReview({ campaignId, userId, model, preserveBindings: previous?.bindings ?? null });
    const saved = await this.store.saveModel(campaignId, model);
    this.logger.info?.('[Fênix][Content] aventura PDF importada', {
      campaignId,
      adventureId: model.id,
      extractionMode: model.ingestion?.extractionMode,
      reviewPending: model.review?.summary?.pending ?? 0,
      bindingReviewPending: model.bindingReview?.summary?.pending ?? 0,
      storedMapCandidates: model.stats?.storedMapCandidates ?? 0
    });
    return { model, saved };
  }

  async importFoundry({
    campaignId,
    userId,
    fileName = 'foundry-package.json',
    journal,
    title = null,
    targetLanguage = 'pt-BR',
    localize = true
  } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const normalizedFileName = clean(fileName, 300);
    if (normalizedFileName && !/\.json$/i.test(normalizedFileName)) throw fail('O importador Foundry aceita arquivo JSON.', 'FENIX_FOUNDRY_JSON_REQUIRED');
    const shouldLocalize = localize !== false;
    let model = await importFoundryPackageJson(journal, {
      title: clean(title, 300) || null,
      targetLanguage: clean(targetLanguage, 30) || 'pt-BR',
      localize: false,
      translator: this.translator
    });
    const previous = await this.store.getModel(campaignId, model.id);
    if (model.entityGraph) {
      model = Object.freeze({ ...model, entityGraph: reconcileFoundryEntityGraph(model.entityGraph, previous?.entityGraph ?? null) });
    }
    if (shouldLocalize) {
      model = await localizeAdventureModel(model, {
        targetLanguage: clean(targetLanguage, 30) || 'pt-BR',
        translator: this.translator
      });
    }
    model = Object.freeze({ ...model, nativePromotions: previous?.nativePromotions ?? promotionCollection([]), sync: previous?.sync ?? null });
    model = await this.#attachBindingReview({ campaignId, userId, model, preserveBindings: previous?.bindings ?? null });
    const saved = await this.store.saveModel(campaignId, model);
    this.logger.info?.('[Fênix][Content] pacote Foundry importado', {
      campaignId,
      adventureId: model.id,
      journalUuid: model.foundry?.journalUuid,
      pages: model.foundry?.pages?.length ?? 0,
      references: model.foundry?.references?.length ?? 0,
      entityNodes: model.entityGraph?.stats?.nodes ?? 0,
      changedEntities: model.entityGraph?.nodes?.filter((node) => node.revision?.state === 'changed').length ?? 0
    });
    return { model, saved };
  }

  async syncFoundry({ campaignId, userId, adventureId, envelope, targetLanguage = null, localize = true } = {}) {
    this.authorize(campaignId, userId, 'gm');
    if (envelope?.schema !== 'fenix.bridge-content-sync' || Number(envelope?.version) < 2) {
      throw fail('Envelope do Foundry Bridge v2 é obrigatório.', 'FENIX_FOUNDRY_SYNC_ENVELOPE_INVALID');
    }
    if (envelope?.source?.adapter !== 'foundry') throw fail('Sync aceita somente origem Foundry.', 'FENIX_FOUNDRY_SYNC_SOURCE_INVALID');
    const previous = await this.store.getModel(campaignId, adventureId);
    if (!previous) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    const packageInput = { journal: envelope.journal, entities: envelope.entities ?? [] };
    let next = await importFoundryPackageJson(packageInput, {
      title: previous.title,
      targetLanguage: targetLanguage ?? previous.language?.target ?? 'pt-BR',
      localize: false,
      translator: this.translator,
      previousEntityGraph: previous.entityGraph ?? null
    });
    if (previous.foundry?.journalUuid && next.foundry?.journalUuid !== previous.foundry.journalUuid) {
      throw fail('O Journal raiz do Bridge não corresponde à aventura importada.', 'FENIX_FOUNDRY_SYNC_JOURNAL_MISMATCH', 409);
    }
    next = Object.freeze({
      ...next,
      id: previous.id,
      nativePromotions: previous.nativePromotions ?? promotionCollection([]),
      bridgeSync: Object.freeze({
        schema: envelope.schema,
        version: envelope.version,
        rootUuid: envelope.rootUuid ?? null,
        source: Object.freeze({ ...(envelope.source ?? {}) }),
        resolution: Object.freeze({ ...(envelope.resolution ?? {}) })
      })
    });
    if (localize !== false && previous.language?.target) {
      next = await localizeAdventureModel(next, { targetLanguage: previous.language.target, translator: this.translator });
    }
    const promotions = next.nativePromotions?.items ?? [];
    const nativeSnapshots = await this.#nativeSnapshots({ campaignId, userId, promotions });
    next = Object.freeze({
      ...next,
      sync: buildFoundrySyncState(previous, next, { nativeSnapshots, generatedAt: envelope.source?.generatedAt }),
      bindings: previous.bindings ?? next.bindings,
      nativePromotions: previous.nativePromotions ?? promotionCollection([])
    });
    next = await this.#attachBindingReview({ campaignId, userId, model: next, preserveBindings: previous.bindings ?? null });
    const saved = await this.store.saveModel(campaignId, next);
    return { model: next, sync: next.sync, saved };
  }

  async promoteEntity({ campaignId, userId, adventureId, sourceUuid, actorType = 'npc' } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    const uuid = clean(sourceUuid, 500);
    const node = model.entityGraph?.nodes?.find((entry) => entry.sourceUuid === uuid);
    if (!node) throw fail('Entidade Foundry não encontrada.', 'FENIX_FOUNDRY_ENTITY_NOT_FOUND', 404);
    const promotions = [...(model.nativePromotions?.items ?? [])];
    const index = promotions.findIndex((item) => item.sourceUuid === uuid);
    const result = await promoteFoundryEntity({
      node,
      campaignId,
      userId,
      campaignSystemId: this.#campaignSystemId(campaignId),
      actorService: this.actorService,
      itemService: this.itemService,
      existingPromotion: index >= 0 ? promotions[index] : null,
      actorType
    });
    if (index >= 0) promotions[index] = result.promotion;
    else promotions.push(result.promotion);
    const updated = Object.freeze({ ...model, nativePromotions: promotionCollection(promotions) });
    const saved = await this.store.saveModel(campaignId, updated);
    return { model: updated, native: result.native, promotion: result.promotion, saved };
  }

  async resolveFoundrySync({ campaignId, userId, adventureId, decisions } = {}) {
    this.authorize(campaignId, userId, 'gm');
    let model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    if (model.sync?.schema !== 'fenix.foundry-sync-state') throw fail('Não existe sync Foundry pendente.', 'FENIX_FOUNDRY_SYNC_REQUIRED', 409);
    const list = (Array.isArray(decisions) ? decisions : [decisions]).filter(Boolean);
    let sync = markFoundrySyncResolutions(model.sync, list);
    const promotions = [...(model.nativePromotions?.items ?? [])];

    for (const decision of list) {
      const uuid = clean(decision.sourceUuid, 500);
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
          campaignSystemId: this.#campaignSystemId(campaignId),
          actorService: this.actorService,
          itemService: this.itemService,
          existingPromotion: promotion
        });
        promotions[promotionIndex] = promoted.promotion;
      } else if (decision.action === 'detach') {
        promotions[promotionIndex] = Object.freeze({ ...promotion, status: 'detached', synchronizedAt: new Date().toISOString() });
      } else if (decision.action === 'keep-local') {
        let native = null;
        if (promotion.nativeType === 'actor' && this.actorService) native = this.actorService.get({ campaignId, userId, actorId: promotion.nativeId });
        if (promotion.nativeType === 'item' && this.itemService) native = this.itemService.get({ campaignId, userId, itemId: promotion.nativeId });
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

  async review({ campaignId, userId, adventureId, queue = 'layout', decisions } = {}) {
    this.authorize(campaignId, userId, 'gm');
    if (!['layout', 'ocr', 'scene-binding'].includes(queue)) throw fail('Fila de revisão inválida.', 'FENIX_CONTENT_REVIEW_QUEUE_INVALID');
    const list = Array.isArray(decisions) ? decisions : [decisions];
    if (!list.length || !list[0]) throw fail('Decisão de revisão obrigatória.', 'FENIX_CONTENT_REVIEW_DECISION_REQUIRED');

    if (queue === 'scene-binding') {
      const model = await this.store.getModel(campaignId, adventureId);
      if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
      if (model.bindingReview?.schema !== 'fenix.scene-binding-review') throw fail('Não existe fila Scene/Region para esta aventura.', 'FENIX_SCENE_BINDING_REVIEW_REQUIRED', 409);
      const result = applyAdventureSceneBindingDecisions(model, model.bindingReview, list);
      const updated = Object.freeze({ ...result.model, bindingReview: result.queue });
      const saved = await this.store.saveModel(campaignId, updated);
      return { model: updated, saved };
    }

    let saved = await this.store.applyReview(campaignId, adventureId, list, { queue });
    let model = await this.store.getModel(campaignId, adventureId);
    if (queue === 'ocr' && this.translator && model?.language?.target) {
      model = await localizeAdventureModel(model, {
        targetLanguage: model.language.target,
        translator: this.translator
      });
      saved = await this.store.saveModel(campaignId, model);
    }
    return { model, saved };
  }

  async promoteMapToScene({ campaignId, userId, adventureId, imageId, name = null, description = '', gridSize = 70 } = {}) {
    this.authorize(campaignId, userId, 'gm');
    if (!this.sceneService) throw fail('Scene Service indisponível para promoção do mapa.', 'FENIX_CONTENT_SCENE_SERVICE_REQUIRED', 503);
    const model = await this.store.getModel(campaignId, adventureId);
    if (!model) throw fail('Adventure Model não encontrado.', 'FENIX_ADVENTURE_MODEL_NOT_FOUND', 404);
    const items = [...(model.assets?.extractedImages?.items ?? [])];
    const index = items.findIndex((item) => item.id === String(imageId));
    if (index < 0) throw fail('Imagem extraída não encontrada.', 'FENIX_CONTENT_IMAGE_NOT_FOUND', 404);
    const image = items[index];
    if (!image.mapCandidate || !image.campaignAssetId) throw fail('Imagem ainda não está disponível como candidato de mapa.', 'FENIX_CONTENT_MAP_NOT_READY', 409);
    if (image.promotedSceneId) throw fail('Este mapa já foi promovido para uma Scene.', 'FENIX_CONTENT_MAP_ALREADY_PROMOTED', 409);
    const result = await this.sceneService.createScene({
      campaignId,
      userId,
      name: clean(name, 160) || model.title,
      description: clean(description, 4000),
      assetId: image.campaignAssetId,
      width: image.width,
      height: image.height,
      gridSize
    });
    items[index] = Object.freeze({ ...image, status: 'promoted', promotedSceneId: result.scene.id });
    let updated = Object.freeze({
      ...model,
      assets: Object.freeze({
        ...(model.assets ?? {}),
        extractedImages: extractedAssetCollection(model, items)
      })
    });
    updated = await this.#attachBindingReview({ campaignId, userId, model: updated, preserveBindings: model.bindings ?? null });
    const saved = await this.store.saveModel(campaignId, updated);
    return { scene: result.scene, activeSceneId: result.activeSceneId, model: updated, saved };
  }

  async remove({ campaignId, userId, adventureId } = {}) {
    this.authorize(campaignId, userId, 'gm');
    return { removed: await this.store.removeModel(campaignId, adventureId) };
  }
}
