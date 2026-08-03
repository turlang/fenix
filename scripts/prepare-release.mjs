import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const releaseName = `mestre-orc-engine-${packageJson.version}`;
const distDirectory = join(projectRoot, 'dist');
const releaseDirectory = join(distDirectory, releaseName);

const excludedDirectoryNames = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const excludedFileNames = new Set(['.env', '.DS_Store', 'Thumbs.db', 'narration-history.json']);

function normalizePath(path) {
  return path.split(sep).join('/');
}

function shouldCopy(source) {
  const relativePath = normalizePath(relative(projectRoot, source));
  if (!relativePath) return true;

  const segments = relativePath.split('/');
  if (segments.some((segment) => excludedDirectoryNames.has(segment))) return false;

  const fileName = basename(source);
  if (excludedFileNames.has(fileName)) return false;
  if (fileName.startsWith('.env.') && fileName !== '.env.example') return false;
  if (fileName.endsWith('.log')) return false;
  if (relativePath.startsWith('data/') && fileName.endsWith('.json')) return false;

  return true;
}

await rm(distDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });
for (const entry of await readdir(projectRoot, { withFileTypes: true })) {
  const source = join(projectRoot, entry.name);
  if (!shouldCopy(source)) continue;
  await cp(source, join(releaseDirectory, entry.name), {
    recursive: true,
    force: true,
    filter: shouldCopy
  });
}

await mkdir(join(releaseDirectory, 'data'), { recursive: true });
await writeFile(join(releaseDirectory, 'data', '.gitkeep'), '\n', 'utf8');

const forbiddenPaths = [
  '.git',
  'node_modules',
  '.env',
  'data/narration-history.json',
  'data/campaign-memory.json',
  'data/adventure-library.json',
  'data/voice-profiles.json',
  'dist'
];

for (const forbiddenPath of forbiddenPaths) {
  try {
    await stat(join(releaseDirectory, forbiddenPath));
    throw new Error(`Arquivo local proibido incluído na entrega: ${forbiddenPath}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const manifest = {
  name: packageJson.name,
  version: packageJson.version,
  generatedAt: new Date().toISOString(),
  sourceDirectory: '.',
  excluded: [
    '.git/',
    'node_modules/',
    'dist/',
    'coverage/',
    '.env e variantes locais',
    'data/*.json',
    '*.log'
  ]
};
await writeFile(
  join(releaseDirectory, 'RELEASE-MANIFEST.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8'
);

console.log(`Entrega limpa preparada em ${relative(projectRoot, releaseDirectory)}`);
