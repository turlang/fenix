import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { MigrationService } from '../packages/migration-service/src/index.js';

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : null;
};
const root = resolve(valueOf('--root') || process.cwd());
const foundryModule = resolve(valueOf('--foundry-module') || join(root, 'apps', 'foundry-module'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(join(foundryModule, 'module.json'), 'utf8'));
const nodeMajor = Number(process.versions.node.split('.')[0]);
const checks = [];
function check(id, ok, message) { checks.push({ id, status: ok ? 'PASS' : 'FAIL', message }); }

check('node-version', nodeMajor >= 20 && nodeMajor < 25, `Node.js ${process.versions.node}`);
check('version-match', pkg.version === manifest.version, `Engine ${pkg.version}; módulo ${manifest.version}`);
for (const path of ['apps/api/src/server.js', 'scripts/migrate-data.mjs', '.env.example']) {
  try { await access(join(root, path)); check(`file:${path}`, true, `${path} encontrado.`); }
  catch { check(`file:${path}`, false, `${path} ausente.`); }
}
const dataDirectory = join(root, 'data');
try {
  await mkdir(dataDirectory, { recursive: true });
  const probe = join(dataDirectory, `.verify-${process.pid}`);
  await writeFile(probe, 'ok');
  await rm(probe, { force: true });
  check('data-writable', true, 'Diretório de dados gravável.');
} catch (error) { check('data-writable', false, error.message); }
try {
  const migration = new MigrationService({ dataDirectory, engineVersion: pkg.version });
  const inspection = await migration.inspect();
  check('data-schema', !inspection.files.some((entry) => entry.status === 'INVALID'), `Schema alvo ${inspection.targetSchemaVersion}.`);
} catch (error) { check('data-schema', false, error.message); }

const failed = checks.filter((entry) => entry.status === 'FAIL');
process.stdout.write(`${JSON.stringify({ ok: failed.length === 0, version: pkg.version, checks }, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
