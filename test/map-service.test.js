import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMapService, InMemoryMapService, mapInternals } from '../packages/map-service/src/index.js';
import { aiProviderInternals, PromptNarrativeProvider, ResilientNarrativeProvider } from '../packages/ai-provider/src/index.js';

const aiPlan = JSON.stringify({
  title: 'Cripta das Sete Vigílias',
  summary: 'Uma cripta em espiral conduz da entrada funerária ao relicário selado.',
  style: 'CRYPT',
  tags: ['cripta', 'vigílias'],
  rooms: [
    { id: 'entrada', label: 'Pórtico Funerário', kind: 'ENTRANCE', width: 8, height: 6, description: 'Arcos baixos e lajes gastas.', readAloud: 'Lajes escuras descem sob arcos baixos.', light: 'DIM' },
    { id: 'galeria', label: 'Galeria dos Sinos', kind: 'ROOM', width: 10, height: 7, description: 'Sete sinos imóveis.', secret: 'O terceiro sino abre uma passagem.', light: 'DARK' },
    { id: 'relicario', label: 'Relicário Selado', kind: 'OBJECTIVE', width: 9, height: 8, description: 'Um altar de pedra ocupa o centro.', light: 'BRIGHT' }
  ],
  connections: [
    { from: 'entrada', to: 'galeria', doorType: 'DOOR', locked: false },
    { from: 'galeria', to: 'relicario', doorType: 'SECRET', locked: true, secret: 'Aberta pelo terceiro sino.' }
  ]
});

test('gera planta vetorial estruturada com paredes, portas, luzes e Notes', async () => {
  const service = new InMemoryMapService({
    narrator: { async generateMapBlueprint() { return aiPlan; } },
    logger: {}
  });
  const result = await service.generate('world-map', { prompt: 'Cripta com três áreas conectadas.', roomCount: 3, gridSize: 100 });
  assert.equal(result.fallback, false);
  assert.equal(result.blueprint.status, 'READY');
  assert.equal(result.blueprint.rooms.length, 3);
  assert.ok(result.blueprint.walls.length >= 8);
  assert.equal(result.blueprint.doors.length, 4);
  assert.equal(result.blueprint.notes.length, 3);
  assert.equal(result.blueprint.lights.length, 2);
  assert.match(result.blueprint.svg, /^<svg/);
  assert.match(result.blueprint.svg, /Cripta|<circle/);
  assert.equal(result.blueprint.dimensions.width, result.blueprint.dimensions.columns * 100);
});

test('usa layout procedural seguro quando não há provedor de IA', async () => {
  const service = new InMemoryMapService({ logger: {} });
  const result = await service.generate('world-fallback', {
    title: 'Esgotos de Lúmen',
    prompt: 'Rede de esgotos com seis áreas e uma saída oculta.',
    style: 'SEWER',
    roomCount: 6
  });
  assert.equal(result.fallback, true);
  assert.equal(result.blueprint.rooms.length, 6);
  assert.equal(result.blueprint.connections.length, 5);
  assert.equal(result.blueprint.style, 'SEWER');
  assert.equal((await service.list('world-fallback')).count, 1);
});

test('gera mapa a partir de uma dungeon arquivada e rejeita fonte de outro tipo', async () => {
  const generatorService = {
    async get(_campaignId, artifactId) {
      if (artifactId === 'dungeon-1') return { id: artifactId, type: 'DUNGEON', title: 'Torre Partida', summary: 'Torre em quatro níveis.', metadata: { roomCount: 4, theme: 'FORTRESS' }, content: '# Área 1: Portão\n# Área 2: Escadaria\n# Área 3: Arsenal\n# Área 4: Observatório' };
      if (artifactId === 'npc-1') return { id: artifactId, type: 'NPC', title: 'Cartógrafo' };
      return null;
    }
  };
  const service = new InMemoryMapService({ generatorService, logger: {} });
  const result = await service.generate('world-source', { sourceArtifactId: 'dungeon-1' });
  assert.equal(result.blueprint.source.artifactId, 'dungeon-1');
  assert.equal(result.blueprint.rooms[0].label, 'Portão');
  await assert.rejects(
    service.generate('world-source', { sourceArtifactId: 'npc-1' }),
    (error) => error.code === 'MAP_SOURCE_INVALID'
  );
});

test('impede planta equivalente duplicada na mesma campanha', async () => {
  const service = new InMemoryMapService({ narrator: { async generateMapBlueprint() { return aiPlan; } }, logger: {} });
  await service.generate('world-duplicate', { prompt: 'Primeira planta da cripta.' });
  await assert.rejects(
    service.generate('world-duplicate', { prompt: 'Outra descrição, mesma geometria.' }),
    (error) => error.code === 'MAP_DUPLICATE' && error.statusCode === 409
  );
  assert.equal((await service.list('world-duplicate')).count, 1);
});

test('persiste plantas e vínculo da Scene após reiniciar', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mestre-orc-maps-'));
  const filePath = join(directory, 'maps.json');
  try {
    const first = new FileMapService({ filePath, narrator: { async generateMapBlueprint() { return aiPlan; } }, logger: {} });
    const generated = await first.generate('world-persist', { prompt: 'Cripta persistente.' });
    await first.markSceneCreated('world-persist', generated.blueprint.id, { id: 'scene-1', name: 'Cripta', backgroundPath: 'mestre-orc/maps/cripta.svg', journalId: 'journal-1' });
    const second = new FileMapService({ filePath, logger: {} });
    const restored = await second.get('world-persist', generated.blueprint.id, { includeSvg: true, includeSecrets: true });
    assert.equal(restored.status, 'SCENE_CREATED');
    assert.equal(restored.scene.id, 'scene-1');
    assert.match(restored.svg, /^<svg/);
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    assert.equal(raw.version, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('layout mantém salas sem sobreposição e portas ocupam lacunas das paredes', () => {
  const normalized = mapInternals.normalizePlan(aiPlan, { roomCount: 3 });
  const layout = mapInternals.layoutAbstractPlan(normalized, { gridSize: 100 });
  for (let leftIndex = 0; leftIndex < layout.rooms.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < layout.rooms.length; rightIndex += 1) {
      const left = layout.rooms[leftIndex];
      const right = layout.rooms[rightIndex];
      const overlaps = left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
      assert.equal(overlaps, false);
    }
  }
  assert.equal(layout.doors.length, normalized.connections.length * 2);
  assert.ok(layout.walls.every((wall) => wall.x1 !== wall.x2 || wall.y1 !== wall.y2));
});


test('repara grafo desconectado e cria paredes laterais nos corredores', () => {
  const plan = mapInternals.normalizePlan({
    title: 'Mapa desconectado',
    summary: 'A IA esqueceu uma ligação entre os componentes.',
    rooms: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
      { id: 'c', label: 'C' }, { id: 'd', label: 'D' }
    ],
    connections: [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]
  }, { roomCount: 4 });
  const reachable = new Set(['a']);
  while (true) {
    const before = reachable.size;
    for (const edge of plan.connections) {
      if (reachable.has(edge.from)) reachable.add(edge.to);
      if (reachable.has(edge.to)) reachable.add(edge.from);
    }
    if (reachable.size === before) break;
  }
  assert.equal(reachable.size, 4);
  const layout = mapInternals.layoutAbstractPlan(plan, { gridSize: 100 });
  assert.ok(layout.walls.some((wall) => wall.kind === 'corridor'));
});

test('prompt de mapa exige JSON conectado e separa read-aloud de segredo', () => {
  const prompt = aiProviderInternals.mapBlueprintPrompt({ title: 'Cripta', prompt: 'Três salas.', roomCount: 3, style: 'CRYPT' });
  assert.match(prompt, /SOMENTE com JSON válido/);
  assert.match(prompt, /grafo precisa ser totalmente conectado/);
  assert.match(prompt, /readAloud/);
  assert.match(prompt, /secret/);
  assert.match(prompt, /Não copie mapas publicados/);
});

test('provedor resiliente aplica fallback à geração de mapas', async () => {
  const provider = new ResilientNarrativeProvider({
    providers: [
      { id: 'primary', provider: { model: 'a', async generateMapBlueprint() { throw Object.assign(new Error('falha'), { statusCode: 503 }); } } },
      { id: 'fallback', provider: { model: 'b', async generateMapBlueprint() { return aiPlan; } } }
    ],
    logger: {},
    failureThreshold: 1
  });
  assert.equal(await provider.generateMapBlueprint({ roomCount: 3 }), aiPlan);
  assert.equal(provider.getStatus().activeProvider, 'fallback');
});

test('PromptNarrativeProvider envia o contrato do mapa ao transporte textual', async () => {
  let request = null;
  const provider = new PromptNarrativeProvider({ requestText: async (payload) => { request = payload; return aiPlan; }, providerId: 'fake' });
  assert.equal(await provider.generateMapBlueprint({ title: 'Cripta', prompt: 'Três áreas.', roomCount: 3 }), aiPlan);
  assert.equal(request.maxTokens, 2600);
  assert.match(request.prompt, /PLANTA ABSTRATA ORIGINAL/);
});
