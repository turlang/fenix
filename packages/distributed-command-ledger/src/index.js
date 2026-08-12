import { createHash } from 'node:crypto';

function text(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
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

export function stableCommandStringify(value) {
  return JSON.stringify(stableValue(value ?? null));
}

export function hashCommandRequest(value) {
  return createHash('sha256').update(stableCommandStringify(value)).digest('hex');
}

function commandError(message, code, statusCode = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function scopeKey({ campaignId = null, sessionId = null } = {}) {
  const campaign = text(campaignId, 300);
  if (campaign) return `campaign:${campaign}`;
  const session = text(sessionId, 300);
  if (session) return `session:${session}`;
  return '__legacy__';
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function replayResult(onReplay, result) {
  if (typeof onReplay === 'function') await onReplay(clone(result));
  return clone(result);
}

class BaseCommandLedger {
  constructor({ waitTimeoutMs = 1500, pollIntervalMs = 50, unknownAfterMs = 60000, resultMaxBytes = 512 * 1024, observability = null, logger = console } = {}) {
    this.waitTimeoutMs = Math.max(0, Number(waitTimeoutMs) || 0);
    this.pollIntervalMs = Math.max(10, Number(pollIntervalMs) || 50);
    this.unknownAfterMs = Math.max(1000, Number(unknownAfterMs) || 60000);
    this.resultMaxBytes = Math.max(1024, Number(resultMaxBytes) || 512 * 1024);
    this.observability = observability;
    this.logger = logger;
  }

  record(event, attributes = {}) {
    this.observability?.record?.(event, attributes);
  }

  validateRecord(record, requestHash) {
    if (!record) return null;
    if (record.requestHash !== requestHash) {
      this.record('command_id_conflict', { code: 'COMMAND_ID_CONFLICT' });
      throw commandError('commandId já foi usado com um payload diferente.', 'COMMAND_ID_CONFLICT', 409);
    }
    return record;
  }

  resultSize(value) {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  }
}

export class InMemoryCommandLedger extends BaseCommandLedger {
  constructor(options = {}) {
    super(options);
    this.driver = 'memory';
    this.records = new Map();
  }

  async initialize() { return true; }
  async close() { return true; }
  async health() { return true; }

  async execute({ campaignId = null, sessionId = null, commandId = null, commandType = 'command', request = null, ownerId = null, generation = null, onReplay = null, execute } = {}) {
    if (typeof execute !== 'function') throw new TypeError('execute é obrigatório.');
    const id = text(commandId, 300);
    if (!id) return execute();
    const key = `${scopeKey({ campaignId, sessionId })}:${id}`;
    const requestHash = hashCommandRequest(request);
    const existing = this.validateRecord(this.records.get(key), requestHash);
    if (existing) {
      if (existing.status === 'COMPLETED') {
        this.record('command_replayed', { ownerId, generation, outcome: 'completed' });
        return replayResult(onReplay, existing.result);
      }
      if (existing.status === 'UNKNOWN') {
        this.record('command_outcome_unknown', { ownerId, generation, code: existing.errorCode });
        throw commandError('O resultado anterior deste comando é desconhecido; reexecução automática foi bloqueada.', 'COMMAND_OUTCOME_UNKNOWN', 409);
      }
      const ageMs = Date.now() - existing.updatedAt;
      if (ageMs >= this.unknownAfterMs) {
        existing.status = 'UNKNOWN';
        existing.updatedAt = Date.now();
        this.record('command_outcome_unknown', { ownerId, generation, code: 'COMMAND_STALE_IN_PROGRESS' });
        throw commandError('O comando anterior ficou sem confirmação; reexecução automática foi bloqueada.', 'COMMAND_OUTCOME_UNKNOWN', 409);
      }
      this.record('command_in_progress', { ownerId, generation, outcome: 'wait' });
      try {
        const result = await existing.promise;
        return replayResult(onReplay, result);
      } catch {
        throw commandError('O comando anterior terminou sem resultado confirmável.', 'COMMAND_OUTCOME_UNKNOWN', 409);
      }
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    promise.catch(() => undefined);
    const record = {
      requestHash,
      status: 'IN_PROGRESS',
      result: null,
      errorCode: null,
      commandType: text(commandType, 120),
      updatedAt: Date.now(),
      promise
    };
    this.records.set(key, record);
    this.record('command_claimed', { ownerId, generation });
    try {
      const result = await execute();
      if (this.resultSize(result) > this.resultMaxBytes) {
        record.status = 'UNKNOWN';
        record.errorCode = 'COMMAND_RESULT_TOO_LARGE';
        record.updatedAt = Date.now();
        rejectPromise?.(new Error(record.errorCode));
        throw commandError('Resultado excede o limite seguro do ledger de idempotência.', 'COMMAND_RESULT_TOO_LARGE', 500);
      }
      record.status = 'COMPLETED';
      record.result = clone(result);
      record.updatedAt = Date.now();
      resolvePromise?.(clone(result));
      this.record('command_completed', { ownerId, generation, outcome: 'completed' });
      return result;
    } catch (error) {
      if (record.status !== 'COMPLETED') {
        record.status = 'UNKNOWN';
        record.errorCode = text(error?.code, 120) || 'COMMAND_EXECUTION_FAILED';
        record.updatedAt = Date.now();
        rejectPromise?.(error);
        this.record('command_marked_unknown', { ownerId, generation, code: record.errorCode });
      }
      throw error;
    }
  }
}

export class PostgresCommandLedger extends BaseCommandLedger {
  constructor({ pool, retentionHours = 168, ...options } = {}) {
    super(options);
    if (!pool?.query || !pool?.connect) throw new TypeError('pool PostgreSQL é obrigatório.');
    this.driver = 'postgres';
    this.pool = pool;
    this.retentionHours = Math.max(1, Math.min(24 * 90, Number(retentionHours) || 168));
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('fenix_command_ledger_schema_v1'))");
      await client.query(`
        CREATE TABLE IF NOT EXISTS fenix_command_ledger (
          scope_key TEXT NOT NULL,
          command_id TEXT NOT NULL,
          command_type TEXT NOT NULL,
          session_id TEXT NULL,
          request_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('IN_PROGRESS','COMPLETED','UNKNOWN')),
          result_json JSONB NULL,
          error_code TEXT NULL,
          owner_id TEXT NULL,
          generation BIGINT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (scope_key, command_id)
        )
      `);
      await client.query('CREATE INDEX IF NOT EXISTS fenix_command_ledger_updated_idx ON fenix_command_ledger(updated_at)');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    await this.cleanup();
    return true;
  }

  async close() { return true; }

  async health() {
    await this.pool.query('SELECT 1');
    return true;
  }

  async cleanup() {
    await this.pool.query(
      `DELETE FROM fenix_command_ledger WHERE updated_at < NOW() - ($1::text || ' hours')::interval`,
      [String(this.retentionHours)]
    );
  }

  async execute({ campaignId = null, sessionId = null, commandId = null, commandType = 'command', request = null, ownerId = null, generation = null, onReplay = null, execute } = {}) {
    if (typeof execute !== 'function') throw new TypeError('execute é obrigatório.');
    const id = text(commandId, 300);
    if (!id) return execute();
    const scope = scopeKey({ campaignId, sessionId });
    const requestHash = hashCommandRequest(request);
    const claimed = await this.#claim({ scope, id, commandType, sessionId, requestHash, ownerId, generation });
    if (!claimed) {
      const replay = await this.#awaitExisting({ scope, id, requestHash, ownerId, generation });
      if (replay.type === 'completed') return replayResult(onReplay, replay.result);
      throw replay.error;
    }

    this.record('command_claimed', { ownerId, generation });
    try {
      const result = await execute();
      if (this.resultSize(result) > this.resultMaxBytes) {
        await this.#markUnknown({ scope, id, requestHash, errorCode: 'COMMAND_RESULT_TOO_LARGE' });
        throw commandError('Resultado excede o limite seguro do ledger de idempotência.', 'COMMAND_RESULT_TOO_LARGE', 500);
      }
      const completed = await this.pool.query(
        `UPDATE fenix_command_ledger
         SET status='COMPLETED', result_json=$4::jsonb, error_code=NULL, updated_at=NOW()
         WHERE scope_key=$1 AND command_id=$2 AND request_hash=$3 AND status='IN_PROGRESS'
         RETURNING command_id`,
        [scope, id, requestHash, JSON.stringify(result ?? null)]
      );
      if (!completed.rowCount) {
        throw commandError('O efeito foi produzido, mas o ledger não confirmou sua conclusão.', 'COMMAND_COMMIT_UNCERTAIN', 503);
      }
      this.record('command_completed', { ownerId, generation, outcome: 'completed' });
      return result;
    } catch (error) {
      await this.#markUnknown({ scope, id, requestHash, errorCode: text(error?.code, 120) || 'COMMAND_EXECUTION_FAILED' }).catch((markError) => {
        this.logger.error?.('[Fênix][CommandLedger] falha ao marcar resultado desconhecido', { message: markError.message });
      });
      this.record('command_marked_unknown', { ownerId, generation, code: error?.code });
      throw error;
    }
  }

  async #claim({ scope, id, commandType, sessionId, requestHash, ownerId, generation }) {
    const result = await this.pool.query(
      `INSERT INTO fenix_command_ledger
        (scope_key, command_id, command_type, session_id, request_hash, status, owner_id, generation)
       VALUES ($1,$2,$3,$4,$5,'IN_PROGRESS',$6,$7)
       ON CONFLICT (scope_key, command_id) DO NOTHING
       RETURNING command_id`,
      [scope, id, text(commandType, 120) || 'command', text(sessionId, 300) || null, requestHash, text(ownerId, 200) || null, generation == null ? null : Number(generation)]
    );
    return result.rowCount === 1;
  }

  async #read(scope, id) {
    const result = await this.pool.query(
      `SELECT request_hash, status, result_json, error_code, updated_at
       FROM fenix_command_ledger WHERE scope_key=$1 AND command_id=$2`,
      [scope, id]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      requestHash: row.request_hash,
      status: row.status,
      result: row.result_json,
      errorCode: row.error_code,
      updatedAt: new Date(row.updated_at).getTime()
    };
  }

  async #awaitExisting({ scope, id, requestHash, ownerId, generation }) {
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const record = this.validateRecord(await this.#read(scope, id), requestHash);
      if (!record) throw commandError('Registro de idempotência desapareceu durante a leitura.', 'COMMAND_LEDGER_INCONSISTENT', 503);
      if (record.status === 'COMPLETED') {
        this.record('command_replayed', { ownerId, generation, outcome: 'completed' });
        return { type: 'completed', result: clone(record.result) };
      }
      if (record.status === 'UNKNOWN') {
        this.record('command_outcome_unknown', { ownerId, generation, code: record.errorCode });
        return { type: 'error', error: commandError('O resultado anterior deste comando é desconhecido; reexecução automática foi bloqueada.', 'COMMAND_OUTCOME_UNKNOWN', 409) };
      }
      const ageMs = Date.now() - record.updatedAt;
      if (ageMs >= this.unknownAfterMs) {
        await this.#markUnknown({ scope, id, requestHash, errorCode: 'COMMAND_STALE_IN_PROGRESS' });
        this.record('command_outcome_unknown', { ownerId, generation, code: 'COMMAND_STALE_IN_PROGRESS' });
        return { type: 'error', error: commandError('O comando anterior ficou sem confirmação; reexecução automática foi bloqueada.', 'COMMAND_OUTCOME_UNKNOWN', 409) };
      }
      if (Date.now() >= deadline) {
        this.record('command_in_progress', { ownerId, generation, outcome: 'retry_later' });
        return {
          type: 'error',
          error: commandError('Este comando já está sendo processado pelo owner.', 'COMMAND_IN_PROGRESS', 409, { retryAfter: Math.max(1, Math.ceil(this.pollIntervalMs / 1000)) })
        };
      }
      await delay(this.pollIntervalMs);
    }
  }

  async #markUnknown({ scope, id, requestHash, errorCode }) {
    await this.pool.query(
      `UPDATE fenix_command_ledger
       SET status='UNKNOWN', error_code=$4, updated_at=NOW()
       WHERE scope_key=$1 AND command_id=$2 AND request_hash=$3 AND status='IN_PROGRESS'`,
      [scope, id, requestHash, text(errorCode, 120) || 'COMMAND_EXECUTION_FAILED']
    );
  }
}

export function createCommandLedger({ pool = null, ...options } = {}) {
  return pool ? new PostgresCommandLedger({ pool, ...options }) : new InMemoryCommandLedger(options);
}

export function createCommandLedgerError(message, code, statusCode, details) {
  return commandError(message, code, statusCode, details);
}
