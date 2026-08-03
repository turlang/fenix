import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createZipFromDirectory } from '../scripts/lib/zip.mjs';

test('gerador ZIP puro produz arquivo compatível com a assinatura PK', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-zip-'));
  try {
    const source = join(directory, 'source');
    await mkdir(join(source, 'scripts'), { recursive: true });
    await writeFile(join(source, 'module.json'), '{"id":"mestre-orc"}');
    await writeFile(join(source, 'scripts', 'main.js'), 'export {};');
    const output = join(directory, 'module.zip');
    const result = await createZipFromDirectory(source, output);
    const buffer = await readFile(output);
    assert.equal(buffer.readUInt32LE(0), 0x04034b50);
    assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
    assert.equal(result.fileCount, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scripts Windows preservam dados, validam migração e oferecem rollback', async () => {
  const install = await readFile(new URL('../distribution/windows/install-mestre-orc.ps1', import.meta.url), 'utf8');
  const update = await readFile(new URL('../distribution/windows/update-mestre-orc.ps1', import.meta.url), 'utf8');
  const rollback = await readFile(new URL('../distribution/windows/rollback-mestre-orc.ps1', import.meta.url), 'utf8');
  assert.match(install, /migrate-data\.mjs/);
  assert.match(update, /Copy-Directory \(Join-Path \$EngineTarget 'data'\)/);
  assert.match(update, /verify-installation\.mjs/);
  assert.match(update, /previous/);
  assert.match(rollback, /Rollback concluído/);
});
