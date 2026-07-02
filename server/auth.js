import crypto from 'crypto';
import { getToken, getUserById, deleteToken } from './db.js';

// ───────────── password (scrypt) ─────────────
const ADMIN_ACCESS_KEY = String(process.env.ADMIN_ACCESS_KEY || '').trim();
const SESSION_COOKIE = '__Host-nfl_session';
const ADMIN_GRANT_COOKIE = '__Host-nfl_admin';
const DEV_SESSION_COOKIE = 'nfl_session';
const DEV_ADMIN_GRANT_COOKIE = 'nfl_admin';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const ADMIN_GRANT_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_GRANT_SECRET = String(process.env.SESSION_SIGNING_SECRET || ADMIN_ACCESS_KEY).trim();
const DEBUG_SERVER_URL = String(process.env.DEBUG_SERVER_URL || '').trim();
const DEBUG_SESSION_ID = String(process.env.DEBUG_SESSION_ID || 'admin-login-lockdown').trim();
export const ROLE_USER = 'user';
export const ROLE_ADMIN = 'admin';
export const ROLE_CHAT_ADMIN = 'chat_admin';

function reportAuthDebug(hypothesisId, location, msg, data = {}, runId = 'pre-fix') {
  if (!DEBUG_SERVER_URL) return;
  fetch(DEBUG_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: DEBUG_SESSION_ID,
      runId,
      hypothesisId,
      location,
      msg,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const value = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = value + '==='.slice((value.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signValue(value) {
  return toBase64Url(crypto.createHmac('sha256', ADMIN_GRANT_SECRET).update(String(value || '')).digest());
}

function sameText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function parseCookies(header = '') {
  const out = {};
  const raw = String(header || '');
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); }
    catch { out[key] = value; }
  }
  return out;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(String(value || ''))}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join('; ');
}

function cookieBaseOptions(req) {
  return {
    path: '/',
    httpOnly: true,
    secure: Boolean(req?.secure || process.env.VERCEL || String(process.env.NODE_ENV || '').trim() === 'production'),
    sameSite: 'Lax',
  };
}

function resolvedCookieNames(req) {
  const base = cookieBaseOptions(req);
  return {
    session: base.secure ? SESSION_COOKIE : DEV_SESSION_COOKIE,
    adminGrant: base.secure ? ADMIN_GRANT_COOKIE : DEV_ADMIN_GRANT_COOKIE,
    legacySession: SESSION_COOKIE,
    legacyAdminGrant: ADMIN_GRANT_COOKIE,
  };
}

export function createAdminGrant(userId, ttlMs = ADMIN_GRANT_TTL_MS) {
  if (!ADMIN_GRANT_SECRET || !userId) return '';
  const payload = toBase64Url(JSON.stringify({
    uid: String(userId),
    exp: Date.now() + Math.max(60_000, parseInt(ttlMs, 10) || ADMIN_GRANT_TTL_MS),
  }));
  return `${payload}.${signValue(payload)}`;
}

export function verifyAdminGrant(grant, userId = '') {
  if (!ADMIN_GRANT_SECRET || !grant) return false;
  const [payload, signature] = String(grant || '').split('.');
  if (!payload || !signature) return false;
  const expected = signValue(payload);
  if (!sameText(signature, expected)) return false;
  try {
    const data = JSON.parse(fromBase64Url(payload));
    if (!data?.uid || Number(data?.exp || 0) <= Date.now()) return false;
    if (userId && String(data.uid) !== String(userId)) return false;
    return true;
  } catch {
    return false;
  }
}

export function writeSessionCookies(req, res, { token = '', adminGrant = '' } = {}) {
  const base = cookieBaseOptions(req);
  const names = resolvedCookieNames(req);
  res.setHeader('Set-Cookie', [
    serializeCookie(names.session, token, { ...base, maxAge: token ? Math.floor(SESSION_TTL_MS / 1000) : 0 }),
    serializeCookie(names.adminGrant, adminGrant, { ...base, maxAge: adminGrant ? Math.floor(ADMIN_GRANT_TTL_MS / 1000) : 0 }),
    ...(names.session !== names.legacySession
      ? [serializeCookie(names.legacySession, '', { ...base, secure: true, maxAge: 0 })]
      : []),
    ...(names.adminGrant !== names.legacyAdminGrant
      ? [serializeCookie(names.legacyAdminGrant, '', { ...base, secure: true, maxAge: 0 })]
      : []),
  ]);
}

export function clearSessionCookies(req, res) {
  writeSessionCookies(req, res, { token: '', adminGrant: '' });
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
export function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function newToken() { return crypto.randomBytes(32).toString('hex'); }

export function hasValidAdminKey(adminKey) {
  if (!ADMIN_ACCESS_KEY) return false;
  const provided = Buffer.from(String(adminKey || '').trim(), 'utf8');
  const expected = Buffer.from(ADMIN_ACCESS_KEY, 'utf8');
  if (!provided.length || provided.length !== expected.length) return false;
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}
export function isAdminRole(role = '') {
  return String(role || '').trim() === ROLE_ADMIN;
}
export function isChatAdminRole(role = '') {
  return String(role || '').trim() === ROLE_CHAT_ADMIN;
}
export function canAccessAdminShell(user) {
  const role = String(user?.role || '').trim();
  return role === ROLE_ADMIN || role === ROLE_CHAT_ADMIN;
}
export function canAccessAdminInbox(user) {
  return canAccessAdminShell(user);
}

export function withResolvedAdminRole(user, adminKey) {
  if (!user) return null;
  if (isAdminRole(user.role) && hasValidAdminKey(adminKey)) return { ...user, role: ROLE_ADMIN };
  return user;
}

export async function resolveAuthenticatedUser({ token = '', adminKey = '', adminGrant = '' } = {}) {
  const rawToken = String(token || '').trim();
  if (!rawToken) return { user: null, token: '', adminGranted: false };
  const record = await getToken(rawToken);
  if (!record) return { user: null, token: rawToken, adminGranted: false };
  if (Number(record.expires_at || 0) <= Date.now()) {
    await deleteToken(rawToken);
    return { user: null, token: rawToken, adminGranted: false };
  }
  const user = await getUserById(record.user_id) || null;
  const adminGranted = Boolean(user && isAdminRole(user.role) && (verifyAdminGrant(adminGrant, user.id) || hasValidAdminKey(adminKey)));
  // #region debug-point A:resolve-authenticated-user
  reportAuthDebug('A', 'server/auth.js:resolveAuthenticatedUser', '[DEBUG] resolveAuthenticatedUser computed role', {
    tokenPresent: Boolean(rawToken),
    tokenRecordFound: Boolean(record),
    userFound: Boolean(user),
    userId: user?.id || '',
    storedRole: user?.role || '',
    adminGrantPresent: Boolean(String(adminGrant || '').trim()),
    adminKeyPresent: Boolean(String(adminKey || '').trim()),
    adminGranted,
    returnedRole: user ? (adminGranted ? ROLE_ADMIN : user.role || '') : '',
  });
  // #endregion
  return {
    user: user ? (adminGranted ? { ...user, role: ROLE_ADMIN } : user) : null,
    token: rawToken,
    adminGranted,
  };
}

// ───────────── middleware ─────────────
export async function authMiddleware(req, _res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const h = req.headers.authorization || '';
  const names = resolvedCookieNames(req);
  const token = h.startsWith('Bearer ')
    ? h.slice(7)
    : (cookies[names.session] || cookies[names.legacySession] || '');
  const adminKey = req.headers['x-admin-key'] || '';
  const adminGrant = cookies[names.adminGrant] || cookies[names.legacyAdminGrant] || '';
  req.user = null;
  req.token = String(token || '').trim();
  req.cookies = cookies;
  const resolved = await resolveAuthenticatedUser({ token: req.token, adminKey, adminGrant });
  req.user = resolved.user;
  req.adminKeyAccepted = resolved.adminGranted;
  if (req.path === '/api/auth/login' || req.path === '/api/auth/me' || req.path.startsWith('/secure-admin') || req.path.startsWith('/api/admin')) {
    // #region debug-point B:auth-middleware-request
    reportAuthDebug('B', 'server/auth.js:authMiddleware', '[DEBUG] authMiddleware resolved request user', {
      path: req.path,
      method: req.method,
      sessionCookiePresent: Boolean(cookies[names.session] || cookies[names.legacySession]),
      adminGrantPresent: Boolean(adminGrant),
      adminKeyPresent: Boolean(String(adminKey || '').trim()),
      resolvedUserId: req.user?.id || '',
      resolvedRole: req.user?.role || '',
      adminKeyAccepted: Boolean(req.adminKeyAccepted),
    });
    // #endregion
  }
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}
export function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user?.role)) {
    return res.status(404).json({ error: 'ไม่พบรายการที่ร้องขอ' });
  }
  next();
}
export function requireAdminShell(req, res, next) {
  if (!canAccessAdminShell(req.user)) {
    return res.status(404).json({ error: 'ไม่พบรายการที่ร้องขอ' });
  }
  next();
}
export function requireAdminInbox(req, res, next) {
  if (!canAccessAdminInbox(req.user)) {
    return res.status(404).json({ error: 'ไม่พบรายการที่ร้องขอ' });
  }
  next();
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at };
}
