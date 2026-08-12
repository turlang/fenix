import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresFenixRepository } from '../packages/persistence-repository/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL é obrigatória para o teste PostgreSQL.');

const adminPool = new Pool({ connectionString, max: 2, application_name: 'fenix-ci-admin' });
await adminPool.query('DROP TABLE IF EXISTS fenix_repository_state');
await adminPool.end();

function repository() {
  return new PostgresFenixRepository({
    poolFactory: async () => new Pool({ connectionString, max: 4, application_name: 'fenix-ci-repository' }),
    connectionString,
    logger: {}
  });
}

const first = repository();
const second = repository();

try {
  await Promise.all([first.initialize(), second.initialize()]);

  await Promise.all([
    first.mutate(async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      draft.campaigns.push({ id: 'campaign-a', members: [] });
    }),
    second.mutate((draft) => {
      draft.campaigns.push({ id: 'campaign-b', members: [] });
    })
  ]);

  await first.refresh();
  const ids = first.snapshot().campaigns.map((campaign) => campaign.id).sort();
  assert.deepEqual(ids, ['campaign-a', 'campaign-b']);

  await first.mutate((draft) => {
    draft.realtimeSessions['session-a'] = { revision: 7, tokens: [] };
  });
  await second.refresh();
  assert.equal(second.read((state) => state.realtimeSessions['session-a'].revision), 7);

  console.log('PostgreSQL persistence integration OK');
} finally {
  await Promise.allSettled([first.close(), second.close()]);
}
