import test from 'node:test';
import assert from 'node:assert/strict';
import { replaceJsonStateFile } from '../packages/persistence-repository/src/index.js';

function transient(code = 'EPERM') {
  const error = new Error(`simulated ${code}`);
  error.code = code;
  return error;
}

test('JSON persistence retries transient Windows rename locks before succeeding', async () => {
  let renames = 0;
  let overwrites = 0;
  const waits = [];

  const result = await replaceJsonStateFile({
    tempPath: 'state.tmp',
    targetPath: 'state.json',
    payload: '{"ok":true}\n',
    renameFile: async () => {
      renames += 1;
      if (renames < 3) throw transient('EPERM');
    },
    writeTarget: async () => { overwrites += 1; },
    removeTemp: async () => undefined,
    sleep: async (ms) => { waits.push(ms); }
  });

  assert.equal(result.mode, 'rename');
  assert.equal(result.attempts, 3);
  assert.equal(renames, 3);
  assert.equal(overwrites, 0);
  assert.deepEqual(waits, [25, 50]);
});

test('JSON persistence falls back to overwrite after persistent EPERM', async () => {
  let renames = 0;
  let overwritePayload = null;
  let removed = 0;

  const result = await replaceJsonStateFile({
    tempPath: 'state.tmp',
    targetPath: 'state.json',
    payload: '{"safe":true}\n',
    renameFile: async () => {
      renames += 1;
      throw transient('EPERM');
    },
    writeTarget: async (path, payload) => {
      assert.equal(path, 'state.json');
      overwritePayload = payload;
    },
    removeTemp: async (path) => {
      assert.equal(path, 'state.tmp');
      removed += 1;
    },
    sleep: async () => undefined,
    maxAttempts: 3,
    logger: { warn() {} }
  });

  assert.equal(result.mode, 'overwrite');
  assert.equal(result.attempts, 3);
  assert.equal(renames, 3);
  assert.equal(overwritePayload, '{"safe":true}\n');
  assert.equal(removed, 1);
});

test('JSON persistence does not hide non-transient rename errors', async () => {
  await assert.rejects(
    () => replaceJsonStateFile({
      tempPath: 'state.tmp',
      targetPath: 'state.json',
      payload: '{}\n',
      renameFile: async () => { throw transient('ENOENT'); },
      sleep: async () => undefined
    }),
    (error) => error?.code === 'ENOENT'
  );
});
