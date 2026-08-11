import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePlayerActionEvent,
  normalizeRoomEnteredEvent
} from '../packages/vtt-contracts/src/index.js';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const snapshot = {
  activeScene: { id: 'standalone-scene', name: 'Galeria de Pedra', description: 'Uma passagem central corta o recinto.' },
  campaign: { worldId: 'standalone-world' },
  visibleActors: [],
  sceneJournal: {
    id: 'journal-1',
    name: 'Galeria de Pedra',
    explicitLink: true,
    selectedPage: {
      name: 'Galeria de Pedra',
      content: 'Uma galeria de pedra possui uma passagem central iluminada e duas colunas laterais.',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
      areaName: '1. Galeria'
    }
  }
};

const opening = [
  'A galeria de pedra se estende em linhas regulares, com duas colunas laterais delimitando a passagem central. A iluminação disponível alcança o piso e torna visíveis os limites do recinto, sem ocultar o caminho que continua adiante.',
  'O espaço permanece aberto à observação, e a rota principal atravessa o centro entre as estruturas de pedra. Nada além do que está diante do grupo precisa ser presumido para compreender a disposição imediata do local.'
].join('\n\n');

test('eventos universais normalizam ação e entrada de sala', () => {
  const action = normalizePlayerActionEvent({ content: 'Examino a porta', actorId: 'actor-1' });
  assert.equal(action.type, 'PLAYER_ACTION');
  assert.equal(action.actorId, 'actor-1');

  const room = normalizeRoomEnteredEvent({
    room: { id: 'room-7', name: 'Sala 7' },
    source: { canonicalAnchor: true, text: 'Uma sala retangular possui duas saídas.' }
  });
  assert.equal(room.type, 'ROOM_ENTERED');
  assert.equal(room.room.id, 'room-7');
});

test('Shared Core inicia sessão usando adapter que não conhece Foundry', async () => {
  const published = [];
  const vttContextPort = { async sync() { return snapshot; } };
  const narrationOutputPort = {
    async publishNarration(content, metadata) {
      published.push({ content, metadata });
      return { published: true };
    }
  };
  const narrator = { async createOpening() { return opening; } };
  const runtime = createSessionRuntime({ vttContextPort, narrationOutputPort, narrator });

  const result = await runtime.start();
  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.equal(published.length, 1);
  assert.equal(published[0].metadata.type, 'SESSION_OPENING');
});
