import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('shell apresenta Mestre Fênix sem diagnósticos internos na experiência principal', async () => {
  const shell = await source('apps/fenix-vtt/components/vtt-shell.jsx');

  assert.match(shell, /Mestre Fênix/);
  assert.match(shell, /Observando a mesa/);
  assert.match(shell, /Console do Mestre Fênix/);
  assert.doesNotMatch(shell, /AI Director/i);
  assert.doesNotMatch(shell, /Shared Core conectado ao Session Gateway/i);
  assert.doesNotMatch(shell, />WS \{state\.realtime\}</);
  assert.doesNotMatch(shell, /Safety <b>ON<\/b>/);
});

test('guardrails visuais escondem HUD técnico e preservam mapa como protagonista', async () => {
  const css = await source('apps/fenix-vtt/app/vtt-experience.css');
  const layout = await source('apps/fenix-vtt/app/layout.js');

  assert.match(css, /\.map-hud-top\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /\.map-camera-toolbar\s*\{[^}]*left:\s*12px\s*!important/s);
  assert.match(css, /flex-direction:\s*column\s*!important/);
  assert.match(layout, /import '\.\/vtt-workspace-layout\.css';\s*\nimport '\.\/vtt-experience\.css';/);
});
