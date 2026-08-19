import { compileAdventureDocument, extractDigitalPdf, localizeAdventureModel } from './index.js';
import { extractPdfLayoutSemantics } from './layout-semantics.js';
import { attachLayoutReview } from './review-queue.js';

export async function importDigitalPdfAdventureV11(input, options = {}) {
  const extracted = extractDigitalPdf(input, options);
  let model = compileAdventureDocument(extracted, options);
  const layout = extractPdfLayoutSemantics(input, { documentId: extracted.documentId, extractedDocument: extracted });
  model = attachLayoutReview(model, layout, options);
  if (options.localize === false) return model;
  return localizeAdventureModel(model, options);
}
