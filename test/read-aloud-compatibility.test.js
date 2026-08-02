import test from 'node:test';
import assert from 'node:assert/strict';
import {
  READ_ALOUD_SELECTORS,
  extractMarkdownReadAloud
} from '../apps/foundry-module/scripts/read-aloud.js';

test('seletores cobrem formatos antigo e atual do Plutonium/5eTools', () => {
  assert.ok(READ_ALOUD_SELECTORS.includes('.ve-rd__b-inset--readaloud'));
  assert.ok(READ_ALOUD_SELECTORS.includes('.rd__b-inset--readaloud'));
  assert.ok(READ_ALOUD_SELECTORS.includes('.read-aloud'));
  assert.ok(READ_ALOUD_SELECTORS.includes('[data-read-aloud]'));
});

test('extrai somente o primeiro bloco de citação Markdown', () => {
  const result = extractMarkdownReadAloud([
    '# Entrada',
    'Texto reservado fora da citação.',
    '> A porta se abre para uma câmara silenciosa.',
    '> Poeira cobre o piso de pedra.',
    '',
    'Informação do mestre que não pode ser enviada.'
  ].join('\n'), { pageLabel: 'Entrada' });

  assert.equal(result?.content, 'A porta se abre para uma câmara silenciosa. Poeira cobre o piso de pedra.');
  assert.doesNotMatch(result?.content ?? '', /Informação do mestre/);
});

test('restringe Markdown à seção da sala numerada', () => {
  const result = extractMarkdownReadAloud([
    '# 3. Corredor',
    '> Esta descrição pertence à sala três.',
    '# 4. Cripta',
    '> Esta descrição pertence à sala quatro.',
    'Segredo fora da citação.'
  ].join('\n'), { sectionLabel: '4', pageLabel: 'Redbrand Hideout' });

  assert.equal(result?.areaName, '4. Cripta');
  assert.equal(result?.content, 'Esta descrição pertence à sala quatro.');
});

test('não usa citação de página que não corresponde à sala', () => {
  const result = extractMarkdownReadAloud('> Descrição de outra área.', {
    sectionLabel: '7',
    pageLabel: '3. Corredor'
  });
  assert.equal(result, null);
});
