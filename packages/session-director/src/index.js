import { SessionState } from '../../core/src/index.js';

function shortId(value) {
  return String(value ?? '').trim().slice(0, 200);
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

export class SessionDirector {
  constructor({ foundryAdapter, contextBuilder, intentInterpreter, rulesService, relationshipService, narrationService, audioNarrationService = null, foundryPublisher, logger = console }) {
    const required = { foundryAdapter, contextBuilder, intentInterpreter, rulesService, relationshipService, narrationService, foundryPublisher };
    for (const [name, service] of Object.entries(required)) if (!service) throw new TypeError(`${name} é obrigatório.`);
    Object.assign(this, required);
    this.audioNarrationService = audioNarrationService;
    this.logger = logger;
    this.state = SessionState.IDLE;
    this.session = null;
  }

  getStatus() { return { state: this.state, sessionId: this.session?.id ?? null, sceneId: this.session?.context?.scene?.id ?? null }; }

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
      const context = this.contextBuilder.build(raw);
      this.state = SessionState.OPENING;
      const sessionId = crypto.randomUUID();
      const opening = await this.narrationService.createOpening(context);
      const audio = this.audioNarrationService?.createDirective(opening, {
        sceneId: context.scene?.id ?? null,
        sessionId
      }) ?? null;
      await this.foundryPublisher.postNarration(opening);
      this.session = {
        id: sessionId,
        context,
        opening,
        audio,
        startedAt: new Date().toISOString(),
        idempotency: {
          actions: { results: new Map(), pending: new Map() },
          rooms: { results: new Map(), pending: new Map() }
        }
      };
      this.state = SessionState.COLLECTING_ACTIONS;
      return { state: this.state, sessionId: this.session.id, opening, audio };
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
        const context = this.contextBuilder.build({ ...this.session.context, messages: [input] });
        const intent = await this.intentInterpreter.interpret(input);
        this.state = SessionState.RESOLVING;
        const rules = await this.rulesService.resolve({ intent, context });
        const relationship = await this.relationshipService.resolve({ intent, context });
        this.state = SessionState.NARRATING;
        const narration = await this.narrationService.narrateResolution({ intent, rules, relationship, context });
        const audio = this.audioNarrationService?.createDirective(narration, {
          sceneId: context.scene?.id ?? this.session.context?.scene?.id ?? null,
          sessionId: this.session.id
        }) ?? null;
        await this.foundryPublisher.postNarration(narration);
        this.state = SessionState.COLLECTING_ACTIONS;
        return { state: this.state, intent, rules, relationship, narration, audio };
      } catch (error) {
        this.state = this.session ? SessionState.COLLECTING_ACTIONS : SessionState.IDLE;
        this.logger.error?.('[Mestre Orc][Session] falha ao processar ação', { message: error.message, stack: error.stack });
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
        return { state: this.state, sessionId: this.session.id, opening, audio, room: context.room };
      } catch (error) {
        this.logger.error?.('[Mestre Orc][Session] falha ao narrar sala', { message: error.message, stack: error.stack });
        throw error;
      }
    });
  }

  async end() {
    const ended = this.session;
    this.session = null;
    this.state = SessionState.ENDED;
    return { state: this.state, sessionId: ended?.id ?? null };
  }
}
