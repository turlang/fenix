import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const SCHEMA_VERSION = 1;

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

export class InMemoryFenixRepository {
  constructor(initialState = null) {
    this.state = normalizeState(initialState);
    this.queue = Promise.resolve();
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
}

export class JsonFileFenixRepository extends InMemoryFenixRepository {
  constructor({ filePath = './data/fenix-state.json', logger = console } = {}) {
    super();
    this.filePath = resolve(filePath);
    this.logger = logger;
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

export function createFenixRepositoryFromEnv({ env = process.env, logger = console } = {}) {
  return new JsonFileFenixRepository({
    filePath: env.FENIX_STATE_FILE || './data/fenix-state.json',
    logger
  });
}
