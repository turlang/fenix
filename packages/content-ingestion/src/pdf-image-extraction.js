import crypto from 'node:crypto';
import zlib from 'node:zlib';

function stableId(...parts) {
  return crypto.createHash('sha256').update(parts.map((part) => String(part ?? '')).join('\u241f')).digest('hex').slice(0, 24);
}

function asBuffer(input) {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new TypeError('PDF deve ser Buffer, Uint8Array ou ArrayBuffer.');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng({ width, height, channels, pixels }) {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : null;
  if (colorType === null) return null;
  const stride = width * channels;
  if (pixels.length < stride * height) return null;
  const rows = [];
  for (let y = 0; y < height; y += 1) rows.push(Buffer.concat([Buffer.from([0]), pixels.subarray(y * stride, (y + 1) * stride)]));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function streamBytes(body) {
  const marker = /stream(?:\r\n|\n|\r)/.exec(body);
  if (!marker) return null;
  const start = marker.index + marker[0].length;
  const end = body.indexOf('endstream', start);
  if (end < 0) return null;
  let raw = body.slice(start, end);
  if (raw.endsWith('\r\n')) raw = raw.slice(0, -2);
  else if (raw.endsWith('\n') || raw.endsWith('\r')) raw = raw.slice(0, -1);
  return Buffer.from(raw, 'latin1');
}

function filterNames(dict) {
  const names = [];
  const direct = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict)?.[1];
  if (direct) names.push(direct);
  const array = /\/Filter\s*\[([^\]]+)\]/s.exec(dict)?.[1];
  if (array) for (const match of array.matchAll(/\/([A-Za-z0-9]+)/g)) names.push(match[1]);
  return [...new Set(names)];
}

function decodeFlateImage(dict, raw, width, height, colorSpace, bitsPerComponent) {
  if (bitsPerComponent !== 8) return null;
  const predictor = Number(/\/Predictor\s+(\d+)/.exec(dict)?.[1]) || 1;
  if (predictor !== 1) return null;
  const channels = colorSpace === 'DeviceGray' ? 1 : colorSpace === 'DeviceRGB' ? 3 : null;
  if (!channels) return null;
  let pixels;
  try { pixels = zlib.inflateSync(raw); } catch { return null; }
  return encodePng({ width, height, channels, pixels });
}

export function extractPdfImageAssets(input, { documentId = null, minimumPixels = 80_000, maxAssets = 32 } = {}) {
  const buffer = asBuffer(input);
  const binary = buffer.toString('latin1');
  const id = documentId || stableId('pdf-image-extract', buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)));
  const assets = [];
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while (assets.length < Math.max(1, Number(maxAssets) || 32) && (match = objectPattern.exec(binary))) {
    const end = binary.indexOf('endobj', objectPattern.lastIndex);
    if (end < 0) break;
    const body = binary.slice(objectPattern.lastIndex, end);
    objectPattern.lastIndex = end + 6;
    if (!/\/Subtype\s*\/Image\b/.test(body)) continue;
    const width = Number(/\/Width\s+(\d+)/.exec(body)?.[1]) || 0;
    const height = Number(/\/Height\s+(\d+)/.exec(body)?.[1]) || 0;
    if (width * height < minimumPixels) continue;
    const raw = streamBytes(body);
    if (!raw?.length) continue;
    const filters = filterNames(body);
    const bitsPerComponent = Number(/\/BitsPerComponent\s+(\d+)/.exec(body)?.[1]) || 8;
    const colorSpace = /\/ColorSpace\s*\/([A-Za-z0-9]+)/.exec(body)?.[1] || null;
    let image = null;
    let mimeType = null;
    let extension = null;
    let extraction = null;
    if (filters.length === 1 && filters[0] === 'DCTDecode') {
      image = raw;
      mimeType = 'image/jpeg';
      extension = 'jpg';
      extraction = 'jpeg-passthrough';
    } else if (filters.length === 1 && filters[0] === 'FlateDecode') {
      image = decodeFlateImage(body, raw, width, height, colorSpace, bitsPerComponent);
      if (image) {
        mimeType = 'image/png';
        extension = 'png';
        extraction = 'flate-to-png';
      }
    }
    if (!image) continue;
    const objectId = Number(match[1]);
    const assetId = stableId('pdf-image', id, objectId);
    assets.push(Object.freeze({
      id: assetId,
      objectId,
      width,
      height,
      pixels: width * height,
      mimeType,
      extension,
      extraction,
      buffer: image,
      fileName: `pdf-${id.slice(0, 8)}-obj-${objectId}.${extension}`,
      source: Object.freeze({ type: 'pdf-image-object', documentId: id, objectId })
    }));
  }
  return Object.freeze({
    schema: 'fenix.pdf-image-extraction',
    version: 1,
    documentId: id,
    extractedCount: assets.length,
    assets: Object.freeze(assets)
  });
}
