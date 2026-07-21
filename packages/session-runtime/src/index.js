import { FoundryAdapter } from '../../foundry-adapter/src/index.js';
import { createNarrationContextBuilder } from '../../narration-context-builder/src/index.js';
import { IntentInterpreter } from '../../intent-interpreter/src/index.js';
import { RulesService } from '../../rules-service/src/index.js';
import { RelationshipService } from '../../relationship-service/src/index.js';
import { NarrationService } from '../../narration-service/src/index.js';
import { FoundryPublisher } from '../../foundry-publisher/src/index.js';
import { SessionDirector } from '../../session-director/src/index.js';
import { AudioNarrationService } from '../../audio-narration-service/src/index.js';

function createInputApi(initial = {}) {
  let snapshot = initial;
  return {
    setSnapshot(next) { snapshot = next ?? {}; },
    async getActiveScene() { return snapshot.activeScene ?? snapshot.scene ?? null; },
    async getCampaignMetadata() { return snapshot.campaign ?? null; },
    async getVisibleActors() { return snapshot.visibleActors ?? snapshot.actors ?? []; },
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
  logger = console
} = {}) {
  const inputApi = foundryApi ?? createInputApi();
  const adapter = new FoundryAdapter(inputApi);
  const director = new SessionDirector({
    foundryAdapter: adapter,
    contextBuilder: createNarrationContextBuilder({ logger }),
    intentInterpreter: new IntentInterpreter({ logger }),
    rulesService: new RulesService({ logger }),
    relationshipService: new RelationshipService({ logger }),
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
    end: () => director.end()
  };
}
