function errorPayload(error, fallbackCode, fallbackStatus = 400) {
  const status = Number(error?.statusCode) || fallbackStatus;
  return {
    status,
    body: {
      code: error?.code || (status === 429 ? 'AI_RATE_LIMIT' : fallbackCode),
      message: error?.message || 'Falha ao processar requisição.',
      retryAfter: error?.retryAfter ?? null,
      ownerId: error?.ownerId ?? null,
      ownerUrl: error?.ownerUrl ?? null,
      generation: error?.generation ?? null
    }
  };
}

async function execute(reply, operation, fallbackCode, fallbackStatus = 400) {
  try {
    return await operation();
  } catch (error) {
    const failure = errorPayload(error, fallbackCode, fallbackStatus);
    return reply.code(failure.status).send(failure.body);
  }
}

function requestPath(request) {
  return String(request?.raw?.url ?? request?.url ?? '/');
}

async function routeOperation({ request, input, requestRouter, executeLocal }) {
  if (!requestRouter) return executeLocal();
  const body = request.body ?? null;
  const path = requestPath(request);
  const routeContext = requestRouter.verifyIncomingRequest({
    headers: request.headers,
    method: request.method,
    path,
    body
  });
  return requestRouter.executeHttp({
    campaignId: input?.campaignId ?? null,
    sessionId: input?.sessionId ?? null,
    method: request.method,
    path,
    body,
    headers: request.headers,
    routeContext,
    executeLocal
  });
}

export function createSessionController({
  sessionService,
  authorizeRequest = async (request) => request.body ?? {},
  requestRouter = null
}) {
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');
  if (typeof authorizeRequest !== 'function') throw new TypeError('authorizeRequest deve ser função.');
  const required = ['start', 'processAction', 'describeRoom', 'end', 'getStatus'];
  for (const method of required) {
    if (typeof sessionService[method] !== 'function') {
      throw new TypeError(`sessionService.${method}() é obrigatório.`);
    }
  }

  return {
    start(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'start');
        return routeOperation({
          request,
          input,
          requestRouter,
          executeLocal: () => sessionService.start(input)
        });
      }, 'SESSION_START_FAILED');
    },
    action(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'action');
        return routeOperation({
          request,
          input,
          requestRouter,
          executeLocal: () => sessionService.processAction(input)
        });
      }, 'ACTION_PROCESSING_FAILED');
    },
    roomEntry(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'roomEntry');
        return routeOperation({
          request,
          input,
          requestRouter,
          executeLocal: () => sessionService.describeRoom(input)
        });
      }, 'ROOM_ENTRY_FAILED');
    },
    end(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'end');
        return routeOperation({
          request,
          input,
          requestRouter,
          executeLocal: () => sessionService.end(input)
        });
      }, 'SESSION_END_FAILED');
    },
    status(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'status');
        return routeOperation({
          request,
          input,
          requestRouter,
          executeLocal: () => sessionService.getStatus(input)
        });
      }, 'SESSION_STATUS_FAILED');
    }
  };
}
