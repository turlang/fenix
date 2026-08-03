import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { MigrationService } from '../packages/migration-service/src/index.js';

const packageMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const command = args.find((entry) => !entry.startsWith('--')) || 'inspect';
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const has = (name) => args.includes(name);
const dataDirectory = resolve(valueOf('--data-dir') || process.env.MESTRE_ORC_DATA_DIRECTORY || 'data');
const service = new MigrationService({ dataDirectory, engineVersion: packageMetadata.version });

try {
  let result;
  if (command === 'inspect') result = await service.inspect();
  else if (command === 'apply') result = await service.migrate({ dryRun: has('--dry-run'), createSnapshot: !has('--no-snapshot'), reason: valueOf('--reason') || 'manual' });
  else if (command === 'list') result = { snapshots: await service.listSnapshots() };
  else if (command === 'rollback') {
    const snapshotId = valueOf('--snapshot') || args[args.indexOf(command) + 1];
    result = await service.rollback(snapshotId);
  } else {
    throw new Error(`Comando desconhecido: ${command}. Use inspect, apply, list ou rollback.`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code || 'MIGRATION_FAILED', message: error.message, details: error.details ?? null }, null, 2)}\n`);
  process.exitCode = 1;
}
