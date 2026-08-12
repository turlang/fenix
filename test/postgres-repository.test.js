import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PostgresFenixRepository,
  createFenixRepositoryFromEnv
} from '../packages/persistence-repository/src/index.js';

class FakePgPool {
  constructor() {
    this.state = null;
    this.ended = false;
  }

  async query(sql) {
    const statement = String(sql).replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT schema_version, state')) {
      return { rows: [{ schema_version: 1, state: structuredClone(this.state) }] };
    }
    throw new Error(`query inesperada: ${statement}`);
  }

  async connect() {
    return {
      query: async (sql, params = []) => {
        const statement = String(sql).replace(/\s+/g, ' ').trim();
        if (statement === 'BEGIN' || statement === 'COMMIT' || statement === 'ROLLBACK') return { rows: [] };
        if (statement.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{ pg_advisory_xact_lock: null }] };
        if (statement.startsWith('CREATE TABLE')) return { rows: [] };
        if (statement.startsWith('INSERT INTO fenix_repository_state')) {
          if (!this.state) this.state = JSON.parse(params[2]);
          return { rows: [] };
        }
        if (statement.includes('FOR UPDATE')) return { rows: [{ state: structuredClone(this.state) }] };
        if (statement.startsWith('UPDATE fenix_repository_state')) {
          this.state = JSON.parse(params[2]);
          return { rows: [] };
        }
        throw new Error(`client query inesperada: ${statement}`);
      },
      release() {}
    };
  }

  async end() {
    this.ended = true;
  }
}

test('factory seleciona Postgres quando DATABASE_URL está configurada', () => {
  const pool = new FakePgPool();
  const repository = createFenixRepositoryFromEnv({
    env: { DATABASE_URL: 'postgres://fenix:test@localhost/fenix' },
    pool,
    logger: {}
  });
  assert.equal(repository.driver, 'postgres');
});

test('PostgresFenixRepository preserva contrato snapshot/read/mutate', async () => {
  const pool = new FakePgPool();
  const repository = new PostgresFenixRepository({ pool, logger: {} });
  await repository.initialize();

  await repository.mutate((draft) => {
    draft.users.push({ id: 'user-1', email: 'gm@example.com' });
    draft.campaigns.push({ id: 'campaign-1', members: [] });
  });

  assert.equal(repository.snapshot().users[0].id, 'user-1');
  assert.equal(repository.read((state) => state.campaigns[0].id), 'campaign-1');
  assert.equal(pool.state.users.length, 1);
  await repository.close();
  assert.equal(pool.ended, true);
});

test('importStateIfEmpty não sobrescreve banco que já possui dados', async () => {
  const pool = new FakePgPool();
  const repository = new PostgresFenixRepository({ pool, logger: {} });
  await repository.initialize();

  assert.equal(await repository.importStateIfEmpty({ users: [{ id: 'first' }] }), true);
  assert.equal(await repository.importStateIfEmpty({ users: [{ id: 'second' }] }), false);
  assert.equal(repository.snapshot().users[0].id, 'first');
});
