import { importPdfAdventureV12 } from './importer-v12.js';

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

export class CampaignContentImportService {
  constructor({ campaignService, store, translator = null, ocrProvider = null, logger = console } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!store) throw new TypeError('store semântico é obrigatório.');
    this.campaignService = campaignService;
    this.store = store;
    this.translator = translator;
    this.ocrProvider = ocrProvider;
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
    ocrMinimumReviewConfidence = 0.35
  } = {}) {
    this.authorize(campaignId, userId, 'gm');
    const normalizedFileName = clean(fileName, 300);
    if (!/\.pdf$/i.test(normalizedFileName)) throw fail('Este endpoint aceita somente PDF.', 'FENIX_CONTENT_PDF_REQUIRED');
    const buffer = decodeBase64(dataBase64);
    const shouldLocalize = localize !== false;
    const model = await importPdfAdventureV12(buffer, {
      title: clean(title, 300) || normalizedFileName.replace(/\.pdf$/i, ''),
      targetLanguage: clean(targetLanguage, 30) || 'pt-BR',
      localize: shouldLocalize,
      translator: this.translator,
      ocrProvider: this.ocrProvider,
      reviewThreshold,
      autoAcceptConfidence,
      ocrTrustedConfidence,
      ocrMinimumReviewConfidence
    });
    const saved = await this.store.saveModel(campaignId, model);
    this.logger.info?.('[Fênix][Content] aventura importada', {
      campaignId,
      adventureId: model.id,
      extractionMode: model.ingestion?.extractionMode,
      reviewPending: model.review?.summary?.pending ?? 0,
      ocrReviewPending: model.ocr?.review?.summary?.pending ?? 0
    });
    return { model, saved };
  }

  async review({ campaignId, userId, adventureId, queue = 'layout', decisions } = {}) {
    this.authorize(campaignId, userId, 'gm');
    if (!['layout', 'ocr'].includes(queue)) throw fail('Fila de revisão inválida.', 'FENIX_CONTENT_REVIEW_QUEUE_INVALID');
    const list = Array.isArray(decisions) ? decisions : [decisions];
    if (!list.length || !list[0]) throw fail('Decisão de revisão obrigatória.', 'FENIX_CONTENT_REVIEW_DECISION_REQUIRED');
    const saved = await this.store.applyReview(campaignId, adventureId, list, { queue });
    const model = await this.store.getModel(campaignId, adventureId);
    return { model, saved };
  }

  async remove({ campaignId, userId, adventureId } = {}) {
    this.authorize(campaignId, userId, 'gm');
    return { removed: await this.store.removeModel(campaignId, adventureId) };
  }
}
