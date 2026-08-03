import { access, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const required = [
  'apps/api/src/server.js',
  'apps/foundry-module/module.json',
  'apps/foundry-module/scripts/read-aloud.js',
  'apps/foundry-module/scripts/cinematic-speech.js',
  'apps/foundry-module/scripts/combat-tracker.js',
  'apps/foundry-module/scripts/adventure-library-panel.js',
  'apps/foundry-module/scripts/generator-panel.js',
  'apps/foundry-module/scripts/map-panel.js',
  'apps/foundry-module/scripts/tutor-panel.js',
  'apps/foundry-module/scripts/automation-panel.js',
  'apps/foundry-module/scripts/backup-panel.js',
  'apps/foundry-module/scripts/diagnostic-panel.js',
  'apps/foundry-module/scripts/central-panel.js',
  'apps/foundry-module/scripts/ai-provider-panel.js',
  'apps/foundry-module/scripts/voice-profile-panel.js',
  'apps/foundry-module/scripts/voice-input.js',
  'apps/foundry-module/scripts/room-transition-state.js',
  'apps/foundry-module/scripts/token-vision.js',
  'packages/session-director/src/index.js',
  'packages/narration-context-builder/src/index.js',
  'packages/scene-opening-context/src/index.js',
  'packages/opening-narrative-planner/src/index.js',
  'packages/novelty-guard/src/index.js',
  'packages/narration-quality-guard/src/index.js',
  'packages/narration-memory/src/index.js',
  'packages/memory/src/index.js',
  'packages/combat-service/src/index.js',
  'packages/adventure-library/src/index.js',
  'packages/generator-service/src/index.js',
  'packages/map-service/src/index.js',
  'packages/tutor-service/src/index.js',
  'packages/automation-service/src/index.js',
  'packages/backup-service/src/index.js',
  'packages/diagnostic-service/src/index.js',
  'packages/migration-service/src/index.js',
  'packages/session-simulator/src/index.js',
  'packages/audio-narration-service/src/index.js',
  'packages/neural-voice-service/src/index.js',
  'packages/voice-profile-service/src/index.js',
  'packages/config/src/index.js',
  'packages/intent-interpreter/src/index.js',
  'packages/rules-service/src/index.js',
  'packages/relationship-service/src/index.js',
  'packages/npc-coordinator/src/index.js',
  'packages/world-state/src/index.js',
  'packages/narration-service/src/index.js',
  'packages/foundry-publisher/src/index.js',
  'scripts/prepare-release.mjs',
  'scripts/run-tests.mjs',
  'scripts/run-integration-tests.mjs',
  'scripts/run-session-simulation.mjs',
  'scripts/run-load-tests.mjs',
  'scripts/migrate-data.mjs',
  'scripts/verify-installation.mjs',
  'scripts/build-distribution.mjs',
  'scripts/lib/zip.mjs',
  'distribution/windows/install-mestre-orc.ps1',
  'distribution/windows/update-mestre-orc.ps1',
  'distribution/windows/rollback-mestre-orc.ps1',
  'docs/INSTALLATION.md',
  'docs/UPDATING.md',
  'docs/MIGRATIONS.md',
  'docs/DISTRIBUTION.md',
  '.github/workflows/release.yml',
  '.env.example',
  'data/.gitkeep',
  '.gitignore',
  '.gitattributes',
  '.github/workflows/ci.yml',
  '.github/dependabot.yml',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'README.md'
];

for (const file of required) await access(new URL(file, root));

const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packageLock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const moduleJson = JSON.parse(await readFile(new URL('apps/foundry-module/module.json', root), 'utf8'));

if (packageJson.version !== moduleJson.version) {
  throw new Error(`Versões divergentes: engine=${packageJson.version}, foundry=${moduleJson.version}`);
}
if (packageJson.version !== packageLock.version || packageJson.version !== packageLock.packages?.['']?.version) {
  throw new Error('package.json e package-lock.json possuem versões divergentes.');
}

for (const scriptName of ['test', 'test:integration', 'test:session', 'test:load', 'test:all', 'validate', 'check', 'check:offline', 'release:prepare', 'release:build', 'migrate:inspect', 'migrate:apply', 'install:verify']) {
  if (!packageJson.scripts?.[scriptName]) throw new Error(`Script obrigatório ausente: ${scriptName}`);
}

for (const entry of [...(moduleJson.esmodules ?? []), ...(moduleJson.styles ?? [])]) {
  await access(new URL(`apps/foundry-module/${entry}`, root));
}

const gitignore = await readFile(new URL('.gitignore', root), 'utf8');
for (const expectedRule of ['node_modules/', '.env', 'data/*.json', 'data/backups/', 'data/migrations/', 'data/migration-state.json', 'dist/', 'reports/']) {
  if (!gitignore.split(/\r?\n/).includes(expectedRule)) {
    throw new Error(`Regra obrigatória ausente no .gitignore: ${expectedRule}`);
  }
}

const envExample = await readFile(new URL('.env.example', root), 'utf8');
const secretPatterns = [
  /\bgsk_[A-Za-z0-9]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
if (secretPatterns.some((pattern) => pattern.test(envExample))) {
  throw new Error('.env.example contém um valor com aparência de segredo real.');
}

try {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: new URL('.', root),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).split(/\r?\n/).filter(Boolean);
  const forbiddenTracked = tracked.filter((path) =>
    path === '.env' ||
    path.startsWith('node_modules/') ||
    path.startsWith('data/') && path.endsWith('.json') ||
    path.startsWith('data/migrations/') ||
    path.startsWith('dist/')
  );
  if (forbiddenTracked.length) {
    throw new Error(`Arquivos locais rastreados pelo Git: ${forbiddenTracked.join(', ')}`);
  }
} catch (error) {
  if (error?.message?.startsWith('Arquivos locais rastreados')) throw error;
  console.warn('Aviso: validação de arquivos rastreados pelo Git não pôde ser executada.');
}

const forbiddenLocal = ['.env', 'node_modules', 'data/narration-history.json', 'data/campaign-memory.json', 'data/adventure-library.json', 'data/voice-profiles.json', 'data/generated-content.json', 'data/map-blueprints.json', 'data/tutor-history.json', 'data/automation-proposals.json', 'data/backups', 'data/migrations', 'data/migration-state.json'];
for (const path of forbiddenLocal) {
  try {
    await access(new URL(path, root));
    console.warn(`Aviso local: ${path} existe, mas permanece fora do Git e da entrega.`);
  } catch {
    // Ausência esperada em uma cópia limpa do repositório.
  }
}

console.log(`Estrutura modular válida (${packageJson.version}).`);
