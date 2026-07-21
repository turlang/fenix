import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseBoolean(value, fallback) {
  if (value == null || value === '') return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new TypeError(`Valor booleano inválido: ${value}`);
}

function parseInteger(value, fallback, { min, max, name }) {
  const parsed = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return parsed;
}

export function loadEnvFile(filePath = resolve(process.cwd(), process.env.MESTRE_ORC_ENV_FILE || '.env')) {
  if (!existsSync(filePath)) return false;
  const source = readFileSync(filePath, 'utf8');
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key] !== undefined) continue;
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

export function createConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const configuredOrigins = (env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  // Foundry local usa 30000 por padrão. Mantenha essas origens mesmo quando um .env antigo
  // já possui CORS_ALLOWED_ORIGINS sem a porta do Foundry.
  const allowedOrigins = [...new Set([
    'http://localhost:30000',
    'http://127.0.0.1:30000',
    ...configuredOrigins
  ])];
  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    host: env.HOST?.trim() || '0.0.0.0',
    port: parseInteger(env.PORT, 3001, { min: 1, max: 65535, name: 'PORT' }),
    bodyLimit: parseInteger(env.BODY_LIMIT_BYTES, 2 * 1024 * 1024, {
      min: 1024,
      max: 10 * 1024 * 1024,
      name: 'BODY_LIMIT_BYTES'
    }),
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    allowedOrigins
  });
}

export function isOriginAllowed(origin, allowedOrigins = []) {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' || url.port !== '30000') return false;
    const host = url.hostname;
    return host === 'localhost' || host === '127.0.0.1' ||
      /^10\./.test(host) || /^192\.168\./.test(host) ||
      /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}
