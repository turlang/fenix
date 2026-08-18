function text(value, max = 300) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function createRuntimeSceneEntities(tokens = []) {
  const result = [];
  for (const token of Array.isArray(tokens) ? tokens : []) {
    const tokenId = text(token?.tokenId ?? token?.id);
    if (!tokenId) continue;
    result.push(Object.freeze({
      tokenId,
      actorId: text(token?.actorId) || null,
      x: finite(token?.x),
      y: finite(token?.y),
      elevation: finite(token?.elevation),
      rotation: finite(token?.rotation),
      visible: token?.visible !== false && token?.hidden !== true,
      movementMode: text(token?.movementMode, 40) || 'ground'
    }));
  }
  return Object.freeze(result);
}

export function attachRuntimeSceneEntities(stateSync, snapshot) {
  return Object.freeze({
    ...stateSync,
    entities: createRuntimeSceneEntities(snapshot?.tokens)
  });
}
