import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const moduleManifest = JSON.parse(await readFile(new URL('../apps/foundry-module/module.json', import.meta.url), 'utf8'));
const main = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
const server = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-distribution.mjs', import.meta.url), 'utf8');

test('Release Candidate usa versão sincronizada e lock reproduzível', () => {
  assert.match(pkg.version, /^1\.0\.0-rc\.\d+$/);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(moduleManifest.version, pkg.version);
  assert.equal(pkg.dependencies.fastify, '5.10.0');
  assert.equal(lock.packages['node_modules/fast-uri'].version, '3.1.4');
});

test('API aplica autenticação, rate limit, CORS e cabeçalhos defensivos', () => {
  assert.match(server, /apiTokenMatches/);
  assert.match(server, /API_AUTH_REQUIRED/);
  assert.match(server, /RATE_LIMIT_EXCEEDED/);
  assert.match(server, /ORIGIN_NOT_ALLOWED/);
  assert.match(server, /buildSecurityHeaders/);
  assert.match(server, /release\/readiness/);
});

test('módulo usa URL e token configuráveis e logs condicionais', () => {
  assert.match(main, /engineApiUrl/);
  assert.match(main, /engineApiToken/);
  assert.match(main, /X-Mestre-Orc-Token/);
  assert.match(main, /debugLogging/);
  assert.doesNotMatch(main, /const\s+API_URL\s*=/);
  assert.doesNotMatch(main, /console\.log\s*\(/);
});

test('documentação histórica está consolidada e gate inclui auditoria e SBOM', async () => {
  const rootFiles = await readdir(new URL('../', import.meta.url));
  assert.equal(rootFiles.some((name) => /^README-ALPHA\d+\.md$/i.test(name)), false);
  for (const path of ['docs/ARCHITECTURE.md', 'docs/TROUBLESHOOTING.md', 'docs/PRIVACY.md', 'docs/KNOWN-LIMITATIONS.md', 'docs/RELEASE-CHECKLIST.md', 'docs/archive/ALPHA-HISTORY.md']) {
    await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  }
  assert.match(build, /release-candidate-audit\.json/);
  assert.match(build, /mestre-orc-sbom\.cdx\.json/);
});
