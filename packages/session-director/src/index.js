import { SessionState } from '../../core/src/index.js';
import { assertNarrationOutputPort, assertVttContextPort } from '../../vtt-contracts/src/index.js';

function resolveNarrationOutput(candidate) {
  if (candidate?.publishNarration) return candidate;
  if (candidate?.postNarration) {
    return {
      publishNarration(content, metadata) {
        return candidate.postNarration(content, metadata);
      }
    };
  }
  return candidate;
}

export class SessionDirector {
  constructor({
    contextPort = null,
    narrationOutput = null,
    // Aliases temporários para consumidores alpha.24.
    foundryAdapter = null,
    foundryPublisher = null,
    contextBuilder,
    intentInterpreter,
    rulesService,
    relationshipService,
    narrationService,
    audioNarrationService = null,
    logger = console
  }) {
    const resolvedContextPort = assertVttContextPort(contextPort ?? foundryAdapter);
    const resolvedNarrationOutput = assertNarrationOutputPort(resolveNarrationOutput(narrationOutput ?? foundryPublisher));
    const required = { contextBuilder, intentInterpreter, rulesService, relationshipService, narrationService };
    for (const [name, service] of Object.entries(required)) {
      if (!service) throw new TypeError(`${name} é obrigatório.`);
    }
    this.contextPort = resolvedContextPort;
    this.narrationOutput = resolvedNarrationOutput;
    Object.assign(this, required);
    this.audioNarrationService = audioNarrationService;
    this.logger = logger;
    this.state = SessionState.IDLE;
    this.session = null;
  }

  getStatus() {
    return {
      state: this.state,
      sessionId: this.session?.id ?? null,
      sceneId: this.session?.context?.scene?.id ?? null
    };
  }

  async start() {
    try {
      if (![SessionState.IDLE, SessionState.ENDED].includes(this.state)) {
        throw new Error('Já existe uma sessão em andamento.');
      }
      this.state = SessionState.SYNCING;
      const raw = await this.contextPort.sync();
      const context = this.contextBuilder.build(raw);
      this.state = SessionState.OPENING;
      const sessionId = crypto.randomUUID();
      const opening = await this.narrationService.createOpening(context);
      const audio = this.audioNarrationService?.createDirective(opening, {
        sceneId: context.scene?.id ?? null,
        sessionId
      }) ?? null;
      await this.narrationOutput.publishNarration(opening, {
        type: 'SESSION_OPENING',
        sceneId: context.scene?.id ?? null,
        sessionId
      });
      this.session = { id: sessionId, context, opening, audio, startedAt: new Date().toISOString() };
      this.state = SessionState.COLLECTING_ACTIONS;
      return { state: this.state, sessionId: this.session.id, opening, audio };
    } catch (error) {
      this.state = SessionState.IDLE;
      this.logger.error?.('[Fênix][Session] falha ao iniciar', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  async processAction(input) {
    try {
      if (!this.session || this.state !== SessionState.COLLECTING_ACTIONS) {
        throw new Error('Sessão não está pronta para receber ações.');
      }
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
      await this.narrationOutput.publishNarration(narration, {
        type: 'ACTION_RESOLUTION',
        sceneId: context.scene?.id ?? null,
        sessionId: this.session.id,
        actorId: input?.actorId ?? null
      });
      this.state = SessionState.COLLECTING_ACTIONS;
      return { state: this.state, intent, rules, relationship, narration, audio };
    } catch (error) {
      this.state = this.session ? SessionState.COLLECTING_ACTIONS : SessionState.IDLE;
      this.logger.error?.('[Fênix][Session] falha ao processar ação', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  async describeRoom(roomContext = {}) {
    if (!this.session || this.state !== SessionState.COLLECTING_ACTIONS) {
      throw new Error('Sessão não está pronta para narrar transições de sala.');
    }
    try {
      const normalized = this.contextBuilder.build({
        ...this.session.context,
        scene: roomContext.scene ?? this.session.context.scene,
        campaign: roomContext.campaign ?? this.session.context.campaign,
        visibleActors: roomContext.visibleActors ?? this.session.context.visibleActors
      });
      const context = {
        ...normalized,
        room: { id: roomContext.room?.id ?? null, name: String(roomContext.room?.name ?? '').trim() },
        source: {
          canonicalAnchor: Boolean(roomContext.source?.canonicalAnchor),
          text: String(roomContext.source?.text ?? '').trim(),
          type: roomContext.source?.type ?? 'ROOM_READ_ALOUD',
          extractionMode: roomContext.source?.extractionMode ?? null
        }
      };
      const opening = await this.narrationService.describeRoom(context);
      const audio = this.audioNarrationService?.createDirective(opening, {
        sceneId: context.scene?.id ?? null,
        sessionId: this.session.id
      }) ?? null;
      await this.narrationOutput.publishNarration(opening, {
        type: 'ROOM_ENTRY',
        sceneId: context.scene?.id ?? null,
        roomId: context.room.id,
        sessionId: this.session.id
      });
      return { state: this.state, sessionId: this.session.id, opening, audio, room: context.room };
    } catch (error) {
      this.logger.error?.('[Fênix][Session] falha ao narrar sala', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  async end() {
    const ended = this.session;
    this.session = null;
    this.state = SessionState.ENDED;
    return { state: this.state, sessionId: ended?.id ?? null };
  }
}
