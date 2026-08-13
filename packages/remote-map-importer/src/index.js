import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { basename } from 'node:path';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function remoteError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeMime(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function normalizedHostname(value) {
  return String(value ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function privateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224;
}

function privateIpv6(address) {
  const value = normalizedHostname(address).split('%')[0];
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  if (value.startsWith('2001:db8:')) return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    return isIP(mapped) === 4 ? privateIpv4(mapped) : true;
  }
  return false;
}

export function isPublicAddress(address) {
  const value = normalizedHostname(address);
  const family = isIP(value);
  if (family === 4) return !privateIpv4(value);
  if (family === 6) return !privateIpv6(value);
  return false;
}

export function parseRemoteMapUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    throw remoteError('Informe uma URL HTTP/HTTPS válida para o mapa.', 'REMOTE_MAP_URL_INVALID');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw remoteError('Somente URLs HTTP/HTTPS são aceitas.', 'REMOTE_MAP_PROTOCOL_UNSUPPORTED');
  }
  if (url.username || url.password) {
    throw remoteError('URLs com credenciais embutidas não são aceitas.', 'REMOTE_MAP_URL_CREDENTIALS_FORBIDDEN');
  }
  const host = normalizedHostname(url.hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) {
    throw remoteError('O endereço do mapa aponta para uma rede local ou reservada.', 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN', 403);
  }
  return url;
}

export async function resolvePublicRemoteHost(url, lookupImpl = dnsLookup) {
  const host = normalizedHostname(url.hostname);
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw remoteError('O endereço do mapa aponta para uma rede privada ou reservada.', 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN', 403);
    return { address: host, family: isIP(host) };
  }
  let addresses;
  try {
    addresses = await lookupImpl(host, { all: true, verbatim: true });
  } catch {
    throw remoteError('Não foi possível resolver o host do mapa.', 'REMOTE_MAP_DNS_FAILED', 502);
  }
  if (!Array.isArray(addresses) || !addresses.length) {
    throw remoteError('O host do mapa não possui endereço utilizável.', 'REMOTE_MAP_DNS_FAILED', 502);
  }
  if (addresses.some((entry) => !isPublicAddress(entry.address))) {
    throw remoteError('O host do mapa resolve para uma rede privada ou reservada.', 'REMOTE_MAP_PRIVATE_HOST_FORBIDDEN', 403);
  }
  return addresses[0];
}

function requestBinary(url, resolved, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET',
      headers: {
        Accept: 'image/png,image/jpeg,image/webp',
        'User-Agent': 'Fenix-VTT/0.1'
      },
      lookup(_hostname, options, callback) {
        if (options?.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
        else callback(null, resolved.address, resolved.family);
      }
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(remoteError(`O mapa remoto excede o limite de ${Math.floor(maxBytes / 1024 / 1024)} MB.`, 'REMOTE_MAP_TOO_LARGE', 413));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        statusCode: Number(response.statusCode) || 0,
        headers: response.headers,
        body: Buffer.concat(chunks)
      }));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(remoteError('O servidor remoto demorou demais para responder.', 'REMOTE_MAP_TIMEOUT', 504)));
    request.on('error', reject);
    request.end();
  });
}

function detectMime(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function imageDimensions(buffer, mimeType) {
  if (mimeType === 'image/png') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      while (buffer[offset] === 0xff) offset += 1;
      const marker = buffer[offset++];
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      if (sof.has(marker) && length >= 7) {
        return { width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  if (mimeType === 'image/webp') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3)
      };
    }
    if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
      const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
      return {
        width: 1 + b1 + ((b2 & 0x3f) << 8),
        height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10)
      };
    }
    if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff
      };
    }
  }
  throw remoteError('Não foi possível determinar as dimensões do mapa remoto.', 'REMOTE_MAP_DIMENSIONS_INVALID', 422);
}

function fileNameFor(url, mimeType) {
  const ext = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  let raw = basename(url.pathname || '') || `mapa-remoto${ext}`;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    raw = `mapa-remoto${ext}`;
  }
  const safe = raw.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 160);
  return safe.includes('.') ? safe : `${safe || 'mapa-remoto'}${ext}`;
}

export class RemoteMapImporter {
  constructor({
    lookupImpl = dnsLookup,
    fetchBinary = requestBinary,
    timeoutMs = 10000,
    maxBytes = 15 * 1024 * 1024,
    maxRedirects = 3
  } = {}) {
    this.lookupImpl = lookupImpl;
    this.fetchBinary = fetchBinary;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000);
    this.maxBytes = Math.max(1024, Number(maxBytes) || 15 * 1024 * 1024);
    const redirects = Number(maxRedirects);
    this.maxRedirects = Number.isFinite(redirects) ? Math.min(5, Math.max(0, Math.floor(redirects))) : 3;
  }

  async importUrl(value) {
    let url = parseRemoteMapUrl(value);
    for (let redirect = 0; redirect <= this.maxRedirects; redirect += 1) {
      const resolved = await resolvePublicRemoteHost(url, this.lookupImpl);
      let response;
      try {
        response = await this.fetchBinary(url, resolved, { timeoutMs: this.timeoutMs, maxBytes: this.maxBytes });
      } catch (error) {
        if (error?.code) throw error;
        throw remoteError('Não foi possível baixar o mapa remoto.', 'REMOTE_MAP_DOWNLOAD_FAILED', 502);
      }
      if (REDIRECT_CODES.has(response.statusCode)) {
        const location = response.headers?.location;
        if (!location) throw remoteError('Redirect remoto sem destino.', 'REMOTE_MAP_REDIRECT_INVALID', 502);
        if (redirect >= this.maxRedirects) throw remoteError('O mapa remoto excedeu o limite de redirects.', 'REMOTE_MAP_REDIRECT_LIMIT', 508);
        url = parseRemoteMapUrl(new URL(location, url).toString());
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw remoteError(`Servidor do mapa respondeu HTTP ${response.statusCode}.`, 'REMOTE_MAP_HTTP_ERROR', 502);
      }
      const declared = normalizeMime(response.headers?.['content-type']);
      if (declared && !ALLOWED_TYPES.has(declared)) {
        throw remoteError('A URL não retornou PNG, JPG ou WEBP.', 'REMOTE_MAP_TYPE_UNSUPPORTED', 415);
      }
      const body = Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.body ?? []);
      if (!body.length) throw remoteError('O mapa remoto está vazio.', 'REMOTE_MAP_EMPTY', 422);
      if (body.length > this.maxBytes) throw remoteError('O mapa remoto excede o limite configurado.', 'REMOTE_MAP_TOO_LARGE', 413);
      const detected = detectMime(body);
      if (!detected || (declared && detected !== declared)) {
        throw remoteError('O conteúdo remoto não corresponde a uma imagem PNG, JPG ou WEBP válida.', 'REMOTE_MAP_SIGNATURE_INVALID', 415);
      }
      const dimensions = imageDimensions(body, detected);
      if (!dimensions.width || !dimensions.height || dimensions.width > 20000 || dimensions.height > 20000) {
        throw remoteError('As dimensões do mapa remoto são inválidas ou excedem 20000 px.', 'REMOTE_MAP_DIMENSIONS_INVALID', 422);
      }
      return Object.freeze({
        buffer: body,
        mimeType: detected,
        fileName: fileNameFor(url, detected),
        width: dimensions.width,
        height: dimensions.height,
        sourceHost: normalizedHostname(url.hostname)
      });
    }
    throw remoteError('Falha ao importar mapa remoto.', 'REMOTE_MAP_DOWNLOAD_FAILED', 502);
  }
}
