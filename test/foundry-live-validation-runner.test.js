import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateFoundryLiveValidation } from '../apps/foundry-module/scripts/content-sync.js';

const source = await readFile(new URL('../apps/foundry-module/scripts/content-sync.js', import.meta.url), 'utf8');

function compatibleEnvelope(overrides = {}) {
  return {
    schema: 'fenix.bridge-content-sync',
    version: 3,
    rootUuid: 'JournalEntry.real-test',
    source: {
      worldId: 'physical-world',
      coreVersion: '13.351',
      systemId: 'dnd5e',
      systemVersion: '5.1.7'
    },
    compatibility: {
      capabilities: {
        fromUuid: true,
        journalEntry: true,
        journalEntryPage: true,
        actor: true,
        item: true,
        rollTable: true
      }
    },
    resolution: {
      resolvedUuids: ['Actor.a', 'Item.i', 'RollTable.r'],
      missingUuids: [],
      resolvedEntityTypes: ['Actor', 'Item', 'RollTable'],
      bounded: true,
      maxEntities: 64,
      maxDepth: 2
    },
    ...overrides
  };
}

test('relatório v1.7 aprova evidência automatizada Foundry 13 + dnd5e 5.x completa', () => {
  const report = evaluateFoundryLiveValidation(compatibleEnvelope());
  assert.equal(report.schema, 'fenix.foundry-physical-validation-report');
  assert.equal(report.automatedPassed, true);
  assert.equal(report.physicalValidationConfirmed, false);
  assert.equal(report.sync.attempted, false);
  assert.deepEqual(report.bridge.resolvedEntityTypes, ['Actor', 'Item', 'RollTable']);
  assert.equal(report.manualChecks.length, 4);
});

test('relatório v1.7 falha fechado quando versão, tipo ou UUID não satisfaz o gate', () => {
  const envelope = compatibleEnvelope({
    source: {
      worldId: 'physical-world',
      coreVersion: '12.999',
      systemId: 'dnd5e',
      systemVersion: '4.9.9'
    },
    resolution: {
      resolvedUuids: ['Actor.a'],
      missingUuids: ['Compendium.example.missing'],
      resolvedEntityTypes: ['Actor'],
      bounded: true,
      maxEntities: 64,
      maxDepth: 2
    }
  });
  const report = evaluateFoundryLiveValidation(envelope);
  assert.equal(report.automatedPassed, false);
  assert.equal(report.physicalValidationConfirmed, false);
  const failed = new Set(report.automatedChecks.filter((check) => !check.ok).map((check) => check.id));
  assert.equal(failed.has('foundry-version'), true);
  assert.equal(failed.has('system-version'), true);
  assert.equal(failed.has('required-entity-types'), true);
  assert.equal(failed.has('uuid-resolution'), true);
});

test('Bridge expõe runner físico sem transformar check automatizado em confirmação humana', () => {
  assert.match(source, /runLiveValidation:\s*runFoundryLiveValidation/);
  assert.match(source, /physicalValidationConfirmed:\s*false/);
  assert.match(source, /Validação física concluída\?/);
  assert.doesNotMatch(source, /physicalValidationConfirmed:\s*true/);
});
