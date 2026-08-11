import { normalizeGameSnapshot } from '../../vtt-contracts/src/index.js';

export class FoundryAdapter {
  constructor(api) {
    if (!api) throw new TypeError('api do Foundry é obrigatória.');
    this.api = api;
  }

  async sync() {
    const activeScene = await this.api.getActiveScene();
    if (!activeScene) throw new Error('Nenhuma cena ativa no Foundry.');
    return normalizeGameSnapshot({
      activeScene,
      campaign: await this.api.getCampaignMetadata?.(),
      visibleActors: await this.api.getVisibleActors?.(activeScene.id) ?? [],
      sceneJournal: await this.api.getLinkedSceneJournal?.(activeScene.id) ?? null,
      metadata: { adapter: 'foundry' }
    });
  }
}
