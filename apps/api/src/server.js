import { createSessionRuntime } from '../../../packages/session-runtime/src/index.js';
import { createNarrativeProviderFromEnv } from '../../../packages/ai-provider/src/index.js';
import { createNarrationMemoryFromEnv } from '../../../packages/narration-memory/src/index.js';
import { createAudioNarrationServiceFromEnv } from '../../../packages/audio-narration-service/src/index.js';
import { createConfig, loadEnvFile } from '../../../packages/config/src/index.js';
import { createApiApp } from './app.js';

loadEnvFile();
const config = createConfig();
const logger = console;

const narrator = createNarrativeProviderFromEnv({ logger });
const narrationMemory = createNarrationMemoryFromEnv({ logger });
const audioNarrationService = createAudioNarrationServiceFromEnv({ logger });
const sessionService = createSessionRuntime({
  narrator,
  narrationMemory,
  audioNarrationService,
  logger
});

const app = createApiApp({
  config,
  sessionService,
  narrator,
  audioNarrationService
});

async function shutdown(signal) {
  app.log.info({ signal }, 'Encerrando servidor');
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    app.log.error(error, 'Falha durante encerramento');
    process.exitCode = 1;
  }));
}

await app.listen({ port: config.port, host: config.host });
