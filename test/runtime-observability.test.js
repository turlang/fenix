import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeObservability } from '../packages/runtime-observability/src/index.js';

test('observability agrega contadores e latência sem expor conteúdo de campanha', () => {
  const observability = new RuntimeObservability({
    instanceId: 'engine-a',
    logger: {},
    now: (() => {
      let value = 1000;
      return () => value += 10;
    })()
  });

  observability.record('http_proxy_attempt', {
    ownerId: 'engine-b',
    generation: 7,
    attempt: 1,
    durationMs: 12.5,
    transport: 'http'
  });
  observability.record('http_proxy_attempt', {
    ownerId: 'engine-b',
    generation: 7,
    attempt: 2,
    durationMs: 7.5,
    transport: 'http'
  });

  const snapshot = observability.snapshot();
  assert.equal(snapshot.instanceId, 'engine-a');
  assert.equal(snapshot.counters.http_proxy_attempt, 2);
  assert.equal(snapshot.latencies.http_proxy_attempt.averageMs, 10);
  assert.equal(snapshot.latencies.http_proxy_attempt.maxMs, 12.5);
  assert.equal(JSON.stringify(snapshot).includes('campaign content'), false);

  const metrics = observability.toPrometheus();
  assert.match(metrics, /fenix_runtime_events_total\{event="http_proxy_attempt"\} 2/);
  assert.match(metrics, /fenix_runtime_event_latency_ms/);
});
