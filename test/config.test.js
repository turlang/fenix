import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../packages/config/src/index.js';

test('configuração aplica padrões seguros de desenvolvimento', () => {
  const config = createConfig({});
  assert.equal(config.port, 3001);
  assert.equal(config.trustProxy, false);
  assert.deepEqual(config.allowedOrigins, ['http://localhost:3000', 'http://localhost:3001']);
  assert.equal(Object.isFrozen(config), true);
});

test('configuração rejeita porta inválida', () => {
  assert.throws(() => createConfig({ PORT: '70000' }), /PORT/);
});

test('configuração interpreta origens e proxy explicitamente', () => {
  const config = createConfig({
    NODE_ENV: 'production',
    PORT: '8080',
    TRUST_PROXY: 'true',
    CORS_ALLOWED_ORIGINS: 'https://app.example, https://foundry.example'
  });
  assert.equal(config.isProduction, true);
  assert.equal(config.trustProxy, true);
  assert.deepEqual(config.allowedOrigins, ['https://app.example', 'https://foundry.example']);
});
