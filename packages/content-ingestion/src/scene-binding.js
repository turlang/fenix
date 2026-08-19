import crypto from 'node:crypto';

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function canonical(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:area|room|sala|regiao|region)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value) {
  return new Set(canonical(value).split(/\s+/).filter(Boolean));
}

function similarity(left, right) {
  const a = canonical(left);
  const b = canonical(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if ((a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))) return 0.86;
  const leftTokens = tokenSet(a);
  const rightTokens = tokenSet(b);
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const jaccard = intersection / union.size;
  return Math.min(0.8, jaccard * 0.9);
}

function sceneTargets(scenes = []) {
  const targets = [];
  for (const scene of scenes) {
    if (!scene?.id) continue;
    targets.push({
      sceneId: String(scene.id),
      regionId: null,
      label: clean(scene.name) || String(scene.id),
      sceneName: clean(scene.name) || String(scene.id),
      regionName: null
    });
    for (const region of scene.regions ?? []) {
      if (!region?.id) continue;
      targets.push({
        sceneId: String(scene.id),
        regionId: String(region.id),
        label: clean(region.name ?? region.label) || String(region.id),
        sceneName: clean(scene.name) || String(scene.id),
        regionName: clean(region.name ?? region.label) || String(region.id)
      });
    }
  }
  return targets;
}

function queueSummary(items) {
  return Object.freeze({
    total: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    accepted: items.filter((item) => item.status === 'accepted').length,
    rejected: items.filter((item) => item.status === 'rejected').length
  });
}

export function proposeAdventureSceneBindings(model, scenes = [], { minimumConfidence = 0.45 } = {}) {
  if (model?.schema !== 'fenix.adventure-model') throw new Error('Adventure Model inválido.');
  const targets = sceneTargets(scenes);
  const items = [];
  for (const section of model.sections ?? []) {
    if (section.kind !== 'area') continue;
    const ranked = targets
      .map((target) => ({ target, confidence: similarity(section.title, target.label) }))
      .filter((entry) => entry.confidence >= minimumConfidence)
      .sort((a, b) => b.confidence - a.confidence);
    const best = ranked[0];
    if (!best) continue;
    const ambiguity = ranked[1] ? Math.max(0, best.confidence - ranked[1].confidence) : best.confidence;
    const confidence = Math.max(0, Math.min(1, best.confidence * (ambiguity < 0.08 ? 0.85 : 1)));
    items.push(Object.freeze({
      id: stableId('scene-binding-review', model.id, section.id, best.target.sceneId, best.target.regionId),
      status: 'pending',
      sectionId: section.id,
      sectionTitle: section.title,
      target: Object.freeze({ ...best.target }),
      confidence,
      source: section.source,
      evidence: Object.freeze({ method: 'normalized-title-similarity', rawScore: best.confidence, ambiguityDelta: ambiguity })
    }));
  }
  return Object.freeze({
    schema: 'fenix.scene-binding-review',
    version: 1,
    adventureId: model.id,
    policy: Object.freeze({ minimumConfidence, authoritativeSceneMutation: false, gmReviewRequired: true }),
    summary: queueSummary(items),
    items: Object.freeze(items)
  });
}

export function applyAdventureSceneBindingDecisions(model, queue, decisions = []) {
  if (model?.schema !== 'fenix.adventure-model') throw new Error('Adventure Model inválido.');
  if (queue?.schema !== 'fenix.scene-binding-review' || queue.adventureId !== model.id) throw new Error('Fila de vínculo Scene/Region inválida.');
  const list = Array.isArray(decisions) ? decisions : [decisions];
  const items = [...queue.items];
  const existing = [...(model.bindings?.sceneRegions ?? [])];

  for (const decision of list) {
    const id = String(decision?.reviewId ?? decision?.id ?? '').trim();
    const action = String(decision?.action ?? '').toLowerCase();
    if (!id || !['accept', 'reject'].includes(action)) throw new Error('Decisão de vínculo inválida.');
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error('Proposta de vínculo não encontrada.');
    const item = items[index];
    if (item.status !== 'pending') continue;
    items[index] = Object.freeze({ ...item, status: action === 'accept' ? 'accepted' : 'rejected', decision: Object.freeze({ action, mode: 'gm-review', reason: clean(decision.reason) || null }) });
    if (action === 'accept') {
      const binding = Object.freeze({
        id: stableId('scene-binding', model.id, item.sectionId, item.target.sceneId, item.target.regionId),
        sectionId: item.sectionId,
        sectionTitle: item.sectionTitle,
        sceneId: item.target.sceneId,
        regionId: item.target.regionId,
        confidence: item.confidence,
        source: item.source,
        reviewed: true
      });
      const current = existing.findIndex((entry) => entry.sectionId === binding.sectionId);
      if (current >= 0) existing[current] = binding;
      else existing.push(binding);
    }
  }

  const updatedQueue = Object.freeze({ ...queue, summary: queueSummary(items), items: Object.freeze(items) });
  const updatedModel = Object.freeze({
    ...model,
    bindings: Object.freeze({ ...(model.bindings ?? {}), sceneRegions: Object.freeze(existing) })
  });
  return Object.freeze({ model: updatedModel, queue: updatedQueue });
}
