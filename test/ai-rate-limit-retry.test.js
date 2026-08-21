import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiInferenceGateway,
  AiLocality,
  AiRoutingPolicy,
  createOpenAICompatibleTextProvider
} from '../packages/ai-inference-gateway/src/index.js';

function response({ ok, status, payload, retryAfter = null }) {
  return {
    ok,
    status,
    headers: { get(name) { return String(name).toLowerCase() === 'retry-after' ? retryAfter : null; } },
    async json() { return payload; }
  };
}

test('provider respeita Retry-After e repete uma vez após HTTP 429', async () => {
  let calls = 0;
  const provider = createOpenAICompatibleTextProvider({
    id: 'groq-test',
    locality: AiLocality.CLOUD,
    baseUrl: 'https://api.example.test/v1',
    model: 'model-test',
    rateLimitRetries: 1,
    maxRateLimitWaitMs: 100,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return response({
          ok: false,
          status: 429,
          retryAfter: '0',
          payload: { error: { message: 'Rate limit reached.' } }
        });
      }
      return response({
        ok: true,
        status: 200,
        payload: { choices: [{ message: { content: 'Narração liberada após aguardar a cota.' } }] }
      });
    }
  });

  assert.equal(await provider.generateText({ prompt: 'Abra a cena.', maxTokens: 120 }), 'Narração liberada após aguardar a cota.');
  assert.equal(calls, 2);
});

test('gateway preserva HTTP 429 e Retry-After quando a cota continua bloqueada', async () => {
  const provider = createOpenAICompatibleTextProvider({
    id: 'groq-test',
    locality: AiLocality.CLOUD,
    baseUrl: 'https://api.example.test/v1',
    model: 'model-test',
    rateLimitRetries: 0,
    fetchImpl: async () => response({
      ok: false,
      status: 429,
      retryAfter: '12',
      payload: { error: { message: 'Rate limit reached.' } }
    })
  });
  const gateway = new AiInferenceGateway({ policy: AiRoutingPolicy.CLOUD_ONLY, logger: { warn() {} } });
  gateway.register(provider);

  await assert.rejects(
    () => gateway.generateText({ prompt: 'Abra a cena.' }),
    (error) => {
      assert.equal(error.code, 'FENIX_AI_ALL_PROVIDERS_FAILED');
      assert.equal(error.providerCode, 'FENIX_AI_RATE_LIMIT');
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfter, '12');
      return true;
    }
  );
});
