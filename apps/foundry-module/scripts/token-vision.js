function asDocument(token) {
  return token?.document ?? token ?? {};
}

function asActor(token) {
  const document = asDocument(token);
  return document.actor ?? token?.actor ?? null;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function tokenId(token) {
  const document = asDocument(token);
  return String(document.id ?? document._id ?? token?.id ?? '').trim();
}

function statusIds(token) {
  const actor = asActor(token);
  const raw = actor?.statuses ?? asDocument(token).statuses ?? [];
  try {
    return [...raw].map((entry) => String(entry?.id ?? entry ?? '').trim().toLowerCase()).filter(Boolean);
  } catch {
    return [];
  }
}

export function tokenPixelBounds(token, gridSize = 100) {
  const document = asDocument(token);
  const size = Math.max(1, finiteNumber(gridSize, 100));
  const width = Math.max(1, finiteNumber(document.width, 1) * size);
  const height = Math.max(1, finiteNumber(document.height, 1) * size);
  return {
    x: finiteNumber(document.x),
    y: finiteNumber(document.y),
    width,
    height
  };
}

export function tokenVisionSamplePoints(token, gridSize = 100) {
  const bounds = tokenPixelBounds(token, gridSize);
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
  const offsetX = bounds.width * 0.28;
  const offsetY = bounds.height * 0.28;
  return [
    center,
    { x: center.x - offsetX, y: center.y - offsetY },
    { x: center.x + offsetX, y: center.y - offsetY },
    { x: center.x - offsetX, y: center.y + offsetY },
    { x: center.x + offsetX, y: center.y + offsetY }
  ];
}

function polygonContains(polygon, point) {
  try {
    if (typeof polygon?.contains === 'function') return Boolean(polygon.contains(point.x, point.y));
    if (typeof polygon?.containsPoint === 'function') return Boolean(polygon.containsPoint(point));
  } catch {
    return false;
  }
  return false;
}

export function resolveTokenVision(token) {
  const document = asDocument(token);
  const source = token?.vision ?? token?.visionSource ?? null;
  const blinded = Boolean(source?.isBlinded);
  const sightEnabled = document.sight?.enabled !== false;
  const polygonEntries = [
    ['LIGHT', source?.light],
    ['FOV', source?.fov],
    ['SHAPE', source?.shape],
    ['LOS', source?.los]
  ];
  const selected = polygonEntries.find(([, polygon]) =>
    typeof polygon?.contains === 'function' || typeof polygon?.containsPoint === 'function'
  ) ?? ['NONE', null];
  const visionAvailable = Boolean(source && sightEnabled && !blinded && selected[1]);
  return {
    source,
    polygon: visionAvailable ? selected[1] : null,
    sourceKind: visionAvailable ? selected[0] : 'NONE',
    visionAvailable,
    blinded
  };
}

export function isTokenExplicitlyConcealed(token) {
  const document = asDocument(token);
  if (document.hidden || token?.visible === false) return true;
  const concealedStatuses = new Set(['invisible', 'undetected', 'unseen']);
  return statusIds(token).some((status) => concealedStatuses.has(status));
}

export function tokenVisibleFrom(viewer, target, { gridSize = 100 } = {}) {
  const viewerId = tokenId(viewer);
  const targetId = tokenId(target);
  if (viewer === target || (viewerId && targetId && viewerId === targetId)) return true;
  if (isTokenExplicitlyConcealed(target)) return false;

  const vision = resolveTokenVision(viewer);
  if (!vision.visionAvailable) return false;
  return tokenVisionSamplePoints(target, gridSize)
    .some((point) => polygonContains(vision.polygon, point));
}

export function visibleTokensFrom(viewer, candidates, options = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .filter((target) => tokenVisibleFrom(viewer, target, options));
}

export function createTokenPerception(viewer, visibleTokens = []) {
  const actor = asActor(viewer);
  const vision = resolveTokenVision(viewer);
  const visibleActorIds = new Set(
    visibleTokens
      .map((token) => asActor(token))
      .filter(Boolean)
      .map((entry) => String(entry.id ?? entry._id ?? entry.uuid ?? entry.name ?? '').trim())
      .filter(Boolean)
  );
  return {
    mode: vision.visionAvailable ? 'TOKEN_VISION' : 'CANONICAL_ONLY',
    observer: {
      tokenId: tokenId(viewer),
      actorId: String(actor?.id ?? actor?._id ?? '').trim()
    },
    visionAvailable: vision.visionAvailable,
    blinded: vision.blinded,
    sourceKind: vision.sourceKind,
    limitedToLineOfSight: true,
    visibleActorCount: visibleActorIds.size
  };
}
