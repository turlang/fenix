import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryCommandLedger } from '../packages/distributed-command-ledger/src/index.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('ledger executa commandId concorrente apenas uma vez e reapresenta o resultado', async () => {
  const ledger = new InMemoryCommandLedger();
  await ledger.initialize();
  let calls = 0;
  const input = {
    campaignId: 'campaign-a',
    sessionId: 'session-a',
    commandId: 'command-1',
    commandType: 'http:action',
    request: { content: 'abrir a porta' }
  };
  const execute = async () => {
    calls += 1;
    await sleep(20);
    return { state: 'COLLECTING_ACTIONS', narration: 'A porta se abre.' };
  };

  const [first, concurrent] = await Promise.all([
    ledger.execute({ ...input, execute }),
    ledger.execute({ ...input, execute })
  ]);
  const replay = await ledger.execute({ ...input, execute });

  assert.equal(calls, 1);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(replay, first);
});

test('ledger rejeita reutilização do mesmo commandId com payload diferente', async () => {
  const ledger = new InMemoryCommandLedger();
  await ledger.execute({
    campaignId: 'campaign-a',
    commandId: 'command-conflict',
    request: { value: 1 },
    execute: async () => ({ ok: true })
  });

  await assert.rejects(
    () => ledger.execute({
      campaignId: 'campaign-a',
      commandId: 'command-conflict',
      request: { value: 2 },
      execute: async () => ({ ok: false })
    }),
    (error) => error.code === 'COMMAND_ID_CONFLICT'
  );
});

test('falha durante execução vira outcome unknown e nunca é reexecutada automaticamente', async () => {
  const ledger = new InMemoryCommandLedger();
  let calls = 0;
  const input = {
    campaignId: 'campaign-a',
    commandId: 'command-unknown',
    request: { content: 'ação ambígua' }
  };

  await assert.rejects(
    () => ledger.execute({
      ...input,
      execute: async () => {
        calls += 1;
        const error = new Error('falha após efeito potencial');
        error.code = 'UPSTREAM_LOST';
        throw error;
      }
    }),
    /falha após efeito potencial/
  );

  await assert.rejects(
    () => ledger.execute({
      ...input,
      execute: async () => {
        calls += 1;
        return { duplicated: true };
      }
    }),
    (error) => error.code === 'COMMAND_OUTCOME_UNKNOWN'
  );
  assert.equal(calls, 1);
});
