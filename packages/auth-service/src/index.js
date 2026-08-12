import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PASSWORD_KEY_LENGTH = 64;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function authError(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw authError('E-mail inválido.', 'AUTH_INVALID_EMAIL');
  }
  return email;
}

function normalizeDisplayName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100) {
    throw authError('Nome deve ter entre 2 e 100 caracteres.', 'AUTH_INVALID_DISPLAY_NAME');
  }
  return name;
}

function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 10 || password.length > 200) {
    throw authError('Senha deve ter entre 10 e 200 caracteres.', 'AUTH_INVALID_PASSWORD');
  }
  return password;
}

function tokenHash(token) {
  return createHash('sha256').update(String(token ?? '')).digest('base64url');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64url'),
    hash: Buffer.from(derived).toString('base64url')
  };
}

async function verifyPassword(password, passwordRecord) {
  if (passwordRecord?.algorithm !== 'scrypt') return false;
  const salt = Buffer.from(passwordRecord.salt, 'base64url');
  const expected = Buffer.from(passwordRecord.hash, 'base64url');
  const derived = Buffer.from(await scrypt(password, salt, expected.length));
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

function publicUser(user) {
  if (!user) return null;
  return Object.freeze({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt
  });
}

export class AuthService {
  constructor({ repository, sessionTtlMs = DEFAULT_SESSION_TTL_MS, now = () => Date.now(), logger = console } = {}) {
    if (!repository) throw new TypeError('repository é obrigatório.');
    this.repository = repository;
    this.sessionTtlMs = Math.max(60_000, Number(sessionTtlMs) || DEFAULT_SESSION_TTL_MS);
    this.now = now;
    this.logger = logger;
    this.usersById = new Map();
    this.usersByEmail = new Map();
    this.sessionsByHash = new Map();
    this.bootstrapInProgress = false;
  }

  async initialize() {
    this.refreshFromRepository();
    const now = this.now();
    await this.repository.mutate((draft) => {
      draft.authSessions = (draft.authSessions ?? []).filter((session) => Date.parse(session.expiresAt) > now);
    });
    return this.refreshFromRepository();
  }

  refreshFromRepository() {
    const state = this.repository.snapshot();
    this.usersById.clear();
    this.usersByEmail.clear();
    this.sessionsByHash.clear();
    for (const user of state.users ?? []) {
      this.usersById.set(user.id, user);
      this.usersByEmail.set(user.email, user);
    }
    const now = this.now();
    for (const session of state.authSessions ?? []) {
      if (Date.parse(session.expiresAt) > now) this.sessionsByHash.set(session.tokenHash, session);
    }
    return { users: this.usersById.size, sessions: this.sessionsByHash.size };
  }

  hasUsers() {
    return this.usersById.size > 0;
  }

  getUserById(userId) {
    return publicUser(this.usersById.get(String(userId)));
  }

  async bootstrapOwner(input = {}) {
    if (this.hasUsers() || this.bootstrapInProgress) {
      throw authError('Bootstrap já foi concluído.', 'AUTH_BOOTSTRAP_CLOSED', 409);
    }
    this.bootstrapInProgress = true;
    try {
      if (this.hasUsers()) throw authError('Bootstrap já foi concluído.', 'AUTH_BOOTSTRAP_CLOSED', 409);
      return await this.createUser(input);
    } finally {
      this.bootstrapInProgress = false;
    }
  }

  async createUser({ email, displayName, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedName = normalizeDisplayName(displayName);
    const normalizedPassword = validatePassword(password);
    if (this.usersByEmail.has(normalizedEmail)) {
      throw authError('Já existe uma conta com este e-mail.', 'AUTH_EMAIL_EXISTS', 409);
    }
    const user = {
      id: randomUUID(),
      email: normalizedEmail,
      displayName: normalizedName,
      password: await hashPassword(normalizedPassword),
      createdAt: new Date(this.now()).toISOString(),
      updatedAt: new Date(this.now()).toISOString()
    };
    await this.repository.mutate((draft) => {
      if ((draft.users ?? []).some((item) => item.email === normalizedEmail)) {
        throw authError('Já existe uma conta com este e-mail.', 'AUTH_EMAIL_EXISTS', 409);
      }
      draft.users.push(user);
    });
    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email, user);
    return publicUser(user);
  }

  async deleteUser(userId) {
    const id = String(userId ?? '');
    const user = this.usersById.get(id);
    if (!user) return false;
    this.usersById.delete(id);
    this.usersByEmail.delete(user.email);
    for (const [hash, session] of this.sessionsByHash.entries()) {
      if (session.userId === id) this.sessionsByHash.delete(hash);
    }
    await this.repository.mutate((draft) => {
      draft.users = draft.users.filter((item) => item.id !== id);
      draft.authSessions = draft.authSessions.filter((session) => session.userId !== id);
    });
    return true;
  }

  async login({ email, password } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedPassword = String(password ?? '');
    const user = this.usersByEmail.get(normalizedEmail);
    const valid = user ? await verifyPassword(normalizedPassword, user.password) : false;
    if (!valid) throw authError('Credenciais inválidas.', 'AUTH_INVALID_CREDENTIALS', 401);
    return this.createSession(user.id);
  }

  async createSession(userId) {
    const user = this.usersById.get(String(userId));
    if (!user) throw authError('Usuário não encontrado.', 'AUTH_USER_NOT_FOUND', 404);
    const rawToken = randomBytes(32).toString('base64url');
    const now = this.now();
    const session = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: tokenHash(rawToken),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.sessionTtlMs).toISOString()
    };
    await this.repository.mutate((draft) => {
      draft.authSessions.push(session);
    });
    this.sessionsByHash.set(session.tokenHash, session);
    return {
      token: rawToken,
      expiresAt: session.expiresAt,
      user: publicUser(user)
    };
  }

  authenticateToken(rawToken) {
    if (!rawToken) return null;
    const hash = tokenHash(rawToken);
    const session = this.sessionsByHash.get(hash);
    if (!session) return null;
    if (Date.parse(session.expiresAt) <= this.now()) {
      this.sessionsByHash.delete(hash);
      return null;
    }
    const user = this.usersById.get(session.userId);
    if (!user) return null;
    return Object.freeze({ sessionId: session.id, user: publicUser(user) });
  }

  requireToken(rawToken) {
    const authenticated = this.authenticateToken(rawToken);
    if (!authenticated) throw authError('Sessão de autenticação inválida ou expirada.', 'AUTH_REQUIRED', 401);
    return authenticated;
  }

  async logout(rawToken) {
    if (!rawToken) return false;
    const hash = tokenHash(rawToken);
    const existed = this.sessionsByHash.delete(hash);
    await this.repository.mutate((draft) => {
      draft.authSessions = draft.authSessions.filter((session) => session.tokenHash !== hash);
    });
    return existed;
  }
}

export function createAuthError(message, code, statusCode) {
  return authError(message, code, statusCode);
}