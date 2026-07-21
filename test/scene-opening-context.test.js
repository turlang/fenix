import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneOpeningContextBuilder } from '../packages/scene-opening-context/src/index.js';

test('ignora Journal genérico de introdução não relacionado à cena', () => {
  const builder = new SceneOpeningContextBuilder({ logger: {} });
  const result = builder.build({
    scene: { id: 's1', name: 'Cragmaw Hideout (Player Version)', description: 'Um riacho sai da caverna.' },
    sceneJournal: {
      name: 'Introduction',
      content: 'Este livro foi escrito para o Mestre de Masmorras e contém uma aventura completa.'
    },
    visibleActors: []
  });
  assert.equal(result.source.type, 'SCENE_ONLY');
  assert.equal(result.source.text, '');
  assert.equal(result.source.canonicalAnchor, false);
});

test('prioriza página explicitamente relacionada à cena', () => {
  const builder = new SceneOpeningContextBuilder({ logger: {} });
  const result = builder.build({
    scene: { id: 's1', name: 'Cragmaw Hideout (Player Version)', description: '' },
    sceneJournal: {
      name: 'Lost Mine',
      selectedPage: {
        name: 'Cragmaw Hideout',
        content: 'Um riacho raso emerge da entrada da caverna entre arbustos densos.',
        extractionMode: 'DIRECT_JOURNAL_READ_ALOUD'
      }
    },
    visibleActors: []
  });
  assert.equal(result.source.type, 'LINKED_PAGE');
  assert.match(result.source.text, /riacho raso/i);
});

test('aceita página configurada explicitamente mesmo quando o nome é o capítulo', () => {
  const builder = new SceneOpeningContextBuilder({ logger: {} });
  const result = builder.build({
    scene: { id: 's1', name: 'Cragmaw Hideout (Player Version)', description: '' },
    sceneJournal: {
      name: 'Lost Mine of Phandelver',
      explicitLink: true,
      linkSource: 'scene.flags.monks-enhanced-journal.journalPage',
      selectedPage: {
        name: 'Part 1 — Goblin Arrows',
        content: 'Um riacho raso emerge da entrada da caverna entre arbustos densos.',
        sectionMatchedScene: true,
        extractionMode: 'STRUCTURED_READ_ALOUD'
      }
    },
    visibleActors: []
  });
  assert.equal(result.source.type, 'SCENE_CONFIGURED_PAGE');
  assert.equal(result.source.explicitLink, true);
  assert.match(result.source.text, /riacho raso/i);
});

test('não usa página configurada sem seção da cena quando ela não fornece conteúdo seguro', () => {
  const builder = new SceneOpeningContextBuilder({ logger: {} });
  const result = builder.build({
    scene: { id: 's1', name: 'Cragmaw Hideout (Player Version)', description: 'A entrada da caverna fica diante do grupo.' },
    sceneJournal: {
      name: 'Lost Mine of Phandelver',
      explicitLink: true,
      selectedPage: { name: 'Part 1 — Goblin Arrows', content: '', sectionMatchedScene: false }
    },
    visibleActors: []
  });
  assert.equal(result.source.type, 'SCENE_ONLY');
  assert.equal(result.source.text, '');
  assert.equal(result.source.canonicalAnchor, false);
});
