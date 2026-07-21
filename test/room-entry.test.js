import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationService } from '../packages/narration-service/src/index.js';
import { NoveltyGuard } from '../packages/novelty-guard/src/index.js';
import { NarrationQualityGuard } from '../packages/narration-quality-guard/src/index.js';

const roomContext = {
  scene: { id: 'scene-1', name: 'Caverna' },
  room: { id: 'room-1', name: 'Sala do Tesouro' },
  source: {
    type: 'DIRECT_JOURNAL_READ_ALOUD',
    name: 'Sala do Tesouro',
    text: 'Paredes de pedra crua guardam baús abandonados. O ar carrega o cheiro de metal enferrujado.',
    canonicalAnchor: true,
    extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
  },
  visibleActors: [{ id: 'a1', name: 'Hurszar', type: 'character' }],
  campaign: { worldId: 'world-1' }
};

const roomNarration = 'Paredes de pedra crua circundam a sala, com baús abandonados encostados nas laterais. O ar carrega o cheiro de metal enferrujado e a poeira dança em uma fresta de luz. Hurszar entra devagar, avaliando o espaço enquanto seus olhos percorrem os cantos escuros antes de decidir o que fazer com os baús.';

test('NarrationService.describeRoom gera narração curta sem decisão final', async () => {
  const narrator = { async createRoomEntry(_context) {
    return roomNarration;
  }};
  const service = new NarrationService({ provider: narrator });
  const result = await service.describeRoom(roomContext);
  assert.match(result, /Paredes de pedra/);
  assert.ok(result.length >= 80);
});

test('NarrationService.describeRoom rejeita cópia integral da âncora', async () => {
  const narrator = { async createRoomEntry(_context) {
    return roomContext.source.text;
  }};
  const service = new NarrationService({ provider: narrator });
  try {
    await service.describeRoom(roomContext);
    assert.fail('deveria ter rejeitado');
  } catch (error) {
    assert.equal(error.code, 'NARRATION_SAFETY_FAILED');
  }
});

test('NarrationQualityGuard aceita descrição de sala curta sem decisão final', () => {
  const guard = new NarrationQualityGuard({ minWords: 50, maxWords: 120, maxParagraphs: 2, requireDecisionEnding: false });
  const candidate = 'Paredes de pedra crua circundam a sala, com baús abandonados encostados nas laterais, enquanto o ar carrega o cheiro de metal enferrujado e a poeira dança em uma fresta de luz por todo o cômodo.';
  const result = guard.evaluate(candidate, roomContext);
  assert.equal(result.hardSafe, true);
  assert.ok(result.accepted || result.issues.length > 0);
  assert.ok(result.metrics.wordCount >= 30);
});

test('NarrationQualityGuard rejeita texto longo em descrição de sala', () => {
  const guard = new NarrationQualityGuard({ minWords: 50, maxWords: 120, maxParagraphs: 2, requireDecisionEnding: false });
  const candidate = 'Palavra '.repeat(200) + '.'.repeat(50);
  const result = guard.evaluate(candidate, roomContext);
  assert.equal(result.hardSafe, false);
  assert.ok(result.hardIssues.includes('EXCESSIVE_LENGTH'));
});

test('NoveltyGuard mantém histórico separado por sala', async () => {
  const memory = { records: [] };
  const service = new NarrationService({
    provider: { async createRoomEntry(_ctx) { return 'Descrição completa da Sala do Tesouro com detalhes específicos deste local, elementos observáveis sem repetir fórmulas e atmosfera própria para o momento em que os personagens entram no cômodo pela primeira vez.\n\nOs baús antigos repousam junto às paredes enquanto sombras se movem lentamente no chão coberto por poeira e pedaços de madeira apodrecida.'; } },
    narrationMemory: {
      async list(sceneKey) { return memory.records.filter((r) => r.sceneKey === sceneKey); },
      async append(record) { memory.records.push(record); }
    }
  });
  const ctx = { ...roomContext, scene: { ...roomContext.scene, id: 'scene-2' } };
  await service.describeRoom(roomContext);
  await service.describeRoom(ctx);
  assert.equal(memory.records.length, 2);
  assert.equal(memory.records[0].sceneKey, 'room:scene-1:sala-do-tesouro');
  assert.equal(memory.records[1].sceneKey, 'room:scene-2:sala-do-tesouro');
});
