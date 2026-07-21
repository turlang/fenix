import test from 'node:test';
import assert from 'node:assert/strict';
import { IntentInterpreter } from '../packages/intent-interpreter/src/index.js';
import { RulesService } from '../packages/rules-service/src/index.js';
import { RelationshipService } from '../packages/relationship-service/src/index.js';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

test('IntentInterpreter classifica combate', async () => {
  const result = await new IntentInterpreter().interpret({ content: 'Ataco o goblin com minha espada', actorId: 'actor-1' });
  assert.equal(result.type, 'COMBAT');
  assert.equal(result.target, 'goblin');
  assert.equal(result.confidence, 0.8);
});

test('IntentInterpreter classifica investigação', async () => {
  const result = await new IntentInterpreter().interpret({ content: 'Examino a porta em busca de armadilhas' });
  assert.equal(result.type, 'INVESTIGATION');
  assert.equal(result.target, 'porta');
});

test('RulesService retorna dificuldade por tipo', async () => {
  const result = await new RulesService().resolve({
    intent: { type: 'COMBAT', target: 'goblin' },
    context: { scene: { id: 'scene-1' } }
  });
  assert.equal(result.result.difficulty, 12);
  assert.equal(result.result.effect, 'Ataque contra goblin');
  assert.equal(result.contextSceneId, 'scene-1');
});

test('RelationshipService ajusta disposição em combate', async () => {
  const result = await new RelationshipService().resolve({
    intent: { type: 'COMBAT', target: 'goblin' },
    context: { visibleActors: [{ id: 'npc-1', name: 'Goblin Chefão', type: 'npc' }] }
  });
  assert.equal(result.npcId, 'npc-1');
  assert.equal(result.disposition, -20);
  assert.equal(result.relationshipType, 'HOSTILE');
});

test('SessionDirector.processAction retorna narração', async () => {
  const opening = [
    'A entrada de pedra se estende diante do grupo, delimitada por paredes regulares e uma passagem central. A iluminação alcança o piso e revela os contornos do acesso sem ocultar seus limites.',
    'O espaço permanece aberto à observação, com a rota adiante claramente definida e os elementos visíveis organizados ao redor da passagem principal. O que vocês fazem?'
  ].join('\n\n');
  const narrator = {
    async createOpening() { return opening; },
    async narrateResolution({ intent }) { return `A ação declarada produz um resultado claro sobre ${intent.target ?? 'o ambiente'}.`; }
  };
  const runtime = createSessionRuntime({ narrator });
  await runtime.start({
    activeScene: { id: 'scene-1', name: 'Entrada', description: 'Uma passagem central atravessa o recinto.' },
    campaign: { worldId: 'world-1' },
    visibleActors: [{ id: 'actor-1', name: 'Aventureiro', type: 'character' }],
    sceneJournal: {
      id: 'journal-1', name: 'Entrada', explicitLink: true,
      selectedPage: {
        id: 'page-1', name: 'Entrada',
        content: 'Uma entrada de pedra possui paredes regulares e passagem central iluminada.',
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD', areaName: '1. Entrada'
      }
    }
  });
  const result = await runtime.processAction({ content: 'Examino o baú', actorId: 'actor-1' });
  assert.ok(result.narration);
  assert.equal(result.intent.type, 'INVESTIGATION');
  assert.equal(result.state, 'COLLECTING_ACTIONS');
});
