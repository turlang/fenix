import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const TutorModes = Object.freeze(['SHEET', 'GM']);
const DATABASE_VERSION = 1;
const MAX_HISTORY = 100;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cleanText(value, limit = 4000) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanId(value, limit = 200) {
  return cleanText(value, limit);
}

function nowIso() {
  return new Date().toISOString();
}

function stableId(prefix, value) {
  return `${prefix}:${createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 20)}`;
}

function emptyCampaign(campaignId) {
  return { campaignId, createdAt: nowIso(), updatedAt: nowIso(), entries: [] };
}

function normalizeDatabase(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: DATABASE_VERSION,
    updatedAt: source.updatedAt ?? null,
    campaigns: source.campaigns && typeof source.campaigns === 'object' ? source.campaigns : {}
  };
}

function compactObject(value, { depth = 0, maxDepth = 5, maxArray = 40, maxKeys = 80 } = {}) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return cleanText(value, 1200);
  if (depth >= maxDepth) return '[limite de profundidade]';
  if (Array.isArray(value)) return value.slice(0, maxArray).map((entry) => compactObject(entry, { depth: depth + 1, maxDepth, maxArray, maxKeys }));
  if (typeof value !== 'object') return cleanText(value, 500);
  const result = {};
  const blocked = /(?:password|secretkey|api[_-]?key|authorization|cookie|tokenvalue|credential)/i;
  for (const [key, entry] of Object.entries(value).slice(0, maxKeys)) {
    if (blocked.test(key)) continue;
    result[cleanText(key, 120)] = compactObject(entry, { depth: depth + 1, maxDepth, maxArray, maxKeys });
  }
  return result;
}

function normalizeRequester(value = {}) {
  return {
    id: cleanId(value.id) || 'anonymous',
    name: cleanText(value.name, 300) || 'Usuário',
    isGM: Boolean(value.isGM)
  };
}

function normalizeAccess(value = {}) {
  return {
    canView: value.canView !== false,
    isOwner: Boolean(value.isOwner),
    canEdit: Boolean(value.canEdit)
  };
}

function normalizeActor(value = {}) {
  const actor = compactObject(value);
  return {
    id: cleanId(actor?.id ?? actor?._id),
    uuid: cleanId(actor?.uuid),
    name: cleanText(actor?.name, 300) || 'Personagem sem nome',
    type: cleanId(actor?.type, 100) || 'character',
    systemId: cleanId(actor?.systemId ?? actor?.system?.id, 100) || 'generic',
    level: Number(actor?.level ?? actor?.summary?.level ?? actor?.system?.details?.level) || null,
    classes: Array.isArray(actor?.classes) ? actor.classes.slice(0, 20) : [],
    abilities: actor?.abilities && typeof actor.abilities === 'object' ? actor.abilities : {},
    skills: actor?.skills && typeof actor.skills === 'object' ? actor.skills : {},
    attributes: actor?.attributes && typeof actor.attributes === 'object' ? actor.attributes : {},
    resources: actor?.resources && typeof actor.resources === 'object' ? actor.resources : {},
    traits: actor?.traits && typeof actor.traits === 'object' ? actor.traits : {},
    spells: Array.isArray(actor?.spells) ? actor.spells.slice(0, 80) : [],
    items: Array.isArray(actor?.items) ? actor.items.slice(0, 120) : [],
    effects: Array.isArray(actor?.effects) ? actor.effects.slice(0, 60) : [],
    rawSummary: actor?.rawSummary && typeof actor.rawSummary === 'object' ? actor.rawSummary : null
  };
}

function scalar(value) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object') {
    for (const key of ['value', 'total', 'mod', 'max', 'label', 'name']) {
      if (value[key] != null && ['string', 'number', 'boolean'].includes(typeof value[key])) return value[key];
    }
  }
  return null;
}

function actorFacts(actor) {
  const facts = [];
  const add = (path, label, value) => {
    const normalized = scalar(value);
    if (normalized == null || normalized === '') return;
    facts.push({ id: stableId('fact', `${actor.id}:${path}`), path, label, value: normalized });
  };
  add('name', 'Personagem', actor.name);
  add('type', 'Tipo', actor.type);
  add('level', 'Nível', actor.level);
  for (const [key, value] of Object.entries(actor.abilities ?? {}).slice(0, 20)) add(`abilities.${key}`, `Atributo ${key}`, value);
  for (const [key, value] of Object.entries(actor.skills ?? {}).slice(0, 40)) add(`skills.${key}`, `Perícia ${key}`, value);
  for (const [key, value] of Object.entries(actor.attributes ?? {}).slice(0, 40)) add(`attributes.${key}`, `Atributo derivado ${key}`, value);
  for (const [key, value] of Object.entries(actor.resources ?? {}).slice(0, 30)) add(`resources.${key}`, `Recurso ${key}`, value);
  for (const entry of actor.classes.slice(0, 20)) {
    const name = cleanText(entry?.name ?? entry?.label, 200);
    const level = scalar(entry?.level ?? entry?.levels);
    if (name) facts.push({ id: stableId('fact', `${actor.id}:class:${name}`), path: `classes.${name}`, label: `Classe ${name}`, value: level ?? 'presente' });
  }
  facts.push(...actor.items.slice(0, 80).map((entry, index) => ({
    id: stableId('fact', `${actor.id}:item:${entry?.id ?? entry?._id ?? entry?.name ?? index}`),
    path: `items.${entry?.id ?? index}`,
    label: cleanText(entry?.name, 240) || `Item ${index + 1}`,
    value: cleanText(entry?.type ?? entry?.category ?? 'item', 100)
  })));
  return facts.slice(0, 180);
}

function parseStructuredAnswer(value) {
  if (value && typeof value === 'object') return value;
  const text = cleanText(value, 20000);
  if (!text) return null;
  const candidate = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(candidate); }
  catch { return { answer: text }; }
}

function normalizeTutorAnswer(value, { mode, facts = [], providerUsed = false } = {}) {
  const source = parseStructuredAnswer(value) ?? {};
  const knownIds = new Set(facts.map((entry) => entry.id));
  const sources = (Array.isArray(source.sources) ? source.sources : [])
    .map((entry) => typeof entry === 'string' ? entry : entry?.id)
    .filter((entry) => knownIds.has(entry))
    .slice(0, 20);
  return {
    answer: cleanText(source.answer ?? source.response ?? source.text, 12000) || 'Não foi possível produzir uma orientação útil com os dados disponíveis.',
    confidence: ['HIGH', 'MEDIUM', 'LOW'].includes(String(source.confidence).toUpperCase()) ? String(source.confidence).toUpperCase() : (providerUsed ? 'MEDIUM' : 'LOW'),
    sources,
    warnings: (Array.isArray(source.warnings) ? source.warnings : []).map((entry) => cleanText(entry, 700)).filter(Boolean).slice(0, 12),
    suggestedActions: (Array.isArray(source.suggestedActions) ? source.suggestedActions : []).map((entry) => cleanText(entry, 700)).filter(Boolean).slice(0, 12),
    mode,
    nonAuthoritative: true,
    automaticChanges: false
  };
}

function sheetFallback(question, actor, facts) {
  const normalized = cleanText(question, 2000).toLocaleLowerCase('pt-BR');
  const relevant = facts.filter((entry) => normalized.split(/\W+/).some((token) => token.length >= 3 && `${entry.label} ${entry.path}`.toLocaleLowerCase('pt-BR').includes(token))).slice(0, 8);
  const selected = relevant.length ? relevant : facts.slice(0, 8);
  const lines = selected.map((entry) => `${entry.label}: ${entry.value}`).join('; ');
  return {
    answer: `A ficha de ${actor.name} confirma estes dados: ${lines || 'nenhum campo reconhecido foi enviado pelo Foundry'}. Sem um provedor de IA ativo, o tutor não interpreta regras além do que está explicitamente presente na ficha.`,
    confidence: selected.length ? 'MEDIUM' : 'LOW',
    sources: selected.map((entry) => entry.id),
    warnings: ['Orientação consultiva: confirme a redação da habilidade e a decisão final com o mestre.'],
    suggestedActions: ['Abra o item ou recurso citado na ficha e confira usos, alcance, duração e consumo antes de agir.']
  };
}

function gmFallback(question, context) {
  const sceneName = cleanText(context?.scene?.name, 300) || 'cena atual';
  const combat = context?.combat?.active ? `Há combate ativo na rodada ${Number(context.combat.round) || 1}.` : 'Não há combate ativo informado.';
  const memoryCount = Object.values(context?.memory ?? {}).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const refs = Array.isArray(context?.references) ? context.references.length : 0;
  return {
    answer: `Para decidir sobre “${cleanText(question, 500)}” em ${sceneName}, separe fatos confirmados, intenção dos jogadores e consequência reversível. ${combat} O contexto disponível contém ${memoryCount} registros de memória e ${refs} referência(s) da biblioteca. Apresente a situação, peça a decisão ou rolagem necessária e deixe a consequência mais importante visível antes de avançar.`,
    confidence: 'LOW',
    sources: [],
    warnings: ['Sem IA configurada, esta é uma orientação estrutural e não uma resposta específica de regra.'],
    suggestedActions: ['Defina o que está em risco.', 'Escolha uma consequência em caso de sucesso e outra em caso de falha.', 'Confirme qualquer regra oficial no material do sistema usado pela mesa.']
  };
}

export class InMemoryTutorService {
  constructor({ narrator = null, campaignMemory = null, adventureLibrary = null, logger = console } = {}) {
    this.narrator = narrator;
    this.campaignMemory = campaignMemory;
    this.adventureLibrary = adventureLibrary;
    this.logger = logger;
    this.store = normalizeDatabase(null);
  }

  async loadStore() { return clone(this.store); }
  async saveStore(store) { this.store = normalizeDatabase(clone(store)); }

  async askSheet(campaignId, input = {}) {
    const requester = normalizeRequester(input.requester);
    const access = normalizeAccess(input.access);
    if (!access.canView || (!requester.isGM && !access.isOwner)) {
      const error = new Error('O Tutor de Ficha só pode consultar uma ficha pertencente ao usuário ou visível ao mestre.');
      error.code = 'TUTOR_SHEET_FORBIDDEN';
      error.statusCode = 403;
      throw error;
    }
    const question = cleanText(input.question, 2000);
    if (question.length < 3) throw new TypeError('Escreva uma pergunta com pelo menos 3 caracteres.');
    const actor = normalizeActor(input.actor);
    if (!actor.id) throw new TypeError('Uma ficha válida precisa ser enviada ao tutor.');
    const facts = actorFacts(actor);
    let raw = null;
    let providerUsed = false;
    if (typeof this.narrator?.answerSheetTutor === 'function') {
      raw = await this.narrator.answerSheetTutor({ question, actor, facts, campaign: compactObject(input.campaign ?? {}) });
      providerUsed = true;
    } else raw = sheetFallback(question, actor, facts);
    const answer = normalizeTutorAnswer(raw, { mode: 'SHEET', facts, providerUsed });
    if (!answer.warnings.some((entry) => /consultiv/i.test(entry))) answer.warnings.push('O Tutor de Ficha é consultivo e nunca altera a ficha automaticamente.');
    const entry = await this.record(campaignId, { mode: 'SHEET', question, answer, requester, actorId: actor.id, actorName: actor.name, visibility: requester.isGM ? 'GM_OR_OWNER' : 'OWNER_ONLY' });
    return { ...answer, questionId: entry.id, actor: { id: actor.id, name: actor.name, type: actor.type }, sourceFacts: facts.filter((entryFact) => answer.sources.includes(entryFact.id)) };
  }

  async askGm(campaignId, input = {}) {
    const requester = normalizeRequester(input.requester);
    if (!requester.isGM) {
      const error = new Error('Somente o mestre pode utilizar o Tutor de Mestre.');
      error.code = 'TUTOR_GM_FORBIDDEN';
      error.statusCode = 403;
      throw error;
    }
    const question = cleanText(input.question, 3000);
    if (question.length < 3) throw new TypeError('Escreva uma pergunta com pelo menos 3 caracteres.');
    const memorySnapshot = this.campaignMemory?.load ? await this.campaignMemory.load(campaignId) : null;
    const references = this.adventureLibrary?.search ? await this.adventureLibrary.search(campaignId, question, { limit: 6, narrationSafeOnly: false }) : [];
    const memory = memorySnapshot ? {
      facts: Object.values(memorySnapshot.facts ?? {}).slice(-20),
      npcs: Object.values(memorySnapshot.npcs ?? {}).slice(-20),
      relationships: Object.values(memorySnapshot.relationships ?? {}).slice(-20),
      quests: Object.values(memorySnapshot.quests ?? {}).slice(-20),
      items: Object.values(memorySnapshot.items ?? {}).slice(-20),
      recentEvents: (memorySnapshot.recentEvents ?? []).slice(-20),
      worldState: memorySnapshot.worldState ?? null
    } : {};
    const context = {
      scene: compactObject(input.scene ?? {}),
      combat: compactObject(input.combat ?? {}),
      party: compactObject(input.party ?? []),
      campaign: compactObject(input.campaign ?? {}),
      memory,
      references: references.map((entry) => ({
        documentId: entry.document?.id,
        documentTitle: entry.document?.title,
        heading: entry.chunk?.heading,
        text: cleanText(entry.chunk?.text, 1800),
        access: entry.chunk?.access
      }))
    };
    const referenceFacts = context.references.map((entry, index) => ({ id: stableId('reference', `${entry.documentId}:${entry.heading}:${index}`), path: `references.${index}`, label: `${entry.documentTitle} — ${entry.heading}`, value: entry.text }));
    let raw = null;
    let providerUsed = false;
    if (typeof this.narrator?.answerGmTutor === 'function') {
      raw = await this.narrator.answerGmTutor({ question, context, facts: referenceFacts });
      providerUsed = true;
    } else raw = gmFallback(question, context);
    const answer = normalizeTutorAnswer(raw, { mode: 'GM', facts: referenceFacts, providerUsed });
    if (!answer.warnings.some((entry) => /decisão final|consultiv/i.test(entry))) answer.warnings.push('A orientação é consultiva; a decisão final e qualquer alteração no mundo permanecem com o mestre.');
    const entry = await this.record(campaignId, { mode: 'GM', question, answer, requester, actorId: null, actorName: null, visibility: 'GM_ONLY' });
    return { ...answer, questionId: entry.id, contextSummary: { referenceCount: references.length, memoryRecords: Object.values(memory).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0) }, sourceFacts: referenceFacts.filter((fact) => answer.sources.includes(fact.id)) };
  }

  async record(campaignId, input) {
    const id = cleanId(campaignId) || 'default';
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    const entry = {
      id: randomUUID(),
      mode: input.mode,
      question: input.question,
      answer: input.answer.answer,
      confidence: input.answer.confidence,
      warnings: input.answer.warnings,
      suggestedActions: input.answer.suggestedActions,
      requesterId: input.requester.id,
      requesterName: input.requester.name,
      actorId: input.actorId,
      actorName: input.actorName,
      visibility: input.visibility,
      createdAt: nowIso()
    };
    campaign.entries = [...(campaign.entries ?? []), entry].slice(-MAX_HISTORY);
    campaign.updatedAt = entry.createdAt;
    store.campaigns[id] = campaign;
    store.updatedAt = entry.createdAt;
    await this.saveStore(store);
    return clone(entry);
  }

  async history(campaignId, requester = {}) {
    const id = cleanId(campaignId) || 'default';
    const who = normalizeRequester(requester);
    const store = await this.loadStore();
    const entries = store.campaigns[id]?.entries ?? [];
    return entries.filter((entry) => who.isGM || entry.requesterId === who.id).map(clone).reverse();
  }
}

export class FileTutorService extends InMemoryTutorService {
  constructor({ filePath = resolve(process.cwd(), 'data/tutor-history.json'), ...options } = {}) {
    super(options);
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async loadStore() {
    try { return normalizeDatabase(JSON.parse(await readFile(this.filePath, 'utf8'))); }
    catch (error) {
      if (error?.code === 'ENOENT') return normalizeDatabase(null);
      throw error;
    }
  }

  async saveStore(store) {
    const normalized = normalizeDatabase(store);
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      await rename(temp, this.filePath);
    });
    return this.writeQueue;
  }
}

export function createTutorServiceFromEnv(options = {}) {
  return new FileTutorService({ filePath: process.env.TUTOR_HISTORY_FILE || resolve(process.cwd(), 'data/tutor-history.json'), ...options });
}

export const tutorInternals = {
  cleanText,
  compactObject,
  normalizeActor,
  actorFacts,
  parseStructuredAnswer,
  normalizeTutorAnswer,
  sheetFallback,
  gmFallback
};
