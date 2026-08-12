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

function headerValue(headers, name) {
  const value = headers?.[name] ?? headers?.[name.toLowerCase()] ?? null;
  return String(value ?? '').trim();
}

function commandIdFor(request, input) {
  return String(
    input?.commandId ?? input?.messageId ?? request?.body?.commandId ?? request?.body?.messageId ??
    headerValue(request?.headers, 'x-idempotency-key') ?? ''
  ).trim().slice(0, 300) || null;
}

async function routeOperation({ request, input, requestRouter, commandLedger, commandType, executeLocal, sessionService }) {
  const body = request.body ?? null;
  const path = requestPath(request);
  const executeOwned = async () => {
    const commandId = commandIdFor(request, input);
    if (!commandLedger || !commandId || commandType === 'status') return executeLocal();
    const status = sessionService.getStatus?.({
      campaignId: input?.campaignId ?? null,
      sessionId: input?.sessionId ?? null
    }) ?? null;
    return commandLedger.execute({
      campaignId: input?.campaignId ?? status?.campaignId ?? null,
      sessionId: input?.sessionId ?? status?.sessionId ?? null,
      commandId,
      commandType: `http:${commandType}`,
      request: body,
      generation: status?.leaseGeneration ?? null,
      execute: executeLocal
    });
  };

  if (!requestRouter) return executeOwned();
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
    executeLocal: executeOwned
  });
}

export function createSessionController({
  sessionService,
  authorizeRequest = async (request) => request.body ?? {},
  requestRouter = null,
  commandLedger = null
}) {
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');
  if (typeof authorizeRequest !== 'function') throw new TypeError('authorizeRequest deve ser função.');
  const required = ['start', 'processAction', 'describeRoom', 'end', 'getStatus'];
  for (const method of required) {
    if (typeof sessionService[method] !== 'function') {
      throw new TypeError(`sessionService.${method}() é obrigatório.`);
    }
  }

  const routed = (request, input, commandType, executeLocal) => routeOperation({
    request,
    input,
    requestRouter,
    commandLedger,
    commandType,
    executeLocal,
    sessionService
  });

  return {
    start(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'start');
        return routed(request, input, 'start', () => sessionService.start(input));
      }, 'SESSION_START_FAILED');
    },
    action(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'action');
        return routed(request, input, 'action', () => sessionService.processAction(input));
      }, 'ACTION_PROCESSING_FAILED');
    },
    roomEntry(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'roomEntry');
        return routed(request, input, 'room-entry', () => sessionService.describeRoom(input));
      }, 'ROOM_ENTRY_FAILED');
    },
    end(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'end');
        return routed(request, input, 'end', () => sessionService.end(input));
      }, 'SESSION_END_FAILED');
    },
    status(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'status');
        return routed(request, input, 'status', () => sessionService.getStatus(input));
      }, 'SESSION_STATUS_FAILED');
    }
  };
}
