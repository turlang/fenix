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

export function createSessionController({ sessionService }) {
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');
  const required = ['start', 'processAction', 'describeRoom', 'end', 'getStatus'];
  for (const method of required) {
    if (typeof sessionService[method] !== 'function') {
      throw new TypeError(`sessionService.${method}() é obrigatório.`);
    }
  }

  return {
    start(request, reply) {
      return execute(reply, () => sessionService.start(request.body ?? {}), 'SESSION_START_FAILED');
    },
    action(request, reply) {
      return execute(reply, () => sessionService.processAction(request.body ?? {}), 'ACTION_PROCESSING_FAILED');
    },
    roomEntry(request, reply) {
      return execute(reply, () => sessionService.describeRoom(request.body ?? {}), 'ROOM_ENTRY_FAILED');
    },
    end() {
      return sessionService.end();
    },
    status() {
      return sessionService.getStatus();
    }
  };
}
