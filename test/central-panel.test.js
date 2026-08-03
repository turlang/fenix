import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { centralPanelInternals } from '../apps/foundry-module/scripts/central-panel.js';

const panel = await readFile(new URL('../apps/foundry-module/scripts/central-panel.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../apps/foundry-module/scripts/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../apps/foundry-module/styles/mestre-orc.css', import.meta.url), 'utf8');

const { availableGroups, availableTools, toolDisabledReason } = centralPanelInternals;

test('Central organiza todas as áreas do Marco 15 em navegação única', () => {
  for (const label of ['Visão geral', 'Sessão', 'Narração', 'Combate', 'Campanha', 'Criação', 'Assistentes', 'Sistema']) {
    assert.match(panel, new RegExp(label));
  }
  for (const tool of ['Memória', 'Biblioteca', 'Forja de conteúdo', 'Mapas e Scenes', 'Tutores', 'Automações', 'Provedores de IA', 'Vozes neurais', 'Backup', 'Diagnóstico']) {
    assert.match(panel, new RegExp(tool));
  }
});

test('jogador recebe somente ferramentas permitidas e GM recebe a Central completa', () => {
  const playerGroups = availableGroups(false).map((entry) => entry.id);
  const playerTools = availableTools(false).map((entry) => entry.id);
  assert.deepEqual(playerGroups, ['overview', 'narration', 'assistants']);
  assert.deepEqual(playerTools, ['voice-input', 'toggle-audio', 'tutors']);
  assert.ok(availableTools(true).length > playerTools.length);
  assert.ok(availableGroups(true).some((entry) => entry.id === 'system'));
});

test('ações rápidas respeitam sessão, combate, fila e suporte de voz', () => {
  const state = {
    client: { voiceSupported: true, voiceSessionActive: true },
    server: {
      sessionActive: true,
      combatActive: false,
      roundActionCount: 2,
      combatTurnCanResolve: false,
      combatRoundCanSummarize: false
    }
  };
  const tools = availableTools(true);
  assert.equal(toolDisabledReason(tools.find((entry) => entry.id === 'resolve-round'), state), null);
  assert.match(toolDisabledReason(tools.find((entry) => entry.id === 'combat-turn'), state), /Aguardando eventos/);
  assert.equal(toolDisabledReason(tools.find((entry) => entry.id === 'voice-input'), state), null);
});

test('main injeta apenas a barra compacta e um controle unificado da Scene', () => {
  assert.match(main, /injectCentralButton/);
  assert.match(main, /mestreOrcCentral/);
  assert.match(main, /Central unificada adicionada aos controles da Scene/);
  const schedule = main.slice(main.indexOf('function scheduleInjection'), main.indexOf("debugLog('[Mestre Orc] main.js carregado"));
  assert.match(schedule, /injectCentralButton/);
  assert.match(schedule, /injectAudioToggleButton/);
  assert.match(schedule, /injectVoiceInputButton/);
  assert.doesNotMatch(schedule, /injectMemoryButton/);
  assert.doesNotMatch(schedule, /injectBackupButton/);
  assert.doesNotMatch(schedule, /injectDiagnosticButton/);
});

test('design system possui dock, painel responsivo, estados e redução de movimento', () => {
  assert.match(css, /mestre-orc-command-dock/);
  assert.match(css, /mestre-orc-central-panel/);
  assert.match(css, /mestre-orc-central-sidebar/);
  assert.match(css, /mestre-orc-central-tool-grid/);
  assert.match(css, /@media \(max-width: 620px\)/);
  assert.match(css, /prefers-reduced-motion/);
});
