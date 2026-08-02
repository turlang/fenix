import { FoundryAdapter } from '../../foundry-adapter/src/index.js';
import { createNarrationContextBuilder } from '../../narration-context-builder/src/index.js';
import { IntentInterpreter } from '../../intent-interpreter/src/index.js';
import { RulesService } from '../../rules-service/src/index.js';
import { RelationshipService } from '../../relationship-service/src/index.js';
import { NarrationService } from '../../narration-service/src/index.js';
import { FoundryPublisher } from '../../foundry-publisher/src/index.js';
import { SessionDirector } from '../../session-director/src/index.js';
import { AudioNarrationService } from '../../audio-narration-service/src/index.js';
import { NPCCoordinator } from '../../npc-coordinator/src/index.js';
import { WorldStateService } from '../../world-state/src/index.js';
import { InMemoryCampaignMemory } from '../../memory/src/index.js';
import { CombatService } from '../../combat-service/src/index.js';

function createInputApi(initial = {}) {
  let snapshot = initial;
  return {
    setSnapshot(next) { snapshot = next ?? {}; },
    async getActiveScene() { return snapshot.activeScene ?? snapshot.scene ?? null; },
    async getCampaignMetadata() { return snapshot.campaign ?? null; },
    async getVisibleActors() { return snapshot.visibleActors ?? snapshot.actors ?? []; },
    async getNarrationExclusions() { return snapshot.narrationExclusions ?? { actorNames: [] }; },
    async getLinkedSceneJournal() { return snapshot.sceneJournal ?? snapshot.journal ?? null; }
  };
}

export function createSessionRuntime({
  foundryApi,
  narrator,
  publishChat,
  narrationMemory,
  openingPlanner,
  noveltyGuard,
  qualityGuard,
  audioNarrationService,
  audioOptions,
  campaignMemory,
  logger = console
} = {}) {
  const inputApi = foundryApi ?? createInputApi();
  const adapter = new FoundryAdapter(inputApi);
  const persistentMemory = campaignMemory ?? new InMemoryCampaignMemory({ logger });
  const director = new SessionDirector({
    foundryAdapter: adapter,
    contextBuilder: createNarrationContextBuilder({ logger }),
    intentInterpreter: new IntentInterpreter({ logger }),
    rulesService: new RulesService({ logger }),
    relationshipService: new RelationshipService({ logger }),
    npcCoordinator: new NPCCoordinator({ logger }),
    worldStateService: new WorldStateService({ logger }),
    combatService: new CombatService({ logger }),
    campaignMemory: persistentMemory,
    narrationService: new NarrationService({
      provider: narrator,
      narrationMemory,
      openingPlanner,
      noveltyGuard,
      qualityGuard,
      logger
    }),
    audioNarrationService: audioNarrationService ?? new AudioNarrationService({ ...(audioOptions ?? {}), logger }),
    foundryPublisher: new FoundryPublisher({ publishChat, logger }),
    logger
  });

  return {
    getStatus: () => director.getStatus(),
    async start(input = {}) {
      inputApi.setSnapshot?.(input.snapshot ?? input);
      return director.start();
    },
    processAction: (input) => director.processAction(input),
    resolveRound: (input) => director.resolveRound(input),
    syncCombat: (input) => director.syncCombat(input),
    processCombatAction: (input) => director.processCombatAction(input),
    resolveCombatTurn: (input) => director.resolveCombatTurn(input),
    summarizeCombatRound: (input) => director.summarizeCombatRound(input),
    endCombat: () => director.endCombat(),
    describeRoom: (roomContext) => director.describeRoom(roomContext),
    end: () => director.end(),
    getCampaignMemory: async (campaignId) => {
      const snapshot = await persistentMemory.load(campaignId);
      return {
        ...persistentMemory.summary(snapshot),
        records: {
          facts: Object.values(snapshot.facts ?? {}),
          npcs: Object.values(snapshot.npcs ?? {}),
          relationships: Object.values(snapshot.relationships ?? {}),
          quests: Object.values(snapshot.quests ?? {}),
          items: Object.values(snapshot.items ?? {})
        }
      };
    },
    upsertCampaignMemory: async (campaignId, collection, record) => {
      const result = await persistentMemory.upsert(campaignId, collection, record);
      return { record: result.record, memory: persistentMemory.summary(result.campaign) };
    },
    removeCampaignMemory: async (campaignId, collection, recordId) => {
      const result = await persistentMemory.remove(campaignId, collection, recordId);
      return { removed: result.removed, memory: persistentMemory.summary(result.campaign) };
    }
  };
}
