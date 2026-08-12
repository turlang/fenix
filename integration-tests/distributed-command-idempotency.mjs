import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { PostgresCommandLedger } from '../packages/distributed-command-ledger/src/index.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL é obrigatória para o teste de idempotência distribuída.');

const admin = new Pool({ connectionString, max: 2, application_name: 'fenix-ci-idempotency-admin' });
const poolA = new Pool({ connectionString, max: 4, application_name: 'fenix-ci-idempotency-a' });
const poolB = new Pool({ connectionString, max: 4, application_name: 'fenix-ci-idempotency-b' });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

try {
  await admin.query('DROP TABLE IF EXISTS fenix_command_ledger');
  const ledgerA = new PostgresCommandLedger({ pool: poolA, waitTimeoutMs: 1500, pollIntervalMs: 20, unknownAfterMs: 5000, logger: {} });
  const ledgerB = new PostgresCommandLedger({ pool: poolB, waitTimeoutMs: 1500, pollIntervalMs: 20, unknownAfterMs: 5000, logger: {} });
  await Promise.all([ledgerA.initialize(), ledgerB.initialize()]);

  let executions = 0;
  const command = {
    campaignId: 'campaign-idempotency',
    sessionId: 'session-idempotency',
    commandId: 'command-once',
    commandType: 'http:action',
    request: { content: 'abrir a porta', actorId: 'hero-1' }
  };
  const execute = async () => {
    executions += 1;
    await sleep(80);
    return { state: 'COLLECTING_ACTIONS', narration: 'A porta se abre uma única vez.', revision: 9 };
  };

  const first = ledgerA.execute({ ...command, ownerId: 'engine-a', generation: 3, execute });
  await sleep(10);
  const duplicate = ledgerB.execute({ ...command, ownerId: 'engine-b', generation: 4, execute });
  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);

  assert.equal(executions, 1);
  assert.deepEqual(duplicateResult, firstResult);

  const replayAfterLostResponse = await ledgerB.execute({
    ...command,
    ownerId: 'engine-b',
    generation: 4,
    execute
  });
  assert.equal(executions, 1);
  assert.deepEqual(replayAfterLostResponse, firstResult);

  const row = await admin.query(
    `SELECT status, request_hash, result_json FROM fenix_command_ledger
     WHERE scope_key=$1 AND command_id=$2`,
    ['campaign:campaign-idempotency', 'command-once']
  );
  assert.equal(row.rowCount, 1);
  assert.equal(row.rows[0].status, 'COMPLETED');
  assert.equal(row.rows[0].result_json.narration, firstResult.narration);

  await assert.rejects(
    () => ledgerB.execute({
      ...command,
      request: { content: 'payload diferente' },
      execute
    }),
    (error) => error.code === 'COMMAND_ID_CONFLICT'
  );

  let ambiguousExecutions = 0;
  const ambiguous = {
    campaignId: 'campaign-idempotency',
    commandId: 'command-ambiguous',
    commandType: 'http:action',
    request: { content: 'efeito possivelmente produzido' }
  };
  await assert.rejects(
    () => ledgerA.execute({
      ...ambiguous,
      execute: async () => {
        ambiguousExecutions += 1;
        const error = new Error('conexão perdida depois do ponto de efeito');
        error.code = 'SIMULATED_RESPONSE_LOSS';
        throw error;
      }
    }),
    /conexão perdida/
  );
  await assert.rejects(
    () => ledgerB.execute({
      ...ambiguous,
      execute: async () => {
        ambiguousExecutions += 1;
        return { duplicated: true };
      }
    }),
    (error) => error.code === 'COMMAND_OUTCOME_UNKNOWN'
  );
  assert.equal(ambiguousExecutions, 1);

  console.log('Distributed command idempotency integration OK');
} finally {
  await Promise.allSettled([poolA.end(), poolB.end(), admin.end()]);
}
