const baseUrl = String(process.env.FENIX_RENDER_NODE_INTERNAL_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = String(process.env.FENIX_RENDER_NODE_TOKEN ?? '').trim();
if (!token) {
  console.error('FENIX_RENDER_NODE_TOKEN é obrigatório para o smoke do Render Node.');
  process.exit(2);
}

const headers = { Authorization: `Bearer ${token}` };
const timeoutMs = Math.max(1000, Number(process.env.FENIX_3D_SMOKE_TIMEOUT_MS) || 20_000);
const requireProcessMode = !/^(0|false|no)$/i.test(String(process.env.FENIX_3D_SMOKE_REQUIRE_PROCESS ?? 'true'));
const requireReadiness = !/^(0|false|no)$/i.test(String(process.env.FENIX_3D_SMOKE_REQUIRE_READINESS ?? 'true'));
const requireEvidence = !/^(0|false|no)$/i.test(String(process.env.FENIX_3D_SMOKE_REQUIRE_EVIDENCE ?? 'true'));

async function request(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readHealth() {
  const response = await request(`${baseUrl}/health`, { headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status !== 'ok' || payload.configured !== true) {
    throw new Error(`Render Node não está pronto: HTTP ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
}

const health = await readHealth();
if (requireProcessMode && health.runtimeMode !== 'process') {
  throw new Error(`Smoke nativo exige Render Node em process mode; recebido ${health.runtimeMode}.`);
}
if (requireProcessMode && health.runtimeProcess?.enabled !== true) {
  throw new Error('Smoke nativo exige launcher Fenix3D habilitado no Render Node.');
}
if (requireEvidence && health.runtimeProcess?.evidenceRequired !== true) {
  throw new Error('Smoke nativo exige runtime evidence habilitada no Render Node.');
}
if (requireReadiness && health.runtimeProcess?.readinessConfigured !== true) {
  throw new Error('Smoke nativo exige readiness HTTP do Pixel Streaming configurada.');
}

const viewerToken = {
  tokenId: 'smoke-token', actorId: 'smoke-actor', sheetId: 'smoke-sheet', systemId: 'generic',
  name: 'Fenix3D Smoke', kind: 'character', x: 350, y: 350, elevation: 0,
  rotation: 0, size: 70, height: 1.8, visible: true, movementMode: 'ground'
};
const worldBootstrap = {
  schema: 'fenix.render-world-bootstrap', version: 1, createdAt: new Date().toISOString(),
  campaign: { id: 'smoke-campaign', title: 'Fenix3D Smoke', systemId: 'generic' },
  scene: {
    id: 'smoke-scene', name: 'Technical Playable Scene', width: 700, height: 700,
    backgroundAssetId: null,
    grid: { size: 70, scale: { distancePerCell: 1.5, unit: 'm' } },
    physical: {
      walls: [
        { id: 'smoke-wall', kind: 'wall', a: { x: 140, y: 140 }, b: { x: 560, y: 140 } }
      ],
      regions: [],
      elevation: { enabled: false, unit: 'm', levelHeight: 3, levels: [] },
      lighting: { enabled: true, darkness: 0.2, sources: [] }
    },
    fog: { enabled: false, exploredCells: [] }
  },
  tokens: [viewerToken],
  viewer: {
    token: viewerToken,
    actor: {
      actorId: 'smoke-actor', sheetId: 'smoke-sheet', systemId: 'generic',
      movement: { walk: 9 }, vision: { preferredSense: 'normal' }
    },
    camera: {
      sceneX: 350, sceneY: 350, elevation: 0, eyeHeight: 1.6,
      visionDistance: 18, preferredSense: 'normal', unit: 'm'
    }
  }
};

let renderSessionId = null;
try {
  const createResponse = await request(`${baseUrl}/v1/render-sessions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      campaignId: 'smoke-campaign', sceneId: 'smoke-scene', actorId: 'smoke-actor', tokenId: 'smoke-token',
      targetFps: 60, maxWidth: 1280, maxHeight: 720, worldBootstrap,
      runtimeControl: {
        controlId: 'smoke-control',
        inputUrl: 'http://127.0.0.1:65534/v1/runtime-control/smoke',
        accessToken: 'smoke-runtime-control-token-000001'
      }
    })
  });
  const descriptor = await createResponse.json().catch(() => ({}));
  if (!createResponse.ok || !descriptor.renderSessionId || !descriptor.playerUrl) {
    throw new Error(`Falha ao criar sessão Fenix3D: HTTP ${createResponse.status} ${JSON.stringify(descriptor)}`);
  }
  renderSessionId = descriptor.renderSessionId;

  const afterCreate = await readHealth();
  const process = afterCreate.runtimeProcess?.processes?.find((entry) => entry.renderSessionId === renderSessionId);
  if (requireProcessMode && !process?.pid) {
    throw new Error(`Fenix3D.exe não apareceu como processo ativo para ${renderSessionId}.`);
  }
  if (requireReadiness && !process?.readyAt) {
    throw new Error(`Fenix3D.exe iniciou, mas não confirmou readiness para ${renderSessionId}.`);
  }

  const evidenceResponse = await request(`${baseUrl}/v1/render-sessions/${encodeURIComponent(renderSessionId)}/runtime-status`, { headers });
  const evidence = await evidenceResponse.json().catch(() => ({}));
  if (requireEvidence) {
    if (!evidenceResponse.ok || evidence.ready !== true || evidence.stage !== 'ready') {
      throw new Error(`Fenix3D não comprovou runtime ready: HTTP ${evidenceResponse.status} ${JSON.stringify(evidence)}`);
    }
    if (evidence.worldBuilt !== true || evidence.controlConfigured !== true) {
      throw new Error(`Runtime evidence incompleta: ${JSON.stringify(evidence)}`);
    }
    if (evidence.manifest?.schema !== 'fenix.3d-runtime-manifest' || Number(evidence.manifest?.version) !== 1) {
      throw new Error(`Runtime carregou manifest inesperado: ${JSON.stringify(evidence.manifest)}`);
    }
  }

  const playerResponse = await request(descriptor.playerUrl, { redirect: 'follow' });
  if (playerResponse.status < 200 || playerResponse.status >= 500) {
    throw new Error(`Pixel Streaming player respondeu HTTP ${playerResponse.status}.`);
  }

  console.log(JSON.stringify({
    ok: true,
    nodeId: health.nodeId,
    runtimeMode: health.runtimeMode,
    renderSessionId,
    processPid: process?.pid ?? null,
    processReadyAt: process?.readyAt ?? null,
    runtimeEvidence: evidence,
    playerUrl: descriptor.playerUrl,
    signallingUrl: descriptor.signallingUrl ?? null
  }, null, 2));
} finally {
  if (renderSessionId) {
    await request(`${baseUrl}/v1/render-sessions/${encodeURIComponent(renderSessionId)}`, {
      method: 'DELETE', headers
    }).catch(() => undefined);
  }
}
