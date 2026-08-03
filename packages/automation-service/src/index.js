import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const AutomationActionTypes = Object.freeze([
  'CHAT_MESSAGE',
  'CREATE_JOURNAL',
  'APPEND_JOURNAL_PAGE',
  'CREATE_SCENE_NOTE',
  'UPDATE_ACTOR_RESOURCE'
]);

export const AutomationStatuses = Object.freeze([
  'PENDING',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'REJECTED',
  'ROLLING_BACK',
  'ROLLED_BACK'
]);

export const AutomationRisks = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);

const DATABASE_VERSION = 1;
const MAX_PROPOSALS_PER_CAMPAIGN = 500;
const MAX_AUDIT_EVENTS = 5000;
const MAX_PROPOSAL_AUDIT_EVENTS = 500;
const ACTOR_RESOURCE_PATH = /^system\.(?:attributes\.(?:hp|exhaustion)\.(?:value|max|temp)|resources\.[A-Za-z0-9_-]+\.(?:value|max)|currency\.[A-Za-z0-9_-]+)$/;

const ACTION_DEFINITIONS = Object.freeze({
  CHAT_MESSAGE: {
    label: 'Publicar mensagem no chat', risk: 'LOW', reversible: true,
    description: 'Cria uma mensagem no chat com visibilidade definida pelo mestre.'
  },
  CREATE_JOURNAL: {
    label: 'Criar Journal', risk: 'LOW', reversible: true,
    description: 'Cria um novo Journal com uma página de texto.'
  },
  APPEND_JOURNAL_PAGE: {
    label: 'Adicionar página a Journal', risk: 'MEDIUM', reversible: true,
    description: 'Cria uma nova página em um Journal existente.'
  },
  CREATE_SCENE_NOTE: {
    label: 'Criar Note na Scene', risk: 'MEDIUM', reversible: true,
    description: 'Cria um marcador na Scene vinculado a um Journal ou página existente.'
  },
  UPDATE_ACTOR_RESOURCE: {
    label: 'Atualizar recurso da ficha', risk: 'HIGH', reversible: true,
    description: 'Altera um único recurso numérico permitido na ficha e registra o valor anterior para reversão.'
  }
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, limit = 4000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function cleanId(value, limit = 200) {
  return cleanText(value, limit);
}

function cleanHtml(value, limit = 12000) {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, limit);
}

function compactObject(value, { depth = 0, maxDepth = 5, maxArray = 60, maxKeys = 100 } = {}) {
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return cleanText(value, 2500);
  if (depth >= maxDepth) return '[limite de profundidade]';
  if (Array.isArray(value)) return value.slice(0, maxArray).map((entry) => compactObject(entry, { depth: depth + 1, maxDepth, maxArray, maxKeys }));
  if (typeof value !== 'object') return cleanText(value, 500);
  const result = {};
  const blocked = /(?:password|secretkey|api[_-]?key|authorization|cookie|credential|access[_-]?token|refresh[_-]?token)/i;
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

function requireGm(requester) {
  const normalized = normalizeRequester(requester);
  if (!normalized.isGM) {
    const error = new Error('Somente um mestre pode criar, aprovar ou executar automações.');
    error.code = 'AUTOMATION_GM_REQUIRED';
    error.statusCode = 403;
    throw error;
  }
  return normalized;
}

function numberValue(value, { min = -1_000_000, max = 1_000_000, name = 'valor' } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const error = new Error(`${name} deve ser um número entre ${min} e ${max}.`);
    error.code = 'AUTOMATION_INVALID_PAYLOAD';
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function requiredText(value, name, limit) {
  const result = cleanText(value, limit);
  if (!result) {
    const error = new Error(`${name} é obrigatório.`);
    error.code = 'AUTOMATION_INVALID_PAYLOAD';
    error.statusCode = 400;
    throw error;
  }
  return result;
}

function sanitizePayload(actionType, payload = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  if (actionType === 'CHAT_MESSAGE') {
    const visibility = ['PUBLIC', 'GM', 'WHISPER'].includes(source.visibility) ? source.visibility : 'PUBLIC';
    return {
      content: requiredText(source.content, 'content', 6000),
      flavor: cleanText(source.flavor, 500) || null,
      visibility,
      recipientUserIds: visibility === 'WHISPER'
        ? [...new Set((Array.isArray(source.recipientUserIds) ? source.recipientUserIds : []).map((entry) => cleanId(entry)).filter(Boolean))].slice(0, 50)
        : []
    };
  }
  if (actionType === 'CREATE_JOURNAL') {
    return {
      name: requiredText(source.name, 'name', 300),
      pageName: cleanText(source.pageName, 300) || 'Notas',
      content: cleanHtml(source.content, 16000),
      folderId: cleanId(source.folderId) || null
    };
  }
  if (actionType === 'APPEND_JOURNAL_PAGE') {
    return {
      journalId: requiredText(source.journalId, 'journalId', 200),
      pageName: requiredText(source.pageName ?? source.name, 'pageName', 300),
      content: cleanHtml(source.content, 16000)
    };
  }
  if (actionType === 'CREATE_SCENE_NOTE') {
    return {
      sceneId: cleanId(source.sceneId) || null,
      journalId: requiredText(source.journalId, 'journalId', 200),
      pageId: cleanId(source.pageId) || null,
      x: numberValue(source.x, { min: -100000, max: 100000, name: 'x' }),
      y: numberValue(source.y, { min: -100000, max: 100000, name: 'y' }),
      icon: cleanText(source.icon, 500) || 'icons/svg/book.svg',
      label: cleanText(source.label, 300) || null
    };
  }
  if (actionType === 'UPDATE_ACTOR_RESOURCE') {
    const path = requiredText(source.path, 'path', 300);
    if (!ACTOR_RESOURCE_PATH.test(path)) {
      const error = new Error('O caminho solicitado não pertence à lista segura de recursos editáveis.');
      error.code = 'AUTOMATION_RESOURCE_PATH_FORBIDDEN';
      error.statusCode = 400;
      throw error;
    }
    return {
      actorId: requiredText(source.actorId, 'actorId', 200),
      actorName: cleanText(source.actorName, 300) || null,
      path,
      value: numberValue(source.value, { min: -1_000_000, max: 1_000_000, name: 'value' }),
      reason: cleanText(source.reason, 1000) || null
    };
  }
  const error = new Error('Tipo de automação não permitido.');
  error.code = 'AUTOMATION_ACTION_NOT_ALLOWED';
  error.statusCode = 400;
  throw error;
}

function normalizeActionType(value) {
  const normalized = cleanText(value, 80).toUpperCase();
  if (!AutomationActionTypes.includes(normalized)) {
    const error = new Error('Tipo de automação não permitido.');
    error.code = 'AUTOMATION_ACTION_NOT_ALLOWED';
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

function proposalFingerprint(actionType, payload) {
  return createHash('sha256').update(JSON.stringify({ actionType, payload })).digest('hex');
}

function auditEvent(type, requester, details = {}) {
  return {
    id: randomUUID(),
    type,
    at: nowIso(),
    requester: requester ? { id: requester.id, name: requester.name, isGM: requester.isGM } : null,
    details: compactObject(details, { maxDepth: 4, maxArray: 30, maxKeys: 60 })
  };
}

function emptyCampaign(campaignId) {
  return { campaignId, createdAt: nowIso(), updatedAt: nowIso(), proposals: [], audit: [] };
}

function normalizeDatabase(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: DATABASE_VERSION,
    updatedAt: source.updatedAt ?? null,
    campaigns: source.campaigns && typeof source.campaigns === 'object' ? source.campaigns : {}
  };
}

function parseStructured(value) {
  if (value && typeof value === 'object') return value;
  const text = String(value ?? '').trim();
  if (!text) return null;
  const candidate = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(candidate); }
  catch { return null; }
}

function normalizeSuggestionEntries(value) {
  const parsed = parseStructured(value);
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.proposals) ? parsed.proposals : [];
  const normalized = [];
  for (const entry of entries.slice(0, 5)) {
    try {
      const actionType = normalizeActionType(entry?.actionType ?? entry?.type);
      const payload = sanitizePayload(actionType, entry?.payload ?? {});
      normalized.push({
        actionType,
        payload,
        title: cleanText(entry?.title, 300) || ACTION_DEFINITIONS[actionType].label,
        rationale: cleanText(entry?.rationale ?? entry?.reason, 1500) || 'Proposta assistida para revisão do mestre.',
        warnings: (Array.isArray(entry?.warnings) ? entry.warnings : []).map((item) => cleanText(item, 600)).filter(Boolean).slice(0, 10)
      });
    } catch {
      // Entradas inválidas ou perigosas são descartadas individualmente.
    }
  }
  return normalized;
}

function fallbackSuggestion(goal, context = {}) {
  const sceneName = cleanText(context?.scene?.name, 300);
  const content = [
    `<h2>Plano assistido</h2>`,
    `<p><strong>Objetivo do mestre:</strong> ${escapeHtml(goal)}</p>`,
    sceneName ? `<p><strong>Cena:</strong> ${escapeHtml(sceneName)}</p>` : '',
    '<ul><li>Revise o objetivo.</li><li>Confirme os documentos que podem ser afetados.</li><li>Execute somente após validar a prévia.</li></ul>'
  ].filter(Boolean).join('');
  return [{
    actionType: 'CREATE_JOURNAL',
    title: `Plano assistido — ${cleanText(goal, 80)}`,
    rationale: 'Nenhum provedor de IA estava disponível. Foi criada apenas uma proposta reversível de planejamento, sem alterar fichas ou cenas.',
    warnings: ['A proposta não executa mudanças automaticamente.'],
    payload: { name: `Plano assistido — ${cleanText(goal, 80)}`, pageName: 'Revisão', content, folderId: null }
  }];
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function publicProposal(proposal, { includeAudit = false } = {}) {
  const output = clone(proposal);
  if (output.execution) delete output.execution.token;
  if (output.rollback) delete output.rollback.token;
  if (!includeAudit) delete output.audit;
  return output;
}

function campaignSummary(campaign) {
  const counts = Object.fromEntries(AutomationStatuses.map((status) => [status, 0]));
  for (const proposal of campaign.proposals ?? []) counts[proposal.status] = (counts[proposal.status] ?? 0) + 1;
  return { campaignId: campaign.campaignId, total: campaign.proposals?.length ?? 0, counts, updatedAt: campaign.updatedAt };
}

export class InMemoryAutomationService {
  constructor({ narrator = null, logger = console } = {}) {
    this.narrator = narrator;
    this.logger = logger;
    this.store = normalizeDatabase(null);
    this.operationQueue = Promise.resolve();
  }

  async loadStore() { return clone(this.store); }
  async saveStore(store) { this.store = normalizeDatabase(store); }

  async mutate(operation) {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.catch(() => undefined);
    return run;
  }

  definitions() {
    return {
      actionTypes: AutomationActionTypes,
      statuses: AutomationStatuses,
      risks: AutomationRisks,
      actions: Object.entries(ACTION_DEFINITIONS).map(([id, definition]) => ({ id, ...definition }))
    };
  }

  async list(campaignId, { status = null, actionType = null } = {}) {
    const id = cleanId(campaignId) || 'default';
    const store = await this.loadStore();
    const campaign = store.campaigns[id] ?? emptyCampaign(id);
    let proposals = campaign.proposals ?? [];
    if (status && AutomationStatuses.includes(status)) proposals = proposals.filter((entry) => entry.status === status);
    if (actionType && AutomationActionTypes.includes(actionType)) proposals = proposals.filter((entry) => entry.actionType === actionType);
    return { ...campaignSummary(campaign), proposals: proposals.map((entry) => publicProposal(entry)).reverse() };
  }

  async get(campaignId, proposalId) {
    const id = cleanId(campaignId) || 'default';
    const store = await this.loadStore();
    const proposal = store.campaigns[id]?.proposals?.find((entry) => entry.id === proposalId) ?? null;
    return proposal ? publicProposal(proposal, { includeAudit: true }) : null;
  }

  async create(campaignId, input = {}, { source = 'MANUAL' } = {}) {
    const requester = requireGm(input.requester);
    const actionType = normalizeActionType(input.actionType);
    const payload = sanitizePayload(actionType, input.payload ?? {});
    return this.mutate(async () => {
      const id = cleanId(campaignId) || 'default';
      const store = await this.loadStore();
      const campaign = store.campaigns[id] ?? emptyCampaign(id);
      const fingerprint = proposalFingerprint(actionType, payload);
      const duplicate = campaign.proposals.find((entry) => entry.fingerprint === fingerprint && ['PENDING', 'APPROVED', 'EXECUTING'].includes(entry.status));
      if (duplicate) return { proposal: publicProposal(duplicate, { includeAudit: true }), duplicate: true, summary: campaignSummary(campaign) };

      const definition = ACTION_DEFINITIONS[actionType];
      const createdAt = nowIso();
      const proposal = {
        id: randomUUID(), campaignId: id, revision: 1,
        status: 'PENDING', actionType, title: cleanText(input.title, 300) || definition.label,
        rationale: cleanText(input.rationale, 1500) || 'Proposta criada para revisão explícita do mestre.',
        warnings: (Array.isArray(input.warnings) ? input.warnings : []).map((entry) => cleanText(entry, 600)).filter(Boolean).slice(0, 10),
        risk: definition.risk, reversible: definition.reversible,
        payload, preview: { action: definition.label, description: definition.description, affected: compactObject(payload) },
        source: source === 'AI' ? 'AI' : 'MANUAL', fingerprint,
        createdBy: { id: requester.id, name: requester.name }, createdAt, updatedAt: createdAt,
        approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
        execution: null, rollback: null,
        audit: [auditEvent('CREATED', requester, { source, actionType, risk: definition.risk })]
      };
      campaign.proposals.push(proposal);
      if (campaign.proposals.length > MAX_PROPOSALS_PER_CAMPAIGN) campaign.proposals.splice(0, campaign.proposals.length - MAX_PROPOSALS_PER_CAMPAIGN);
      campaign.audit.push(...proposal.audit);
      if (campaign.audit.length > MAX_AUDIT_EVENTS) campaign.audit.splice(0, campaign.audit.length - MAX_AUDIT_EVENTS);
      campaign.updatedAt = createdAt;
      store.campaigns[id] = campaign;
      store.updatedAt = createdAt;
      await this.saveStore(store);
      return { proposal: publicProposal(proposal, { includeAudit: true }), duplicate: false, summary: campaignSummary(campaign) };
    });
  }

  async suggest(campaignId, input = {}) {
    const requester = requireGm(input.requester);
    const goal = requiredText(input.goal, 'goal', 3000);
    const context = compactObject(input.context ?? {}, { maxDepth: 5, maxArray: 60, maxKeys: 100 });
    let suggestions = [];
    let fallback = false;
    if (this.narrator && typeof this.narrator.suggestAutomations === 'function') {
      try {
        const raw = await this.narrator.suggestAutomations({ goal, context, allowedActions: this.definitions().actions });
        suggestions = normalizeSuggestionEntries(raw);
      } catch (error) {
        this.logger.warn?.('[Mestre Orc][Automações] provedor indisponível; usando fallback seguro', { code: error?.code ?? 'AI_FAILED' });
      }
    }
    if (!suggestions.length) {
      suggestions = fallbackSuggestion(goal, context);
      fallback = true;
    }
    const created = [];
    for (const suggestion of suggestions) {
      const result = await this.create(campaignId, { ...suggestion, requester }, { source: fallback ? 'MANUAL' : 'AI' });
      created.push(result.proposal);
    }
    return { proposals: created, fallback, automaticExecution: false, approvalRequired: true };
  }

  async transition(campaignId, proposalId, input, operation) {
    const requester = requireGm(input?.requester);
    return this.mutate(async () => {
      const id = cleanId(campaignId) || 'default';
      const store = await this.loadStore();
      const campaign = store.campaigns[id];
      const proposal = campaign?.proposals?.find((entry) => entry.id === proposalId);
      if (!proposal) return null;
      if (input?.expectedRevision != null && Number(input.expectedRevision) !== proposal.revision) {
        const error = new Error('A proposta foi alterada por outra operação. Atualize o painel antes de continuar.');
        error.code = 'AUTOMATION_REVISION_CONFLICT';
        error.statusCode = 409;
        throw error;
      }
      const extra = await operation({ proposal, campaign, requester }) ?? {};
      if (proposal.audit.length > MAX_PROPOSAL_AUDIT_EVENTS) {
        proposal.audit.splice(0, proposal.audit.length - MAX_PROPOSAL_AUDIT_EVENTS);
      }
      if (campaign.audit.length > MAX_AUDIT_EVENTS) {
        campaign.audit.splice(0, campaign.audit.length - MAX_AUDIT_EVENTS);
      }
      proposal.revision += 1;
      proposal.updatedAt = nowIso();
      campaign.updatedAt = proposal.updatedAt;
      store.updatedAt = proposal.updatedAt;
      await this.saveStore(store);
      return { ...extra, proposal: publicProposal(proposal, { includeAudit: true }), summary: campaignSummary(campaign) };
    });
  }

  approve(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (!['PENDING', 'FAILED'].includes(proposal.status)) {
        const error = new Error('Somente propostas pendentes ou com falha podem ser aprovadas.');
        error.code = 'AUTOMATION_INVALID_STATE'; error.statusCode = 409; throw error;
      }
      proposal.status = 'APPROVED';
      proposal.approvedBy = { id: requester.id, name: requester.name };
      proposal.approvedAt = nowIso();
      proposal.rejectedBy = null; proposal.rejectedAt = null;
      proposal.execution = null;
      const event = auditEvent('APPROVED', requester, { risk: proposal.risk, actionType: proposal.actionType });
      proposal.audit.push(event); campaign.audit.push(event);
    });
  }

  reject(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (!['PENDING', 'APPROVED', 'FAILED'].includes(proposal.status)) {
        const error = new Error('Esta proposta não pode ser rejeitada no estado atual.');
        error.code = 'AUTOMATION_INVALID_STATE'; error.statusCode = 409; throw error;
      }
      proposal.status = 'REJECTED';
      proposal.rejectedBy = { id: requester.id, name: requester.name };
      proposal.rejectedAt = nowIso();
      proposal.rejectionReason = cleanText(input.reason, 1000) || null;
      const event = auditEvent('REJECTED', requester, { reason: proposal.rejectionReason });
      proposal.audit.push(event); campaign.audit.push(event);
    });
  }

  claimExecution(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (proposal.status === 'EXECUTING' && proposal.execution?.requestedBy?.id === requester.id) return { executionToken: proposal.execution.token };
      if (proposal.status !== 'APPROVED') {
        const error = new Error('A proposta precisa estar aprovada antes da execução.');
        error.code = 'AUTOMATION_NOT_APPROVED'; error.statusCode = 409; throw error;
      }
      proposal.status = 'EXECUTING';
      proposal.execution = {
        token: randomUUID(), requestedBy: { id: requester.id, name: requester.name }, startedAt: nowIso(), completedAt: null,
        receipt: null, error: null
      };
      const event = auditEvent('EXECUTION_CLAIMED', requester, { actionType: proposal.actionType });
      proposal.audit.push(event); campaign.audit.push(event);
      return { executionToken: proposal.execution.token };
    });
  }

  completeExecution(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (proposal.status !== 'EXECUTING' || !proposal.execution) {
        const error = new Error('Não há execução ativa para esta proposta.');
        error.code = 'AUTOMATION_INVALID_STATE'; error.statusCode = 409; throw error;
      }
      if (!input.executionToken || input.executionToken !== proposal.execution.token) {
        const error = new Error('Token de execução inválido.');
        error.code = 'AUTOMATION_EXECUTION_TOKEN_INVALID'; error.statusCode = 409; throw error;
      }
      const success = Boolean(input.success);
      proposal.status = success ? 'EXECUTED' : 'FAILED';
      proposal.execution.completedAt = nowIso();
      proposal.execution.receipt = success ? compactObject(input.receipt ?? {}, { maxDepth: 6, maxArray: 50, maxKeys: 100 }) : null;
      proposal.execution.error = success ? null : cleanText(input.error, 1200) || 'A execução falhou no Foundry.';
      const event = auditEvent(success ? 'EXECUTED' : 'EXECUTION_FAILED', requester, success ? { receipt: proposal.execution.receipt } : { error: proposal.execution.error });
      proposal.audit.push(event); campaign.audit.push(event);
    });
  }

  claimRollback(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (proposal.status !== 'EXECUTED' || !proposal.reversible || !proposal.execution?.receipt) {
        const error = new Error('Esta proposta não possui uma execução reversível disponível.');
        error.code = 'AUTOMATION_ROLLBACK_UNAVAILABLE'; error.statusCode = 409; throw error;
      }
      proposal.status = 'ROLLING_BACK';
      proposal.rollback = { token: randomUUID(), requestedBy: { id: requester.id, name: requester.name }, startedAt: nowIso(), completedAt: null, error: null };
      const event = auditEvent('ROLLBACK_CLAIMED', requester);
      proposal.audit.push(event); campaign.audit.push(event);
      return { rollbackToken: proposal.rollback.token };
    });
  }

  completeRollback(campaignId, proposalId, input = {}) {
    return this.transition(campaignId, proposalId, input, async ({ proposal, campaign, requester }) => {
      if (proposal.status !== 'ROLLING_BACK' || !proposal.rollback) {
        const error = new Error('Não há reversão ativa para esta proposta.');
        error.code = 'AUTOMATION_INVALID_STATE'; error.statusCode = 409; throw error;
      }
      if (!input.rollbackToken || input.rollbackToken !== proposal.rollback.token) {
        const error = new Error('Token de reversão inválido.');
        error.code = 'AUTOMATION_ROLLBACK_TOKEN_INVALID'; error.statusCode = 409; throw error;
      }
      const success = Boolean(input.success);
      proposal.status = success ? 'ROLLED_BACK' : 'EXECUTED';
      proposal.rollback.completedAt = nowIso();
      proposal.rollback.error = success ? null : cleanText(input.error, 1200) || 'A reversão falhou no Foundry.';
      const event = auditEvent(success ? 'ROLLED_BACK' : 'ROLLBACK_FAILED', requester, success ? {} : { error: proposal.rollback.error });
      proposal.audit.push(event); campaign.audit.push(event);
    });
  }
}

export class FileAutomationService extends InMemoryAutomationService {
  constructor({ filePath = resolve(process.cwd(), 'data/automation-proposals.json'), ...options } = {}) {
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

export function createAutomationServiceFromEnv(options = {}) {
  return new FileAutomationService({
    filePath: process.env.AUTOMATION_PROPOSALS_FILE || resolve(process.cwd(), 'data/automation-proposals.json'),
    ...options
  });
}

export const automationInternals = {
  ACTION_DEFINITIONS,
  ACTOR_RESOURCE_PATH,
  cleanText,
  compactObject,
  sanitizePayload,
  normalizeSuggestionEntries,
  fallbackSuggestion,
  proposalFingerprint,
  publicProposal,
  campaignSummary
};
