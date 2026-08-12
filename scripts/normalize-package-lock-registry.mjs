import { readFile, writeFile } from 'node:fs/promises';

const lockUrl = new URL('../package-lock.json', import.meta.url);
const INTERNAL_PREFIX = 'https://packages.applied-caas-gateway1.internal.api.openai.org/artifactory/api/npm/npm-public/';
const PUBLIC_PREFIX = 'https://registry.npmjs.org/';
const checkOnly = process.argv.includes('--check');

const source = await readFile(lockUrl, 'utf8');
const lock = JSON.parse(source);
let changed = 0;
for (const descriptor of Object.values(lock.packages ?? {})) {
  if (typeof descriptor?.resolved === 'string' && descriptor.resolved.startsWith(INTERNAL_PREFIX)) {
    descriptor.resolved = descriptor.resolved.replace(INTERNAL_PREFIX, PUBLIC_PREFIX);
    changed += 1;
  }
}

if (checkOnly) {
  if (changed) throw new Error(`package-lock.json contém ${changed} URL(s) de registry interno.`);
  console.log('package-lock.json usa somente registries portáveis.');
} else if (changed) {
  await writeFile(lockUrl, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  console.log(`Normalizadas ${changed} URL(s) do package-lock.json.`);
} else {
  console.log('package-lock.json já está normalizado.');
}
