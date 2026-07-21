import test from 'node:test';
import assert from 'node:assert/strict';
import { OpeningNarrativePlanner } from '../packages/opening-narrative-planner/src/index.js';
import { NoveltyGuard } from '../packages/novelty-guard/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';
import { NarrationService } from '../packages/narration-service/src/index.js';


const repeatedOpening = `O som do riacho acompanha a subida até a base da colina. Entre os espinheiros, uma abertura larga e escura surge na pedra, parcialmente escondida pela vegetação. A água corre para fora da caverna e atravessa o terreno diante do grupo.

À direita da correnteza, uma faixa estreita de solo seco segue junto à parede rochosa e desaparece no interior. A trilha dos goblins termina diante dessa passagem, deixando o espaço aberto para observar a entrada e escolher a forma de aproximação.

O que vocês fazem?`;

const differentOpening = `A vegetação se fecha ao redor da trilha antes que a encosta revele sua abertura. Primeiro surge o curso raso de água, cortando o terreno; depois, a pedra escura da caverna aparece entre os galhos espinhosos.

Uma margem firme acompanha o lado direito do riacho e conduz para dentro da colina. O caminho percorrido chega ao fim diante desse acesso, onde o grupo pode avaliar com calma a passagem, a correnteza e a cobertura oferecida pelos arbustos antes de seguir.

O que vocês fazem?`;

const context = {
  scene: { id: 'scene-1', name: 'Cragmaw Hideout (Player Version)', description: '' },
  campaign: { worldId: 'world-1' },
  visibleActors: [],
  sceneJournal: {
    name: 'Cragmaw Hideout',
    explicitLink: true,
    selectedPage: {
      name: 'Cragmaw Hideout',
      content: 'Uma grande caverna se abre na encosta. Um riacho raso sai da entrada entre espinheiros. Uma passagem seca segue à direita.',
      sectionMatchedScene: true,
      areaName: '1. Cave Mouth',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
    }
  }
};

test('planner muda o plano narrativo quando a cena já possui histórico', () => {
  const planner = new OpeningNarrativePlanner();
  const openingContext = {
    scene: { name: 'Cragmaw Hideout (Player Version)' },
    source: { areaName: '1. Cave Mouth' }
  };
  const first = planner.createPlan({ context: openingContext, history: [] });
  const second = planner.createPlan({ context: openingContext, history: [{ plan: first }] });
  assert.notEqual(first.signature, second.signature);
  assert.equal(first.sceneKey, second.sceneKey);
});

test('NoveltyGuard rejeita repetição literal e aceita estrutura claramente diferente', () => {
  const guard = new NoveltyGuard({ threshold: 0.68 });
  const previous = repeatedOpening;
  assert.equal(guard.evaluate(previous, [{ text: previous }]).accepted, false);
  const different = differentOpening;
  assert.equal(guard.evaluate(different, [{ text: previous }]).accepted, true);
});

test('NarrationService regenera quando a primeira abertura repete o histórico', async () => {
  const memory = new InMemoryNarrationMemory();
  const planner = new OpeningNarrativePlanner();
  const sceneKey = planner.buildSceneKey({
    scene: { name: 'Cragmaw Hideout (Player Version)' },
    source: { areaName: '1. Cave Mouth' }
  });
  const repeated = repeatedOpening;
  await memory.append({ id: 'old-1', sceneKey, text: repeated, plan: { signature: 'old-plan' } });

  let calls = 0;
  const provider = {
    async createOpening(received) {
      calls += 1;
      assert.ok(received.narrativePlan?.signature);
      assert.equal(received.novelty.priorCount, 1);
      if (calls === 1) return repeated;
      return differentOpening;
    }
  };

  const service = new NarrationService({ provider, narrationMemory: memory, openingPlanner: planner, logger: {} });
  const opening = await service.createOpening(context);
  assert.equal(calls, 2);
  assert.match(opening, /vegetação se fecha/i);
  const records = await memory.list(sceneKey);
  assert.equal(records.length, 2);
});

test('NoveltyGuard ignora o encerramento fixo e reduz o peso de substantivos canônicos', () => {
  const guard = new NoveltyGuard({ threshold: 0.82 });
  const previous = 'O som da água conduz o olhar até a entrada da caverna. Espinheiros cercam a passagem seca.\n\nO que vocês fazem?';
  const differentStyle = 'A subida termina num silêncio úmido. Primeiro surge a pedra escura; depois, o curso raso recortando o terreno e a faixa firme que desaparece no interior.\n\nO que vocês fazem?';
  const result = guard.evaluate(differentStyle, [{ id: 'old', text: previous }]);
  assert.equal(result.accepted, true);
  assert.equal(result.mode, 'STYLE_ONLY_V2');
});

test('NarrationService não bloqueia a sessão quando todas as tentativas excedem o limite', async () => {
  const memory = new InMemoryNarrationMemory();
  const planner = new OpeningNarrativePlanner();
  const sceneKey = planner.buildSceneKey({
    scene: { name: 'Cragmaw Hideout (Player Version)' },
    source: { areaName: '1. Cave Mouth' }
  });
  const repeated = repeatedOpening;
  await memory.append({ id: 'old-1', sceneKey, text: repeated, plan: { signature: 'old-plan' } });

  const received = [];
  const provider = {
    async createOpening(payload) {
      received.push(payload);
      return repeated;
    }
  };
  const warnings = [];
  const service = new NarrationService({
    provider,
    narrationMemory: memory,
    openingPlanner: planner,
    maxOpeningAttempts: 3,
    logger: { info() {}, error() {}, warn(message, data) { warnings.push({ message, data }); } }
  });

  const opening = await service.createOpening(context);
  assert.equal(opening, repeated);
  assert.equal(received.length, 3);
  assert.equal(received[2].novelty.forceContrast, true);
  assert.ok(received[1].novelty.avoidOpenings.some((entry) => entry.source === 'current-run'));
  assert.equal(warnings.length, 1);

  const records = await memory.list(sceneKey);
  assert.equal(records.length, 2);
  assert.equal(records[1].noveltyStatus, 'best-effort');
  assert.equal(records[1].noveltyMode, 'STYLE_ONLY_V2');
});
