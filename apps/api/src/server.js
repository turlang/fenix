import { randomUUID } from 'node:crypto';
import { createSessionRuntime } from '../../../packages/session-runtime/src/index.js';
import { createNarrativeProviderFromEnv } from '../../../packages/ai-provider/src/index.js';
import { createNarrationMemoryFromEnv } from '../../../packages/narration-memory/src/index.js';
import { createAudioNarrationServiceFromEnv } from '../../../packages/audio-narration-service/src/index.js';
import { createConfig, loadEnvFile } from '../../../packages/config/src/index.js';
import { createFenixRepositoryFromEnv } from '../../../packages/persistence-repository/src/index.js';
import { createAssetStorageFromEnv } from '../../../packages/asset-storage/src/index.js';
import { RemoteMapImporter } from '../../../packages/remote-map-importer/src/index.js';
import { AuthService } from '../../../packages/auth-service/src/index.js';
import {
  CampaignService,
  createAuthenticatedPeerAuthorizer
} from '../../../packages/campaign-service/src/index.js';
import { CampaignSceneService } from '../../../packages/campaign-scene-service/src/index.js';
import { CampaignRuntimeRegistry } from '../../../packages/campaign-runtime-registry/src/index.js';
import {
  PostgresRuntimeLeaseManager,
  PostgresStateBus
} from '../../../packages/distributed-runtime-coordination/src/index.js';
import { createCommandLedger } from '../../../packages/distributed-command-ledger/src/index.js';
import { RuntimeObservability } from '../../../packages/runtime-observability/src/index.js';
import { OwnerAwareRuntimeRouter } from '../../../packages/owner-aware-runtime-router/src/index.js';
import {
  parseRealtimeMessage,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../../../packages/realtime-session-gateway/src/index.js';
import { createApiApp } from './app.js';
import { createOwnerAwareWebSocketProxy } from './realtime/owner-aware-websocket-proxy.js';

loadEnvFile();
const config = createConfig();
const logger = console;
const instanceId = config.instanceId || randomUUID();
const runtimeObservability = new RuntimeObservability({ instanceId, logger });

const repository = createFenixRepositoryFromEnv({ logger });
await repository.initialize();

const commandLedger = createCommandLedger({
  pool: repository.driver === 'postgres' ? repository.pool : null,
  waitTimeoutMs: config.commandLedgerWaitMs,
  unknownAfterMs: config.commandLedgerUnknownAfterMs,
  retentionHours: config.commandLedgerRetentionHours,
  resultMaxBytes: config.commandLedgerResultMaxBytes,
  observability: runtimeObservability,
  logger
});
await commandLedger.initialize();

let coordinationBus = null;
let leaseManager = null;
if (repository.driver === 'postgres') {
  coordinationBus = new PostgresStateBus({ pool: repository.pool, instanceId, logger });
  await coordinationBus.initialize();
  repository.setChangePublisher((metadata) => coordinationBus.publish('STATE_CHANGED', metadata));

  leaseManager = new PostgresRuntimeLeaseManager({
    pool: repository.pool,
    instanceId,
    instanceUrl: config.instancePublicUrl,
    leaseTtlMs: config.runtimeLeaseTtlMs,
    heartbeatIntervalMs: config.runtimeHeartbeatMs,
    publishEvent: async (type, payload) => {
      const isTakeover = type === 'RUNTIME_LEASE_ACQUIRED' && Number(payload?.generation) > 1;
      runtimeObservability.record(isTakeover ? 'runtime_lease_takeover' : type.toLowerCase(), {
        ownerId: payload?.ownerId ?? instanceId,
        generation: payload?.generation ?? null,
        outcome: type
      });
      return coordinationBus.publish(type, payload);
    },
    logger
  });
  await leaseManager.initialize();
}

const authService = new AuthService({ repository, logger });
await authService.initialize();
const campaignService = new CampaignService({ repository, authService, logger });
await campaignService.initialize();
const assetStorage = createAssetStorageFromEnv();
await assetStorage.initialize();
const remoteMapImporter = new RemoteMapImporter({
  maxBytes: assetStorage.maxBytes,
  timeoutMs: config.remoteMapTimeoutMs,
  maxRedirects: config.remoteMapMaxRedirects
});
const sceneService = new CampaignSceneService({
  campaignService,
  repository,
  assetStorage,
  remoteMapImporter
});

const runtimeRouter = leaseManager && config.internalRoutingSecret
  ? new OwnerAwareRuntimeRouter({
      instanceId,
      instancePublicUrl: config.instancePublicUrl,
      leaseManager,
      resolveCampaignIdBySessionId: (sessionId) => campaignService.findCampaignBySessionId?.(sessionId)?.id ?? null,
      routingSecret: config.internalRoutingSecret,
      requestTimeoutMs: config.runtimeRoutingTimeoutMs,
      maxRetries: config.runtimeRoutingMaxRetries,
      observability: runtimeObservability,
      logger
    })
  : null;
const realtimeProxy = runtimeRouter?.enabled
  ? createOwnerAwareWebSocketProxy({
      ownerRouter: runtimeRouter,
      maxRouteRetries: config.runtimeRoutingMaxRetries,
      observability: runtimeObservability,
      logger
    })
  : null;

const narrator = createNarrativeProviderFromEnv({ logger });
const narrationMemory = createNarrationMemoryFromEnv({ logger });
const audioNarrationService = createAudioNarrationServiceFromEnv({ logger });
const realtimeHub = new RealtimeSessionHub({
  logger,
  persistSnapshot: (sessionId, snapshot) => campaignService.saveRealtimeSnapshot(sessionId, snapshot)
});

const sessionService = new CampaignRuntimeRegistry({
  campaignService,
  realtimeHub,
  leaseManager,
  reconcileIntervalMs: config.runtimeReconcileMs,
  logger,
  runtimeFactory: () => createSessionRuntime({
    narrator,
    narrationMemory,
    audioNarrationService,
    narrationOutputPort: realtimeHub,
    logger
  })
});
await sessionService.initialize();

let coordinationRefresh = Promise.resolve();
const unsubscribeCoordination = coordinationBus?.subscribe((event) => {
  if (!['STATE_CHANGED', 'RUNTIME_LEASE_RELEASED', 'RUNTIME_LEASE_LOST'].includes(event?.type)) return;
  runtimeObservability.record('coordination_event_received', {
    sourceId: event?.instanceId ?? null,
    outcome: event?.type,
    generation: event?.payload?.generation ?? null
  });
  coordinationRefresh = coordinationRefresh.then(async () => {
    await repository.refresh();
    authService.refreshFromRepository();
    campaignService.refreshFromRepository();
    await sessionService.reconcile({ refreshRepository: false });
  }).catch((error) => {
    logger.error?.('[Fênix][Coordination] falha ao aplicar invalidação distribuída', {
      type: event?.type,
      message: error.message
    });
  });
  return coordinationRefresh;
}) ?? (() => undefined);
sessionService.startCoordination();

const authorizePeer = createAuthenticatedPeerAuthorizer({ authService, campaignService });
const realtimeGateway = {
  openPeer(input) {
    const sessionId = String(input?.sessionId ?? '');
    const clientId = String(input?.clientId ?? '');
    const scopedSessionService = {
      getStatus: () => sessionService.getStatus({ sessionId }),
      processAction: (payload) => sessionService.processAction({ ...payload, sessionId }),
      describeRoom: (payload) => sessionService.describeRoom({ ...payload, sessionId })
    };
    const gateway = new RealtimeSessionGateway({
      hub: realtimeHub,
      sessionService: scopedSessionService,
      authorizePeer,
      logger
    });
    const peer = gateway.openPeer(input);
    return {
      ...peer,
      receive: async (raw) => {
        const ownership = await sessionService.assertOwnership({ sessionId });
        const message = parseRealtimeMessage(raw);
        return commandLedger.execute({
          campaignId: ownership.campaignId,
          sessionId,
          commandId: message.commandId,
          commandType: `ws:${message.type}`,
          request: message,
          ownerId: instanceId,
          generation: ownership.leaseGeneration,
          onReplay: async () => {
            realtimeHub.sendTo(sessionId, clientId, {
              type: 'ACK',
              commandId: message.commandId,
              payload: { type: message.type, replayed: true }
            });
          },
          execute: async () => {
            const result = await peer.receive(raw);
            if (message.type === 'TOKEN_MOVE' && result?.token) {
              const sceneId = realtimeHub.getSnapshot(sessionId).scene?.id ?? null;
              if (sceneId) {
                await sceneService.recordExploration({
                  campaignId: ownership.campaignId,
                  userId: peer.identity.userId,
                  sceneId,
                  actorId: result.token.id,
                  x: result.token.x,
                  y: result.token.y
                }).catch((error) => {
                  logger.warn?.('[Fênix][Fog] falha ao persistir exploração autoritativa', {
                    campaignId: ownership.campaignId,
                    sessionId,
                    sceneId,
                    actorId: result.token.id,
                    code: error?.code,
                    message: error?.message
                  });
                });
              }
            }
            return result;
          }
        });
      }
    };
  },
  sendError(sessionId, clientId, error, commandId = null) {
    return realtimeHub.sendTo(sessionId, clientId, {
      type: 'ERROR',
      commandId,
      payload: {
        code: error?.code || 'REALTIME_ERROR',
        message: error?.message || 'Falha realtime.',
        status: Number(error?.statusCode) || 500
      }
    });
  }
};

const app = await createApiApp({
  config,
  sessionService,
  narrator,
  audioNarrationService,
  realtimeGateway,
  authService,
  campaignService,
  sceneService,
  runtimeRouter,
  realtimeProxy,
  commandLedger,
  runtimeObservability
});

async function shutdown(signal) {
  app.log.info({ signal, instanceId }, 'Encerrando servidor');
  await sessionService.persistRealtimeSessions().catch(() => undefined);
  await app.close();
  unsubscribeCoordination();
  await sessionService.stopCoordination({ releaseLeases: true }).catch(() => undefined);
  await Promise.resolve(commandLedger.close?.()).catch(() => undefined);
  await coordinationBus?.close?.();
  await repository.close?.();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    app.log.error(error, 'Falha durante encerramento');
    process.exitCode = 1;
  }));
}

await app.listen({ port: config.port, host: config.host });
