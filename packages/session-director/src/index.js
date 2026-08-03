import { SessionState } from '../../core/src/index.js';
import { NPCCoordinator } from '../../npc-coordinator/src/index.js';
import { WorldStateService } from '../../world-state/src/index.js';
import { InMemoryCampaignMemory } from '../../memory/src/index.js';
import { CombatService } from '../../combat-service/src/index.js';

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
    adventureLibrary = null,
    combatService = null,
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
    this.adventureLibrary = adventureLibrary;
    this.combatService = combatService ?? new CombatService({ logger });
    this.audioNarrationService = audioNarrationService;
    this.logger = logger;
    this.state = SessionState.IDLE;
    this.session = null;
  }

  async withAdventureContext(context, query, { limit = 4 } = {}) {
    if (!this.adventureLibrary?.contextForNarration) return context;
    const campaignId = shortId(context?.campaign?.worldId ?? context?.campaign?.id ?? this.session?.campaignId) || 'default';
    const searchQuery = cleanText(query, 1200);
    if (!searchQuery) return { ...context, adventure: { query: '', references: [], characterCount: 0 } };
    try {
      const adventure = await this.adventureLibrary.contextForNarration(campaignId, searchQuery, { limit });
      return { ...context, adventure };
    } catch (error) {
      this.logger.warn?.('[Mestre Orc][AdventureLibrary] contexto indisponível; seguindo sem referência importada', {
        campaignId, message: error.message
      });
      return { ...context, adventure: { query: searchQuery, references: [], characterCount: 0, unavailable: true } };
    }
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
      combat: this.combatService.status(),
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
      } : null,
      adventureLibrary: this.session?.adventureSummary ?? null
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
      this.combatService.reset();
      const raw = await this.foundryAdapter.sync();
      const normalizedContext = this.contextBuilder.build(raw);
      const campaignId = shortId(normalizedContext.campaign?.worldId ?? normalizedContext.campaign?.id) || 'default';
      const restoredMemory = await this.campaignMemory.load(normalizedContext.campaign ?? campaignId);
      const baseContext = {
        ...normalizedContext,
        memory: this.campaignMemory.contextForNarration(restoredMemory)
      };
      const adventureSummary = this.adventureLibrary?.list
        ? await this.adventureLibrary.list(campaignId)
        : null;
      const openingQuery = [
        baseContext.scene?.name,
        baseContext.scene?.description,
        baseContext.source?.areaName,
        baseContext.source?.sceneSectionName
      ].filter(Boolean).join(' ');
      const context = await this.withAdventureContext(baseContext, openingQuery, { limit: 3 });
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
        adventureSummary,
        startedAt: new Date().toISOString(),
        round: createRound(nextRoundNumber),
        idempotency: {
          actions: { results: new Map(), pending: new Map() },
          rounds: { results: new Map(), pending: new Map() },
          rooms: { results: new Map(), pending: new Map() },
          combatActions: { results: new Map(), pending: new Map() },
          combatTurns: { results: new Map(), pending: new Map() },
          combatRounds: { results: new Map(), pending: new Map() }
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
        combat: this.combatService.status(),
        worldState: this.worldStateService.snapshot(),
        memory: this.campaignMemory.summary(memory),
        adventureLibrary: adventureSummary
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
        if (this.combatService.status().active) throw new Error('Há um combate ativo; registre a ação pelo Combat Tracker.');
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
      if (this.combatService.status().active) throw new Error('Há um combate ativo; resolva o turno pelo Combat Tracker.');
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
        const baseContext = {
          ...normalizedContext,
          memory: this.campaignMemory.contextForNarration(this.session.memory)
        };
        const context = await this.withAdventureContext(
          baseContext,
          [baseContext.scene?.name, ...declarations.map((entry) => entry.content)].filter(Boolean).join(' '),
          { limit: 4 }
        );
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


  async syncCombat(input = {}) {
    if (!this.session) throw new Error('Inicie a sessão antes de sincronizar o combate.');
    if (this.state !== SessionState.COLLECTING_ACTIONS) throw new Error('A sessão não está pronta para sincronizar o combate.');
    const combat = this.combatService.sync(input);
    return { state: this.state, sessionId: this.session.id, combat };
  }

  async processCombatAction(input = {}) {
    if (!this.session) throw new Error('Inicie a sessão antes de registrar ações de combate.');
    const eventKey = String(input?.eventId ?? '').trim();
    return this.runOnce('combatActions', eventKey, async () => {
      if (this.state !== SessionState.COLLECTING_ACTIONS) throw new Error('A sessão não está pronta para receber ações de combate.');
      const result = this.combatService.registerAction(input);
      return { state: this.state, sessionId: this.session.id, ...result };
    });
  }

  async resolveCombatTurn(input = {}) {
    if (!this.session) throw new Error('Inicie a sessão antes de resolver o turno.');
    const status = this.combatService.status();
    if (!status.active) throw new Error('Nenhum combate ativo foi sincronizado.');
    const reference = {
      combatId: input.combatId ?? status.combatId,
      round: input.round ?? status.round,
      turn: input.turn ?? status.turn,
      combatantId: input.combatantId ?? status.activeCombatant?.id,
      actorId: input.actorId ?? status.activeCombatant?.actorId,
      actorName: input.actorName ?? status.activeCombatant?.name
    };
    const eventKey = String(input.eventId ?? `combat-turn:${reference.combatId}:${reference.round}:${reference.turn}:${reference.combatantId}`).trim();
    return this.runOnce('combatTurns', eventKey, async () => {
      const actions = this.combatService.actionsForTurn(reference);
      if (!actions.length) throw new Error('Nenhuma ação foi registrada neste turno.');
      const existingTurn = this.combatService.getTurn(reference);
      if (existingTurn?.resolved) throw new Error('Este turno já foi resolvido.');

      try {
        const normalizedContext = this.contextBuilder.build({
          ...this.session.context,
          messages: actions.map((entry) => ({ id: entry.id, actorId: entry.actorId, content: entry.content }))
        });
        const combatContext = {
          ...normalizedContext,
          memory: this.campaignMemory.contextForNarration(this.session.memory),
          combat: this.combatService.status()
        };
        const context = await this.withAdventureContext(
          combatContext,
          [combatContext.scene?.name, ...actions.map((entry) => entry.content), ...actions.map((entry) => entry.itemName)].filter(Boolean).join(' '),
          { limit: 3 }
        );
        this.state = SessionState.RESOLVING;
        const resolutions = [];
        for (const action of actions) {
          const declaration = {
            id: action.id, eventId: action.eventId, actorId: action.actorId, actorName: action.actorName,
            tokenId: action.tokenId, content: action.content, declaredAt: action.declaredAt
          };
          const intent = await this.intentInterpreter.interpret(declaration);
          const rules = await this.rulesService.resolve({ intent, context });
          rules.combat = {
            economyType: action.economyType, itemId: action.itemId, itemName: action.itemName,
            targetIds: action.targetIds, source: action.source, roll: action.roll
          };
          if (action.roll?.authoritative) {
            rules.result.roll = { ...action.roll };
            rules.result.authoritative = true;
            rules.result.pendingMasterDecision = false;
          }
          const relationship = await this.relationshipService.resolve({ intent, context });
          resolutions.push({ action, declaration, intent, rules, relationship });
        }

        this.state = SessionState.NARRATING;
        const narration = await this.narrationService.narrateCombatTurn({
          combat: this.combatService.status(),
          turn: { ...reference, key: existingTurn?.key ?? null },
          resolutions,
          context
        });
        const audio = this.audioNarrationService?.createDirective(narration, {
          sceneId: context.scene?.id ?? null, sessionId: this.session.id
        }) ?? null;
        await this.foundryPublisher.postNarration(narration);
        const turn = this.combatService.markTurnResolved(reference, {
          actions, resolutions, narration, audio
        });
        const memory = typeof this.campaignMemory.recordCombatTurn === 'function'
          ? await this.campaignMemory.recordCombatTurn({
              campaign: context.campaign ?? this.session.campaignId, eventId: eventKey, sessionId: this.session.id,
              combat: this.combatService.status(), turn: reference, resolutions, narration, context,
              worldState: this.worldStateService.snapshot()
            })
          : this.session.memory;
        this.session.memory = memory;
        this.session.context = { ...context, memory: this.campaignMemory.contextForNarration(memory) };
        this.state = SessionState.COLLECTING_ACTIONS;
        return {
          state: this.state, sessionId: this.session.id, combat: this.combatService.status(),
          resolvedTurn: reference, actions, resolutions, narration, audio, turn,
          memory: this.campaignMemory.summary(memory)
        };
      } catch (error) {
        this.state = this.session ? SessionState.COLLECTING_ACTIONS : SessionState.IDLE;
        this.logger.error?.('[Mestre Orc][Combat] falha ao resolver turno', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async summarizeCombatRound(input = {}) {
    if (!this.session) throw new Error('Inicie a sessão antes de resumir o combate.');
    const status = this.combatService.status();
    if (!status.active) throw new Error('Nenhum combate ativo foi sincronizado.');
    const roundNumber = Math.max(0, Number(input.round ?? status.round) || 0);
    const eventKey = String(input.eventId ?? `combat-round:${status.combatId}:${roundNumber}`).trim();
    return this.runOnce('combatRounds', eventKey, async () => {
      const turns = this.combatService.resolvedTurns(roundNumber);
      if (!turns.length) throw new Error('Nenhum turno resolvido está disponível para resumir esta rodada.');
      const roundStatus = this.combatService.roundStatus(roundNumber);
      if (roundStatus.summarized) throw new Error('Esta rodada de combate já foi resumida.');
      try {
        const combatRoundContext = {
          ...this.session.context,
          memory: this.campaignMemory.contextForNarration(this.session.memory),
          combat: status
        };
        const context = await this.withAdventureContext(
          combatRoundContext,
          [combatRoundContext.scene?.name, ...turns.flatMap((turn) => (turn.actions ?? []).map((action) => action.content))].filter(Boolean).join(' '),
          { limit: 3 }
        );
        this.state = SessionState.NARRATING;
        const narration = await this.narrationService.narrateCombatRound({
          combat: status, roundNumber, turns, context
        });
        const audio = this.audioNarrationService?.createDirective(narration, {
          sceneId: context.scene?.id ?? null, sessionId: this.session.id
        }) ?? null;
        await this.foundryPublisher.postNarration(narration);
        const summary = this.combatService.markRoundSummarized(roundNumber, { narration, audio, turnCount: turns.length });
        const memory = typeof this.campaignMemory.recordCombatRound === 'function'
          ? await this.campaignMemory.recordCombatRound({
              campaign: context.campaign ?? this.session.campaignId, eventId: eventKey, sessionId: this.session.id,
              combat: status, roundNumber, turns, narration, context, worldState: this.worldStateService.snapshot()
            })
          : this.session.memory;
        this.session.memory = memory;
        this.session.context = { ...context, memory: this.campaignMemory.contextForNarration(memory) };
        this.state = SessionState.COLLECTING_ACTIONS;
        return {
          state: this.state, sessionId: this.session.id, combat: this.combatService.status(),
          roundNumber, turns, narration, audio, summary, memory: this.campaignMemory.summary(memory)
        };
      } catch (error) {
        this.state = this.session ? SessionState.COLLECTING_ACTIONS : SessionState.IDLE;
        this.logger.error?.('[Mestre Orc][Combat] falha ao resumir rodada', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async endCombat() {
    const combat = this.combatService.end();
    return { state: this.state, sessionId: this.session?.id ?? null, combat };
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
        const roomBaseContext = {
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
        const context = await this.withAdventureContext(
          roomBaseContext,
          [roomBaseContext.scene?.name, roomBaseContext.room?.name, roomBaseContext.source?.text].filter(Boolean).join(' '),
          { limit: 4 }
        );
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
    this.combatService.reset();
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
