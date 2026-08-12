import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';
import { NarrationOutput } from '../packages/narration-output/src/index.js';
import { StandaloneVttAdapter } from '../packages/standalone-vtt-adapter/src/index.js';

const snapshot = {
  activeScene: { id: 'fenix-demo-hall', name: 'Salão das Colunas' },
  campaign: { worldId: 'fenix-demo', title: 'Ecos do Salão Antigo' },
  visibleActors: [{ id: 'hero-ayla', name: 'Ayla', type: 'character' }],
  sceneJournal: {
    id: 'journal-demo',
    name: 'Salão das Colunas',
    explicitLink: true,
    selectedPage: {
      name: 'Salão das Colunas',
      areaName: '02. Salão das Colunas',
      extractionMode: 'STANDALONE_SCENE_READ_ALOUD',
      content: 'Um salão amplo se estende entre colunas de pedra que sustentam o teto alto. A luz das tochas alcança o piso irregular, enquanto uma porta de madeira ocupa a parede norte.'
    }
  }
};

const narrator = {
  async createOpening() {
    return 'O salão se abre em torno das colunas de pedra que sobem até o teto alto, dividindo o espaço em corredores visuais estreitos. A luz das tochas alcança o piso e desenha limites claros entre cada pilar, enquanto a parede norte permanece sempre visível além da fileira central.\n\nAli, uma porta de madeira interrompe a superfície de pedra e oferece a única passagem evidente para fora do ambiente. Ayla está presente diante dessa disposição simples: colunas, luz, chão e a porta ao norte, todos acessíveis à observação imediata.';
  },
  async createRoomEntry() {
    return 'Além da passagem, a câmara assume proporções estreitas e permanece cercada por pedra. Duas colunas baixas dividem visualmente o ambiente sem esconder sua forma principal. Na parede oriental, uma abertura escura interrompe a superfície de alvenaria e permanece como o próximo limite claramente perceptível do espaço.';
  },
  async narrateResolution() {
    return 'A ação permanece limitada ao que o ambiente permite observar.';
  }
};

test('movimento standalone pode produzir ROOM_ENTERED e narração pelo mesmo Shared Core', async () => {
  const published = [];
  const adapter = new StandaloneVttAdapter({ initialSnapshot: snapshot, logger: {} });
  const runtime = createSessionRuntime({
    vttContextPort: adapter,
    narrationOutputPort: new NarrationOutput({
      publish: async (content, metadata) => published.push({ content, metadata }),
      logger: {}
    }),
    narrator,
    logger: {}
  });

  await runtime.start();
  const event = adapter.createRoomEntered({
    room: { id: '03', name: 'Câmara Norte' },
    source: {
      canonicalAnchor: true,
      text: 'A passagem ao norte termina em uma câmara estreita de pedra. Duas colunas baixas dividem o espaço, e uma abertura escura ocupa a parede oriental.',
      type: 'ROOM_READ_ALOUD',
      extractionMode: 'STANDALONE_ZONE_READ_ALOUD'
    },
    scene: snapshot.activeScene,
    campaign: snapshot.campaign,
    visibleActors: snapshot.visibleActors
  });

  const result = await runtime.describeRoom(event);

  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.equal(result.room.id, '03');
  assert.doesNotMatch(result.opening, /O que vocês fazem\?/i);
  assert.equal(published.length, 2);
  assert.equal(published[1].metadata.type, 'ROOM_ENTRY');
  assert.equal(published[1].metadata.roomId, '03');
});
