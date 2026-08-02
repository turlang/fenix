import test from 'node:test';
import assert from 'node:assert/strict';
import { aiProviderInternals } from '../packages/ai-provider/src/index.js';
import {
  NarrationService,
  createRoomNarrativeDirection,
  evaluateRoomNarrationStyle
} from '../packages/narration-service/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';
import { createNarrationQualityGuard } from '../packages/narration-quality-guard/src/index.js';

const safeText = [
  'Baixos pilares quebram as paredes laterais em intervalos regulares. Entre eles, placas de pedra mais claras atravessam o centro até uma plataforma elevada, recortada pela luz que alcança a entrada.',
  'Dois vãos se abrem em lados opostos, além da plataforma. Os nichos entre os pilares estão vazios, e as bordas gastas do piso formam um caminho irregular até onde a claridade termina.'
].join('\n\n');

function roomContext(sceneId = 'scene-1', roomName = 'Sala 7') {
  return {
    scene: { id: sceneId, name: 'Dungeon de teste' },
    campaign: { worldId: 'world-1' },
    room: { id: 'room-7', name: roomName },
    source: {
      canonicalAnchor: true,
      type: 'ROOM_READ_ALOUD',
      text: 'Uma sala retangular possui pilares baixos nas laterais, placas claras no centro, uma plataforma elevada, duas saídas laterais, nichos vazios e bordas gastas. A luz da entrada alcança o piso central.'
    },
    visibleActors: [],
    perception: {
      mode: 'TOKEN_VISION',
      observer: { tokenId: 'token-1', actorId: 'actor-1' },
      visionAvailable: true,
      blinded: false,
      sourceKind: 'LIGHT',
      limitedToLineOfSight: true,
      visibleActorCount: 0
    }
  };
}

test('gera narração curta sem decisão final', async () => {
  const service = new NarrationService({ provider: { createRoomEntry: async () => safeText } });
  const result = await service.describeRoom(roomContext());
  assert.equal(result, safeText);
  assert.doesNotMatch(result, /O que vocês fazem\?/i);
  const quality = service.roomQualityGuard.evaluate(result, roomContext(), { requireDecisionEnding: false });
  assert.equal(quality.hardSafe, true);
});

test('rejeita cópia integral da âncora', async () => {
  const context = roomContext();
  context.source.text = 'Esta sala possui uma mesa longa de pedra clara com seis cadeiras alinhadas diante de uma porta fechada ao norte.';
  const service = new NarrationService({ provider: { createRoomEntry: async () => context.source.text } });
  await assert.rejects(() => service.describeRoom(context), (error) => error.code === 'NARRATION_SAFETY_FAILED');
});

test('QualityGuard aceita descrição de sala curta', () => {
  const guard = createNarrationQualityGuard({ minWords: 20, maxWords: 120, minimumHardWords: 20, minParagraphs: 1, maxParagraphs: 2 });
  const text = 'Paredes regulares cercam uma plataforma baixa no centro. Duas passagens abertas cortam as laterais, além das placas claras que atravessam o piso.';
  const result = guard.evaluate(text, { source: { text }, visibleActors: [] }, { requireDecisionEnding: false });
  assert.equal(result.accepted, true);
  assert.equal(result.hardSafe, true);
});

test('QualityGuard rejeita texto longo', () => {
  const guard = createNarrationQualityGuard({ minWords: 20, maxWords: 120, minimumHardWords: 20, minParagraphs: 1, maxParagraphs: 2 });
  const text = Array.from({ length: 210 }, (_, index) => `termo${index}`).join(' ');
  const result = guard.evaluate(text, { source: { text }, visibleActors: [] }, { requireDecisionEnding: false });
  assert.equal(result.hardSafe, false);
  assert.ok(result.hardIssues.includes('EXCESSIVE_LENGTH'));
});

test('Novelty separa histórico por sala e cena', async () => {
  const memory = new InMemoryNarrationMemory();
  let sequence = 0;
  const provider = { createRoomEntry: async () => `${safeText} ${sequence++ ? 'O segundo recinto mantém outra disposição confirmada.' : ''}`.trim() };
  const service = new NarrationService({ provider, narrationMemory: memory });
  await service.describeRoom(roomContext('scene-1', 'Sala 7'));
  await service.describeRoom(roomContext('scene-2', 'Sala 7'));
  assert.equal(memory.records.length, 2);
  assert.notEqual(memory.records[0].sceneKey, memory.records[1].sceneKey);
});

test('prompt limita a descrição ao recorte visual do token e aos atores filtrados', () => {
  const context = roomContext();
  context.visibleActors = [
    { id: 'pc-1', name: 'Hursar', type: 'character' },
    { id: 'npc-1', name: 'Vigia', type: 'npc' }
  ];
  context.perception.visibleActorCount = 2;
  const prompt = aiProviderInternals.roomEntryPrompt(context);

  assert.match(prompt, /recorte visual que alcança esse personagem agora/i);
  assert.match(prompt, /Atores comprovadamente visíveis pelo token: Vigia/);
  assert.doesNotMatch(prompt, /Hursar/);
  assert.match(prompt, /atrás de paredes, portas, curvas/i);
  assert.match(prompt, /tom de relatório/i);
  assert.match(prompt, /três batidas ligadas: impacto imediato, movimento do olhar/i);
  assert.match(prompt, /Crie emoção e tensão pela escolha dos verbos/i);
  assert.match(prompt, /permaneça no visual: luz, sombra, escala, distância/i);
});

test('direção cinematográfica muda a cadência entre tentativas', () => {
  const first = createRoomNarrativeDirection('room:scene-1:sala-7', 0);
  const second = createRoomNarrativeDirection('room:scene-1:sala-7', 1);
  assert.notEqual(first.signature, second.signature);
  assert.match(first.tone, /tensão|descoberta|inquietação|assombro|urgência/i);
  assert.ok(first.opening && first.movement && first.closing);
});

test('guard de estilo rejeita inventário e emoção explicada', () => {
  const flat = 'Há uma mesa, quatro cadeiras, duas portas e uma janela. O ambiente apresenta uma disposição regular. Uma tensão toma conta do ambiente.';
  const result = evaluateRoomNarrationStyle(flat);
  assert.equal(result.natural, false);
  assert.ok(result.issues.includes('EXISTENCE_REPORT'));
  assert.ok(result.issues.includes('REPORT_SPACE'));
  assert.ok(result.issues.includes('INVENTORY_LIST'));
  assert.ok(result.issues.includes('TOLD_EMOTION'));
});

test('guard de sala mantém a emoção no recorte visual', () => {
  const nonVisual = 'A luz corta os pilares e termina junto à plataforma. O silêncio pesa sobre os dois vãos laterais, além das placas claras do piso.';
  const result = evaluateRoomNarrationStyle(nonVisual);
  assert.equal(result.natural, false);
  assert.ok(result.issues.includes('NON_VISUAL_ROOM_DETAIL'));
  assert.deepEqual(result.metrics.nonVisualTerms, ['silêncio']);
});

test('observador cegado pode receber detalhe não visual explicitamente canônico', () => {
  const canonical = 'O silêncio domina o corredor estreito.';
  const result = evaluateRoomNarrationStyle('O silêncio domina o corredor.', {
    sourceText: canonical,
    allowCanonicalNonVisual: true
  });
  assert.equal(result.issues.includes('NON_VISUAL_ROOM_DETAIL'), false);
});

test('contexto de percepção chega intacto ao provider da sala', async () => {
  let received = null;
  const context = roomContext();
  context.visibleActors = [
    { id: 'pc-1', name: 'Hursar', type: 'character' },
    { id: 'npc-1', name: 'Vigia', type: 'npc' }
  ];
  context.perception.visibleActorCount = 2;
  const service = new NarrationService({
    provider: {
      async createRoomEntry(providerContext) {
        received = providerContext;
        return safeText;
      }
    }
  });

  await service.describeRoom(context);
  assert.equal(received.perception.mode, 'TOKEN_VISION');
  assert.equal(received.perception.observer.tokenId, 'token-1');
  assert.deepEqual(received.visibleActors.map((actor) => actor.name), ['Vigia']);
});

test('rejeita nome de personagem excluído mesmo quando ele não está na sala', async () => {
  let calls = 0;
  let received = null;
  const context = roomContext();
  context.narrationExclusions = { actorNames: ['Hursar', 'mistra'] };
  const wrongText = `Hursar está diante de baixos pilares distribuídos pelas paredes laterais, com placas de pedra clara atravessando o centro. Uma plataforma elevada recorta a luz da entrada, enquanto dois vãos se abrem em lados opostos além dos nichos vazios.`;
  const service = new NarrationService({
    provider: {
      async createRoomEntry(providerContext) {
        calls += 1;
        received = providerContext;
        return calls === 1 ? wrongText : safeText;
      }
    },
    maxOpeningAttempts: 3,
    logger: { info() {}, warn() {}, error() {} }
  });

  const result = await service.describeRoom(context);
  assert.equal(calls, 2);
  assert.equal(result, safeText);
  assert.equal('narrationExclusions' in received, false);
  assert.doesNotMatch(result, /Hursar|mistra/i);
});

test('rejeita NPC fora da visão e permite somente o NPC visível', async () => {
  let calls = 0;
  const context = roomContext();
  context.visibleActors = [{ id: 'npc-visible', name: 'Vigia', type: 'npc' }];
  context.perception.visibleActorCount = 1;
  context.narrationExclusions = { actorNames: ['Hursar', 'Goblin Chefe', 'Vigia'] };
  const wrongText = `Goblin Chefe permanece entre pilares baixos junto às paredes laterais, além das placas de pedra clara que atravessam o centro. Uma plataforma elevada recorta a luz da entrada, enquanto dois vãos se abrem em lados opostos perto dos nichos vazios.`;
  const visibleNpcText = `Pilares baixos acompanham as paredes laterais, interrompidos por placas de pedra clara que atravessam o centro. Junto à plataforma elevada, o Vigia ocupa a parte alcançada pela luz da entrada. Mais adiante, dois vãos se abrem em lados opostos; entre eles, as bordas gastas do piso conduzem até os nichos vazios.`;
  const service = new NarrationService({
    provider: { createRoomEntry: async () => calls++ === 0 ? wrongText : visibleNpcText },
    maxOpeningAttempts: 3,
    logger: { info() {}, warn() {}, error() {} }
  });

  const result = await service.describeRoom(context);
  assert.equal(calls, 2);
  assert.doesNotMatch(result, /Goblin Chefe/i);
  assert.match(result, /Vigia/);
});

test('rejeita tom mecânico e tenta novamente com narração natural', async () => {
  let calls = 0;
  const directions = [];
  const mechanical = 'A sala apresenta pilares em intervalos regulares e placas claras no centro. É possível observar uma plataforma elevada, duas passagens laterais e nichos vazios junto às paredes, oferecendo ao grupo uma leitura direta de todo o recinto antes de qualquer avanço.';
  const service = new NarrationService({
    provider: { createRoomEntry: async (context) => {
      directions.push(context.styleDirection.signature);
      return calls++ === 0 ? mechanical : safeText;
    } }
  });

  const result = await service.describeRoom(roomContext());
  assert.equal(calls, 2);
  assert.notEqual(directions[0], directions[1]);
  assert.equal(result, safeText);
  assert.deepEqual(evaluateRoomNarrationStyle(mechanical).issues, [
    'REPORT_OPENING',
    'POSSIBILITY_FRAMING',
    'READING_FRAMING'
  ]);
  assert.equal(evaluateRoomNarrationStyle(safeText).natural, true);
});
