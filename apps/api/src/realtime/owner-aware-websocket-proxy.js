import WebSocket from 'ws';
import { resolveOwnerWebSocketUrl } from '../../../../packages/owner-aware-runtime-router/src/index.js';

function text(value, maxLength = 2000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isOpen(socket) {
  return socket?.readyState === 1;
}

function safeClose(socket, code, reason) {
  try {
    if (socket && socket.readyState < 2) socket.close(code, reason);
  } catch {
    // noop
  }
}

export function createOwnerAwareWebSocketProxy({
  ownerRouter,
  WebSocketImpl = WebSocket,
  maxBufferedMessages = 64,
  maxRouteRetries = 1,
  observability = null,
  logger = console
} = {}) {
  if (!ownerRouter) throw new TypeError('ownerRouter é obrigatório.');
  if (typeof WebSocketImpl !== 'function') throw new TypeError('WebSocketImpl é obrigatório.');
  const record = (event, attributes = {}) => observability?.record?.(event, { transport: 'websocket', ...attributes });

  return function proxyWebSocket({ socket, request, route, sessionId }) {
    const requestPath = text(request?.raw?.url ?? request?.url ?? '/v1/realtime');
    const cookie = text(request?.headers?.cookie, 16_000);
    const authorization = text(request?.headers?.authorization, 8_000);
    const origin = text(request?.headers?.origin, 2_000);
    const buffered = [];
    let upstream = null;
    let closed = false;
    let retryCount = 0;
    let currentRoute = route;

    record('websocket_proxy_started', { ownerId: route?.ownerId, generation: route?.generation, outcome: 'connecting' });

    const closeUpstream = () => {
      const current = upstream;
      upstream = null;
      try {
        if (current && current.readyState < 2) current.close(1000, 'Ingress closing');
      } catch {
        // noop
      }
    };

    const failClient = (reason = 'Runtime owner unavailable') => {
      if (closed) return;
      closed = true;
      record('websocket_proxy_failed', {
        ownerId: currentRoute?.ownerId,
        generation: currentRoute?.generation,
        attempt: retryCount + 1,
        outcome: text(reason, 80)
      });
      closeUpstream();
      safeClose(socket, 1012, reason);
    };

    const retryOwner = async (failedRoute) => {
      if (closed || retryCount >= maxRouteRetries) return false;
      retryCount += 1;
      try {
        const next = await ownerRouter.resolve({ sessionId });
        if (next.mode !== 'remote' || !next.ownerUrl) return false;
        const previousKey = `${failedRoute?.ownerId ?? ''}:${failedRoute?.generation ?? ''}`;
        const nextKey = `${next.ownerId}:${next.generation}`;
        if (previousKey === nextKey) return false;
        record('websocket_proxy_retry', {
          ownerId: next.ownerId,
          generation: next.generation,
          attempt: retryCount + 1,
          outcome: 'owner_changed'
        });
        currentRoute = next;
        connectUpstream(next);
        return true;
      } catch (error) {
        record('websocket_proxy_retry_failed', { attempt: retryCount, code: error?.code });
        logger.warn?.('[Fênix][RealtimeProxy] falha ao resolver novo owner', {
          sessionId,
          code: error?.code,
          message: error?.message
        });
        return false;
      }
    };

    const connectUpstream = (targetRoute) => {
      if (closed) return;
      closeUpstream();
      const target = resolveOwnerWebSocketUrl(targetRoute.ownerUrl, requestPath);
      const headers = ownerRouter.createRoutingHeaders({
        generation: targetRoute.generation,
        method: 'GET',
        path: requestPath,
        body: null
      });
      if (cookie) headers.cookie = cookie;
      if (authorization) headers.authorization = authorization;

      const startedAt = Date.now();
      const candidate = new WebSocketImpl(target, {
        headers,
        origin: origin || undefined,
        perMessageDeflate: false,
        maxPayload: 64 * 1024
      });
      upstream = candidate;

      candidate.on('open', () => {
        if (closed || candidate !== upstream) return;
        record('websocket_proxy_connected', {
          ownerId: targetRoute.ownerId,
          generation: targetRoute.generation,
          attempt: retryCount + 1,
          outcome: 'connected',
          durationMs: Date.now() - startedAt
        });
        retryCount = 0;
        while (buffered.length && candidate.readyState === 1) {
          const item = buffered.shift();
          candidate.send(item.data, { binary: item.isBinary });
        }
      });

      candidate.on('message', (data, isBinary) => {
        if (!closed && isOpen(socket)) socket.send(data, { binary: isBinary });
      });

      candidate.on('unexpected-response', (_req, response) => {
        response.resume?.();
        if (candidate !== upstream || closed) return;
        upstream = null;
        record('websocket_proxy_rejected', {
          ownerId: targetRoute.ownerId,
          generation: targetRoute.generation,
          code: String(response.statusCode)
        });
        if (Number(response.statusCode) === 409) {
          void retryOwner(targetRoute).then((retried) => {
            if (!retried) failClient('Runtime owner changed');
          });
          return;
        }
        failClient('Runtime owner rejected realtime route');
      });

      candidate.on('close', (code, reason) => {
        if (candidate !== upstream || closed) return;
        upstream = null;
        const retryable = [1001, 1006, 1012].includes(Number(code));
        record('websocket_proxy_upstream_closed', {
          ownerId: targetRoute.ownerId,
          generation: targetRoute.generation,
          code: String(code),
          outcome: retryable ? 'retryable' : 'closed'
        });
        if (retryable) {
          void retryOwner(targetRoute).then((retried) => {
            if (!retried) failClient('Runtime owner disconnected');
          });
          return;
        }
        failClient(text(reason?.toString?.(), 120) || 'Runtime owner disconnected');
      });

      candidate.on('error', (error) => {
        record('websocket_proxy_upstream_error', {
          ownerId: targetRoute.ownerId,
          generation: targetRoute.generation,
          code: error?.code
        });
        logger.warn?.('[Fênix][RealtimeProxy] upstream WebSocket falhou', {
          sessionId,
          ownerId: targetRoute.ownerId,
          generation: targetRoute.generation,
          message: error?.message
        });
      });
    };

    socket.on('message', (data, isBinary) => {
      if (closed) return;
      if (upstream?.readyState === 1) {
        upstream.send(data, { binary: isBinary });
        return;
      }
      if (buffered.length >= maxBufferedMessages) {
        record('websocket_proxy_buffer_exceeded', { ownerId: currentRoute?.ownerId, generation: currentRoute?.generation });
        failClient('Realtime proxy buffer exceeded');
        return;
      }
      buffered.push({ data, isBinary });
    });

    socket.on('close', () => {
      closed = true;
      record('websocket_proxy_client_closed', { ownerId: currentRoute?.ownerId, generation: currentRoute?.generation });
      closeUpstream();
    });

    socket.on('error', (error) => {
      record('websocket_proxy_downstream_error', { ownerId: currentRoute?.ownerId, generation: currentRoute?.generation, code: error?.code });
      logger.warn?.('[Fênix][RealtimeProxy] downstream WebSocket falhou', {
        sessionId,
        ownerId: currentRoute?.ownerId,
        message: error?.message
      });
      closed = true;
      closeUpstream();
    });

    connectUpstream(route);
    return {
      get route() { return currentRoute; },
      close: failClient
    };
  };
}
