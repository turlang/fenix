export class RelationshipService {
  constructor({ logger = console } = {}) { this.logger = logger; }
  async resolve({ intent, context } = {}) {
    try {
      const { type, target } = intent ?? {};
      if (type !== 'SOCIAL' && type !== 'COMBAT') {
        return { npcId: null, npcName: null, disposition: 0, relationshipType: 'NEUTRAL', effect: null };
      }
      const normalizedTarget = String(target ?? '').toLowerCase();
      const npc = normalizedTarget
        ? (context?.visibleActors ?? []).find((actor) => {
            const name = String(actor?.name ?? '').toLowerCase();
            return actor?.type === 'npc' && (name.includes(normalizedTarget) || normalizedTarget.includes(name));
          }) ?? null
        : null;
      const disposition = type === 'COMBAT' && npc ? -20 : type === 'SOCIAL' && npc ? 5 : type === 'SOCIAL' ? 2 : 0;
      const relationshipType = disposition < 0 ? 'HOSTILE' : disposition >= 5 ? 'FRIENDLY' : 'NEUTRAL';
      return {
        npcId: npc?.id ?? null,
        npcName: npc?.name ?? target ?? null,
        disposition,
        relationshipType,
        effect: relationshipType === 'HOSTILE' ? 'Relação deteriorada' :
          relationshipType === 'FRIENDLY' ? 'Relação melhorou' : 'Sem mudança significativa'
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Relationship] falha', { message: error.message });
      throw error;
    }
  }
}
