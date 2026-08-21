import { localizeAdventureModel } from './index.js';
import { importFoundryJournalJson } from './foundry-journal-adapter.js';
import { buildFoundryEntityGraph, normalizeFoundryPackage } from './foundry-entity-graph.js';
import { enrichFoundryEntityGraph } from './foundry-entity-coverage.js';

export async function importFoundryPackageJson(input, options = {}) {
  const pkg = normalizeFoundryPackage(input);
  let model = await importFoundryJournalJson(pkg.journal, { ...options, localize: false });
  const baseGraph = buildFoundryEntityGraph(model, pkg, { previousGraph: options.previousEntityGraph ?? null });
  const entityGraph = enrichFoundryEntityGraph(baseGraph, pkg);
  model = Object.freeze({
    ...model,
    entityGraph,
    ingestion: Object.freeze({
      ...model.ingestion,
      version: '1.7',
      adapter: 'foundry-package-v2',
      entityGraph: true,
      entityCoverage: 'item-spell-rolltable-v1'
    }),
    stats: Object.freeze({
      ...model.stats,
      foundryEntities: entityGraph.stats.nodes,
      foundryEntityEdges: entityGraph.stats.edges,
      foundryRollTableResults: entityGraph.stats.rollTableResults ?? 0
    })
  });
  if (options.localize === false) return model;
  return localizeAdventureModel(model, options);
}
