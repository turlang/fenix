const MAX_COORDINATE = 1_000_000;

export const RealtimeRole = Object.freeze({
  GM: 'gm',
  PLAYER: 'player'
});

export const RealtimeCommandType = Object.freeze({
  TOKEN_MOVE: 'TOKEN_MOVE',
  SCENE_UPDATE: 'SCENE_UPDATE',
  ACTION_SUBMIT: 'ACTION_SUBMIT',
  REQUEST_STATE: 'REQUEST_STATE',
  PING: 'PING'
});

export const RealtimeEventType = Object.freeze({
  STATE_SYNC: 'STATE_SYNC',
  PRESENCE_UPDATED: 'PRESENCE_UPDATED',
  TOKEN_MOVED: 'TOKEN_MOVED',
  SCENE_UPDATED: 'SCENE_UPDATED',
  NARRATION: 'NARRATION',
  ACK: 'ACK',
  PONG: 'PONG',
  ERROR: 'ERROR'
});

function gatewayError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function boundedText(value, maxLength, fallback = '') {
  const text = String(value ?? fallback).trim();
  return text.slice(0, maxLength);
}

function finiteCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > MAX_COORDINATE) {
    throw gatewayError(`${name} inválido.`, 'REALTIME_INVALID_COORDINATE');
  }
  return number;
}

function normalizeRole(value) {
  return value === RealtimeRole.PLAYER ? RealtimeRole.PLAYER : RealtimeRole.GM;
}

export function normalizeRealtimeIdentity(input = {}) {
  const clientId = boundedText(input.clientId, 120);
  if (!clientId) throw gatewayError('clientId é obrigatório.', 'REALTIME_CLIENT_ID_REQUIRED');
  const role = normalizeRole(input.role);
  const actorId = boundedText(input.actorId, 200) || null;
  if (role === RealtimeRole.PLAYER && !actorId) {
    throw gatewayError('Jogadores precisam de actorId.', 'REALTIME_ACTOR_REQUIRED');
  }
  return Object.freeze({
    clientId,
    userId: boundedText(input.userId, 120) || clientId,
    displayName: boundedText(input.displayName, 120, role === RealtimeRole.GM ? 'Mestre' : 'Jogador'),
    role,
    actorId
  });
}

export function normalizeRealtimeToken(input = {}) {
  const id = boundedText(input.id, 200);
  if (!id) throw gatewayError('Token sem id.', 'REALTIME_TOKEN_ID_REQUIRED');
  return Object.freeze({
    id,
    name: boundedText(input.name, 200, id),
    x: finiteCoordinate(input.x, 'token.x'),
    y: finiteCoordinate(input.y, 'token.y'),
    size: Math.max(1, Math.min(1000, Number(input.size) || 80)),
    visible: input.visible !== false
  });
}

export function parseRealtimeMessage(raw) {
  let payload;
  try {
    payload = JSON.parse(typeof raw === 'string' ? raw : raw?.toString?.('utf8') ?? '');
  } catch {
    throw gatewayError('Mensagem WebSocket inválida.', 'REALTIME_INVALID_JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw gatewayError('Mensagem WebSocket precisa ser um objeto.', 'REALTIME_INVALID_MESSAGE');
  }
  const type = boundedText(payload.type, 80);
  if (!type) throw gatewayError('type é obrigatório.', 'REALTIME_TYPE_REQUIRED');
  return {
    type,
    commandId: boundedText(payload.commandId, 120) || null,
    payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {}
  };
}

function createSessionRecord(sessionId) {
  return {
    id: sessionId,
    revision: 0,
    peers: new Map(),
    presence: new Map(),
    tokens: new Map(),
    tokenRooms: new Map(),
    scene: null,
    narrations: []
  };
}

export class RealtimeSessionHub {
  constructor({ maxPeersPerSession = 32, historyLimit = 50, logger = console } = {}) {
    this.maxPeersPerSession = Math.max(2, Number(maxPeersPerSession) || 32);
    this.historyLimit = Math.max(1, Number(historyLimit) || 50);
    this.logger = logger;
    this.sessions = new Map();
  }

  ensureSession(sessionId) {
    const id = boundedText(sessionId, 200);
    if (!id) throw gatewayError('sessionId é obrigatório.', 'REALTIME_SESSION_ID_REQUIRED');
    if (!this.sessions.has(id)) this.sessions.set(id, createSessionRecord(id));
    return this.sessions.get(id);
  }

  connect({ sessionId, identity, send }) {
    if (typeof send !== 'function') throw new TypeError('send é obrigatório.');
    const session = this.ensureSession(sessionId);
    const normalizedIdentity = normalizeRealtimeIdentity(identity);
    const previousPeer = session.peers.get(normalizedIdentity.clientId);
    if (!previousPeer && session.peers.size >= this.maxPeersPerSession) {
      throw gatewayError('Sessão atingiu o limite de participantes.', 'REALTIME_SESSION_FULL', 429);
    }

    previousPeer?.close?.(4000, 'Replaced by a newer connection');
    session.peers.set(normalizedIdentity.clientId, { identity: normalizedIdentity, send });
    session.presence.set(normalizedIdentity.clientId, {
      ...normalizedIdentity,
      connectedAt: new Date().toISOString()
    });

    this.sendTo(sessionId, normalizedIdentity.clientId, {
      type: RealtimeEventType.STATE_SYNC,
      payload: this.getSnapshot(sessionId)
    });
    this.broadcastPresence(sessionId);

    let disconnected = false;
    return {
      identity: normalizedIdentity,
      disconnect: () => {
        if (disconnected) return;
        disconnected = true;
        this.disconnect(sessionId, normalizedIdentity.clientId);
      }
    };
  }

  disconnect(sessionId, clientId) {
    const session = this.sessions.get(String(sessionId));
    if (!session) return false;
    const removed = session.peers.delete(String(clientId));
    session.presence.delete(String(clientId));
    if (removed) this.broadcastPresence(sessionId);
    return removed;
  }

  sendTo(sessionId, clientId, event) {
    const peer = this.sessions.get(String(sessionId))?.peers.get(String(clientId));
    if (!peer) return false;
    try {
      peer.send(event);
      return true;
    } catch (error) {
      this.logger.warn?.('[Fênix][Realtime] falha ao enviar evento', {
        sessionId,
        clientId,
        message: error.message
      });
      return false;
    }
  }

  broadcast(sessionId, event, { excludeClientId = null } = {}) {
    const session = this.sessions.get(String(sessionId));
    if (!session) return 0;
    let delivered = 0;
    for (const [clientId, peer] of session.peers.entries()) {
      if (excludeClientId && clientId === excludeClientId) continue;
      try {
        peer.send(event);
        delivered += 1;
      } catch (error) {
        this.logger.warn?.('[Fênix][Realtime] peer indisponível', { clientId, message: error.message });
      }
    }
    return delivered;
  }

  broadcastPresence(sessionId) {
    const session = this.ensureSession(sessionId);
    return this.broadcast(sessionId, {
      type: RealtimeEventType.PRESENCE_UPDATED,
      payload: {
        sessionId: session.id,
        presence: [...session.presence.values()]
      }
    });
  }

  getSnapshot(sessionId) {
    const session = this.ensureSession(sessionId);
    return {
      sessionId: session.id,
      revision: session.revision,
      scene: session.scene,
      tokens: [...session.tokens.values()],
      presence: [...session.presence.values()],
      narrations: session.narrations.slice(-10)
    };
  }

  applyTokenMove(sessionId, identity, input = {}) {
    const session = this.ensureSession(sessionId);
    const token = normalizeRealtimeToken(input.token ?? input);
    if (identity.role !== RealtimeRole.GM && identity.actorId !== token.id) {
      throw gatewayError('Jogador só pode mover o próprio token.', 'REALTIME_TOKEN_FORBIDDEN', 403);
    }

    session.revision += 1;
    session.tokens.set(token.id, token);
    this.broadcast(sessionId, {
      type: RealtimeEventType.TOKEN_MOVED,
      payload: {
        sessionId: session.id,
        revision: session.revision,
        token,
        by: identity.clientId
      }
    });

    const roomEntry = input.roomEntry ?? null;
    const roomId = boundedText(roomEntry?.room?.id, 200) || null;
    const previousRoomId = session.tokenRooms.get(token.id) ?? null;
    const roomChanged = Boolean(roomId && roomId !== previousRoomId);
    if (roomChanged) session.tokenRooms.set(token.id, roomId);

    return { token, revision: session.revision, roomChanged, roomEntry, previousRoomId };
  }

  restoreTokenRoom(sessionId, tokenId, previousRoomId) {
    const session = this.ensureSession(sessionId);
    if (previousRoomId) session.tokenRooms.set(String(tokenId), String(previousRoomId));
    else session.tokenRooms.delete(String(tokenId));
  }

  applySceneUpdate(sessionId, identity, scene) {
    if (identity.role !== RealtimeRole.GM) {
      throw gatewayError('Somente o mestre pode trocar a cena autoritativa.', 'REALTIME_SCENE_FORBIDDEN', 403);
    }
    const normalized = {
      id: boundedText(scene?.id, 200),
      name: boundedText(scene?.name, 300),
      width: Math.max(1, Number(scene?.width) || 1),
      height: Math.max(1, Number(scene?.height) || 1),
      grid: scene?.grid ?? null
    };
    if (!normalized.id) throw gatewayError('Cena sem id.', 'REALTIME_SCENE_ID_REQUIRED');
    const session = this.ensureSession(sessionId);
    session.revision += 1;
    session.scene = normalized;
    this.broadcast(sessionId, {
      type: RealtimeEventType.SCENE_UPDATED,
      payload: { sessionId: session.id, revision: session.revision, scene: normalized, by: identity.clientId }
    });
    return normalized;
  }

  async publishNarration(content, metadata = {}) {
    const sessionId = boundedText(metadata.sessionId, 200);
    if (!sessionId) {
      this.logger.warn?.('[Fênix][Realtime] narração sem sessionId não foi transmitida.');
      return { published: false, content, metadata };
    }
    const session = this.ensureSession(sessionId);
    const narration = Object.freeze({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      content: boundedText(content, 20_000),
      metadata: { ...metadata },
      createdAt: new Date().toISOString()
    });
    session.narrations.push(narration);
    if (session.narrations.length > this.historyLimit) session.narrations.splice(0, session.narrations.length - this.historyLimit);
    const delivered = this.broadcast(sessionId, {
      type: RealtimeEventType.NARRATION,
      payload: narration
    });
    return { published: delivered > 0, delivered, content: narration.content, metadata };
  }
}

function defaultAuthorizer() {
  throw gatewayError('Autenticação realtime não configurada.', 'REALTIME_AUTH_REQUIRED', 401);
}

export function createDevelopmentPeerAuthorizer({ isProduction = false } = {}) {
  return (input) => {
    if (isProduction) {
      throw gatewayError('Realtime exige autenticação explícita em produção.', 'REALTIME_AUTH_REQUIRED', 401);
    }
    return normalizeRealtimeIdentity(input);
  };
}

export class RealtimeSessionGateway {
  constructor({
    hub,
    sessionService,
    authorizePeer = defaultAuthorizer,
    maxMessagesPerWindow = 60,
    messageWindowMs = 10_000,
    logger = console
  } = {}) {
    if (!hub) throw new TypeError('hub é obrigatório.');
    if (!sessionService) throw new TypeError('sessionService é obrigatório.');
    this.hub = hub;
    this.sessionService = sessionService;
    this.authorizePeer = authorizePeer;
    this.maxMessagesPerWindow = Math.max(10, Number(maxMessagesPerWindow) || 60);
    this.messageWindowMs = Math.max(1000, Number(messageWindowMs) || 10_000);
    this.logger = logger;
  }

  openPeer({ sessionId, send, close = null, ...identityInput }) {
    const status = this.sessionService.getStatus();
    if (!status?.sessionId || status.sessionId !== sessionId || status.state !== 'COLLECTING_ACTIONS') {
      throw gatewayError('Sessão narrativa não está ativa para este WebSocket.', 'REALTIME_SESSION_NOT_ACTIVE', 409);
    }
    const identity = this.authorizePeer(identityInput);
    if (identity && typeof identity.then === 'function') {
      throw new TypeError('authorizePeer precisa ser síncrono nesta camada.');
    }
    const connection = this.hub.connect({ sessionId, identity, send, close });
    let windowStartedAt = Date.now();
    let messages = 0;

    return {
      identity: connection.identity,
      disconnect: connection.disconnect,
      receive: async (raw) => {
        const now = Date.now();
        if (now - windowStartedAt >= this.messageWindowMs) {
          windowStartedAt = now;
          messages = 0;
        }
        messages += 1;
        if (messages > this.maxMessagesPerWindow) {
          throw gatewayError('Limite de mensagens realtime excedido.', 'REALTIME_RATE_LIMIT', 429);
        }
        const message = parseRealtimeMessage(raw);
        return this.handleCommand(sessionId, connection.identity, message);
      }
    };
  }

  async handleCommand(sessionId, identity, message) {
    const commandId = message.commandId;
    switch (message.type) {
      case RealtimeCommandType.TOKEN_MOVE: {
        const moved = this.hub.applyTokenMove(sessionId, identity, message.payload);
        try {
          if (moved.roomChanged && moved.roomEntry) {
            await this.sessionService.describeRoom(moved.roomEntry);
          }
        } catch (error) {
          this.hub.restoreTokenRoom(sessionId, moved.token.id, moved.previousRoomId);
          throw error;
        }
        this.#ack(sessionId, identity.clientId, commandId, {
          type: message.type,
          revision: moved.revision,
          roomChanged: moved.roomChanged
        });
        return moved;
      }
      case RealtimeCommandType.SCENE_UPDATE: {
        const scene = this.hub.applySceneUpdate(sessionId, identity, message.payload.scene);
        this.#ack(sessionId, identity.clientId, commandId, { type: message.type, sceneId: scene.id });
        return scene;
      }
      case RealtimeCommandType.ACTION_SUBMIT: {
        const content = boundedText(message.payload.content, 4000);
        if (!content) throw gatewayError('Ação vazia.', 'REALTIME_ACTION_REQUIRED');
        const actorId = identity.role === RealtimeRole.GM
          ? boundedText(message.payload.actorId, 200) || identity.actorId
          : identity.actorId;
        const result = await this.sessionService.processAction({
          content,
          actorId,
          messageId: commandId || globalThis.crypto?.randomUUID?.() || null
        });
        this.#ack(sessionId, identity.clientId, commandId, { type: message.type, state: result.state });
        return result;
      }
      case RealtimeCommandType.REQUEST_STATE:
        this.hub.sendTo(sessionId, identity.clientId, {
          type: RealtimeEventType.STATE_SYNC,
          payload: this.hub.getSnapshot(sessionId)
        });
        return this.hub.getSnapshot(sessionId);
      case RealtimeCommandType.PING:
        this.hub.sendTo(sessionId, identity.clientId, {
          type: RealtimeEventType.PONG,
          commandId,
          payload: { now: new Date().toISOString() }
        });
        return { pong: true };
      default:
        throw gatewayError(`Comando realtime não suportado: ${message.type}`, 'REALTIME_COMMAND_UNSUPPORTED');
    }
  }

  sendError(sessionId, clientId, error, commandId = null) {
    return this.hub.sendTo(sessionId, clientId, {
      type: RealtimeEventType.ERROR,
      commandId,
      payload: {
        code: error?.code || 'REALTIME_ERROR',
        message: error?.message || 'Falha realtime.',
        status: Number(error?.statusCode) || 500
      }
    });
  }

  #ack(sessionId, clientId, commandId, payload) {
    if (!commandId) return false;
    return this.hub.sendTo(sessionId, clientId, {
      type: RealtimeEventType.ACK,
      commandId,
      payload
    });
  }
}
