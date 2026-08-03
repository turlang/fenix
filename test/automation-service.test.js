import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AutomationActionTypes,
  FileAutomationService,
  InMemoryAutomationService,
  automationInternals
} from '../packages/automation-service/src/index.js';
import { aiProviderInternals, PromptNarrativeProvider, ResilientNarrativeProvider } from '../packages/ai-provider/src/index.js';

const gm = { id: 'gm-1', name: 'Mestre', isGM: true };
const player = { id: 'player-1', name: 'Jogador', isGM: false };

function chatProposal(overrides = {}) {
  return {
    requester: gm,
    actionType: 'CHAT_MESSAGE',
    title: 'Aviso da sessão',
    rationale: 'Informar o grupo sem revelar segredos.',
    payload: { content: 'As portas da fortaleza estão abertas.', visibility: 'PUBLIC' },
    ...overrides
  };
}

test('serviço expõe somente ações permitidas, reversíveis e classificadas por risco', () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const definitions = service.definitions();
  assert.deepEqual(definitions.actionTypes, AutomationActionTypes);
  assert.equal(definitions.actions.every((entry) => entry.reversible === true), true);
  assert.equal(definitions.actions.find((entry) => entry.id === 'UPDATE_ACTOR_RESOURCE').risk, 'HIGH');
  assert.equal(definitions.actions.some((entry) => /DELETE_WORLD|RUN_SCRIPT/.test(entry.id)), false);
});

test('somente GM pode criar, sugerir, aprovar ou executar propostas', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  await assert.rejects(service.create('world-1', chatProposal({ requester: player })), (error) => error.code === 'AUTOMATION_GM_REQUIRED' && error.statusCode === 403);
  await assert.rejects(service.suggest('world-1', { requester: player, goal: 'Publique um aviso.' }), (error) => error.code === 'AUTOMATION_GM_REQUIRED');
});

test('proposta exige aprovação separada antes da execução e mantém token fora da leitura pública', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const created = await service.create('world-1', chatProposal());
  assert.equal(created.proposal.status, 'PENDING');
  await assert.rejects(service.claimExecution('world-1', created.proposal.id, { requester: gm, expectedRevision: created.proposal.revision }), (error) => error.code === 'AUTOMATION_NOT_APPROVED');

  const approved = await service.approve('world-1', created.proposal.id, { requester: gm, expectedRevision: created.proposal.revision });
  assert.equal(approved.proposal.status, 'APPROVED');
  const claim = await service.claimExecution('world-1', created.proposal.id, { requester: gm, expectedRevision: approved.proposal.revision });
  assert.equal(claim.proposal.status, 'EXECUTING');
  assert.ok(claim.executionToken);
  assert.equal(claim.proposal.execution.token, undefined);

  const completed = await service.completeExecution('world-1', created.proposal.id, {
    requester: gm,
    expectedRevision: claim.proposal.revision,
    executionToken: claim.executionToken,
    success: true,
    receipt: { messageId: 'message-1', authorization: 'não deve persistir' }
  });
  assert.equal(completed.proposal.status, 'EXECUTED');
  assert.equal(completed.proposal.execution.receipt.messageId, 'message-1');
  assert.equal('authorization' in completed.proposal.execution.receipt, false);
});

test('execução reversível registra claim e conclusão da reversão', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const created = await service.create('world-rollback', chatProposal());
  const approved = await service.approve('world-rollback', created.proposal.id, { requester: gm });
  const claim = await service.claimExecution('world-rollback', created.proposal.id, { requester: gm });
  const completed = await service.completeExecution('world-rollback', created.proposal.id, {
    requester: gm, executionToken: claim.executionToken, success: true, receipt: { messageId: 'msg-1' }
  });
  const rollbackClaim = await service.claimRollback('world-rollback', created.proposal.id, { requester: gm, expectedRevision: completed.proposal.revision });
  assert.equal(rollbackClaim.proposal.status, 'ROLLING_BACK');
  assert.ok(rollbackClaim.rollbackToken);
  const rolledBack = await service.completeRollback('world-rollback', created.proposal.id, {
    requester: gm, expectedRevision: rollbackClaim.proposal.revision, rollbackToken: rollbackClaim.rollbackToken, success: true
  });
  assert.equal(rolledBack.proposal.status, 'ROLLED_BACK');
  assert.ok(rolledBack.proposal.audit.some((entry) => entry.type === 'ROLLED_BACK'));
});

test('conflito de revisão impede duplo clique e condições de corrida', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const created = await service.create('world-revision', chatProposal());
  const approved = await service.approve('world-revision', created.proposal.id, { requester: gm, expectedRevision: created.proposal.revision });
  await assert.rejects(
    service.reject('world-revision', created.proposal.id, { requester: gm, expectedRevision: created.proposal.revision }),
    (error) => error.code === 'AUTOMATION_REVISION_CONFLICT' && error.statusCode === 409
  );
  assert.equal((await service.get('world-revision', created.proposal.id)).status, approved.proposal.status);
});

test('propostas idênticas pendentes são deduplicadas', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const first = await service.create('world-duplicate', chatProposal());
  const second = await service.create('world-duplicate', chatProposal());
  assert.equal(second.duplicate, true);
  assert.equal(second.proposal.id, first.proposal.id);
  assert.equal((await service.list('world-duplicate')).total, 1);
});

test('caminho de recurso é estritamente limitado e valor anterior fica para o recibo do Foundry', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const safe = await service.create('world-resource', {
    requester: gm,
    actionType: 'UPDATE_ACTOR_RESOURCE',
    payload: { actorId: 'actor-1', actorName: 'Lira', path: 'system.attributes.hp.value', value: 17, reason: 'Dano confirmado no Foundry.' }
  });
  assert.equal(safe.proposal.risk, 'HIGH');
  assert.equal(safe.proposal.payload.value, 17);
  await assert.rejects(service.create('world-resource', {
    requester: gm,
    actionType: 'UPDATE_ACTOR_RESOURCE',
    payload: { actorId: 'actor-1', path: 'ownership.default', value: 3 }
  }), (error) => error.code === 'AUTOMATION_RESOURCE_PATH_FORBIDDEN');
});

test('sugestão por IA descarta ações e payloads fora da lista segura e nunca executa automaticamente', async () => {
  const service = new InMemoryAutomationService({
    narrator: {
      async suggestAutomations() {
        return JSON.stringify({ proposals: [
          { actionType: 'RUN_SCRIPT', title: 'Perigosa', payload: { code: 'game.world.delete()' } },
          { actionType: 'UPDATE_ACTOR_RESOURCE', title: 'Caminho proibido', payload: { actorId: 'a', path: 'ownership.default', value: 3 } },
          { actionType: 'CREATE_JOURNAL', title: 'Plano da cena', rationale: 'Registrar opções.', payload: { name: 'Plano', pageName: 'Cena', content: 'Três consequências reversíveis.' } }
        ] });
      }
    }, logger: {}
  });
  const result = await service.suggest('world-ai', { requester: gm, goal: 'Organize a cena.', context: { scene: { id: 'scene-1', name: 'Ponte' } } });
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].actionType, 'CREATE_JOURNAL');
  assert.equal(result.proposals[0].status, 'PENDING');
  assert.equal(result.automaticExecution, false);
  assert.equal(result.approvalRequired, true);
});

test('fallback sem IA cria somente um Journal de planejamento pendente', async () => {
  const service = new InMemoryAutomationService({ logger: {} });
  const result = await service.suggest('world-fallback', { requester: gm, goal: 'Preparar a próxima cena.', context: { scene: { name: 'Cripta' } } });
  assert.equal(result.fallback, true);
  assert.equal(result.proposals[0].actionType, 'CREATE_JOURNAL');
  assert.equal(result.proposals[0].status, 'PENDING');
  assert.match(result.proposals[0].rationale, /Nenhum provedor/i);
});

test('arquivo de propostas persiste ciclo e auditoria após reinício', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-automations-'));
  const filePath = join(directory, 'automations.json');
  try {
    const first = new FileAutomationService({ filePath, logger: {} });
    const created = await first.create('world-file', chatProposal());
    await first.approve('world-file', created.proposal.id, { requester: gm });
    const second = new FileAutomationService({ filePath, logger: {} });
    const proposal = await second.get('world-file', created.proposal.id);
    assert.equal(proposal.status, 'APPROVED');
    assert.ok(proposal.audit.some((entry) => entry.type === 'APPROVED'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prompt de automação exige JSON, allowlist, aprovação e ausência de IDs inventados', () => {
  const prompt = aiProviderInternals.automationSuggestionPrompt({
    goal: 'Prepare um aviso.', context: { scene: { id: 'scene-1' } },
    allowedActions: [{ id: 'CHAT_MESSAGE', risk: 'LOW', reversible: true, description: 'Mensagem' }]
  });
  assert.match(prompt, /SOMENTE com JSON válido/);
  assert.match(prompt, /NÃO executa nada/);
  assert.match(prompt, /Nunca invente IDs/i);
  assert.match(prompt, /CHAT_MESSAGE/);
});

test('PromptNarrativeProvider e fallback resiliente suportam sugestões de automação', async () => {
  const requests = [];
  const promptProvider = new PromptNarrativeProvider({ requestText: async (payload) => { requests.push(payload); return '{"proposals":[]}'; } });
  await promptProvider.suggestAutomations({ goal: 'Teste', context: {}, allowedActions: [] });
  assert.match(requests[0].prompt, /planejador de automações assistidas/i);

  const resilient = new ResilientNarrativeProvider({
    providers: [
      { id: 'primary', provider: { async suggestAutomations() { throw Object.assign(new Error('falha'), { statusCode: 503 }); } } },
      { id: 'fallback', provider: { async suggestAutomations() { return '{"proposals":[]}'; } } }
    ], failureThreshold: 1, logger: {}
  });
  assert.equal(await resilient.suggestAutomations({}), '{"proposals":[]}');
  assert.equal(resilient.getStatus().activeProvider, 'fallback');
});

test('sanitização de contexto remove credenciais antes de chamar IA', () => {
  const compact = automationInternals.compactObject({ scene: { id: 's1' }, apiKey: 'segredo', nested: { authorization: 'bearer', value: 3 } });
  assert.equal(compact.scene.id, 's1');
  assert.equal('apiKey' in compact, false);
  assert.equal('authorization' in compact.nested, false);
  assert.equal(compact.nested.value, 3);
});
