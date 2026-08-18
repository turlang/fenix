import {
  PlatformRenderMode,
  PlatformViewMode,
  normalizeViewRequest
} from '../../platform-protocol/src/index.js';

function renderError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function text(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function finite(value, fallback = 0, min = -1, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function safeUrl(value, allowedProtocols) {
  const raw = text(value, 1000);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return allowedProtocols.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeWorldBootstrap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== 'fenix.render-world-bootstrap' || Number(value.version) !== 1) {
    throw renderError('World bootstrap inválido.', 'FENIX_RENDER_BOOTSTRAP_INVALID');
  }
  return Object.freeze(structuredClone(value));
}

export const RenderTransport = Object.freeze({
  WEBRTC: 'webrtc'
});

export const RenderCodec = Object.freeze({
  H264: 'h264',
  AV1: 'av1',
  VP9: 'vp9'
});

export const PlayerInputType = Object.freeze({
  MOVE: 'move',
  LOOK: 'look',
  ACTION: 'action'
});

export function createRemoteRenderSessionRequest(input = {}) {
  const view = normalizeViewRequest({
    ...input,
    viewMode: PlatformViewMode.FIRST_PERSON,
    renderMode: PlatformRenderMode.CLOUD
  });
  const campaignId = text(input.campaignId);
  const sceneId = text(input.sceneId ?? view.sceneId);
  if (!campaignId) throw renderError('campaignId é obrigatório para render remoto.', 'FENIX_RENDER_CAMPAIGN_REQUIRED');
  if (!sceneId) throw renderError('sceneId é obrigatório para render remoto.', 'FENIX_RENDER_SCENE_REQUIRED');

  const preferredCodecs = [...new Set((input.preferredCodecs ?? [RenderCodec.AV1, RenderCodec.H264])
    .map((codec) => text(codec, 20).toLowerCase())
    .filter((codec) => Object.values(RenderCodec).includes(codec)))];

  return Object.freeze({
    version: 1,
    campaignId,
    sessionId: text(input.sessionId) || null,
    sceneId,
    actorId: view.actorId,
    tokenId: view.tokenId,
    viewMode: view.viewMode,
    renderMode: view.renderMode,
    transport: RenderTransport.WEBRTC,
    preferredCodecs: Object.freeze(preferredCodecs),
    targetFps: Math.max(24, Math.min(120, Number(input.targetFps) || 60)),
    maxWidth: Math.max(640, Math.min(3840, Number(input.maxWidth) || 1920)),
    maxHeight: Math.max(360, Math.min(2160, Number(input.maxHeight) || 1080)),
    worldBootstrap: normalizeWorldBootstrap(input.worldBootstrap)
  });
}

export function normalizePlayerInputIntent(input = {}) {
  const type = text(input.type, 30).toLowerCase();
  if (!Object.values(PlayerInputType).includes(type)) {
    throw renderError('Input de primeira pessoa inválido.', 'FENIX_RENDER_INPUT_INVALID');
  }

  if (type === PlayerInputType.MOVE) {
    return Object.freeze({
      type,
      forward: finite(input.forward),
      strafe: finite(input.strafe),
      run: input.run === true,
      sequence: Math.max(0, Number(input.sequence) || 0)
    });
  }

  if (type === PlayerInputType.LOOK) {
    return Object.freeze({
      type,
      yaw: finite(input.yaw, 0, -180, 180),
      pitch: finite(input.pitch, 0, -89, 89),
      sequence: Math.max(0, Number(input.sequence) || 0)
    });
  }

  const action = text(input.action, 80);
  if (!action) throw renderError('Ação interativa é obrigatória.', 'FENIX_RENDER_ACTION_REQUIRED');
  return Object.freeze({
    type,
    action,
    targetId: text(input.targetId) || null,
    sequence: Math.max(0, Number(input.sequence) || 0)
  });
}

export function createRenderSessionDescriptor(input = {}) {
  const renderSessionId = text(input.renderSessionId);
  if (!renderSessionId) throw renderError('renderSessionId é obrigatório.', 'FENIX_RENDER_SESSION_REQUIRED');
  return Object.freeze({
    renderSessionId,
    status: text(input.status, 40) || 'ready',
    transport: RenderTransport.WEBRTC,
    playerUrl: safeUrl(input.playerUrl, ['https:', 'http:']),
    signallingUrl: safeUrl(input.signallingUrl, ['wss:', 'ws:']),
    expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : null,
    renderer: text(input.renderer, 120) || 'remote-3d-runtime',
    region: text(input.region, 120) || null
  });
}
