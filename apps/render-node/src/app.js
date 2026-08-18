import { timingSafeEqual } from 'node:crypto';

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? '');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function errorPayload(error) {
  return {
    code: error?.code || 'FENIX_RENDER_NODE_ERROR',
    message: error?.message || 'Falha no Render Node.'
  };
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

function launcherRequiredError() {
  const error = new Error('Process mode exige launcher de runtime 3D configurado.');
  error.code = 'FENIX_RENDER_RUNTIME_LAUNCHER_NOT_CONFIGURED';
  error.statusCode = 503;
  return error;
}

async function readJsonBody(request, maxBytes = 64 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('Payload do Render Node excedeu o limite.');
      error.code = 'FENIX_RENDER_NODE_BODY_TOO_LARGE';
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body-object-required');
    return parsed;
  } catch {
    const error = new Error('Payload JSON inválido.');
    error.code = 'FENIX_RENDER_NODE_INVALID_JSON';
    error.statusCode = 400;
    throw error;
  }
}

export function createRenderNodeHandler({ config, registry, runtimeLauncher = null } = {}) {
  if (!config) throw new TypeError('config é obrigatório.');
  if (!registry) throw new TypeError('registry é obrigatório.');

  return async function renderNodeHandler(request, response) {
    const url = new URL(request.url ?? '/', 'http://render-node.internal');
    const pathname = url.pathname;
    const bootstrapMatch = pathname.match(/^\/v1\/runtime\/bootstrap\/([^/]+)$/);

    if (request.method === 'GET' && bootstrapMatch) {
      const renderSessionId = decodeURIComponent(bootstrapMatch[1]);
      const record = registry.get(renderSessionId);
      if (!record?.request?.worldBootstrap) {
        return sendJson(response, 404, { code: 'FENIX_RENDER_BOOTSTRAP_NOT_FOUND', message: 'World bootstrap não encontrado.' });
      }
      if (!safeEqual(bearerToken(request), record.runtimeAccessToken)) {
        return sendJson(response, 401, { code: 'FENIX_RENDER_BOOTSTRAP_UNAUTHORIZED', message: 'Credencial da sessão de runtime inválida.' });
      }
      return sendJson(response, 200, record.request.worldBootstrap);
    }

    if (!(pathname === '/health' && config.allowUnauthenticatedHealth)) {
      if (!config.authToken) {
        return sendJson(response, 503, {
          code: 'FENIX_RENDER_NODE_AUTH_NOT_CONFIGURED',
          message: 'Token interno do Render Node não configurado.'
        });
      }
      if (!safeEqual(bearerToken(request), config.authToken)) {
        return sendJson(response, 401, {
          code: 'FENIX_RENDER_NODE_UNAUTHORIZED',
          message: 'Credencial interna inválida.'
        });
      }
    }

    try {
      if (request.method === 'GET' && pathname === '/health') {
        const status = registry.status();
        const launcherReady = config.runtimeMode !== 'process' || runtimeLauncher?.enabled === true;
        return sendJson(response, 200, {
          status: status.configured && launcherReady ? 'ok' : 'degraded',
          service: 'fenix-render-node',
          nodeId: status.nodeId,
          region: status.region,
          renderer: status.renderer,
          runtimeMode: config.runtimeMode,
          runtimeProcess: runtimeLauncher ? {
            enabled: runtimeLauncher.enabled,
            activeProcesses: runtimeLauncher.list().length
          } : null,
          configured: status.configured && launcherReady,
          capacity: status.capacity,
          activeSessions: status.activeSessions,
          availableSlots: status.availableSlots,
          available: status.available && launcherReady
        });
      }

      if (request.method === 'POST' && pathname === '/v1/render-sessions') {
        const body = await readJsonBody(request);
        if (config.runtimeMode === 'process' && runtimeLauncher?.enabled !== true) throw launcherRequiredError();
        const record = registry.create(body);
        if (config.runtimeMode === 'process') {
          try {
            await runtimeLauncher.start(record);
          } catch (error) {
            registry.delete(record.renderSessionId);
            throw error;
          }
        }
        return sendJson(response, 201, record.descriptor);
      }

      const sessionMatch = pathname.match(/^\/v1\/render-sessions\/([^/]+)$/);
      if (sessionMatch) {
        const renderSessionId = decodeURIComponent(sessionMatch[1]);
        if (request.method === 'GET') {
          const record = registry.get(renderSessionId);
          if (!record) return sendJson(response, 404, { code: 'FENIX_RENDER_SESSION_NOT_FOUND', message: 'Sessão de render não encontrada.' });
          return sendJson(response, 200, record.descriptor);
        }
        if (request.method === 'DELETE') {
          const record = registry.get(renderSessionId);
          if (!record) return sendJson(response, 404, { code: 'FENIX_RENDER_SESSION_NOT_FOUND', message: 'Sessão de render não encontrada.' });
          if (config.runtimeMode === 'process') await runtimeLauncher?.stop(renderSessionId);
          registry.delete(renderSessionId);
          return sendJson(response, 200, { renderSessionId, ended: true });
        }
      }

      return sendJson(response, 404, { code: 'FENIX_RENDER_NODE_ROUTE_NOT_FOUND', message: 'Rota não encontrada.' });
    } catch (error) {
      return sendJson(response, Number(error?.statusCode) || 400, errorPayload(error));
    }
  };
}
