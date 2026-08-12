function text(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function metricName(value) {
  return text(value, 120).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function finiteMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export class RuntimeObservability {
  constructor({ instanceId, logger = console, historyLimit = 100, now = () => Date.now() } = {}) {
    this.instanceId = text(instanceId, 200) || 'unknown';
    this.logger = logger;
    this.historyLimit = Math.max(10, Math.min(1000, Number(historyLimit) || 100));
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.startedAt = new Date(this.now()).toISOString();
    this.counters = new Map();
    this.latencies = new Map();
    this.recent = [];
  }

  record(event, attributes = {}) {
    const name = metricName(event);
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    const durationMs = finiteMs(attributes.durationMs);
    if (durationMs != null) {
      const current = this.latencies.get(name) ?? { count: 0, totalMs: 0, maxMs: 0 };
      current.count += 1;
      current.totalMs += durationMs;
      current.maxMs = Math.max(current.maxMs, durationMs);
      this.latencies.set(name, current);
    }
    const entry = {
      event: name,
      at: new Date(this.now()).toISOString(),
      ownerId: text(attributes.ownerId, 200) || null,
      sourceId: text(attributes.sourceId, 200) || null,
      generation: Number.isFinite(Number(attributes.generation)) ? Number(attributes.generation) : null,
      attempt: Number.isFinite(Number(attributes.attempt)) ? Number(attributes.attempt) : null,
      transport: text(attributes.transport, 40) || null,
      outcome: text(attributes.outcome, 80) || null,
      code: text(attributes.code, 120) || null,
      durationMs
    };
    this.recent.push(entry);
    if (this.recent.length > this.historyLimit) this.recent.splice(0, this.recent.length - this.historyLimit);
    this.logger.info?.('[Fênix][RuntimeObservability]', entry);
    return entry;
  }

  snapshot() {
    const latencies = {};
    for (const [name, value] of this.latencies.entries()) {
      latencies[name] = {
        count: value.count,
        averageMs: value.count ? Math.round((value.totalMs / value.count) * 100) / 100 : 0,
        maxMs: Math.round(value.maxMs * 100) / 100
      };
    }
    return {
      instanceId: this.instanceId,
      startedAt: this.startedAt,
      counters: Object.fromEntries([...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))),
      latencies,
      recent: this.recent.slice(-20).map((entry) => ({ ...entry }))
    };
  }

  toPrometheus() {
    const lines = [
      '# HELP fenix_runtime_events_total Runtime routing, failover and idempotency events.',
      '# TYPE fenix_runtime_events_total counter'
    ];
    for (const [name, count] of [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`fenix_runtime_events_total{event="${name}"} ${count}`);
    }
    lines.push('# HELP fenix_runtime_event_latency_ms Runtime event latency summary in milliseconds.');
    lines.push('# TYPE fenix_runtime_event_latency_ms gauge');
    for (const [name, value] of [...this.latencies.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const average = value.count ? value.totalMs / value.count : 0;
      lines.push(`fenix_runtime_event_latency_ms{event="${name}",stat="avg"} ${average.toFixed(3)}`);
      lines.push(`fenix_runtime_event_latency_ms{event="${name}",stat="max"} ${value.maxMs.toFixed(3)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}

export function createRuntimeObservability(options) {
  return new RuntimeObservability(options);
}
