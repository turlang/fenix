function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function actorKey(actor) {
  return String(actor?.id ?? actor?._id ?? actor?.name ?? '').trim();
}

export class NPCCoordinator {
  constructor({ logger = console } = {}) {
    this.logger = logger;
  }

  async coordinate({ resolutions = [], context = {}, worldState = null } = {}) {
    try {
      const visibleNpcs = (context.visibleActors ?? []).filter((actor) => String(actor?.type ?? '').toLowerCase() === 'npc');
      const npcById = new Map(visibleNpcs.map((npc) => [actorKey(npc), npc]));
      const npcByName = new Map(visibleNpcs.map((npc) => [normalized(npc.name), npc]));
      const reactions = [];

      for (const resolution of resolutions) {
        const relationship = resolution?.relationship ?? {};
        const intent = resolution?.intent ?? {};
        const targetName = normalized(relationship.npcName ?? intent.target);
        const npc = npcById.get(String(relationship.npcId ?? ''))
          ?? npcByName.get(targetName)
          ?? visibleNpcs.find((candidate) => {
            const name = normalized(candidate.name);
            return targetName && (name.includes(targetName) || targetName.includes(name));
          })
          ?? null;
        if (!npc) continue;

        const relationshipType = String(relationship.relationshipType ?? 'NEUTRAL').toUpperCase();
        let reaction = 'observa a ação e mantém sua posição';
        if (intent.type === 'COMBAT' || relationshipType === 'HOSTILE') reaction = 'reage de forma hostil e se prepara para o conflito';
        else if (relationshipType === 'FRIENDLY') reaction = 'responde de maneira receptiva, sem abandonar a cautela';
        else if (intent.type === 'SOCIAL') reaction = 'avalia as palavras antes de responder';
        else if (intent.type === 'INVESTIGATION') reaction = 'acompanha a investigação com atenção';

        reactions.push({
          npcId: actorKey(npc),
          npcName: npc.name,
          triggeredByActorId: resolution?.declaration?.actorId ?? intent.actorId ?? null,
          relationshipType,
          disposition: Number(relationship.disposition) || 0,
          reaction
        });
      }

      const activeNpcIds = new Set(reactions.map((entry) => entry.npcId));
      return {
        mode: 'DETERMINISTIC_COORDINATION',
        sceneId: context.scene?.id ?? null,
        worldRound: Number(worldState?.roundNumber) || 0,
        reactions,
        passiveNpcs: visibleNpcs
          .filter((npc) => !activeNpcIds.has(actorKey(npc)))
          .map((npc) => ({ npcId: actorKey(npc), npcName: npc.name }))
      };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][NPC] falha ao coordenar NPCs', { message: error.message });
      throw error;
    }
  }
}
