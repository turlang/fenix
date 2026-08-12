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
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../../../packages/realtime-session-gateway/src/index.js';
import { createApiApp } from './app.js';

loadEnvFile();
const config = createConfig();
const logger = console;

const repository = createFenixRepositoryFromEnv({ logger });
await repository.initialize();

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
  app.log.info({ signal }, 'Encerrando servidor');
  await sessionService.persistRealtimeSessions().catch(() => undefined);
  await app.close();
  await repository.close?.();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    app.log.error(error, 'Falha durante encerramento');
    process.exitCode = 1;
  }));
}

await app.listen({ port: config.port, host: config.host });
