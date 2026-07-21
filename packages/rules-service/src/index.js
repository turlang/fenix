export class RulesService {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async resolve({ intent, context }) {
    try {
      return { required: false, intentType: intent.type, result: null, contextSceneId: context.scene.id };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Rules] falha', { message: error.message });
      throw error;
    }
  }
}
