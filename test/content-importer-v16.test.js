import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createSystemNativeMappingRegistry,
  defaultSystemNativeMappingRegistry,
  genericSystemNativeMapper
} from '../packages/content-ingestion/src/system-native-mapping.js';
import { createActorPromotionInput, createItemPromotionInput, promotionCollection } from '../packages/content-ingestion/src/native-entity-promotion.js';
import { buildFoundrySyncState } from '../packages/content-ingestion/src/foundry-sync.js';

function actorNode() {
  return {
    sourceUuid: 'Actor.synthetic01',
    sourceHash: 'source-hash-a',
    kind: 'npc',
    subtype: 'npc',
    name: 'Synthetic Scout',
    facts: {
      hp: { value: 7, max: 7 },
      ac: 15,
      cr: 0.25,
      type: 'humanoid',
      movement: { walk: 30, fly: 60 },
      senses: { darkvision: 60 }
    }
  };
}

test('v1.6 maps normalized dnd5e actor facts into a native Sheet without becoming runtime rules authority', () => {
  const mapped = createActorPromotionInput(actorNode(), { campaignSystemId: 'dnd5e', sourceSystemId: 'dnd5e' });
  assert.equal(mapped.systemId, 'dnd5e');
  assert.equal(mapped.sheet.attributes.hp.max, 7);
  assert.equal(mapped.sheet.attributes.ac, 15);
  assert.equal(mapped.sheet.attributes.cr, 0.25);
  assert.equal(mapped.sheet.movement.unit, 'ft');
  assert.deepEqual(mapped.sheet.movement.speeds, { walk: 30, fly: 60 });
  assert.equal(mapped.sheet.vision.senses.darkvision, 60);
  assert.equal(mapped.mapping.mapperId, 'fenix-dnd5e-import-v1');
  assert.equal(mapped.mapping.sourceSystemId, 'dnd5e');
  assert.equal(mapped.mapping.targetSystemId, 'dnd5e');
  assert.equal(mapped.sheet.movement.speeds.swim, undefined);
});

test('v1.6 uses a conservative generic mapper for unsupported target systems', () => {
  const registry = createSystemNativeMappingRegistry([], { fallback: genericSystemNativeMapper });
  const mapped = registry.mapActor({ node: actorNode(), targetSystemId: 'custom-rpg', sourceSystemId: 'custom-rpg' });
  assert.equal(mapped.mapping.mapperId, 'fenix-generic-import-v1');
  assert.equal(mapped.mapping.targetSystemId, 'custom-rpg');
  assert.match(mapped.mapping.warnings.join(' '), /genérico/i);
});

test('v1.6 maps spell fields only when the normalized source actually provides them', () => {
  const spell = createItemPromotionInput({
    sourceUuid: 'Item.spell01',
    sourceHash: 'spell-hash',
    kind: 'spell',
    subtype: 'spell',
    name: 'Synthetic Spark',
    text: 'Synthetic test spell.',
    facts: { level: 1, school: 'evo' }
  }, { campaignSystemId: 'dnd5e', sourceSystemId: 'dnd5e' });
  assert.equal(spell.data.level, 1);
  assert.equal(spell.data.school, 'evo');
  assert.equal(spell.mapping.mapperId, 'fenix-dnd5e-import-v1');

  const item = createItemPromotionInput({
    sourceUuid: 'Item.key01', sourceHash: 'item-hash', kind: 'item', name: 'Synthetic Key', facts: { quantity: 1 }
  }, { campaignSystemId: 'dnd5e', sourceSystemId: 'dnd5e' });
  assert.equal(item.data.level, undefined);
  assert.equal(item.data.school, undefined);
});

test('native promotion collection declares mapping as transformation, not RPG rule authority', () => {
  const collection = promotionCollection([]);
  assert.equal(collection.version, 2);
  assert.equal(collection.policy.systemMappingIsNotRulesAuthority, true);
  assert.equal(collection.policy.automaticOverwrite, false);
});

test('v1.6 keeps v1.5 fail-closed conflict semantics intact', () => {
  const previous = {
    entityGraph: { nodes: [{ sourceUuid: 'Actor.synthetic01', sourceHash: 'a', kind: 'npc', name: 'Synthetic Scout' }] },
    nativePromotions: { items: [{ sourceUuid: 'Actor.synthetic01', nativeType: 'actor', nativeId: 'actor-1', baselineNativeHash: 'baseline' }] }
  };
  const next = {
    entityGraph: { nodes: [{ sourceUuid: 'Actor.synthetic01', sourceHash: 'b', kind: 'npc', name: 'Synthetic Scout' }] },
    nativePromotions: previous.nativePromotions
  };
  const sync = buildFoundrySyncState(previous, next, { nativeSnapshots: { 'Actor.synthetic01': { changed: true } } });
  assert.equal(sync.status, 'review-required');
  assert.equal(sync.items[0].state, 'conflict');
  assert.equal(sync.items[0].reason, 'SOURCE_AND_NATIVE_CHANGED');
});

test('Review Workspace exposes side-by-side sync decisions and explicit native promotion', async () => {
  const source = await readFile(new URL('../apps/fenix-vtt/components/content-review-workspace.jsx', import.meta.url), 'utf8');
  assert.match(source, /Foundry · fonte/);
  assert.match(source, /Fênix · nativo/);
  assert.match(source, /Manter Fênix/);
  assert.match(source, /Aceitar Foundry/);
  assert.match(source, /Desvincular/);
  assert.match(source, /Promover para Fênix/);
  assert.match(source, /SOURCE_REMOVED_NATIVE_PRESERVED/);
  assert.match(source, /RPG System Adapter continua sendo a autoridade/);
});

test('sync client encodes source UUID paths and exposes only reviewed resolution actions', async () => {
  const source = await readFile(new URL('../apps/fenix-vtt/lib/content-sync-client.js', import.meta.url), 'utf8');
  assert.match(source, /encodeURIComponent/);
  assert.match(source, /sync-foundry\/resolve/);
  assert.match(source, /entities\/\$\{encoded\(sourceUuid\)\}\/promote/);
  assert.match(source, /keep-local/);
  assert.match(source, /accept-source/);
  assert.match(source, /detach/);
});

test('RPG rules contract stays independent from Foundry import mapping', async () => {
  const source = await readFile(new URL('../packages/rpg-rules-contract/src/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /foundry/i);
  assert.doesNotMatch(source, /system-native-mapping/i);
  assert.ok(defaultSystemNativeMappingRegistry.resolve({ targetSystemId: 'dnd5e', sourceSystemId: 'dnd5e' }));
});
