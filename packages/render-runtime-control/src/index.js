import {
  RealtimeCommandType,
  RealtimeRole
} from '../../realtime-session-gateway/src/index.js';
import { AuthoritativeRealtimeSessionGateway } from '../../authoritative-token-runtime/src/index.js';
import {
  createFenix3dRuntimeStateSync,
  projectRuntimeMovementIntent
} from '../../render-runtime-adapter/src/index.js';
import { attachRuntimeSceneEntities } from './runtime-scene-sync.js';

function controlError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function text(value, max = 4000) {
  return String(value ?? '').trim().slice(0, max);
}

function currentToken(snapshot, record) {
  const token = (Array.isArray(snapshot?.tokens) ? snapshot.tokens : [])
    .find((item) => (item?.tokenId ?? item?.id) === record.tokenId) ?? null;
  if (!token) throw controlError('Token da sessão 3D não está no estado realtime.', 'FENIX_3D_RUNTIME_TOKEN_NOT_FOUND', 409);
  if (token.actorId !== record.actorId) {
    throw controlError('Token realtime não pertence ao ator da sessão 3D.', 'FENIX_3D_RUNTIME_TOKEN_ACTOR_MISMATCH', 409);
  }
  return token;
}

function runtimeIdentity(record, controlId) {
  return Object.freeze({
    clientId: `render-runtime:${controlId}`,
    userId: record.requestedByUserId,
    role: RealtimeRole.PLAYER,
    actorId: record.actorId
  });
}

function actionContent(intent) {
  const action = text(intent?.action, 3000);
  if (!action) throw controlError('Ação do runtime está vazia.', 'FENIX_3D_RUNTIME_ACTION_REQUIRED');
  const targetId = text(intent?.targetId, 200);
  return targetId ? `${action}\nAlvo técnico: ${targetId}` : action;
}

export function createAuthoritativeRuntimeInputHandler({
  sessionService,
  realtimeHub,
  campaignService,
  tokenService,
  explorationService = null,
  logger = console
} = {}) {
  if (!sessionService) throw new TypeError('sessionService é obrigatório.');
  if (!realtimeHub) throw new TypeError('realtimeHub é obrigatório.');
  if (!campaignService) throw new TypeError('campaignService é obrigatório.');
  if (!tokenService) throw new TypeError('tokenService é obrigatório.');

  const gateway = new AuthoritativeRealtimeSessionGateway({
    hub: realtimeHub,
    sessionService: {
      getStatus: ({ sessionId } = {}) => sessionService.getStatus({ sessionId }),
      processAction: (payload) => sessionService.processAction(payload),
      describeRoom: (payload) => sessionService.describeRoom(payload)
    },
    persistSceneToken: async ({ sessionId, sceneId, token }) => {
      const campaign = campaignService.findCampaignBySessionId(sessionId);
      if (!campaign) throw controlError('Sessão não pertence a uma campanha persistente.', 'CAMPAIGN_SESSION_NOT_FOUND', 404);
      return tokenService.persistRuntimeToken({ campaignId: campaign.id, sceneId, token });
    },
    logger
  });

  return async function handleAuthoritativeRuntimeInput({ record, controlId, input, yawDegrees } = {}) {
    if (!record?.sessionId) throw controlError('Sessão VTT ausente.', 'FENIX_3D_RUNTIME_SESSION_REQUIRED', 409);
    const ownership = await sessionService.assertOwnership({ sessionId: record.sessionId });
    if (ownership.campaignId && ownership.campaignId !== record.campaignId) {
      throw controlError('Sessão 3D não corresponde à campanha autoritativa.', 'FENIX_3D_RUNTIME_CAMPAIGN_MISMATCH', 409);
    }

    const snapshot = realtimeHub.getSnapshot(record.sessionId);
    if (!snapshot?.scene || snapshot.scene.id !== record.sceneId) {
      throw controlError('A cena ativa mudou desde a criação da primeira pessoa.', 'FENIX_3D_RUNTIME_SCENE_STALE', 409);
    }
    const token = currentToken(snapshot, record);
    const identity = runtimeIdentity(record, controlId);

    if (input.intent.type === 'action') {
      const result = await sessionService.processAction({
        sessionId: record.sessionId,
        actorId: record.actorId,
        content: actionContent(input.intent),
        messageId: `render:${record.renderSessionId}:${input.sequence}`,
        createdAt: new Date().toISOString()
      });
      return Object.freeze({
        schema: 'fenix.3d-runtime-action-result',
        version: 1,
        renderSessionId: record.renderSessionId,
        sequence: input.sequence,
        accepted: true,
        result
      });
    }

    let requestedToken;
    if (input.intent.type === 'look') {
      requestedToken = Object.freeze({
        ...token,
        rotation: input.intent.yaw
      });
    } else {
      requestedToken = projectRuntimeMovementIntent({
        token,
        scene: snapshot.scene,
        input,
        yawDegrees
      }).token;
    }

    const moved = await gateway.handleCommand(record.sessionId, identity, {
      type: RealtimeCommandType.TOKEN_MOVE,
      commandId: null,
      payload: { token: requestedToken }
    });

    if (input.intent.type === 'move' && explorationService && moved?.token) {
      await explorationService.recordExploration({
        campaignId: record.campaignId,
        userId: record.requestedByUserId,
        sceneId: record.sceneId,
        actorId: record.actorId,
        x: moved.token.x,
        y: moved.token.y,
        elevation: moved.token.elevation ?? 0
      }).catch((error) => {
        logger.warn?.('[Fênix][3D Runtime] falha ao persistir exploração', {
          renderSessionId: record.renderSessionId,
          actorId: record.actorId,
          code: error?.code,
          message: error?.message
        });
      });
    }

    const stateSync = createFenix3dRuntimeStateSync({
      renderSessionId: record.renderSessionId,
      revision: moved.revision,
      token: moved.token,
      collision: moved.collision,
      vertical: moved.vertical
    });
    const latestSnapshot = realtimeHub.getSnapshot(record.sessionId);
    return attachRuntimeSceneEntities(stateSync, latestSnapshot);
  };
}
