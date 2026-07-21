import test from 'node:test';
import assert from 'node:assert/strict';
import { NarrationContextBuilder } from '../packages/narration-context-builder/src/index.js';
import { SceneOpeningContextBuilder } from '../packages/scene-opening-context/src/index.js';

test('preserva metadados estruturais do vínculo Scene → Journal → Page', () => {
  const normalizer = new NarrationContextBuilder({ logger: {} });
  const normalized = normalizer.build({
    activeScene: { id: 'scene-1', name: 'Cragmaw Hideout (Player Version)' },
    sceneJournal: {
      id: 'journal-1',
      name: 'Lost Mine of Phandelver',
      explicitLink: true,
      linkSource: 'scene.flags.ambience.journalPage',
      selectedPage: {
        id: 'page-1',
        name: 'Part 1 — Goblin Arrows',
        content: 'Um riacho raso sai da caverna entre espinheiros densos.',
        sectionMatchedScene: true,
        sceneSectionName: 'Cragmaw Hideout',
        areaName: '1. Cave Mouth',
        extractionMode: 'STRUCTURED_READ_ALOUD',
        fullPageContentAvailable: true
      }
    }
  });

  assert.equal(normalized.sceneJournal.explicitLink, true);
  assert.equal(normalized.sceneJournal.linkSource, 'scene.flags.ambience.journalPage');
  assert.equal(normalized.scenePage.sectionMatchedScene, true);
  assert.equal(normalized.scenePage.sceneSectionName, 'Cragmaw Hideout');
  assert.equal(normalized.scenePage.areaName, '1. Cave Mouth');
  assert.equal(normalized.scenePage.extractionMode, 'STRUCTURED_READ_ALOUD');

  const opening = new SceneOpeningContextBuilder({ logger: {} }).build(normalized);
  assert.equal(opening.source.type, 'SCENE_CONFIGURED_PAGE');
  assert.match(opening.source.text, /riacho raso/i);
});
