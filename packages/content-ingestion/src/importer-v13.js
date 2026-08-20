import { importPdfAdventureV12 } from './importer-v12.js';
import { importFoundryJournalJson } from './foundry-journal-adapter.js';

export async function importPdfAdventureV13(input, options = {}) {
  const model = await importPdfAdventureV12(input, options);
  return Object.freeze({
    ...model,
    ingestion: Object.freeze({
      ...(model.ingestion ?? {}),
      version: '1.3',
      assetExtraction: 'available'
    })
  });
}

export async function importFoundryAdventureV13(input, options = {}) {
  return importFoundryJournalJson(input, options);
}
