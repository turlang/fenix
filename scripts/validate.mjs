import { access, readFile } from 'node:fs/promises';
const required = [
  'apps/api/src/server.js',
  'apps/api/src/app.js',
  'apps/api/src/http/session-controller.js',
  'apps/api/src/http/session-schemas.js',
  'apps/api/src/http/register-session-routes.js',
  'apps/foundry-module/module.json',
  'apps/fenix-vtt/app/layout.js',
  'apps/fenix-vtt/app/page.js',
  'apps/fenix-vtt/app/globals.css',
  'apps/fenix-vtt/components/vtt-shell.jsx',
  'apps/fenix-vtt/components/map-stage.jsx',
  'apps/fenix-vtt/lib/demo-scene.js',
  'apps/fenix-vtt/next.config.mjs',
  'packages/core/src/index.js',
  'packages/vtt-contracts/src/index.js',
  'packages/standalone-vtt-adapter/src/index.js',
  'packages/map-renderer-port/src/index.js',
  'packages/webgl-map-renderer/src/index.js',
  'packages/session-director/src/index.js',
  'packages/session-runtime/src/index.js',
  'packages/narration-output/src/index.js',
  'packages/narration-context-builder/src/index.js',
  'packages/scene-opening-context/src/index.js',
  'packages/opening-narrative-planner/src/index.js',
  'packages/novelty-guard/src/index.js',
  'packages/narration-quality-guard/src/index.js',
  'packages/narration-memory/src/index.js',
  'packages/audio-narration-service/src/index.js',
  'packages/audio-queue/src/index.js',
  'packages/config/src/index.js',
  'packages/intent-interpreter/src/index.js',
  'packages/rules-service/src/index.js',
  'packages/relationship-service/src/index.js',
  'packages/narration-service/src/index.js',
  'packages/foundry-adapter/src/index.js',
  'packages/foundry-publisher/src/index.js',
  'packages/ai-provider/src/system-prompt.js',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.github/workflows/ci.yml',
  '.github/dependabot.yml',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'README.md',
  'docs/FENIX_SHARED_CORE.md',
  'docs/FENIX_VTT_UI_UX.md'
];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const moduleJson = JSON.parse(await readFile(new URL('../apps/foundry-module/module.json', import.meta.url), 'utf8'));
const coreSource = await readFile(new URL('../packages/core/src/index.js', import.meta.url), 'utf8');
const coreVersion = coreSource.match(/ENGINE_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;
if (packageJson.version !== moduleJson.version || packageJson.version !== coreVersion) {
  throw new Error(`Versões divergentes: engine=${packageJson.version}, foundry=${moduleJson.version}, core=${coreVersion}`);
}
if (!packageJson.scripts?.test || !packageJson.scripts?.check) throw new Error('Scripts de qualidade ausentes.');

const standaloneUiFiles = [
  'apps/fenix-vtt/app/layout.js',
  'apps/fenix-vtt/app/page.js',
  'apps/fenix-vtt/components/vtt-shell.jsx',
  'apps/fenix-vtt/components/map-stage.jsx'
];
const forbiddenUiImports = [
  'RulesService',
  'NarrationService',
  'GroqNarrativeProvider',
  'foundry-adapter',
  'foundry-module',
  'SessionDirector'
];
for (const file of standaloneUiFiles) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const forbiddenImport of forbiddenUiImports) {
    if (source.includes(forbiddenImport)) {
      throw new Error(`Fronteira UI violada: ${file} referencia ${forbiddenImport}.`);
    }
  }
}

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
