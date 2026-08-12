import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig, isOriginAllowed } from '../packages/config/src/index.js';

test('configuração aplica padrões seguros de desenvolvimento', () => {
  const config = createConfig({});
  assert.equal(config.port, 3001);
  assert.equal(config.trustProxy, false);
  assert.equal(config.allowLegacySessionHttp, true);
  assert.equal(config.authCookieSameSite, 'Lax');
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

test('configuração rejeita porta e SameSite inválidos', () => {
  assert.throws(() => createConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => createConfig({ FENIX_AUTH_COOKIE_SAME_SITE: 'insecure' }), /SameSite/);
});

test('configuração interpreta origens, proxy e compatibilidade explicitamente', () => {
  const config = createConfig({
    NODE_ENV: 'production',
    PORT: '8080',
    TRUST_PROXY: 'true',
    FENIX_ALLOW_LEGACY_SESSION_HTTP: 'true',
    FENIX_AUTH_COOKIE_SAME_SITE: 'Strict',
    CORS_ALLOWED_ORIGINS: 'https://app.example, https://foundry.example'
  });
  assert.equal(config.isProduction, true);
  assert.equal(config.trustProxy, true);
  assert.equal(config.allowLegacySessionHttp, true);
  assert.equal(config.authCookieSameSite, 'Strict');
  assert.deepEqual(config.allowedOrigins, [
    'http://localhost:30000',
    'http://127.0.0.1:30000',
    'https://app.example',
    'https://foundry.example'
  ]);
});
