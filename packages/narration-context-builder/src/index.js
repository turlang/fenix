function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  if (value instanceof Set || value instanceof Map) return [...value.values()];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.contents)) return value.contents;
  if (typeof value === 'object') return Object.values(value);
  return [];
}

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function asId(value) {
  return asText(value?.id ?? value?._id ?? value?.uuid ?? value);
}

export class NarrationContextBuilder {
  constructor({ logger = console } = {}) { this.logger = logger; }

  build(raw = {}) {
    try {
      const sceneSource = raw.activeScene ?? raw.scene ?? {};
      const scene = {
        id: asId(sceneSource),
        name: asText(sceneSource.name, 'Cena sem nome'),
        description: asText(sceneSource.description ?? sceneSource.text ?? sceneSource.notes),
        darkness: Number.isFinite(Number(sceneSource.darkness)) ? Number(sceneSource.darkness) : 0,
        flags: sceneSource.flags && typeof sceneSource.flags === 'object' ? sceneSource.flags : {}
      };

      const actors = asArray(raw.visibleActors ?? raw.actors).map((actor) => ({
        id: asId(actor),
        name: asText(actor?.name, 'Ator sem nome'),
        type: asText(actor?.type, 'npc'),
        system: actor?.system && typeof actor.system === 'object' ? actor.system : {},
        flags: actor?.flags && typeof actor.flags === 'object' ? actor.flags : {}
      })).filter((actor) => actor.id || actor.name);

      const journalSource = raw.sceneJournal ?? raw.journal ?? null;
      const selectedPageSource = journalSource?.selectedPage ?? raw.scenePage ?? null;
      const selectedPage = selectedPageSource ? {
        id: asId(selectedPageSource),
        name: asText(selectedPageSource.name, 'Página da cena'),
        content: asText(selectedPageSource.content ?? selectedPageSource.text ?? selectedPageSource.description),
        sectionMatchedScene: Boolean(selectedPageSource.sectionMatchedScene),
        sceneSectionName: asText(selectedPageSource.sceneSectionName),
        areaName: asText(selectedPageSource.areaName),
        extractionMode: asText(selectedPageSource.extractionMode),
        fullPageContentAvailable: Boolean(selectedPageSource.fullPageContentAvailable),
        flags: selectedPageSource.flags && typeof selectedPageSource.flags === 'object' ? selectedPageSource.flags : {}
      } : null;

      const sceneJournal = journalSource ? {
        id: asId(journalSource),
        name: asText(journalSource.name, 'Journal da cena'),
        content: asText(journalSource.content ?? journalSource.text ?? journalSource.description),
        explicitLink: Boolean(journalSource.explicitLink),
        linkSource: asText(journalSource.linkSource),
        selectedPage,
        flags: journalSource.flags && typeof journalSource.flags === 'object' ? journalSource.flags : {}
      } : null;

      const context = {
        scene,
        campaign: raw.campaign && typeof raw.campaign === 'object' ? raw.campaign : null,
        visibleActors: actors,
        sceneJournal,
        scenePage: selectedPage,
        messages: asArray(raw.messages).map((message) => ({
          id: asId(message),
          userId: asText(message?.userId ?? message?.user?.id),
          actorId: asText(message?.actorId ?? message?.speaker?.actor),
          content: asText(message?.content ?? message?.text)
        })).filter((message) => message.content),
        metadata: {
          normalizedAt: new Date().toISOString(),
          source: 'foundry'
        }
      };

      if (!context.scene.id && !context.scene.name) throw new Error('Cena ativa inválida.');
      this.logger.info?.('[Mestre Orc][Context] contexto normalizado', {
        sceneId: context.scene.id,
        actors: context.visibleActors.length,
        hasJournal: Boolean(context.sceneJournal)
      });
      return context;
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Context] falha ao normalizar', { message: error.message });
      throw error;
    }
  }
}

export function createNarrationContextBuilder(options) {
  return new NarrationContextBuilder(options);
}
