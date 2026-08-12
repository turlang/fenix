import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryFenixRepository } from '../packages/persistence-repository/src/index.js';
import { CampaignService } from '../packages/campaign-service/src/index.js';
import { PersistentSessionService } from '../packages/persistent-session-service/src/index.js';
import { createSessionRuntime } from '../packages/session-runtime/src/index.js';

const safeSnapshot = {
  activeScene: { id: 'scene-persist', name: 'Salão Persistente', description: 'Um salão de pedra iluminado por tochas.' },
  campaign: { worldId: 'campaign-persist', title: 'Campanha Persistente' },
  visibleActors: [{ id: 'hero-ayla', name: 'Ayla', type: 'character' }],
  sceneJournal: {
    id: 'journal-persist',
    name: 'Salão Persistente',
    explicitLink: true,
    selectedPage: {
      name: 'Salão Persistente',
      sectionMatchedScene: true,
      extractionMode: 'STRUCTURED_READ_ALOUD',
      content: 'O salão de pedra se abre entre colunas baixas. Uma porta de madeira ocupa a parede norte.'
    }
  }
};

function createRuntime(openingCounter) {
  const narrator = {
    async createOpening() {
      openingCounter.count += 1;
      return 'A luz das tochas alcança as colunas baixas e deixa o piso de pedra visível até a parede norte. Uma porta de madeira interrompe a alvenaria diante de Ayla, enquanto o restante do salão permanece aberto e observável.';
    },
    async createRoomEntry() { return 'A nova sala permanece visível à frente.'; },
    async narrateResolution() { return 'A ação produz uma consequência observável.'; }
  };
  const qualityGuard = {
    minWords: 1,
    maxWords: 1000,
    maxParagraphs: 10,
    evaluate() {
      return { accepted: true, hardSafe: true, penalty: 0, issues: [], hardIssues: [], metrics: {} };
    }
  };
  const noveltyGuard = {
    evaluate() { return { accepted: true, maxSimilarity: 0, threshold: 1, mode: 'TEST' }; },
    fingerprint() { return 'test-fingerprint'; }
  };
  return createSessionRuntime({ narrator, qualityGuard, noveltyGuard, logger: {} });
}

test('restart restaura mesma sessionId sem gerar nova abertura', async () => {
  const openingCounter = { count: 0 };
  const repository1 = new InMemoryFenixRepository();
  await repository1.initialize();
  const campaigns1 = new CampaignService({ repository: repository1, logger: {} });
  await campaigns1.initialize();
  const campaign = await campaigns1.createCampaign({ ownerUserId: 'owner-1', title: 'Campanha Persistente' });

  const service1 = new PersistentSessionService({
    runtime: createRuntime(openingCounter),
    campaignService: campaigns1,
    logger: {}
  });
  const started = await service1.start({ campaignId: campaign.id, snapshot: safeSnapshot });
  assert.equal(openingCounter.count, 1);
  assert.equal(started.state, 'COLLECTING_ACTIONS');

  const persistedState = repository1.snapshot();
  const repository2 = new InMemoryFenixRepository(persistedState);
  await repository2.initialize();
  const campaigns2 = new CampaignService({ repository: repository2, logger: {} });
  await campaigns2.initialize();
  const service2 = new PersistentSessionService({
    runtime: createRuntime(openingCounter),
    campaignService: campaigns2,
    logger: {}
  });

  const restored = await service2.initialize();
  assert.equal(restored.restored, true);
  assert.equal(restored.sessionId, started.sessionId);
  assert.equal(restored.state, 'COLLECTING_ACTIONS');
  assert.equal(service2.getStatus().campaignId, campaign.id);
  assert.equal(openingCounter.count, 1, 'restore não pode chamar createOpening novamente');
});
