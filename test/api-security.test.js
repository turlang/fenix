import test from 'node:test';
import assert from 'node:assert/strict';
import {
  apiTokenMatches,
  buildSecurityHeaders,
  createFixedWindowRateLimiter,
  extractApiToken,
  isPublicApiPath
} from '../packages/api-security/src/index.js';

test('extrai token explícito ou Bearer sem expor comparação insegura', () => {
  assert.equal(extractApiToken({ 'x-mestre-orc-token': 'abc' }), 'abc');
  assert.equal(extractApiToken({ authorization: 'Bearer def' }), 'def');
  assert.equal(apiTokenMatches({ authorization: 'Bearer segredo-longo' }, 'segredo-longo'), true);
  assert.equal(apiTokenMatches({ authorization: 'Bearer incorreto' }, 'segredo-longo'), false);
});

test('gera cabeçalhos defensivos para respostas JSON', () => {
  const headers = buildSecurityHeaders({ requestId: 'req-1' });
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(headers['Content-Security-Policy'], /default-src 'none'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Request-Id'], 'req-1');
});

test('limitador de janela fixa bloqueia excesso e se recupera', () => {
  let current = 1_000;
  const limiter = createFixedWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => current });
  assert.equal(limiter.consume('ip').allowed, true);
  assert.equal(limiter.consume('ip').allowed, true);
  const blocked = limiter.consume('ip');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  current = 2_001;
  assert.equal(limiter.consume('ip').allowed, true);
});

test('mantém apenas saúde e prontidão como endpoints públicos', () => {
  assert.equal(isPublicApiPath('/health'), true);
  assert.equal(isPublicApiPath('/v1/release/readiness'), true);
  assert.equal(isPublicApiPath('/v1/session/status'), false);
});
