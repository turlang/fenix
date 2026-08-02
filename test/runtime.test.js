import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const snapshot = {
  activeScene: { id: 'scene-1', name: 'Cragmaw Hideout', description: 'Um riacho sai da caverna.' },
  campaign: { worldId: 'world-1', systemId: 'dnd5e' },
  visibleActors: [{ id: 'actor-1', name: 'Hurszar', type: 'character' }],
  narrationExclusions: { actorNames: ['Hurszar'] },
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

Um riacho raso sai do interior e atravessa o caminho diante da caverna. À direita da correnteza, uma faixa de solo firme segue rente à parede rochosa antes de desaparecer na sombra. O espaço diante da entrada deixa nítidas as duas formas de aproximação.`;
    },
    async narrateResolution() {
      return 'A observação revela detalhes na entrada, enquanto o riacho continua correndo.';
    },
    async narrateRound() {
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

test('coleta e resolve ações pelo pipeline modular', async () => {
  const runtime = createSessionRuntime({ narrator: createNarrator() });
  await runtime.start(snapshot);
  const queued = await runtime.processAction({ actorId: 'actor-1', actorName: 'Hurszar', content: 'Examino a entrada da caverna.', eventId: 'chat:1' });
  assert.equal(queued.queued, true);
  assert.equal(queued.round.actionCount, 1);

  const result = await runtime.resolveRound({ eventId: 'round:1' });
  assert.equal(result.resolutions[0].intent.type, 'INVESTIGATION');
  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.equal(result.resolvedRound, 1);
  assert.equal(result.round.number, 2);
});
