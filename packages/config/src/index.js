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

function parseSameSite(value, fallback) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  const options = { lax: 'Lax', strict: 'Strict', none: 'None' };
  if (!options[normalized]) throw new TypeError('FENIX_AUTH_COOKIE_SAME_SITE deve ser Lax, Strict ou None.');
  return options[normalized];
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
  const isProduction = nodeEnv === 'production';
  const configuredOrigins = (env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const allowedOrigins = [...new Set([
    'http://localhost:30000',
    'http://127.0.0.1:30000',
    ...configuredOrigins
  ])];
  const runtimeLeaseTtlMs = parseInteger(env.FENIX_RUNTIME_LEASE_TTL_MS, 15000, {
    min: 500,
    max: 300000,
    name: 'FENIX_RUNTIME_LEASE_TTL_MS'
  });
  const runtimeHeartbeatMs = parseInteger(env.FENIX_RUNTIME_HEARTBEAT_MS, 5000, {
    min: 250,
    max: 120000,
    name: 'FENIX_RUNTIME_HEARTBEAT_MS'
  });
  if (runtimeHeartbeatMs >= runtimeLeaseTtlMs) {
    throw new RangeError('FENIX_RUNTIME_HEARTBEAT_MS deve ser menor que FENIX_RUNTIME_LEASE_TTL_MS.');
  }
  const internalRoutingSecret = env.FENIX_INTERNAL_ROUTING_SECRET?.trim() || null;
  if (internalRoutingSecret && internalRoutingSecret.length < 32) {
    throw new RangeError('FENIX_INTERNAL_ROUTING_SECRET deve ter pelo menos 32 caracteres.');
  }
  return Object.freeze({
    nodeEnv,
    isProduction,
    host: env.HOST?.trim() || '0.0.0.0',
    port: parseInteger(env.PORT, 3001, { min: 1, max: 65535, name: 'PORT' }),
    bodyLimit: parseInteger(env.BODY_LIMIT_BYTES, 2 * 1024 * 1024, {
      min: 1024,
      max: 10 * 1024 * 1024,
      name: 'BODY_LIMIT_BYTES'
    }),
    trustProxy: parseBoolean(env.TRUST_PROXY, false),
    allowLegacySessionHttp: parseBoolean(env.FENIX_ALLOW_LEGACY_SESSION_HTTP, !isProduction),
    authCookieSameSite: parseSameSite(env.FENIX_AUTH_COOKIE_SAME_SITE, isProduction ? 'None' : 'Lax'),
    remoteMapTimeoutMs: parseInteger(env.FENIX_REMOTE_MAP_TIMEOUT_MS, 10000, {
      min: 1000,
      max: 60000,
      name: 'FENIX_REMOTE_MAP_TIMEOUT_MS'
    }),
    remoteMapMaxRedirects: parseInteger(env.FENIX_REMOTE_MAP_MAX_REDIRECTS, 3, {
      min: 0,
      max: 5,
      name: 'FENIX_REMOTE_MAP_MAX_REDIRECTS'
    }),
    instanceId: env.FENIX_INSTANCE_ID?.trim() || null,
    instancePublicUrl: env.FENIX_INSTANCE_PUBLIC_URL?.trim() || null,
    internalRoutingSecret,
    runtimeRoutingTimeoutMs: parseInteger(env.FENIX_RUNTIME_ROUTING_TIMEOUT_MS, 5000, {
      min: 500,
      max: 30000,
      name: 'FENIX_RUNTIME_ROUTING_TIMEOUT_MS'
    }),
    runtimeRoutingMaxRetries: parseInteger(env.FENIX_RUNTIME_ROUTING_MAX_RETRIES, 1, {
      min: 0,
      max: 3,
      name: 'FENIX_RUNTIME_ROUTING_MAX_RETRIES'
    }),
    commandLedgerWaitMs: parseInteger(env.FENIX_COMMAND_LEDGER_WAIT_MS, 1500, {
      min: 0,
      max: 10000,
      name: 'FENIX_COMMAND_LEDGER_WAIT_MS'
    }),
    commandLedgerUnknownAfterMs: parseInteger(env.FENIX_COMMAND_LEDGER_UNKNOWN_AFTER_MS, 60000, {
      min: 5000,
      max: 3600000,
      name: 'FENIX_COMMAND_LEDGER_UNKNOWN_AFTER_MS'
    }),
    commandLedgerRetentionHours: parseInteger(env.FENIX_COMMAND_LEDGER_RETENTION_HOURS, 168, {
      min: 1,
      max: 2160,
      name: 'FENIX_COMMAND_LEDGER_RETENTION_HOURS'
    }),
    commandLedgerResultMaxBytes: parseInteger(env.FENIX_COMMAND_LEDGER_RESULT_MAX_BYTES, 512 * 1024, {
      min: 1024,
      max: 2 * 1024 * 1024,
      name: 'FENIX_COMMAND_LEDGER_RESULT_MAX_BYTES'
    }),
    runtimeLeaseTtlMs,
    runtimeHeartbeatMs,
    runtimeReconcileMs: parseInteger(env.FENIX_RUNTIME_RECONCILE_MS, 5000, {
      min: 500,
      max: 120000,
      name: 'FENIX_RUNTIME_RECONCILE_MS'
    }),
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
