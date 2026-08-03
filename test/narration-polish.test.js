import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationService, evaluateDynamicNarration } from '../packages/narration-service/src/index.js';

const pendingResolution = {
  declaration: { actorId: 'hero-1', actorName: 'hurSar', content: 'Procuro armadilhas.' },
  intent: { type: 'INVESTIGATION', target: 'armadilhas', content: 'Procuro armadilhas.' },
  rules: {
    result: { authoritative: false, pendingMasterDecision: true, effect: 'Investigar: armadilhas' },
    adapter: { systemId: 'dnd5e', name: 'D&D 5e' }
  },
  relationship: {}
};

test('rejeita texto mecânico e encerramento genérico sem resultado autoritativo', () => {
  const evaluation = evaluateDynamicNarration(
    '[calmo] A busca começa. Com uma rolagem confirmada pelo Foundry, total 0, dano 0. O que virá a seguir?',
    { authoritativeMechanics: false }
  );
  assert.equal(evaluation.hardSafe, false);
  assert.ok(evaluation.hardIssues.includes('FOUNDRY_META'));
  assert.ok(evaluation.hardIssues.includes('ROLL_META'));
  assert.ok(evaluation.issues.includes('GENERIC_CLIFFHANGER'));
  assert.ok(evaluation.issues.includes('QUESTION_ENDING'));
});

test('repete a geração com correções e publica somente a versão natural', async () => {
  const calls = [];
  const provider = {
    async narrateRound(payload) {
      calls.push(payload);
      if (calls.length === 1) {
        return '[calmo] A ação declarada produz um resultado claro. O que virá a seguir?';
      }
      return '[foco] A busca se concentra nas pedras e nas junções ao alcance. Nenhuma conclusão é antecipada; o exame permanece no instante anterior à descoberta.';
    }
  };
  const service = new NarrationService({ provider, maxDynamicAttempts: 3, logger: { warn() {}, error() {} } });
  const narration = await service.narrateRound({
    roundNumber: 1,
    resolutions: [pendingResolution],
    npcCoordination: {},
    worldState: {},
    context: { scene: { name: 'Cisterna' } }
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1].qualityFeedback.join(' '), /oralidade natural|imagem concreta|sem pergunta/i);
  assert.doesNotMatch(narration, /Foundry|total 0|dano 0|O que virá/i);
  assert.match(narration, /Nenhuma conclusão é antecipada/i);
});
