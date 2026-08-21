import { randomUUID } from 'node:crypto';
import {
  createGenericRpgSystemAdapter,
  normalizeMovementProfile,
  normalizeVisionProfile
} from '../../rpg-rules-contract/src/index.js';

function actorError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function ensureActors(campaign) {
  if (!Array.isArray(campaign.actors)) campaign.actors = [];
  return campaign.actors;
}

function normalizeFootprint(input = {}) {
  const widthCells = Number(input.widthCells);
  const heightCells = Number(input.heightCells);
  return Object.freeze({
    widthCells: Number.isFinite(widthCells) && widthCells > 0 ? widthCells : 1,
    heightCells: Number.isFinite(heightCells) && heightCells > 0 ? heightCells : 1
  });
}

function normalizeSheet(input = {}) {
  return Object.freeze({
    height: Number.isFinite(Number(input.height)) && Number(input.height) > 0 ? Number(input.height) : 1.8,
    footprint: normalizeFootprint(input.footprint ?? {}),
    movement: normalizeMovementProfile(input.movement ?? {}),
    vision: normalizeVisionProfile(input.vision ?? {}),
    attributes: Object.freeze({ ...(input.attributes ?? {}) }),
    conditions: Object.freeze([...(Array.isArray(input.conditions) ? input.conditions : [])]),
    metadata: Object.freeze({ ...(input.metadata ?? {}) })
  });
}

function publicActor(actor, adapter) {
  const sheet = normalizeSheet(actor.sheet ?? {});
  return Object.freeze({
    id: actor.id,
    actorId: actor.id,
    sheetId: actor.sheetId,
    systemId: actor.systemId,
    name: actor.name,
    kind: actor.kind,
    image: actor.image ?? null,
    sheet,
    resolved: Object.freeze({
      movement: adapter.resolveMovementProfile({ actor, sheet }),
      vision: adapter.resolveVisionProfile({ actor, sheet }),
      footprint: adapter.resolveTokenFootprint?.({ actor, sheet }) ?? Object.freeze({ widthCells: 1, heightCells: 1 })
    }),
    createdAt: actor.createdAt,
    updatedAt: actor.updatedAt
  });
}

export class CampaignActorService {
  constructor({ campaignService, repository, adapterResolver = null, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.adapterResolver = typeof adapterResolver === 'function'
      ? adapterResolver
      : (systemId) => createGenericRpgSystemAdapter({ id: systemId || 'generic' });
    this.now = now;
  }

  #adapter(systemId) {
    const adapter = this.adapterResolver(systemId);
    if (!adapter?.resolveMovementProfile || !adapter?.resolveVisionProfile) {
      throw actorError('Adaptador de sistema inválido.', 'RPG_SYSTEM_ADAPTER_INVALID', 500);
    }
    return adapter;
  }

  list({ campaignId, userId } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    const actors = ensureActors(campaign);
    if (membership.role === 'gm') {
      return actors.map((actor) => publicActor(actor, this.#adapter(actor.systemId)));
    }
    return actors
      .filter((actor) => actor.id === membership.actorId)
      .map((actor) => publicActor(actor, this.#adapter(actor.systemId)));
  }

  get({ campaignId, userId, actorId } = {}) {
    const { campaign, membership } = this.campaignService.requireRole(campaignId, userId);
    const id = text(actorId, 200);
    if (membership.role !== 'gm' && membership.actorId !== id) {
      throw actorError('Jogador só pode consultar a própria ficha.', 'CAMPAIGN_ACTOR_FORBIDDEN', 403);
    }
    const actor = ensureActors(campaign).find((item) => item.id === id);
    if (!actor) throw actorError('Ator não encontrado.', 'CAMPAIGN_ACTOR_NOT_FOUND', 404);
    return publicActor(actor, this.#adapter(actor.systemId));
  }

  resolveBySession({ sessionId, actorId } = {}) {
    const campaign = this.campaignService.findCampaignBySessionId(sessionId);
    if (!campaign) return null;
    const actor = ensureActors(campaign).find((item) => item.id === String(actorId));
    if (!actor) return null;
    return publicActor(actor, this.#adapter(actor.systemId));
  }

  resolveVisionBySession({ sessionId, actorId } = {}) {
    return this.resolveBySession({ sessionId, actorId })?.resolved?.vision ?? null;
  }

  resolveMovementBySession({ sessionId, actorId } = {}) {
    return this.resolveBySession({ sessionId, actorId })?.resolved?.movement ?? null;
  }

  async upsert({
    campaignId,
    userId,
    actorId,
    sheetId = null,
    systemId = null,
    name = null,
    kind = 'character',
    image = null,
    sheet = {}
  } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const id = text(actorId, 200);
    if (!id) throw actorError('actorId é obrigatório.', 'CAMPAIGN_ACTOR_ID_REQUIRED');
    const actors = ensureActors(campaign);
    const existing = actors.find((item) => item.id === id) ?? null;
    const now = new Date(this.now()).toISOString();
    const resolvedSystemId = text(systemId ?? existing?.systemId ?? campaign.systemId, 120) || 'generic';
    const normalizedSheet = normalizeSheet(sheet ?? existing?.sheet ?? {});
    const next = {
      id,
      sheetId: text(sheetId ?? existing?.sheetId, 200) || `sheet-${id}`,
      systemId: resolvedSystemId,
      name: text(name ?? existing?.name, 160) || id,
      kind: text(kind ?? existing?.kind, 60) || 'character',
      image: text(image ?? existing?.image, 2000) || null,
      sheet: structuredClone(normalizedSheet),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, next);
    else actors.push(next);
    campaign.updatedAt = now;

    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((item) => item.id === campaign.id);
      if (!stored) throw actorError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      if (!Array.isArray(stored.actors)) stored.actors = [];
      const index = stored.actors.findIndex((item) => item.id === id);
      if (index >= 0) stored.actors[index] = structuredClone(next);
      else stored.actors.push(structuredClone(next));
      stored.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return this.get({ campaignId, userId, actorId: id });
  }

  async ensureLegacyActor({ campaignId, actorId, name = null, systemId = null } = {}) {
    const campaign = this.campaignService.getRaw(campaignId);
    if (!campaign) throw actorError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
    const actors = ensureActors(campaign);
    const existing = actors.find((item) => item.id === String(actorId));
    if (existing) return publicActor(existing, this.#adapter(existing.systemId));
    const now = new Date(this.now()).toISOString();
    const next = {
      id: String(actorId),
      sheetId: `sheet-${actorId || randomUUID()}`,
      systemId: text(systemId ?? campaign.systemId, 120) || 'generic',
      name: text(name, 160) || String(actorId),
      kind: 'character',
      image: null,
      sheet: structuredClone(normalizeSheet({
        height: 1.8,
        footprint: { widthCells: 1, heightCells: 1 },
        movement: { unit: 'm', speeds: { walk: 9 }, defaultMode: 'walk' },
        vision: { unit: 'm', eyeHeight: 1.6, senses: { normal: 12 } }
      })),
      createdAt: now,
      updatedAt: now
    };
    actors.push(next);
    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((item) => item.id === campaign.id);
      if (!Array.isArray(stored.actors)) stored.actors = [];
      if (!stored.actors.some((item) => item.id === next.id)) stored.actors.push(structuredClone(next));
    });
    this.campaignService.refreshFromRepository();
    return publicActor(next, this.#adapter(next.systemId));
  }
}
