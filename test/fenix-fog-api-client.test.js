import test from 'node:test';
import assert from 'node:assert/strict';
import { FenixApiClient } from '../apps/fenix-vtt/lib/fenix-api-client.js';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async json() { return payload; },
    async text() { return JSON.stringify(payload); }
  };
}

test('FenixApiClient envia configuração de Fog para a cena autenticada', async () => {
  const calls = [];
  const client = new FenixApiClient({
    baseUrl: 'http://engine.test',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return jsonResponse({ scene: { id: 'scene-1', fog: { enabled: true } } });
    }
  });

  await client.updateSceneFog('campaign-1', 'scene-1', {
    enabled: true,
    visionRangeCells: 9,
    exploredOpacity: 0.5,
    unexploredOpacity: 0.95,
    resetExploration: false
  });

  assert.equal(calls[0].url, 'http://engine.test/v1/campaigns/campaign-1/scenes/scene-1/fog');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    enabled: true,
    visionRangeCells: 9,
    exploredOpacity: 0.5,
    unexploredOpacity: 0.95,
    resetExploration: false
  });
});
