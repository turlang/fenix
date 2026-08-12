import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';
import { NarrationOutput } from '../packages/narration-output/src/index.js';
import { StandaloneVttAdapter } from '../packages/standalone-vtt-adapter/src/index.js';

const standaloneSnapshot = {
  activeScene: { id: 'standalone-1', name: 'Salão das Colunas' },
  visibleActors: [{ id: 'hero-1', name: 'Ayla', type: 'character' }],
  sceneJournal: {
    id: 'journal-standalone',
    name: 'Salão das Colunas',
    explicitLink: true,
    selectedPage: {
      name: 'Salão das Colunas',
      areaName: '1. Salão',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
      content: 'Colunas de pedra sustentam o teto alto. Uma porta de madeira ocupa a parede norte e tochas iluminam o piso.'
    }
  },
  system: { id: 'agnostic-test', version: '1' }
};

const narrator = {
  async createOpening() {
    return 'O salão se abre em torno das colunas de pedra que sobem até o teto alto, dividindo o espaço em corredores visuais estreitos. A luz das tochas alcança o piso e desenha limites claros entre cada pilar, enquanto a parede norte permanece sempre visível além da fileira central.\n\nAli, uma porta de madeira interrompe a superfície de pedra e oferece a única passagem evidente para fora do ambiente. Ayla está presente diante dessa disposição simples: colunas, luz, chão e a porta ao norte, todos acessíveis à observação imediata.';
  },
  async narrateResolution() {
    return 'A observação mantém a porta norte e as colunas como referências imediatas, sem revelar nada além do que o salão permite perceber.';
  }
};

test('StandaloneVttAdapter sincroniza snapshot com origem standalone', async () => {
  const adapter = new StandaloneVttAdapter({ initialSnapshot: standaloneSnapshot, logger: {} });
  const snapshot = await adapter.sync();
  assert.equal(snapshot.activeScene.id, 'standalone-1');
  assert.equal(snapshot.metadata.source, 'fenix-standalone');
  assert.equal(snapshot.visibleActors[0].name, 'Ayla');
});

test('StandaloneVttAdapter cria eventos universais sem API Foundry', () => {
  const adapter = new StandaloneVttAdapter({ logger: {} });
  const action = adapter.createPlayerAction({ actorId: 'hero-1', content: 'Examino a porta.' });
  const room = adapter.createRoomEntered({
    room: { id: 'room-2', name: 'Câmara Norte' },
    source: { canonicalAnchor: true, text: 'Uma câmara estreita contém duas colunas de pedra.' }
  });
  assert.equal(action.type, 'PLAYER_ACTION');
  assert.equal(room.type, 'ROOM_ENTERED');
});

test('mesmo Shared Core inicia sessão com StandaloneVttAdapter', async () => {
  const delivered = [];
  const adapter = new StandaloneVttAdapter({ initialSnapshot: standaloneSnapshot, logger: {} });
  const runtime = createSessionRuntime({
    vttContextPort: adapter,
    narrationOutputPort: new NarrationOutput({ deliver: async (message) => delivered.push(message), logger: {} }),
    narrator,
    logger: {}
  });

  const result = await runtime.start();
  assert.equal(result.state, 'COLLECTING_ACTIONS');
  assert.equal(delivered.length, 1);
  assert.match(result.opening, /O que vocês fazem\?$/);
});
