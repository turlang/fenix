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

function decodeStream(dict, raw) {
  if (!raw) return null;
  if (/\/Filter\s*\/FlateDecode\b/.test(dict)) {
    try { return zlib.inflateSync(raw); } catch { return null; }
  }
  if (/\/Filter\b/.test(dict)) return null;
  return raw;
}

function filters(dict) {
  const result = [];
  const direct = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict)?.[1];
  if (direct) result.push(direct);
  const array = /\/Filter\s*\[([^\]]+)\]/s.exec(dict)?.[1];
  if (array) for (const match of array.matchAll(/\/([A-Za-z0-9]+)/g)) result.push(match[1]);
  return [...new Set(result)];
}

function imageConfidence({ width, height, pageArea = null, minimumPixels }) {
  const pixels = width * height;
  if (pixels < minimumPixels) return 0;
  const aspect = Math.max(width, height) / Math.max(1, Math.min(width, height));
  let score = pixels >= 1_000_000 ? 0.7 : pixels >= 400_000 ? 0.58 : 0.45;
  if (aspect <= 2.2) score += 0.12;
  if (pageArea && pixels >= pageArea * 0.25) score += 0.12;
  return Math.min(0.95, score);
}

export function discoverPdfImageAssets(input, { documentId = null, minimumPixels = 80_000 } = {}) {
  const buffer = asBuffer(input);
  const binary = buffer.toString('latin1');
  const id = documentId || stableId('pdf-images', buffer.subarray(0, Math.min(buffer.length, 1024 * 1024)));
  const images = [];
  const objectPattern = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;
  while ((match = objectPattern.exec(binary))) {
    const end = binary.indexOf('endobj', objectPattern.lastIndex);
    if (end < 0) break;
    const body = binary.slice(objectPattern.lastIndex, end);
    if (!/\/Subtype\s*\/Image\b/.test(body)) {
      objectPattern.lastIndex = end + 6;
      continue;
    }
    const width = Number(/\/Width\s+(\d+)/.exec(body)?.[1]) || 0;
    const height = Number(/\/Height\s+(\d+)/.exec(body)?.[1]) || 0;
    const bitsPerComponent = Number(/\/BitsPerComponent\s+(\d+)/.exec(body)?.[1]) || null;
    const colorSpace = /\/ColorSpace\s*\/([A-Za-z0-9]+)/.exec(body)?.[1] || null;
    const streamMarker = /stream(?:\r\n|\n|\r)/.exec(body);
    let rawBytes = 0;
    let decodedBytes = 0;
    if (streamMarker) {
      const start = streamMarker.index + streamMarker[0].length;
      const streamEnd = body.indexOf('endstream', start);
      if (streamEnd >= 0) {
        let raw = body.slice(start, streamEnd);
        if (raw.endsWith('\r\n')) raw = raw.slice(0, -2);
        else if (raw.endsWith('\n') || raw.endsWith('\r')) raw = raw.slice(0, -1);
        const rawBuffer = Buffer.from(raw, 'latin1');
        rawBytes = rawBuffer.length;
        decodedBytes = decodeStream(body.slice(0, streamMarker.index), rawBuffer)?.length ?? 0;
      }
    }
    const confidence = imageConfidence({ width, height, minimumPixels });
    images.push(Object.freeze({
      id: stableId('pdf-image', id, match[1]),
      objectId: Number(match[1]),
      width,
      height,
      pixels: width * height,
      bitsPerComponent,
      colorSpace,
      filters: Object.freeze(filters(body)),
      rawBytes,
      decodedBytes,
      mapCandidate: confidence >= 0.55,
      mapConfidence: confidence,
      status: confidence >= 0.55 ? 'review' : 'reference',
      source: Object.freeze({ type: 'pdf-image-object', documentId: id, objectId: Number(match[1]) })
    }));
    objectPattern.lastIndex = end + 6;
  }
  const candidates = images.filter((image) => image.mapCandidate);
  return Object.freeze({
    schema: 'fenix.pdf-image-discovery',
    version: 1,
    documentId: id,
    imageCount: images.length,
    mapCandidateCount: candidates.length,
    images: Object.freeze(images),
    policy: Object.freeze({ authoritativeSceneMutation: false, gmReviewRequired: true, minimumPixels })
  });
}
