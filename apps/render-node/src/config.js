function integer(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function stringArray(value) {
  const raw = text(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item ?? '')).filter(Boolean).slice(0, 64)
      : [];
  } catch {
    return [];
  }
}

export function createRenderNodeConfig(env = process.env) {
  const token = text(env.FENIX_RENDER_NODE_TOKEN);
  const playerUrlTemplate = text(env.FENIX_RENDER_PLAYER_URL_TEMPLATE);
  const signallingUrlTemplate = text(env.FENIX_RENDER_SIGNALLING_URL_TEMPLATE);
  const nodeId = text(env.FENIX_RENDER_NODE_ID, 'render-node-01');
  const requestedMode = text(env.FENIX_RENDER_RUNTIME_MODE, 'external').toLowerCase();
  const runtimeMode = requestedMode === 'process' ? 'process' : 'external';
  const runtimeCommand = text(env.FENIX_RENDER_RUNTIME_COMMAND);
  const streamerUrlTemplate = text(env.FENIX_RENDER_STREAMER_URL_TEMPLATE);
  const processConfigured = Boolean(runtimeCommand && streamerUrlTemplate);

  return Object.freeze({
    host: text(env.FENIX_RENDER_NODE_HOST, '0.0.0.0'),
    port: integer(env.FENIX_RENDER_NODE_PORT, 9000, 1, 65535),
    nodeId,
    region: text(env.FENIX_RENDER_NODE_REGION) || null,
    authToken: token,
    capacity: integer(env.FENIX_RENDER_NODE_CAPACITY, 2, 1, 128),
    sessionTtlMs: integer(env.FENIX_RENDER_SESSION_TTL_MS, 30 * 60 * 1000, 60_000, 24 * 60 * 60 * 1000),
    renderer: text(env.FENIX_RENDERER_KIND, 'unreal-pixel-streaming'),
    playerUrlTemplate,
    signallingUrlTemplate,
    runtimeMode,
    runtimeCommand,
    runtimeCwd: text(env.FENIX_RENDER_RUNTIME_CWD) || null,
    runtimeExtraArgs: Object.freeze(stringArray(env.FENIX_RENDER_RUNTIME_EXTRA_ARGS_JSON)),
    streamerUrlTemplate,
    runtimeStartupGraceMs: integer(env.FENIX_RENDER_RUNTIME_STARTUP_GRACE_MS, 2500, 100, 60_000),
    runtimeStopTimeoutMs: integer(env.FENIX_RENDER_RUNTIME_STOP_TIMEOUT_MS, 5000, 500, 60_000),
    runtimeConfigured: Boolean(playerUrlTemplate) && (runtimeMode === 'external' || processConfigured),
    allowUnauthenticatedHealth: /^(1|true|yes|on)$/i.test(text(env.FENIX_RENDER_NODE_PUBLIC_HEALTH, 'false'))
  });
}
