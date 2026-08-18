import { spawn } from 'node:child_process';
import { once } from 'node:events';

function launcherError(message, code, statusCode = 500, cause = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (cause) error.cause = cause;
  return error;
}

function clean(value) {
  return String(value ?? '').replace(/[\0\r\n]/g, '').trim();
}

function fillTemplate(template, values) {
  let result = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, clean(value));
  }
  return result;
}

function safeWebSocketUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ['ws:', 'wss:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeHttpBaseUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString().replace(/\/$/, '') : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function launchValues(record) {
  return {
    renderSessionId: record.renderSessionId,
    campaignId: record.request.campaignId,
    sessionId: record.request.sessionId ?? '',
    sceneId: record.request.sceneId,
    actorId: record.request.actorId,
    tokenId: record.request.tokenId ?? '',
    targetFps: record.request.targetFps,
    maxWidth: record.request.maxWidth,
    maxHeight: record.request.maxHeight
  };
}

export function createUnrealPixelStreamingArgs(record, {
  streamerUrlTemplate,
  extraArgs = []
} = {}) {
  const values = launchValues(record);
  const streamerUrl = safeWebSocketUrl(fillTemplate(streamerUrlTemplate, values));
  if (!streamerUrl) {
    throw launcherError('FENIX_RENDER_STREAMER_URL_TEMPLATE precisa gerar ws:// ou wss://.', 'FENIX_RENDER_STREAMER_URL_INVALID', 503);
  }

  return Object.freeze([
    '-RenderOffscreen',
    `-PixelStreamingURL=${streamerUrl}`,
    `-PixelStreamingWebRTCMaxFps=${Math.max(24, Math.min(120, Number(record.request.targetFps) || 60))}`,
    `-FenixRenderSessionId=${clean(record.renderSessionId)}`,
    `-FenixCampaignId=${clean(record.request.campaignId)}`,
    `-FenixSceneId=${clean(record.request.sceneId)}`,
    `-FenixActorId=${clean(record.request.actorId)}`,
    `-FenixTokenId=${clean(record.request.tokenId ?? '')}`,
    ...extraArgs.map((argument) => fillTemplate(argument, values))
  ]);
}

export class ProcessRenderRuntimeLauncher {
  constructor({
    command,
    cwd = null,
    streamerUrlTemplate,
    bootstrapBaseUrl = null,
    extraArgs = [],
    startupGraceMs = 2500,
    stopTimeoutMs = 5000,
    spawnImpl = spawn,
    logger = console
  } = {}) {
    this.command = clean(command);
    this.cwd = cwd ? clean(cwd) : undefined;
    this.streamerUrlTemplate = String(streamerUrlTemplate ?? '').trim();
    this.bootstrapBaseUrl = safeHttpBaseUrl(bootstrapBaseUrl);
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs.map(String) : [];
    this.startupGraceMs = Math.max(100, Number(startupGraceMs) || 2500);
    this.stopTimeoutMs = Math.max(500, Number(stopTimeoutMs) || 5000);
    this.spawnImpl = spawnImpl;
    this.logger = logger;
    this.processes = new Map();
  }

  get enabled() {
    return Boolean(this.command && this.streamerUrlTemplate);
  }

  list() {
    return [...this.processes.entries()].map(([renderSessionId, entry]) => ({
      renderSessionId,
      pid: entry.child.pid ?? null,
      startedAt: entry.startedAt
    }));
  }

  async start(record) {
    if (!this.enabled) {
      throw launcherError('Launcher de runtime 3D não configurado.', 'FENIX_RENDER_RUNTIME_LAUNCHER_NOT_CONFIGURED', 503);
    }
    const existing = this.processes.get(record.renderSessionId);
    if (existing && existing.child.exitCode == null) return existing;

    const args = createUnrealPixelStreamingArgs(record, {
      streamerUrlTemplate: this.streamerUrlTemplate,
      extraArgs: this.extraArgs
    });
    const bootstrapUrl = record.request?.worldBootstrap && this.bootstrapBaseUrl
      ? `${this.bootstrapBaseUrl}/v1/runtime/bootstrap/${encodeURIComponent(record.renderSessionId)}`
      : '';

    let child;
    try {
      child = this.spawnImpl(this.command, args, {
        cwd: this.cwd,
        env: {
          ...process.env,
          FENIX_RENDER_SESSION_ID: record.renderSessionId,
          FENIX_CAMPAIGN_ID: record.request.campaignId,
          FENIX_SCENE_ID: record.request.sceneId,
          FENIX_ACTOR_ID: record.request.actorId,
          FENIX_TOKEN_ID: record.request.tokenId ?? '',
          FENIX_WORLD_BOOTSTRAP_URL: bootstrapUrl,
          FENIX_WORLD_BOOTSTRAP_TOKEN: bootstrapUrl ? record.runtimeAccessToken : ''
        },
        shell: false,
        windowsHide: true,
        stdio: 'ignore'
      });
    } catch (error) {
      throw launcherError('Falha ao iniciar o runtime 3D.', 'FENIX_RENDER_RUNTIME_SPAWN_FAILED', 503, error);
    }

    let launchError = null;
    let exited = false;
    child.once('error', (error) => { launchError = error; });
    child.once('exit', (code, signal) => {
      exited = true;
      const current = this.processes.get(record.renderSessionId);
      if (current?.child === child) this.processes.delete(record.renderSessionId);
      this.logger.info?.('[Fênix][Render Runtime] processo encerrado', {
        renderSessionId: record.renderSessionId,
        pid: child.pid ?? null,
        code,
        signal
      });
    });

    await delay(this.startupGraceMs);
    if (launchError || exited || child.exitCode != null) {
      throw launcherError('Runtime 3D encerrou durante a inicialização.', 'FENIX_RENDER_RUNTIME_EARLY_EXIT', 503, launchError);
    }

    const entry = Object.freeze({
      child,
      args,
      startedAt: new Date().toISOString()
    });
    this.processes.set(record.renderSessionId, entry);
    this.logger.info?.('[Fênix][Render Runtime] processo iniciado', {
      renderSessionId: record.renderSessionId,
      pid: child.pid ?? null,
      command: this.command
    });
    return entry;
  }

  async stop(renderSessionId) {
    const id = String(renderSessionId ?? '');
    const entry = this.processes.get(id);
    if (!entry) return false;
    const { child } = entry;
    this.processes.delete(id);
    if (child.exitCode != null) return true;

    try {
      child.kill('SIGTERM');
    } catch {
      return true;
    }

    const exited = once(child, 'exit').then(() => true).catch(() => true);
    const timedOut = delay(this.stopTimeoutMs).then(() => false);
    if (await Promise.race([exited, timedOut])) return true;

    if (child.exitCode == null) {
      try { child.kill('SIGKILL'); } catch { /* processo já saiu */ }
    }
    return true;
  }

  async stopAll() {
    const ids = [...this.processes.keys()];
    await Promise.allSettled(ids.map((id) => this.stop(id)));
    return ids.length;
  }
}
