import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const output = resolve(root, process.env.SBOM_OUTPUT || 'reports/mestre-orc-sbom.cdx.json');

function packageNameFromPath(path, metadata) {
  if (metadata?.name) return metadata.name;
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + marker.length) : null;
}
function purl(name, version) {
  const encoded = name.startsWith('@')
    ? `@${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

const components = Object.entries(lock.packages || {})
  .filter(([path, metadata]) => path && path.includes('node_modules/') && metadata?.version)
  .map(([path, metadata]) => {
    const name = packageNameFromPath(path, metadata);
    return {
      type: 'library',
      'bom-ref': purl(name, metadata.version),
      name,
      version: metadata.version,
      purl: purl(name, metadata.version),
      properties: [
        { name: 'mestre-orc:development', value: String(Boolean(metadata.dev)) },
        { name: 'mestre-orc:optional', value: String(Boolean(metadata.optional)) }
      ]
    };
  })
  .sort((a, b) => a.purl.localeCompare(b.purl));

const serialSeed = `${pkg.name}:${pkg.version}:${components.map((entry) => entry.purl).join('|')}`;
const serial = createHash('sha256').update(serialSeed).digest('hex');
const document = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-${serial.slice(12, 16)}-${serial.slice(16, 20)}-${serial.slice(20, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: 'application',
      'bom-ref': `pkg:npm/${pkg.name}@${pkg.version}`,
      name: pkg.name,
      version: pkg.version,
      purl: `pkg:npm/${pkg.name}@${pkg.version}`
    },
    tools: { components: [{ type: 'application', name: 'mestre-orc-sbom-generator', version: '1' }] }
  },
  components
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`SBOM CycloneDX gerado em ${output} (${components.length} componentes).`);
