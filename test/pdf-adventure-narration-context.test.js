import assert from 'node:assert/strict';
import test from 'node:test';
import { NarrationContextBuilder } from '../packages/narration-context-builder/src/index.js';
import { SceneOpeningContextBuilder } from '../packages/scene-opening-context/src/index.js';

const silentLogger = { info() {}, warn() {}, error() {} };

test('localized player-safe Adventure Knowledge becomes a canonical narration anchor', () => {
  const contextBuilder = new NarrationContextBuilder({ logger: silentLogger });
  const openingBuilder = new SceneOpeningContextBuilder({ logger: silentLogger });

  const context = contextBuilder.build({
    activeScene: { id: 'scene-cellar', name: '1. Cellar', description: 'Stone cellar' },
    adventureKnowledge: {
      schema: 'fenix.mestre-knowledge-context',
      version: 1,
      adventureId: 'adv-1',
      language: 'pt-BR',
      chunks: [
        {
          id: 'read-1',
          type: 'read-aloud',
          sectionId: 'section-cellar',
          sectionTitle: '1. Cellar',
          text: 'A porta se abre para uma grande adega de pedra.',
          source: { type: 'pdf', documentId: 'pdf-1', page: 12, section: '1. Cellar' }
        },
        {
          id: 'gm-1',
          type: 'gm-note',
          sectionId: 'section-cellar',
          sectionTitle: '1. Cellar',
          text: 'Um cultista espera atrás do pilar.',
          source: { type: 'pdf', documentId: 'pdf-1', page: 12, section: '1. Cellar' }
        }
      ]
    }
  });

  const opening = openingBuilder.build(context);
  assert.equal(opening.source.type, 'ADVENTURE_KNOWLEDGE');
  assert.equal(opening.source.extractionMode, 'SEMANTIC_ADVENTURE_READ_ALOUD');
  assert.equal(opening.source.canonicalAnchor, true);
  assert.equal(opening.source.text, 'A porta se abre para uma grande adega de pedra.');
  assert.equal(opening.source.provenance.page, 12);
  assert.doesNotMatch(opening.source.text, /cultista/i);
});

test('an explicit safe Journal read-aloud remains higher priority than imported knowledge', () => {
  const contextBuilder = new NarrationContextBuilder({ logger: silentLogger });
  const openingBuilder = new SceneOpeningContextBuilder({ logger: silentLogger });

  const context = contextBuilder.build({
    activeScene: { id: 'scene-cellar', name: '1. Cellar' },
    sceneJournal: {
      id: 'journal-1',
      name: '1. Cellar',
      explicitLink: true,
      selectedPage: {
        id: 'page-1',
        name: '1. Cellar',
        content: 'Texto canônico explicitamente vinculado.',
        extractionMode: 'STRUCTURED_READ_ALOUD'
      }
    },
    adventureKnowledge: {
      schema: 'fenix.mestre-knowledge-context',
      version: 1,
      chunks: [{ type: 'read-aloud', sectionTitle: '1. Cellar', text: 'Texto importado alternativo.' }]
    }
  });

  const opening = openingBuilder.build(context);
  assert.equal(opening.source.type, 'SCENE_CONFIGURED_PAGE');
  assert.equal(opening.source.text, 'Texto canônico explicitamente vinculado.');
});
