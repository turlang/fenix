function persistenceError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export class PersistentSessionService {
  constructor({ runtime, campaignService, logger = console } = {}) {
    if (!runtime) throw new TypeError('runtime é obrigatório.');
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    this.runtime = runtime;
    this.campaignService = campaignService;
    this.logger = logger;
    this.campaignId = null;
  }

  async initialize() {
    const active = this.campaignService.findActiveSession();
    if (!active) return { restored: false, ...this.getStatus() };
    try {
      const restored = await this.runtime.restore({
        sessionId: active.sessionId,
        snapshot: active.snapshot,
        startedAt: active.startedAt
      });
      this.campaignId = active.campaignId;
      return { ...restored, campaignId: active.campaignId, restored: true };
    } catch (error) {
      this.logger.error?.('[Fênix][Persistence] falha ao restaurar sessão narrativa', {
        campaignId: active.campaignId,
        sessionId: active.sessionId,
        message: error.message
      });
      throw error;
    }
  }

  getStatus() {
    return {
      ...this.runtime.getStatus(),
      campaignId: this.campaignId
    };
  }

  async start(input = {}) {
    const campaignId = String(input.campaignId ?? input.snapshot?.metadata?.campaignId ?? '').trim() || null;
    const snapshot = input.snapshot ?? input;
    if (campaignId) {
      const campaign = this.campaignService.getRaw(campaignId);
      if (!campaign) throw persistenceError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    }
    const result = await this.runtime.start({ snapshot });
    if (campaignId) {
      await this.campaignService.setActiveSession(campaignId, {
        sessionId: result.sessionId,
        snapshot,
        startedAt: new Date().toISOString()
      });
      this.campaignId = campaignId;
    }
    return { ...result, campaignId };
  }

  processAction(input) {
    return this.runtime.processAction(input);
  }

  describeRoom(roomContext) {
    return this.runtime.describeRoom(roomContext);
  }

  async end() {
    const status = this.runtime.getStatus();
    const result = await this.runtime.end();
    if (status.sessionId) {
      await this.campaignService.clearActiveSessionBySessionId(status.sessionId);
      await this.campaignService.clearRealtimeSnapshot(status.sessionId);
    }
    this.campaignId = null;
    return { ...result, campaignId: null };
  }
}
