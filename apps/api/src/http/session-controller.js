function errorPayload(error, fallbackCode, fallbackStatus = 400) {
  const status = Number(error?.statusCode) || fallbackStatus;
  return {
    status,
    body: {
      code: error?.code || (status === 429 ? 'AI_RATE_LIMIT' : fallbackCode),
      message: error?.message || 'Falha ao processar requisição.',
      retryAfter: error?.retryAfter ?? null
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

export function createSessionController({ sessionService, authorizeRequest = async (request) => request.body ?? {} }) {
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
        return sessionService.start(input);
      }, 'SESSION_START_FAILED');
    },
    action(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'action');
        return sessionService.processAction(input);
      }, 'ACTION_PROCESSING_FAILED');
    },
    roomEntry(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'roomEntry');
        return sessionService.describeRoom(input);
      }, 'ROOM_ENTRY_FAILED');
    },
    end(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'end');
        return sessionService.end(input);
      }, 'SESSION_END_FAILED');
    },
    status(request, reply) {
      return execute(reply, async () => {
        const input = await authorizeRequest(request, 'status');
        return sessionService.getStatus(input);
      }, 'SESSION_STATUS_FAILED');
    }
  };
}
