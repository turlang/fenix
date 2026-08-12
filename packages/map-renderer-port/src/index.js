export const MapRendererBackend = Object.freeze({
  WEBGPU: 'webgpu',
  WEBGL2: 'webgl2',
  HEADLESS: 'headless'
});

const REQUIRED_METHODS = Object.freeze([
  'loadScene',
  'setViewport',
  'upsertToken',
  'removeToken',
  'setFog',
  'setLighting',
  'setGrid',
  'hitTest',
  'render',
  'destroy'
]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeMapScene(input = {}) {
  const width = Math.max(1, finiteNumber(input.width, 1920));
  const height = Math.max(1, finiteNumber(input.height, 1080));
  return Object.freeze({
    id: String(input.id ?? 'scene').trim() || 'scene',
    name: String(input.name ?? 'Cena').trim() || 'Cena',
    width,
    height,
    background: input.background ?? null,
    grid: Object.freeze({
      size: Math.max(8, finiteNumber(input.grid?.size, 100)),
      type: String(input.grid?.type ?? 'square')
    })
  });
}

export function normalizeViewport(input = {}) {
  return Object.freeze({
    x: finiteNumber(input.x, 0),
    y: finiteNumber(input.y, 0),
    zoom: Math.min(8, Math.max(0.1, finiteNumber(input.zoom, 1)))
  });
}

export function normalizeToken(input = {}) {
  const id = String(input.id ?? '').trim();
  if (!id) throw new TypeError('token.id é obrigatório.');
  return Object.freeze({
    id,
    name: String(input.name ?? id),
    x: finiteNumber(input.x, 0),
    y: finiteNumber(input.y, 0),
    size: Math.max(8, finiteNumber(input.size, 56)),
    texture: input.texture ?? null,
    selected: Boolean(input.selected),
    visible: input.visible !== false
  });
}

export function assertMapRendererPort(renderer) {
  if (!renderer || typeof renderer !== 'object') throw new TypeError('MapRendererPort inválido.');
  for (const method of REQUIRED_METHODS) {
    if (typeof renderer[method] !== 'function') {
      throw new TypeError(`MapRendererPort deve implementar ${method}().`);
    }
  }
  return renderer;
}

export function selectMapRendererBackend({ hasWebGpu = false, hasWebGl2 = true } = {}) {
  if (hasWebGpu) return MapRendererBackend.WEBGPU;
  if (hasWebGl2) return MapRendererBackend.WEBGL2;
  return MapRendererBackend.HEADLESS;
}

export class HeadlessMapRenderer {
  constructor() {
    this.scene = null;
    this.viewport = normalizeViewport();
    this.tokens = new Map();
    this.fog = null;
    this.lighting = null;
    this.grid = null;
    this.destroyed = false;
    this.frames = 0;
  }

  loadScene(scene) {
    this.#assertAlive();
    this.scene = normalizeMapScene(scene);
    this.tokens.clear();
    return this.scene;
  }

  setViewport(viewport) {
    this.#assertAlive();
    this.viewport = normalizeViewport(viewport);
    return this.viewport;
  }

  upsertToken(token) {
    this.#assertAlive();
    const normalized = normalizeToken(token);
    this.tokens.set(normalized.id, normalized);
    return normalized;
  }

  removeToken(tokenId) {
    this.#assertAlive();
    return this.tokens.delete(String(tokenId));
  }

  setFog(fogState) {
    this.#assertAlive();
    this.fog = fogState ?? null;
  }

  setLighting(lightingState) {
    this.#assertAlive();
    this.lighting = lightingState ?? null;
  }

  setGrid(gridState) {
    this.#assertAlive();
    this.grid = gridState ?? null;
  }

  hitTest(pointer = {}) {
    this.#assertAlive();
    const x = finiteNumber(pointer.x, 0);
    const y = finiteNumber(pointer.y, 0);
    const tokens = [...this.tokens.values()].reverse();
    const token = tokens.find((item) => {
      const radius = item.size / 2;
      return item.visible && x >= item.x - radius && x <= item.x + radius && y >= item.y - radius && y <= item.y + radius;
    }) ?? null;
    return { world: { x, y }, token };
  }

  render() {
    this.#assertAlive();
    this.frames += 1;
    return {
      frame: this.frames,
      sceneId: this.scene?.id ?? null,
      tokenCount: this.tokens.size,
      viewport: this.viewport
    };
  }

  destroy() {
    this.tokens.clear();
    this.scene = null;
    this.destroyed = true;
  }

  #assertAlive() {
    if (this.destroyed) throw new Error('MapRenderer já foi destruído.');
  }
}
