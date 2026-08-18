import {
  createRemoteRenderSessionRequest,
  createRenderSessionDescriptor
} from '../../render-stream-contract/src/index.js';

function gatewayError(message, code, cause = null) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function normalizeNode(node) {
  if (!node?.id || typeof node.createSession !== 'function') {
    throw gatewayError('Render Node inválido.', 'FENIX_RENDER_NODE_INVALID');
  }
  return Object.freeze({
    ...node,
    id: String(node.id).trim(),
    region: String(node.region ?? '').trim() || null,
    priority: Number.isFinite(Number(node.priority)) ? Number(node.priority) : 100
  });
}

export class RenderNodeGateway {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    this.nodes = new Map();
  }

  register(node) {
    const normalized = normalizeNode(node);
    if (this.nodes.has(normalized.id)) throw gatewayError('Render Node já registrado.', 'FENIX_RENDER_NODE_DUPLICATE');
    this.nodes.set(normalized.id, normalized);
    return normalized;
  }

  list() {
    return [...this.nodes.values()].map(({ id, region, priority }) => ({ id, region, priority }));
  }

  async createSession(input = {}) {
    const request = createRemoteRenderSessionRequest(input);
    const candidates = [...this.nodes.values()].sort((a, b) => a.priority - b.priority);
    let lastError = null;

    for (const node of candidates) {
      try {
        if (typeof node.health === 'function') {
          const health = await node.health({ request });
          if (health === false || health?.ok === false || health?.available === false) continue;
        }
        const result = await node.createSession(request);
        return Object.freeze({
          request,
          nodeId: node.id,
          descriptor: createRenderSessionDescriptor({
            ...result,
            region: result?.region ?? node.region,
            renderer: result?.renderer ?? node.id
          })
        });
      } catch (error) {
        lastError = error;
        this.logger.warn?.('[Fênix][Render Gateway] node falhou', { nodeId: node.id, message: error?.message });
      }
    }

    throw gatewayError('Nenhum Render Node GPU disponível.', 'FENIX_RENDER_NODE_UNAVAILABLE', lastError);
  }
}
