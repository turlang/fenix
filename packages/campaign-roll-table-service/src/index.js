import { randomUUID } from 'node:crypto';

function tableError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function ensureTables(campaign) {
  if (!Array.isArray(campaign.rollTables)) campaign.rollTables = [];
  return campaign.rollTables;
}

function normalizeResults(results = []) {
  return Object.freeze((Array.isArray(results) ? results : []).slice(0, 1000).map((entry, index) => Object.freeze({
    id: clean(entry?.id ?? entry?._id, 200) || `result-${index + 1}`,
    range: Array.isArray(entry?.range)
      ? Object.freeze(entry.range.slice(0, 2).map((value) => Number(value)).filter(Number.isFinite))
      : null,
    weight: Number.isFinite(Number(entry?.weight)) ? Number(entry.weight) : null,
    text: clean(entry?.text, 2000) || null,
    documentUuid: clean(entry?.documentUuid ?? entry?.uuid, 600) || null,
    drawn: entry?.drawn === true
  })));
}

function publicTable(table) {
  return Object.freeze({
    id: table.id,
    rollTableId: table.id,
    name: table.name,
    systemId: table.systemId,
    formula: table.formula,
    replacement: table.replacement !== false,
    results: Object.freeze((table.results ?? []).map((entry) => Object.freeze({ ...entry }))),
    sourceSync: Object.freeze({ ...(table.sourceSync ?? {}) }),
    mapping: table.mapping ? Object.freeze({ ...table.mapping }) : null,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt
  });
}

export class CampaignRollTableService {
  constructor({ campaignService, repository, now = () => Date.now() } = {}) {
    if (!campaignService) throw new TypeError('campaignService é obrigatório.');
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.campaignService = campaignService;
    this.repository = repository;
    this.now = now;
  }

  list({ campaignId, userId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    return ensureTables(campaign).map(publicTable);
  }

  get({ campaignId, userId, rollTableId } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const table = ensureTables(campaign).find((entry) => entry.id === clean(rollTableId, 200));
    if (!table) throw tableError('RollTable não encontrada.', 'CAMPAIGN_ROLL_TABLE_NOT_FOUND', 404);
    return publicTable(table);
  }

  async upsertSource({
    campaignId,
    userId,
    rollTableId = null,
    sourceUuid,
    sourceHash,
    name,
    systemId = null,
    formula = null,
    replacement = true,
    results = [],
    mapping = null
  } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const uuid = clean(sourceUuid, 600);
    if (!uuid) throw tableError('sourceUuid é obrigatório.', 'CAMPAIGN_ROLL_TABLE_SOURCE_UUID_REQUIRED');
    const tables = ensureTables(campaign);
    const existing = tables.find((entry) => entry.sourceSync?.sourceUuid === uuid)
      ?? tables.find((entry) => entry.id === clean(rollTableId, 200))
      ?? null;
    const id = existing?.id ?? (clean(rollTableId, 200) || `roll-table-${randomUUID()}`);
    const now = new Date(this.now()).toISOString();
    const next = {
      id,
      name: clean(name ?? existing?.name, 160) || id,
      systemId: clean(systemId ?? existing?.systemId ?? campaign.systemId, 120) || 'generic',
      formula: clean(formula ?? existing?.formula, 120) || null,
      replacement: replacement !== false,
      results: normalizeResults(results ?? existing?.results ?? []),
      mapping: mapping ? structuredClone(mapping) : existing?.mapping ?? null,
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
    else tables.push(next);
    campaign.updatedAt = now;
    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((entry) => entry.id === campaign.id);
      if (!stored) throw tableError('Campanha não encontrada.', 'CAMPAIGN_NOT_FOUND', 404);
      if (!Array.isArray(stored.rollTables)) stored.rollTables = [];
      const index = stored.rollTables.findIndex((entry) => entry.id === id || entry.sourceSync?.sourceUuid === uuid);
      if (index >= 0) stored.rollTables[index] = structuredClone(next);
      else stored.rollTables.push(structuredClone(next));
      stored.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return this.get({ campaignId, userId, rollTableId: id });
  }

  async update({ campaignId, userId, rollTableId, input = {} } = {}) {
    const { campaign } = this.campaignService.requireRole(campaignId, userId, 'gm');
    const id = clean(rollTableId, 200);
    const table = ensureTables(campaign).find((entry) => entry.id === id);
    if (!table) throw tableError('RollTable não encontrada.', 'CAMPAIGN_ROLL_TABLE_NOT_FOUND', 404);
    const now = new Date(this.now()).toISOString();
    const next = {
      ...table,
      name: input.name == null ? table.name : clean(input.name, 160) || table.name,
      formula: input.formula == null ? table.formula : clean(input.formula, 120) || null,
      replacement: input.replacement == null ? table.replacement : input.replacement !== false,
      results: input.results == null ? table.results : normalizeResults(input.results),
      sourceSync: { ...(table.sourceSync ?? {}), localModified: true },
      updatedAt: now
    };
    Object.assign(table, next);
    campaign.updatedAt = now;
    await this.repository.mutate((draft) => {
      const stored = draft.campaigns.find((entry) => entry.id === campaign.id);
      const index = stored?.rollTables?.findIndex((entry) => entry.id === id) ?? -1;
      if (index < 0) throw tableError('RollTable não encontrada.', 'CAMPAIGN_ROLL_TABLE_NOT_FOUND', 404);
      stored.rollTables[index] = structuredClone(next);
      stored.updatedAt = now;
    });
    this.campaignService.refreshFromRepository();
    return this.get({ campaignId, userId, rollTableId: id });
  }
}
