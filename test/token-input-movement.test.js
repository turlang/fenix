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

test('preview local mostra Z automático de piso e rampa', () => {
  const scene = {
    width: 420,
    height: 280,
    grid: { size: 70 },
    walls: [],
    elevation: { enabled: true, levelHeight: 4, verticalStep: 1 },
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

test('VttShell registra WASD global e resolução local', () => {
  assert.match(shellSource, /onTokenMoved=\{handleMapTokenMoved\}/);
  assert.match(shellSource, /window\.addEventListener\('keydown', handleKeyboardMove\)/);
  assert.match(shellSource, /requestedTokenFromKeyboard\(token, event\.key/);
  assert.match(shellSource, /resolveSafeToken\(requested\)/);
});

test('MapStage usa o draft de regiões na cena de interação', () => {
  assert.match(mapStageSource, /const interactionScene = useMemo/);
  assert.match(mapStageSource, /regions: regionDraft/);
  assert.match(mapStageSource, /scene: interactionScene/);
  assert.match(mapStageSource, /const moved = resolved\?\.token \?\? requested;/);
  assert.match(mapStageSource, /setDragVisionToken\(moved\);/);
  assert.match(mapStageSource, /const zone = roomZoneAt\(\{ x: moved\.x, y: moved\.y \}\);/);
});
