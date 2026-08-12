function registryError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value) {
  return String(value ?? '').trim();
}

const LEGACY_KEY = '__legacy__';

function listActiveSessions(campaignService) {
  if (typeof campaignService.listActiveSessions === 'function') {
    return campaignService.listActiveSessions();
  }
  const campaigns = campaignService.repository?.snapshot?.().campaigns ?? [];
  return campaigns
    .filter((campaign) => campaign?.activeSession?.sessionId)
    .map((campaign) => ({
      campaignId: campaign.id,
      ...structuredClone(campaign.activeSession)
    }));
}

export class CampaignRuntimeRegistry {
  constructor({ runtimeFactory, campaignService, realtimeHub = null, logger = console } = {}) {
    if (typeof runtimeFactory !== 'function') throw new TypeError('runtimeFactory é obrigatório.');
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    this.runtimeFactory = runtimeFactory;
    this.campaignService = campaignService;
    this.realtimeHub = realtimeHub;
    this.logger = logger;
    this.entriesByCampaign = new Map();
    this.campaignBySession = new Map();
  }

  async initialize() {
    const activeSessions = listActiveSessions(this.campaignService);
    const restored = [];

    for (const active of activeSessions) {
      const runtime = this.#createRuntime(active.campaignId, active.sessionId);
      try {
        const result = await runtime.restore({
          sessionId: active.sessionId,
          snapshot: active.snapshot,
          startedAt: active.startedAt
        });
        this.#register(active.campaignId, runtime, result.sessionId, true);
        const realtimeSnapshot = this.campaignService.loadRealtimeSnapshot(active.sessionId);
        if (realtimeSnapshot && this.realtimeHub) {
          this.realtimeHub.hydrateSession(active.sessionId, realtimeSnapshot);
        }
        restored.push({ campaignId: active.campaignId, sessionId: active.sessionId, restored: true });
      } catch (error) {
        this.logger.error?.('[Fênix][RuntimeRegistry] falha ao restaurar campanha', {
          campaignId: active.campaignId,
          sessionId: active.sessionId,
          message: error.message
        });
        throw error;
      }
    }

    return { restored, active: restored.length };
  }

  listStatuses() {
    return [...this.entriesByCampaign.entries()].map(([campaignId, entry]) => ({
      ...entry.runtime.getStatus(),
      campaignId: campaignId === LEGACY_KEY ? null : campaignId,
      persistent: entry.persistent
    }));
  }

  getStatus(selector = {}) {
    const entry = this.#resolveEntry(selector, { required: false });
    if (entry) {
      return {
        ...entry.runtime.getStatus(),
        campaignId: entry.campaignId === LEGACY_KEY ? null : entry.campaignId,
        persistent: entry.persistent
      };
    }

    const campaignId = text(selector?.campaignId);
    const sessionId = text(selector?.sessionId);
    if (campaignId || sessionId) {
      return { state: 'IDLE', sessionId: null, campaignId: campaignId || null, persistent: Boolean(campaignId) };
    }

    const statuses = this.listStatuses().filter((item) => item.sessionId);
    if (statuses.length === 1) return statuses[0];
    if (statuses.length === 0) return { state: 'IDLE', sessionId: null, campaignId: null, activeSessions: 0 };
    return {
      state: 'MULTI_SESSION',
      sessionId: null,
      campaignId: null,
      activeSessions: statuses.length,
      sessions: statuses
    };
  }

  async start(input = {}) {
    const campaignId = text(input.campaignId ?? input.snapshot?.metadata?.campaignId);
    const key = campaignId || LEGACY_KEY;
    const existing = this.entriesByCampaign.get(key);
    if (existing?.runtime.getStatus()?.sessionId) {
      throw registryError('Esta campanha já possui uma sessão ativa.', 'SESSION_ALREADY_ACTIVE', 409);
    }

    if (campaignId && !this.campaignService.getRaw(campaignId)) {
      throw registryError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    }

    const runtime = this.#createRuntime(key, null);
    const snapshot = input.snapshot ?? input;
    const result = await runtime.start({ snapshot });

    if (campaignId) {
      await this.campaignService.setActiveSession(campaignId, {
        sessionId: result.sessionId,
        snapshot,
        startedAt: new Date().toISOString()
      });
    }

    this.#register(key, runtime, result.sessionId, Boolean(campaignId));
    return { ...result, campaignId: campaignId || null };
  }

  processAction(input = {}) {
    const entry = this.#resolveEntry(input);
    return entry.runtime.processAction(input);
  }

  describeRoom(input = {}) {
    const entry = this.#resolveEntry(input);
    return entry.runtime.describeRoom(input);
  }

  async end(input = {}) {
    const entry = this.#resolveEntry(input);
    const status = entry.runtime.getStatus();
    const result = await entry.runtime.end();

    if (status.sessionId && entry.persistent) {
      await this.campaignService.clearActiveSessionBySessionId(status.sessionId);
      await this.campaignService.clearRealtimeSnapshot(status.sessionId);
    }

    if (status.sessionId) this.campaignBySession.delete(status.sessionId);
    this.entriesByCampaign.delete(entry.campaignId);
    return {
      ...result,
      campaignId: entry.campaignId === LEGACY_KEY ? null : entry.campaignId
    };
  }

  async persistRealtimeSessions() {
    if (!this.realtimeHub) return 0;
    let persisted = 0;
    for (const entry of this.entriesByCampaign.values()) {
      const sessionId = entry.runtime.getStatus()?.sessionId;
      if (!sessionId) continue;
      await this.realtimeHub.persistSession(sessionId);
      persisted += 1;
    }
    return persisted;
  }

  #createRuntime(campaignId, sessionId) {
    const runtime = this.runtimeFactory({
      campaignId: campaignId === LEGACY_KEY ? null : campaignId,
      sessionId: sessionId || null
    });
    const required = ['start', 'restore', 'processAction', 'describeRoom', 'end', 'getStatus'];
    for (const method of required) {
      if (typeof runtime?.[method] !== 'function') {
        throw new TypeError(`runtimeFactory deve produzir runtime.${method}().`);
      }
    }
    return runtime;
  }

  #register(campaignId, runtime, sessionId, persistent) {
    const key = campaignId || LEGACY_KEY;
    const entry = { campaignId: key, runtime, persistent: Boolean(persistent) };
    this.entriesByCampaign.set(key, entry);
    if (sessionId) this.campaignBySession.set(String(sessionId), key);
    return entry;
  }

  #resolveEntry(selector = {}, { required = true } = {}) {
    const campaignId = text(selector?.campaignId);
    const sessionId = text(selector?.sessionId);
    let key = campaignId || null;
    if (!key && sessionId) key = this.campaignBySession.get(sessionId) ?? null;

    if (!key && !campaignId && !sessionId) {
      if (this.entriesByCampaign.size === 1) key = this.entriesByCampaign.keys().next().value;
      else if (this.entriesByCampaign.has(LEGACY_KEY)) key = LEGACY_KEY;
    }

    const entry = key ? this.entriesByCampaign.get(key) ?? null : null;
    if (!entry && required) {
      throw registryError('Sessão narrativa não está ativa para esta campanha.', 'SESSION_NOT_ACTIVE', 409);
    }
    return entry;
  }
}
