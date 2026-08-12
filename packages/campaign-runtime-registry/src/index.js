function registryError(message, code, statusCode = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

function text(value) {
  return String(value ?? '').trim();
}

const LEGACY_KEY = '__legacy__';

function listActiveSessions(campaignService) {
  if (typeof campaignService.listActiveSessions === 'function') return campaignService.listActiveSessions();
  const campaigns = campaignService.repository?.snapshot?.().campaigns ?? [];
  return campaigns
    .filter((campaign) => campaign?.activeSession?.sessionId)
    .map((campaign) => ({ campaignId: campaign.id, ...structuredClone(campaign.activeSession) }));
}

function isLeaseHeld(error) {
  return error?.code === 'RUNTIME_LEASE_HELD';
}

export class CampaignRuntimeRegistry {
  constructor({
    runtimeFactory,
    campaignService,
    realtimeHub = null,
    leaseManager = null,
    reconcileIntervalMs = 5000,
    logger = console
  } = {}) {
    if (typeof runtimeFactory !== 'function') throw new TypeError('runtimeFactory é obrigatório.');
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    this.runtimeFactory = runtimeFactory;
    this.campaignService = campaignService;
    this.realtimeHub = realtimeHub;
    this.leaseManager = leaseManager;
    this.reconcileIntervalMs = Math.max(500, Number(reconcileIntervalMs) || 5000);
    this.logger = logger;
    this.entriesByCampaign = new Map();
    this.campaignBySession = new Map();
    this.pendingStarts = new Set();
    this.reconcileTimer = null;
    this.reconcilePromise = null;
  }

  async initialize() {
    const restored = [];
    const remote = [];
    for (const active of listActiveSessions(this.campaignService)) {
      const result = await this.#restoreActive(active);
      if (result?.restored) restored.push(result);
      else if (result?.remote) remote.push(result);
    }
    return { restored, remote, active: restored.length };
  }

  startCoordination() {
    if (!this.leaseManager) return false;
    this.leaseManager.startHeartbeat?.({ onLeaseLost: (lease) => this.handleLeaseLost(lease) });
    if (!this.reconcileTimer) {
      this.reconcileTimer = setInterval(() => {
        this.reconcile().catch((error) => {
          this.logger.error?.('[Fênix][RuntimeRegistry] reconciliação distribuída falhou', { message: error.message });
        });
      }, this.reconcileIntervalMs);
      this.reconcileTimer.unref?.();
    }
    return true;
  }

  async stopCoordination({ releaseLeases = true } = {}) {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    this.leaseManager?.stopHeartbeat?.();
    if (releaseLeases) await this.leaseManager?.releaseAll?.();
  }

  async reconcile({ refreshRepository = true } = {}) {
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = (async () => {
      if (refreshRepository && typeof this.campaignService.repository?.refresh === 'function') {
        await this.campaignService.repository.refresh();
        this.campaignService.refreshFromRepository?.();
      }
      const activeSessions = listActiveSessions(this.campaignService);
      const activeByCampaign = new Map(activeSessions.map((active) => [String(active.campaignId), active]));
      const restored = [];
      const remote = [];

      for (const active of activeSessions) {
        if (this.entriesByCampaign.has(String(active.campaignId))) continue;
        const result = await this.#restoreActive(active);
        if (result?.restored) restored.push(result);
        else if (result?.remote) remote.push(result);
      }

      for (const [key, entry] of [...this.entriesByCampaign.entries()]) {
        if (!entry.persistent || key === LEGACY_KEY) continue;
        const active = activeByCampaign.get(key);
        const status = entry.runtime.getStatus();
        if (!active || (active.sessionId && status.sessionId !== active.sessionId)) {
          this.#evictEntry(key, status.sessionId);
          await this.leaseManager?.release?.(key, entry.leaseGeneration).catch(() => undefined);
        }
      }
      return { restored, remote, localActive: this.listStatuses().filter((item) => item.sessionId).length };
    })().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  listStatuses() {
    return [...this.entriesByCampaign.entries()].map(([campaignId, entry]) => ({
      ...entry.runtime.getStatus(),
      campaignId: campaignId === LEGACY_KEY ? null : campaignId,
      persistent: entry.persistent,
      leaseGeneration: entry.leaseGeneration ?? null
    }));
  }

  getStatus(selector = {}) {
    const entry = this.#resolveEntry(selector, { required: false });
    if (entry) {
      return {
        ...entry.runtime.getStatus(),
        campaignId: entry.campaignId === LEGACY_KEY ? null : entry.campaignId,
        persistent: entry.persistent,
        leaseGeneration: entry.leaseGeneration ?? null
      };
    }

    const campaignId = text(selector?.campaignId);
    const sessionId = text(selector?.sessionId);
    if (campaignId) {
      const campaign = this.campaignService.getRaw?.(campaignId);
      if (campaign?.activeSession?.sessionId) {
        return {
          state: 'REMOTE_ACTIVE',
          sessionId: campaign.activeSession.sessionId,
          campaignId,
          persistent: true,
          remote: true
        };
      }
      return { state: 'IDLE', sessionId: null, campaignId, persistent: true };
    }
    if (sessionId) {
      const campaign = this.campaignService.findCampaignBySessionId?.(sessionId);
      if (campaign) return { state: 'REMOTE_ACTIVE', sessionId, campaignId: campaign.id, persistent: true, remote: true };
      return { state: 'IDLE', sessionId: null, campaignId: null, persistent: false };
    }

    const statuses = this.listStatuses().filter((item) => item.sessionId);
    if (statuses.length === 1) return statuses[0];
    if (statuses.length === 0) return { state: 'IDLE', sessionId: null, campaignId: null, activeSessions: 0 };
    return { state: 'MULTI_SESSION', sessionId: null, campaignId: null, activeSessions: statuses.length, sessions: statuses };
  }

  async start(input = {}) {
    const campaignId = text(input.campaignId ?? input.snapshot?.metadata?.campaignId);
    const key = campaignId || LEGACY_KEY;
    const existing = this.entriesByCampaign.get(key);
    if (existing?.runtime.getStatus()?.sessionId || this.pendingStarts.has(key)) {
      throw registryError('Esta campanha já possui uma sessão ativa ou em inicialização.', 'SESSION_ALREADY_ACTIVE', 409);
    }

    const campaign = campaignId ? this.campaignService.getRaw(campaignId) : null;
    if (campaignId && !campaign) throw registryError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    if (campaign?.activeSession?.sessionId) {
      throw registryError('A campanha já possui sessão persistida em outra instância.', 'SESSION_ACTIVE_REMOTE', 409, {
        sessionId: campaign.activeSession.sessionId
      });
    }

    this.pendingStarts.add(key);
    let lease = null;
    let runtime = null;
    try {
      if (campaignId && this.leaseManager) lease = await this.leaseManager.acquire({ campaignId });
      runtime = this.#createRuntime(key, null);
      const snapshot = input.snapshot ?? input;
      const result = await runtime.start({ snapshot });
      if (campaignId && lease) lease = await this.leaseManager.bindSession(campaignId, lease.generation, result.sessionId);

      if (campaignId) {
        await this.campaignService.setActiveSession(campaignId, {
          sessionId: result.sessionId,
          snapshot,
          startedAt: new Date().toISOString()
        });
      }

      this.#register(key, runtime, result.sessionId, Boolean(campaignId), lease?.generation ?? null);
      return { ...result, campaignId: campaignId || null, leaseGeneration: lease?.generation ?? null };
    } catch (error) {
      if (runtime?.getStatus?.()?.sessionId) await runtime.end?.().catch(() => undefined);
      if (campaignId && lease) await this.leaseManager?.release?.(campaignId, lease.generation).catch(() => undefined);
      throw error;
    } finally {
      this.pendingStarts.delete(key);
    }
  }

  async processAction(input = {}) {
    const entry = this.#resolveEntry(input);
    await this.#assertOwnership(entry);
    return entry.runtime.processAction(input);
  }

  async describeRoom(input = {}) {
    const entry = this.#resolveEntry(input);
    await this.#assertOwnership(entry);
    return entry.runtime.describeRoom(input);
  }

  async end(input = {}) {
    const entry = this.#resolveEntry(input);
    await this.#assertOwnership(entry);
    const status = entry.runtime.getStatus();
    const result = await entry.runtime.end();

    if (status.sessionId && entry.persistent) {
      await this.campaignService.clearActiveSessionBySessionId(status.sessionId);
      await this.campaignService.clearRealtimeSnapshot(status.sessionId);
    }

    this.#evictEntry(entry.campaignId, status.sessionId);
    if (entry.persistent) await this.leaseManager?.release?.(entry.campaignId, entry.leaseGeneration).catch(() => undefined);
    return { ...result, campaignId: entry.campaignId === LEGACY_KEY ? null : entry.campaignId };
  }

  async persistRealtimeSessions() {
    if (!this.realtimeHub) return 0;
    let persisted = 0;
    for (const entry of this.entriesByCampaign.values()) {
      const sessionId = entry.runtime.getStatus()?.sessionId;
      if (!sessionId) continue;
      if (entry.persistent) await this.#assertOwnership(entry);
      await this.realtimeHub.persistSession(sessionId);
      persisted += 1;
    }
    return persisted;
  }

  async handleLeaseLost(lease) {
    const campaignId = text(lease?.campaignId);
    if (!campaignId) return false;
    const entry = this.entriesByCampaign.get(campaignId);
    if (!entry || (lease.generation != null && entry.leaseGeneration !== Number(lease.generation))) return false;
    const sessionId = entry.runtime.getStatus()?.sessionId ?? null;
    this.#evictEntry(campaignId, sessionId);
    this.logger.warn?.('[Fênix][RuntimeRegistry] runtime local removido após perda do lease', {
      campaignId,
      sessionId,
      generation: lease.generation
    });
    return true;
  }

  async #restoreActive(active) {
    const campaignId = text(active?.campaignId);
    const sessionId = text(active?.sessionId);
    if (!campaignId || !sessionId || this.entriesByCampaign.has(campaignId)) return null;
    let lease = null;
    try {
      if (this.leaseManager) lease = await this.leaseManager.acquire({ campaignId, sessionId });
    } catch (error) {
      if (isLeaseHeld(error)) {
        return { campaignId, sessionId, remote: true, ownerId: error.ownerId ?? null, ownerUrl: error.ownerUrl ?? null };
      }
      throw error;
    }

    const runtime = this.#createRuntime(campaignId, sessionId);
    try {
      const result = await runtime.restore({ sessionId, snapshot: active.snapshot, startedAt: active.startedAt });
      this.#register(campaignId, runtime, result.sessionId, true, lease?.generation ?? null);
      const realtimeSnapshot = this.campaignService.loadRealtimeSnapshot(sessionId);
      if (realtimeSnapshot && this.realtimeHub) this.realtimeHub.hydrateSession(sessionId, realtimeSnapshot);
      return { campaignId, sessionId, restored: true, leaseGeneration: lease?.generation ?? null };
    } catch (error) {
      if (lease) await this.leaseManager?.release?.(campaignId, lease.generation).catch(() => undefined);
      this.logger.error?.('[Fênix][RuntimeRegistry] falha ao restaurar campanha', { campaignId, sessionId, message: error.message });
      throw error;
    }
  }

  async #assertOwnership(entry) {
    if (!entry.persistent || !this.leaseManager) return true;
    try {
      await this.leaseManager.assertOwned(entry.campaignId, entry.leaseGeneration);
      return true;
    } catch (error) {
      await this.handleLeaseLost({ campaignId: entry.campaignId, generation: entry.leaseGeneration });
      throw error;
    }
  }

  #createRuntime(campaignId, sessionId) {
    const runtime = this.runtimeFactory({ campaignId: campaignId === LEGACY_KEY ? null : campaignId, sessionId: sessionId || null });
    const required = ['start', 'restore', 'processAction', 'describeRoom', 'end', 'getStatus'];
    for (const method of required) {
      if (typeof runtime?.[method] !== 'function') throw new TypeError(`runtimeFactory deve produzir runtime.${method}().`);
    }
    return runtime;
  }

  #register(campaignId, runtime, sessionId, persistent, leaseGeneration = null) {
    const key = campaignId || LEGACY_KEY;
    const entry = { campaignId: key, runtime, persistent: Boolean(persistent), leaseGeneration: leaseGeneration == null ? null : Number(leaseGeneration) };
    this.entriesByCampaign.set(key, entry);
    if (sessionId) this.campaignBySession.set(String(sessionId), key);
    return entry;
  }

  #evictEntry(campaignId, sessionId = null) {
    const key = campaignId || LEGACY_KEY;
    this.entriesByCampaign.delete(key);
    if (sessionId) this.campaignBySession.delete(String(sessionId));
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
    if (!entry && required) throw registryError('Sessão narrativa não está ativa nesta instância.', 'SESSION_NOT_ACTIVE', 409);
    return entry;
  }
}
