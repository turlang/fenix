import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContentSyncEnvelopeV2 } from '../packages/vtt-bridge-sdk/src/index.js';
import { buildFoundrySyncState, hashNativeSnapshot, markFoundrySyncResolutions } from '../packages/content-ingestion/src/foundry-sync.js';
import { CampaignContentImportService } from '../packages/content-ingestion/src/content-import-service.js';
import { CampaignItemService } from '../packages/campaign-item-service/src/index.js';
import { InMemorySemanticAdventureStore } from '../packages/adventure-library/src/semantic-model-store.js';

function fixturePackage({ hp = 7, includeActor = true } = {}) {
  const actor = {
    _id: 'goblin01',
    uuid: 'Actor.goblin01',
    documentName: 'Actor',
    name: 'Snikk',
    type: 'npc',
    system: {
      attributes: { hp: { value: hp, max: hp }, ac: { value: 15 }, movement: { walk: 30 } },
      details: { cr: 0.25, type: { value: 'humanoid' } },
      description: { value: '<p>A synthetic guard used only by tests.</p>' }
    }
  };
  return {
    journal: {
      _id: 'journal01',
      uuid: 'JournalEntry.journal01',
      name: 'Synthetic Adventure',
      _stats: { systemId: 'dnd5e', systemVersion: '5.3.3', coreVersion: '13.351' },
      pages: [{
        _id: 'page01',
        name: '1. Test Room',
        type: 'text',
        text: { content: '<h3>1. Test Room</h3><div class="ve-rd__b-inset--readaloud">A quiet test room.</div><p>@UUID[Actor.goblin01]{Snikk}</p>' }
      }]
    },
    entities: includeActor ? [actor] : []
  };
}

function graphModel({ sourceHash = 'source-a', nativePromotion = null } = {}) {
  return {
    entityGraph: {
      nodes: [{ sourceUuid: 'Actor.goblin01', sourceHash, kind: 'npc', name: 'Snikk' }]
    },
    nativePromotions: { items: nativePromotion ? [nativePromotion] : [] }
  };
}

function createCampaignHarness() {
  const campaign = { id: 'campaign-1', systemId: 'dnd5e', members: [{ userId: 'gm-1', role: 'gm', actorId: null }], actors: [], items: [] };
  const state = { campaigns: [campaign] };
  const campaignService = {
    requireRole(campaignId, userId, role = null) {
      assert.equal(campaignId, 'campaign-1');
      assert.equal(userId, 'gm-1');
      if (role) assert.equal(role, 'gm');
      return { campaign, membership: campaign.members[0] };
    },
    getRaw() { return campaign; },
    refreshFromRepository() {}
  };
  const repository = {
    async mutate(mutator) { return mutator(state); }
  };
  return { campaign, state, campaignService, repository };
}

test('v1.5 Bridge envelope is bounded, GM-oriented, and carries explicit UUID resolution evidence', () => {
  const envelope = createContentSyncEnvelopeV2({
    worldId: 'world-1',
    systemId: 'dnd5e',
    rootUuid: 'JournalEntry.journal01',
    journal: fixturePackage().journal,
    entities: fixturePackage().entities,
    resolvedUuids: ['Actor.goblin01'],
    missingUuids: ['Item.missing']
  });
  assert.equal(envelope.schema, 'fenix.bridge-content-sync');
  assert.equal(envelope.version, 2);
  assert.equal(envelope.policy.localOverwriteAllowedWithoutReview, false);
  assert.equal(envelope.policy.sourceRemovalDeletesNative, false);
  assert.deepEqual(envelope.resolution.missingUuids, ['Item.missing']);
});

test('v1.5 detects source + native divergence as conflict instead of overwriting local state', () => {
  const nativeBefore = { id: 'actor-native', name: 'Snikk', sheet: { attributes: { hp: 7 } } };
  const promotion = {
    sourceUuid: 'Actor.goblin01', nativeType: 'actor', nativeId: 'actor-native', baselineNativeHash: null
  };
  const baselineHash = hashNativeSnapshot(nativeBefore);
  const previous = graphModel({ sourceHash: 'source-a', nativePromotion: { ...promotion, baselineNativeHash: baselineHash } });
  const next = graphModel({ sourceHash: 'source-b', nativePromotion: { ...promotion, baselineNativeHash: baselineHash } });
  const sync = buildFoundrySyncState(previous, next, {
    nativeSnapshots: { 'Actor.goblin01': { ...nativeBefore, name: 'Snikk Local' } }
  });
  assert.equal(sync.status, 'review-required');
  assert.equal(sync.items[0].state, 'conflict');
  assert.equal(sync.items[0].reason, 'SOURCE_AND_NATIVE_CHANGED');
});

test('v1.5 never treats removed source as permission to delete a promoted native entity', () => {
  const native = { id: 'actor-native', name: 'Snikk' };
  const baselineHash = hashNativeSnapshot(native);
  const previous = graphModel({ nativePromotion: { sourceUuid: 'Actor.goblin01', nativeType: 'actor', nativeId: 'actor-native', baselineNativeHash: baselineHash } });
  const next = { entityGraph: { nodes: [] }, nativePromotions: previous.nativePromotions };
  const sync = buildFoundrySyncState(previous, next, { nativeSnapshots: { 'Actor.goblin01': native } });
  assert.equal(sync.items[0].state, 'conflict');
  assert.equal(sync.items[0].reason, 'SOURCE_REMOVED_NATIVE_PRESERVED');
  assert.throws(() => markFoundrySyncResolutions(sync, [{ sourceUuid: 'Actor.goblin01', action: 'accept-source' }]), /não pode apagar/i);
  const resolved = markFoundrySyncResolutions(sync, [{ sourceUuid: 'Actor.goblin01', action: 'keep-local' }]);
  assert.equal(resolved.status, 'resolved');
});

test('native Item catalog preserves Foundry provenance and marks later Fênix edits as local modifications', async () => {
  const { campaignService, repository } = createCampaignHarness();
  const service = new CampaignItemService({ campaignService, repository, now: () => Date.parse('2026-08-20T00:00:00Z') });
  const item = await service.upsertSource({
    campaignId: 'campaign-1', userId: 'gm-1', sourceUuid: 'Item.key01', sourceHash: 'hash-1', name: 'Test Key', kind: 'item', data: { quantity: 1 }
  });
  assert.equal(item.sourceSync.sourceUuid, 'Item.key01');
  assert.equal(item.sourceSync.localModified, false);
  const edited = await service.update({ campaignId: 'campaign-1', userId: 'gm-1', itemId: item.id, input: { name: 'Test Key · Local' } });
  assert.equal(edited.sourceSync.localModified, true);
  assert.match(edited.name, /Local/);
});

test('Content service promotes Actor explicitly, then syncs changed source into conflict when Actor was edited locally', async () => {
  const { campaignService } = createCampaignHarness();
  const store = new InMemorySemanticAdventureStore();
  const actorState = new Map();
  const actorService = {
    async upsert(input) {
      const existing = actorState.get(input.actorId);
      const actor = {
        id: input.actorId,
        actorId: input.actorId,
        sheetId: input.sheetId,
        systemId: input.systemId,
        name: input.name,
        kind: input.kind,
        image: null,
        sheet: structuredClone(input.sheet),
        resolved: { movement: input.sheet?.movement ?? {}, vision: {}, footprint: { widthCells: 1, heightCells: 1 } },
        createdAt: existing?.createdAt ?? '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z'
      };
      actorState.set(input.actorId, actor);
      return structuredClone(actor);
    },
    get({ actorId }) {
      const actor = actorState.get(actorId);
      if (!actor) throw new Error('actor missing');
      return structuredClone(actor);
    }
  };
  const service = new CampaignContentImportService({ campaignService, store, actorService });
  const imported = await service.importFoundry({ campaignId: 'campaign-1', userId: 'gm-1', journal: fixturePackage(), localize: false });
  const promoted = await service.promoteEntity({ campaignId: 'campaign-1', userId: 'gm-1', adventureId: imported.model.id, sourceUuid: 'Actor.goblin01' });
  assert.equal(promoted.promotion.nativeType, 'actor');
  const local = actorState.get(promoted.native.id);
  actorState.set(local.id, { ...local, name: 'Snikk Local Edit' });

  const changed = fixturePackage({ hp: 9 });
  const envelope = createContentSyncEnvelopeV2({
    source: 'foundry',
    worldId: 'world-1',
    systemId: 'dnd5e',
    rootUuid: 'JournalEntry.journal01',
    journal: changed.journal,
    entities: changed.entities,
    resolvedUuids: ['Actor.goblin01']
  });
  const synced = await service.syncFoundry({ campaignId: 'campaign-1', userId: 'gm-1', adventureId: imported.model.id, envelope, localize: false });
  const conflict = synced.sync.items.find((item) => item.sourceUuid === 'Actor.goblin01');
  assert.equal(conflict.state, 'conflict');
  assert.equal(conflict.reason, 'SOURCE_AND_NATIVE_CHANGED');
  assert.equal(actorState.get(local.id).name, 'Snikk Local Edit');
});

test('Foundry module exposes bounded fromUuid Bridge only after GM gate and targets the sync endpoint', async () => {
  const source = await readFile(new URL('../apps/foundry-module/scripts/content-sync.js', import.meta.url), 'utf8');
  assert.match(source, /game\?\.user\?\.isGM/);
  assert.match(source, /fromUuid/);
  assert.match(source, /maxEntities/);
  assert.match(source, /maxDepth/);
  assert.match(source, /sync-foundry/);
  assert.match(source, /recursiveUnboundedCrawlAllowed:\s*false/);
});
