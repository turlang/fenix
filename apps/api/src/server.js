import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import { createSessionRuntime } from '../../../packages/session-runtime/src/index.js';
import { createNarrativeProviderFromEnv } from '../../../packages/ai-provider/src/index.js';
import { createNarrationMemoryFromEnv } from '../../../packages/narration-memory/src/index.js';
import { createAudioNarrationServiceFromEnv } from '../../../packages/audio-narration-service/src/index.js';
import { createNeuralVoiceServiceFromEnv } from '../../../packages/neural-voice-service/src/index.js';
import { createVoiceProfileServiceFromEnv } from '../../../packages/voice-profile-service/src/index.js';
import { createCampaignMemoryFromEnv } from '../../../packages/memory/src/index.js';
import { createAdventureLibraryFromEnv, AdventureImportModes } from '../../../packages/adventure-library/src/index.js';
import { createGeneratorServiceFromEnv, GeneratorArtifactTypes, GeneratorArtifactStatuses } from '../../../packages/generator-service/src/index.js';
import { createMapServiceFromEnv, MapStatuses, MapStyles } from '../../../packages/map-service/src/index.js';
import { createConfig, isOriginAllowed, loadEnvFile } from '../../../packages/config/src/index.js';


loadEnvFile();
const config = createConfig();
const packageMetadata = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

const app = Fastify({ logger: true, bodyLimit: config.bodyLimit, trustProxy: config.trustProxy });
const narrator = createNarrativeProviderFromEnv({ logger: app.log });
const narrationMemory = createNarrationMemoryFromEnv({ logger: app.log });
const audioNarrationService = createAudioNarrationServiceFromEnv({ logger: app.log });
const neuralVoiceService = createNeuralVoiceServiceFromEnv({ logger: app.log });
const voiceProfileService = createVoiceProfileServiceFromEnv({ logger: app.log });
const campaignMemory = createCampaignMemoryFromEnv({ logger: app.log });
const adventureLibrary = createAdventureLibraryFromEnv({ logger: app.log });
const generatorService = createGeneratorServiceFromEnv({ narrator, campaignMemory, adventureLibrary, logger: app.log });
const mapService = createMapServiceFromEnv({ narrator, generatorService, logger: app.log });
const runtime = createSessionRuntime({ narrator, narrationMemory, audioNarrationService, campaignMemory, adventureLibrary, generatorService, mapService, logger: app.log });

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (origin && isOriginAllowed(origin, config.allowedOrigins)) {
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
  }
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (request.method === 'OPTIONS') return reply.code(204).send();
});

app.get('/health', { logLevel: 'silent' }, async () => ({
  status: 'ok',
  service: 'mestre-orc-engine',
  version: packageMetadata.version,
  ai: narrator ? 'configured' : 'not-configured',
  aiProviders: narrator?.getStatus?.() ?? { configured: false, providers: [] },
  narrativeMemory: 'persistent-file',
  campaignMemory: 'persistent-file',
  adventureLibrary: 'persistent-file',
  generatedContent: 'persistent-file',
  generatorTypes: GeneratorArtifactTypes,
  mapBlueprints: 'persistent-file',
  mapStyles: MapStyles,
  documentFormats: ['txt', 'md', 'html', 'docx', 'pdf'],
  audio: audioNarrationService.enabled ? audioNarrationService.mode : 'disabled',
  neuralVoice: neuralVoiceService.getStatus(),
  voiceProfiles: 'persistent-file',
  runtime: runtime.getStatus()
}));


app.get('/v1/ai/providers', async () => (
  narrator?.getStatus?.() ?? { configured: false, primaryProvider: null, activeProvider: null, order: [], metrics: {}, providers: [] }
));

app.post('/v1/ai/providers/:providerId/reset', {
  schema: {
    params: {
      type: 'object',
      required: ['providerId'],
      additionalProperties: false,
      properties: { providerId: { type: 'string', minLength: 1, maxLength: 100 } }
    }
  }
}, async (request, reply) => {
  if (!narrator?.resetProvider) {
    return reply.code(503).send({ code: 'AI_NOT_CONFIGURED', message: 'Nenhum provedor de IA está configurado.' });
  }
  const reset = narrator.resetProvider(request.params.providerId);
  if (!reset) {
    return reply.code(404).send({ code: 'AI_PROVIDER_NOT_FOUND', message: 'Provedor de IA não encontrado.' });
  }
  return { reset: true, providerId: request.params.providerId, status: narrator.getStatus() };
});

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
      required: ['content', 'actorId'],
      additionalProperties: true,
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 4000 },
        actorId: { type: 'string', minLength: 1, maxLength: 200 },
        actorName: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        tokenId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        eventId: { type: 'string', minLength: 1, maxLength: 300 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.processAction(request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'ACTION_PROCESSING_FAILED', message: error.message }); }
});

app.post('/v1/session/round/resolve', {
  schema: {
    body: {
      type: 'object',
      additionalProperties: false,
      properties: {
        eventId: { type: 'string', minLength: 1, maxLength: 300 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.resolveRound(request.body ?? {}); }
  catch (error) { return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'ROUND_RESOLUTION_FAILED', message: error.message }); }
});


app.post('/v1/session/combat/sync', { schema: objectBodySchema }, async (request, reply) => {
  try { return await runtime.syncCombat(request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'COMBAT_SYNC_FAILED', message: error.message }); }
});

app.post('/v1/session/combat/action', {
  schema: {
    body: {
      type: 'object',
      required: ['content', 'actorId', 'combatId', 'round', 'turn'],
      additionalProperties: true,
      properties: {
        content: { type: 'string', minLength: 1, maxLength: 4000 },
        actorId: { type: 'string', minLength: 1, maxLength: 200 },
        actorName: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        tokenId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        combatantId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        combatId: { type: 'string', minLength: 1, maxLength: 200 },
        round: { type: 'integer', minimum: 0 },
        turn: { type: 'integer', minimum: 0 },
        economyType: { type: 'string', enum: ['ACTION', 'BONUS_ACTION', 'REACTION', 'MOVEMENT', 'FREE_ACTION'] },
        eventId: { type: 'string', minLength: 1, maxLength: 300 },
        itemId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        itemName: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        targetIds: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 200 } },
        source: { type: 'string', maxLength: 80 },
        roll: { type: 'object', additionalProperties: true }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.processCombatAction(request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'COMBAT_ACTION_FAILED', message: error.message }); }
});

app.post('/v1/session/combat/turn/resolve', { schema: objectBodySchema }, async (request, reply) => {
  try { return await runtime.resolveCombatTurn(request.body ?? {}); }
  catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'COMBAT_TURN_RESOLUTION_FAILED', message: error.message });
  }
});

app.post('/v1/session/combat/round/summary', { schema: objectBodySchema }, async (request, reply) => {
  try { return await runtime.summarizeCombatRound(request.body ?? {}); }
  catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'COMBAT_ROUND_SUMMARY_FAILED', message: error.message });
  }
});

app.post('/v1/session/combat/end', async (_request, reply) => {
  try { return await runtime.endCombat(); }
  catch (error) { return reply.code(400).send({ code: 'COMBAT_END_FAILED', message: error.message }); }
});

app.post('/v1/session/room-entry', {
  schema: {
    body: {
      type: 'object',
      required: ['room', 'source'],
      additionalProperties: false,
      properties: {
        eventId: { type: 'string', minLength: 1, maxLength: 300 },
        room: {
          type: 'object', required: ['id', 'name'], additionalProperties: false,
          properties: { id: { type: 'string', minLength: 1, maxLength: 200 }, name: { type: 'string', minLength: 1, maxLength: 300 } }
        },
        source: {
          type: 'object', required: ['canonicalAnchor', 'text'], additionalProperties: false,
          properties: {
            canonicalAnchor: { type: 'boolean' }, text: { type: 'string', minLength: 1, maxLength: 5000 },
            type: { type: 'string', maxLength: 100 }, extractionMode: { type: 'string', maxLength: 100 }
          }
        },
        scene: { type: 'object', additionalProperties: true },
        visibleActors: {
          type: 'array', maxItems: 100,
          items: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', maxLength: 200 },
              name: { type: 'string', minLength: 1, maxLength: 300 },
              type: { type: 'string', maxLength: 100 }
            }
          }
        },
        narrationExclusions: {
          type: 'object', additionalProperties: false,
          properties: {
            actorNames: {
              type: 'array', maxItems: 200,
              items: { type: 'string', minLength: 1, maxLength: 300 }
            }
          }
        },
        perception: {
          type: 'object', additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['TOKEN_VISION', 'CANONICAL_ONLY'] },
            observer: {
              type: 'object', additionalProperties: false,
              properties: {
                tokenId: { type: 'string', maxLength: 200 },
                actorId: { type: 'string', maxLength: 200 }
              }
            },
            visionAvailable: { type: 'boolean' },
            blinded: { type: 'boolean' },
            sourceKind: { type: 'string', enum: ['LIGHT', 'FOV', 'SHAPE', 'LOS', 'NONE'] },
            limitedToLineOfSight: { type: 'boolean' },
            visibleActorCount: { type: 'integer', minimum: 0, maximum: 100 }
          }
        },
        campaign: { type: 'object', additionalProperties: true }
      }
    }
  }
}, async (request, reply) => {
  try {
    return await runtime.describeRoom(request.body ?? {});
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({
      code: error.code || 'ROOM_ENTRY_FAILED',
      message: error.message
    });
  }
});

app.post('/v1/session/end', async () => runtime.end());
app.get('/v1/session/status', async () => runtime.getStatus());

const memoryCollections = ['facts', 'npcs', 'relationships', 'quests', 'items'];

app.get('/v1/campaign-memory/:campaignId', {
  schema: {
    params: {
      type: 'object',
      required: ['campaignId'],
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    }
  }
}, async (request, reply) => {
  try { return await runtime.getCampaignMemory(request.params.campaignId); }
  catch (error) { return reply.code(400).send({ code: 'CAMPAIGN_MEMORY_READ_FAILED', message: error.message }); }
});

app.post('/v1/campaign-memory/:campaignId/:collection', {
  schema: {
    params: {
      type: 'object',
      required: ['campaignId', 'collection'],
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        collection: { type: 'string', enum: memoryCollections }
      }
    },
    body: { type: 'object', additionalProperties: true }
  }
}, async (request, reply) => {
  try {
    return await runtime.upsertCampaignMemory(
      request.params.campaignId,
      request.params.collection,
      request.body ?? {}
    );
  } catch (error) {
    return reply.code(400).send({ code: 'CAMPAIGN_MEMORY_WRITE_FAILED', message: error.message });
  }
});

app.delete('/v1/campaign-memory/:campaignId/:collection/:recordId', {
  schema: {
    params: {
      type: 'object',
      required: ['campaignId', 'collection', 'recordId'],
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        collection: { type: 'string', enum: memoryCollections },
        recordId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    return await runtime.removeCampaignMemory(
      request.params.campaignId,
      request.params.collection,
      request.params.recordId
    );
  } catch (error) {
    return reply.code(400).send({ code: 'CAMPAIGN_MEMORY_DELETE_FAILED', message: error.message });
  }
});


app.get('/v1/adventure-library/:campaignId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'],
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    }
  }
}, async (request, reply) => {
  try { return await runtime.listAdventureDocuments(request.params.campaignId); }
  catch (error) { return reply.code(400).send({ code: 'ADVENTURE_LIBRARY_READ_FAILED', message: error.message }); }
});

app.post('/v1/adventure-library/:campaignId/import', {
  bodyLimit: 18 * 1024 * 1024,
  schema: {
    params: {
      type: 'object', required: ['campaignId'],
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    body: {
      type: 'object', required: ['fileName', 'contentBase64'], additionalProperties: false,
      properties: {
        fileName: { type: 'string', minLength: 1, maxLength: 300 },
        title: { type: 'string', maxLength: 300 },
        mimeType: { type: 'string', maxLength: 120 },
        contentBase64: { type: 'string', minLength: 1 },
        mode: { type: 'string', enum: AdventureImportModes }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.importAdventureDocument(request.params.campaignId, request.body ?? {}); }
  catch (error) {
    return reply.code(400).send({ code: 'ADVENTURE_IMPORT_FAILED', message: error.message });
  }
});

app.get('/v1/adventure-library/:campaignId/search', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'],
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    querystring: {
      type: 'object', required: ['q'], additionalProperties: false,
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 500 },
        limit: { type: 'integer', minimum: 1, maximum: 30 },
        safeOnly: { type: 'boolean' },
        documentId: { type: 'string', maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    return {
      query: request.query.q,
      results: await runtime.searchAdventureDocuments(request.params.campaignId, request.query.q, {
        limit: request.query.limit,
        narrationSafeOnly: Boolean(request.query.safeOnly),
        documentId: request.query.documentId || null
      })
    };
  } catch (error) {
    return reply.code(400).send({ code: 'ADVENTURE_SEARCH_FAILED', message: error.message });
  }
});

app.post('/v1/adventure-library/:campaignId/:documentId/mode', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'documentId'],
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        documentId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    },
    body: {
      type: 'object', required: ['mode'], additionalProperties: false,
      properties: { mode: { type: 'string', enum: AdventureImportModes } }
    }
  }
}, async (request, reply) => {
  try { return await runtime.updateAdventureDocumentMode(request.params.campaignId, request.params.documentId, request.body.mode); }
  catch (error) { return reply.code(400).send({ code: 'ADVENTURE_MODE_UPDATE_FAILED', message: error.message }); }
});

app.delete('/v1/adventure-library/:campaignId/:documentId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'documentId'],
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        documentId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.removeAdventureDocument(request.params.campaignId, request.params.documentId); }
  catch (error) { return reply.code(400).send({ code: 'ADVENTURE_DELETE_FAILED', message: error.message }); }
});


app.get('/v1/generators/:campaignId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    querystring: {
      type: 'object', additionalProperties: false,
      properties: {
        type: { type: 'string', enum: GeneratorArtifactTypes },
        status: { type: 'string', enum: GeneratorArtifactStatuses }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.listGeneratedArtifacts(request.params.campaignId, request.query ?? {}); }
  catch (error) { return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'GENERATOR_ARCHIVE_READ_FAILED', message: error.message }); }
});

app.get('/v1/generators/:campaignId/:artifactId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'artifactId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        artifactId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    const artifact = await runtime.getGeneratedArtifact(request.params.campaignId, request.params.artifactId);
    if (!artifact) return reply.code(404).send({ code: 'GENERATED_ARTIFACT_NOT_FOUND', message: 'Conteúdo gerado não encontrado.' });
    return { artifact };
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'GENERATED_ARTIFACT_READ_FAILED', message: error.message });
  }
});

app.post('/v1/generators/:campaignId/generate', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    body: {
      type: 'object', required: ['type', 'brief'], additionalProperties: false,
      properties: {
        type: { type: 'string', enum: GeneratorArtifactTypes },
        brief: { type: 'string', minLength: 10, maxLength: 5000 },
        system: { type: 'string', maxLength: 120 },
        tone: { type: 'string', maxLength: 200 },
        levelRange: { anyOf: [{ type: 'string', maxLength: 80 }, { type: 'null' }] },
        playerCount: { anyOf: [{ type: 'integer', minimum: 1, maximum: 20 }, { type: 'null' }] },
        length: { type: 'string', enum: ['SHORT', 'MEDIUM', 'LONG'] },
        includeSecrets: { type: 'boolean' },
        constraints: { anyOf: [{ type: 'string', maxLength: 3000 }, { type: 'null' }] }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.generateArtifact(request.params.campaignId, request.body ?? {}); }
  catch (error) {
    const status = Number(error.statusCode) || (error.code === 'GENERATOR_REPETITION_BLOCKED' ? 409 : 400);
    return reply.code(status).send({
      code: error.code || 'CONTENT_GENERATION_FAILED',
      message: error.message,
      closestArtifactId: error.closestArtifactId ?? null,
      similarity: error.similarity ?? null,
      retryAfter: error.retryAfter ?? null
    });
  }
});

app.post('/v1/generators/:campaignId/:artifactId/activate', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'artifactId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        artifactId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    const result = await runtime.activateGeneratedArtifact(request.params.campaignId, request.params.artifactId);
    if (!result) return reply.code(404).send({ code: 'GENERATED_ARTIFACT_NOT_FOUND', message: 'Conteúdo gerado não encontrado.' });
    return result;
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'GENERATED_ARTIFACT_ACTIVATION_FAILED', message: error.message });
  }
});

app.post('/v1/generators/:campaignId/:artifactId/archive', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'artifactId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        artifactId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    const result = await runtime.archiveGeneratedArtifact(request.params.campaignId, request.params.artifactId);
    if (!result) return reply.code(404).send({ code: 'GENERATED_ARTIFACT_NOT_FOUND', message: 'Conteúdo gerado não encontrado.' });
    return result;
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'GENERATED_ARTIFACT_ARCHIVE_FAILED', message: error.message });
  }
});

app.delete('/v1/generators/:campaignId/:artifactId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'artifactId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        artifactId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.removeGeneratedArtifact(request.params.campaignId, request.params.artifactId); }
  catch (error) { return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'GENERATED_ARTIFACT_DELETE_FAILED', message: error.message }); }
});


app.get('/v1/maps/:campaignId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    querystring: {
      type: 'object', additionalProperties: false,
      properties: { status: { type: 'string', enum: MapStatuses } }
    }
  }
}, async (request, reply) => {
  try { return await runtime.listMapBlueprints(request.params.campaignId, request.query ?? {}); }
  catch (error) { return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'MAP_ARCHIVE_READ_FAILED', message: error.message }); }
});

app.get('/v1/maps/:campaignId/:mapId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'mapId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        mapId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try {
    const blueprint = await runtime.getMapBlueprint(request.params.campaignId, request.params.mapId, { includeSvg: true, includeSecrets: true });
    if (!blueprint) return reply.code(404).send({ code: 'MAP_NOT_FOUND', message: 'Planta de mapa não encontrada.' });
    return { blueprint };
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'MAP_READ_FAILED', message: error.message });
  }
});

app.post('/v1/maps/:campaignId/generate', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    body: {
      type: 'object', additionalProperties: false,
      properties: {
        sourceArtifactId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        title: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        prompt: { anyOf: [{ type: 'string', maxLength: 4000 }, { type: 'null' }] },
        style: { type: 'string', enum: MapStyles },
        roomCount: { type: 'integer', minimum: 2, maximum: 80 },
        gridSize: { type: 'integer', minimum: 50, maximum: 200 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.generateMapBlueprint(request.params.campaignId, request.body ?? {}); }
  catch (error) {
    const status = Number(error.statusCode) || (error.code === 'MAP_DUPLICATE' ? 409 : 400);
    return reply.code(status).send({ code: error.code || 'MAP_GENERATION_FAILED', message: error.message, mapId: error.mapId ?? null });
  }
});

app.post('/v1/maps/:campaignId/:mapId/scene-created', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'mapId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        mapId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    },
    body: {
      type: 'object', required: ['id', 'name'], additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 200 },
        name: { type: 'string', minLength: 1, maxLength: 300 },
        backgroundPath: { anyOf: [{ type: 'string', maxLength: 1000 }, { type: 'null' }] },
        journalId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }
      }
    }
  }
}, async (request, reply) => {
  try {
    const result = await runtime.markMapSceneCreated(request.params.campaignId, request.params.mapId, request.body ?? {});
    if (!result) return reply.code(404).send({ code: 'MAP_NOT_FOUND', message: 'Planta de mapa não encontrada.' });
    return result;
  } catch (error) {
    return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'MAP_SCENE_LINK_FAILED', message: error.message });
  }
});

app.delete('/v1/maps/:campaignId/:mapId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'mapId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        mapId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try { return await runtime.removeMapBlueprint(request.params.campaignId, request.params.mapId); }
  catch (error) { return reply.code(Number(error.statusCode) || 400).send({ code: error.code || 'MAP_DELETE_FAILED', message: error.message }); }
});


app.get('/v1/voice/providers', async () => neuralVoiceService.getStatus());

app.get('/v1/voice-profiles/:campaignId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    }
  }
}, async (request, reply) => {
  try { return await voiceProfileService.list(request.params.campaignId); }
  catch (error) { return reply.code(400).send({ code: 'VOICE_PROFILE_READ_FAILED', message: error.message }); }
});

app.post('/v1/voice-profiles/:campaignId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId'], additionalProperties: false,
      properties: { campaignId: { type: 'string', minLength: 1, maxLength: 200 } }
    },
    body: {
      type: 'object', additionalProperties: false,
      properties: {
        id: { type: 'string', maxLength: 200 },
        profileId: { type: 'string', maxLength: 200 },
        speakerType: { type: 'string', enum: ['NARRATOR', 'NPC'] },
        npcId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        npcName: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        provider: { type: 'string', enum: ['browser', 'openai', 'elevenlabs', 'compatible'] },
        voiceId: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        model: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        language: { type: 'string', maxLength: 30 },
        instructions: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
        speed: { type: 'number', minimum: 0.25, maximum: 4 },
        stability: { type: 'number', minimum: 0, maximum: 1 },
        similarityBoost: { type: 'number', minimum: 0, maximum: 1 },
        style: { type: 'number', minimum: 0, maximum: 1 },
        useSpeakerBoost: { type: 'boolean' },
        enabled: { type: 'boolean' },
        fallbackToBrowser: { type: 'boolean' }
      }
    }
  }
}, async (request, reply) => {
  try { return await voiceProfileService.upsert(request.params.campaignId, request.body ?? {}); }
  catch (error) { return reply.code(400).send({ code: 'VOICE_PROFILE_WRITE_FAILED', message: error.message }); }
});

app.delete('/v1/voice-profiles/:campaignId/:profileId', {
  schema: {
    params: {
      type: 'object', required: ['campaignId', 'profileId'], additionalProperties: false,
      properties: {
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        profileId: { type: 'string', minLength: 1, maxLength: 200 }
      }
    }
  }
}, async (request, reply) => {
  try { return await voiceProfileService.remove(request.params.campaignId, request.params.profileId); }
  catch (error) { return reply.code(400).send({ code: 'VOICE_PROFILE_DELETE_FAILED', message: error.message }); }
});

app.post('/v1/audio/synthesize', {
  bodyLimit: 18 * 1024 * 1024,
  schema: {
    body: {
      type: 'object', required: ['text', 'campaignId'], additionalProperties: false,
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 4096 },
        campaignId: { type: 'string', minLength: 1, maxLength: 200 },
        profileId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        speakerType: { type: 'string', enum: ['NARRATOR', 'NPC'] },
        npcId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] },
        npcName: { anyOf: [{ type: 'string', maxLength: 300 }, { type: 'null' }] },
        directiveId: { anyOf: [{ type: 'string', maxLength: 200 }, { type: 'null' }] }
      }
    }
  }
}, async (request, reply) => {
  const input = request.body ?? {};
  let profile = null;
  try {
    profile = await voiceProfileService.resolve(input.campaignId, input);
    if (profile?.provider === 'browser') {
      return reply.code(409).send({
        code: 'BROWSER_VOICE_PROFILE',
        message: 'Este perfil usa a voz local do navegador.',
        fallbackToBrowser: true
      });
    }
    const result = await neuralVoiceService.synthesize({ text: input.text, profile });
    return {
      ...result,
      directiveId: input.directiveId ?? null,
      profile: profile ? {
        id: profile.id,
        speakerType: profile.speakerType,
        npcId: profile.npcId,
        npcName: profile.npcName,
        provider: profile.provider,
        fallbackToBrowser: profile.fallbackToBrowser
      } : null
    };
  } catch (error) {
    const status = Number(error.statusCode) || 502;
    return reply.code(status).send({
      code: error.code || 'VOICE_SYNTHESIS_FAILED',
      message: error.message,
      fallbackToBrowser: profile?.fallbackToBrowser !== false,
      failures: Array.isArray(error.failures) ? error.failures : undefined
    });
  }
});

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
