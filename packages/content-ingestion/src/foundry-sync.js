import { createHash } from 'node:crypto';

function clean(value, max = 500) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function hashNativeSnapshot(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value ?? null))).digest('hex');
}

function promotionMap(model) {
  return new Map((model?.nativePromotions?.items ?? []).map((item) => [String(item.sourceUuid), item]));
}

function nodeMap(model) {
  return new Map((model?.entityGraph?.nodes ?? []).map((node) => [String(node.sourceUuid), node]));
}

function syncSummary(items) {
  const summary = { total: items.length, new: 0, unchanged: 0, changed: 0, removed: 0, conflict: 0, resolved: 0 };
  for (const item of items) {
    if (Object.hasOwn(summary, item.state)) summary[item.state] += 1;
    if (item.resolution) summary.resolved += 1;
  }
  return Object.freeze(summary);
}

export function buildFoundrySyncState(previousModel, nextModel, {
  nativeSnapshots = {},
  generatedAt = new Date().toISOString()
} = {}) {
  const previous = nodeMap(previousModel);
  const next = nodeMap(nextModel);
  const promotions = promotionMap(previousModel);
  const uuids = new Set([...previous.keys(), ...next.keys()]);
  const items = [];

  for (const sourceUuid of [...uuids].sort()) {
    const before = previous.get(sourceUuid) ?? null;
    const after = next.get(sourceUuid) ?? null;
    const promotion = promotions.get(sourceUuid) ?? null;
    let state = !before ? 'new' : !after ? 'removed' : before.sourceHash === after.sourceHash ? 'unchanged' : 'changed';
    let reason = null;
    let nativeHash = null;
    let localChanged = false;

    if (promotion) {
      const snapshot = nativeSnapshots[sourceUuid] ?? null;
      if (snapshot) nativeHash = hashNativeSnapshot(snapshot);
      localChanged = Boolean(nativeHash && promotion.baselineNativeHash && nativeHash !== promotion.baselineNativeHash);
      if (state === 'removed') {
        state = 'conflict';
        reason = 'SOURCE_REMOVED_NATIVE_PRESERVED';
      } else if (state === 'changed' && localChanged) {
        state = 'conflict';
        reason = 'SOURCE_AND_NATIVE_CHANGED';
      }
    }

    items.push(Object.freeze({
      sourceUuid,
      kind: after?.kind ?? before?.kind ?? null,
      name: after?.name ?? before?.name ?? sourceUuid,
      state,
      reason,
      previousSourceHash: before?.sourceHash ?? null,
      sourceHash: after?.sourceHash ?? null,
      promoted: Boolean(promotion),
      nativeType: promotion?.nativeType ?? null,
      nativeId: promotion?.nativeId ?? null,
      baselineNativeHash: promotion?.baselineNativeHash ?? null,
      nativeHash,
      localChanged,
      resolution: null
    }));
  }

  return Object.freeze({
    schema: 'fenix.foundry-sync-state',
    version: 1,
    generatedAt: clean(generatedAt, 100),
    sourceGeneratedAt: clean(nextModel?.bridgeSync?.source?.generatedAt ?? nextModel?.source?.generatedAt, 100) || null,
    status: items.some((item) => item.state === 'conflict') ? 'review-required' : 'synchronized',
    policy: Object.freeze({
      localEditsWinByDefault: true,
      sourceRemovalNeverDeletesNative: true,
      explicitConflictResolutionRequired: true
    }),
    items: Object.freeze(items),
    summary: syncSummary(items)
  });
}

export function markFoundrySyncResolutions(syncState, decisions = []) {
  if (syncState?.schema !== 'fenix.foundry-sync-state') throw new TypeError('Estado de sync Foundry inválido.');
  const byUuid = new Map((Array.isArray(decisions) ? decisions : [decisions]).filter(Boolean).map((decision) => [String(decision.sourceUuid), decision]));
  const items = syncState.items.map((item) => {
    const decision = byUuid.get(item.sourceUuid);
    if (!decision) return item;
    if (item.state !== 'conflict') throw new Error(`Entidade ${item.sourceUuid} não possui conflito pendente.`);
    const action = clean(decision.action, 40);
    if (!['keep-local', 'accept-source', 'detach'].includes(action)) throw new Error(`Ação de resolução inválida para ${item.sourceUuid}.`);
    if (item.reason === 'SOURCE_REMOVED_NATIVE_PRESERVED' && action === 'accept-source') throw new Error('Fonte removida não pode apagar entidade nativa automaticamente.');
    return Object.freeze({ ...item, resolution: action });
  });
  const unresolved = items.filter((item) => item.state === 'conflict' && !item.resolution).length;
  return Object.freeze({
    ...syncState,
    status: unresolved ? 'review-required' : 'resolved',
    items: Object.freeze(items),
    summary: syncSummary(items)
  });
}
