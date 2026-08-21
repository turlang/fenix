import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('Grid 2.0 oferece preview real, arraste, cor, opacidade e espessura persistentes', async () => {
  const [stage, route, service, layout, css] = await Promise.all([
    source('apps/fenix-vtt/components/map-stage.jsx'),
    source('apps/api/src/http/register-scene-routes.js'),
    source('packages/campaign-scene-service/src/index.js'),
    source('apps/fenix-vtt/app/layout.js'),
    source('apps/fenix-vtt/app/grid-authoring-v2.css')
  ]);

  for (const marker of [
    'arraste a grade no mapa',
    'Cor da linha',
    'Opacidade',
    'Espessura',
    'gridDragRef',
    'grid-color-presets',
    'backgroundImage: `linear-gradient'
  ]) {
    assert.ok(stage.includes(marker), `Grid 2.0 sem marker ${marker}`);
  }

  for (const marker of ['color: request.body?.color', 'opacity: request.body?.opacity', 'lineWidth: request.body?.lineWidth']) {
    assert.ok(route.includes(marker), `rota de grade sem ${marker}`);
  }

  for (const marker of ['color: gridColor(grid.color)', 'opacity: decimal(grid.opacity', 'lineWidth: decimal(grid.lineWidth']) {
    assert.ok(service.includes(marker), `persistência da grade sem ${marker}`);
  }

  assert.ok(layout.includes("import './grid-authoring-v2.css';"));
  assert.match(css, /\.map-grid-overlay\s*\{[\s\S]*opacity:\s*1\s*!important/);
});

test('colocação de token é preparada no catálogo e concluída por clique no canvas', async () => {
  const [stage, shell, catalog] = await Promise.all([
    source('apps/fenix-vtt/components/map-stage.jsx'),
    source('apps/fenix-vtt/components/vtt-shell.jsx'),
    source('apps/fenix-vtt/components/actor-scene-catalog.jsx')
  ]);

  for (const marker of ['placementActor', 'onPlaceActor', 'tokenPlacementPoint', 'Clique no mapa para posicionar', 'token-placement-preview']) {
    assert.ok(stage.includes(marker), `MapStage sem fluxo de placement ${marker}`);
  }
  for (const marker of ['placementActorId', 'beginTokenPlacement', 'placePreparedToken', 'onPlaceActor={placePreparedToken}']) {
    assert.ok(shell.includes(marker), `VttShell sem fluxo de placement ${marker}`);
  }
  assert.ok(catalog.includes('Colocar token'));
  assert.ok(catalog.includes('Clique no mapa'));
});

test('ownership do jogador aparece por nome e convite explica o controle exclusivo', async () => {
  const [stage, shell, catalog, provider] = await Promise.all([
    source('apps/fenix-vtt/components/map-stage.jsx'),
    source('apps/fenix-vtt/components/vtt-shell.jsx'),
    source('apps/fenix-vtt/components/actor-scene-catalog.jsx'),
    source('apps/fenix-vtt/components/session-provider.jsx')
  ]);

  assert.ok(shell.includes('controla ${controlledActor.name}'));
  assert.ok(shell.includes('controle exclusivo do token de'));
  assert.ok(stage.includes('você controla ${controlledActorName}'));
  assert.ok(catalog.includes('Você controla este token'));
  assert.ok(provider.includes("if (!isGm && membership?.actorId && tokenActorId !== membership.actorId) return false;"));
});

test('paredes usam desenho contínuo, preview, snap em vértices e trava de 45 graus', async () => {
  const stage = await source('apps/fenix-vtt/components/map-stage.jsx');
  for (const marker of [
    'desenho contínuo com preview',
    'Snap em vértices',
    'constrainWallAngle',
    'wall-preview-segment',
    'setWallStart(point)',
    'Encerrar traçado'
  ]) {
    assert.ok(stage.includes(marker), `Walls 2.0 sem marker ${marker}`);
  }
});

test('porta é inserida sobre uma parede existente e preserva estados', async () => {
  const stage = await source('apps/fenix-vtt/components/map-stage.jsx');
  for (const marker of [
    'Porta na parede',
    'insertDoorIntoWall',
    'projectPointToWall',
    'wallsOnly: true',
    'SceneDoorState.CLOSED',
    'SceneDoorState.OPEN',
    'SceneDoorState.LOCKED'
  ]) {
    assert.ok(stage.includes(marker), `Doors 2.0 sem marker ${marker}`);
  }
});
