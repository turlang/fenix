import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { aiProviderInternals } from '../packages/ai-provider/src/index.js';
import {
  NarrationService,
  evaluateActorNameSafety,
  redactActorNames
} from '../packages/narration-service/src/index.js';
import { InMemoryNarrationMemory } from '../packages/narration-memory/src/index.js';
import { createNarrationContextBuilder } from '../packages/narration-context-builder/src/index.js';
import { createSceneOpeningContextBuilder } from '../packages/scene-opening-context/src/index.js';
import { FoundryAdapter } from '../packages/foundry-adapter/src/index.js';

const mainSource = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');

const neutralOpening = `A encosta de pedra se abre entre arbustos densos, formando uma passagem larga para o interior. A vegetação cobre parte das bordas, enquanto o terreno diante da abertura desce suavemente até o curso de água que atravessa o caminho.

Um riacho raso sai da caverna e acompanha a entrada pelo lado esquerdo. À direita da correnteza, uma faixa estreita de solo firme segue junto à parede rochosa até desaparecer além do alcance da luz. As duas rotas permanecem livres diante da passagem.`;

function openingInput() {
  return {
    scene: { id: 'scene-1', name: 'Entrada da Caverna' },
    campaign: { worldId: 'world-1' },
    visibleActors: [
      { id: 'pc-1', name: 'Hursar', type: 'character' },
      { id: 'pc-2', name: 'mistra', type: 'character' }
    ],
    narrationExclusions: { actorNames: ['Hursar', 'mistra'] },
    sceneJournal: {
      name: 'Entrada da Caverna',
      explicitLink: true,
      selectedPage: {
        name: '1. Entrada',
        areaName: '1. Entrada',
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD',
        content: 'Uma abertura larga surge na encosta entre arbustos densos. Um riacho raso sai da caverna, com uma faixa de solo firme à direita.'
      }
    }
  };
}

test('abertura não entrega nomes de tokens ao prompt da IA', () => {
  const prompt = aiProviderInternals.openingPrompt({
    scene: { name: 'Redbrand Hideout' },
    source: { text: 'Uma passagem de pedra conduz ao interior.', canonicalAnchor: true },
    visibleActors: [
      { id: 'pc-1', name: 'Hursar', type: 'character' },
      { id: 'pc-2', name: 'mistra', type: 'character' }
    ]
  });

  assert.doesNotMatch(prompt, /Hursar|mistra/i);
  assert.match(prompt, /Não cite nomes de tokens, personagens jogadores/i);
  assert.match(prompt, /VOZ HUMANA E CINEMATOGRÁFICA/);
  assert.match(prompt, /A emoção deve nascer da cadência/i);
  assert.match(prompt, /três movimentos conectados/i);
  assert.doesNotMatch(prompt, /Atores visíveis:/i);
});

test('entrada de sala entrega ao prompt somente NPCs visíveis', () => {
  const prompt = aiProviderInternals.roomEntryPrompt({
    scene: { name: 'Redbrand Hideout' },
    room: { name: '4. Criptas' },
    source: { text: 'Uma câmara de pedra possui duas passagens laterais.' },
    perception: { mode: 'TOKEN_VISION', visionAvailable: true },
    visibleActors: [
      { id: 'pc-1', name: 'Hursar', type: 'character' },
      { id: 'pc-2', name: 'mistra', type: 'character' },
      { id: 'npc-1', name: 'Vigia', type: 'npc' }
    ]
  });

  assert.doesNotMatch(prompt, /Hursar|mistra/i);
  assert.match(prompt, /Atores comprovadamente visíveis pelo token: Vigia/);
});

test('NarrationService neutraliza atores da abertura antes de chamar o provider', async () => {
  let received = null;
  const service = new NarrationService({
    provider: {
      async createOpening(context) {
        received = context;
        return neutralOpening;
      }
    },
    logger: { info() {}, warn() {}, error() {} }
  });
  const result = await service.createOpening(openingInput());

  assert.deepEqual(received.visibleActors, []);
  assert.equal('narrationExclusions' in received, false);
  assert.doesNotMatch(result, /Hursar|mistra/i);
  assert.match(result, /O que vocês fazem\?$/);
});

test('nomes de personagens são detectados por palavra inteira e podem ser removidos do histórico', () => {
  const unsafe = evaluateActorNameSafety('HURSAR permanece junto à passagem, enquanto mistra está distante.', ['Hursar', 'mistra']);
  assert.equal(unsafe.safe, false);
  assert.deepEqual(unsafe.mentions, ['Hursar', 'mistra']);
  assert.equal(evaluateActorNameSafety('Uma muralha permanece firme.', ['Mura']).safe, true);

  const redacted = redactActorNames('Hursar e MISTRA aparecem em uma versão antiga.', ['Hursar', 'mistra']);
  assert.doesNotMatch(redacted, /Hursar|mistra/i);
  assert.equal((redacted.match(/\[personagem\]/g) ?? []).length, 2);
});

test('NarrationService rejeita abertura que inventa a presença de um personagem', async () => {
  let calls = 0;
  const service = new NarrationService({
    provider: {
      async createOpening() {
        calls += 1;
        return calls === 1
          ? neutralOpening.replace('A encosta de pedra', 'Hursar permanece diante da encosta de pedra')
          : neutralOpening;
      }
    },
    maxOpeningAttempts: 3,
    logger: { info() {}, warn() {}, error() {} }
  });

  const result = await service.createOpening(openingInput());
  assert.equal(calls, 2);
  assert.doesNotMatch(result, /Hursar|mistra/i);
});

test('histórico antigo chega ao provider sem nomes de personagens', async () => {
  let received = null;
  const memory = new InMemoryNarrationMemory();
  const service = new NarrationService({
    provider: {
      async createOpening(context) {
        received = context;
        return neutralOpening;
      }
    },
    narrationMemory: memory,
    logger: { info() {}, warn() {}, error() {} }
  });
  const context = openingInput();
  const openingContext = service.openingContextBuilder.build(context);
  const sceneKey = service.openingPlanner.buildSceneKey(openingContext);
  await memory.append({
    id: 'old-opening',
    sceneKey,
    text: 'Hursar e mistra atravessam a entrada em uma versão antiga.',
    plan: { signature: 'old-plan' }
  });

  await service.createOpening(context);
  const excerpt = received.novelty.avoidOpenings[0].excerpt;
  assert.doesNotMatch(excerpt, /Hursar|mistra/i);
  assert.match(excerpt, /\[personagem\]/);
});

test('nomes excluídos atravessam os dois builders do contexto', () => {
  const logger = { info() {}, error() {} };
  const normalized = createNarrationContextBuilder({ logger }).build({
    activeScene: { id: 'scene-1', name: 'Entrada' },
    narrationExclusions: { actorNames: ['Hursar', 'mistra', 'Hursar'] }
  });
  const opening = createSceneOpeningContextBuilder({ logger }).build(normalized);

  assert.deepEqual(normalized.narrationExclusions.actorNames, ['Hursar', 'mistra']);
  assert.deepEqual(opening.narrationExclusions.actorNames, ['Hursar', 'mistra']);
});

test('adaptador transporta nomes excluídos do snapshot até o Engine', async () => {
  const adapter = new FoundryAdapter({
    async getActiveScene() { return { id: 'scene-1', name: 'Entrada' }; },
    async getNarrationExclusions() { return { actorNames: ['Hursar', 'mistra'] }; }
  });

  const snapshot = await adapter.sync();
  assert.deepEqual(snapshot.narrationExclusions.actorNames, ['Hursar', 'mistra']);
});

test('snapshot da abertura limita atores à sala numerada inicial', () => {
  const helpers = mainSource.slice(mainSource.indexOf('function openingActorsForScene'), mainSource.indexOf('async function collectSnapshot'));
  const collector = mainSource.slice(mainSource.indexOf('async function collectSnapshot'), mainSource.indexOf('async function request'));
  assert.match(helpers, /leadingRoomNumber\(sceneJournal\?\.selectedPage\?\.areaName\)/);
  assert.match(helpers, /roomOccupancyForToken\(token, scene, markers\)/);
  assert.match(helpers, /occupancy\.roomNumber !== openingRoomNumber/);
  assert.match(helpers, /function sceneActorNames\(scene\)/);
  assert.doesNotMatch(helpers, /isPlayerCharacter/);
  assert.match(collector, /const visibleActors = openingActorsForScene\(scene, sceneJournal\)/);
  assert.match(collector, /narrationExclusions: \{ actorNames: excludedActorNames \}/);
  assert.doesNotMatch(collector, /for \(const token of scene\.tokens/);
});
