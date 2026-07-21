import { access, readFile } from 'node:fs/promises';
const required = [
  'apps/api/src/server.js',
  'apps/foundry-module/module.json',
  'packages/session-director/src/index.js',
  'packages/narration-context-builder/src/index.js',
  'packages/scene-opening-context/src/index.js',
  'packages/opening-narrative-planner/src/index.js',
  'packages/novelty-guard/src/index.js',
  'packages/narration-quality-guard/src/index.js',
  'packages/narration-memory/src/index.js',
  'packages/audio-narration-service/src/index.js',
  'packages/config/src/index.js',
  'packages/intent-interpreter/src/index.js',
  'packages/rules-service/src/index.js',
  'packages/relationship-service/src/index.js',
  'packages/narration-service/src/index.js',
  'packages/foundry-publisher/src/index.js',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.github/workflows/ci.yml',
  '.github/dependabot.yml',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'README.md'
];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const moduleJson = JSON.parse(await readFile(new URL('../apps/foundry-module/module.json', import.meta.url), 'utf8'));
if (packageJson.version !== moduleJson.version) {
  throw new Error(`Versões divergentes: engine=${packageJson.version}, foundry=${moduleJson.version}`);
}
if (!packageJson.scripts?.test || !packageJson.scripts?.check) throw new Error('Scripts de qualidade ausentes.');

const forbidden = ['.env', 'node_modules', 'data/narration-history.json'];
for (const path of forbidden) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    console.warn(`Aviso local: ${path} existe, mas deve permanecer fora do Git.`);
  } catch {
    // Ausência esperada em uma cópia limpa do repositório.
  }
}
console.log(`Estrutura modular válida (${packageJson.version}).`);
