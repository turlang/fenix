import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationService } from '../packages/narration-service/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';
import { createNarrationQualityGuard } from '../packages/narration-quality-guard/src/index.js';

const safeText = [
  'A câmara se abre em linhas regulares, com pilares baixos marcando as laterais e placas claras cobrindo o piso central. A passagem termina diante de uma plataforma elevada, enquanto nichos vazios acompanham as paredes e organizam o espaço em intervalos precisos.',
  'A iluminação disponível alcança o centro, revela os limites da plataforma e deixa visíveis as duas saídas laterais. Cada detalhe confirmado permanece imóvel, oferecendo ao grupo uma leitura direta do recinto, de suas proporções e dos caminhos que continuam além.'
].join('\n\n');

function roomContext(sceneId = 'scene-1', roomName = 'Sala 7') {
  return {
    scene: { id: sceneId, name: 'Dungeon de teste' },
    campaign: { worldId: 'world-1' },
    room: { id: 'room-7', name: roomName },
    source: {
      canonicalAnchor: true,
      type: 'ROOM_READ_ALOUD',
      text: 'Uma sala retangular possui pilares baixos nas laterais, placas claras no centro, uma plataforma elevada e duas saídas laterais.'
    },
    visibleActors: []
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
  const text = 'A sala apresenta paredes regulares e uma plataforma baixa no centro. Duas passagens abertas permanecem visíveis nas laterais, além das placas claras do piso.';
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
