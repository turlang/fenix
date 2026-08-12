import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, isOriginAllowed } from '../packages/config/src/index.js';

test('configuração aplica padrões seguros de desenvolvimento', () => {
  const config = createConfig({});
  assert.equal(config.port, 3001);
  assert.equal(config.trustProxy, false);
  assert.equal(config.allowLegacySessionHttp, true);
  assert.equal(config.authCookieSameSite, 'Lax');
  assert.equal(config.internalRoutingSecret, null);
  assert.equal(config.runtimeRoutingTimeoutMs, 5000);
  assert.equal(config.runtimeRoutingMaxRetries, 1);
  assert.equal(config.runtimeLeaseTtlMs, 15000);
  assert.equal(config.runtimeHeartbeatMs, 5000);
  assert.equal(config.runtimeReconcileMs, 5000);
  assert.deepEqual(config.allowedOrigins, [
    'http://localhost:30000',
    'http://127.0.0.1:30000',
    'http://localhost:3000',
    'http://localhost:3001'
  ]);
  assert.equal(Object.isFrozen(config), true);
});

test('produção fecha HTTP legado e prepara cookie cross-site seguro por padrão', () => {
  const config = createConfig({ NODE_ENV: 'production' });
  assert.equal(config.allowLegacySessionHttp, false);
  assert.equal(config.authCookieSameSite, 'None');
});

test('CORS permite Foundry em rede local na porta padrão', () => {
  assert.equal(isOriginAllowed('http://192.168.1.110:30000', []), true);
  assert.equal(isOriginAllowed('http://10.0.0.15:30000', []), true);
  assert.equal(isOriginAllowed('http://172.20.1.5:30000', []), true);
  assert.equal(isOriginAllowed('http://192.168.1.110:8080', []), false);
  assert.equal(isOriginAllowed('https://example.com:30000', []), false);
});

test('configuração rejeita porta, SameSite, heartbeat e secret de roteamento inválidos', () => {
  assert.throws(() => createConfig({ PORT: '70000' }), /PORT/);
  assert.throws(
    () => createConfig({ FENIX_AUTH_COOKIE_SAME_SITE: 'insecure' }),
    /FENIX_AUTH_COOKIE_SAME_SITE/
  );
  assert.throws(
    () => createConfig({ FENIX_RUNTIME_LEASE_TTL_MS: '5000', FENIX_RUNTIME_HEARTBEAT_MS: '5000' }),
    /HEARTBEAT/
  );
  assert.throws(
    () => createConfig({ FENIX_INTERNAL_ROUTING_SECRET: 'curto' }),
    /FENIX_INTERNAL_ROUTING_SECRET/
  );
});

test('configuração interpreta origens, proxy, identidade e coordenação explicitamente', () => {
  const config = createConfig({
    NODE_ENV: 'production',
    PORT: '8080',
    TRUST_PROXY: 'true',
    FENIX_ALLOW_LEGACY_SESSION_HTTP: 'true',
    FENIX_AUTH_COOKIE_SAME_SITE: 'Strict',
    FENIX_INSTANCE_ID: 'engine-a',
    FENIX_INSTANCE_PUBLIC_URL: 'https://engine-a.example',
    FENIX_INTERNAL_ROUTING_SECRET: '0123456789abcdef0123456789abcdef',
    FENIX_RUNTIME_ROUTING_TIMEOUT_MS: '4000',
    FENIX_RUNTIME_ROUTING_MAX_RETRIES: '2',
    FENIX_RUNTIME_LEASE_TTL_MS: '20000',
    FENIX_RUNTIME_HEARTBEAT_MS: '4000',
    FENIX_RUNTIME_RECONCILE_MS: '3000',
    CORS_ALLOWED_ORIGINS: 'https://app.example, https://foundry.example'
  });
  assert.equal(config.isProduction, true);
  assert.equal(config.trustProxy, true);
  assert.equal(config.allowLegacySessionHttp, true);
  assert.equal(config.authCookieSameSite, 'Strict');
  assert.equal(config.instanceId, 'engine-a');
  assert.equal(config.instancePublicUrl, 'https://engine-a.example');
  assert.equal(config.internalRoutingSecret, '0123456789abcdef0123456789abcdef');
  assert.equal(config.runtimeRoutingTimeoutMs, 4000);
  assert.equal(config.runtimeRoutingMaxRetries, 2);
  assert.equal(config.runtimeLeaseTtlMs, 20000);
  assert.equal(config.runtimeHeartbeatMs, 4000);
  assert.equal(config.runtimeReconcileMs, 3000);
  assert.deepEqual(config.allowedOrigins, [
    'http://localhost:30000',
    'http://127.0.0.1:30000',
    'https://app.example',
    'https://foundry.example'
  ]);
});
