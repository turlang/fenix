import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const integrationDirectory = join(projectRoot, 'integration');
const files = (await readdir(integrationDirectory))
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => join(integrationDirectory, file));
if (!files.length) throw new Error('Nenhum teste de integração foi encontrado em integration/.');
const child = spawn(process.execPath, ['--test', ...files], { cwd: projectRoot, stdio: 'inherit', env: process.env });
child.once('error', (error) => { console.error('Falha ao iniciar os testes de integração:', error); process.exitCode = 1; });
child.once('exit', (code, signal) => {
  if (signal) { console.error(`Testes de integração interrompidos por ${signal}.`); process.exitCode = 1; return; }
  process.exitCode = code ?? 1;
});
