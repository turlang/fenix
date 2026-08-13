import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampViewport,
  fitViewport,
  gridScreenStyle,
  panViewport,
  zoomViewportAt
} from '../apps/fenix-vtt/lib/map-viewport.js';

test('fitViewport centraliza o mapa e mantém zoom dentro do limite', () => {
  const viewport = fitViewport({
    canvasWidth: 1000,
    canvasHeight: 600,
    sceneWidth: 2000,
    sceneHeight: 1000
  });
  assert.equal(viewport.zoom, 0.5);
  assert.equal(viewport.x, 0);
  assert.equal(viewport.y, -100);
});

test('zoomViewportAt preserva o ponto do mundo sob o cursor', () => {
  const before = { x: 100, y: 50, zoom: 1 };
  const screenX = 300;
  const screenY = 200;
  const worldBefore = {
    x: before.x + screenX / before.zoom,
    y: before.y + screenY / before.zoom
  };
  const after = zoomViewportAt(before, {
    factor: 2,
    screenX,
    screenY,
    canvasWidth: 800,
    canvasHeight: 600,
    sceneWidth: 2000,
    sceneHeight: 1600
  });
  const worldAfter = {
    x: after.x + screenX / after.zoom,
    y: after.y + screenY / after.zoom
  };
  assert.equal(after.zoom, 2);
  assert.equal(worldAfter.x, worldBefore.x);
  assert.equal(worldAfter.y, worldBefore.y);
});

test('panViewport converte deslocamento de tela em coordenadas do mundo e respeita bordas', () => {
  const viewport = panViewport({ x: 500, y: 400, zoom: 2 }, {
    deltaX: 100,
    deltaY: -40,
    canvasWidth: 800,
    canvasHeight: 600,
    sceneWidth: 2000,
    sceneHeight: 1600
  });
  assert.equal(viewport.x, 450);
  assert.equal(viewport.y, 420);

  const clamped = clampViewport({ x: -999, y: 9999, zoom: 1 }, {
    canvasWidth: 800,
    canvasHeight: 600,
    sceneWidth: 1000,
    sceneHeight: 900
  });
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 300);
});

test('gridScreenStyle aplica tamanho e offsets no mesmo viewport do mapa', () => {
  const style = gridScreenStyle({ size: 70, offsetX: 10, offsetY: -5, visible: true }, { x: 20, y: 15, zoom: 2 });
  assert.deepEqual(style, {
    visible: true,
    size: 140,
    x: -20,
    y: -40
  });
});
