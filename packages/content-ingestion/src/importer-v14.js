import { localizeAdventureModel } from './index.js';
import { importFoundryJournalJson } from './foundry-journal-adapter.js';
import { buildFoundryEntityGraph, normalizeFoundryPackage } from './foundry-entity-graph.js';

export async function importFoundryPackageJson(input, options = {}) {
  const pkg = normalizeFoundryPackage(input);
  let model = await importFoundryJournalJson(pkg.journal, { ...options, localize: false });
  const entityGraph = buildFoundryEntityGraph(model, pkg, { previousGraph: options.previousEntityGraph ?? null });
  model = Object.freeze({
    ...model,
    entityGraph,
    ingestion: Object.freeze({
      ...model.ingestion,
      version: '1.4',
      adapter: 'foundry-package-v1',
      entityGraph: true
    }),
    stats: Object.freeze({
      ...model.stats,
      foundryEntities: entityGraph.stats.nodes,
      foundryEntityEdges: entityGraph.stats.edges
    })
  });
  if (options.localize === false) return model;
  return localizeAdventureModel(model, options);
}
