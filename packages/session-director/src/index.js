import { SessionState } from '../../core/src/index.js';
import { NPCCoordinator } from '../../npc-coordinator/src/index.js';
import { WorldStateService } from '../../world-state/src/index.js';
import { InMemoryCampaignMemory } from '../../memory/src/index.js';

function shortId(value) {
  return String(value ?? '').trim().slice(0, 200);
}

function cleanText(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function normalizeRoomPerception(value, visibleActorCount = 0) {
  const source = value && typeof value === 'object' ? value : {};
  const blinded = Boolean(source.blinded);
  const sourceKinds = new Set(['LIGHT', 'FOV', 'SHAPE', 'LOS']);
  const requestedSourceKind = sourceKinds.has(source.sourceKind) ? source.sourceKind : 'NONE';
  const visionAvailable = Boolean(source.visionAvailable) && !blinded && requestedSourceKind !== 'NONE';
  const sourceKind = visionAvailable ? requestedSourceKind : 'NONE';
  return {
    mode: visionAvailable ? 'TOKEN_VISION' : 'CANONICAL_ONLY',
    observer: {
      tokenId: shortId(source.observer?.tokenId),
      actorId: shortId(source.observer?.actorId)
    },
    visionAvailable,
    blinded,
    sourceKind,
    limitedToLineOfSight: true,
    visibleActorCount: Math.max(0, Number(visibleActorCount) || 0)
  };
}

function createRound(number = 1) {
  return {
    number,
    openedAt: new Date().toISOString(),
    actionsByActor: new Map()
  };
}

function declarationFrom(input = {}) {
  const actorId = shortId(input.actorId);
  const content = cleanText(input.content);
  if (!actorId) throw new Error('A declaração precisa estar vinculada a um personagem.');
  if (!content) throw new Error('Ação vazia.');
  return {
    id: shortId(input.eventId) || crypto.randomUUID(),
    eventId: shortId(input.eventId) || null,
    actorId,
    actorName: cleanText(input.actorName, 300) || null,
    tokenId: shortId(input.tokenId) || null,
    content,
    declaredAt: new Date().toISOString()
  };
}

export class SessionDirector {
  constructor({
    foundryAdapter,
    contextBuilder,
    intentInterpreter,
    rulesService,
    relationshipService,
    narrationService,
    npcCoordinator = null,
    worldStateService = null,
    campaignMemory = null,
    audioNarrationService = null,
    foundryPublisher,
    logger = console
  }) {
    const required = { foundryAdapter, contextBuilder, intentInterpreter, rulesService, relationshipService, narrationService, foundryPublisher };
    for (const [name, service] of Object.entries(required)) if (!service) throw new TypeError(`${name} é obrigatório.`);
    Object.assign(this, required);
    this.npcCoordinator = npcCoordinator ?? new NPCCoordinator({ logger });
    this.worldStateService = worldStateService ?? new WorldStateService({ logger });
    this.campaignMemory = campaignMemory ?? new InMemoryCampaignMemory({ logger });
    this.audioNarrationService = audioNarrationService;
    this.logger = logger;
    this.state = SessionState.IDLE;
    this.session = null;
  }

  roundStatus() {
    const round = this.session?.round;
    if (!round) return null;
    const declarations = [...round.actionsByActor.values()];
    return {
      number: round.number,
      openedAt: round.openedAt,
      actionCount: declarations.length,
      actorIds: declarations.map((entry) => entry.actorId),
      declarations: declarations.map((entry) => ({
        actorId: entry.actorId,
        actorName: entry.actorName,
        tokenId: entry.tokenId,
        declaredAt: entry.declaredAt
      })),
      canResolve: declarations.length > 0
    };
  }

  getStatus() {
    const worldState = this.session ? this.worldStateService.snapshot() : null;
    const memory = this.session?.memory ? this.campaignMemory.summary(this.session.memory) : null;
    return {
      state: this.state,
      sessionId: this.session?.id ?? null,
      sceneId: this.session?.context?.scene?.id ?? null,
      campaignId: this.session?.campaignId ?? null,
      round: this.roundStatus(),
      worldState: worldState ? {
        sceneId: worldState.sceneId,
        roundNumber: worldState.roundNumber,
        completedRounds: worldState.completedRounds,
        restoredFromMemory: Boolean(worldState.restoredFromMemory),
        updatedAt: worldState.updatedAt
      } : null,
      memory: memory ? {
        campaignId: memory.campaignId,
        counts: memory.counts,
        updatedAt: memory.updatedAt
      } : null
    };
  }

  async runOnce(bucketName, eventKey, operation) {
    const key = String(eventKey ?? '').trim();
    const bucket = this.session?.idempotency?.[bucketName];
    if (!key || !bucket) return { ...(await operation()), duplicate: false };
    if (bucket.results.has(key)) return { ...bucket.results.get(key), duplicate: true };
    if (bucket.pending.has(key)) return { ...(await bucket.pending.get(key)), duplicate: true };

    const pending = Promise.resolve().then(operation);
    bucket.pending.set(key, pending);
    try {
      const result = await pending;
      bucket.results.set(key, result);
      return { ...result, duplicate: false };
    } finally {
      bucket.pending.delete(key);
    }
  }

  async start() {
    try {
      if (![SessionState.IDLE, SessionState.ENDED].includes(this.state)) throw new Error('Já existe uma sessão em andamento.');
      this.state = SessionState.SYNCING;
      const raw = await this.foundryAdapter.sync();
      const normalizedContext = this.contextBuilder.build(raw);
      const campaignId = shortId(normalizedContext.campaign?.worldId ?? normalizedContext.campaign?.id) || 'default';
      const restoredMemory = await this.campaignMemory.load(normalizedContext.campaign ?? campaignId);
      const context = {
        ...normalizedContext,
        memory: this.campaignMemory.contextForNarration(restoredMemory)
      };
      this.state = SessionState.OPENING;
      const sessionId = crypto.randomUUID();
      const restoredWorldState = restoredMemory.worldState ?? null;
      const worldState = this.worldStateService.startSession(context, restoredWorldState);
      const opening = await this.narrationService.createOpening(context);
      const audio = this.audioNarrationService?.createDirective(opening, {
        sceneId: context.scene?.id ?? null,
        sessionId
      }) ?? null;
      await this.foundryPublisher.postNarration(opening);
      const memory = await this.campaignMemory.startSession({
        campaign: context.campaign ?? campaignId,
        sessionId,
        context,
        worldState
      });
      const nextRoundNumber = Math.max(1, Number(worldState.completedRounds) + 1);
      this.session = {
        id: sessionId,
        campaignId,
        context: { ...context, memory: this.campaignMemory.contextForNarration(memory) },
        memory,
        opening,
        audio,
        startedAt: new Date().toISOString(),
        round: createRound(nextRoundNumber),
        idempotency: {
          actions: { results: new Map(), pending: new Map() },
          rounds: { results: new Map(), pending: new Map() },
          rooms: { results: new Map(), pending: new Map() }
        }
      };
      this.state = SessionState.COLLECTING_ACTIONS;
      return {
        state: this.state,
        sessionId: this.session.id,
        campaignId,
        opening,
        audio,
        round: this.roundStatus(),
        worldState: this.worldStateService.snapshot(),
        memory: this.campaignMemory.summary(memory)
      };
    } catch (error) {
      this.state = SessionState.IDLE;
      this.logger.error?.('[Mestre Orc][Session] falha ao iniciar', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  async processAction(input) {
    if (!this.session) throw new Error('Sessão não está pronta para receber ações.');
    const eventKey = String(input?.eventId ?? '').trim();
    return this.runOnce('actions', eventKey, async () => {
      try {
        if (this.state !== SessionState.COLLECTING_ACTIONS) throw new Error('Sessão não está pronta para receber ações.');
        const declaration = declarationFrom(input);
        const previous = this.session.round.actionsByActor.get(declaration.actorId) ?? null;
        this.session.round.actionsByActor.set(declaration.actorId, declaration);
        return {
          state: this.state,
          sessionId: this.session.id,
          queued: true,
          replaced: Boolean(previous),
          declaration,
          round: this.roundStatus()
        };
      } catch (error) {
        this.logger.error?.('[Mestre Orc][Session] falha ao registrar ação', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async resolveRound(input = {}) {
    if (!this.session) throw new Error('Sessão não está pronta para resolver rodadas.');
    const roundNumber = this.session.round.number;
    const eventKey = String(input?.eventId ?? `round:${this.session.id}:${roundNumber}`).trim();
    return this.runOnce('rounds', eventKey, async () => {
      const declarations = [...this.session.round.actionsByActor.values()]
        .sort((left, right) => left.declaredAt.localeCompare(right.declaredAt));
      if (!declarations.length) throw new Error('Nenhuma ação foi declarada nesta rodada.');
      if (this.state !== SessionState.COLLECTING_ACTIONS) throw new Error('A sessão não está pronta para resolver a rodada.');

      try {
        const normalizedContext = this.contextBuilder.build({
          ...this.session.context,
          messages: declarations.map((entry) => ({
            id: entry.id,
            actorId: entry.actorId,
            content: entry.content
          }))
        });
        const context = {
          ...normalizedContext,
          memory: this.campaignMemory.contextForNarration(this.session.memory)
        };
        this.state = SessionState.RESOLVING;
        const resolutions = [];
        for (const declaration of declarations) {
          const intent = await this.intentInterpreter.interpret(declaration);
          const rules = await this.rulesService.resolve({ intent, context });
          const relationship = await this.relationshipService.resolve({ intent, context });
          resolutions.push({ declaration, intent, rules, relationship });
        }

        const worldStateBefore = this.worldStateService.snapshot();
        const npcCoordination = await this.npcCoordinator.coordinate({
          resolutions,
          context,
          worldState: worldStateBefore
        });
        this.state = SessionState.NARRATING;
        const narration = typeof this.narrationService.narrateRound === 'function'
          ? await this.narrationService.narrateRound({
              roundNumber,
              resolutions,
              npcCoordination,
              worldState: worldStateBefore,
              context
            })
          : await this.narrationService.narrateResolution({
              intent: resolutions[0].intent,
              rules: resolutions[0].rules,
              relationship: resolutions[0].relationship,
              context
            });
        const audio = this.audioNarrationService?.createDirective(narration, {
          sceneId: context.scene?.id ?? this.session.context?.scene?.id ?? null,
          sessionId: this.session.id
        }) ?? null;
        await this.foundryPublisher.postNarration(narration);
        const worldState = this.worldStateService.applyRound({
          roundNumber,
          resolutions,
          npcCoordination,
          context
        });
        const memory = await this.campaignMemory.applyRound({
          campaign: context.campaign ?? this.session.campaignId,
          eventId: eventKey,
          sessionId: this.session.id,
          roundNumber,
          resolutions,
          npcCoordination,
          worldState,
          narration,
          context
        });

        this.session.memory = memory;
        this.session.context = { ...context, memory: this.campaignMemory.contextForNarration(memory) };
        this.session.round = createRound(roundNumber + 1);
        this.state = SessionState.COLLECTING_ACTIONS;
        return {
          state: this.state,
          sessionId: this.session.id,
          resolvedRound: roundNumber,
          declarations,
          resolutions,
          npcCoordination,
          worldState,
          memory: this.campaignMemory.summary(memory),
          narration,
          audio,
          round: this.roundStatus()
        };
      } catch (error) {
        this.state = this.session ? SessionState.COLLECTING_ACTIONS : SessionState.IDLE;
        this.logger.error?.('[Mestre Orc][Session] falha ao resolver rodada', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async describeRoom(roomContext = {}) {
    if (!this.session) throw new Error('Sessão não está pronta para narrar transições de sala.');
    const eventKey = String(roomContext.eventId ?? roomContext.room?.id ?? '').trim();
    return this.runOnce('rooms', eventKey, async () => {
      if (this.state !== SessionState.COLLECTING_ACTIONS) {
        throw new Error('Sessão não está pronta para narrar transições de sala.');
      }
      try {
        const normalized = this.contextBuilder.build({
          ...this.session.context,
          scene: roomContext.scene ?? this.session.context.scene,
          campaign: roomContext.campaign ?? this.session.context.campaign,
          visibleActors: roomContext.visibleActors ?? [],
          narrationExclusions: roomContext.narrationExclusions ?? this.session.context.narrationExclusions
        });
        const perception = normalizeRoomPerception(roomContext.perception, normalized.visibleActors.length);
        if (!perception.visionAvailable) {
          normalized.visibleActors = [];
          perception.visibleActorCount = 0;
        }
        const context = {
          ...normalized,
          memory: this.campaignMemory.contextForNarration(this.session.memory),
          room: { id: roomContext.room?.id ?? null, name: String(roomContext.room?.name ?? '').trim() },
          source: {
            canonicalAnchor: Boolean(roomContext.source?.canonicalAnchor),
            text: String(roomContext.source?.text ?? '').trim(),
            type: roomContext.source?.type ?? 'ROOM_READ_ALOUD',
            extractionMode: roomContext.source?.extractionMode ?? null
          },
          perception
        };
        const opening = await this.narrationService.describeRoom(context);
        const audio = this.audioNarrationService?.createDirective(opening, {
          sceneId: context.scene?.id ?? null,
          sessionId: this.session.id
        }) ?? null;
        await this.foundryPublisher.postNarration(opening);
        const memory = await this.campaignMemory.recordRoomEntry({
          campaign: context.campaign ?? this.session.campaignId,
          eventId: eventKey,
          sessionId: this.session.id,
          room: context.room,
          context,
          narration: opening,
          worldState: this.worldStateService.snapshot()
        });
        this.session.memory = memory;
        this.session.context = { ...this.session.context, memory: this.campaignMemory.contextForNarration(memory) };
        return {
          state: this.state,
          sessionId: this.session.id,
          opening,
          audio,
          room: context.room,
          memory: this.campaignMemory.summary(memory)
        };
      } catch (error) {
        this.logger.error?.('[Mestre Orc][Session] falha ao narrar sala', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async end() {
    const ended = this.session;
    let memory = ended?.memory ?? null;
    if (ended) {
      memory = await this.campaignMemory.endSession({
        campaign: ended.context?.campaign ?? ended.campaignId,
        sessionId: ended.id,
        worldState: this.worldStateService.snapshot()
      });
    }
    this.session = null;
    this.state = SessionState.ENDED;
    return {
      state: this.state,
      sessionId: ended?.id ?? null,
      campaignId: ended?.campaignId ?? null,
      memory: memory ? this.campaignMemory.summary(memory) : null
    };
  }
}
