import Fastify from 'fastify';
import { createSessionRuntime } from '../../../packages/session-runtime/src/index.js';
import { createNarrativeProviderFromEnv } from '../../../packages/ai-provider/src/index.js';
import { createNarrationMemoryFromEnv } from '../../../packages/narration-memory/src/index.js';
import { createAudioNarrationServiceFromEnv } from '../../../packages/audio-narration-service/src/index.js';
import { createConfig, loadEnvFile } from '../../../packages/config/src/index.js';


loadEnvFile();
const config = createConfig();

const app = Fastify({ logger: true, bodyLimit: config.bodyLimit, trustProxy: config.trustProxy });
const narrator = createNarrativeProviderFromEnv({ logger: app.log });
const narrationMemory = createNarrationMemoryFromEnv({ logger: app.log });
const audioNarrationService = createAudioNarrationServiceFromEnv({ logger: app.log });
const runtime = createSessionRuntime({ narrator, narrationMemory, audioNarrationService, logger: app.log });

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
  }
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (request.method === 'OPTIONS') return reply.code(204).send();
});

app.get('/health', { logLevel: 'silent' }, async () => ({
  status: 'ok',
  service: 'mestre-orc-engine',
  version: '0.1.0-alpha.17',
  ai: narrator ? 'groq' : 'not-configured',
  narrativeMemory: 'persistent-file',
  audio: audioNarrationService.enabled ? audioNarrationService.mode : 'disabled',
  runtime: runtime.getStatus()
}));

const objectBodySchema = {
  body: { type: 'object', additionalProperties: true }
};

app.post('/v1/session/start', { schema: objectBodySchema }, async (request, reply) => {
  try {
    return await runtime.start(request.body ?? {});
  } catch (error) {
    const status = Number(error.statusCode) || 400;
    return reply.code(status).send({
      code: error.code || (status === 429 ? 'AI_RATE_LIMIT' : 'SESSION_START_FAILED'),
      message: error.message,
      retryAfter: error.retryAfter ?? null
    });
  }
});

app.post('/v1/session/action', {
  schema: {
    body: {
      type: 'object',
      required: ['content'],
      additionalProperties: true,
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 4000 },
        actorId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.processAction(request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'ACTION_PROCESSING_FAILED', message: error.message }); }
});

app.post('/v1/session/room-entry', {
  schema: {
    body: {
      type: 'object',
      required: ['room', 'source'],
      additionalProperties: true,
      properties: {
        room: { type: 'object', required: ['id', 'name'], properties: { id: { type: 'string' }, name: { type: 'string' } } },
        source: { type: 'object', required: ['canonicalAnchor', 'text'], properties: { canonicalAnchor: { type: 'boolean' }, text: { type: 'string' }, type: { type: 'string' }, extractionMode: { type: 'string' } } },
        scene: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, darkness: { type: 'number' } } },
        visibleActors: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' } } } },
        campaign: { type: 'object', properties: { worldId: { type: 'string' }, title: { type: 'string' }, systemId: { type: 'string' } } }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.describeRoom(request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'ROOM_ENTRY_FAILED', message: error.message }); }
});

app.post('/v1/session/end', async () => runtime.end());
app.get('/v1/session/status', async () => runtime.getStatus());

app.setErrorHandler((error, request, reply) => {
  const status = Number(error.statusCode) || 500;
  request.log.error({ err: error, requestId: request.id }, 'Falha na requisição');
  reply.code(status).send({
    code: error.code || (status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST'),
    message: status >= 500 && config.isProduction ? 'Erro interno do servidor.' : error.message,
    requestId: request.id
  });
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
