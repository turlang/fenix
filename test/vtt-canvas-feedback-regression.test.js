import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('grade suporta precisão decimal e calibração por dois pontos', async () => {
  const [service, stage] = await Promise.all([
    source('packages/campaign-scene-service/src/index.js'),
    source('apps/fenix-vtt/components/map-stage.jsx')
  ]);
  assert.match(service, /size: decimal\(grid\.size, 70/);
  assert.match(stage, /calibrateGridFromPoints/);
  assert.match(stage, /Calibrar por 2 pontos/);
  assert.match(stage, /step=\"0\.01\"/);
});

test('cena criada pode ser reaberta por botão Configurar', async () => {
  const shell = await source('apps/fenix-vtt/components/vtt-shell.jsx');
  assert.match(shell, />Configurar<\/button>/);
  assert.match(shell, /onOpenMapTool/);
  assert.match(shell, /requestedMapTool/);
});

test('paredes e portas possuem seleção e edição de vértices', async () => {
  const stage = await source('apps/fenix-vtt/components/map-stage.jsx');
  for (const marker of ['Selecionar / editar', 'selectedWallId', 'wallEditDragRef', 'updateSelectedWallPoint', 'Excluir selecionada']) {
    assert.ok(stage.includes(marker), `faltou marker ${marker}`);
  }
});

test('WebGL preserva actorId do token para validar ownership no hit test', async () => {
  const renderer = await source('packages/webgl-map-renderer/src/index.js');
  assert.match(renderer, /this\.tokenMetadata = new Map\(\)/);
  assert.match(renderer, /actorId: token\.actorId \?\? null/);
  assert.match(renderer, /this\.tokenMetadata\.set\(normalized\.id, tokenMetadata\(token\)\)/);
  assert.match(renderer, /this\.tokenMetadata\.get\(normalizedToken\.id\)/);
});

test('primeira pessoa só habilita quando o Render Node está disponível', async () => {
  const shell = await source('apps/fenix-vtt/components/dual-view-vtt-shell.jsx');
  assert.match(shell, /client\.health\(\)/);
  assert.match(shell, /health\?\.remoteRender === 'gpu-broker'/);
  assert.match(shell, /firstPersonEnabled/);
  assert.match(shell, /Render Node não configurado neste ambiente/);
});

test('falha do gateway de IA expõe o último provider sem esconder a causa operacional', async () => {
  const gateway = await source('packages/ai-inference-gateway/src/index.js');
  assert.match(gateway, /Último erro/);
  assert.match(gateway, /lastProviderId/);
  assert.match(gateway, /FENIX_AI_ALL_PROVIDERS_FAILED/);
});
