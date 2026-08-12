import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SCHEMA_VERSION = 1;
const POSTGRES_ROW_ID = 1;

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    users: [],
    authSessions: [],
    campaigns: [],
    invites: [],
    activeNarrativeSession: null,
    realtimeSessions: {}
  };
}

function clone(value) {
  return structuredClone(value);
}

function normalizeState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    ...emptyState(),
    ...source,
    version: SCHEMA_VERSION,
    users: Array.isArray(source.users) ? source.users : [],
    authSessions: Array.isArray(source.authSessions) ? source.authSessions : [],
    campaigns: Array.isArray(source.campaigns) ? source.campaigns : [],
    invites: Array.isArray(source.invites) ? source.invites : [],
    realtimeSessions: source.realtimeSessions && typeof source.realtimeSessions === 'object'
      ? source.realtimeSessions
      : {}
  };
}

function stateHasData(state) {
  return Boolean(
    state.users.length
    || state.authSessions.length
    || state.campaigns.length
    || state.invites.length
    || state.activeNarrativeSession
    || Object.keys(state.realtimeSessions).length
  );
}

function positiveInteger(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export class InMemoryFenixRepository {
  constructor(initialState = null) {
    this.state = normalizeState(initialState);
    this.queue = Promise.resolve();
    this.driver = 'memory';
  }

  async initialize() {
    return this.snapshot();
  }

  snapshot() {
    return clone(this.state);
  }

  read(selector = (state) => state) {
    return clone(selector(this.state));
  }

  mutate(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('mutator deve ser função.');
    const operation = this.queue.then(async () => {
      const draft = clone(this.state);
      const result = await mutator(draft);
      this.state = normalizeState(draft);
      await this.persist(this.state);
      return clone(result);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async persist() {
    // memória não precisa persistir fora do processo.
  }

  async close() {
    // sem recursos externos.
  }
}

export class JsonFileFenixRepository extends InMemoryFenixRepository {
  constructor({ filePath = './data/fenix-state.json', logger = console } = {}) {
    super();
    this.filePath = resolve(filePath);
    this.logger = logger;
    this.driver = 'json';
  }

  async initialize() {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const source = await readFile(this.filePath, 'utf8');
      this.state = normalizeState(JSON.parse(source));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      this.state = emptyState();
      await this.persist(this.state);
    }
    return this.snapshot();
  }

  async persist(state) {
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.filePath);
  }
}

export class PostgresFenixRepository extends InMemoryFenixRepository {
  constructor({
    pool = null,
    poolFactory = null,
    connectionString = null,
    maxConnections = 10,
    connectionTimeoutMs = 5000,
    idleTimeoutMs = 30000,
    logger = console
  } = {}) {
    super();
    if (!pool && typeof poolFactory !== 'function') {
      throw new TypeError('pool ou poolFactory é obrigatório para PostgresFenixRepository.');
    }
    this.pool = pool;
    this.poolFactory = poolFactory;
    this.connectionString = connectionString;
    this.maxConnections = positiveInteger(maxConnections, 10, { min: 1, max: 50 });
    this.connectionTimeoutMs = positiveInteger(connectionTimeoutMs, 5000, { min: 500, max: 60000 });
    this.idleTimeoutMs = positiveInteger(idleTimeoutMs, 30000, { min: 1000, max: 300000 });
    this.logger = logger;
    this.driver = 'postgres';
  }

  async initialize() {
    if (!this.pool) {
      this.pool = await this.poolFactory({
        connectionString: this.connectionString,
        maxConnections: this.maxConnections,
        connectionTimeoutMs: this.connectionTimeoutMs,
        idleTimeoutMs: this.idleTimeoutMs
      });
    }
    if (!this.pool?.query || !this.pool?.connect) {
      throw new TypeError('Pool PostgreSQL inválido.');
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS fenix_repository_state (
        id SMALLINT PRIMARY KEY CHECK (id = 1),
        schema_version INTEGER NOT NULL,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query(
      `INSERT INTO fenix_repository_state (id, schema_version, state)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [POSTGRES_ROW_ID, SCHEMA_VERSION, JSON.stringify(emptyState())]
    );
    await this.refresh();
    return this.snapshot();
  }

  async refresh() {
    const result = await this.pool.query(
      'SELECT schema_version, state FROM fenix_repository_state WHERE id = $1',
      [POSTGRES_ROW_ID]
    );
    const row = result.rows?.[0];
    if (!row) throw new Error('Estado persistente do Fênix não foi encontrado no PostgreSQL.');
    this.state = normalizeState(row.state);
    return this.snapshot();
  }

  mutate(mutator) {
    if (typeof mutator !== 'function') throw new TypeError('mutator deve ser função.');
    const operation = this.queue.then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const locked = await client.query(
          'SELECT state FROM fenix_repository_state WHERE id = $1 FOR UPDATE',
          [POSTGRES_ROW_ID]
        );
        const draft = normalizeState(locked.rows?.[0]?.state);
        const result = await mutator(draft);
        const nextState = normalizeState(draft);
        await client.query(
          `UPDATE fenix_repository_state
           SET schema_version = $2, state = $3::jsonb, updated_at = NOW()
           WHERE id = $1`,
          [POSTGRES_ROW_ID, SCHEMA_VERSION, JSON.stringify(nextState)]
        );
        await client.query('COMMIT');
        this.state = nextState;
        return clone(result);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async importStateIfEmpty(input) {
    const candidate = normalizeState(input);
    let imported = false;
    await this.mutate((draft) => {
      if (stateHasData(normalizeState(draft))) return;
      Object.assign(draft, clone(candidate));
      imported = true;
    });
    return imported;
  }

  async close() {
    await this.pool?.end?.();
  }
}

export function createNodePostgresPoolFactory() {
  return async ({ connectionString, maxConnections, connectionTimeoutMs, idleTimeoutMs }) => {
    const { Pool } = await import('pg');
    return new Pool({
      connectionString,
      max: maxConnections,
      connectionTimeoutMillis: connectionTimeoutMs,
      idleTimeoutMillis: idleTimeoutMs,
      application_name: 'fenix-engine'
    });
  };
}

export function createPostgresFenixRepositoryFromEnv({ env = process.env, logger = console, pool = null } = {}) {
  const connectionString = String(env.DATABASE_URL ?? '').trim();
  if (!pool && !connectionString) {
    throw new Error('DATABASE_URL é obrigatória quando FENIX_PERSISTENCE_DRIVER=postgres.');
  }
  return new PostgresFenixRepository({
    pool,
    poolFactory: pool ? null : createNodePostgresPoolFactory(),
    connectionString,
    maxConnections: env.FENIX_POSTGRES_POOL_MAX,
    connectionTimeoutMs: env.FENIX_POSTGRES_CONNECT_TIMEOUT_MS,
    idleTimeoutMs: env.FENIX_POSTGRES_IDLE_TIMEOUT_MS,
    logger
  });
}

export function createFenixRepositoryFromEnv({ env = process.env, logger = console, pool = null } = {}) {
  const requestedDriver = String(env.FENIX_PERSISTENCE_DRIVER ?? '').trim().toLowerCase();
  const driver = requestedDriver || (String(env.DATABASE_URL ?? '').trim() ? 'postgres' : 'json');
  if (driver === 'postgres') return createPostgresFenixRepositoryFromEnv({ env, logger, pool });
  if (driver === 'memory') return new InMemoryFenixRepository();
  if (driver !== 'json') throw new Error(`FENIX_PERSISTENCE_DRIVER não suportado: ${driver}`);
  return new JsonFileFenixRepository({
    filePath: env.FENIX_STATE_FILE || './data/fenix-state.json',
    logger
  });
}
