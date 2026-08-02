import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DATABASE_VERSION = 1;
const COLLECTIONS = new Set(['facts', 'npcs', 'relationships', 'quests', 'items']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function text(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function id(value, limit = 200) {
  return text(value, limit);
}

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, value) {
  const digest = createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 20);
  return `${prefix}:${digest}`;
}

function campaignDescriptor(input = {}) {
  if (typeof input === 'string') return { worldId: id(input) || 'default' };
  const source = input && typeof input === 'object' ? input : {};
  return {
    worldId: id(source.worldId ?? source.id ?? source.uuid ?? source.title) || 'default',
    title: text(source.title ?? source.name, 300) || null,
    systemId: id(source.systemId ?? source.system, 100) || null
  };
}

function relationshipType(score) {
  const value = Number(score) || 0;
  if (value <= -20) return 'HOSTILE';
  if (value >= 20) return 'ALLIED';
  if (value >= 5) return 'FRIENDLY';
  if (value <= -5) return 'UNFRIENDLY';
  return 'NEUTRAL';
}

function emptyCampaign(input = {}) {
  const descriptor = campaignDescriptor(input);
  const now = nowIso();
  return {
    campaignId: descriptor.worldId,
    title: descriptor.title,
    systemId: descriptor.systemId,
    createdAt: now,
    updatedAt: now,
    facts: {},
    npcs: {},
    relationships: {},
    quests: {},
    items: {},
    recentEvents: [],
    processedEventIds: [],
    worldState: null,
    lastSession: null
  };
}

function normalizeDatabase(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: DATABASE_VERSION,
    updatedAt: source.updatedAt ?? null,
    campaigns: source.campaigns && typeof source.campaigns === 'object' ? source.campaigns : {}
  };
}

function normalizeVisibility(value) {
  return String(value ?? '').toLowerCase() === 'secret' ? 'secret' : 'known';
}

function normalizeCollectionName(value) {
  const collection = String(value ?? '').trim().toLowerCase();
  if (!COLLECTIONS.has(collection)) throw new TypeError(`Coleção de memória inválida: ${value}`);
  return collection;
}

function normalizeFact(record = {}, existing = null) {
  const content = text(record.text ?? record.content ?? record.value);
  if (!content) throw new TypeError('O fato precisa de texto.');
  const key = text(record.key, 300) || content.toLocaleLowerCase('pt-BR');
  const now = nowIso();
  return {
    ...(existing ?? {}),
    id: id(record.id) || existing?.id || stableId('fact', key),
    key,
    text: content,
    category: id(record.category, 100) || existing?.category || 'GENERAL',
    source: id(record.source, 100) || existing?.source || 'MANUAL',
    sceneId: id(record.sceneId) || existing?.sceneId || null,
    roundNumber: Number(record.roundNumber) || existing?.roundNumber || null,
    visibility: normalizeVisibility(record.visibility ?? existing?.visibility),
    firstSeenAt: existing?.firstSeenAt || record.firstSeenAt || now,
    lastSeenAt: record.lastSeenAt || now,
    updatedAt: now
  };
}

function normalizeNpc(record = {}, existing = null) {
  const name = text(record.name ?? existing?.name, 300);
  const npcId = id(record.id ?? record.npcId ?? existing?.id) || (name ? stableId('npc', name.toLocaleLowerCase('pt-BR')) : '');
  if (!npcId) throw new TypeError('O NPC precisa de id ou nome.');
  const now = nowIso();
  return {
    ...(existing ?? {}),
    id: npcId,
    name: name || existing?.name || 'NPC sem nome',
    status: text(record.status ?? record.state ?? existing?.status, 500) || 'UNKNOWN',
    location: text(record.location ?? existing?.location, 300) || null,
    notes: text(record.notes ?? existing?.notes, 2000) || null,
    tags: [...new Set([...(existing?.tags ?? []), ...(Array.isArray(record.tags) ? record.tags : [])]
      .map((entry) => id(entry, 100)).filter(Boolean))].slice(0, 30),
    visibility: normalizeVisibility(record.visibility ?? existing?.visibility),
    firstSeenAt: existing?.firstSeenAt || record.firstSeenAt || now,
    lastSeenAt: record.lastSeenAt || now,
    updatedAt: now
  };
}

function normalizeRelationship(record = {}, existing = null) {
  const actorId = id(record.actorId ?? existing?.actorId);
  const npcId = id(record.npcId ?? existing?.npcId);
  if (!actorId || !npcId) throw new TypeError('A relação precisa de actorId e npcId.');
  const relationId = id(record.id ?? existing?.id) || `${actorId}:${npcId}`;
  const previousScore = Number(existing?.score) || 0;
  const explicitScore = Number.isFinite(Number(record.score)) ? Number(record.score) : null;
  const score = Math.max(-100, Math.min(100, explicitScore ?? previousScore + (Number(record.delta) || 0)));
  const now = nowIso();
  const historyEntry = record.historyEntry ? {
    at: now,
    delta: Number(record.delta) || 0,
    reason: text(record.historyEntry, 500)
  } : null;
  return {
    ...(existing ?? {}),
    id: relationId,
    actorId,
    actorName: text(record.actorName ?? existing?.actorName, 300) || null,
    npcId,
    npcName: text(record.npcName ?? existing?.npcName, 300) || null,
    score,
    type: id(record.type ?? record.relationshipType, 100) || relationshipType(score),
    notes: text(record.notes ?? existing?.notes, 2000) || null,
    history: [...(existing?.history ?? []), ...(historyEntry ? [historyEntry] : [])].slice(-50),
    visibility: normalizeVisibility(record.visibility ?? existing?.visibility),
    updatedAt: now
  };
}

function normalizeQuest(record = {}, existing = null) {
  const title = text(record.title ?? record.name ?? existing?.title, 400);
  const questId = id(record.id ?? record.questId ?? existing?.id) || (title ? stableId('quest', title.toLocaleLowerCase('pt-BR')) : '');
  if (!questId) throw new TypeError('A missão precisa de id ou título.');
  const status = id(record.status ?? existing?.status, 50).toUpperCase() || 'ACTIVE';
  const now = nowIso();
  return {
    ...(existing ?? {}),
    id: questId,
    title: title || existing?.title || 'Missão sem título',
    status,
    objective: text(record.objective ?? existing?.objective, 1500) || null,
    giverNpcId: id(record.giverNpcId ?? existing?.giverNpcId) || null,
    participantActorIds: [...new Set([...(existing?.participantActorIds ?? []), ...(Array.isArray(record.participantActorIds) ? record.participantActorIds : [])]
      .map((entry) => id(entry)).filter(Boolean))].slice(0, 50),
    notes: text(record.notes ?? existing?.notes, 2500) || null,
    visibility: normalizeVisibility(record.visibility ?? existing?.visibility),
    createdAt: existing?.createdAt || record.createdAt || now,
    updatedAt: now
  };
}

function normalizeItem(record = {}, existing = null) {
  const name = text(record.name ?? record.title ?? existing?.name, 400);
  const ownerActorId = id(record.ownerActorId ?? existing?.ownerActorId) || null;
  const itemId = id(record.id ?? record.itemId ?? existing?.id) || (name ? stableId('item', `${ownerActorId ?? 'party'}:${name.toLocaleLowerCase('pt-BR')}`) : '');
  if (!itemId) throw new TypeError('O item precisa de id ou nome.');
  const quantity = Number.isFinite(Number(record.quantity)) ? Math.max(0, Number(record.quantity)) : (Number(existing?.quantity) || 1);
  const now = nowIso();
  return {
    ...(existing ?? {}),
    id: itemId,
    name: name || existing?.name || 'Item sem nome',
    ownerActorId,
    ownerActorName: text(record.ownerActorName ?? existing?.ownerActorName, 300) || null,
    quantity,
    status: id(record.status ?? existing?.status, 50).toUpperCase() || 'CARRIED',
    location: text(record.location ?? existing?.location, 300) || null,
    notes: text(record.notes ?? existing?.notes, 2000) || null,
    visibility: normalizeVisibility(record.visibility ?? existing?.visibility),
    createdAt: existing?.createdAt || record.createdAt || now,
    updatedAt: now
  };
}

function normalizeRecord(collection, record, existing = null) {
  if (collection === 'facts') return normalizeFact(record, existing);
  if (collection === 'npcs') return normalizeNpc(record, existing);
  if (collection === 'relationships') return normalizeRelationship(record, existing);
  if (collection === 'quests') return normalizeQuest(record, existing);
  return normalizeItem(record, existing);
}

function upsertInto(campaign, collectionName, record) {
  const collection = normalizeCollectionName(collectionName);
  const candidate = normalizeRecord(collection, record, null);
  const existing = campaign[collection][candidate.id] ?? null;
  const normalized = normalizeRecord(collection, record, existing);
  campaign[collection][normalized.id] = normalized;
  campaign.updatedAt = nowIso();
  return normalized;
}

function publicRecords(recordMap, limit) {
  return Object.values(recordMap ?? {})
    .filter((entry) => entry.visibility !== 'secret')
    .sort((left, right) => String(right.updatedAt ?? right.lastSeenAt ?? '').localeCompare(String(left.updatedAt ?? left.lastSeenAt ?? '')))
    .slice(0, limit)
    .map(clone);
}

function questFromText(content, declaration) {
  const patterns = [
    { regex: /(?:aceito|aceita|aceitamos|assumo|iniciamos|inicio|começo)\s+(?:a\s+)?(?:missão|quest|tarefa)\s+(.+)/i, status: 'ACTIVE' },
    { regex: /(?:concluo|completo|finalizo|termino|concluímos|completamos)\s+(?:a\s+)?(?:missão|quest|tarefa)\s+(.+)/i, status: 'COMPLETED' },
    { regex: /(?:abandono|cancelamos|cancelo|falho|falhamos)\s+(?:a\s+)?(?:missão|quest|tarefa)\s+(.+)/i, status: 'FAILED' }
  ];
  for (const pattern of patterns) {
    const match = text(content).match(pattern.regex);
    if (!match) continue;
    const title = text(match[1], 400).replace(/[.!?]+$/, '');
    if (!title) return null;
    return {
      title,
      status: pattern.status,
      participantActorIds: declaration?.actorId ? [declaration.actorId] : [],
      notes: `Atualizada automaticamente pela declaração: ${text(content, 800)}`
    };
  }
  return null;
}

function itemFromText(content, declaration) {
  const patterns = [
    { regex: /(?:pego|recolho|recebo|guardo|adquiro)\s+(?:o|a|um|uma)?\s*(?:item|objeto|artefato|poção|chave)\s+(.+)/i, status: 'CARRIED', quantity: 1 },
    { regex: /(?:entrego|deixo|descarto|perco)\s+(?:o|a|um|uma)?\s*(?:item|objeto|artefato|poção|chave)\s+(.+)/i, status: 'REMOVED', quantity: 0 }
  ];
  for (const pattern of patterns) {
    const match = text(content).match(pattern.regex);
    if (!match) continue;
    const name = text(match[1], 400).replace(/[.!?]+$/, '');
    if (!name) return null;
    return {
      name,
      ownerActorId: declaration?.actorId ?? null,
      ownerActorName: declaration?.actorName ?? null,
      status: pattern.status,
      quantity: pattern.quantity,
      notes: `Atualizado automaticamente pela declaração: ${text(content, 800)}`
    };
  }
  return null;
}

function summaryOf(campaign) {
  return {
    campaignId: campaign.campaignId,
    title: campaign.title,
    systemId: campaign.systemId,
    updatedAt: campaign.updatedAt,
    counts: {
      facts: Object.keys(campaign.facts ?? {}).length,
      npcs: Object.keys(campaign.npcs ?? {}).length,
      relationships: Object.keys(campaign.relationships ?? {}).length,
      quests: Object.keys(campaign.quests ?? {}).length,
      items: Object.keys(campaign.items ?? {}).length
    },
    worldState: clone(campaign.worldState),
    lastSession: clone(campaign.lastSession),
    recentFacts: publicRecords(campaign.facts, 8),
    recentNpcs: publicRecords(campaign.npcs, 8),
    relationships: publicRecords(campaign.relationships, 12),
    quests: publicRecords(campaign.quests, 12),
    items: publicRecords(campaign.items, 12)
  };
}

class CampaignMemoryBase {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.writeChain = Promise.resolve();
  }

  async readDatabase() {
    return normalizeDatabase({});
  }

  async writeDatabase() {}

  async mutate(operation) {
    const next = this.writeChain.then(async () => {
      const database = normalizeDatabase(await this.readDatabase());
      const result = await operation(database);
      database.updatedAt = nowIso();
      await this.writeDatabase(database);
      return clone(result);
    });
    this.writeChain = next.catch(() => {});
    return next;
  }

  async load(campaignInput) {
    const descriptor = campaignDescriptor(campaignInput);
    const database = normalizeDatabase(await this.readDatabase());
    const existing = database.campaigns[descriptor.worldId];
    return clone(existing ?? emptyCampaign(descriptor));
  }

  async startSession({ campaign, sessionId, context = {}, worldState = null } = {}) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaign ?? context.campaign);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      current.title = descriptor.title ?? current.title;
      current.systemId = descriptor.systemId ?? current.systemId;
      current.lastSession = {
        id: id(sessionId) || null,
        status: 'ACTIVE',
        sceneId: id(context.scene?.id) || null,
        sceneName: text(context.scene?.name, 300) || null,
        startedAt: nowIso(),
        endedAt: null
      };
      if (worldState) current.worldState = clone(worldState);
      current.updatedAt = nowIso();
      database.campaigns[descriptor.worldId] = current;
      return current;
    });
  }

  async applyRound({ campaign, eventId, sessionId, roundNumber, resolutions = [], npcCoordination = {}, worldState = null, narration = null, context = {} } = {}) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaign ?? context.campaign);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      const safeEventId = id(eventId, 300) || `round:${sessionId ?? 'session'}:${roundNumber ?? 0}`;
      if ((current.processedEventIds ?? []).includes(safeEventId)) return current;

      for (const resolution of resolutions) {
        const declaration = resolution?.declaration ?? {};
        const intent = resolution?.intent ?? {};
        const rules = resolution?.rules ?? {};
        const relationship = resolution?.relationship ?? {};
        const actorName = text(declaration.actorName, 300) || id(declaration.actorId) || 'Personagem';
        const factText = `${actorName}: ${text(declaration.content ?? intent.content, 1000) || 'ação registrada'} — ${text(rules.result?.effect, 500) || 'consequência narrativa registrada'}`;
        upsertInto(current, 'facts', {
          id: stableId('fact', `${safeEventId}:${declaration.actorId ?? actorName}`),
          key: `${safeEventId}:${declaration.actorId ?? actorName}`,
          text: factText,
          category: 'ROUND_EVENT',
          source: 'ROUND_RESOLUTION',
          sceneId: context.scene?.id ?? null,
          roundNumber,
          visibility: 'known'
        });

        if (relationship.npcId || relationship.npcName) {
          const npcRecord = upsertInto(current, 'npcs', {
            id: relationship.npcId,
            name: relationship.npcName,
            status: relationship.effect ?? relationship.relationshipType ?? 'OBSERVED',
            location: context.room?.name ?? context.scene?.name ?? null,
            lastSeenAt: nowIso()
          });
          if (declaration.actorId && npcRecord.id) {
            upsertInto(current, 'relationships', {
              actorId: declaration.actorId,
              actorName: declaration.actorName,
              npcId: npcRecord.id,
              npcName: npcRecord.name,
              delta: Number(relationship.disposition) || 0,
              historyEntry: relationship.effect ?? declaration.content ?? 'Interação registrada'
            });
          }
        }

        const quest = questFromText(declaration.content, declaration);
        if (quest) upsertInto(current, 'quests', quest);
        const item = itemFromText(declaration.content, declaration);
        if (item) upsertInto(current, 'items', item);
      }

      for (const reaction of npcCoordination.reactions ?? []) {
        upsertInto(current, 'npcs', {
          id: reaction.npcId,
          name: reaction.npcName,
          status: reaction.reaction,
          location: context.room?.name ?? context.scene?.name ?? null,
          lastSeenAt: nowIso()
        });
      }

      current.recentEvents = [...(current.recentEvents ?? []), {
        id: safeEventId,
        type: 'ROUND_RESOLVED',
        sessionId: id(sessionId) || null,
        roundNumber: Number(roundNumber) || null,
        sceneId: id(context.scene?.id) || null,
        narration: text(narration, 1500) || null,
        createdAt: nowIso()
      }].slice(-100);
      current.processedEventIds = [...(current.processedEventIds ?? []), safeEventId].slice(-500);
      current.worldState = clone(worldState ?? current.worldState);
      current.updatedAt = nowIso();
      database.campaigns[descriptor.worldId] = current;
      return current;
    });
  }

  async recordRoomEntry({ campaign, eventId, sessionId, room = {}, context = {}, narration = null, worldState = null } = {}) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaign ?? context.campaign);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      const safeEventId = id(eventId, 300) || `room:${sessionId ?? 'session'}:${room.id ?? room.name ?? 'unknown'}`;
      if ((current.processedEventIds ?? []).includes(safeEventId)) return current;
      const roomName = text(room.name, 300) || 'sala sem nome';
      upsertInto(current, 'facts', {
        id: stableId('fact', safeEventId),
        key: safeEventId,
        text: `O grupo alcançou ${roomName}.`,
        category: 'ROOM_ENTRY',
        source: 'ROOM_NARRATION',
        sceneId: context.scene?.id ?? null,
        visibility: 'known'
      });
      for (const actor of context.visibleActors ?? []) {
        if (String(actor?.type ?? '').toLowerCase() !== 'npc') continue;
        upsertInto(current, 'npcs', {
          id: actor.id,
          name: actor.name,
          status: 'PRESENT',
          location: roomName,
          lastSeenAt: nowIso()
        });
      }
      current.recentEvents = [...(current.recentEvents ?? []), {
        id: safeEventId,
        type: 'ROOM_ENTERED',
        sessionId: id(sessionId) || null,
        roomId: id(room.id) || null,
        roomName,
        narration: text(narration, 1500) || null,
        createdAt: nowIso()
      }].slice(-100);
      current.processedEventIds = [...(current.processedEventIds ?? []), safeEventId].slice(-500);
      current.worldState = clone(worldState ?? current.worldState);
      current.updatedAt = nowIso();
      database.campaigns[descriptor.worldId] = current;
      return current;
    });
  }

  async endSession({ campaign, sessionId, worldState = null } = {}) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaign);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      current.lastSession = {
        ...(current.lastSession ?? {}),
        id: id(sessionId) || current.lastSession?.id || null,
        status: 'ENDED',
        endedAt: nowIso()
      };
      current.worldState = clone(worldState ?? current.worldState);
      current.updatedAt = nowIso();
      database.campaigns[descriptor.worldId] = current;
      return current;
    });
  }

  async upsert(campaignInput, collectionName, record = {}) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaignInput);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      current.title = descriptor.title ?? current.title;
      current.systemId = descriptor.systemId ?? current.systemId;
      const saved = upsertInto(current, collectionName, record);
      database.campaigns[descriptor.worldId] = current;
      return { record: saved, campaign: current };
    });
  }

  async remove(campaignInput, collectionName, recordId) {
    return this.mutate((database) => {
      const descriptor = campaignDescriptor(campaignInput);
      const collection = normalizeCollectionName(collectionName);
      const current = database.campaigns[descriptor.worldId] ?? emptyCampaign(descriptor);
      const safeId = id(recordId);
      const removed = current[collection][safeId] ?? null;
      if (safeId) delete current[collection][safeId];
      current.updatedAt = nowIso();
      database.campaigns[descriptor.worldId] = current;
      return { removed, campaign: current };
    });
  }

  contextForNarration(campaignSnapshot) {
    const campaign = campaignSnapshot ?? emptyCampaign();
    const summary = summaryOf(campaign);
    return {
      campaignId: summary.campaignId,
      updatedAt: summary.updatedAt,
      counts: summary.counts,
      recentFacts: summary.recentFacts.slice(0, 6),
      npcs: summary.recentNpcs.slice(0, 6),
      relationships: summary.relationships.slice(0, 8),
      quests: summary.quests.filter((entry) => entry.status === 'ACTIVE').slice(0, 8),
      items: summary.items.filter((entry) => entry.status !== 'REMOVED').slice(0, 8)
    };
  }

  summary(campaignSnapshot) {
    return summaryOf(campaignSnapshot ?? emptyCampaign());
  }
}

export class InMemoryCampaignMemory extends CampaignMemoryBase {
  constructor(options = {}) {
    super(options);
    this.database = normalizeDatabase({});
  }

  async readDatabase() {
    return clone(this.database);
  }

  async writeDatabase(database) {
    this.database = clone(database);
  }

  append(event) {
    return this.upsert('default', 'facts', {
      text: event?.text ?? JSON.stringify(event),
      source: 'LEGACY_APPEND'
    });
  }

  async list() {
    const campaign = await this.load('default');
    return Object.values(campaign.facts);
  }
}

export class FileCampaignMemory extends CampaignMemoryBase {
  constructor({ filePath = './data/campaign-memory.json', logger = console } = {}) {
    super({ logger });
    this.filePath = resolve(filePath);
  }

  async readDatabase() {
    try {
      return normalizeDatabase(JSON.parse(await readFile(this.filePath, 'utf8')));
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeDatabase({});
      this.logger.error?.('[Mestre Orc][CampaignMemory] falha ao ler memória persistente', {
        filePath: this.filePath,
        message: error.message
      });
      throw error;
    }
  }

  async writeDatabase(database) {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

export function createCampaignMemoryFromEnv({ env = process.env, logger = console } = {}) {
  return new FileCampaignMemory({
    filePath: env.MESTRE_ORC_CAMPAIGN_MEMORY_FILE || './data/campaign-memory.json',
    logger
  });
}
