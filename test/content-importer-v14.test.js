import assert from 'node:assert/strict';
import test from 'node:test';
import { importFoundryPackageJson } from '../packages/content-ingestion/src/importer-v14.js';
import { reconcileFoundryEntityGraph, retrieveBoundEntityKnowledge } from '../packages/content-ingestion/src/foundry-entity-graph.js';
import { applyAdventureSceneBindingDecisions, proposeAdventureSceneBindings } from '../packages/content-ingestion/src/scene-binding.js';
import { buildBoundAdventureKnowledgeContext, CampaignAdventureKnowledgeResolver, resolveAcceptedSceneBinding } from '../packages/content-ingestion/src/knowledge-bindings.js';
import { InMemorySemanticAdventureStore } from '../packages/adventure-library/src/semantic-model-store.js';

function fixturePackage({ hp = 7 } = {}) {
  return {
    journal: {
      _id: 'rDYAeFtPX0qX4jc1',
      name: 'Cellar Adventure',
      _stats: { systemId: 'dnd5e', systemVersion: '5.3.3', coreVersion: '13.351' },
      pages: [{
        _id: 'dUK2VE7Ghk8K5dFp',
        name: '1. Cellar',
        type: 'text',
        text: {
          content: [
            '<h3>1. Cellar</h3>',
            '<div class="ve-rd__b-inset--readaloud">The door opens into a cold stone cellar.</div>',
            '<p>A goblin called Snikk waits here. @UUID[Actor.goblin01]{Snikk}</p>',
            '<p>Treasure: 50 gp. DC 15 Wisdom (Perception).</p>'
          ].join('')
        }
      }]
    },
    actors: [{
      _id: 'goblin01',
      uuid: 'Actor.goblin01',
      documentName: 'Actor',
      name: 'Snikk',
      type: 'npc',
      ownership: { default: 0 },
      system: {
        attributes: { hp: { value: hp, max: hp }, ac: { value: 15 }, movement: { walk: 30 } },
        details: { cr: 0.25, type: { value: 'humanoid' } },
        description: { value: '<p>Snikk guards the cellar and knows the hidden route.</p>' }
      },
      items: [{
        _id: 'spell01',
        name: 'Minor Illusion',
        type: 'spell',
        system: { level: 0, school: 'ill', description: { value: '<p>Creates a minor illusion.</p>' } }
      }]
    }],
    items: [{
      _id: 'key01',
      uuid: 'Item.key01',
      documentName: 'Item',
      name: 'Cellar Key',
      type: 'loot',
      system: { quantity: 1, description: { value: '<p>Opens the iron cellar door.</p>' } }
    }],
    rollTables: [{
      _id: 'table01',
      uuid: 'RollTable.table01',
      documentName: 'RollTable',
      name: 'Cellar Finds',
      formula: '1d2',
      results: [{ _id: 'result01', documentUuid: 'Item.key01' }]
    }]
  };
}

test('v1.4 builds a UUID-deduplicated Foundry entity graph and links page references to the area', async () => {
  const model = await importFoundryPackageJson(fixturePackage(), { localize: false });
  assert.equal(model.ingestion.version, '1.4');
  assert.equal(model.entityGraph.schema, 'fenix.foundry-entity-graph');
  assert.equal(model.entityGraph.nodes.filter((node) => node.sourceUuid === 'Actor.goblin01').length, 1);
  assert.equal(model.entityGraph.nodes.some((node) => node.sourceUuid === 'Actor.goblin01.Item.spell01' && node.kind === 'spell'), true);
  assert.equal(model.entityGraph.nodes.some((node) => node.sourceUuid === 'RollTable.table01' && node.kind === 'roll-table'), true);
  const area = model.sections.find((section) => /1\. Cellar/i.test(section.title));
  assert.ok(area);
  const goblin = model.entityGraph.nodes.find((node) => node.sourceUuid === 'Actor.goblin01');
  assert.ok(model.entityGraph.edges.some((edge) => edge.from === `section:${area.id}` && edge.to === goblin.id && edge.relation === 'mentions'));
  const spell = model.entityGraph.nodes.find((node) => node.sourceUuid === 'Actor.goblin01.Item.spell01');
  assert.ok(model.entityGraph.edges.some((edge) => edge.from === goblin.id && edge.to === spell.id && edge.relation === 'contains'));
});

test('entity graph is fail-closed for players while GM retrieval sees bound NPC facts', async () => {
  const model = await importFoundryPackageJson(fixturePackage(), { localize: false });
  const area = model.sections.find((section) => /Cellar/i.test(section.title));
  const gm = retrieveBoundEntityKnowledge(model, { sectionId: area.id, visibility: 'gm' });
  const player = retrieveBoundEntityKnowledge(model, { sectionId: area.id, visibility: 'player' });
  assert.equal(gm.some((entity) => entity.sourceUuid === 'Actor.goblin01' && entity.facts.hp.max === 7), true);
  assert.equal(player.length, 0);
});

test('incremental reimport marks changed UUID content instead of duplicating entities', async () => {
  const before = await importFoundryPackageJson(fixturePackage({ hp: 7 }), { localize: false });
  const afterRaw = await importFoundryPackageJson(fixturePackage({ hp: 9 }), { localize: false });
  const reconciled = reconcileFoundryEntityGraph(afterRaw.entityGraph, before.entityGraph);
  const goblin = reconciled.nodes.find((node) => node.sourceUuid === 'Actor.goblin01');
  assert.equal(goblin.revision.state, 'changed');
  assert.equal(goblin.revision.previousHash, before.entityGraph.nodes.find((node) => node.sourceUuid === 'Actor.goblin01').sourceHash);
  assert.equal(reconciled.nodes.filter((node) => node.sourceUuid === 'Actor.goblin01').length, 1);
});

test('only an accepted Area → Scene/Region binding can become room-entry knowledge', async () => {
  const base = await importFoundryPackageJson(fixturePackage(), { localize: false });
  const scene = { id: 'scene-dungeon', name: 'Dungeon', regions: [{ id: 'region-cellar', name: '1. Cellar' }] };
  const queue = proposeAdventureSceneBindings(base, [scene]);
  const proposal = queue.items.find((item) => item.target.regionId === 'region-cellar');
  assert.ok(proposal);
  assert.equal(resolveAcceptedSceneBinding(base, { sceneId: 'scene-dungeon', regionId: 'region-cellar' }), null);

  const accepted = applyAdventureSceneBindingDecisions(base, queue, [{ reviewId: proposal.id, action: 'accept' }]).model;
  const binding = resolveAcceptedSceneBinding(accepted, { sceneId: 'scene-dungeon', regionId: 'region-cellar' });
  assert.equal(binding.reviewed, true);

  const playerContext = buildBoundAdventureKnowledgeContext(accepted, {
    sceneId: 'scene-dungeon', regionId: 'region-cellar', visibility: 'player', language: 'en'
  });
  const gmContext = buildBoundAdventureKnowledgeContext(accepted, {
    sceneId: 'scene-dungeon', regionId: 'region-cellar', visibility: 'gm', language: 'en'
  });
  assert.equal(playerContext.chunks.some((chunk) => chunk.type === 'read-aloud'), true);
  assert.equal(playerContext.entities.length, 0);
  assert.equal(gmContext.entities.some((entity) => entity.sourceUuid === 'Actor.goblin01'), true);
});

test('campaign resolver returns a player-safe canonical read-aloud and separate GM entity context', async () => {
  const base = await importFoundryPackageJson(fixturePackage(), { localize: false });
  const queue = proposeAdventureSceneBindings(base, [{ id: 'scene-dungeon', name: 'Dungeon', regions: [{ id: 'region-cellar', name: '1. Cellar' }] }]);
  const accepted = applyAdventureSceneBindingDecisions(base, queue, [{ reviewId: queue.items[0].id, action: 'accept' }]).model;
  const store = new InMemorySemanticAdventureStore();
  await store.saveModel('campaign-1', accepted);
  const resolver = new CampaignAdventureKnowledgeResolver({ store });
  const resolved = await resolver.resolveRoomEntry({ campaignId: 'campaign-1', sceneId: 'scene-dungeon', regionId: 'region-cellar', language: 'en' });
  assert.equal(resolved.source.canonicalAnchor, true);
  assert.match(resolved.source.text, /cold stone cellar/i);
  assert.equal(resolved.playerContext.entities.length, 0);
  assert.equal(resolved.gmContext.entities.some((entity) => entity.sourceUuid === 'Actor.goblin01'), true);
});
