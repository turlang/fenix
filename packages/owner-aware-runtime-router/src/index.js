import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const HEADER = Object.freeze({
  hop: 'x-fenix-route-hop',
  source: 'x-fenix-route-source',
  generation: 'x-fenix-route-generation',
  timestamp: 'x-fenix-route-timestamp',
  signature: 'x-fenix-route-signature'
});

const RETRYABLE_OWNER_ERRORS = new Set([
  'RUNTIME_LEASE_LOST',
  'RUNTIME_OWNER_CHANGED',
  'RUNTIME_LEASE_HELD'
]);
const IDEMPOTENT_TRANSPORT_ERRORS = new Set([
  'RUNTIME_OWNER_TIMEOUT',
  'RUNTIME_OWNER_UNREACHABLE'
]);

function routingError(message, code, statusCode = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return text(headers.get(name));
  return text(headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]);
}

function stableValue(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stableValue);
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) output[key] = stableValue(value[key]);
  }
  return output;
}

export function stableStringify(value) {
  return JSON.stringify(stableValue(value ?? null));
}

function bodyHash(body) {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

function canonicalRequest({ source, generation, timestamp, method, path, body }) {
  return [
    text(source, 200),
    String(Number(generation)),
    String(Number(timestamp)),
    text(method, 16).toUpperCase(),
    text(path, 2000),
    bodyHash(body)
  ].join('\n');
}

function hasCommandId(body, headers) {
  return Boolean(text(body?.commandId ?? body?.messageId, 300) || headerValue(headers, 'x-idempotency-key'));
}

export function normalizeOwnerBaseUrl(value) {
  const raw = text(value, 2000);
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw routingError('ownerUrl inválida.', 'RUNTIME_OWNER_URL_INVALID', 503);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw routingError('ownerUrl precisa usar HTTP(S) sem credenciais embutidas.', 'RUNTIME_OWNER_URL_INVALID', 503);
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}

export function resolveOwnerWebSocketUrl(ownerUrl, requestPath) {
  const base = normalizeOwnerBaseUrl(ownerUrl);
  if (!base) throw routingError('Owner não possui URL roteável.', 'RUNTIME_OWNER_URL_MISSING', 503);
  const url = new URL(text(requestPath, 2000) || '/v1/realtime', `${base}/`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function activeLease(lease, now = Date.now()) {
  const expiresAt = Date.parse(lease?.leaseUntil ?? '');
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export class RuntimeRoutingSigner {
  constructor({ secret, maxClockSkewMs = 30_000 } = {}) {
    const normalized = text(secret, 4096);
    if (normalized.length < 32) throw new TypeError('routing secret precisa ter pelo menos 32 caracteres.');
    this.secret = normalized;
    this.maxClockSkewMs = Math.max(1000, Number(maxClockSkewMs) || 30_000);
  }

  sign({ source, generation, method, path, body = null, timestamp = Date.now(), hop = 1 } = {}) {
    const payload = canonicalRequest({ source, generation, timestamp, method, path, body });
    const signature = createHmac('sha256', this.secret).update(payload).digest('hex');
    return {
      [HEADER.hop]: String(Math.max(1, Number(hop) || 1)),
      [HEADER.source]: text(source, 200),
      [HEADER.generation]: String(Number(generation)),
      [HEADER.timestamp]: String(Number(timestamp)),
      [HEADER.signature]: signature
    };
  }

  verify({ headers, method, path, body = null, now = Date.now() } = {}) {
    const hopRaw = headerValue(headers, HEADER.hop);
    if (!hopRaw) return Object.freeze({ routed: false, hop: 0 });
    const hop = Number.parseInt(hopRaw, 10);
    const source = headerValue(headers, HEADER.source);
    const generation = Number(headerValue(headers, HEADER.generation));
    const timestamp = Number(headerValue(headers, HEADER.timestamp));
    const signature = headerValue(headers, HEADER.signature);
    if (!Number.isInteger(hop) || hop !== 1 || !source || !Number.isFinite(generation) || !Number.isFinite(timestamp) || !signature) {
      throw routingError('Cabeçalhos internos de roteamento inválidos.', 'RUNTIME_ROUTING_AUTH_INVALID', 401);
    }
    if (Math.abs(now - timestamp) > this.maxClockSkewMs) {
      throw routingError('Assinatura interna de roteamento expirou.', 'RUNTIME_ROUTING_AUTH_EXPIRED', 401);
    }
    const expected = createHmac('sha256', this.secret)
      .update(canonicalRequest({ source, generation, timestamp, method, path, body }))
      .digest('hex');
    const receivedBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length || !timingSafeEqual(receivedBuffer, expectedBuffer)) {
      throw routingError('Assinatura interna de roteamento inválida.', 'RUNTIME_ROUTING_AUTH_INVALID', 401);
    }
    return Object.freeze({ routed: true, hop, source, generation, timestamp });
  }
}

export class OwnerAwareRuntimeRouter {
  constructor({
    instanceId,
    instancePublicUrl = null,
    leaseManager = null,
    resolveCampaignIdBySessionId = null,
    routingSecret = null,
    fetchImpl = globalThis.fetch,
    requestTimeoutMs = 5000,
    maxRetries = 1,
    observability = null,
    logger = console
  } = {}) {
    this.instanceId = text(instanceId, 200);
    if (!this.instanceId) throw new TypeError('instanceId é obrigatório.');
    this.instancePublicUrl = instancePublicUrl ? normalizeOwnerBaseUrl(instancePublicUrl) : null;
    this.leaseManager = leaseManager;
    this.resolveCampaignIdBySessionId = typeof resolveCampaignIdBySessionId === 'function'
      ? resolveCampaignIdBySessionId
      : null;
    this.signer = routingSecret ? new RuntimeRoutingSigner({ secret: routingSecret }) : null;
    if (fetchImpl != null && typeof fetchImpl !== 'function') throw new TypeError('fetchImpl deve ser função.');
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = Math.max(500, Number(requestTimeoutMs) || 5000);
    this.maxRetries = Math.max(0, Math.min(3, Number(maxRetries) || 0));
    this.observability = observability;
    this.logger = logger;
  }

  get enabled() {
    return Boolean(this.leaseManager && this.signer && this.fetchImpl);
  }

  record(event, attributes = {}) {
    this.observability?.record?.(event, { sourceId: this.instanceId, ...attributes });
  }

  verifyIncomingRequest(input) {
    if (!headerValue(input?.headers, HEADER.hop)) return Object.freeze({ routed: false, hop: 0 });
    if (!this.signer) {
      throw routingError('Roteamento interno não está configurado.', 'RUNTIME_ROUTING_AUTH_REQUIRED', 401);
    }
    return this.signer.verify(input);
  }

  createRoutingHeaders({ generation, method, path, body = null } = {}) {
    if (!this.signer) throw routingError('Roteamento interno não está configurado.', 'RUNTIME_ROUTING_NOT_CONFIGURED', 503);
    return this.signer.sign({
      source: this.instanceId,
      generation,
      method,
      path,
      body,
      hop: 1
    });
  }

  async resolve({ campaignId = null, sessionId = null } = {}) {
    let resolvedCampaignId = text(campaignId, 300);
    const resolvedSessionId = text(sessionId, 300);
    if (!resolvedCampaignId && resolvedSessionId && this.resolveCampaignIdBySessionId) {
      resolvedCampaignId = text(await this.resolveCampaignIdBySessionId(resolvedSessionId), 300);
    }
    if (!resolvedCampaignId || !this.leaseManager?.inspect) {
      this.record('route_resolved_unowned', { outcome: 'unowned' });
      return Object.freeze({ mode: 'unowned', campaignId: resolvedCampaignId || null, sessionId: resolvedSessionId || null });
    }

    const lease = await this.leaseManager.inspect(resolvedCampaignId);
    if (!activeLease(lease)) {
      this.record('route_resolved_unowned', { outcome: 'lease_inactive' });
      return Object.freeze({ mode: 'unowned', campaignId: resolvedCampaignId, sessionId: resolvedSessionId || lease?.sessionId || null });
    }
    const route = {
      campaignId: resolvedCampaignId,
      sessionId: resolvedSessionId || lease.sessionId || null,
      ownerId: lease.ownerId,
      ownerUrl: lease.ownerUrl ? normalizeOwnerBaseUrl(lease.ownerUrl) : null,
      generation: Number(lease.generation),
      leaseUntil: lease.leaseUntil
    };
    const mode = lease.ownerId === this.instanceId ? 'local' : 'remote';
    this.record(`route_resolved_${mode}`, { ownerId: lease.ownerId, generation: lease.generation, outcome: mode });
    return Object.freeze({ ...route, mode });
  }

  async executeHttp({
    campaignId = null,
    sessionId = null,
    method = 'GET',
    path,
    body = null,
    headers = {},
    routeContext = null,
    executeLocal
  } = {}) {
    if (typeof executeLocal !== 'function') throw new TypeError('executeLocal é obrigatório.');
    const normalizedPath = text(path, 2000) || '/';
    const incoming = routeContext ?? this.verifyIncomingRequest({ headers, method, path: normalizedPath, body });
    const replaySafe = hasCommandId(body, headers);
    let lastFailure = null;
    let lastRouteKey = null;

    const canRetry = (error) => RETRYABLE_OWNER_ERRORS.has(error?.code) || (replaySafe && IDEMPOTENT_TRANSPORT_ERRORS.has(error?.code));

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const route = await this.resolve({ campaignId, sessionId });
      if (incoming.routed && route.mode === 'remote') {
        this.record('http_route_owner_changed', { ownerId: route.ownerId, generation: route.generation, attempt, transport: 'http', code: 'RUNTIME_OWNER_CHANGED' });
        throw routingError('O owner do runtime mudou durante o encaminhamento.', 'RUNTIME_OWNER_CHANGED', 409, {
          ownerId: route.ownerId,
          ownerUrl: route.ownerUrl,
          generation: route.generation
        });
      }

      if (route.mode === 'remote') {
        if (!route.ownerUrl) {
          throw routingError('O owner remoto não publicou FENIX_INSTANCE_PUBLIC_URL.', 'RUNTIME_OWNER_URL_MISSING', 503, {
            ownerId: route.ownerId,
            generation: route.generation
          });
        }
        if (!this.enabled) {
          throw routingError('Roteamento interno distribuído não está configurado.', 'RUNTIME_ROUTING_NOT_CONFIGURED', 503, {
            ownerId: route.ownerId,
            ownerUrl: route.ownerUrl,
            generation: route.generation
          });
        }
        const routeKey = `${route.ownerId}:${route.generation}`;
        const repeatedSameRoute = attempt > 0 && routeKey === lastRouteKey;
        if (repeatedSameRoute && lastFailure && !replaySafe) throw lastFailure;
        lastRouteKey = routeKey;
        this.record('http_proxy_attempt', { ownerId: route.ownerId, generation: route.generation, attempt: attempt + 1, transport: 'http' });
        try {
          const startedAt = Date.now();
          const value = await this.#forwardHttp({ route, method, path: normalizedPath, body, headers });
          this.record('http_proxy_success', { ownerId: route.ownerId, generation: route.generation, attempt: attempt + 1, transport: 'http', outcome: replaySafe ? 'idempotent' : 'standard', durationMs: Date.now() - startedAt });
          return value;
        } catch (error) {
          lastFailure = error;
          this.record('http_proxy_failure', { ownerId: route.ownerId, generation: route.generation, attempt: attempt + 1, transport: 'http', code: error?.code });
          if (!canRetry(error) || attempt >= this.maxRetries) throw error;
          this.record('http_proxy_retry', { ownerId: route.ownerId, generation: route.generation, attempt: attempt + 2, transport: 'http', code: error?.code, outcome: replaySafe ? 'idempotent' : 'owner_change' });
          continue;
        }
      }

      try {
        const startedAt = Date.now();
        const value = await executeLocal();
        this.record('http_local_success', { ownerId: this.instanceId, generation: route.generation, attempt: attempt + 1, transport: 'http', durationMs: Date.now() - startedAt });
        return value;
      } catch (error) {
        lastFailure = error;
        this.record('http_local_failure', { ownerId: this.instanceId, generation: route.generation, attempt: attempt + 1, transport: 'http', code: error?.code });
        if (incoming.routed || !canRetry(error) || attempt >= this.maxRetries) throw error;
      }
    }
    throw lastFailure ?? routingError('Falha ao resolver owner do runtime.', 'RUNTIME_ROUTING_FAILED', 503);
  }

  async #forwardHttp({ route, method, path, body, headers }) {
    const target = new URL(path, `${route.ownerUrl}/`).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const internalHeaders = this.createRoutingHeaders({ generation: route.generation, method, path, body });
    const forwardedHeaders = {
      ...internalHeaders,
      'content-type': 'application/json'
    };
    const cookie = headerValue(headers, 'cookie');
    const authorization = headerValue(headers, 'authorization');
    const idempotencyKey = headerValue(headers, 'x-idempotency-key');
    if (cookie) forwardedHeaders.cookie = cookie;
    if (authorization) forwardedHeaders.authorization = authorization;
    if (idempotencyKey) forwardedHeaders['x-idempotency-key'] = idempotencyKey;

    try {
      const response = await this.fetchImpl(target, {
        method,
        headers: forwardedHeaders,
        body: String(method).toUpperCase() === 'GET' || body == null ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      const contentType = response.headers?.get?.('content-type') ?? '';
      const payload = contentType.includes('application/json')
        ? await response.json()
        : { message: await response.text() };
      if (!response.ok) {
        throw routingError(payload?.message || `Owner respondeu HTTP ${response.status}.`, payload?.code || 'RUNTIME_OWNER_REQUEST_FAILED', response.status, {
          retryAfter: payload?.retryAfter ?? null
        });
      }
      return payload;
    } catch (error) {
      if (error?.code) throw error;
      if (error?.name === 'AbortError') {
        throw routingError('Owner não respondeu dentro do tempo limite.', 'RUNTIME_OWNER_TIMEOUT', 504);
      }
      this.logger.warn?.('[Fênix][RuntimeRouter] owner HTTP indisponível', {
        ownerId: route.ownerId,
        ownerUrl: route.ownerUrl,
        message: error?.message
      });
      throw routingError('Não foi possível alcançar o owner do runtime.', 'RUNTIME_OWNER_UNREACHABLE', 503);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createRuntimeRoutingError(message, code, statusCode, details) {
  return routingError(message, code, statusCode, details);
}
