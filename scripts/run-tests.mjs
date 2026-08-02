import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const testDirectory = join(projectRoot, 'test');
const testFiles = (await readdir(testDirectory))
  .filter((file) => file.endsWith('.test.js'))
  .sort()
  .map((file) => join(testDirectory, file));

if (!testFiles.length) {
  throw new Error('Nenhum arquivo *.test.js foi encontrado em test/.');
}

const child = spawn(process.execPath, ['--test', ...testFiles], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env
});

child.once('error', (error) => {
  console.error('Falha ao iniciar os testes:', error);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal) {
    console.error(`Testes interrompidos pelo sinal ${signal}.`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
