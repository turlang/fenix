import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const snapshot = {
  activeScene: { id: 'scene-1', name: 'Entrada da Caverna', description: 'Um riacho sai da caverna.' },
  visibleActors: [{ id: 'actor-1', name: 'Hurszar', type: 'character' }],
  sceneJournal: {
    id: 'journal-1',
    name: 'Entrada da Caverna',
    explicitLink: true,
    selectedPage: {
      name: 'Entrada da Caverna',
      content: 'Arbustos densos escondem parte da passagem.',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
    }
  }
};

test('inicia sessão com read-aloud normalizado e abertura retornada', async () => {
  const narrator = { async createOpening(context) {
    assert.equal(context.scene.name, 'Entrada da Caverna');
    assert.equal(context.source.name, 'Entrada da Caverna');
    assert.equal(context.source.extractionMode, 'DIRECT_JOURNAL_READ_ALOUD');
    return `A trilha termina diante de uma colina coberta por vegetação fechada. Entre os arbustos, uma abertura escura rompe a pedra e revela a entrada da caverna. O som contínuo da água acompanha a aproximação do grupo pelo terreno irregular.

Um riacho raso sai da passagem e corta o caminho diante de Hurszar. À direita da correnteza, uma faixa estreita de solo firme segue junto à parede rochosa até desaparecer no interior. A entrada permanece aberta, oferecendo mais de uma forma de aproximação.`;
  }};
  const runtime = createSessionRuntime({ narrator });
  const result = await runtime.start({ snapshot });
  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.match(result.opening, /O que vocês fazem\?/);
});
