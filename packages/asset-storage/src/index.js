import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';

const ALLOWED_IMAGE_TYPES = Object.freeze(new Set([
  'image/png',
  'image/jpeg',
  'image/webp'
]));

function assetError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function safeSegment(value, label) {
  const normalized = String(value ?? '').trim();
  if (!normalized || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw assetError(`${label} inválido.`, 'ASSET_PATH_INVALID');
  }
  return normalized;
}

function decodeBase64(value) {
  const source = String(value ?? '').trim();
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source)) {
    throw assetError('Conteúdo Base64 do asset é inválido.', 'ASSET_DATA_INVALID');
  }
  try {
    return Buffer.from(source, 'base64');
  } catch {
    throw assetError('Conteúdo Base64 do asset é inválido.', 'ASSET_DATA_INVALID');
  }
}

function normalizeImageType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(type)) {
    throw assetError('Formato de mapa não suportado. Use PNG, JPG ou WEBP.', 'ASSET_TYPE_UNSUPPORTED', 415);
  }
  return type;
}

export class LocalAssetStorage {
  constructor({ rootDir = './data/fenix-assets', maxBytes = 15 * 1024 * 1024 } = {}) {
    this.rootDir = resolve(rootDir);
    this.maxBytes = Math.max(1024, Number(maxBytes) || 15 * 1024 * 1024);
    this.driver = 'local-filesystem';
  }

  async initialize() {
    await mkdir(this.rootDir, { recursive: true });
    return this;
  }

  async saveImage({ campaignId, assetId = randomUUID(), fileName, mimeType, dataBase64 } = {}) {
    return this.saveImageBuffer({
      campaignId,
      assetId,
      fileName,
      mimeType,
      buffer: decodeBase64(dataBase64)
    });
  }

  async saveImageBuffer({ campaignId, assetId = randomUUID(), fileName, mimeType, buffer } = {}) {
    const campaign = safeSegment(campaignId, 'campaignId');
    const asset = safeSegment(assetId, 'assetId');
    const type = normalizeImageType(mimeType);
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer ?? []);
    if (!bytes.length) throw assetError('O arquivo do mapa está vazio.', 'ASSET_EMPTY');
    if (bytes.length > this.maxBytes) {
      throw assetError(`O mapa excede o limite de ${Math.floor(this.maxBytes / 1024 / 1024)} MB.`, 'ASSET_TOO_LARGE', 413);
    }
    const campaignDir = join(this.rootDir, campaign);
    await mkdir(campaignDir, { recursive: true });
    const filePath = join(campaignDir, `${asset}.bin`);
    await writeFile(filePath, bytes, { flag: 'wx' });
    return Object.freeze({
      id: asset,
      fileName: String(fileName ?? 'mapa').trim().slice(0, 180) || 'mapa',
      mimeType: type,
      size: bytes.length
    });
  }

  async read({ campaignId, assetId } = {}) {
    const campaign = safeSegment(campaignId, 'campaignId');
    const asset = safeSegment(assetId, 'assetId');
    try {
      return await readFile(join(this.rootDir, campaign, `${asset}.bin`));
    } catch (error) {
      if (error?.code === 'ENOENT') throw assetError('Asset não encontrado.', 'ASSET_NOT_FOUND', 404);
      throw error;
    }
  }

  async delete({ campaignId, assetId } = {}) {
    const campaign = safeSegment(campaignId, 'campaignId');
    const asset = safeSegment(assetId, 'assetId');
    await rm(join(this.rootDir, campaign, `${asset}.bin`), { force: true });
  }
}

export function createAssetStorageFromEnv(env = process.env) {
  return new LocalAssetStorage({
    rootDir: env.FENIX_ASSET_DIR?.trim() || './data/fenix-assets',
    maxBytes: Number(env.FENIX_ASSET_MAX_BYTES) || 15 * 1024 * 1024
  });
}
