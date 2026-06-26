import crypto from 'crypto';
import { getToken, getUserById, deleteToken } from './db.js';

// ───────────── password (scrypt) ─────────────
const ADMIN_ACCESS_KEY = String(process.env.ADMIN_ACCESS_KEY || '').trim();

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

export function withResolvedAdminRole(user, adminKey) {
  if (!user) return null;
  if (hasValidAdminKey(adminKey)) return { ...user, role: 'admin' };
  return user;
}

// ───────────── middleware ─────────────
export async function authMiddleware(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const adminKey = req.headers['x-admin-key'] || '';
  req.user = null;
  req.token = token;
  req.adminKeyAccepted = hasValidAdminKey(adminKey);
  if (token) {
    const t = await getToken(token);
    if (t && t.expires_at > Date.now()) {
      const user = await getUserById(t.user_id) || null;
      req.user = withResolvedAdminRole(user, adminKey);
    } else if (t) {
      await deleteToken(token); // หมดอายุ
    }
  }
  next();
}
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
  next();
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at };
}
