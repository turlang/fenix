import { compileAdventureDocument, extractDigitalPdf, localizeAdventureModel } from './index.js';
import { extractPdfLayoutSemantics } from './layout-semantics.js';
import { attachLayoutReview } from './review-queue.js';
import {
  attachOcrReview,
  buildTrustedTextDocumentFromOcr,
  normalizeOcrVisionDocument
} from './ocr-vision.js';
import { discoverPdfImageAssets } from './pdf-image-discovery.js';

function isTextLayerFailure(error) {
  return error?.code === 'FENIX_PDF_TEXT_LAYER_REQUIRED';
}

export async function importPdfAdventureV12(input, options = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  let extracted;
  let ocrDocument = null;
  let extractionMode = 'digital-text';

  try {
    extracted = extractDigitalPdf(buffer, options);
  } catch (error) {
    if (!isTextLayerFailure(error)) throw error;
    if (!options.ocrProvider?.extractPdf) {
      const missing = new Error('PDF sem camada de texto. Configure um provider OCR/Vision para importar material escaneado.');
      missing.code = 'FENIX_OCR_PROVIDER_REQUIRED';
      missing.statusCode = 422;
      throw missing;
    }
    const raw = await options.ocrProvider.extractPdf({
      buffer,
      documentId: options.documentId ?? null,
      languageHint: options.sourceLanguage ?? null
    });
    ocrDocument = raw?.schema === 'fenix.ocr-vision-document'
      ? raw
      : normalizeOcrVisionDocument(raw, { documentId: options.documentId });
    extracted = buildTrustedTextDocumentFromOcr(ocrDocument, {
      trustedConfidence: options.ocrTrustedConfidence ?? 0.92
    });
    extractionMode = 'ocr-vision';
  }

  let model = compileAdventureDocument(extracted, options);
  if (extractionMode === 'digital-text') {
    const layout = extractPdfLayoutSemantics(buffer, {
      documentId: extracted.documentId,
      extractedDocument: extracted
    });
    model = attachLayoutReview(model, layout, options);
  } else {
    model = attachOcrReview(model, ocrDocument, {
      trustedConfidence: options.ocrTrustedConfidence ?? 0.92,
      minimumReviewConfidence: options.ocrMinimumReviewConfidence ?? 0.35
    });
  }

  const imageDiscovery = discoverPdfImageAssets(buffer, {
    documentId: extracted.documentId,
    minimumPixels: options.minimumImagePixels ?? 80_000
  });
  model = Object.freeze({
    ...model,
    ingestion: Object.freeze({
      version: '1.2',
      extractionMode,
      ocrProvider: ocrDocument?.provider ?? null
    }),
    assets: Object.freeze({
      ...(model.assets ?? {}),
      pdfImages: imageDiscovery
    })
  });

  if (options.localize === false) return model;
  return localizeAdventureModel(model, options);
}
