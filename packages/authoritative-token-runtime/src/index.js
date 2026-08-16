import {
  RealtimeCommandType,
  RealtimeEventType,
  RealtimeRole,
  RealtimeSessionGateway,
  RealtimeSessionHub
} from '../../realtime-session-gateway/src/index.js';
import { resolveTokenMovement } from '../../scene-collision/src/index.js';
import { normalizeSceneWalls } from '../../scene-geometry/src/index.js';
import { normalizeSceneLighting } from '../../scene-lighting/src/index.js';
import {
  SceneRegionKind,
  TokenMovementMode,
  clampFlyingElevation,
  normalizeElevationValue,
  normalizeSceneElevation,
  normalizeSceneRegions,
  resolveGroundElevation
} from '../../scene-elevation/src/index.js';
import { normalizeVisionProfile } from '../../rpg-rules-contract/src/index.js';
import { normalizeTokenRuntime } from '../../token-entity/src/index.js';

function runtimeError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function boundedText(value, maxLength = 200, fallback = '') {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function finiteCoordinate(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || Math.abs(number) > 1_000_000) {
    throw runtimeError(`${name} inválido.`, 'REALTIME_INVALID_COORDINATE');
  }
  return number;
}

function finitePositive(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(min, Math.min(max, number));
}

function requestedMovementMode(value, fallback = TokenMovementMode.GROUND) {
  return String(value ?? fallback).trim().toLowerCase() === TokenMovementMode.FLYING
    ? TokenMovementMode.FLYING
    : TokenMovementMode.GROUND;
}

function authoritativeVision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return normalizeVisionProfile(value);
}

export function normalizeAuthoritativeToken(input = {}, authoritative = {}) {
  const tokenId = boundedText(input.tokenId ?? input.id ?? authoritative.tokenId ?? authoritative.id);
  if (!tokenId) throw runtimeError('Token sem tokenId.', 'REALTIME_TOKEN_ID_REQUIRED');

  const actorId = boundedText(authoritative.actorId ?? input.actorId) || tokenId;
  const sheetId = boundedText(authoritative.sheetId ?? input.sheetId) || actorId;
  const systemId = boundedText(authoritative.systemId ?? input.systemId, 120) || 'generic';
  const base = normalizeTokenRuntime({
    ...input,
    tokenId,
    actorId,
    sheetId,
    systemId,
    x: finiteCoordinate(input.x, 'token.x'),
    y: finiteCoordinate(input.y, 'token.y'),
    elevation: normalizeElevationValue(input.elevation ?? authoritative.elevation, 0)
  });

  return Object.freeze({
    ...base,
    size: finitePositive(input.size ?? authoritative.size, 80, 1, 1000),
    height: finitePositive(authoritative.height ?? input.height, 1.8, 0.2, 20),
    movementMode: requestedMovementMode(authoritative.movementMode ?? input.movementMode),
    visible: authoritative.visible ?? input.visible ?? base.visible,
    vision: authoritativeVision(authoritative.vision)
  });
}

export function normalizeAuthoritativeScene(scene = {}) {
  const width = Math.max(1, Number(scene.width) || 1);
  const height = Math.max(1, Number(scene.height) || 1);
  const elevation = normalizeSceneElevation(scene.elevation ?? {});
  return Object.freeze({
    id: boundedText(scene.id),
    name: boundedText(scene.name, 300),
    width,
    height,
    grid: scene.grid ?? null,
    scale: scene.scale ?? null,
    walls: normalizeSceneWalls(scene.walls ?? [], { sceneWidth: width, sceneHeight: height }),
    lighting: normalizeSceneLighting(scene.lighting ?? {}, { sceneWidth: width, sceneHeight: height }),
    elevation,
    regions: normalizeSceneRegions(scene.regions ?? [], { sceneWidth: width, sceneHeight: height })
  });
}

function authoritativeIdentityForMove(identity, rawToken, previousToken) {
  const tokenId = boundedText(rawToken?.tokenId ?? rawToken?.id);
  if (!tokenId) throw runtimeError('Token sem tokenId.', 'REALTIME_TOKEN_ID_REQUIRED');

  if (identity.role === RealtimeRole.GM) {
    return Object.freeze({
      tokenId,
      actorId: boundedText(rawToken?.actorId) || previousToken?.actorId || tokenId,
      sheetId: boundedText(rawToken?.sheetId) || previousToken?.sheetId || boundedText(rawToken?.actorId) || tokenId,
      systemId: boundedText(rawToken?.systemId, 120) || previousToken?.systemId || 'generic',
      height: rawToken?.height ?? previousToken?.height ?? 1.8,
      movementMode: rawToken?.movementMode ?? previousToken?.movementMode ?? TokenMovementMode.GROUND,
      visible: rawToken?.visible ?? previousToken?.visible ?? true,
      size: rawToken?.size ?? previousToken?.size ?? 80,
      vision: previousToken?.vision ?? null
    });
  }

  if (previousToken) {
    if (previousToken.actorId !== identity.actorId) {
      throw runtimeError('Jogador só pode mover token associado ao próprio ator.', 'REALTIME_TOKEN_FORBIDDEN', 403);
    }
    return Object.freeze({
      tokenId,
      actorId: previousToken.actorId,
      sheetId: previousToken.sheetId,
      systemId: previousToken.systemId,
      height: previousToken.height,
      movementMode: previousToken.movementMode,
      visible: previousToken.visible,
      size: previousToken.size,
      vision: previousToken.vision ?? null
    });
  }

  // Compatibilidade temporária com mesas antigas, nas quais tokenId === actorId.
  if (tokenId !== identity.actorId) {
    throw runtimeError('O Mestre precisa associar este token ao ator antes do primeiro movimento.', 'REALTIME_TOKEN_ASSOCIATION_REQUIRED', 403);
  }
  return Object.freeze({
    tokenId,
    actorId: identity.actorId,
    sheetId: identity.actorId,
    systemId: 'generic',
    height: 1.8,
    movementMode: TokenMovementMode.GROUND,
    visible: true,
    size: rawToken?.size ?? 80,
    vision: null
  });
}

function mergeActorAuthority(authority, actorRuntime) {
  if (!actorRuntime) return authority;
  return Object.freeze({
    ...authority,
    sheetId: boundedText(actorRuntime.sheetId) || authority.sheetId,
    systemId: boundedText(actorRuntime.systemId, 120) || authority.systemId,
    height: actorRuntime.height ?? authority.height,
    vision: actorRuntime.vision ?? authority.vision ?? null
  });
}

function resolveAcceptedElevation({ identity, rawToken, requestedToken, previousToken, scene }) {
  const elevationConfig = normalizeSceneElevation(scene?.elevation ?? {});
  const previousElevation = previousToken?.elevation ?? requestedToken.elevation ?? 0;
  if (!elevationConfig.enabled) {
    return Object.freeze({
      elevation: identity.role === RealtimeRole.GM && Object.prototype.hasOwnProperty.call(rawToken, 'elevation')
        ? requestedToken.elevation
        : previousElevation,
      source: 'legacy-2d'
    });
  }

  if (identity.role === RealtimeRole.GM && Object.prototype.hasOwnProperty.call(rawToken, 'elevation')) {
    return Object.freeze({ elevation: requestedToken.elevation, source: 'gm-explicit' });
  }

  if (requestedToken.movementMode === TokenMovementMode.FLYING) {
    const requestedElevation = Object.prototype.hasOwnProperty.call(rawToken, 'elevation')
      ? requestedToken.elevation
      : previousElevation;
    return Object.freeze({
      elevation: identity.role === RealtimeRole.GM
        ? requestedElevation
        : clampFlyingElevation({
            previousElevation,
            requestedElevation,
            baseElevation: previousElevation,
            verticalStep: elevationConfig.verticalStep
          }),
      source: identity.role === RealtimeRole.GM ? 'gm-flying' : 'flying-step'
    });
  }

  const ground = resolveGroundElevation({
    regions: scene?.regions ?? [],
    point: { x: requestedToken.x, y: requestedToken.y },
    fallbackElevation: previousElevation
  });
  return Object.freeze({ elevation: ground.elevation, source: ground.automatic ? ground.regionKind : 'ground-fallback', ground });
}

export class AuthoritativeRealtimeSessionHub extends RealtimeSessionHub {
  constructor({ resolveActorRuntime = null, resolveSceneTokens = null, ...options } = {}) {
    super(options);
    this.resolveActorRuntime = typeof resolveActorRuntime === 'function' ? resolveActorRuntime : null;
    this.resolveSceneTokens = typeof resolveSceneTokens === 'function' ? resolveSceneTokens : null;
  }

  hydrateSession(sessionId, snapshot = {}) {
    const session = this.ensureSession(sessionId);
    session.revision = Math.max(0, Number(snapshot.revision) || 0);
    session.scene = snapshot.scene ? normalizeAuthoritativeScene(snapshot.scene) : null;
    session.tokens = new Map((snapshot.tokens ?? []).map((token) => {
      const normalized = normalizeAuthoritativeToken(token, token);
      return [normalized.tokenId, normalized];
    }));
    session.tokenRooms = new Map(Object.entries(snapshot.tokenRooms ?? {}).map(([tokenId, roomId]) => [tokenId, String(roomId)]));
    session.narrations = Array.isArray(snapshot.narrations)
      ? snapshot.narrations.slice(-this.historyLimit).map((item) => structuredClone(item))
      : [];
    return this.getSnapshot(sessionId);
  }

  applySceneUpdate(sessionId, identity, scene) {
    if (identity.role !== RealtimeRole.GM) {
      throw runtimeError('Somente o mestre pode trocar a cena autoritativa.', 'REALTIME_SCENE_FORBIDDEN', 403);
    }
    const normalized = normalizeAuthoritativeScene(scene);
    if (!normalized.id) throw runtimeError('Cena sem id.', 'REALTIME_SCENE_ID_REQUIRED');
    const session = this.ensureSession(sessionId);
    const previousSceneId = session.scene?.id ?? null;
    const sceneChanged = previousSceneId !== normalized.id;
    const persistedTokens = this.resolveSceneTokens?.({ sessionId, sceneId: normalized.id }) ?? null;

    session.revision += 1;
    session.scene = normalized;
    if (Array.isArray(persistedTokens)) {
      session.tokens = new Map(persistedTokens.map((token) => {
        const normalizedToken = normalizeAuthoritativeToken(token, token);
        return [normalizedToken.tokenId, normalizedToken];
      }));
    } else if (sceneChanged) {
      session.tokens = new Map();
    }
    if (sceneChanged) session.tokenRooms = new Map();

    this.broadcast(sessionId, {
      type: RealtimeEventType.SCENE_UPDATED,
      payload: {
        sessionId: session.id,
        revision: session.revision,
        scene: normalized,
        tokenCount: session.tokens.size,
        by: identity.clientId
      }
    });

    // STATE_SYNC substitui atomicamente a lista de tokens no cliente. Isso evita
    // que tokens da cena anterior permaneçam visíveis durante uma troca de mapa.
    for (const [clientId, peer] of session.peers.entries()) {
      this.sendTo(sessionId, clientId, {
        type: RealtimeEventType.STATE_SYNC,
        payload: this.getSnapshot(sessionId, { identity: peer.identity })
      });
    }
    return normalized;
  }

  applyTokenMove(sessionId, identity, input = {}) {
    const session = this.ensureSession(sessionId);
    const rawToken = input.token ?? input;
    const tokenId = boundedText(rawToken?.tokenId ?? rawToken?.id);
    const previousToken = session.tokens.get(tokenId) ?? null;
    const baseAuthority = authoritativeIdentityForMove(identity, rawToken, previousToken);
    const actorRuntime = this.resolveActorRuntime?.({ sessionId, actorId: baseAuthority.actorId }) ?? null;
    const authority = mergeActorAuthority(baseAuthority, actorRuntime);
    const requestedToken = normalizeAuthoritativeToken(rawToken, authority);
    const elevationState = resolveAcceptedElevation({ identity, rawToken, requestedToken, previousToken, scene: session.scene });
    const acceptedRequestedToken = normalizeAuthoritativeToken({ ...requestedToken, elevation: elevationState.elevation }, authority);
    const ignoredWalls = identity.role === RealtimeRole.GM;
    const elevationEnabled = session.scene?.elevation?.enabled === true;

    const collision = session.scene ? resolveTokenMovement({
      from: previousToken,
      to: acceptedRequestedToken,
      walls: ignoredWalls ? [] : (session.scene.walls ?? []),
      sceneWidth: session.scene.width,
      sceneHeight: session.scene.height,
      tokenSize: acceptedRequestedToken.size,
      verticalEnabled: elevationEnabled,
      tokenElevation: acceptedRequestedToken.elevation,
      tokenHeight: acceptedRequestedToken.height
    }) : {
      position: { x: acceptedRequestedToken.x, y: acceptedRequestedToken.y },
      blocked: false,
      boundaryAdjusted: false,
      wallId: null,
      fraction: 1,
      verticalEnabled: elevationEnabled
    };

    let finalElevation = acceptedRequestedToken.elevation;
    let groundState = elevationState.ground ?? null;
    if (elevationEnabled && acceptedRequestedToken.movementMode === TokenMovementMode.GROUND
      && !(identity.role === RealtimeRole.GM && Object.prototype.hasOwnProperty.call(rawToken, 'elevation'))) {
      groundState = resolveGroundElevation({
        regions: session.scene?.regions ?? [],
        point: collision.position,
        fallbackElevation: finalElevation
      });
      finalElevation = groundState.elevation;
    }

    const token = normalizeAuthoritativeToken({
      ...acceptedRequestedToken,
      x: collision.position.x,
      y: collision.position.y,
      elevation: finalElevation
    }, authority);

    session.revision += 1;
    session.tokens.set(token.tokenId, token);
    this.broadcast(sessionId, {
      type: RealtimeEventType.TOKEN_MOVED,
      payload: {
        sessionId: session.id,
        revision: session.revision,
        token,
        requested: { x: requestedToken.x, y: requestedToken.y, elevation: requestedToken.elevation },
        collision: {
          blocked: collision.blocked === true,
          boundaryAdjusted: collision.boundaryAdjusted === true,
          wallId: collision.wallId ?? null,
          fraction: Number(collision.fraction) || 0,
          ignoredWalls,
          verticalEnabled: elevationEnabled
        },
        vertical: {
          source: groundState?.automatic ? groundState.regionKind : elevationState.source,
          regionId: groundState?.regionId ?? null,
          elevation: token.elevation,
          movementMode: token.movementMode
        },
        by: identity.clientId
      }
    });

    const previousRoomId = session.tokenRooms.get(token.tokenId) ?? null;
    const roomEntry = collision.blocked ? null : input.roomEntry ?? null;
    const explicitRoomId = !collision.blocked && Object.prototype.hasOwnProperty.call(input, 'roomId');
    const narratedRoomId = boundedText(roomEntry?.room?.id) || null;
    const nextRoomId = collision.blocked
      ? previousRoomId
      : narratedRoomId ?? (explicitRoomId ? boundedText(input.roomId) || null : previousRoomId);
    const roomChanged = nextRoomId !== previousRoomId;
    const shouldNarrate = Boolean(roomEntry && nextRoomId && roomChanged);

    if (roomChanged) {
      if (nextRoomId) session.tokenRooms.set(token.tokenId, nextRoomId);
      else session.tokenRooms.delete(token.tokenId);
    }

    return {
      token,
      requestedToken,
      collision: { ...collision, ignoredWalls, verticalEnabled: elevationEnabled },
      vertical: { ...elevationState, ground: groundState },
      revision: session.revision,
      roomChanged,
      shouldNarrate,
      roomEntry,
      previousRoomId,
      nextRoomId
    };
  }
}

export class AuthoritativeRealtimeSessionGateway extends RealtimeSessionGateway {
  constructor({ persistSceneToken = null, ...options } = {}) {
    super(options);
    this.persistSceneToken = typeof persistSceneToken === 'function' ? persistSceneToken : null;
  }

  async handleCommand(sessionId, identity, message) {
    if (message.type !== RealtimeCommandType.TOKEN_MOVE) {
      return super.handleCommand(sessionId, identity, message);
    }

    const moved = this.hub.applyTokenMove(sessionId, identity, message.payload);
    try {
      const sceneId = this.hub.getSnapshot(sessionId).scene?.id ?? null;
      if (sceneId && this.persistSceneToken) {
        await this.persistSceneToken({ sessionId, sceneId, identity, token: moved.token });
      }
      if (moved.shouldNarrate) {
        await this.sessionService.describeRoom({ ...moved.roomEntry, actorId: moved.token.actorId });
      }
      await this.hub.persistSession(sessionId);
    } catch (error) {
      this.hub.restoreTokenRoom(sessionId, moved.token.tokenId, moved.previousRoomId);
      await this.hub.persistSession(sessionId).catch(() => undefined);
      throw error;
    }

    if (message.commandId) {
      this.hub.sendTo(sessionId, identity.clientId, {
        type: RealtimeEventType.ACK,
        commandId: message.commandId,
        payload: {
          type: message.type,
          revision: moved.revision,
          roomChanged: moved.roomChanged,
          narrated: moved.shouldNarrate,
          tokenId: moved.token.tokenId,
          actorId: moved.token.actorId,
          elevation: moved.token.elevation,
          movementMode: moved.token.movementMode,
          collision: {
            blocked: moved.collision?.blocked === true,
            boundaryAdjusted: moved.collision?.boundaryAdjusted === true,
            wallId: moved.collision?.wallId ?? null,
            fraction: Number(moved.collision?.fraction) || 0,
            ignoredWalls: moved.collision?.ignoredWalls === true,
            verticalEnabled: moved.collision?.verticalEnabled === true
          }
        }
      });
    }
    return moved;
  }
}

export { SceneRegionKind, TokenMovementMode };
