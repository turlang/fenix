import { SessionState } from '../../core/src/index.js';

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
      this.session = { id: sessionId, context, opening, audio, startedAt: new Date().toISOString() };
      this.state = SessionState.COLLECTING_ACTIONS;
      return { state: this.state, sessionId: this.session.id, opening, audio };
    } catch (error) {
      this.state = SessionState.IDLE;
      this.logger.error?.('[Mestre Orc][Session] falha ao iniciar', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  async processAction(input) {
    try {
      if (!this.session || this.state !== SessionState.COLLECTING_ACTIONS) throw new Error('Sessão não está pronta para receber ações.');
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
  }

  async end() {
    const ended = this.session;
    this.session = null;
    this.state = SessionState.ENDED;
    return { state: this.state, sessionId: ended?.id ?? null };
  }

  async describeRoom(roomContext) {
    try {
      const context = this.contextBuilder.build({
        ...(this.session?.context ?? {}),
        room: roomContext.room,
        scene: roomContext.scene ?? this.session?.context?.scene,
        source: roomContext.source,
        visibleActors: roomContext.visibleActors ?? this.session?.context?.visibleActors ?? [],
        campaign: roomContext.campaign ?? this.session?.context?.campaign
      });
      const opening = await this.narrationService.describeRoom(context);
      const audio = this.audioNarrationService?.createDirective(opening, {
        sceneId: context.scene?.id ?? null,
        sessionId: this.session?.id ?? null
      }) ?? null;
      await this.foundryPublisher.postNarration(opening);
      return { opening, audio };
    } catch (error) {
      this.logger.error?.('[Mestre Orc][Session] falha ao descrever sala', { message: error.message, stack: error.stack });
      throw error;
    }
  }
}
