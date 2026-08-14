import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const snapshot = {
  activeScene: { id: 'scene-1', name: 'Cragmaw Hideout', description: 'Um riacho sai da caverna.' },
  visibleActors: [{ id: 'actor-1', name: 'Hurszar', type: 'character' }],
  sceneJournal: {
    id: 'journal-1',
    name: 'Cragmaw Hideout',
    explicitLink: true,
    selectedPage: {
      name: 'Cragmaw Hideout',
      content: 'Uma caverna se abre na encosta. Um riacho raso sai da entrada entre espinheiros.',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
      areaName: '1. Cave Mouth'
    }
  }
};

function createNarrator() {
  return {
    async createOpening() {
      return `A trilha alcança a base de uma colina onde a vegetação cobre parte da pedra. Entre os espinheiros, uma abertura larga e escura marca a entrada da caverna. O curso da água acompanha o terreno e conduz o olhar até a passagem.

Um riacho raso sai do interior e atravessa o caminho diante de Hurszar. À direita da correnteza, uma faixa de solo firme segue rente à parede rochosa antes de desaparecer na sombra. O espaço diante da entrada permite observar o local e escolher por onde avançar.`;
    },
    async createRoomEntry() {
      return 'A câmara se abre além da passagem, com duas colunas baixas marcando as laterais e placas claras alinhadas pelo centro. Uma plataforma elevada ocupa a parede oposta, enquanto duas saídas permanecem visíveis nos flancos. A luz alcança o piso e define com clareza os caminhos disponíveis dentro do recinto.';
    },
    async narrateResolution() {
      return 'A observação revela detalhes na entrada, enquanto o riacho continua correndo.';
    }
  };
}

test('inicia sessão após normalizar o snapshot', async () => {
  const published = [];
  const runtime = createSessionRuntime({ narrator: createNarrator(), publishChat: async (content) => published.push(content) });
  const result = await runtime.start(snapshot);
  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.equal(published.length, 1);
  assert.match(result.opening, /O que vocês fazem\?/);
});

test('processa ação pelo pipeline modular', async () => {
  const runtime = createSessionRuntime({ narrator: createNarrator() });
  await runtime.start(snapshot);
  const result = await runtime.processAction({ actorId: 'actor-1', content: 'Examino a entrada da caverna.' });
  assert.equal(result.intent.type, 'INVESTIGATION');
  assert.equal(result.state, 'COLLECTING_ACTIONS');
});

test('entrada de sala preserva audiência privada até a porta de publicação', async () => {
  const published = [];
  const narrationOutputPort = {
    async publishNarration(content, metadata) {
      published.push({ content, metadata });
      return { published: true };
    }
  };
  const runtime = createSessionRuntime({ narrator: createNarrator(), narrationOutputPort });
  await runtime.start(snapshot);
  await runtime.describeRoom({
    actorId: 'actor-1',
    room: { id: 'room-7', name: 'Câmara Norte' },
    source: {
      canonicalAnchor: true,
      type: 'ROOM_READ_ALOUD',
      text: 'Uma câmara retangular possui duas colunas baixas, placas claras no centro, uma plataforma elevada e duas saídas laterais.'
    }
  });

  const narration = published.at(-1);
  assert.equal(narration.metadata.type, 'ROOM_ENTRY');
  assert.equal(narration.metadata.roomId, 'room-7');
  assert.equal(narration.metadata.actorId, 'actor-1');
  assert.equal(narration.metadata.audienceActorId, 'actor-1');
});
