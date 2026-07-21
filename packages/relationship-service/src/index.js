export class RelationshipService {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async resolve({ intent, context }) {
    try {
      const npc = intent.type === 'SOCIAL' ? context.visibleActors.find((actor) => actor.type === 'npc') ?? null : null;
      return { npcId: npc?.id ?? null, disposition: 0 };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Relationship] falha', { message: error.message });
      throw error;
    }
  }
}
