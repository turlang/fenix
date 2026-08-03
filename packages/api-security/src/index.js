import { timingSafeEqual } from 'node:crypto';

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? headers?.[name.toUpperCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeApiToken(value) {
  return String(value ?? '').trim();
}

export function extractApiToken(headers = {}) {
  const explicit = normalizeApiToken(headerValue(headers, 'x-mestre-orc-token'));
  if (explicit) return explicit;
  const authorization = normalizeApiToken(headerValue(headers, 'authorization'));
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return normalizeApiToken(match?.[1]);
}

export function apiTokenMatches(headers, expectedToken) {
  const expected = Buffer.from(normalizeApiToken(expectedToken));
  const received = Buffer.from(extractApiToken(headers));
  if (!expected.length || expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function buildSecurityHeaders({ requestId = null } = {}) {
  return Object.freeze({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Permissions-Policy': 'camera=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(requestId ? { 'X-Request-Id': String(requestId) } : {})
  });
}

export function createFixedWindowRateLimiter({ limit = 180, windowMs = 60_000, now = () => Date.now() } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('O limite deve ser um inteiro positivo.');
  if (!Number.isInteger(windowMs) || windowMs < 1000) throw new RangeError('A janela deve possuir ao menos 1000 ms.');
  const buckets = new Map();

  function consume(key) {
    const timestamp = now();
    const bucketKey = String(key || 'anonymous');
    let bucket = buckets.get(bucketKey);
    if (!bucket || timestamp >= bucket.resetAt) {
      bucket = { count: 0, resetAt: timestamp + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, limit - bucket.count);
    return Object.freeze({
      allowed: bucket.count <= limit,
      limit,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1000))
    });
  }

  function cleanup() {
    const timestamp = now();
    for (const [key, bucket] of buckets) {
      if (timestamp >= bucket.resetAt) buckets.delete(key);
    }
  }

  return Object.freeze({ consume, cleanup, size: () => buckets.size });
}

export function isPublicApiPath(pathname) {
  return pathname === '/health' || pathname === '/v1/release/readiness';
}
