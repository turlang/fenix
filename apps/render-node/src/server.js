import { createServer } from 'node:http';
import { createRenderNodeConfig } from './config.js';
import { RenderSessionRegistry } from './session-registry.js';
import { createRenderNodeHandler } from './app.js';
import { ProcessRenderRuntimeLauncher } from './runtime-launcher.js';

const config = createRenderNodeConfig();
const runtimeLauncher = config.runtimeMode === 'process'
  ? new ProcessRenderRuntimeLauncher({
      command: config.runtimeCommand,
      cwd: config.runtimeCwd,
      streamerUrlTemplate: config.streamerUrlTemplate,
      bootstrapBaseUrl: config.runtimeBootstrapBaseUrl,
      readyUrlTemplate: config.runtimeReadyUrlTemplate,
      extraArgs: config.runtimeExtraArgs,
      startupGraceMs: config.runtimeStartupGraceMs,
      readyTimeoutMs: config.runtimeReadyTimeoutMs,
      readyIntervalMs: config.runtimeReadyIntervalMs,
      stopTimeoutMs: config.runtimeStopTimeoutMs,
      logger: console
    })
  : null;
const registry = new RenderSessionRegistry({
  nodeId: config.nodeId,
  region: config.region,
  capacity: config.capacity,
  sessionTtlMs: config.sessionTtlMs,
  renderer: config.renderer,
  playerUrlTemplate: config.playerUrlTemplate,
  signallingUrlTemplate: config.signallingUrlTemplate,
  onExpire: runtimeLauncher ? (record) => runtimeLauncher.stop(record.renderSessionId) : null
});
const server = createServer(createRenderNodeHandler({ config, registry, runtimeLauncher }));

function closeServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function shutdown(signal) {
  console.info('[Fênix][Render Node] encerrando', {
    signal,
    activeSessions: registry.size,
    activeProcesses: runtimeLauncher?.list().length ?? 0
  });
  await closeServer();
  await runtimeLauncher?.stopAll();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    console.error('[Fênix][Render Node] falha ao encerrar', error);
    process.exitCode = 1;
  }));
}

server.listen(config.port, config.host, () => {
  console.info('[Fênix][Render Node] iniciado', {
    host: config.host,
    port: config.port,
    nodeId: config.nodeId,
    region: config.region,
    capacity: config.capacity,
    renderer: config.renderer,
    runtimeMode: config.runtimeMode,
    runtimeConfigured: config.runtimeConfigured,
    processLauncherEnabled: runtimeLauncher?.enabled ?? false,
    runtimeReadinessConfigured: runtimeLauncher?.readinessConfigured ?? false
  });
});
