import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, process.env.RELEASE_AUDIT_REPORT_FILE || 'reports/release-audit.json');
const checks = [];
const excluded = new Set(['.git', 'node_modules', 'dist', 'reports', 'coverage', 'data']);

function add(id, passed, detail, severity = 'error') {
  checks.push({ id, passed: Boolean(passed), severity, detail });
}
function versionTuple(value) {
  return String(value || '').split('.').map((part) => Number(part.replace(/\D.*$/, '')) || 0);
}
function atLeast(value, minimum) {
  const left = versionTuple(value); const right = versionTuple(minimum);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] || 0) > (right[i] || 0)) return true;
    if ((left[i] || 0) < (right[i] || 0)) return false;
  }
  return true;
}
async function files(directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}
async function exists(path) {
  try { await access(resolve(root, path)); return true; } catch { return false; }
}

const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
const moduleManifest = JSON.parse(await readFile(join(root, 'apps/foundry-module/module.json'), 'utf8'));
const server = await readFile(join(root, 'apps/api/src/server.js'), 'utf8');
const main = await readFile(join(root, 'apps/foundry-module/scripts/main.js'), 'utf8');
const envExample = await readFile(join(root, '.env.example'), 'utf8');
const releaseChecklist = await readFile(join(root, 'docs/RELEASE-CHECKLIST.md'), 'utf8');

add('version.stable', pkg.version === '1.0.0', `Versão atual: ${pkg.version}`);
add('version.consistency', pkg.version === lock.version && pkg.version === lock.packages?.['']?.version && pkg.version === moduleManifest.version, 'Engine, lock e módulo usam a mesma versão.');
add('runtime.private-package', pkg.private === true && pkg.license === 'UNLICENSED', 'Pacote permanece privado e sem concessão de licença implícita.');
add('release.stable-readiness', /status:\s*'stable'/.test(server) && /channel:\s*'stable'/.test(server) && /realFoundryValidationCompleted:\s*true/.test(server), 'Endpoint de prontidão declara canal estável e validação física concluída.');
add('release.checklist-complete', !/^- \[ \]/m.test(releaseChecklist), 'Checklist da versão estável não possui itens pendentes.');

const requiredDocs = ['docs/ARCHITECTURE.md', 'docs/INSTALLATION.md', 'docs/UPDATING.md', 'docs/MIGRATIONS.md', 'docs/DISTRIBUTION.md', 'docs/TROUBLESHOOTING.md', 'docs/PRIVACY.md', 'docs/KNOWN-LIMITATIONS.md', 'docs/RELEASE-CHECKLIST.md', 'docs/archive/ALPHA-HISTORY.md', 'SECURITY.md', 'NOTICE.md'];
for (const document of requiredDocs) add(`docs.${document}`, await exists(document), `${document} presente.`);
const topLevel = await readdir(root);
add('docs.no-alpha-readmes', !topLevel.some((name) => /^README-ALPHA\d+\.md$/i.test(name)), 'READMEs históricos foram consolidados em docs/archive.');

const sourceFiles = await files();
const secretPatterns = [
  /\bgsk_[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /(?:api[_-]?key|token|password|passphrase)\s*[:=]\s*["']([^"'\n]{20,})["']/gi
];
const secretHits = [];
for (const path of sourceFiles) {
  const metadata = await stat(path);
  if (metadata.size > 2_000_000) continue;
  const text = await readFile(path, 'utf8').catch(() => '');
  for (const pattern of secretPatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) {
      const candidate = String(match[1] ?? match[0] ?? '');
      if (candidate.includes('${') || /^(?:example|placeholder|test|token-seguro|sua[_-]?chave)/i.test(candidate)) continue;
      secretHits.push(relative(root, path));
      break;
    }
  }
}
add('security.secret-scan', secretHits.length === 0, secretHits.length ? `Possíveis segredos: ${[...new Set(secretHits)].join(', ')}` : 'Nenhum segredo com padrão conhecido encontrado.');
add('security.local-default', /HOST=127\.0\.0\.1/.test(envExample), 'O exemplo usa binding local por padrão.');
add('security.token-config', /MESTRE_ORC_API_TOKEN=/.test(envExample) && /MESTRE_ORC_REQUIRE_API_TOKEN=/.test(envExample), 'Token e política de autenticação documentados.');
add('security.server-headers', /buildSecurityHeaders/.test(server) && /X-Content-Type-Options/.test(await readFile(join(root, 'packages/api-security/src/index.js'), 'utf8')), 'Cabeçalhos defensivos habilitados.');
add('security.server-auth', /apiTokenMatches/.test(server) && /API_AUTH_REQUIRED/.test(server), 'Autenticação por token integrada ao Engine.');
add('security.rate-limit', /createFixedWindowRateLimiter/.test(server) && /RATE_LIMIT_EXCEEDED/.test(server), 'Rate limit integrado ao Engine.');
add('security.no-hardcoded-api-url', !/const\s+API_URL\s*=/.test(main), 'URL do Engine vem da configuração do Foundry.');
add('quality.debug-gated', !/console\.log\s*\(/.test(main) && /debugLogging/.test(main), 'Logs detalhados do cliente são opcionais.');

const resolutions = Object.values(lock.packages || {}).map((entry) => entry?.resolved).filter(Boolean);
const nonPublicResolutions = resolutions.filter((url) => !String(url).startsWith('https://registry.npmjs.org/'));
add('dependencies.public-registry', nonPublicResolutions.length === 0, nonPublicResolutions.length ? `Resoluções externas: ${nonPublicResolutions.join(', ')}` : 'Lock usa somente o registro público do npm.');
const fastify = lock.packages?.['node_modules/fastify']?.version;
const fastUri = lock.packages?.['node_modules/fast-uri']?.version;
add('dependencies.fastify-major', /^5\./.test(fastify || ''), `Fastify bloqueado em ${fastify || 'ausente'}.`);
add('dependencies.fast-uri-patched', atLeast(fastUri, '3.1.2'), `fast-uri ${fastUri || 'ausente'}; mínimo seguro 3.1.2.`);

const forbidden = ['.env', 'node_modules', 'data/narration-history.json', 'data/campaign-memory.json', 'data/adventure-library.json', 'data/backups', 'reports/session-report.json'];
for (const path of forbidden) add(`delivery.forbidden.${path}`, !(await exists(path)), `${path} ausente da cópia auditada.`, 'warning');

const failed = checks.filter((entry) => !entry.passed && entry.severity === 'error');
const warnings = checks.filter((entry) => !entry.passed && entry.severity === 'warning');
const payload = {
  format: 'mestre-orc-release-audit',
  formatVersion: 1,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  status: failed.length ? 'FAILED' : warnings.length ? 'READY_WITH_WARNINGS' : 'READY',
  summary: { total: checks.length, passed: checks.filter((entry) => entry.passed).length, failed: failed.length, warnings: warnings.length },
  checks
};
const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
const report = { ...payload, sha256: digest };
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Auditoria de release: ${report.status} — ${report.summary.passed}/${report.summary.total} verificações (${output}).`);
if (failed.length) {
  for (const entry of failed) console.error(`- ${entry.id}: ${entry.detail}`);
  process.exitCode = 1;
}
