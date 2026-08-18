import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GatewayNarrativeProvider,
  createNarrativeProviderFromEnv
} from '../packages/ai-provider/src/index.js';

const ENV_KEYS = [
  'FENIX_AI_ROUTING_POLICY',
  'FENIX_LOCAL_LLM_BASE_URL',
  'FENIX_LOCAL_LLM_MODEL',
  'FENIX_LOCAL_LLM_API_KEY',
  'FENIX_LOCAL_LLM_TIMEOUT_MS',
  'FENIX_LOCAL_LLM_MAX_TOKEN_FIELD',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_BASE_URL',
  'GROQ_TIMEOUT_MS',
  'MESTRE_ORC_AUDIO_EMOTION_MARKERS'
];

function saveEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function clearAiEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function roomContext() {
  return {
    scene: { name: 'Cripta' },
    room: { name: 'Galeria' },
    source: { text: 'Uma porta de madeira fecha a passagem.' },
    visibleActors: [{ name: 'Ayla' }]
  };
}

const logger = { info() {}, warn() {} };

test('factory usa LLM local como provider do Mestre Fenix quando configurada', async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  try {
    clearAiEnv();
    process.env.FENIX_AI_ROUTING_POLICY = 'local-only';
    process.env.FENIX_LOCAL_LLM_BASE_URL = 'http://gpu-ai.internal:8000/v1';
    process.env.FENIX_LOCAL_LLM_MODEL = 'fenix-local';
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls += 1;
      assert.equal(url, 'http://gpu-ai.internal:8000/v1/chat/completions');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'fenix-local');
      assert.equal(body.max_tokens, 400);
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: 'Narração da GPU local.' } }] }; } };
    };

    const provider = createNarrativeProviderFromEnv({ logger });
    assert.ok(provider instanceof GatewayNarrativeProvider);
    assert.equal(provider.routingPolicy, 'local-only');
    assert.deepEqual(provider.providers.map((item) => item.id), ['fenix-local-llm']);
    assert.equal(await provider.createRoomEntry(roomContext()), 'Narração da GPU local.');
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test('local-preferred usa Groq somente após falha do node GPU local', async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  try {
    clearAiEnv();
    process.env.FENIX_AI_ROUTING_POLICY = 'local-preferred';
    process.env.FENIX_LOCAL_LLM_BASE_URL = 'http://gpu-ai.internal:8000/v1';
    process.env.FENIX_LOCAL_LLM_MODEL = 'fenix-local';
    process.env.GROQ_API_KEY = 'cloud-key';
    process.env.GROQ_MODEL = 'cloud-model';
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push(url);
      if (String(url).startsWith('http://gpu-ai.internal')) throw new Error('GPU local indisponível');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'cloud-model');
      assert.equal(body.max_completion_tokens, 400);
      assert.equal(options.headers.Authorization, 'Bearer cloud-key');
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: 'Fallback controlado.' } }] }; } };
    };

    const provider = createNarrativeProviderFromEnv({ logger });
    assert.equal(await provider.createRoomEntry(roomContext()), 'Fallback controlado.');
    assert.equal(calls.length, 2);
    assert.match(calls[0], /gpu-ai\.internal/);
    assert.match(calls[1], /api\.groq\.com/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test('local-only nunca envia narrativa para Groq mesmo quando cloud esta configurada', async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  try {
    clearAiEnv();
    process.env.FENIX_AI_ROUTING_POLICY = 'local-only';
    process.env.FENIX_LOCAL_LLM_BASE_URL = 'http://gpu-ai.internal:8000/v1';
    process.env.FENIX_LOCAL_LLM_MODEL = 'fenix-local';
    process.env.GROQ_API_KEY = 'cloud-key';
    process.env.GROQ_MODEL = 'cloud-model';
    let cloudCalls = 0;
    globalThis.fetch = async (url) => {
      if (String(url).includes('groq')) cloudCalls += 1;
      throw new Error('local offline');
    };

    const provider = createNarrativeProviderFromEnv({ logger });
    await assert.rejects(() => provider.createRoomEntry(roomContext()), (error) => error?.code === 'FENIX_AI_ALL_PROVIDERS_FAILED');
    assert.equal(cloudCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});

test('sem LLM local, configuracao Groq continua funcional via cloud-only', async () => {
  const saved = saveEnv();
  const originalFetch = globalThis.fetch;
  try {
    clearAiEnv();
    process.env.GROQ_API_KEY = 'cloud-key';
    process.env.GROQ_MODEL = 'cloud-model';
    globalThis.fetch = async (url) => {
      assert.match(String(url), /api\.groq\.com/);
      return { ok: true, status: 200, async json() { return { choices: [{ message: { content: 'Compatibilidade cloud.' } }] }; } };
    };
    const provider = createNarrativeProviderFromEnv({ logger });
    assert.equal(provider.routingPolicy, 'cloud-only');
    assert.equal(await provider.createRoomEntry(roomContext()), 'Compatibilidade cloud.');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(saved);
  }
});
