const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function clampZoom(value) {
  return clamp(finite(value, 1), MIN_ZOOM, MAX_ZOOM);
}

export function clampViewport(viewport, { canvasWidth, canvasHeight, sceneWidth, sceneHeight } = {}) {
  const zoom = clampZoom(viewport?.zoom);
  const width = Math.max(1, finite(canvasWidth, 1));
  const height = Math.max(1, finite(canvasHeight, 1));
  const mapWidth = Math.max(1, finite(sceneWidth, 1));
  const mapHeight = Math.max(1, finite(sceneHeight, 1));
  const visibleWidth = width / zoom;
  const visibleHeight = height / zoom;

  const x = visibleWidth >= mapWidth
    ? (mapWidth - visibleWidth) / 2
    : clamp(finite(viewport?.x, 0), 0, mapWidth - visibleWidth);
  const y = visibleHeight >= mapHeight
    ? (mapHeight - visibleHeight) / 2
    : clamp(finite(viewport?.y, 0), 0, mapHeight - visibleHeight);

  return { x, y, zoom };
}

export function fitViewport({ canvasWidth, canvasHeight, sceneWidth, sceneHeight } = {}) {
  const width = Math.max(1, finite(canvasWidth, 1));
  const height = Math.max(1, finite(canvasHeight, 1));
  const mapWidth = Math.max(1, finite(sceneWidth, 1));
  const mapHeight = Math.max(1, finite(sceneHeight, 1));
  const zoom = clampZoom(Math.min(width / mapWidth, height / mapHeight));
  return clampViewport({ x: 0, y: 0, zoom }, {
    canvasWidth: width,
    canvasHeight: height,
    sceneWidth: mapWidth,
    sceneHeight: mapHeight
  });
}

export function panViewport(viewport, { deltaX = 0, deltaY = 0, canvasWidth, canvasHeight, sceneWidth, sceneHeight } = {}) {
  const zoom = clampZoom(viewport?.zoom);
  return clampViewport({
    x: finite(viewport?.x, 0) - finite(deltaX, 0) / zoom,
    y: finite(viewport?.y, 0) - finite(deltaY, 0) / zoom,
    zoom
  }, { canvasWidth, canvasHeight, sceneWidth, sceneHeight });
}

export function zoomViewportAt(viewport, {
  factor = 1,
  screenX = 0,
  screenY = 0,
  canvasWidth,
  canvasHeight,
  sceneWidth,
  sceneHeight
} = {}) {
  const previousZoom = clampZoom(viewport?.zoom);
  const nextZoom = clampZoom(previousZoom * finite(factor, 1));
  const worldX = finite(viewport?.x, 0) + finite(screenX, 0) / previousZoom;
  const worldY = finite(viewport?.y, 0) + finite(screenY, 0) / previousZoom;
  return clampViewport({
    x: worldX - finite(screenX, 0) / nextZoom,
    y: worldY - finite(screenY, 0) / nextZoom,
    zoom: nextZoom
  }, { canvasWidth, canvasHeight, sceneWidth, sceneHeight });
}

export function gridScreenStyle(grid = {}, viewport = {}) {
  const zoom = clampZoom(viewport.zoom);
  const size = Math.max(8, finite(grid.size, 70));
  const offsetX = finite(grid.offsetX, 0);
  const offsetY = finite(grid.offsetY, 0);
  return {
    visible: grid.visible !== false,
    size: size * zoom,
    x: (offsetX - finite(viewport.x, 0)) * zoom,
    y: (offsetY - finite(viewport.y, 0)) * zoom
  };
}
