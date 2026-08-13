import { access, readFile } from 'node:fs/promises';
const required = [
  'apps/api/src/server.js',
  'apps/api/src/app.js',
  'apps/api/src/http/session-controller.js',
  'apps/api/src/http/session-schemas.js',
  'apps/api/src/http/register-session-routes.js',
  'apps/api/src/http/register-auth-routes.js',
  'apps/api/src/http/register-campaign-routes.js',
  'apps/api/src/http/register-scene-routes.js',
  'apps/api/src/http/session-authorizer.js',
  'apps/api/src/realtime/register-realtime-routes.js',
  'apps/api/src/realtime/owner-aware-websocket-proxy.js',
  'apps/foundry-module/module.json',
  'apps/fenix-vtt/package.json',
  'apps/fenix-vtt/postcss.config.mjs',
  'apps/fenix-vtt/.env.example',
  'apps/fenix-vtt/app/layout.js',
  'apps/fenix-vtt/app/page.js',
  'apps/fenix-vtt/app/globals.css',
  'apps/fenix-vtt/app/live-bridge.css',
  'apps/fenix-vtt/app/wall-authoring.css',
  'apps/fenix-vtt/app/fog-of-war.css',
  'apps/fenix-vtt/app/advanced-vision.css',
  'apps/fenix-vtt/app/dynamic-lighting.css',
  'apps/fenix-vtt/components/auth-campaign-gate.jsx',
  'apps/fenix-vtt/components/vtt-shell.jsx',
  'apps/fenix-vtt/components/map-stage.jsx',
  'apps/fenix-vtt/components/fog-of-war-overlay.jsx',
  'apps/fenix-vtt/components/advanced-vision-editor.jsx',
  'apps/fenix-vtt/components/dynamic-lighting-overlay.jsx',
  'apps/fenix-vtt/components/session-provider.jsx',
  'apps/fenix-vtt/lib/demo-scene.js',
  'apps/fenix-vtt/lib/fenix-api-client.js',
  'apps/fenix-vtt/lib/realtime-client.js',
  'apps/fenix-vtt/lib/session-state.js',
  'apps/fenix-vtt/lib/browser-audio-queue.js',
  'apps/fenix-vtt/lib/token-input-movement.js',
  'apps/fenix-vtt/next.config.mjs',
  'packages/core/src/index.js',
  'packages/vtt-contracts/src/index.js',
  'packages/standalone-vtt-adapter/src/index.js',
  'packages/map-renderer-port/src/index.js',
  'packages/webgl-map-renderer/src/index.js',
  'packages/scene-geometry/src/index.js',
  'packages/scene-collision/src/index.js',
  'packages/scene-vision/src/index.js',
  'packages/scene-lighting/src/index.js',
  'packages/scene-elevation/src/index.js',
  'packages/session-director/src/index.js',
  'packages/session-runtime/src/index.js',
  'packages/persistent-session-service/src/index.js',
  'packages/campaign-runtime-registry/src/index.js',
  'packages/distributed-runtime-coordination/src/index.js',
  'packages/owner-aware-runtime-router/src/index.js',
  'packages/distributed-command-ledger/src/index.js',
  'packages/runtime-observability/src/index.js',
  'packages/persistence-repository/src/index.js',
  'packages/asset-storage/src/index.js',
  'packages/remote-map-importer/src/index.js',
  'packages/auth-service/src/index.js',
  'packages/campaign-service/src/index.js',
  'packages/campaign-scene-service/src/index.js',
  'packages/realtime-session-gateway/src/index.js',
  'packages/narration-output/src/index.js',
  'packages/narration-context-builder/src/index.js',
  'packages/scene-opening-context/src/index.js',
  'packages/opening-narrative-planner/src/index.js',
  'packages/novelty-guard/src/index.js',
  'packages/narration-quality-guard/src/index.js',
  'packages/narration-memory/src/index.js',
  'packages/audio-narration-service/src/index.js',
  'packages/audio-queue/src/index.js',
  'packages/config/src/index.js',
  'packages/intent-interpreter/src/index.js',
  'packages/rules-service/src/index.js',
  'packages/relationship-service/src/index.js',
  'packages/narration-service/src/index.js',
  'packages/foundry-adapter/src/index.js',
  'packages/foundry-publisher/src/index.js',
  'packages/ai-provider/src/system-prompt.js',
  'integration-tests/realtime-websocket.mjs',
  'integration-tests/auth-campaign-http.mjs',
  'integration-tests/fog-http.mjs',
  'integration-tests/postgres-persistence.mjs',
  'integration-tests/distributed-runtime-coordination.mjs',
  'integration-tests/owner-aware-runtime-routing.mjs',
  'integration-tests/distributed-command-idempotency.mjs',
  'scripts/migrate-fenix-json-to-postgres.mjs',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  '.github/workflows/ci.yml',
  '.github/dependabot.yml',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'README.md',
  'docs/FENIX_SHARED_CORE.md',
  'docs/FENIX_VTT_UI_UX.md',
  'docs/FENIX_AUTH_PERSISTENCE.md',
  'docs/FENIX_WALLS_DOORS.md',
  'docs/FENIX_FOG_LOS.md',
  'docs/FENIX_ELEVATION_LEVELS.md'
];
for (const file of required) await access(new URL(`../${file}`, import.meta.url));

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const vttPackageJson = JSON.parse(await readFile(new URL('../apps/fenix-vtt/package.json', import.meta.url), 'utf8'));
const moduleJson = JSON.parse(await readFile(new URL('../apps/foundry-module/module.json', import.meta.url), 'utf8'));
const coreSource = await readFile(new URL('../packages/core/src/index.js', import.meta.url), 'utf8');
const coreVersion = coreSource.match(/ENGINE_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? null;
if (packageJson.version !== moduleJson.version || packageJson.version !== coreVersion || packageJson.version !== vttPackageJson.version) {
  throw new Error(`Versões divergentes: engine=${packageJson.version}, foundry=${moduleJson.version}, core=${coreVersion}, vtt=${vttPackageJson.version}`);
}
if (!packageJson.scripts?.test || !packageJson.scripts?.check || !packageJson.scripts?.['build:vtt']
  || !packageJson.scripts?.['test:realtime-integration'] || !packageJson.scripts?.['test:auth-integration']
  || !packageJson.scripts?.['test:fog-integration'] || !packageJson.scripts?.['test:postgres-integration']
  || !packageJson.scripts?.['test:coordination-integration'] || !packageJson.scripts?.['test:routing-integration']
  || !packageJson.scripts?.['test:idempotency-integration'] || !packageJson.scripts?.['migrate:postgres']) {
  throw new Error('Scripts de qualidade, autenticação, Fog, realtime, Postgres, coordenação, routing, idempotência, migração ou build do VTT ausentes.');
}
if (!/^\^?15\./.test(vttPackageJson.dependencies?.next ?? '')) {
  throw new Error('apps/fenix-vtt deve permanecer no Next.js 15 durante este marco.');
}
if (!/^\^?8\./.test(packageJson.dependencies?.pg ?? '')) {
  throw new Error('Engine deve declarar node-postgres 8.x neste marco.');
}

const standaloneUiFiles = [
  'apps/fenix-vtt/app/layout.js',
  'apps/fenix-vtt/app/page.js',
  'apps/fenix-vtt/components/auth-campaign-gate.jsx',
  'apps/fenix-vtt/components/vtt-shell.jsx',
  'apps/fenix-vtt/components/map-stage.jsx',
  'apps/fenix-vtt/components/fog-of-war-overlay.jsx',
  'apps/fenix-vtt/components/advanced-vision-editor.jsx',
  'apps/fenix-vtt/components/dynamic-lighting-overlay.jsx',
  'apps/fenix-vtt/components/session-provider.jsx',
  'apps/fenix-vtt/lib/demo-scene.js',
  'apps/fenix-vtt/lib/fenix-api-client.js',
  'apps/fenix-vtt/lib/realtime-client.js',
  'apps/fenix-vtt/lib/session-state.js',
  'apps/fenix-vtt/lib/browser-audio-queue.js',
  'apps/fenix-vtt/lib/token-input-movement.js'
];
const forbiddenUiImports = [
  'RulesService',
  'NarrationService',
  'GroqNarrativeProvider',
  'foundry-adapter',
  'foundry-module',
  'SessionDirector'
];
for (const file of standaloneUiFiles) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const forbiddenImport of forbiddenUiImports) {
    if (source.includes(forbiddenImport)) throw new Error(`Fronteira UI violada: ${file} referencia ${forbiddenImport}.`);
  }
}

const authSource = await readFile(new URL('../packages/auth-service/src/index.js', import.meta.url), 'utf8');
for (const marker of ['scrypt', 'randomBytes(32)', 'tokenHash', 'refreshFromRepository']) {
  if (!authSource.includes(marker)) throw new Error(`AuthService sem requisito: ${marker}.`);
}
const campaignSource = await readFile(new URL('../packages/campaign-service/src/index.js', import.meta.url), 'utf8');
for (const marker of ['refreshFromRepository', 'listActiveSessions']) {
  if (!campaignSource.includes(marker)) throw new Error(`CampaignService sem coordenação de cache: ${marker}.`);
}
const serverSource = await readFile(new URL('../apps/api/src/server.js', import.meta.url), 'utf8');
for (const marker of [
  'createAuthenticatedPeerAuthorizer',
  'CampaignRuntimeRegistry',
  'PostgresRuntimeLeaseManager',
  'PostgresStateBus',
  'OwnerAwareRuntimeRouter',
  'createCommandLedger',
  'RuntimeObservability',
  'RemoteMapImporter',
  'recordExploration',
  'resolveTokenVerticalState',
  'resolveRuntimeVerticalState',
  'elevation: result.token.elevation',
  "message.type === 'TOKEN_MOVE'"
]) {
  if (!serverSource.includes(marker)) throw new Error(`Composition root distribuído/Fog/elevação incompleto: ${marker}.`);
}
if (serverSource.includes('createDevelopmentPeerAuthorizer')) {
  throw new Error('Composition root de produção não pode usar authorizer realtime de desenvolvimento.');
}
const remoteMapSource = await readFile(new URL('../packages/remote-map-importer/src/index.js', import.meta.url), 'utf8');
for (const marker of ['REMOTE_MAP_PRIVATE_HOST_FORBIDDEN', 'resolvePublicRemoteHost', 'maxRedirects', 'REMOTE_MAP_SIGNATURE_INVALID']) {
  if (!remoteMapSource.includes(marker)) throw new Error(`Importador remoto sem hardening obrigatório: ${marker}.`);
}
const geometrySource = await readFile(new URL('../packages/scene-geometry/src/index.js', import.meta.url), 'utf8');
for (const marker of ['SceneWallKind', 'SceneDoorState', 'normalizeSceneWalls', 'wallBlocksMovement', 'wallBlocksVision', 'bottomElevation', 'topElevation']) {
  if (!geometrySource.includes(marker)) throw new Error(`Contrato de geometria de cena incompleto: ${marker}.`);
}
const collisionSource = await readFile(new URL('../packages/scene-collision/src/index.js', import.meta.url), 'utf8');
for (const marker of ['resolveTokenMovement', 'verticalEnabled', 'tokenVerticalBand', 'wallIntersectsVerticalBand']) {
  if (!collisionSource.includes(marker)) throw new Error(`Contrato de colisão vertical incompleto: ${marker}.`);
}
const elevationSource = await readFile(new URL('../packages/scene-elevation/src/index.js', import.meta.url), 'utf8');
for (const marker of ['TokenMovementMode', 'normalizeSceneElevation', 'normalizeTokenVerticalProfile', 'wallIntersectsVerticalBand', 'wallContainsElevation', 'eyeElevation', 'clampFlyingElevation']) {
  if (!elevationSource.includes(marker)) throw new Error(`Contrato 2.5D de elevação incompleto: ${marker}.`);
}
const visionSource = await readFile(new URL('../packages/scene-vision/src/index.js', import.meta.url), 'utf8');
for (const marker of ['normalizeSceneFog', 'hasLineOfSight', 'computeVisibilityPolygon', 'visibleGridCells', 'mergeExploredCells', 'originElevation', 'targetElevation', 'wallContainsElevation']) {
  if (!visionSource.includes(marker)) throw new Error(`Contrato de visão/Fog vertical incompleto: ${marker}.`);
}
const lightingSource = await readFile(new URL('../packages/scene-lighting/src/index.js', import.meta.url), 'utf8');
for (const marker of ['normalizeSceneLighting', 'computeSceneLightPolygons', 'resolveLightOrigin', 'elevation', 'verticalEnabled']) {
  if (!lightingSource.includes(marker)) throw new Error(`Contrato de iluminação vertical incompleto: ${marker}.`);
}
const sceneServiceSource = await readFile(new URL('../packages/campaign-scene-service/src/index.js', import.meta.url), 'utf8');
for (const marker of [
  'updateWalls',
  'normalizeSceneWalls',
  'updateFog',
  'recordExploration',
  'resolveRuntimeVerticalState',
  'normalizeSceneElevation',
  'eyeElevation',
  'visibleGridCells',
  'exploredByActor',
  'exploredCells',
  "requireRole(campaignId, userId, 'gm')"
]) {
  if (!sceneServiceSource.includes(marker)) throw new Error(`Scene Manager sem authoring/Fog/elevação persistente: ${marker}.`);
}
const sceneRoutesSource = await readFile(new URL('../apps/api/src/http/register-scene-routes.js', import.meta.url), 'utf8');
for (const marker of ['scenes/:sceneId/walls', 'scenes/:sceneId/fog', 'sceneElevation: request.body?.sceneElevation']) {
  if (!sceneRoutesSource.includes(marker)) throw new Error(`Endpoint de cena ausente: ${marker}.`);
}
const mapStageSource = await readFile(new URL('../apps/fenix-vtt/components/map-stage.jsx', import.meta.url), 'utf8');
for (const marker of ['FogOfWarOverlay', 'onFogChanged', 'fogPreview', 'Visão']) {
  if (!mapStageSource.includes(marker)) throw new Error(`MapStage sem UI de Fog/LOS: ${marker}.`);
}
const fogOverlaySource = await readFile(new URL('../apps/fenix-vtt/components/fog-of-war-overlay.jsx', import.meta.url), 'utf8');
for (const marker of ['computeVisibilityPolygon', 'visibleGridCells', 'exploredByActor', 'exploredCells', 'observerElevation', 'verticalEnabled']) {
  if (!fogOverlaySource.includes(marker)) throw new Error(`Overlay de Fog vertical incompleto: ${marker}.`);
}
const advancedVisionSource = await readFile(new URL('../apps/fenix-vtt/components/advanced-vision-editor.jsx', import.meta.url), 'utf8');
for (const marker of ['Níveis da cena', 'Voo / Z variável', 'Altura do corpo', 'sceneElevation', 'Aplicar faixa padrão às paredes', 'moveVertical']) {
  if (!advancedVisionSource.includes(marker)) throw new Error(`Editor de visão/elevação incompleto: ${marker}.`);
}
const directorSource = await readFile(new URL('../packages/session-director/src/index.js', import.meta.url), 'utf8');
for (const forbidden of [
  'PostgresRuntimeLeaseManager',
  'PostgresStateBus',
  'fenix_runtime_leases',
  'pg_notify',
  'PostgresCommandLedger',
  'fenix_command_ledger',
  'RuntimeObservability',
  'OwnerAwareRuntimeRouter',
  'RemoteMapImporter',
  'asset-storage',
  'SceneWallKind',
  'scene-geometry',
  'scene-collision',
  'scene-vision',
  'scene-lighting',
  'scene-elevation',
  'TokenMovementMode',
  'computeVisibilityPolygon',
  'visibleGridCells',
  'clampFlyingElevation'
]) {
  if (directorSource.includes(forbidden)) throw new Error(`SessionDirector não pode conhecer infraestrutura/authoring/visão/elevação: ${forbidden}.`);
}
const persistenceSource = await readFile(new URL('../packages/persistence-repository/src/index.js', import.meta.url), 'utf8');
for (const marker of ['PostgresFenixRepository', 'FOR UPDATE', "import('pg')", 'setChangePublisher']) {
  if (!persistenceSource.includes(marker)) throw new Error(`Persistência PostgreSQL incompleta: ${marker}.`);
}
const coordinationSource = await readFile(new URL('../packages/distributed-runtime-coordination/src/index.js', import.meta.url), 'utf8');
for (const marker of ['fenix_runtime_leases', 'pg_notify', 'LISTEN', 'generation', 'lease_until', 'assertOwned']) {
  if (!coordinationSource.includes(marker)) throw new Error(`Coordenação distribuída incompleta: ${marker}.`);
}
const routingSource = await readFile(new URL('../packages/owner-aware-runtime-router/src/index.js', import.meta.url), 'utf8');
for (const marker of ['RuntimeRoutingSigner', 'x-fenix-route-signature', 'RUNTIME_OWNER_TIMEOUT', 'hasCommandId']) {
  if (!routingSource.includes(marker)) throw new Error(`Owner-aware routing incompleto: ${marker}.`);
}
const ledgerSource = await readFile(new URL('../packages/distributed-command-ledger/src/index.js', import.meta.url), 'utf8');
for (const marker of ['fenix_command_ledger', 'IN_PROGRESS', 'COMPLETED', 'UNKNOWN', 'pg_advisory_xact_lock', 'COMMAND_ID_CONFLICT', 'COMMAND_OUTCOME_UNKNOWN']) {
  if (!ledgerSource.includes(marker)) throw new Error(`Ledger distribuído de comandos incompleto: ${marker}.`);
}
const observabilitySource = await readFile(new URL('../packages/runtime-observability/src/index.js', import.meta.url), 'utf8');
for (const marker of ['RuntimeObservability', 'fenix_runtime_events_total', 'toPrometheus']) {
  if (!observabilitySource.includes(marker)) throw new Error(`Observabilidade de runtime incompleta: ${marker}.`);
}
const appSource = await readFile(new URL('../apps/api/src/app.js', import.meta.url), 'utf8');
for (const marker of ["app.get('/ready'", "app.get('/metrics'", "app.get('/v1/runtime/observability'", 'X-Idempotency-Key']) {
  if (!appSource.includes(marker)) throw new Error(`Borda operacional incompleta: ${marker}.`);
}
const realtimeSource = await readFile(new URL('../packages/realtime-session-gateway/src/index.js', import.meta.url), 'utf8');
for (const marker of ['normalizeSceneWalls', 'SCENE_UPDATED', 'REALTIME_SCENE_FORBIDDEN', 'resolveTokenVerticalState', 'clampFlyingElevation', 'movementMode', 'verticalEnabled']) {
  if (!realtimeSource.includes(marker)) throw new Error(`Realtime sem geometria/elevação autoritativa: ${marker}.`);
}
const realtimeClientSource = await readFile(new URL('../apps/fenix-vtt/lib/realtime-client.js', import.meta.url), 'utf8');
if (/searchParams\.set\(['"](?:role|actorId|userId)['"]/.test(realtimeClientSource)) {
  throw new Error('Cliente realtime não pode transportar autoridade de role/actor/user na URL.');
}

const forbidden = ['.env', 'node_modules', 'data/narration-history.json', 'data/fenix-state.json'];
for (const path of forbidden) {
  try {
    await access(new URL(`../${path}`, import.meta.url));
    console.warn(`Aviso local: ${path} existe, mas deve permanecer fora do Git.`);
  } catch {
    // Ausência esperada em uma cópia limpa do repositório.
  }
}
console.log(`Estrutura modular válida (${packageJson.version}).`);