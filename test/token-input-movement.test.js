import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isEditableKeyboardTarget,
  keyboardMovementStep,
  movementDirectionForKey,
  requestedTokenFromKeyboard,
  resolveClientTokenMovement
} from '../apps/fenix-vtt/lib/token-input-movement.js';

const shellSource = await readFile(new URL('../apps/fenix-vtt/components/vtt-shell.jsx', import.meta.url), 'utf8');
const mapStageSource = await readFile(new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url), 'utf8');

test('WASD e setas usam direções gamer equivalentes', () => {
  assert.deepEqual(movementDirectionForKey('w'), { x: 0, y: -1 });
  assert.deepEqual(movementDirectionForKey('ArrowUp'), { x: 0, y: -1 });
  assert.deepEqual(movementDirectionForKey('a'), { x: -1, y: 0 });
  assert.deepEqual(movementDirectionForKey('s'), { x: 0, y: 1 });
  assert.deepEqual(movementDirectionForKey('d'), { x: 1, y: 0 });
  assert.equal(movementDirectionForKey('q'), null);
});

test('movimento normal usa 20% da célula e Shift usa uma célula completa', () => {
  assert.equal(keyboardMovementStep(70), 14);
  assert.equal(keyboardMovementStep(70, { fullCell: true }), 70);
  const token = { id: 'hero-ayla', x: 70, y: 70, size: 40 };
  assert.equal(requestedTokenFromKeyboard(token, 'd', { gridSize: 70 }).x, 84);
  assert.equal(requestedTokenFromKeyboard(token, 's', { gridSize: 70, fullCell: true }).y, 140);
});

test('atalhos não capturam digitação em controles de formulário', () => {
  assert.equal(isEditableKeyboardTarget({ tagName: 'INPUT' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'textarea' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'select' }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditableKeyboardTarget({ tagName: 'DIV' }), false);
});

test('guarda local impede atravessar parede mesmo sem realtime ativo', () => {
  const scene = {
    width: 420,
    height: 280,
    walls: [{ id: 'wall-1', kind: 'wall', a: { x: 140, y: 0 }, b: { x: 140, y: 280 } }]
  };
  const previousToken = { id: 'hero-ayla', x: 70, y: 140, size: 40 };
  const requestedToken = { ...previousToken, x: 210 };
  const result = resolveClientTokenMovement({ previousToken, requestedToken, scene });
  assert.equal(result.collision.blocked, true);
  assert.equal(result.collision.wallId, 'wall-1');
  assert.equal(result.collision.ignoredWalls, false);
  assert.ok(result.token.x <= 119.1);
});

test('Mestre ignora paredes no cliente mas continua respeitando os limites da cena', () => {
  const scene = {
    width: 420,
    height: 280,
    walls: [{ id: 'wall-1', kind: 'wall', a: { x: 140, y: 0 }, b: { x: 140, y: 280 } }]
  };
  const previousToken = { id: 'hero-ayla', x: 70, y: 140, size: 40 };
  const acrossWall = resolveClientTokenMovement({
    previousToken,
    requestedToken: { ...previousToken, x: 210 },
    scene,
    ignoreWalls: true
  });
  assert.equal(acrossWall.collision.blocked, false);
  assert.equal(acrossWall.collision.ignoredWalls, true);
  assert.equal(acrossWall.token.x, 210);

  const outsideScene = resolveClientTokenMovement({
    previousToken: acrossWall.token,
    requestedToken: { ...acrossWall.token, x: 999 },
    scene,
    ignoreWalls: true
  });
  assert.equal(outsideScene.collision.boundaryAdjusted, true);
  assert.ok(outsideScene.token.x < scene.width);
});

test('preview local do Mestre mostra Z automático de piso e rampa', () => {
  const scene = {
    width: 420,
    height: 280,
    grid: { size: 70 },
    walls: [],
    fog: { visionRangeCells: 8 },
    elevation: { enabled: true, levelHeight: 4, verticalStep: 1 },
    visionProfiles: {
      'hero-ayla': { elevation: 0, height: 1.8, movementMode: 'ground' }
    },
    regions: [
      {
        id: 'ramp-1', name: 'Rampa', kind: 'ramp', enabled: true, priority: 10,
        points: [{ x: 70, y: 70 }, { x: 210, y: 70 }, { x: 210, y: 210 }, { x: 70, y: 210 }],
        baseElevation: 0, targetElevation: 4,
        axis: { start: { x: 70, y: 140 }, end: { x: 210, y: 140 } }
      },
      {
        id: 'upper', name: 'Piso superior', kind: 'floor', enabled: true, priority: 5,
        points: [{ x: 210, y: 70 }, { x: 350, y: 70 }, { x: 350, y: 210 }, { x: 210, y: 210 }],
        baseElevation: 4, targetElevation: 4
      }
    ]
  };
  const start = { id: 'hero-ayla', x: 70, y: 140, size: 40, elevation: 0, height: 1.8, movementMode: 'ground' };
  const halfway = resolveClientTokenMovement({ previousToken: start, requestedToken: { ...start, x: 140 }, scene, ignoreWalls: true });
  assert.equal(halfway.token.elevation, 2);
  assert.equal(halfway.groundPreview?.regionId, 'ramp-1');

  const upper = resolveClientTokenMovement({ previousToken: halfway.token, requestedToken: { ...halfway.token, x: 280 }, scene, ignoreWalls: true });
  assert.equal(upper.token.elevation, 4);
  assert.equal(upper.groundPreview?.regionId, 'upper');
});

test('VttShell aplica guarda local no drag e registra WASD global com noclip do Mestre', () => {
  assert.match(shellSource, /onTokenMoved=\{handleMapTokenMoved\}/);
  assert.match(shellSource, /window\.addEventListener\('keydown', handleKeyboardMove\)/);
  assert.match(shellSource, /requestedTokenFromKeyboard\(token, event\.key/);
  assert.match(shellSource, /ignoreWalls: isGm/);
  assert.match(shellSource, /resolveSafeToken\(requested\)/);
});

test('MapStage aplica colisão durante pointermove e mantém noclip visual do Mestre', () => {
  assert.match(mapStageSource, /import \{ resolveClientTokenMovement \} from '\.\.\/lib\/token-input-movement\.js';/);
  assert.match(mapStageSource, /const requested = \{ \.\.\.current, x: hit\.world\.x, y: hit\.world\.y \};/);
  assert.match(mapStageSource, /resolveClientTokenMovement\(\{\s*previousToken: current,\s*requestedToken: requested,\s*scene,\s*ignoreWalls: canMoveAny\s*\}\)/);
  assert.match(mapStageSource, /const moved = resolved\?\.token \?\? requested;/);
  assert.match(mapStageSource, /setDragVisionToken\(moved\);/);
  assert.match(mapStageSource, /const zone = roomZoneAt\(\{ x: moved\.x, y: moved\.y \}\);/);
  assert.doesNotMatch(mapStageSource, /const moved = \{ \.\.\.current, x: hit\.world\.x, y: hit\.world\.y \};/);
  assert.doesNotMatch(mapStageSource, /const zone = roomZoneAt\(hit\.world\);/);
});
