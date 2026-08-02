import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionDirector } from '../packages/session-director/src/index.js';

function createDirector() {
  const counters = { room: 0, action: 0, published: 0 };
  const captured = { roomContext: null };
  const director = new SessionDirector({
    foundryAdapter: {
      async sync() {
        return { scene: { id: 'scene-1', name: 'Fortaleza' }, campaign: {}, visibleActors: [] };
      }
    },
    contextBuilder: {
      build(raw = {}) {
        return {
          ...raw,
          scene: raw.scene ?? raw.activeScene ?? { id: 'scene-1', name: 'Fortaleza' },
          campaign: raw.campaign ?? {},
          visibleActors: raw.visibleActors ?? []
        };
      }
    },
    intentInterpreter: { async interpret(input) { return { type: 'GENERAL', target: null, input }; } },
    rulesService: { async resolve() { return { result: { difficulty: 10 } }; } },
    relationshipService: { async resolve() { return { disposition: 0 }; } },
    narrationService: {
      async createOpening() { return 'A sessão começa diante da entrada. O que vocês fazem?'; },
      async describeRoom(context) {
        counters.room += 1;
        captured.roomContext = context;
        await Promise.resolve();
        return 'A nova sala se revela ao grupo.';
      },
      async narrateResolution() {
        counters.action += 1;
        await Promise.resolve();
        return 'A ação produz uma consequência visível.';
      },
      async narrateRound() {
        counters.action += 1;
        await Promise.resolve();
        return 'As ações da rodada produzem uma consequência visível.';
      }
    },
    audioNarrationService: { createDirective(text) { return { mode: 'browser-tts', text }; } },
    foundryPublisher: { async postNarration() { counters.published += 1; } },
    logger: { error() {} }
  });
  return { director, counters, captured };
}

test('Engine gera uma única narração para chamadas simultâneas da mesma sala', async () => {
  const { director, counters } = createDirector();
  await director.start();
  const room = {
    eventId: 'room:session:scene-1:room-5',
    room: { id: 'scene-1:room-5', name: '5. Prisões' },
    source: { canonicalAnchor: true, text: 'Uma sala de pedra contém celas vazias.' }
  };

  const [first, second] = await Promise.all([director.describeRoom(room), director.describeRoom(room)]);

  assert.equal(counters.room, 1);
  assert.equal(counters.published, 2); // abertura + uma sala
  assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
  assert.equal(first.opening, second.opening);
});

test('Engine narra a mesma sala separadamente para tokens diferentes', async () => {
  const { director, counters } = createDirector();
  await director.start();
  const base = {
    room: { id: 'scene-1:room-5', name: '5. Prisões' },
    source: { canonicalAnchor: true, text: 'Uma sala de pedra contém celas vazias.' }
  };

  const first = await director.describeRoom({ ...base, eventId: 'room:session:scene-1:room-5:token:token-1' });
  const second = await director.describeRoom({ ...base, eventId: 'room:session:scene-1:room-5:token:token-2' });

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, false);
  assert.equal(counters.room, 2);
  assert.equal(counters.published, 3); // abertura + uma narração por token
});

test('Engine registra uma mensagem apenas uma vez por eventId', async () => {
  const { director, counters } = createDirector();
  await director.start();
  const action = { eventId: 'chat:message-42', content: 'Examino a porta.', actorId: 'actor-1' };

  const [first, second] = await Promise.all([director.processAction(action), director.processAction(action)]);

  assert.equal(counters.action, 0);
  assert.equal(counters.published, 1); // somente a abertura; a rodada ainda não foi resolvida
  assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
  assert.equal(first.declaration.id, second.declaration.id);
  assert.equal(first.round.actionCount, 1);

  const result = await director.resolveRound({ eventId: 'round:1' });
  assert.equal(result.resolvedRound, 1);
  assert.equal(counters.action, 1);
  assert.equal(counters.published, 2);
});

test('Engine normaliza a percepção individual antes de narrar a sala', async () => {
  const { director, captured } = createDirector();
  await director.start();
  await director.describeRoom({
    eventId: 'room:vision:5',
    room: { id: 'scene-1:room-5', name: '5. Prisões' },
    source: { canonicalAnchor: true, text: 'Uma plataforma de pedra ocupa o centro.' },
    visibleActors: [{ id: 'npc-1', name: 'Vigia', type: 'npc' }],
    perception: {
      mode: 'TOKEN_VISION',
      observer: { tokenId: 'token-1', actorId: 'hero-1', secret: 'ignorado' },
      visionAvailable: true,
      blinded: false,
      sourceKind: 'LIGHT',
      limitedToLineOfSight: false,
      visibleActorCount: 99
    }
  });

  assert.deepEqual(captured.roomContext.perception, {
    mode: 'TOKEN_VISION',
    observer: { tokenId: 'token-1', actorId: 'hero-1' },
    visionAvailable: true,
    blinded: false,
    sourceKind: 'LIGHT',
    limitedToLineOfSight: true,
    visibleActorCount: 1
  });
  assert.deepEqual(captured.roomContext.visibleActors.map((actor) => actor.name), ['Vigia']);
});

test('Engine descarta atores de sala quando a fonte de visão não foi comprovada', async () => {
  const { director, captured } = createDirector();
  await director.start();
  await director.describeRoom({
    eventId: 'room:no-vision:6',
    room: { id: 'scene-1:room-6', name: '6. Corredor' },
    source: { canonicalAnchor: true, text: 'Um corredor segue até uma porta fechada.' },
    visibleActors: [{ id: 'hidden-1', name: 'Ator oculto', type: 'npc' }],
    perception: { visionAvailable: false, sourceKind: 'NONE' }
  });

  assert.deepEqual(captured.roomContext.visibleActors, []);
  assert.equal(captured.roomContext.perception.mode, 'CANONICAL_ONLY');
  assert.equal(captured.roomContext.perception.visibleActorCount, 0);
});

test('Engine preserva a lista de personagens proibidos na entrada de sala', async () => {
  const { director, captured } = createDirector();
  await director.start();
  await director.describeRoom({
    eventId: 'room:excluded-actors:7',
    room: { id: 'scene-1:room-7', name: '7. Oficina' },
    source: { canonicalAnchor: true, text: 'Uma bancada de pedra ocupa a parede norte.' },
    narrationExclusions: { actorNames: ['Hursar', 'mistra'] }
  });

  assert.deepEqual(captured.roomContext.narrationExclusions.actorNames, ['Hursar', 'mistra']);
});

test('eventIds de personagens diferentes compõem a mesma rodada', async () => {
  const { director, counters } = createDirector();
  await director.start();
  await director.processAction({ eventId: 'chat:1', actorId: 'actor-1', content: 'Examino a porta.' });
  await director.processAction({ eventId: 'chat:2', actorId: 'actor-2', content: 'Observo o corredor.' });

  assert.equal(director.getStatus().round.actionCount, 2);
  assert.equal(counters.action, 0);
  assert.equal(counters.published, 1);

  const [first, second] = await Promise.all([
    director.resolveRound({ eventId: 'round:shared' }),
    director.resolveRound({ eventId: 'round:shared' })
  ]);
  assert.deepEqual([first.duplicate, second.duplicate].sort(), [false, true]);
  assert.equal(first.declarations.length, 2);
  assert.equal(counters.action, 1);
  assert.equal(counters.published, 2);
});
