import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldStateService } from '../packages/world-state/src/index.js';
import { NPCCoordinator } from '../packages/npc-coordinator/src/index.js';

test('WorldStateService preserva progresso da campanha e relações de NPC', () => {
  const service = new WorldStateService({ logger: { error() {} } });
  service.startSession({
    campaign: { worldId: 'campaign-1' },
    scene: { id: 'scene-1', name: 'Portão Norte' }
  });

  const state = service.applyRound({
    roundNumber: 1,
    context: { scene: { id: 'scene-1', name: 'Portão Norte' } },
    resolutions: [{
      declaration: { actorId: 'hero-1', actorName: 'Ayla' },
      intent: { type: 'SOCIAL', target: 'Vigia' },
      rules: { result: { effect: 'O vigia permite a aproximação.' }, adapter: { systemId: 'dnd5e' } },
      relationship: { npcId: 'npc-1', disposition: 2 }
    }],
    npcCoordination: { reactions: [{ npcId: 'npc-1', reaction: 'escuta com atenção' }] }
  });

  assert.equal(state.campaignId, 'campaign-1');
  assert.equal(state.roundNumber, 1);
  assert.equal(state.completedRounds, 1);
  assert.equal(state.npcRelationships['npc-1'], 2);
  assert.equal(state.recentEvents.at(-1).actorId, 'hero-1');
  assert.equal(state.lastNpcReactions.at(-1).npcId, 'npc-1');
});

test('NPCCoordinator reage somente com NPCs visíveis sustentados pelo contexto', async () => {
  const coordinator = new NPCCoordinator({ logger: { error() {} } });
  const result = await coordinator.coordinate({
    context: {
      scene: { id: 'scene-1' },
      visibleActors: [
        { id: 'hero-1', name: 'Ayla', type: 'character' },
        { id: 'npc-1', name: 'Vigia', type: 'npc' },
        { id: 'npc-2', name: 'Mercador', type: 'npc' }
      ]
    },
    worldState: { roundNumber: 3 },
    resolutions: [{
      declaration: { actorId: 'hero-1' },
      intent: { type: 'SOCIAL', target: 'Vigia' },
      relationship: {
        npcId: 'npc-1',
        npcName: 'Vigia',
        relationshipType: 'FRIENDLY',
        disposition: 1
      }
    }]
  });

  assert.equal(result.mode, 'DETERMINISTIC_COORDINATION');
  assert.equal(result.worldRound, 3);
  assert.equal(result.reactions.length, 1);
  assert.equal(result.reactions[0].npcId, 'npc-1');
  assert.match(result.reactions[0].reaction, /receptiva/i);
  assert.deepEqual(result.passiveNpcs, [{ npcId: 'npc-2', npcName: 'Mercador' }]);
});
