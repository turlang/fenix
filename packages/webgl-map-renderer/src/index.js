import {
  MapRendererBackend,
  normalizeMapScene,
  normalizeToken,
  normalizeViewport,
  selectMapRendererBackend
} from '../../map-renderer-port/src/index.js';

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Não foi possível criar shader WebGL2.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Falha ao compilar shader.';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl) {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
    in vec2 a_position;
    uniform vec2 u_resolution;
    uniform vec3 u_viewport;
    uniform float u_pointSize;
    void main() {
      vec2 world = (a_position - u_viewport.xy) * u_viewport.z;
      vec2 clip = (world / u_resolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      gl_PointSize = u_pointSize * u_viewport.z;
    }
  `);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    out vec4 outColor;
    void main() {
      vec2 p = gl_PointCoord - vec2(0.5);
      if (dot(p, p) > 0.25) discard;
      outColor = vec4(0.93, 0.67, 0.22, 1.0);
    }
  `);
  const program = gl.createProgram();
  if (!program) throw new Error('Não foi possível criar programa WebGL2.');
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Falha ao linkar programa WebGL2.';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

export function detectBrowserRendererBackend({ navigatorLike = globalThis.navigator, canvas = null } = {}) {
  if (navigatorLike?.gpu) return MapRendererBackend.WEBGPU;
  const hasWebGl2 = Boolean(canvas?.getContext?.('webgl2'));
  return selectMapRendererBackend({ hasWebGpu: false, hasWebGl2 });
}

export class WebGlMapRenderer {
  constructor({ canvas, logger = console, pixelRatio = globalThis.devicePixelRatio ?? 1 } = {}) {
    if (!canvas?.getContext) throw new TypeError('canvas com getContext() é obrigatório.');
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 não está disponível neste navegador.');

    this.canvas = canvas;
    this.gl = gl;
    this.logger = logger;
    this.pixelRatio = Math.min(2, Math.max(1, Number(pixelRatio) || 1));
    this.scene = null;
    this.viewport = normalizeViewport();
    this.tokens = new Map();
    this.fog = null;
    this.lighting = null;
    this.grid = null;
    this.destroyed = false;
    this.frames = 0;

    this.program = createProgram(gl);
    this.buffer = gl.createBuffer();
    this.positionLocation = gl.getAttribLocation(this.program, 'a_position');
    this.resolutionLocation = gl.getUniformLocation(this.program, 'u_resolution');
    this.viewportLocation = gl.getUniformLocation(this.program, 'u_viewport');
    this.pointSizeLocation = gl.getUniformLocation(this.program, 'u_pointSize');
  }

  loadScene(scene) {
    this.#assertAlive();
    this.scene = normalizeMapScene(scene);
    this.tokens.clear();
    this.grid = this.scene.grid;
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
    const rect = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    const screenX = Number(pointer.clientX ?? pointer.x ?? 0) - Number(rect.left ?? 0);
    const screenY = Number(pointer.clientY ?? pointer.y ?? 0) - Number(rect.top ?? 0);
    const worldX = screenX / this.viewport.zoom + this.viewport.x;
    const worldY = screenY / this.viewport.zoom + this.viewport.y;
    const tokens = [...this.tokens.values()].reverse();
    const token = tokens.find((item) => {
      const radius = item.size / 2;
      return item.visible && worldX >= item.x - radius && worldX <= item.x + radius
        && worldY >= item.y - radius && worldY <= item.y + radius;
    }) ?? null;
    return { world: { x: worldX, y: worldY }, token };
  }

  render() {
    this.#assertAlive();
    const gl = this.gl;
    const cssWidth = Math.max(1, this.canvas.clientWidth || this.scene?.width || 1);
    const cssHeight = Math.max(1, this.canvas.clientHeight || this.scene?.height || 1);
    const width = Math.round(cssWidth * this.pixelRatio);
    const height = Math.round(cssHeight * this.pixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }

    gl.viewport(0, 0, width, height);
    const transparent = Boolean(this.scene?.background);
    gl.clearColor(0.035, 0.041, 0.047, transparent ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.resolutionLocation, cssWidth, cssHeight);
    gl.uniform3f(this.viewportLocation, this.viewport.x, this.viewport.y, this.viewport.zoom);

    for (const token of this.tokens.values()) {
      if (!token.visible) continue;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([token.x, token.y]), gl.DYNAMIC_DRAW);
      gl.uniform1f(this.pointSizeLocation, token.size);
      gl.drawArrays(gl.POINTS, 0, 1);
    }

    this.frames += 1;
    return {
      frame: this.frames,
      backend: MapRendererBackend.WEBGL2,
      sceneId: this.scene?.id ?? null,
      tokenCount: this.tokens.size,
      viewport: this.viewport
    };
  }

  destroy() {
    if (this.destroyed) return;
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
    this.tokens.clear();
    this.destroyed = true;
  }

  #assertAlive() {
    if (this.destroyed) throw new Error('MapRenderer já foi destruído.');
  }
}
