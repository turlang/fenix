import { createHash, randomBytes, randomUUID } from 'node:crypto';

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;

function campaignError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, maxLength = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function hashToken(value) {
  return createHash('sha256').update(String(value ?? '')).digest('base64url');
}

function publicCampaign(campaign, userId = null) {
  if (!campaign) return null;
  const membership = userId ? campaign.members.find((member) => member.userId === userId) ?? null : null;
  return Object.freeze({
    id: campaign.id,
    title: campaign.title,
    systemId: campaign.systemId,
    ownerUserId: campaign.ownerUserId,
    membership: membership ? { ...membership } : null,
    members: campaign.members.map((member) => ({ ...member })),
    activeSession: campaign.activeSession ? {
      sessionId: campaign.activeSession.sessionId,
      startedAt: campaign.activeSession.startedAt
    } : null,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt
  });
}

export class CampaignService {
  constructor({ repository, authService = null, inviteTtlMs = DEFAULT_INVITE_TTL_MS, now = () => Date.now(), logger = console } = {}) {
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.repository = repository;
    this.authService = authService;
    this.inviteTtlMs = Math.max(60_000, Number(inviteTtlMs) || DEFAULT_INVITE_TTL_MS);
    this.now = now;
    this.logger = logger;
    this.campaigns = new Map();
    this.invites = new Map();
  }

  async initialize() {
    this.refreshFromRepository();
    const now = this.now();
    await this.repository.mutate((draft) => {
      draft.invites = draft.invites.filter((invite) => invite.usedAt || Date.parse(invite.expiresAt) > now);
    });
    return this.refreshFromRepository();
  }

  refreshFromRepository() {
    const state = this.repository.snapshot();
    this.campaigns.clear();
    this.invites.clear();
    for (const campaign of state.campaigns ?? []) this.campaigns.set(campaign.id, campaign);
    const now = this.now();
    for (const invite of state.invites ?? []) {
      if (!invite.usedAt && Date.parse(invite.expiresAt) > now) this.invites.set(invite.tokenHash, invite);
    }
    return { campaigns: this.campaigns.size, activeInvites: this.invites.size };
  }

  listActiveSessions() {
    return [...this.campaigns.values()]
      .filter((campaign) => campaign.activeSession?.sessionId)
      .map((campaign) => ({ campaignId: campaign.id, ...structuredClone(campaign.activeSession) }));
  }

  listForUser(userId) {
    const id = String(userId ?? '');
    return [...this.campaigns.values()]
      .filter((campaign) => campaign.members.some((member) => member.userId === id))
      .map((campaign) => publicCampaign(campaign, id));
  }

  getForUser(campaignId, userId) {
    const campaign = this.campaigns.get(String(campaignId));
    if (!campaign) throw campaignError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    if (!campaign.members.some((member) => member.userId === String(userId))) {
      throw campaignError('Usuário não participa desta campanha.', 'CAMPAIGN_FORBIDDEN', 403);
    }
    return publicCampaign(campaign, String(userId));
  }

  getRaw(campaignId) {
    return this.campaigns.get(String(campaignId)) ?? null;
  }

  async createCampaign({ ownerUserId, title, systemId = 'fenix-system-agnostic' } = {}) {
    const ownerId = String(ownerUserId ?? '').trim();
    if (!ownerId) throw campaignError('ownerUserId é obrigatório.', 'CAMPAIGN_OWNER_REQUIRED');
    const normalizedTitle = text(title, 160);
    if (normalizedTitle.length < 3) throw campaignError('Título da campanha é obrigatório.', 'CAMPAIGN_TITLE_REQUIRED');
    const now = new Date(this.now()).toISOString();
    const campaign = {
      id: randomUUID(),
      title: normalizedTitle,
      systemId: text(systemId, 120) || 'fenix-system-agnostic',
      ownerUserId: ownerId,
      members: [{ userId: ownerId, role: 'gm', actorId: null, joinedAt: now }],
      activeSession: null,
      createdAt: now,
      updatedAt: now
    };
    await this.repository.mutate((draft) => {
      draft.campaigns.push(campaign);
    });
    this.campaigns.set(campaign.id, campaign);
    return publicCampaign(campaign, ownerId);
  }

  requireRole(campaignId, userId, role = null) {
    const campaign = this.campaigns.get(String(campaignId));
    if (!campaign) throw campaignError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    const membership = campaign.members.find((member) => member.userId === String(userId));
    if (!membership) throw campaignError('Acesso negado à campanha.', 'CAMPAIGN_FORBIDDEN', 403);
    if (role && membership.role !== role) throw campaignError('Permissão insuficiente.', 'CAMPAIGN_ROLE_FORBIDDEN', 403);
    return { campaign, membership };
  }

  async createInvite({ campaignId, createdByUserId, actorId, expiresInMs = this.inviteTtlMs } = {}) {
    const { campaign } = this.requireRole(campaignId, createdByUserId, 'gm');
    const normalizedActorId = text(actorId, 200);
    if (!normalizedActorId) throw campaignError('actorId é obrigatório para convite de jogador.', 'CAMPAIGN_INVITE_ACTOR_REQUIRED');
    if (campaign.members.some((member) => member.actorId === normalizedActorId)) {
      throw campaignError('Este personagem já está vinculado a um jogador.', 'CAMPAIGN_ACTOR_ALREADY_ASSIGNED', 409);
    }
    const rawToken = randomBytes(24).toString('base64url');
    const now = this.now();
    const invite = {
      id: randomUUID(),
      campaignId: campaign.id,
      tokenHash: hashToken(rawToken),
      role: 'player',
      actorId: normalizedActorId,
      createdByUserId: String(createdByUserId),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.max(60_000, Number(expiresInMs) || this.inviteTtlMs)).toISOString(),
      usedAt: null,
      usedByUserId: null
    };
    await this.repository.mutate((draft) => {
      draft.invites.push(invite);
    });
    this.invites.set(invite.tokenHash, invite);
    return {
      token: rawToken,
      invite: {
        id: invite.id,
        campaignId: invite.campaignId,
        actorId: invite.actorId,
        expiresAt: invite.expiresAt
      }
    };
  }

  inspectInvite(rawToken) {
    const invite = this.invites.get(hashToken(rawToken));
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= this.now()) {
      throw campaignError('Convite inválido ou expirado.', 'CAMPAIGN_INVITE_INVALID', 404);
    }
    const campaign = this.campaigns.get(invite.campaignId);
    if (!campaign) throw campaignError('Campanha do convite não existe.', 'CAMPAIGN_NOT_FOUND', 404);
    return {
      campaignId: campaign.id,
      campaignTitle: campaign.title,
      actorId: invite.actorId,
      expiresAt: invite.expiresAt
    };
  }

  async acceptInvite({ token, userId } = {}) {
    const hash = hashToken(token);
    const invite = this.invites.get(hash);
    if (!invite || invite.usedAt || Date.parse(invite.expiresAt) <= this.now()) {
      throw campaignError('Convite inválido ou expirado.', 'CAMPAIGN_INVITE_INVALID', 404);
    }
    const campaign = this.campaigns.get(invite.campaignId);
    if (!campaign) throw campaignError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    const id = String(userId ?? '').trim();
    if (!id) throw campaignError('userId é obrigatório.', 'CAMPAIGN_MEMBER_REQUIRED');
    const now = new Date(this.now()).toISOString();
    const existing = campaign.members.find((member) => member.userId === id);
    if (existing && existing.actorId !== invite.actorId) {
      throw campaignError('Usuário já participa da campanha com outro personagem.', 'CAMPAIGN_MEMBER_EXISTS', 409);
    }
    if (campaign.members.some((member) => member.actorId === invite.actorId && member.userId !== id)) {
      throw campaignError('Personagem já foi atribuído.', 'CAMPAIGN_ACTOR_ALREADY_ASSIGNED', 409);
    }
    if (!existing) campaign.members.push({ userId: id, role: 'player', actorId: invite.actorId, joinedAt: now });
    invite.usedAt = now;
    invite.usedByUserId = id;
    campaign.updatedAt = now;
    await this.repository.mutate((draft) => {
      const storedCampaign = draft.campaigns.find((item) => item.id === campaign.id);
      Object.assign(storedCampaign, structuredClone(campaign));
      const storedInvite = draft.invites.find((item) => item.id === invite.id);
      Object.assign(storedInvite, structuredClone(invite));
    });
    this.invites.delete(hash);
    return publicCampaign(campaign, id);
  }

  async setActiveSession(campaignId, { sessionId, snapshot, startedAt = new Date(this.now()).toISOString() } = {}) {
    const campaign = this.campaigns.get(String(campaignId));
    if (!campaign) throw campaignError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    if (!sessionId || !snapshot) throw campaignError('Sessão persistente incompleta.', 'CAMPAIGN_SESSION_INVALID');
    campaign.activeSession = {
      sessionId: String(sessionId),
      snapshot: structuredClone(snapshot),
      startedAt
    };
    campaign.updatedAt = new Date(this.now()).toISOString();
    await this.#persistCampaign(campaign);
    return structuredClone(campaign.activeSession);
  }

  async clearActiveSessionBySessionId(sessionId) {
    const campaign = [...this.campaigns.values()].find((item) => item.activeSession?.sessionId === String(sessionId));
    if (!campaign) return false;
    campaign.activeSession = null;
    campaign.updatedAt = new Date(this.now()).toISOString();
    await this.#persistCampaign(campaign);
    return true;
  }

  findActiveSession() {
    const campaign = [...this.campaigns.values()].find((item) => item.activeSession?.sessionId);
    if (!campaign) return null;
    return {
      campaignId: campaign.id,
      ...structuredClone(campaign.activeSession)
    };
  }

  findCampaignBySessionId(sessionId) {
    return [...this.campaigns.values()].find((item) => item.activeSession?.sessionId === String(sessionId)) ?? null;
  }

  resolveMembershipForSession(sessionId, userId) {
    const campaign = this.findCampaignBySessionId(sessionId);
    if (!campaign) throw campaignError('Sessão não pertence a uma campanha persistida.', 'CAMPAIGN_SESSION_NOT_FOUND', 404);
    const membership = campaign.members.find((member) => member.userId === String(userId));
    if (!membership) throw campaignError('Usuário não participa da campanha ativa.', 'CAMPAIGN_FORBIDDEN', 403);
    return { campaign, membership };
  }

  async saveRealtimeSnapshot(sessionId, snapshot) {
    const key = String(sessionId);
    await this.repository.mutate((draft) => {
      draft.realtimeSessions[key] = {
        ...structuredClone(snapshot),
        savedAt: new Date(this.now()).toISOString()
      };
    });
  }

  loadRealtimeSnapshot(sessionId) {
    return this.repository.read((state) => state.realtimeSessions?.[String(sessionId)] ?? null);
  }

  async clearRealtimeSnapshot(sessionId) {
    await this.repository.mutate((draft) => {
      delete draft.realtimeSessions[String(sessionId)];
    });
  }

  async #persistCampaign(campaign) {
    await this.repository.mutate((draft) => {
      const index = draft.campaigns.findIndex((item) => item.id === campaign.id);
      if (index < 0) throw campaignError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      draft.campaigns[index] = structuredClone(campaign);
    });
  }
}

export function createAuthenticatedPeerAuthorizer({ authService, campaignService } = {}) {
  if (!authService || !campaignService) throw new TypeError('authService e campaignService são obrigatórios.');
  return ({ sessionId, authToken, clientId }) => {
    const authenticated = authService.requireToken(authToken);
    const { membership } = campaignService.resolveMembershipForSession(sessionId, authenticated.user.id);
    return {
      clientId: text(clientId, 120) || randomUUID(),
      userId: authenticated.user.id,
      displayName: authenticated.user.displayName,
      role: membership.role,
      actorId: membership.actorId ?? null
    };
  };
}

export function createCampaignError(message, code, statusCode) {
  return campaignError(message, code, statusCode);
}
