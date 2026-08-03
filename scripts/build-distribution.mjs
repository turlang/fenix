import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZipFromDirectory } from './lib/zip.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDirectory, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const output = join(root, 'dist', 'distribution');
const staging = join(root, 'dist', '.distribution-staging');
const engineStage = join(staging, 'engine');
const moduleStage = join(staging, 'foundry-module');
const bundleStage = join(staging, 'windows-bundle');
const releaseBaseUrl = String(process.env.MESTRE_ORC_RELEASE_BASE_URL || '').replace(/\/$/, '');

const excludedDirectories = new Set(['.git', 'node_modules', 'dist', 'coverage', 'reports', 'backups', 'migrations']);
const excludedFiles = new Set(['.env', '.DS_Store', 'Thumbs.db']);
function normalize(path) { return path.split(sep).join('/'); }
function filter(source) {
  const rel = normalize(relative(root, source));
  if (!rel) return true;
  const parts = rel.split('/');
  if (parts.some((part) => excludedDirectories.has(part))) return false;
  const name = basename(source);
  if (excludedFiles.has(name)) return false;
  if (name.startsWith('.env.') && name !== '.env.example') return false;
  if (name.endsWith('.log') || name.endsWith('.mobackup')) return false;
  if (rel.startsWith('data/') && name.endsWith('.json')) return false;
  return true;
}
async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function copyEngine() {
  await mkdir(engineStage, { recursive: true });
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const source = join(root, entry.name);
    if (!filter(source)) continue;
    await cp(source, join(engineStage, entry.name), { recursive: true, force: true, filter });
  }
  await mkdir(join(engineStage, 'data'), { recursive: true });
  await writeFile(join(engineStage, 'data', '.gitkeep'), '\n', 'utf8');
}
async function prepareModule() {
  await cp(join(root, 'apps', 'foundry-module'), moduleStage, { recursive: true, force: true });
  const manifestPath = join(moduleStage, 'module.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (releaseBaseUrl) {
    manifest.manifest = `${releaseBaseUrl}/module.json`;
    manifest.download = `${releaseBaseUrl}/mestre-orc-foundry-${version}.zip`;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

await rm(staging, { recursive: true, force: true });
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const auditReport = join(output, 'release-candidate-audit.json');
const sbomFile = join(output, 'mestre-orc-sbom.cdx.json');
execFileSync(process.execPath, [join(root, 'scripts', 'release-candidate-audit.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, RC_AUDIT_REPORT_FILE: auditReport }
});
execFileSync(process.execPath, [join(root, 'scripts', 'generate-sbom.mjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SBOM_OUTPUT: sbomFile }
});
await copyEngine();
const moduleManifest = await prepareModule();

const engineZip = join(output, `mestre-orc-engine-${version}.zip`);
const moduleZip = join(output, `mestre-orc-foundry-${version}.zip`);
await createZipFromDirectory(engineStage, engineZip, { prefix: `mestre-orc-engine-${version}` });
await createZipFromDirectory(moduleStage, moduleZip);

await mkdir(bundleStage, { recursive: true });
await cp(engineStage, join(bundleStage, 'engine'), { recursive: true, force: true });
await cp(moduleStage, join(bundleStage, 'foundry-module'), { recursive: true, force: true });
await cp(join(root, 'distribution', 'windows'), join(bundleStage, 'windows'), { recursive: true, force: true });
for (const document of ['INSTALLATION.md', 'UPDATING.md', 'MIGRATIONS.md', 'TROUBLESHOOTING.md', 'RELEASE-CHECKLIST.md']) {
  await cp(join(root, 'docs', document), join(bundleStage, document), { force: true });
}
const bundleZip = join(output, `mestre-orc-windows-bundle-${version}.zip`);
await createZipFromDirectory(bundleStage, bundleZip, { prefix: `mestre-orc-${version}` });

await cp(join(moduleStage, 'module.json'), join(output, 'module.json'), { force: true });
const artifacts = [];
for (const path of [engineZip, moduleZip, bundleZip, join(output, 'module.json'), auditReport, sbomFile]) {
  const metadata = await stat(path);
  artifacts.push({ fileName: basename(path), bytes: metadata.size, sha256: await sha256(path) });
}
const release = {
  format: 'mestre-orc-release',
  formatVersion: 1,
  name: pkg.name,
  version,
  generatedAt: new Date().toISOString(),
  node: pkg.engines?.node ?? null,
  foundryCompatibility: moduleManifest.compatibility,
  releaseBaseUrl: releaseBaseUrl || null,
  artifacts
};
await writeFile(join(output, 'release-manifest.json'), `${JSON.stringify(release, null, 2)}\n`, 'utf8');
await writeFile(join(output, 'checksums.sha256'), `${artifacts.map((entry) => `${entry.sha256}  ${entry.fileName}`).join('\n')}\n`, 'utf8');
await rm(staging, { recursive: true, force: true });
console.log(`Distribuição preparada em ${relative(root, output)} (${artifacts.length} artefatos).`);
