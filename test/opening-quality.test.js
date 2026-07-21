import test from 'node:test';
import assert from 'node:assert/strict';
import { createNarrationQualityGuard } from '../packages/narration-quality-guard/src/index.js';
import { NarrationService } from '../packages/narration-service/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';

const openingContext = {
  scene: { id: 'scene-1', name: 'Cragmaw Hideout (Player Version)', description: '' },
  source: {
    type: 'SCENE_CONFIGURED_PAGE',
    name: 'Cragmaw Hideout',
    text: "Following the goblins' trail, you come across a large cave in a hillside. A shallow stream flows out of the cave mouth, screened by dense briar thickets. A narrow dry path leads into the cave on the right-hand side of the stream.",
    canonicalAnchor: true,
    areaName: '1. Cave Mouth'
  },
  visibleActors: [{ id: 'a1', name: 'Mistra' }, { id: 'a2', name: 'Wolf' }]
};

const serviceContext = {
  scene: openingContext.scene,
  campaign: { worldId: 'world-1' },
  visibleActors: openingContext.visibleActors,
  sceneJournal: {
    name: 'Cragmaw Hideout',
    explicitLink: true,
    selectedPage: {
      name: 'Cragmaw Hideout',
      content: openingContext.source.text,
      sectionMatchedScene: true,
      areaName: '1. Cave Mouth',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
    }
  }
};

const goodNarration = `A trilha dos goblins termina diante de uma colina tomada por vegetação cerrada. Entre os espinheiros, a pedra se abre em uma passagem larga e escura, parcialmente escondida pelos galhos. O murmúrio constante da água marca o limite entre o terreno aberto e o interior da caverna.

Um riacho raso corre para fora da entrada e atravessa o caminho do grupo. À direita da correnteza, uma faixa estreita de solo seco acompanha a parede rochosa até desaparecer na sombra. Mistra e Wolf estão diante desse acesso, com espaço suficiente para escolher como avançar.

O que vocês fazem?`;

test('QualityGuard aceita abertura curta, canônica e sem controlar personagens', () => {
  const guard = createNarrationQualityGuard();
  const result = guard.evaluate(goodNarration, openingContext);
  assert.equal(result.accepted, true, JSON.stringify(result, null, 2));
  assert.equal(result.metrics.paragraphCount, 2);
  assert.ok(result.metrics.wordCount >= 80 && result.metrics.wordCount <= 150);
});

test('QualityGuard rejeita texto longo, especulativo e que controla personagens', () => {
  const guard = createNarrationQualityGuard();
  const bad = `À medida que a trilha desaparece, uma vasta abertura se revela. O aroma intenso de musgo invade o ar, como se a própria natureza protegesse segredos antigos. A chuva recente deixou cada pedra brilhando e o vento move os espinheiros ao redor da caverna.

Mistra sente que algo importante está prestes a acontecer, enquanto Wolf mantém os olhos fixos na entrada e espera encontrar alguém. A sensação de que uma ameaça invisível observa o grupo cresce a cada passo.

A entrada parece esconder mistérios em suas sombras, e o caminho volta a ser descrito junto ao riacho. A caverna, a entrada e o riacho dominam novamente a paisagem.

O que vocês fazem?`;
  const result = guard.evaluate(bad, openingContext);
  assert.equal(result.accepted, false);
  assert.equal(result.hardSafe, false);
  assert.ok(result.hardIssues.includes('PLAYER_AGENCY_VIOLATION'));
  assert.ok(result.hardIssues.includes('UNSUPPORTED_SPECULATION'));
  assert.ok(result.hardIssues.includes('UNSUPPORTED_DETAIL'));
});

test('NarrationService pede nova versão quando a primeira falha no QualityGuard', async () => {
  let calls = 0;
  const provider = {
    async createOpening(context) {
      calls += 1;
      if (calls === 1) {
        return 'Mistra sente que a chuva anuncia algo importante, como se a caverna guardasse segredos.';
      }
      assert.ok((context.quality?.rejected ?? []).length >= 1);
      return goodNarration;
    }
  };

  const service = new NarrationService({
    provider,
    narrationMemory: new InMemoryNarrationMemory(),
    maxOpeningAttempts: 3,
    logger: { info() {}, warn() {}, error() {} }
  });

  const result = await service.createOpening(serviceContext);
  assert.equal(calls, 2);
  assert.match(result, /murmúrio constante da água/i);
  assert.match(result, /O que vocês fazem\?$/);
});
