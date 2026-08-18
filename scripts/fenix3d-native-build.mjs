import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.join(root, 'apps', 'fenix3d-unreal', 'Fenix3D.uproject');
const engineRoot = String(process.env.FENIX_UNREAL_ENGINE_ROOT ?? '').trim();
const platform = process.platform === 'win32' ? 'Win64' : 'Linux';
const batchFile = process.platform === 'win32' ? 'Build.bat' : 'Build.sh';
const buildTool = engineRoot
  ? path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', batchFile)
  : '';

if (!engineRoot || !existsSync(buildTool)) {
  console.error('FENIX_UNREAL_ENGINE_ROOT deve apontar para uma instalação Unreal Engine 5.5 válida.');
  process.exit(2);
}
if (!existsSync(project)) {
  console.error(`Projeto Unreal não encontrado: ${project}`);
  process.exit(2);
}

const args = [
  'Fenix3DEditor',
  platform,
  'Development',
  `-Project=${project}`,
  '-WaitMutex',
  '-NoHotReloadFromIDE'
];

console.log(`[Fenix3D] Native build: ${buildTool}`);
const child = spawn(buildTool, args, {
  cwd: root,
  stdio: 'inherit',
  shell: false,
  windowsHide: true
});
child.on('error', (error) => {
  console.error('[Fenix3D] Falha ao iniciar Unreal Build Tool:', error.message);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) console.error(`[Fenix3D] Build encerrado por sinal ${signal}.`);
  process.exit(code ?? 1);
});
