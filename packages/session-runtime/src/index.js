import { FoundryAdapter } from '../../foundry-adapter/src/index.js';
import { FoundryPublisher } from '../../foundry-publisher/src/index.js';
import { NarrationOutput } from '../../narration-output/src/index.js';
import {
  createSnapshotContextPort,
  normalizePlayerActionEvent,
  normalizeRoomEnteredEvent
} from '../../vtt-contracts/src/index.js';
import { createNarrationContextBuilder } from '../../narration-context-builder/src/index.js';
import { IntentInterpreter } from '../../intent-interpreter/src/index.js';
import { RulesService } from '../../rules-service/src/index.js';
import { RelationshipService } from '../../relationship-service/src/index.js';
import { NarrationService } from '../../narration-service/src/index.js';
import { SessionDirector } from '../../session-director/src/index.js';
import { AudioNarrationService } from '../../audio-narration-service/src/index.js';

function hasSnapshotInput(input) {
  if (!input || typeof input !== 'object') return false;
  if (input.snapshot && typeof input.snapshot === 'object') return true;
  return Object.keys(input).length > 0;
}

export function createSessionRuntime({
  vttContextPort = null,
  narrationOutputPort = null,
  // Compatibilidade alpha.24. Novos adapters devem usar as portas genéricas acima.
  foundryApi = null,
  publishChat = null,
  narrator,
  narrationMemory,
  openingPlanner,
  noveltyGuard,
  qualityGuard,
  audioNarrationService,
  audioOptions,
  logger = console
} = {}) {
  const snapshotPort = !vttContextPort && !foundryApi ? createSnapshotContextPort() : null;
  const contextPort = vttContextPort
    ?? (foundryApi ? new FoundryAdapter(foundryApi) : snapshotPort);
  const narrationOutput = narrationOutputPort
    ?? (publishChat
      ? new FoundryPublisher({ publishChat, logger })
      : new NarrationOutput({ logger }));

  const director = new SessionDirector({
    contextPort,
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
    narrationOutput,
    logger
  });

  return {
    getStatus: () => director.getStatus(),
    async start(input = {}) {
      if (typeof contextPort.setSnapshot === 'function' && hasSnapshotInput(input)) {
        const snapshot = input?.snapshot ?? input;
        await contextPort.setSnapshot(snapshot);
      }
      return director.start();
    },
    processAction(input) {
      return director.processAction(normalizePlayerActionEvent(input));
    },
    describeRoom(roomContext) {
      return director.describeRoom(normalizeRoomEnteredEvent(roomContext));
    },
    end: () => director.end()
  };
}
