import { createRenderNodeConfig } from './config.js';
import { RenderSessionRegistry } from './session-registry.js';
import { createRenderNodeApp } from './app.js';

const config = createRenderNodeConfig();
const registry = new RenderSessionRegistry({
  nodeId: config.nodeId,
  region: config.region,
  capacity: config.capacity,
  sessionTtlMs: config.sessionTtlMs,
  renderer: config.renderer,
  playerUrlTemplate: config.playerUrlTemplate,
  signallingUrlTemplate: config.signallingUrlTemplate
});
const app = createRenderNodeApp({ config, registry });

async function shutdown(signal) {
  app.log.info({ signal, activeSessions: registry.size }, 'Encerrando Fênix Render Node');
  await app.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal).catch((error) => {
    app.log.error(error, 'Falha ao encerrar Render Node');
    process.exitCode = 1;
  }));
}

await app.listen({ host: config.host, port: config.port });
app.log.info({
  nodeId: config.nodeId,
  region: config.region,
  capacity: config.capacity,
  renderer: config.renderer,
  runtimeConfigured: config.runtimeConfigured
}, 'Fênix Render Node iniciado');
