import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  FileGeneratorService,
  InMemoryGeneratorService,
  generatorInternals
} from '../packages/generator-service/src/index.js';
import { aiProviderInternals, PromptNarrativeProvider, ResilientNarrativeProvider } from '../packages/ai-provider/src/index.js';

function generated({ title, summary, content, metadata = {}, tags = [] }) {
  return JSON.stringify({ title, summary, tags, metadata, content });
}

const adventureOne = generated({
  title: 'O Sino Sob a Maré',
  summary: 'Uma vila costeira perde suas memórias sempre que um sino submerso toca durante a maré baixa.',
  tags: ['costa', 'mistério', 'memória'],
  metadata: { hook: 'Moradores esquecem os próprios nomes.', estimatedSessions: 3, structure: 'três atos' },
  content: '# Premissa\nA vila de Salmaré acorda sem reconhecer seus mortos.\n\n# Ato I\nOs heróis investigam marcas de sal nas portas e descobrem uma procissão noturna.\n\n# Ato II\nO sino repousa em um templo inundado protegido por guardiões de coral.\n\n# Ato III\nO grupo escolhe entre silenciar o sino ou devolver as lembranças roubadas ao espírito que o criou.\n\n# Segredo do mestre\nA prefeita conhece a origem do ritual e apagou o nome da própria filha.'
});

const adventureTwo = generated({
  title: 'A Colheita das Sombras',
  summary: 'Campos férteis projetam sombras que trabalham sozinhas à noite e exigem pagamento quando chega o amanhecer.',
  tags: ['campo', 'sombras', 'pacto'],
  metadata: { hook: 'Ferramentas se movem sem mãos.', estimatedSessions: 2, structure: 'investigação e confronto' },
  content: '# Premissa\nNa aldeia de Trigalva, sombras sem donos colhem os campos depois do pôr do sol.\n\n# Investigação\nPegadas terminam diante de espantalhos costurados com contratos antigos.\n\n# Conflito\nUm pacto firmado por ancestrais transforma cada colheita em dívida.\n\n# Desfechos\nOs heróis podem quebrar o pacto, renegociá-lo ou transferir seu custo para as terras abandonadas.\n\n# Segredo do mestre\nO celeiro principal guarda o nome verdadeiro da entidade credora.'
});

const npcOne = generated({
  title: 'Maela Voss',
  summary: 'Cartógrafa que desenha rotas que ainda não existem e vende mapas para lugares que só surgem durante tempestades.',
  tags: ['cartógrafa', 'tempestade'],
  metadata: { name: 'Maela Voss', role: 'guia ambígua', ancestry: 'humana', occupation: 'cartógrafa', motivation: 'encontrar o irmão desaparecido', secret: 'um mapa está tatuado sob suas luvas', voiceDirection: 'fala baixa, precisa e sem pressa' },
  content: '# Identidade\nMaela Voss viaja com tubos de mapas vazios e uma bússola sem agulha.\n\n# Personalidade\nObservadora, pragmática e incapaz de ignorar uma rota impossível.\n\n# Objetivo\nLocalizar o irmão que atravessou uma estrada formada por relâmpagos.\n\n# Segredo do mestre\nO mapa decisivo está gravado na pele de suas mãos.\n\n# Ganchos\nEla precisa de proteção, reconhece um símbolo dos personagens e conhece uma passagem temporária.'
});

test('gera e arquiva conteúdo original com sequência persistente', async () => {
  const calls = [];
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact(payload) { calls.push(payload); return adventureOne; } },
    logger: {}
  });
  const result = await service.generate('world-1', { type: 'ADVENTURE', brief: 'Mistério costeiro envolvendo memórias roubadas.' });
  assert.equal(result.artifact.status, 'ARCHIVED');
  assert.equal(result.artifact.type, 'ADVENTURE');
  assert.equal(result.artifact.source.generationNumber, 1);
  assert.equal(result.attempts, 1);
  assert.equal(calls[0].history.length, 0);
  const snapshot = await service.list('world-1');
  assert.equal(snapshot.counts.byType.ADVENTURE, 1);
  assert.equal(snapshot.counts.byStatus.ARCHIVED, 1);
});

test('rejeita repetição e salva somente a alternativa realmente diferente', async () => {
  const responses = [adventureOne, adventureOne, adventureTwo];
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact() { return responses.shift(); } },
    logger: {},
    maxAttempts: 3
  });
  await service.generate('world-1', { type: 'ADVENTURE', brief: 'Primeira aventura costeira.' });
  const result = await service.generate('world-1', { type: 'ADVENTURE', brief: 'Outra aventura original.' });
  assert.equal(result.artifact.title, 'A Colheita das Sombras');
  assert.equal(result.attempts, 2);
  assert.equal(result.duplicateRejected, true);
  assert.equal((await service.list('world-1')).count, 2);
});

test('bloqueia geração quando todas as tentativas repetem o arquivo', async () => {
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact() { return adventureOne; } },
    logger: {},
    maxAttempts: 2
  });
  await service.generate('world-1', { type: 'ADVENTURE', brief: 'Primeira aventura costeira.' });
  await assert.rejects(
    service.generate('world-1', { type: 'ADVENTURE', brief: 'Repita exatamente a aventura anterior.' }),
    (error) => error.code === 'GENERATOR_REPETITION_BLOCKED' && error.statusCode === 409
  );
  assert.equal((await service.list('world-1')).count, 1);
});

test('ativação de aventura envia Markdown à Biblioteca como REFERENCE_ONLY', async () => {
  let imported = null;
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact() { return adventureOne; } },
    adventureLibrary: {
      async importDocument(campaignId, input) {
        imported = { campaignId, ...input };
        return { duplicate: false, document: { id: 'doc-generated' } };
      }
    },
    logger: {}
  });
  const generation = await service.generate('world-1', { type: 'ADVENTURE', brief: 'Aventura costeira com sino submerso.' });
  const activated = await service.activate('world-1', generation.artifact.id);
  assert.equal(activated.artifact.status, 'ACTIVE');
  assert.equal(imported.mode, 'REFERENCE_ONLY');
  assert.equal(imported.mimeType, 'text/markdown');
  assert.match(Buffer.from(imported.contentBase64, 'base64').toString('utf8'), /Sino/);
  assert.equal(activated.artifact.integration.documentId, 'doc-generated');
});

test('ativação de NPC grava memória secreta sem torná-lo fato público', async () => {
  let memoryWrite = null;
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact() { return npcOne; } },
    campaignMemory: {
      async upsert(campaignId, collection, record) {
        memoryWrite = { campaignId, collection, record };
        return { record: { id: record.id } };
      }
    },
    logger: {}
  });
  const generation = await service.generate('world-1', { type: 'NPC', brief: 'Cartógrafa de rotas impossíveis.' });
  const activated = await service.activate('world-1', generation.artifact.id);
  assert.equal(memoryWrite.collection, 'npcs');
  assert.equal(memoryWrite.record.visibility, 'secret');
  assert.equal(memoryWrite.record.status, 'GENERATED');
  assert.equal(memoryWrite.record.name, 'Maela Voss');
  assert.equal(activated.artifact.integration.kind, 'CAMPAIGN_MEMORY_NPC');
});

test('arquivo de gerações sobrevive à reinicialização', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-generator-'));
  const filePath = join(directory, 'generated-content.json');
  try {
    const first = new FileGeneratorService({ filePath, narrator: { async generateArtifact() { return adventureOne; } }, logger: {} });
    await first.generate('world-persist', { type: 'ADVENTURE', brief: 'Aventura costeira persistente.' });
    const second = new FileGeneratorService({ filePath, narrator: {}, logger: {} });
    const restored = await second.list('world-persist');
    assert.equal(restored.count, 1);
    assert.equal(restored.artifacts[0].title, 'O Sino Sob a Maré');
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(raw.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test('serializa gerações simultâneas para impedir duplicação por corrida', async () => {
  const service = new InMemoryGeneratorService({
    narrator: { async generateArtifact() { await new Promise((resolve) => setTimeout(resolve, 5)); return adventureOne; } },
    logger: {},
    maxAttempts: 1
  });
  const results = await Promise.allSettled([
    service.generate('world-race', { type: 'ADVENTURE', brief: 'Aventura simultânea número um.' }),
    service.generate('world-race', { type: 'ADVENTURE', brief: 'Aventura simultânea número dois.' })
  ]);
  assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 1);
  assert.equal(results.filter((entry) => entry.status === 'rejected' && entry.reason?.code === 'GENERATOR_REPETITION_BLOCKED').length, 1);
  assert.equal((await service.list('world-race')).count, 1);
});

test('parser aceita JSON cercado por bloco de código e calcula similaridade', () => {
  const parsed = generatorInternals.parseGeneratedPayload(`\`\`\`json\n${adventureOne}\n\`\`\``);
  assert.equal(parsed.title, 'O Sino Sob a Maré');
  assert.equal(generatorInternals.jaccardSimilarity('porta cobre anjo', 'anjo de cobre diante da porta'), 0.75);
});

test('prompt do gerador exige JSON original e inclui histórico anti-repetição', () => {
  const prompt = aiProviderInternals.generatorPrompt({
    type: 'NPC',
    brief: 'Crie uma capitã mercante.',
    options: { system: 'D&D 5e', tone: 'sombrio' },
    history: [{ title: 'Maela Voss', summary: 'Cartógrafa de tempestades.', tags: ['mapa'], signature: 'abcd' }]
  });
  assert.match(prompt, /SOMENTE com um objeto JSON válido/);
  assert.match(prompt, /Maela Voss/);
  assert.match(prompt, /Não copie aventuras publicadas/);
  assert.match(prompt, /voiceDirection/);
});

test('provedor resiliente aplica fallback também aos geradores', async () => {
  const primary = { model: 'a', async generateArtifact() { throw Object.assign(new Error('falha'), { statusCode: 503 }); } };
  const fallback = { model: 'b', async generateArtifact() { return adventureTwo; } };
  const provider = new ResilientNarrativeProvider({
    providers: [{ id: 'primary', provider: primary }, { id: 'fallback', provider: fallback }],
    logger: {},
    failureThreshold: 1
  });
  const response = await provider.generateArtifact({ type: 'ADVENTURE', brief: 'teste' });
  assert.equal(response, adventureTwo);
  assert.equal(provider.getStatus().activeProvider, 'fallback');
});

test('PromptNarrativeProvider gera artefato por transporte textual', async () => {
  let request = null;
  const provider = new PromptNarrativeProvider({
    requestText: async (payload) => { request = payload; return adventureOne; },
    providerId: 'fake'
  });
  const result = await provider.generateArtifact({ type: 'ADVENTURE', brief: 'Sino na costa.', options: { length: 'SHORT' } });
  assert.equal(result, adventureOne);
  assert.equal(request.maxTokens, 1200);
  assert.match(request.prompt, /PEDIDO DO MESTRE: Sino na costa/);
});
