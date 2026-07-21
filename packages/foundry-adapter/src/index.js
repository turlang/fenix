export class FoundryAdapter {
  constructor(api) { this.api = api; }
  async sync() {
    const activeScene = await this.api.getActiveScene();
    if (!activeScene) throw new Error('Nenhuma cena ativa no Foundry.');
    return {
      activeScene,
      campaign: await this.api.getCampaignMetadata?.(),
      visibleActors: await this.api.getVisibleActors?.(activeScene.id) ?? [],
      sceneJournal: await this.api.getLinkedSceneJournal?.(activeScene.id) ?? null
    };
  }
}
