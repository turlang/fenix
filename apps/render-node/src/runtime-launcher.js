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

function safeHttpUrl(value) {
  try {
    const parsed = new URL(String(value));
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeHttpBaseUrl(value) {
  const url = safeHttpUrl(value);
  return url ? url.replace(/\/$/, '') : null;
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
    `-PixelStreamingID=${clean(record.renderSessionId)}`,
    `-PixelStreamingWebRTCMaxFps=${Math.max(24, Math.min(120, Number(record.request.targetFps) || 60))}`,
    `-ResX=${Math.max(640, Math.min(3840, Number(record.request.maxWidth) || 1920))}`,
    `-ResY=${Math.max(360, Math.min(2160, Number(record.request.maxHeight) || 1080))}`,
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
    readyUrlTemplate = null,
    extraArgs = [],
    startupGraceMs = 1500,
    readyTimeoutMs = 15_000,
    readyIntervalMs = 500,
    stopTimeoutMs = 5000,
    spawnImpl = spawn,
    fetchImpl = globalThis.fetch,
    logger = console
  } = {}) {
    this.command = clean(command);
    this.cwd = cwd ? clean(cwd) : undefined;
    this.streamerUrlTemplate = String(streamerUrlTemplate ?? '').trim();
    this.bootstrapBaseUrl = safeHttpBaseUrl(bootstrapBaseUrl);
    this.readyUrlTemplate = String(readyUrlTemplate ?? '').trim();
    this.extraArgs = Array.isArray(extraArgs) ? extraArgs.map(String) : [];
    this.startupGraceMs = Math.max(100, Number(startupGraceMs) || 1500);
    this.readyTimeoutMs = Math.max(500, Number(readyTimeoutMs) || 15_000);
    this.readyIntervalMs = Math.max(100, Number(readyIntervalMs) || 500);
    this.stopTimeoutMs = Math.max(500, Number(stopTimeoutMs) || 5000);
    this.spawnImpl = spawnImpl;
    this.fetchImpl = typeof fetchImpl === 'function' ? fetchImpl : null;
    this.logger = logger;
    this.processes = new Map();
  }

  get enabled() {
    return Boolean(this.command && this.streamerUrlTemplate);
  }

  get readinessConfigured() {
    return Boolean(this.readyUrlTemplate && this.fetchImpl);
  }

  list() {
    return [...this.processes.entries()].map(([renderSessionId, entry]) => ({
      renderSessionId,
      pid: entry.child.pid ?? null,
      startedAt: entry.startedAt,
      readyAt: entry.readyAt ?? null
    }));
  }

  async #waitUntilReady(record, child) {
    if (!this.readinessConfigured) return null;
    const url = safeHttpUrl(fillTemplate(this.readyUrlTemplate, launchValues(record)));
    if (!url) {
      throw launcherError('FENIX_RENDER_RUNTIME_READY_URL_TEMPLATE precisa gerar http:// ou https://.', 'FENIX_RENDER_RUNTIME_READY_URL_INVALID', 503);
    }

    const deadline = Date.now() + this.readyTimeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
      if (child.exitCode != null) {
        throw launcherError('Runtime 3D encerrou antes de ficar pronto.', 'FENIX_RENDER_RUNTIME_EARLY_EXIT', 503, lastError);
      }
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          redirect: 'follow',
          cache: 'no-store',
          signal: AbortSignal.timeout(Math.min(3000, this.readyIntervalMs * 4))
        });
        if (response.status >= 200 && response.status < 400) {
          return Object.freeze({ url, status: response.status, readyAt: new Date().toISOString() });
        }
        lastError = new Error(`HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await delay(this.readyIntervalMs);
    }

    throw launcherError('Pixel Streaming não ficou pronto dentro do timeout.', 'FENIX_RENDER_RUNTIME_READY_TIMEOUT', 503, lastError);
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
    const manifestUrl = record.runtimeManifest && this.bootstrapBaseUrl
      ? `${this.bootstrapBaseUrl}/v1/runtime/bootstrap/${encodeURIComponent(record.renderSessionId)}`
      : '';
    const runtimeControl = record.request?.runtimeControl ?? null;

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
          FENIX_RUNTIME_MANIFEST_URL: manifestUrl,
          FENIX_RUNTIME_MANIFEST_TOKEN: manifestUrl ? record.runtimeAccessToken : '',
          FENIX_WORLD_BOOTSTRAP_URL: manifestUrl,
          FENIX_WORLD_BOOTSTRAP_TOKEN: manifestUrl ? record.runtimeAccessToken : '',
          FENIX_RUNTIME_CONTROL_ID: runtimeControl?.controlId ?? '',
          FENIX_RUNTIME_CONTROL_URL: runtimeControl?.inputUrl ?? '',
          FENIX_RUNTIME_CONTROL_TOKEN: runtimeControl?.accessToken ?? ''
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

    let readiness = null;
    try {
      readiness = await this.#waitUntilReady(record, child);
    } catch (error) {
      try { child.kill('SIGTERM'); } catch { /* processo já saiu */ }
      throw error;
    }

    const entry = Object.freeze({
      child,
      args,
      startedAt: new Date().toISOString(),
      readyAt: readiness?.readyAt ?? null,
      readiness
    });
    this.processes.set(record.renderSessionId, entry);
    this.logger.info?.('[Fênix][Render Runtime] processo iniciado', {
      renderSessionId: record.renderSessionId,
      pid: child.pid ?? null,
      command: this.command,
      readyAt: entry.readyAt
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
