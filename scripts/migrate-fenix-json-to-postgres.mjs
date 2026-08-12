import { loadEnvFile } from '../packages/config/src/index.js';
import {
  JsonFileFenixRepository,
  createPostgresFenixRepositoryFromEnv
} from '../packages/persistence-repository/src/index.js';

loadEnvFile();

const sourcePath = process.env.FENIX_STATE_FILE || './data/fenix-state.json';
const source = new JsonFileFenixRepository({ filePath: sourcePath, logger: console });
const target = createPostgresFenixRepositoryFromEnv({ env: process.env, logger: console });

try {
  await source.initialize();
  await target.initialize();
  const state = source.snapshot();
  const imported = await target.importStateIfEmpty(state);
  if (!imported) {
    throw new Error('PostgreSQL já contém estado do Fênix; migração cancelada para evitar sobrescrita.');
  }
  console.log(`Migração concluída: ${state.users.length} usuário(s), ${state.campaigns.length} campanha(s).`);
} finally {
  await target.close().catch(() => undefined);
}
