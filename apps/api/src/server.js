import { randomUUID } from 'node:crypto';
import { createSessionRuntime } from '../../../packages/session-runtime/src/index.js';
import { createNarrativeProviderFromEnv } from '../../../packages/ai-provider/src/index.js';
import { createNarrationMemoryFromEnv } from '../../../packages/narration-memory/src/index.js';
import { createAudioNarrationServiceFromEnv } from '../../../packages/audio-narration-service/src/index.js';
import { createConfig, loadEnvFile } from '../../../packages/config/src/index.js';
import { createFenixRepositoryFromEnv } from '../../../packages/persistence-repository/src/index.js';
import { AuthService } from '../../../packages/auth-service/src/index.js';
import {
  CampaignService,
  createAuthenticatedPeerAuthorizer
} from '../../../packages/campaign-service/src/index.js';
import { CampaignRuntimeRegistry } from '../../../packages/campaign-runtime-registry/src/index.js';
import {
  PostgresRuntimeLeaseManager,
  PostgresStateBus
} from '../../../packages/distributed-runtime-coordination/src/index.js';
import {
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../../../packages/realtime-session-gateway/src/index.js';
import { createApiApp } from './app.js';

loadEnvFile();
const config = createConfig();
const logger = console;
const instanceId = config.instanceId || randomUUID();

const repository = createFenixRepositoryFromEnv({ logger });
await repository.initialize();

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
    publishEvent: (type, payload) => coordinationBus.publish(type, payload),
    logger
  });
  await leaseManager.initialize();
}

const authService = new AuthService({ repository, logger });
await authService.initialize();
const campaignService = new CampaignService({ repository, authService, logger });
await campaignService.initialize();

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
    const scopedSessionService = {
      getStatus: () => sessionService.getStatus({ sessionId }),
      processAction: (payload) => sessionService.processAction({ ...payload, sessionId }),
      describeRoom: (payload) => sessionService.describeRoom({ ...payload, sessionId })
    };
    return new RealtimeSessionGateway({
      hub: realtimeHub,
      sessionService: scopedSessionService,
      authorizePeer,
      logger
    }).openPeer(input);
  }
};

const app = await createApiApp({
  config,
  sessionService,
  narrator,
  audioNarrationService,
  realtimeGateway,
  authService,
  campaignService
});

async function shutdown(signal) {
  app.log.info({ signal, instanceId }, 'Encerrando servidor');
  await sessionService.persistRealtimeSessions().catch(() => undefined);
  await app.close();
  unsubscribeCoordination();
  await sessionService.stopCoordination({ releaseLeases: true }).catch(() => undefined);
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
