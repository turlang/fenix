function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function compactEvent(resolution) {
  const declaration = resolution?.declaration ?? {};
  const intent = resolution?.intent ?? {};
  const rules = resolution?.rules ?? {};
  const relationship = resolution?.relationship ?? {};
  return {
    actorId: declaration.actorId ?? intent.actorId ?? null,
    actorName: declaration.actorName ?? null,
    intentType: intent.type ?? 'GENERAL',
    target: intent.target ?? null,
    effect: rules.result?.effect ?? null,
    adapter: rules.adapter?.systemId ?? 'generic',
    npcId: relationship.npcId ?? null,
    dispositionDelta: Number(relationship.disposition) || 0
  };
}

export class WorldStateService {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.state = null;
  }

  startSession(context = {}, restoredState = null) {
    const restored = restoredState && typeof restoredState === 'object' ? restoredState : {};
    this.state = {
      sessionStartedAt: new Date().toISOString(),
      campaignId: context.campaign?.worldId ?? restored.campaignId ?? null,
      sceneId: context.scene?.id ?? restored.sceneId ?? null,
      sceneName: context.scene?.name ?? restored.sceneName ?? null,
      roundNumber: Math.max(0, Number(restored.roundNumber) || 0),
      completedRounds: Math.max(0, Number(restored.completedRounds) || 0),
      npcRelationships: clone(restored.npcRelationships ?? {}),
      recentEvents: clone(restored.recentEvents ?? []).slice(-50),
      lastNpcReactions: clone(restored.lastNpcReactions ?? []),
      restoredFromMemory: Boolean(restoredState),
      updatedAt: new Date().toISOString()
    };
    return this.snapshot();
  }

  snapshot() {
    return clone(this.state ?? {
      campaignId: null,
      sceneId: null,
      sceneName: null,
      roundNumber: 0,
      completedRounds: 0,
      npcRelationships: {},
      recentEvents: [],
      updatedAt: null
    });
  }

  applyRound({ roundNumber, resolutions = [], npcCoordination = {}, context = {} } = {}) {
    try {
      if (!this.state) this.startSession(context);
      const events = resolutions.map(compactEvent);
      const relationships = { ...(this.state.npcRelationships ?? {}) };
      for (const event of events) {
        if (!event.npcId || !event.dispositionDelta) continue;
        relationships[event.npcId] = (Number(relationships[event.npcId]) || 0) + event.dispositionDelta;
      }
      this.state = {
        ...this.state,
        sceneId: context.scene?.id ?? this.state.sceneId,
        sceneName: context.scene?.name ?? this.state.sceneName,
        roundNumber: Number(roundNumber) || this.state.roundNumber + 1,
        completedRounds: (Number(this.state.completedRounds) || 0) + 1,
        npcRelationships: relationships,
        recentEvents: [...(this.state.recentEvents ?? []), ...events].slice(-50),
        lastNpcReactions: clone(npcCoordination.reactions ?? []),
        updatedAt: new Date().toISOString()
      };
      return this.snapshot();
    } catch (error) {
      this.logger.error?.('[Mestre Orc][WorldState] falha ao aplicar rodada', { message: error.message });
      throw error;
    }
  }
}
