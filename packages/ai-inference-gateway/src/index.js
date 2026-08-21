function gatewayError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

export const AiLocality = Object.freeze({
  LOCAL: 'local',
  CLOUD: 'cloud'
});

export const AiRoutingPolicy = Object.freeze({
  LOCAL_ONLY: 'local-only',
  LOCAL_PREFERRED: 'local-preferred',
  CLOUD_ONLY: 'cloud-only'
});

function normalizeProvider(provider) {
  if (!provider?.id || typeof provider.generateText !== 'function') {
    throw gatewayError('Provider de IA inválido.', 'FENIX_AI_PROVIDER_INVALID');
  }
  const locality = provider.locality === AiLocality.CLOUD ? AiLocality.CLOUD : AiLocality.LOCAL;
  return Object.freeze({ ...provider, id: text(provider.id, 120), locality });
}

export class AiInferenceGateway {
  constructor({ policy = AiRoutingPolicy.LOCAL_PREFERRED, logger = console } = {}) {
    if (!Object.values(AiRoutingPolicy).includes(policy)) {
      throw gatewayError('Política de roteamento de IA inválida.', 'FENIX_AI_ROUTING_POLICY_INVALID');
    }
    this.policy = policy;
    this.logger = logger;
    this.providers = new Map();
  }

  register(provider) {
    const normalized = normalizeProvider(provider);
    if (this.providers.has(normalized.id)) throw gatewayError('Provider de IA já registrado.', 'FENIX_AI_PROVIDER_DUPLICATE');
    this.providers.set(normalized.id, normalized);
    return normalized;
  }

  list() {
    return [...this.providers.values()].map(({ id, locality, model = null }) => ({ id, locality, model }));
  }

  async generateText(request = {}) {
    const candidates = this.#candidates();
    if (!candidates.length) throw gatewayError('Nenhum provider compatível disponível.', 'FENIX_AI_PROVIDER_UNAVAILABLE');

    let lastError = null;
    let lastProviderId = null;
    for (const provider of candidates) {
      try {
        if (typeof provider.health === 'function') {
          const health = await provider.health();
          if (health === false || health?.ok === false) continue;
        }
        const content = await provider.generateText(request);
        if (!String(content ?? '').trim()) throw gatewayError('Provider retornou conteúdo vazio.', 'FENIX_AI_EMPTY_RESPONSE');
        return Object.freeze({
          content: String(content).trim(),
          providerId: provider.id,
          locality: provider.locality,
          model: provider.model ?? null
        });
      } catch (error) {
        lastError = error;
        lastProviderId = provider.id;
        this.logger.warn?.('[Fênix][AI Gateway] provider falhou', {
          providerId: provider.id,
          locality: provider.locality,
          message: error?.message
        });
      }
    }

    const detail = text(lastError?.message, 220);
    const providerLabel = text(lastProviderId, 120);
    const suffix = detail
      ? ` Último erro${providerLabel ? ` (${providerLabel})` : ''}: ${detail}`
      : '';
    const failure = gatewayError(`Todos os providers de IA disponíveis falharam.${suffix}`, 'FENIX_AI_ALL_PROVIDERS_FAILED', lastError);
    failure.providerId = lastProviderId;
    failure.providerCode = lastError?.code ?? null;
    throw failure;
  }

  #candidates() {
    const providers = [...this.providers.values()];
    if (this.policy === AiRoutingPolicy.LOCAL_ONLY) return providers.filter((provider) => provider.locality === AiLocality.LOCAL);
    if (this.policy === AiRoutingPolicy.CLOUD_ONLY) return providers.filter((provider) => provider.locality === AiLocality.CLOUD);
    return providers.sort((a, b) => (a.locality === b.locality ? 0 : a.locality === AiLocality.LOCAL ? -1 : 1));
  }
}

export function createOpenAICompatibleTextProvider({
  id = 'local-openai-compatible',
  locality = AiLocality.LOCAL,
  baseUrl,
  apiKey = '',
  model,
  timeoutMs = 60_000,
  maxTokenField = 'max_tokens',
  extraBody = {},
  fetchImpl = globalThis.fetch
} = {}) {
  if (!baseUrl) throw gatewayError('baseUrl é obrigatório.', 'FENIX_AI_BASE_URL_REQUIRED');
  if (!model) throw gatewayError('model é obrigatório.', 'FENIX_AI_MODEL_REQUIRED');
  if (typeof fetchImpl !== 'function') throw gatewayError('fetch indisponível.', 'FENIX_AI_FETCH_REQUIRED');
  const endpoint = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`;
  const tokenField = ['max_tokens', 'max_completion_tokens'].includes(maxTokenField) ? maxTokenField : 'max_tokens';

  return Object.freeze({
    id: text(id, 120),
    locality: locality === AiLocality.CLOUD ? AiLocality.CLOUD : AiLocality.LOCAL,
    model: text(model, 200),
    async generateText(request = {}) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 60_000));
      try {
        const messages = Array.isArray(request.messages)
          ? request.messages
          : [
              ...(request.system ? [{ role: 'system', content: String(request.system) }] : []),
              { role: 'user', content: String(request.prompt ?? request.content ?? '') }
            ];
        const body = {
          model,
          messages,
          temperature: Number.isFinite(Number(request.temperature)) ? Number(request.temperature) : 0.7,
          top_p: Number.isFinite(Number(request.topP)) ? Number(request.topP) : 0.95,
          stream: false,
          ...extraBody,
          [tokenField]: Math.max(1, Number(request.maxTokens) || 800)
        };
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw gatewayError(payload?.error?.message || `Provider respondeu HTTP ${response.status}.`, 'FENIX_AI_PROVIDER_HTTP_ERROR');
        const content = payload?.choices?.[0]?.message?.content;
        if (!String(content ?? '').trim()) throw gatewayError('Resposta de IA vazia.', 'FENIX_AI_EMPTY_RESPONSE');
        return String(content).trim();
      } catch (error) {
        if (error?.name === 'AbortError') throw gatewayError('Provider de IA excedeu o timeout.', 'FENIX_AI_TIMEOUT', error);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }
  });
}
