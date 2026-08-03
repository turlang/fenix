import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AnthropicMessagesTransport,
  createNarrativeProviderFromEnv,
  OpenAICompatibleChatTransport,
  OpenAIResponsesTransport,
  ResilientNarrativeProvider
} from '../packages/ai-provider/src/index.js';

function fakeNarrativeProvider(handler, model = 'test-model') {
  return {
    model,
    createOpening: handler,
    createRoomEntry: handler,
    narrateResolution: handler,
    narrateRound: handler,
    narrateCombatTurn: handler,
    narrateCombatRound: handler
  };
}

function response(payload, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    async json() { return payload; }
  };
}

test('fallback usa o segundo provedor quando o primário falha', async () => {
  const calls = [];
  const provider = new ResilientNarrativeProvider({
    providers: [
      { id: 'primary', provider: fakeNarrativeProvider(async () => { calls.push('primary'); throw new Error('indisponível'); }) },
      { id: 'backup', provider: fakeNarrativeProvider(async () => { calls.push('backup'); return 'narração de backup'; }) }
    ],
    failureThreshold: 2,
    cooldownMs: 1000,
    logger: {}
  });

  assert.equal(await provider.createOpening({}), 'narração de backup');
  assert.deepEqual(calls, ['primary', 'backup']);
  const status = provider.getStatus();
  assert.equal(status.activeProvider, 'backup');
  assert.equal(status.metrics.fallbackSuccesses, 1);
  assert.equal(status.providers[0].consecutiveFailures, 1);
});

test('circuit breaker abre, ignora o provedor e testa novamente após cooldown', async () => {
  let now = 1_000;
  let primaryFails = true;
  let primaryCalls = 0;
  const primary = fakeNarrativeProvider(async () => {
    primaryCalls += 1;
    if (primaryFails) throw new Error('falha primária');
    return 'primário recuperado';
  });
  const backup = fakeNarrativeProvider(async () => 'backup');
  const provider = new ResilientNarrativeProvider({
    providers: [{ id: 'primary', provider: primary }, { id: 'backup', provider: backup }],
    failureThreshold: 2,
    cooldownMs: 500,
    logger: {},
    clock: () => now
  });

  await provider.createOpening({});
  await provider.createOpening({});
  assert.equal(provider.getStatus().providers[0].state, 'OPEN');
  await provider.createOpening({});
  assert.equal(primaryCalls, 2, 'circuito aberto deve pular o provedor');

  primaryFails = false;
  now += 501;
  assert.equal(await provider.createOpening({}), 'primário recuperado');
  assert.equal(provider.getStatus().providers[0].state, 'CLOSED');
  assert.equal(primaryCalls, 3);
});

test('erro agregado não expõe credenciais quando todos os provedores falham', async () => {
  const provider = new ResilientNarrativeProvider({
    providers: [{ id: 'only', provider: fakeNarrativeProvider(async () => { throw new Error('token secreto 123'); }) }],
    failureThreshold: 1,
    cooldownMs: 1000,
    logger: {}
  });
  await assert.rejects(
    provider.createOpening({}),
    (error) => error.code === 'AI_PROVIDERS_UNAVAILABLE' && error.statusCode === 503 && Array.isArray(error.failures) && !JSON.stringify(error.failures).includes('token secreto')
  );
});

test('factory respeita a ordem configurada e cria apenas provedores completos', () => {
  const provider = createNarrativeProviderFromEnv({
    env: {
      AI_PROVIDER_ORDER: 'anthropic,groq,openai',
      GROQ_API_KEY: 'g',
      GROQ_MODEL: 'groq-model',
      ANTHROPIC_API_KEY: 'a',
      ANTHROPIC_MODEL: 'claude-model',
      OPENAI_API_KEY: 'incompleta'
    },
    fetchImpl: async () => response({}),
    logger: {}
  });
  assert.deepEqual(provider.getStatus().order, ['anthropic', 'groq']);
  assert.equal(provider.getStatus().primaryProvider, 'anthropic');
});

test('transporte OpenAI Responses envia o contrato esperado e extrai output_text', async () => {
  let captured;
  const transport = new OpenAIResponsesTransport({
    id: 'openai', apiKey: 'key', model: 'model', baseUrl: 'https://api.example/v1',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({ output_text: 'texto final' });
    },
    logger: {}
  });
  assert.equal(await transport.generateText({ prompt: 'teste', maxTokens: 50, temperature: 0.5, topP: 0.9 }), 'texto final');
  assert.equal(captured.url, 'https://api.example/v1/responses');
  assert.equal(captured.body.max_output_tokens, 50);
  assert.equal(captured.options.headers.Authorization, 'Bearer key');
});

test('transporte Anthropic usa Messages API e concatena blocos de texto', async () => {
  let captured;
  const transport = new AnthropicMessagesTransport({
    id: 'anthropic', apiKey: 'key', model: 'model', baseUrl: 'https://api.example/v1',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({ content: [{ type: 'text', text: 'primeiro' }, { type: 'text', text: 'segundo' }] });
    },
    logger: {}
  });
  assert.equal(await transport.generateText({ prompt: 'teste', maxTokens: 60, temperature: 0.4, topP: 0.8 }), 'primeiro\nsegundo');
  assert.equal(captured.url, 'https://api.example/v1/messages');
  assert.equal(captured.options.headers['x-api-key'], 'key');
  assert.equal(captured.body.max_tokens, 60);
});

test('transporte OpenAI-compatible permite endpoint local sem chave', async () => {
  let captured;
  const transport = new OpenAICompatibleChatTransport({
    id: 'local', model: 'local-model', baseUrl: 'http://127.0.0.1:11434/v1', maxTokensField: 'max_tokens',
    fetchImpl: async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return response({ choices: [{ message: { content: 'resposta local' } }] });
    },
    logger: {}
  });
  assert.equal(await transport.generateText({ prompt: 'teste', maxTokens: 70, temperature: 0.3, topP: 0.7 }), 'resposta local');
  assert.equal(captured.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(captured.options.headers.Authorization, undefined);
  assert.equal(captured.body.max_tokens, 70);
});


test('endpoint compatível usa o identificador configurado no status e no rearme', () => {
  const provider = createNarrativeProviderFromEnv({
    env: {
      AI_PROVIDER_ORDER: 'local-rpg',
      AI_COMPATIBLE_ID: 'local-rpg',
      AI_COMPATIBLE_MODEL: 'modelo-local',
      AI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:11434/v1'
    },
    fetchImpl: async () => response({}),
    logger: {}
  });
  assert.deepEqual(provider.getStatus().order, ['local-rpg']);
  assert.equal(provider.resetProvider('local-rpg'), true);
  assert.equal(provider.resetProvider('compatible'), false);
});

test('erro permanente de autenticação abre o circuito imediatamente', async () => {
  const authError = Object.assign(new Error('credencial inválida'), { statusCode: 401, code: 'AI_PROVIDER_HTTP_ERROR' });
  const provider = new ResilientNarrativeProvider({
    providers: [
      { id: 'primary', provider: fakeNarrativeProvider(async () => { throw authError; }) },
      { id: 'backup', provider: fakeNarrativeProvider(async () => 'backup') }
    ],
    failureThreshold: 5,
    cooldownMs: 1000,
    logger: {}
  });
  assert.equal(await provider.createOpening({}), 'backup');
  const primary = provider.getStatus().providers[0];
  assert.equal(primary.state, 'OPEN');
  assert.equal(primary.lastErrorMessage, 'A credencial foi recusada pelo provedor.');
});
