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

async function applySnapshot(contextPort, input) {
  if (typeof contextPort.setSnapshot !== 'function' || !hasSnapshotInput(input)) return;
  const snapshot = input?.snapshot ?? input;
  await contextPort.setSnapshot(snapshot);
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
  campaignId = null,
  adventureKnowledgeResolver = null,
  logger = console
} = {}) {
  const snapshotPort = !vttContextPort && !foundryApi ? createSnapshotContextPort() : null;
  const contextPort = vttContextPort ?? (foundryApi ? new FoundryAdapter(foundryApi) : snapshotPort);
  const narrationOutput = narrationOutputPort ?? (publishChat ? new FoundryPublisher({ publishChat, logger }) : new NarrationOutput({ logger }));

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

  async function actionKnowledge(event) {
    if (!campaignId || !adventureKnowledgeResolver?.resolveAction) return null;
    const sceneId = director.getStatus().sceneId;
    if (!sceneId) return null;
    try {
      return await adventureKnowledgeResolver.resolveAction({ campaignId, sceneId, query: event.content });
    } catch (error) {
      logger.warn?.('[Fênix][Knowledge] falha ao resolver contexto de ação', { campaignId, sceneId, code: error?.code, message: error?.message });
      return null;
    }
  }

  async function roomKnowledge(input) {
    if (!campaignId || !adventureKnowledgeResolver?.resolveRoomEntry) return null;
    const sceneId = String(input?.scene?.id ?? director.getStatus().sceneId ?? '').trim();
    const regionId = String(input?.regionId ?? input?.room?.regionId ?? input?.room?.id ?? '').trim() || null;
    if (!sceneId) return null;
    try {
      return await adventureKnowledgeResolver.resolveRoomEntry({
        campaignId,
        sceneId,
        regionId,
        query: input?.room?.name ?? ''
      });
    } catch (error) {
      logger.warn?.('[Fênix][Knowledge] falha ao resolver room-entry', { campaignId, sceneId, regionId, code: error?.code, message: error?.message });
      return null;
    }
  }

  return {
    getStatus: () => director.getStatus(),
    async start(input = {}) {
      await applySnapshot(contextPort, input);
      return director.start();
    },
    async restore({ sessionId, snapshot, startedAt = null } = {}) {
      await applySnapshot(contextPort, { snapshot });
      return director.restore({ sessionId, startedAt });
    },
    async processAction(input) {
      const event = normalizePlayerActionEvent(input);
      const adventureKnowledge = await actionKnowledge(event);
      return director.processAction({ ...event, adventureKnowledge });
    },
    async describeRoom(input = {}) {
      const resolved = await roomKnowledge(input);
      const source = resolved?.source ?? input.source;
      const event = normalizeRoomEnteredEvent({ ...input, source });
      return director.describeRoom({ ...event, adventureKnowledge: resolved?.gmContext ?? null });
    },
    end: () => director.end()
  };
}
