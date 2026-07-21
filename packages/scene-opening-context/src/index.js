function text(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeName(value) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\((player|gm|jogador|mestre)\s*version\)/gi, '')
    .replace(/\b(player|gm|jogador|mestre)\s*version\b/gi, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function isRelatedName(sceneName, candidateName) {
  const scene = normalizeName(sceneName);
  const candidate = normalizeName(candidateName);
  if (!scene || !candidate) return false;
  return scene === candidate || (scene.length >= 5 && candidate.includes(scene)) ||
    (candidate.length >= 5 && scene.includes(candidate));
}

function isReadAloudExtraction(page) {
  return ['STRUCTURED_READ_ALOUD', 'DIRECT_JOURNAL_READ_ALOUD'].includes(text(page?.extractionMode));
}

export class SceneOpeningContextBuilder {
  constructor({ logger = console, maxSourceCharacters = 5000 } = {}) {
    this.logger = logger;
    this.maxSourceCharacters = maxSourceCharacters;
  }

  build(context = {}) {
    const scene = context.scene ?? {};
    const journal = context.sceneJournal ?? null;
    const page = context.scenePage ?? journal?.selectedPage ?? null;

    const sceneDescription = text(scene.description);
    const explicitLink = Boolean(journal?.explicitLink);
    const pageRelated = Boolean(page) && (
      explicitLink || page.sectionMatchedScene || isRelatedName(scene.name, page.name) || isRelatedName(scene.name, journal?.name)
    );
    const safeReadAloud = pageRelated && isReadAloudExtraction(page) && Boolean(text(page.content));

    let sourceType = 'SCENE_ONLY';
    let sourceName = scene.name || 'Cena ativa';
    let sourceText = '';

    if (safeReadAloud) {
      sourceType = explicitLink ? 'SCENE_CONFIGURED_PAGE' : 'LINKED_PAGE';
      sourceName = page.name || journal?.name || sourceName;
      sourceText = text(page.content);
    }

    sourceText = sourceText.slice(0, this.maxSourceCharacters);
    const visibleActors = (context.visibleActors ?? []).slice(0, 8).map((actor) => ({
      id: actor.id,
      name: actor.name,
      type: actor.type
    }));

    const result = {
      scene: {
        id: scene.id,
        name: scene.name,
        description: sceneDescription,
        darkness: scene.darkness ?? 0
      },
      source: {
        type: sourceType,
        name: sourceName,
        text: sourceText,
        explicitLink,
        linkSource: journal?.linkSource ?? null,
        sectionMatchedScene: Boolean(page?.sectionMatchedScene),
        sceneSectionName: text(page?.sceneSectionName),
        areaName: text(page?.areaName),
        extractionMode: text(page?.extractionMode),
        canonicalAnchor: safeReadAloud
      },
      visibleActors,
      constraints: {
        revealOnlyObservableFacts: true,
        neverQuoteSourceDirectly: true,
        neverMentionBookOrJournal: true,
        sourceIsCanonicalAnchor: true,
        enrichWithoutInventingHiddenFacts: true,
        varyNarrativeStructureAcrossSessions: true
      }
    };

    this.logger.info?.('[Mestre Orc][OpeningContext] contexto da cena preparado', {
      scene: scene.name,
      sourceType,
      sourceName,
      extractionMode: result.source.extractionMode,
      sourceCharacters: sourceText.length,
      visibleActors: visibleActors.length
    });
    return result;
  }
}

export function createSceneOpeningContextBuilder(options) {
  return new SceneOpeningContextBuilder(options);
}
