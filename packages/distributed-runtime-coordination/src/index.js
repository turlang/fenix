import { randomUUID } from 'node:crypto';

const LEASE_SCHEMA_LOCK = 734611902;
const DEFAULT_CHANNEL = 'fenix_state_changed';

function coordinationError(message, code, statusCode = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function boundedText(value, maxLength = 300) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function integer(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function normalizeLease(row) {
  if (!row) return null;
  return Object.freeze({
    campaignId: String(row.campaign_id),
    ownerId: String(row.owner_id),
    ownerUrl: row.owner_url ? String(row.owner_url) : null,
    sessionId: row.session_id ? String(row.session_id) : null,
    generation: Number(row.generation),
    leaseUntil: new Date(row.lease_until).toISOString(),
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  });
}

function validateChannel(channel) {
  const normalized = boundedText(channel, 63).toLowerCase();
  if (!/^[a-z_][a-z0-9_]*$/.test(normalized)) throw new TypeError('Canal PostgreSQL inválido.');
  return normalized;
}

export class PostgresStateBus {
  constructor({ pool, instanceId = randomUUID(), channel = DEFAULT_CHANNEL, logger = console } = {}) {
    if (!pool?.connect || !pool?.query) throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
    this.instanceId = boundedText(instanceId, 200) || randomUUID();
    this.channel = validateChannel(channel);
    this.logger = logger;
    this.client = null;
    this.listeners = new Set();
    this.closed = false;
    this.reconnectTimer = null;
    this.connecting = null;
  }

  async initialize() {
    this.closed = false;
    await this.#connectListener();
    return { instanceId: this.instanceId, channel: this.channel, listening: true };
  }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener deve ser função.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(type, payload = {}) {
    const event = {
      id: randomUUID(),
      instanceId: this.instanceId,
      type: boundedText(type, 100) || 'STATE_CHANGED',
      payload: payload && typeof payload === 'object' ? payload : {},
      createdAt: new Date().toISOString()
    };
    const serialized = JSON.stringify(event);
    if (Buffer.byteLength(serialized, 'utf8') > 7000) {
      throw coordinationError('Evento de coordenação excede o limite seguro do PostgreSQL NOTIFY.', 'COORDINATION_EVENT_TOO_LARGE', 400);
    }
    await this.pool.query('SELECT pg_notify($1, $2)', [this.channel, serialized]);
    return event;
  }

  async close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    if (client) {
      await client.query(`UNLISTEN "${this.channel}"`).catch(() => undefined);
      client.release?.();
    }
    this.listeners.clear();
  }

  async #connectListener() {
    if (this.closed) return false;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = await this.pool.connect();
      const onNotification = (message) => this.#handleNotification(message);
      const onError = (error) => {
        this.logger.error?.('[Fênix][CoordinationBus] listener PostgreSQL indisponível', { message: error.message });
        if (this.client === client) this.client = null;
        try { client.release?.(true); } catch { /* noop */ }
        this.#scheduleReconnect();
      };
      client.on?.('notification', onNotification);
      client.on?.('error', onError);
      await client.query(`LISTEN "${this.channel}"`);
      if (this.closed) {
        client.release?.();
        return false;
      }
      this.client = client;
      return true;
    })().finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  #scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#connectListener().catch((error) => {
        this.logger.warn?.('[Fênix][CoordinationBus] falha ao reconectar LISTEN', { message: error.message });
        this.#scheduleReconnect();
      });
    }, 1000);
    this.reconnectTimer.unref?.();
  }

  #handleNotification(message) {
    if (message?.channel !== this.channel || !message.payload) return;
    let event;
    try {
      event = JSON.parse(message.payload);
    } catch {
      this.logger.warn?.('[Fênix][CoordinationBus] NOTIFY inválido ignorado.');
      return;
    }
    if (!event || event.instanceId === this.instanceId) return;
    for (const listener of this.listeners) {
      Promise.resolve().then(() => listener(event)).catch((error) => {
        this.logger.error?.('[Fênix][CoordinationBus] subscriber falhou', { message: error.message, type: event.type });
      });
    }
  }
}

export class PostgresRuntimeLeaseManager {
  constructor({
    pool,
    instanceId = randomUUID(),
    instanceUrl = null,
    leaseTtlMs = 15000,
    heartbeatIntervalMs = 5000,
    publishEvent = null,
    logger = console
  } = {}) {
    if (!pool?.connect || !pool?.query) throw new TypeError('pool PostgreSQL é obrigatório.');
    this.pool = pool;
    this.instanceId = boundedText(instanceId, 200) || randomUUID();
    this.instanceUrl = boundedText(instanceUrl, 500) || null;
    this.leaseTtlMs = integer(leaseTtlMs, 15000, { min: 500, max: 300000 });
    this.heartbeatIntervalMs = integer(heartbeatIntervalMs, 5000, { min: 250, max: 120000 });
    if (this.heartbeatIntervalMs >= this.leaseTtlMs) {
      throw new RangeError('heartbeatIntervalMs deve ser menor que leaseTtlMs.');
    }
    this.publishEvent = typeof publishEvent === 'function' ? publishEvent : null;
    this.logger = logger;
    this.owned = new Map();
    this.heartbeatTimer = null;
    this.onLeaseLost = null;
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [LEASE_SCHEMA_LOCK]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS fenix_runtime_leases (
          campaign_id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          owner_url TEXT,
          session_id TEXT,
          generation BIGINT NOT NULL DEFAULT 1,
          lease_until TIMESTAMPTZ NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return { instanceId: this.instanceId, leaseTtlMs: this.leaseTtlMs };
  }

  async acquire({ campaignId, sessionId = null } = {}) {
    const id = boundedText(campaignId, 300);
    if (!id) throw coordinationError('campaignId é obrigatório para adquirir lease.', 'RUNTIME_LEASE_CAMPAIGN_REQUIRED', 400);
    const result = await this.pool.query(
      `INSERT INTO fenix_runtime_leases
        (campaign_id, owner_id, owner_url, session_id, generation, lease_until, updated_at)
       VALUES ($1, $2, $3, $4, 1, NOW() + ($5 * INTERVAL '1 millisecond'), NOW())
       ON CONFLICT (campaign_id) DO UPDATE
       SET owner_id = EXCLUDED.owner_id,
           owner_url = EXCLUDED.owner_url,
           session_id = COALESCE(EXCLUDED.session_id, fenix_runtime_leases.session_id),
           generation = CASE
             WHEN fenix_runtime_leases.owner_id = EXCLUDED.owner_id THEN fenix_runtime_leases.generation
             ELSE fenix_runtime_leases.generation + 1
           END,
           lease_until = EXCLUDED.lease_until,
           updated_at = NOW()
       WHERE fenix_runtime_leases.lease_until <= NOW()
          OR fenix_runtime_leases.owner_id = EXCLUDED.owner_id
       RETURNING *`,
      [id, this.instanceId, this.instanceUrl, boundedText(sessionId, 300) || null, this.leaseTtlMs]
    );
    const lease = normalizeLease(result.rows?.[0]);
    if (!lease) {
      const holder = await this.inspect(id);
      const retryAfter = holder?.leaseUntil
        ? Math.max(1, Math.ceil((Date.parse(holder.leaseUntil) - Date.now()) / 1000))
        : 1;
      throw coordinationError('Runtime desta campanha pertence a outra instância.', 'RUNTIME_LEASE_HELD', 409, {
        retryAfter,
        ownerId: holder?.ownerId ?? null,
        ownerUrl: holder?.ownerUrl ?? null,
        leaseUntil: holder?.leaseUntil ?? null
      });
    }
    this.owned.set(id, lease);
    await this.#publish('RUNTIME_LEASE_ACQUIRED', lease);
    return lease;
  }

  async bindSession(campaignId, generation, sessionId) {
    const id = boundedText(campaignId, 300);
    const sid = boundedText(sessionId, 300);
    const result = await this.pool.query(
      `UPDATE fenix_runtime_leases
       SET session_id = $4, lease_until = NOW() + ($5 * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE campaign_id = $1 AND owner_id = $2 AND generation = $3 AND lease_until > NOW()
       RETURNING *`,
      [id, this.instanceId, Number(generation), sid || null, this.leaseTtlMs]
    );
    const lease = normalizeLease(result.rows?.[0]);
    if (!lease) throw coordinationError('Lease perdido antes de vincular sessionId.', 'RUNTIME_LEASE_LOST', 409);
    this.owned.set(id, lease);
    return lease;
  }

  async renew(campaignId, generation = null) {
    const id = boundedText(campaignId, 300);
    const current = this.owned.get(id);
    const token = Number(generation ?? current?.generation);
    if (!id || !Number.isFinite(token)) return null;
    const result = await this.pool.query(
      `UPDATE fenix_runtime_leases
       SET lease_until = NOW() + ($4 * INTERVAL '1 millisecond'), updated_at = NOW()
       WHERE campaign_id = $1 AND owner_id = $2 AND generation = $3 AND lease_until > NOW()
       RETURNING *`,
      [id, this.instanceId, token, this.leaseTtlMs]
    );
    const lease = normalizeLease(result.rows?.[0]);
    if (lease) this.owned.set(id, lease);
    else this.owned.delete(id);
    return lease;
  }

  async assertOwned(campaignId, generation = null) {
    const id = boundedText(campaignId, 300);
    const current = this.owned.get(id);
    const token = Number(generation ?? current?.generation);
    if (!id || !Number.isFinite(token)) {
      throw coordinationError('Runtime local não possui lease válido.', 'RUNTIME_LEASE_NOT_OWNED', 409);
    }
    const result = await this.pool.query(
      `SELECT * FROM fenix_runtime_leases
       WHERE campaign_id = $1 AND owner_id = $2 AND generation = $3 AND lease_until > NOW()`,
      [id, this.instanceId, token]
    );
    const lease = normalizeLease(result.rows?.[0]);
    if (!lease) {
      this.owned.delete(id);
      throw coordinationError('Lease do runtime expirou ou foi transferido.', 'RUNTIME_LEASE_LOST', 409);
    }
    this.owned.set(id, lease);
    return lease;
  }

  async inspect(campaignId) {
    const id = boundedText(campaignId, 300);
    if (!id) return null;
    const result = await this.pool.query(
      'SELECT * FROM fenix_runtime_leases WHERE campaign_id = $1',
      [id]
    );
    return normalizeLease(result.rows?.[0]);
  }

  async release(campaignId, generation = null) {
    const id = boundedText(campaignId, 300);
    const current = this.owned.get(id);
    const token = Number(generation ?? current?.generation);
    if (!id || !Number.isFinite(token)) return false;
    const result = await this.pool.query(
      `UPDATE fenix_runtime_leases
       SET lease_until = NOW(), updated_at = NOW()
       WHERE campaign_id = $1 AND owner_id = $2 AND generation = $3
       RETURNING *`,
      [id, this.instanceId, token]
    );
    const lease = normalizeLease(result.rows?.[0]);
    this.owned.delete(id);
    if (lease) await this.#publish('RUNTIME_LEASE_RELEASED', lease);
    return Boolean(lease);
  }

  startHeartbeat({ onLeaseLost = null } = {}) {
    this.onLeaseLost = typeof onLeaseLost === 'function' ? onLeaseLost : null;
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.#heartbeat().catch((error) => {
        this.logger.error?.('[Fênix][RuntimeLease] heartbeat falhou', { message: error.message });
      });
    }, this.heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  async releaseAll() {
    this.stopHeartbeat();
    const leases = [...this.owned.values()];
    let released = 0;
    for (const lease of leases) {
      if (await this.release(lease.campaignId, lease.generation).catch(() => false)) released += 1;
    }
    return released;
  }

  async #heartbeat() {
    for (const lease of [...this.owned.values()]) {
      try {
        const renewed = await this.renew(lease.campaignId, lease.generation);
        if (!renewed) await this.#leaseLost(lease);
      } catch (error) {
        this.logger.warn?.('[Fênix][RuntimeLease] renovação falhou', {
          campaignId: lease.campaignId,
          generation: lease.generation,
          message: error.message
        });
      }
    }
  }

  async #leaseLost(lease) {
    this.owned.delete(lease.campaignId);
    await this.#publish('RUNTIME_LEASE_LOST', lease).catch(() => undefined);
    if (this.onLeaseLost) await this.onLeaseLost(lease);
  }

  async #publish(type, lease) {
    if (!this.publishEvent) return;
    await this.publishEvent(type, {
      campaignId: lease.campaignId,
      ownerId: lease.ownerId,
      ownerUrl: lease.ownerUrl,
      sessionId: lease.sessionId,
      generation: lease.generation,
      leaseUntil: lease.leaseUntil
    });
  }
}

export function createCoordinationError(message, code, statusCode, details) {
  return coordinationError(message, code, statusCode, details);
}
