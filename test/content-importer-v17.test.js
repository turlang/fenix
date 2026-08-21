import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { importFoundryPackageJson } from '../packages/content-ingestion/src/importer-v14.js';
import { buildFoundryCompatibilityReport } from '../packages/content-ingestion/src/foundry-live-compatibility.js';
import { createRollTablePromotionInput, promotionCollection } from '../packages/content-ingestion/src/native-entity-promotion.js';
import { CampaignRollTableService } from '../packages/campaign-roll-table-service/src/index.js';
import { resolveFoundryContentPackage } from '../apps/foundry-module/scripts/content-sync.js';

function syntheticJournal() {
  return {
    _id: 'journal-v17',
    name: 'Synthetic Adventure',
    pages: [{
      _id: 'page-v17',
      name: 'Synthetic Area',
      type: 'text',
      text: { content: '<h2>1. Synthetic Area</h2><p>@UUID[RollTable.synthetic-table]{Synthetic Table}</p>' }
    }],
    _stats: { systemId: 'dnd5e', systemVersion: '5.3.3', coreVersion: '13.351' }
  };
}

function syntheticPackage() {
  return {
    journal: syntheticJournal(),
    entities: [
      {
        _id: 'spell-v17',
        uuid: 'Item.synthetic-spell',
        documentName: 'Item',
        name: 'Synthetic Spell',
        type: 'spell',
        system: {
          level: 2,
          school: 'evo',
          activation: { type: 'action', value: 1 },
          range: { value: 60, units: 'ft' },
          target: { value: 1, type: 'creature' },
          duration: { value: 1, units: 'round' },
          damage: { parts: [['2d6', 'fire']] },
          save: { ability: 'dex', dc: 13 }
        }
      },
      {
        _id: 'table-v17',
        uuid: 'RollTable.synthetic-table',
        documentName: 'RollTable',
        name: 'Synthetic Table',
        formula: '1d2',
        replacement: false,
        results: [
          { _id: 'r1', range: [1, 1], weight: 1, text: 'Result A', drawn: false },
          { _id: 'r2', range: [2, 2], weight: 1, documentUuid: 'Item.synthetic-spell', text: 'Result B', drawn: false }
        ]
      }
    ]
  };
}

test('v1.7 enriches Item/Spell and RollTable facts without executing imported content', async () => {
  const model = await importFoundryPackageJson(syntheticPackage(), { localize: false });
  assert.equal(model.ingestion.version, '1.7');
  assert.equal(model.entityGraph.version, 2);
  const spell = model.entityGraph.nodes.find((node) => node.sourceUuid === 'Item.synthetic-spell');
  const table = model.entityGraph.nodes.find((node) => node.sourceUuid === 'RollTable.synthetic-table');
  assert.equal(spell.facts.level, 2);
  assert.equal(spell.facts.range.value, 60);
  assert.equal(spell.facts.damage.parts[0][0], '2d6');
  assert.equal(spell.facts.save.dc, 13);
  assert.equal(table.facts.formula, '1d2');
  assert.equal(table.facts.replacement, false);
  assert.equal(table.facts.results.length, 2);
  assert.equal(table.facts.results[1].documentUuid, 'Item.synthetic-spell');
  assert.equal(model.stats.foundryRollTableResults, 2);
});

test('v1.7 maps RollTable into native content while leaving roll execution to runtime authority', () => {
  const input = createRollTablePromotionInput({
    sourceUuid: 'RollTable.synthetic-table',
    sourceHash: 'hash-table',
    kind: 'roll-table',
    name: 'Synthetic Table',
    facts: { formula: '1d2', replacement: false, results: [{ id: 'r1', range: [1, 1], text: 'Result A' }] }
  }, { campaignSystemId: 'dnd5e', sourceSystemId: 'dnd5e' });
  assert.match(input.rollTableId, /^roll-table-foundry-/);
  assert.equal(input.formula, '1d2');
  assert.equal(input.replacement, false);
  assert.equal(input.results.length, 1);
  assert.equal(input.mapping.mapperId, 'fenix-dnd5e-import-v1');
  const promotions = promotionCollection([]);
  assert.equal(promotions.version, 3);
  assert.equal(promotions.policy.rollTableExecutionIsRuntimeAuthority, true);
});

test('v1.7 compatibility report records Foundry v13 + dnd5e 5.x runtime evidence without claiming hosted physical validation', () => {
  const report = buildFoundryCompatibilityReport({
    schema: 'fenix.bridge-content-sync',
    version: 3,
    source: { adapter: 'foundry', coreVersion: '13.351', systemId: 'dnd5e', systemVersion: '5.3.3', generatedAt: '2026-08-21T12:00:00.000Z' },
    compatibility: {
      schema: 'fenix.foundry-live-evidence',
      version: 1,
      coreVersion: '13.351',
      systemId: 'dnd5e',
      systemVersion: '5.3.3',
      capabilities: { actor: true, item: true, rollTable: true },
      checks: [
        { id: 'fromUuid', ok: true },
        { id: 'journalResolved', ok: true },
        { id: 'journalSerialized', ok: true }
      ]
    }
  });
  assert.equal(report.status, 'reported-compatible');
  assert.equal(report.bridgeOperational, true);
  assert.equal(report.entityCoverage.rollTable, true);
  assert.equal(report.physicalValidation.confirmed, false);
  assert.equal(report.physicalValidation.performedByHostedCi, false);
});

test('Foundry Bridge v3 produces bounded live evidence from a synthetic Foundry runtime', async () => {
  const previousGame = globalThis.game;
  const previousConfig = globalThis.CONFIG;
  try {
    globalThis.game = {
      user: { isGM: true },
      world: { id: 'synthetic-world' },
      version: '13.351',
      system: { id: 'dnd5e', version: '5.3.3' }
    };
    globalThis.CONFIG = {
      Actor: { documentClass: class Actor {} },
      Item: { documentClass: class Item {} },
      RollTable: { documentClass: class RollTable {} },
      JournalEntry: { documentClass: class JournalEntry {} },
      JournalEntryPage: { documentClass: class JournalEntryPage {} }
    };
    const table = {
      documentName: 'RollTable',
      uuid: 'RollTable.synthetic-table',
      toObject: () => syntheticPackage().entities[1]
    };
    const journal = {
      documentName: 'JournalEntry',
      uuid: 'JournalEntry.journal-v17',
      toObject: () => ({ ...syntheticJournal(), pages: [{ ...syntheticJournal().pages[0], text: { content: '@UUID[RollTable.synthetic-table]{Synthetic Table}' } }] })
    };
    const docs = new Map([[journal.uuid, journal], [table.uuid, table]]);
    const envelope = await resolveFoundryContentPackage({ rootUuid: journal.uuid, fromUuidImpl: async (uuid) => docs.get(uuid) ?? null });
    assert.equal(envelope.version, 3);
    assert.equal(envelope.compatibility.schema, 'fenix.foundry-live-evidence');
    assert.equal(envelope.compatibility.coreVersion, '13.351');
    assert.equal(envelope.compatibility.systemVersion, '5.3.3');
    assert.equal(envelope.compatibility.capabilities.rollTable, true);
    assert.equal(envelope.resolution.bounded, true);
    assert.equal(envelope.entities[0].uuid, 'RollTable.synthetic-table');
  } finally {
    globalThis.game = previousGame;
    globalThis.CONFIG = previousConfig;
  }
});

test('CampaignRollTableService preserves source identity and marks local edits', async () => {
  const campaign = { id: 'campaign-v17', systemId: 'dnd5e', rollTables: [], updatedAt: null };
  const repository = {
    state: { campaigns: [structuredClone(campaign)] },
    async mutate(fn) { await fn(this.state); },
  };
  const campaignService = {
    current: campaign,
    requireRole() { return { campaign: this.current }; },
    refreshFromRepository() { this.current = repository.state.campaigns[0]; }
  };
  const service = new CampaignRollTableService({ campaignService, repository, now: () => 1_700_000_000_000 });
  const created = await service.upsertSource({
    campaignId: campaign.id,
    userId: 'gm',
    sourceUuid: 'RollTable.synthetic-table',
    sourceHash: 'source-a',
    name: 'Synthetic Table',
    formula: '1d2',
    replacement: true,
    results: [{ id: 'r1', range: [1, 1], text: 'A' }]
  });
  assert.equal(created.sourceSync.sourceUuid, 'RollTable.synthetic-table');
  assert.equal(created.sourceSync.localModified, false);
  const edited = await service.update({ campaignId: campaign.id, userId: 'gm', rollTableId: created.id, input: { formula: '1d4' } });
  assert.equal(edited.formula, '1d4');
  assert.equal(edited.sourceSync.localModified, true);
});

test('v1.7 wires RollTable API and review client without adding Foundry logic to RPG rules contract', async () => {
  const appSource = await readFile(new URL('../apps/api/src/app.js', import.meta.url), 'utf8');
  const clientSource = await readFile(new URL('../apps/fenix-vtt/lib/content-sync-client.js', import.meta.url), 'utf8');
  const rulesSource = await readFile(new URL('../packages/rpg-rules-contract/src/index.js', import.meta.url), 'utf8');
  assert.match(appSource, /registerRollTableRoutes/);
  assert.match(clientSource, /roll-tables/);
  assert.doesNotMatch(rulesSource, /foundry/i);
  assert.doesNotMatch(rulesSource, /RollTable/);
});
