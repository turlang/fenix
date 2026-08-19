import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAdventureSceneBindingDecisions,
  proposeAdventureSceneBindings
} from '../packages/content-ingestion/src/scene-binding.js';

const model = Object.freeze({
  schema: 'fenix.adventure-model',
  version: 1,
  id: 'adventure-a',
  title: 'Fixture',
  source: { type: 'pdf', documentId: 'fixture' },
  language: { source: 'en', target: null },
  chapters: [],
  sections: [
    { id: 'section-cellar', title: '1. Cellar', kind: 'area', source: { type: 'pdf', documentId: 'fixture', page: 2, section: '1. Cellar' } },
    { id: 'section-hall', title: '2. North Hall', kind: 'area', source: { type: 'pdf', documentId: 'fixture', page: 3, section: '2. North Hall' } }
  ],
  entities: { readAloud: [], gmNotes: [], secrets: [], checks: [], treasures: [] },
  chunks: [],
  stats: { pages: 3, chunks: 0, readAloud: 0, secrets: 0, checks: 0, treasures: 0 }
});

const scenes = [
  {
    id: 'scene-dungeon',
    name: 'Dungeon Level 1',
    regions: [
      { id: 'region-cellar', name: '1. Cellar' },
      { id: 'region-hall', name: '2. North Hall' }
    ]
  }
];

test('proposes strong area-to-region matches without mutating authoritative scene state', () => {
  const queue = proposeAdventureSceneBindings(model, scenes);
  assert.equal(queue.schema, 'fenix.scene-binding-review');
  assert.equal(queue.policy.authoritativeSceneMutation, false);
  assert.equal(queue.policy.gmReviewRequired, true);
  assert.equal(queue.summary.pending, 2);
  const cellar = queue.items.find((item) => item.sectionId === 'section-cellar');
  assert.equal(cellar.target.sceneId, 'scene-dungeon');
  assert.equal(cellar.target.regionId, 'region-cellar');
  assert.equal(cellar.confidence, 1);
  assert.equal(model.bindings, undefined);
});

test('only accepted proposals become reviewed bindings in the Adventure Model', () => {
  const queue = proposeAdventureSceneBindings(model, scenes);
  const cellar = queue.items.find((item) => item.sectionId === 'section-cellar');
  const hall = queue.items.find((item) => item.sectionId === 'section-hall');
  const result = applyAdventureSceneBindingDecisions(model, queue, [
    { reviewId: cellar.id, action: 'accept' },
    { reviewId: hall.id, action: 'reject' }
  ]);
  assert.equal(result.queue.summary.pending, 0);
  assert.equal(result.queue.summary.accepted, 1);
  assert.equal(result.queue.summary.rejected, 1);
  assert.equal(result.model.bindings.sceneRegions.length, 1);
  assert.equal(result.model.bindings.sceneRegions[0].sectionId, 'section-cellar');
  assert.equal(result.model.bindings.sceneRegions[0].sceneId, 'scene-dungeon');
  assert.equal(result.model.bindings.sceneRegions[0].regionId, 'region-cellar');
  assert.equal(result.model.bindings.sceneRegions[0].reviewed, true);
});
