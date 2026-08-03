import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileTutorService, InMemoryTutorService, tutorInternals } from '../packages/tutor-service/src/index.js';
import { aiProviderInternals, PromptNarrativeProvider, ResilientNarrativeProvider } from '../packages/ai-provider/src/index.js';

const actor = {
  id: 'actor-1', name: 'Lira', type: 'character', systemId: 'dnd5e', level: 4,
  abilities: { dex: { value: 16, mod: 3 }, int: { value: 14, mod: 2 } },
  attributes: { ac: { value: 15 }, hp: { value: 22, max: 28 }, prof: 2 },
  resources: { primary: { value: 1, max: 3, label: 'Dados de superioridade' } },
  classes: [{ name: 'Guerreira', level: 4 }],
  items: [{ id: 'item-1', name: 'Arco longo', type: 'weapon' }]
};

const owner = { requester: { id: 'user-1', name: 'Jogadora', isGM: false }, access: { canView: true, isOwner: true, canEdit: true } };

test('Tutor de Ficha usa somente fatos autorizados e nunca aplica alterações', async () => {
  let payload = null;
  const service = new InMemoryTutorService({
    narrator: {
      async answerSheetTutor(input) {
        payload = input;
        return JSON.stringify({ answer: 'A CA registrada é 15.', confidence: 'HIGH', sources: [input.facts.find((fact) => fact.path === 'attributes.ac').id], warnings: [], suggestedActions: ['Abra a armadura equipada.'] });
      }
    },
    logger: {}
  });
  const result = await service.askSheet('world-1', { ...owner, question: 'Qual é minha CA?', actor });
  assert.equal(result.answer, 'A CA registrada é 15.');
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.automaticChanges, false);
  assert.equal(result.sourceFacts[0].value, 15);
  assert.equal(payload.actor.name, 'Lira');
  assert.ok(result.warnings.some((entry) => /consultivo|altera/i.test(entry)));
});

test('Tutor de Ficha rejeita consulta a ficha sem propriedade', async () => {
  const service = new InMemoryTutorService({ logger: {} });
  await assert.rejects(
    service.askSheet('world-1', { requester: owner.requester, access: { canView: true, isOwner: false }, question: 'Explique a ficha.', actor }),
    (error) => error.code === 'TUTOR_SHEET_FORBIDDEN' && error.statusCode === 403
  );
});

test('mestre pode consultar uma ficha mesmo sem ownership explícito', async () => {
  const service = new InMemoryTutorService({ logger: {} });
  const result = await service.askSheet('world-1', { requester: { id: 'gm', isGM: true }, access: { canView: true, isOwner: false }, question: 'Resumo da ficha.', actor });
  assert.equal(result.mode, 'SHEET');
  assert.equal(result.actor.id, 'actor-1');
});

test('fallback do Tutor de Ficha permanece estritamente ancorado na ficha', async () => {
  const service = new InMemoryTutorService({ logger: {} });
  const result = await service.askSheet('world-1', { ...owner, question: 'Quantos pontos de vida aparecem?', actor });
  assert.match(result.answer, /ficha de Lira/i);
  assert.doesNotMatch(result.answer, /dragão|tesouro|armadilha/i);
  assert.equal(result.confidence === 'MEDIUM' || result.confidence === 'LOW', true);
});

test('Tutor de Mestre recebe memória e referências inclusive GM_ONLY', async () => {
  let payload = null;
  const campaignMemory = {
    async load() {
      return { facts: { a: { id: 'a', text: 'A ponte ruiu.', visibility: 'known' } }, npcs: {}, relationships: {}, quests: {}, items: {}, recentEvents: [], worldState: { tension: 2 } };
    }
  };
  const adventureLibrary = {
    async search() {
      return [{ document: { id: 'doc-1', title: 'A Torre' }, chunk: { heading: 'Segredo do mestre', text: 'O sino controla a passagem.', access: 'GM_ONLY' } }];
    }
  };
  const service = new InMemoryTutorService({
    campaignMemory, adventureLibrary, logger: {},
    narrator: {
      async answerGmTutor(input) {
        payload = input;
        return JSON.stringify({ answer: 'Use o sino como pista gradual.', confidence: 'MEDIUM', sources: [input.facts[0].id], warnings: ['Não revele a solução inteira.'], suggestedActions: ['Mostre marcas de uso no sino.'] });
      }
    }
  });
  const result = await service.askGm('world-1', { requester: { id: 'gm', name: 'Mestre', isGM: true }, question: 'Como destravar a cena?', scene: { name: 'Torre' } });
  assert.match(result.answer, /sino/i);
  assert.equal(payload.context.references[0].access, 'GM_ONLY');
  assert.equal(result.sourceFacts.length, 1);
  assert.equal(result.contextSummary.referenceCount, 1);
});

test('Tutor de Mestre é exclusivo do GM', async () => {
  const service = new InMemoryTutorService({ logger: {} });
  await assert.rejects(
    service.askGm('world-1', { requester: { id: 'user-1', isGM: false }, question: 'Qual é o segredo?' }),
    (error) => error.code === 'TUTOR_GM_FORBIDDEN' && error.statusCode === 403
  );
});

test('histórico respeita privacidade entre jogadores e dá visão completa ao GM', async () => {
  const service = new InMemoryTutorService({ logger: {} });
  await service.askSheet('world-history', { ...owner, question: 'Explique a CA.', actor });
  await service.askSheet('world-history', { requester: { id: 'user-2', isGM: false }, access: { canView: true, isOwner: true }, question: 'Explique o HP.', actor: { ...actor, id: 'actor-2', name: 'Dorn' } });
  assert.equal((await service.history('world-history', { id: 'user-1', isGM: false })).length, 1);
  assert.equal((await service.history('world-history', { id: 'user-2', isGM: false })).length, 1);
  assert.equal((await service.history('world-history', { id: 'gm', isGM: true })).length, 2);
});

test('histórico do tutor persiste em arquivo após reinício', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-tutor-'));
  const filePath = join(directory, 'history.json');
  try {
    const first = new FileTutorService({ filePath, logger: {} });
    await first.askSheet('world-file', { ...owner, question: 'Explique o nível.', actor });
    const second = new FileTutorService({ filePath, logger: {} });
    const history = await second.history('world-file', { id: 'user-1', isGM: false });
    assert.equal(history.length, 1);
    assert.equal(history[0].actorName, 'Lira');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sanitização remove campos com aparência de credencial', () => {
  const compact = tutorInternals.compactObject({ name: 'Lira', apiKey: 'segredo', nested: { authorization: 'bearer', value: 2 } });
  assert.equal(compact.name, 'Lira');
  assert.equal('apiKey' in compact, false);
  assert.equal('authorization' in compact.nested, false);
  assert.equal(compact.nested.value, 2);
});

test('prompts dos tutores exigem JSON, fontes válidas e nenhuma alteração automática', () => {
  const sheet = aiProviderInternals.sheetTutorPrompt({ question: 'Explique a CA', actor, facts: [{ id: 'f1', label: 'CA', path: 'attributes.ac', value: 15 }] });
  const gm = aiProviderInternals.gmTutorPrompt({ question: 'Como arbitrar?', context: {}, facts: [] });
  assert.match(sheet, /SOMENTE com JSON válido/);
  assert.match(sheet, /nunca altere a ficha/i);
  assert.match(sheet, /\[f1\]/);
  assert.match(gm, /não altere Scene, ficha, combate/i);
  assert.match(gm, /decisão provisória reversível/i);
});

test('PromptNarrativeProvider e fallback resiliente suportam os dois tutores', async () => {
  const requests = [];
  const promptProvider = new PromptNarrativeProvider({ requestText: async (payload) => { requests.push(payload); return '{"answer":"ok"}'; } });
  await promptProvider.answerSheetTutor({ question: 'Ficha?', actor, facts: [] });
  await promptProvider.answerGmTutor({ question: 'Cena?', context: {}, facts: [] });
  assert.equal(requests.length, 2);
  assert.match(requests[0].prompt, /Tutor de Ficha/);
  assert.match(requests[1].prompt, /Tutor de Mestre/);

  const resilient = new ResilientNarrativeProvider({
    providers: [
      { id: 'primary', provider: { async answerSheetTutor() { throw Object.assign(new Error('falha'), { statusCode: 503 }); } } },
      { id: 'fallback', provider: { async answerSheetTutor() { return '{"answer":"fallback"}'; } } }
    ], failureThreshold: 1, logger: {}
  });
  assert.match(await resilient.answerSheetTutor({}), /fallback/);
  assert.equal(resilient.getStatus().activeProvider, 'fallback');
});
