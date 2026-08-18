import { createRenderWorldBootstrap } from '../../render-world-bootstrap/src/index.js';

function brokerError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function rawScene(campaign, sceneId) {
  return (Array.isArray(campaign?.scenes) ? campaign.scenes : [])
    .find((scene) => scene.id === String(sceneId)) ?? null;
}

export class RemoteRenderBrokerService {
  constructor({ campaignService, actorService, tokenService, sceneService = null, renderGateway, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!actorService) throw new TypeError('actorService é obrigatório.');
    if (!tokenService) throw new TypeError('tokenService é obrigatório.');
    if (!renderGateway) throw new TypeError('renderGateway é obrigatório.');
    this.campaignService = campaignService;
    this.actorService = actorService;
    this.tokenService = tokenService;
    this.sceneService = sceneService;
    this.renderGateway = renderGateway;
    this.now = now;
    this.sessions = new Map();
  }

  get enabled() {
    return this.renderGateway.list().length > 0;
  }

  async create({
    campaignId,
    userId,
    sceneId,
    actorId,
    tokenId,
    sessionId = null,
    preferredCodecs,
    targetFps,
    maxWidth,
    maxHeight
  } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    const normalizedActorId = text(actorId || membership.actorId);
    if (!normalizedActorId) throw brokerError('actorId é obrigatório para primeira pessoa.', 'FENIX_RENDER_ACTOR_REQUIRED');
    if (membership.role !== 'gm' && normalizedActorId !== membership.actorId) {
      throw brokerError('Jogador só pode abrir primeira pessoa para o próprio personagem.', 'FENIX_RENDER_ACTOR_FORBIDDEN', 403);
    }

    const actor = this.actorService.get({ campaignId: campaign.id, userId, actorId: normalizedActorId });
    const runtimeTokens = this.tokenService.listRuntimeForScene({ campaignId: campaign.id, sceneId });
    const token = runtimeTokens.find((item) => (item.tokenId ?? item.id) === String(tokenId)) ?? null;
    if (!token) throw brokerError('Token não encontrado nesta cena.', 'FENIX_RENDER_TOKEN_NOT_FOUND', 404);
    if (token.actorId !== actor.id) {
      throw brokerError('Token não está associado ao ator solicitado.', 'FENIX_RENDER_TOKEN_ACTOR_MISMATCH', 409);
    }

    const scene = this.sceneService
      ? this.sceneService.list({ campaignId: campaign.id, userId }).scenes.find((item) => item.id === String(sceneId)) ?? null
      : rawScene(campaign, sceneId);
    if (!scene) throw brokerError('Cena não encontrada para renderização.', 'FENIX_RENDER_SCENE_NOT_FOUND', 404);
    const visibleTokens = this.tokenService.list({ campaignId: campaign.id, userId, sceneId });
    const createdAt = new Date(this.now()).toISOString();
    const worldBootstrap = createRenderWorldBootstrap({
      campaign,
      scene,
      actor,
      viewerToken: token,
      visibleTokens,
      createdAt
    });

    const result = await this.renderGateway.createSession({
      campaignId: campaign.id,
      sessionId,
      sceneId,
      actorId: actor.id,
      tokenId: token.tokenId ?? token.id,
      preferredCodecs,
      targetFps,
      maxWidth,
      maxHeight,
      worldBootstrap
    });
    const record = Object.freeze({
      renderSessionId: result.descriptor.renderSessionId,
      campaignId: campaign.id,
      sceneId: String(sceneId),
      actorId: actor.id,
      tokenId: token.tokenId ?? token.id,
      requestedByUserId: String(userId),
      nodeId: result.nodeId,
      createdAt,
      descriptor: result.descriptor
    });
    this.sessions.set(record.renderSessionId, record);

    return Object.freeze({
      renderSessionId: record.renderSessionId,
      sceneId: record.sceneId,
      actorId: record.actorId,
      tokenId: record.tokenId,
      createdAt,
      descriptor: record.descriptor
    });
  }

  get({ campaignId, userId, renderSessionId } = {}) {
    const { membership } = this.campaignService.requireRole(campaignId, userId);
    const record = this.sessions.get(String(renderSessionId)) ?? null;
    if (!record || record.campaignId !== String(campaignId)) throw brokerError('Sessão de render não encontrada.', 'FENIX_RENDER_SESSION_NOT_FOUND', 404);
    if (membership.role !== 'gm' && record.actorId !== membership.actorId) {
      throw brokerError('Acesso negado à sessão de render.', 'FENIX_RENDER_SESSION_FORBIDDEN', 403);
    }
    return Object.freeze({
      renderSessionId: record.renderSessionId,
      sceneId: record.sceneId,
      actorId: record.actorId,
      tokenId: record.tokenId,
      createdAt: record.createdAt,
      descriptor: record.descriptor
    });
  }

  async end({ campaignId, userId, renderSessionId } = {}) {
    const current = this.get({ campaignId, userId, renderSessionId });
    await this.renderGateway.endSession(current.renderSessionId);
    this.sessions.delete(current.renderSessionId);
    return Object.freeze({ renderSessionId: current.renderSessionId, ended: true });
  }
}
