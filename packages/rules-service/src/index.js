export class RulesService {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async resolve({ intent, context } = {}) {
    try {
      const { type = 'GENERAL', target = null, content = '' } = intent ?? {};
      const effects = {
        COMBAT: target ? `Ataque contra ${target}` : 'Ataque livre',
        INVESTIGATION: `Investigar: ${target ?? 'área'}`,
        SOCIAL: target ? `Interagir com ${target}` : 'Interação social',
        MOVEMENT: `Movimento: ${target ?? 'tranquilamente'}`,
        GENERAL: String(content).slice(0, 100) || 'Ação geral'
      };
      const difficulties = { COMBAT: 12, INVESTIGATION: 8, SOCIAL: 10, MOVEMENT: 5, GENERAL: 10 };
      return {
        required: false,
        intentType: type,
        result: {
          type,
          target,
          difficulty: difficulties[type] ?? 10,
          success: false,
          roll: null,
          effect: effects[type] ?? effects.GENERAL
        },
        contextSceneId: context?.scene?.id ?? null
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Rules] falha', { message: error.message });
      throw error;
    }
  }
}
