import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const requireRuntime = args.has('--runtime');
const requireInfra = args.has('--infra');
const skipGpu = /^(1|true|yes)$/i.test(String(process.env.FENIX_GPU_PREFLIGHT_SKIP_NVIDIA ?? ''));
const engineRoot = String(process.env.FENIX_UNREAL_ENGINE_ROOT ?? '').trim();
const runtimeCommand = String(process.env.FENIX_RENDER_RUNTIME_COMMAND ?? '').trim();
const infraRoot = String(process.env.FENIX_PIXEL_STREAMING_INFRA_ROOT ?? '').trim();
const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(`${name}: ${detail}`);
}

function validUrl(value, protocols) {
  try {
    return protocols.includes(new URL(String(value)).protocol);
  } catch {
    return false;
  }
}

check('platform', process.platform === 'win32', process.platform === 'win32' ? 'Windows x64' : `esperado Windows, recebido ${process.platform}`);
check('node', Number(process.versions.node.split('.')[0]) >= 20, `Node ${process.versions.node}`);

const runUat = engineRoot ? path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'RunUAT.bat') : '';
const buildBat = engineRoot ? path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat') : '';
check('unreal-5.5-root', Boolean(engineRoot && existsSync(runUat) && existsSync(buildBat)), engineRoot || 'FENIX_UNREAL_ENGINE_ROOT ausente');

if (!skipGpu) {
  const gpu = spawnSync('nvidia-smi', ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader'], {
    encoding: 'utf8', windowsHide: true, shell: false
  });
  check('nvidia-gpu', gpu.status === 0, gpu.status === 0 ? gpu.stdout.trim() : (gpu.stderr || 'nvidia-smi indisponível').trim());
} else {
  checks.push({ name: 'nvidia-gpu', ok: true, detail: 'ignorado por FENIX_GPU_PREFLIGHT_SKIP_NVIDIA' });
}

if (requireRuntime) {
  check('runtime-mode', String(process.env.FENIX_RENDER_RUNTIME_MODE ?? '').toLowerCase() === 'process', 'FENIX_RENDER_RUNTIME_MODE deve ser process');
  check('runtime-executable', Boolean(runtimeCommand && existsSync(runtimeCommand)), runtimeCommand || 'FENIX_RENDER_RUNTIME_COMMAND ausente');
  check('render-node-token', String(process.env.FENIX_RENDER_NODE_TOKEN ?? '').trim().length >= 24, 'FENIX_RENDER_NODE_TOKEN deve ter pelo menos 24 caracteres');
  check('streamer-url', validUrl(process.env.FENIX_RENDER_STREAMER_URL_TEMPLATE, ['ws:', 'wss:']), 'FENIX_RENDER_STREAMER_URL_TEMPLATE deve ser ws:// ou wss://');
  check('player-url', validUrl(String(process.env.FENIX_RENDER_PLAYER_URL_TEMPLATE ?? '').replaceAll('{renderSessionId}', 'probe'), ['http:', 'https:']), 'FENIX_RENDER_PLAYER_URL_TEMPLATE deve ser http:// ou https://');
}

if (requireInfra) {
  const signallingRoot = infraRoot ? path.join(infraRoot, 'SignallingWebServer') : '';
  check('pixel-streaming-infra', Boolean(infraRoot && existsSync(signallingRoot)), infraRoot || 'FENIX_PIXEL_STREAMING_INFRA_ROOT ausente');
}

console.log(JSON.stringify({ ok: failures.length === 0, requireRuntime, requireInfra, checks }, null, 2));
if (failures.length) {
  console.error(`Fenix3D GPU preflight falhou:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
