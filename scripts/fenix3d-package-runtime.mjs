import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'apps', 'fenix3d-unreal', 'Fenix3D.uproject');
const engineRoot = String(process.env.FENIX_UNREAL_ENGINE_ROOT ?? '').trim();
const requestedConfiguration = String(process.env.FENIX_UNREAL_PACKAGE_CONFIG ?? 'Development').trim() || 'Development';
const configuration = /^(shipping|development)$/i.test(requestedConfiguration)
  ? requestedConfiguration
  : 'Development';
const configuredArchiveRoot = String(process.env.FENIX_UNREAL_ARCHIVE_DIR ?? '').trim();
const archiveRoot = path.resolve(configuredArchiveRoot || path.join(root, 'dist', 'fenix3d', 'Win64'));
const runUat = engineRoot ? path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'RunUAT.bat') : '';

function findExecutable(directory) {
  if (!existsSync(directory)) return null;
  for (const entry of readdirSync(directory)) {
    const candidate = path.join(directory, entry);
    const stats = statSync(candidate);
    if (stats.isDirectory()) {
      const nested = findExecutable(candidate);
      if (nested) return nested;
    } else if (/^Fenix3D\.exe$/i.test(entry)) {
      return candidate;
    }
  }
  return null;
}

if (process.platform !== 'win32') {
  console.error('O pacote Fenix3D Win64 deve ser gerado em Windows com Unreal Engine 5.5.');
  process.exit(2);
}
if (!engineRoot || !existsSync(runUat)) {
  console.error('FENIX_UNREAL_ENGINE_ROOT deve apontar para uma instalação Unreal Engine 5.5 válida.');
  process.exit(2);
}
if (!existsSync(project)) {
  console.error(`Projeto Unreal não encontrado: ${project}`);
  process.exit(2);
}

mkdirSync(archiveRoot, { recursive: true });
const args = [
  'BuildCookRun',
  `-project=${project}`,
  '-noP4',
  '-platform=Win64',
  `-clientconfig=${configuration}`,
  '-build',
  '-cook',
  '-stage',
  '-pak',
  '-archive',
  `-archivedirectory=${archiveRoot}`,
  '-utf8output'
];

console.log(`[Fenix3D] Packaging ${configuration} -> ${archiveRoot}`);
const child = spawn(runUat, args, {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  windowsHide: true
});
child.on('error', (error) => {
  console.error('[Fenix3D] Falha ao iniciar RunUAT:', error.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal || code !== 0) {
    console.error(`[Fenix3D] Packaging falhou (${signal ?? code}).`);
    process.exit(code ?? 1);
  }
  const executable = findExecutable(archiveRoot);
  if (!executable) {
    console.error('[Fenix3D] Packaging terminou, mas Fenix3D.exe não foi encontrado no archive.');
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: true, configuration, archiveRoot, executable }, null, 2));
});
