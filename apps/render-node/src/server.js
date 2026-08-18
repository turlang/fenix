import { createServer } from 'node:http';
import { createRenderNodeConfig } from './config.js';
import { RenderSessionRegistry } from './session-registry.js';
import { createRenderNodeHandler } from './app.js';

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
const server = createServer(createRenderNodeHandler({ config, registry }));

function closeServer() {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function shutdown(signal) {
  console.info('[Fênix][Render Node] encerrando', { signal, activeSessions: registry.size });
  await closeServer();
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
    runtimeConfigured: config.runtimeConfigured
  });
});
