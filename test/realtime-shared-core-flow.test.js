import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';
import { StandaloneVttAdapter } from '../packages/standalone-vtt-adapter/src/index.js';
import {
  createDevelopmentPeerAuthorizer,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../packages/realtime-session-gateway/src/index.js';

const snapshot = {
  activeScene: { id: 'scene-1', name: 'Salão das Colunas' },
  campaign: { worldId: 'fenix-realtime-test', title: 'Ecos do Salão Antigo' },
  visibleActors: [{ id: 'hero-ayla', name: 'Ayla', type: 'character' }],
  sceneJournal: {
    id: 'journal-1',
    name: 'Salão das Colunas',
    explicitLink: true,
    selectedPage: {
      name: 'Salão das Colunas',
      areaName: '02. Salão das Colunas',
      extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
      content: 'Um salão amplo se estende entre colunas de pedra que sustentam o teto alto. A luz das tochas alcança o piso irregular, enquanto uma porta de madeira ocupa a parede norte.'
    }
  },
  system: { id: 'agnostic-test', version: '1' }
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

test('dois peers recebem ROOM_ENTRY produzido pelo mesmo Shared Core', async () => {
  const hub = new RealtimeSessionHub({ logger: {} });
  const adapter = new StandaloneVttAdapter({ initialSnapshot: snapshot, logger: {} });
  const runtime = createSessionRuntime({
    vttContextPort: adapter,
    narrationOutputPort: hub,
    narrator,
    logger: {}
  });

  const started = await runtime.start();
  const gateway = new RealtimeSessionGateway({
    hub,
    sessionService: runtime,
    authorizePeer: createDevelopmentPeerAuthorizer(),
    logger: {}
  });

  const gmMessages = [];
  const playerMessages = [];
  gateway.openPeer({
    sessionId: started.sessionId,
    clientId: 'gm-1',
    role: 'gm',
    displayName: 'Mestre',
    send: (event) => gmMessages.push(event)
  });
  const player = gateway.openPeer({
    sessionId: started.sessionId,
    clientId: 'player-1',
    role: 'player',
    actorId: 'hero-ayla',
    displayName: 'Ayla',
    send: (event) => playerMessages.push(event)
  });

  await player.receive(JSON.stringify({
    type: 'TOKEN_MOVE',
    commandId: 'enter-room-03',
    payload: {
      token: { id: 'hero-ayla', name: 'Ayla', x: 1220, y: 240, size: 72 },
      roomId: '03',
      roomEntry: {
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
      }
    }
  }));

  for (const inbox of [gmMessages, playerMessages]) {
    const narrations = inbox.filter((event) => event.type === 'NARRATION');
    const roomNarration = narrations.at(-1);
    assert.equal(roomNarration.payload.metadata.type, 'ROOM_ENTRY');
    assert.equal(roomNarration.payload.metadata.roomId, '03');
    assert.match(roomNarration.payload.content, /câmara/i);
  }

  const snapshotAfterMove = hub.getSnapshot(started.sessionId);
  assert.equal(snapshotAfterMove.tokens[0].id, 'hero-ayla');
  assert.equal(snapshotAfterMove.tokens[0].x, 1220);
});
