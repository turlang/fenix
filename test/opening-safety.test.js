import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationService, evaluateOpeningSafety } from '../packages/narration-service/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';

const context = {
  scene: { id: 'scene-1', name: 'Cragmaw Hideout (Player Version)', description: '' },
  campaign: { worldId: 'world-1' },
  visibleActors: [],
  sceneJournal: {
    name: 'Cragmaw Hideout',
    explicitLink: true,
    selectedPage: {
      name: 'Cragmaw Hideout',
      content: "Following the goblins' trail, you come across a large cave in a hillside. A shallow stream flows out of the cave mouth, screened by dense briar thickets.",
      sectionMatchedScene: true,
      areaName: '1. Cave Mouth',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
    }
  }
};

test('SafetyGuard detecta cópia longa do texto-fonte', () => {
  const source = context.sceneJournal.selectedPage.content;
  const result = evaluateOpeningSafety(source, source);
  assert.equal(result.safe, false);
  assert.ok(result.issues.includes('SOURCE_TEXT_COPIED'));
});

test('SafetyGuard detecta conteúdo reservado ao mestre', () => {
  const result = evaluateOpeningSafety('The Cragmaw tribe has orders from Klarg. DM\'s eyes only.', 'A cave entrance.');
  assert.equal(result.safe, false);
  assert.ok(result.issues.some((issue) => issue.startsWith('FORBIDDEN_PATTERN')));
});

test('NarrationService recusa iniciar sem Groq configurada', async () => {
  const service = new NarrationService({ provider: null, narrationMemory: new InMemoryNarrationMemory(), logger: {} });
  await assert.rejects(
    service.createOpening(context),
    (error) => error.code === 'AI_NOT_CONFIGURED' && error.statusCode === 503
  );
});

test('NarrationService não publica quando todas as respostas vazam a fonte', async () => {
  const provider = { async createOpening() { return context.sceneJournal.selectedPage.content; } };
  const service = new NarrationService({
    provider,
    narrationMemory: new InMemoryNarrationMemory(),
    maxOpeningAttempts: 2,
    logger: { info() {}, warn() {}, error() {} }
  });
  await assert.rejects(
    service.createOpening(context),
    (error) => error.code === 'NARRATION_SAFETY_FAILED' && error.statusCode === 502
  );
});

test('NarrationService aceita interpretação segura em português', async () => {
  const provider = {
    async createOpening() {
      return `A trilha dos goblins termina diante de uma colina coberta por vegetação cerrada. Entre os galhos espinhosos, uma abertura larga e escura surge na pedra. O murmúrio constante da água acompanha os últimos passos até a entrada da caverna.

Um riacho raso corre para fora da passagem e atravessa o terreno. À direita da correnteza, uma faixa estreita de solo seco acompanha a parede rochosa e desaparece no interior. A entrada está diante do grupo, com a vegetação ocultando parte de sua extensão e deixando livre o caminho junto à água.`;
    }
  };
  const service = new NarrationService({
    provider,
    narrationMemory: new InMemoryNarrationMemory(),
    logger: { info() {}, warn() {}, error() {} }
  });
  const result = await service.createOpening(context);
  assert.match(result, /murmúrio constante da água/i);
  assert.match(result, /O que vocês fazem\?/);
});
