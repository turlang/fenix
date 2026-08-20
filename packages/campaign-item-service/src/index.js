import { randomUUID } from 'node:crypto';

function itemError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 300) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function ensureItems(campaign) {
  if (!Array.isArray(campaign.items)) campaign.items = [];
  return campaign.items;
}

function publicItem(item) {
  return Object.freeze({
    id: item.id,
    itemId: item.id,
    name: item.name,
    kind: item.kind,
    systemId: item.systemId,
    image: item.image ?? null,
    data: Object.freeze({ ...(item.data ?? {}) }),
    sourceSync: Object.freeze({ ...(item.sourceSync ?? {}) }),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  });
}

export class CampaignItemService {
  constructor({ campaignService, repository, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.now = now;
  }

  list({ campaignId, userId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    return ensureItems(campaign).map(publicItem);
  }

  get({ campaignId, userId, itemId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const item = ensureItems(campaign).find((entry) => entry.id === clean(itemId, 200));
    if (!item) throw itemError('Item não encontrado.', 'CAMPAIGN_ITEM_NOT_FOUND', 404);
    return publicItem(item);
  }

  async upsertSource({
    campaignId,
    userId,
    itemId = null,
    sourceUuid,
    sourceHash,
    name,
    kind = 'item',
    systemId = null,
    image = null,
    data = {}
  } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const uuid = clean(sourceUuid, 500);
    if (!uuid) throw itemError('sourceUuid é obrigatório.', 'CAMPAIGN_ITEM_SOURCE_UUID_REQUIRED');
    const items = ensureItems(campaign);
    const existing = items.find((entry) => entry.sourceSync?.sourceUuid === uuid)
      ?? items.find((entry) => entry.id === clean(itemId, 200))
      ?? null;
    const id = existing?.id ?? (clean(itemId, 200) || `item-${randomUUID()}`);
    const now = new Date(this.now()).toISOString();
    const next = {
      id,
      name: clean(name ?? existing?.name, 160) || id,
      kind: ['item', 'spell'].includes(clean(kind, 40)) ? clean(kind, 40) : 'item',
      systemId: clean(systemId ?? existing?.systemId ?? campaign.systemId, 120) || 'generic',
      image: clean(image ?? existing?.image, 2000) || null,
      data: structuredClone(data ?? existing?.data ?? {}),
      sourceSync: {
        adapter: 'foundry',
        sourceUuid: uuid,
        sourceHash: clean(sourceHash, 128) || null,
        localModified: false,
        synchronizedAt: now
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, next);
    else items.push(next);
    campaign.updatedAt = now;
    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((entry) => entry.id === campaign.id);
      if (!stored) throw itemError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      if (!Array.isArray(stored.items)) stored.items = [];
      const index = stored.items.findIndex((entry) => entry.id === id || entry.sourceSync?.sourceUuid === uuid);
      if (index >= 0) stored.items[index] = structuredClone(next);
      else stored.items.push(structuredClone(next));
      stored.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return this.get({ campaignId, userId, itemId: id });
  }

  async update({ campaignId, userId, itemId, input = {} } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const id = clean(itemId, 200);
    const item = ensureItems(campaign).find((entry) => entry.id === id);
    if (!item) throw itemError('Item não encontrado.', 'CAMPAIGN_ITEM_NOT_FOUND', 404);
    const now = new Date(this.now()).toISOString();
    const next = {
      ...item,
      name: input.name == null ? item.name : clean(input.name, 160) || item.name,
      kind: input.kind == null ? item.kind : (['item', 'spell'].includes(clean(input.kind, 40)) ? clean(input.kind, 40) : item.kind),
      image: input.image == null ? item.image : clean(input.image, 2000) || null,
      data: input.data == null ? item.data : structuredClone(input.data),
      sourceSync: { ...(item.sourceSync ?? {}), localModified: true },
      updatedAt: now
    };
    Object.assign(item, next);
    campaign.updatedAt = now;
    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((entry) => entry.id === campaign.id);
      const index = stored?.items?.findIndex((entry) => entry.id === id) ?? -1;
      if (index < 0) throw itemError('Item não encontrado.', 'CAMPAIGN_ITEM_NOT_FOUND', 404);
      stored.items[index] = structuredClone(next);
      stored.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return this.get({ campaignId, userId, itemId: id });
  }
}
