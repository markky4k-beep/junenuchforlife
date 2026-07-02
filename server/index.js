import './env.js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import * as line from '@line/bot-sdk';
import QRCode from 'qrcode';
import Stripe from 'stripe';
import nodemailer from 'nodemailer';
import {
  createOrder, getOrder, listOrders, listOrdersByUser, updateOrder, saveMessage, listMessagesSince, listChatSessions, listChatMessages, deleteChatSession, findLatestOrderBySessionId,
  listExpiredOrderReservations,
  createUser, getUserByEmail, getUserById, listUsers, createToken, getToken, deleteToken,
  updateUser, deleteUser, countAdmins,
  listAdminOrderSummaries, listAdminLeads, listAdminUsers, getAdminDashboardStats,
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  listProductsByIds, countProducts, countUsers, countLeads, countOrders, listLeadIdentityRows, listUserIdentityRows, listOrderIdentityRows, listDeliveredOrderTimingRows,
  getSetting, setSetting, allSettings,
  listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, incCouponUse,
  addReview, listReviews, reviewStats, allReviewStats, getAdminOrderAnalytics, userReviewed,
  adjustStock, reserveOrderResources, releaseOrderResources, getPaymentLog, upsertPaymentLog,
  createLead, getLead, listLeads, updateLead,
  createArticle, getArticle, listArticles, updateArticle, deleteArticle,
  listAllChatSessionMeta, getChatSessionMeta, upsertChatSessionMeta, deleteChatSessionMeta,
  claimLineWebhookEvent, cleanupLineWebhookEvents, insertLineWebhookAudit, listLineWebhookAudits, cleanupLineWebhookAudits,
  activeProvider,
} from './db.js';
import {
  hashPassword,
  verifyPassword,
  newToken,
  authMiddleware,
  requireAuth,
  requireAdmin,
  requireAdminShell,
  requireAdminInbox,
  publicUser,
  hasValidAdminKey,
  parseCookies,
  resolveAuthenticatedUser,
  writeSessionCookies,
  clearSessionCookies,
  createAdminGrant,
  withResolvedAdminRole,
  canAccessAdminShell,
  canAccessAdminInbox,
  isAdminRole,
  ROLE_ADMIN,
  ROLE_CHAT_ADMIN,
  ROLE_USER,
} from './auth.js';
import { promptPayPayload } from './promptpay.js';
import { isSupabaseConfigured, supabaseEnv, uploadPublicAsset } from './supabase-client.js';
import { verifyBridgeRequest } from './lineoa-bridge.js';
import { createOrderService } from './order-service.js';
import { DEFAULT_ARTICLES } from './default-articles.js';
import { createLineRuntime } from './lineoa-runtime.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const privateBuildDir = path.join(__dirname, '..', 'private-build');
const uploadsDir = path.join(publicDir, 'uploads');
const adminHtmlFile = path.join(privateBuildDir, 'admin.html');
const adminClientFile = path.join(privateBuildDir, 'admin-app.js');
const reviewGalleryFile = path.join(publicDir, 'review-gallery.json');
const isServerless = Boolean(process.env.VERCEL);
const DEBUG_SERVER_URL = String(process.env.DEBUG_SERVER_URL || '').trim();
const DEBUG_SESSION_ID = String(process.env.DEBUG_SESSION_ID || 'admin-login-lockdown').trim();
if (!isServerless) fs.mkdirSync(uploadsDir, { recursive: true });

const { PORT = 3000 } = process.env;
console.log(`[bootstrap] db provider active=${activeProvider} requested=${process.env.DB_PROVIDER || 'sqlite'} force=${process.env.FORCE_SUPABASE || 'false'}`);

function reportServerDebug(hypothesisId, location, msg, data = {}, runId = 'pre-fix') {
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

const RUNTIME_DIAGNOSTICS_KEY = 'SITE_RUNTIME_DIAGNOSTICS';
const RUNTIME_EVENT_LIMIT = 80;
const RUNTIME_ALERT_LIMIT = 40;
const LINE_WEBHOOK_AUDIT_LIMIT = 120;
const LINE_WEBHOOK_PROCESSED_LIMIT = 300;
const LINE_WEBHOOK_PROCESSED_TTL_MS = 1000 * 60 * 60 * 36;
const ALERT_COOLDOWN_MS = 1000 * 60 * 15;

function makeRuntimeEntryId(prefix = 'evt') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function trimObjectStringValues(input = {}, maxLength = 300) {
  const out = {};
  for (const [key, value] of Object.entries(safeObject(input))) {
    if (value === undefined) continue;
    if (value === null) { out[key] = null; continue; }
    if (typeof value === 'number' || typeof value === 'boolean') { out[key] = value; continue; }
    out[key] = String(value).trim().slice(0, maxLength);
  }
  return out;
}

function compactProcessedEventMap(input = {}, now = Date.now()) {
  const rows = Object.entries(safeObject(input))
    .map(([key, ts]) => [String(key || '').trim(), Number(ts || 0)])
    .filter(([key, ts]) => key && ts && (now - ts) <= LINE_WEBHOOK_PROCESSED_TTL_MS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LINE_WEBHOOK_PROCESSED_LIMIT);
  return Object.fromEntries(rows);
}

function compactAlertCooldowns(input = {}, now = Date.now()) {
  return Object.fromEntries(
    Object.entries(safeObject(input))
      .map(([key, ts]) => [String(key || '').trim(), Number(ts || 0)])
      .filter(([key, ts]) => key && ts && (now - ts) <= ALERT_COOLDOWN_MS * 2)
  );
}

function normalizeRuntimeDiagnostics(raw = {}) {
  const state = safeObject(raw);
  const webhook = safeObject(state.webhook);
  const counters = safeObject(webhook.counters);
  const startup = safeObject(state.startup);
  return {
    version: 1,
    startup: {
      checkedAt: Number(startup.checkedAt || 0),
      ok: startup.ok === true,
      reason: String(startup.reason || 'never_checked').trim() || 'never_checked',
      errorCount: Math.max(0, Number(startup.errorCount || 0)),
      warningCount: Math.max(0, Number(startup.warningCount || 0)),
      items: Array.isArray(startup.items) ? startup.items.slice(0, 40).map((item) => ({
        key: String(item?.key || '').trim(),
        label: String(item?.label || '').trim(),
        status: String(item?.status || 'info').trim(),
        source: String(item?.source || '').trim(),
        note: String(item?.note || '').trim(),
        value: String(item?.value || '').trim(),
      })) : [],
    },
    events: Array.isArray(state.events) ? state.events.slice(0, RUNTIME_EVENT_LIMIT) : [],
    alerts: Array.isArray(state.alerts) ? state.alerts.slice(0, RUNTIME_ALERT_LIMIT) : [],
    alertCooldowns: compactAlertCooldowns(state.alertCooldowns),
    webhook: {
      processed: compactProcessedEventMap(webhook.processed),
      audits: Array.isArray(webhook.audits) ? webhook.audits.slice(0, LINE_WEBHOOK_AUDIT_LIMIT) : [],
      counters: {
        received: Math.max(0, Number(counters.received || 0)),
        duplicate: Math.max(0, Number(counters.duplicate || 0)),
        success: Math.max(0, Number(counters.success || 0)),
        failed: Math.max(0, Number(counters.failed || 0)),
        signatureRejected: Math.max(0, Number(counters.signatureRejected || 0)),
        parseFailed: Math.max(0, Number(counters.parseFailed || 0)),
        ignored: Math.max(0, Number(counters.ignored || 0)),
      },
    },
  };
}

function runtimeDiagnosticsState() {
  return normalizeRuntimeDiagnostics(safeParseJson(settingsCache[RUNTIME_DIAGNOSTICS_KEY] || '', {}));
}

async function writeRuntimeDiagnostics(state = {}) {
  const normalized = normalizeRuntimeDiagnostics(state);
  const serialized = JSON.stringify(normalized);
  await setSetting(RUNTIME_DIAGNOSTICS_KEY, serialized);
  settingsCache[RUNTIME_DIAGNOSTICS_KEY] = serialized;
  settingsCacheAt = Date.now();
  return normalized;
}

async function updateRuntimeDiagnostics(mutator) {
  const draft = normalizeRuntimeDiagnostics(runtimeDiagnosticsState());
  const mutated = await mutator(draft);
  return writeRuntimeDiagnostics(mutated && typeof mutated === 'object' ? mutated : draft);
}

// config: cache ค่า settings จาก DB ไว้ใน memory เพื่อให้ helper ใช้งานแบบ sync ได้
let settingsCache = {};
let settingsCacheAt = 0;
let settingsRefreshPromise = null;
const SETTINGS_CACHE_TTL_MS = Math.max(1000, parseInt(process.env.SETTINGS_CACHE_TTL_MS, 10) || (isServerless ? 30000 : 15000));
async function refreshSettingsCache() {
  const [nextSettings, nextChatMeta] = await Promise.all([allSettings(), listAllChatSessionMeta()]);
  settingsCache = nextSettings;
  chatMetaCache = nextChatMeta;
  settingsCacheAt = Date.now();
  await migrateLegacyChatMetaBlob().catch((err) => console.error('[chat-meta] legacy migrate fail:', err?.message || err));
  return settingsCache;
}
async function ensureSettingsFresh(force = false) {
  const stale = force || !settingsCacheAt || (Date.now() - settingsCacheAt) >= SETTINGS_CACHE_TTL_MS;
  if (!stale) return settingsCache;
  if (!settingsRefreshPromise) {
    settingsRefreshPromise = refreshSettingsCache().finally(() => { settingsRefreshPromise = null; });
  }
  return settingsRefreshPromise;
}
function cfg(key) {
  const v = settingsCache[key];
  return v ? v : (process.env[key] || '');
}
function intCfg(key, fallback) {
  const raw = parseInt(String(cfg(key) || '').trim(), 10);
  return Number.isFinite(raw) ? raw : fallback;
}
function reservationTtlMinutes() {
  return Math.max(10, intCfg('ORDER_RESERVATION_TTL_MINUTES', 30));
}
function reservationExpiresAt(order) {
  return Number(order?.createdAt || 0) + reservationTtlMinutes() * 60000;
}
function lineChannelAccessToken() {
  return String(cfg('LINE_CHANNEL_ACCESS_TOKEN') || cfg('LINE_CHANEL_ACCESS_TOKEN') || '').trim();
}
function lineChannelSecret() {
  return String(cfg('LINE_CHANNEL_SECRET') || cfg('LINE_CHANEL_SECRET') || '').trim();
}
function lineClient() {
  const t = lineChannelAccessToken();
  return t ? new line.messagingApi.MessagingApiClient({ channelAccessToken: t }) : null;
}
function adminUserId() { return cfg('LINE_ADMIN_USER_ID'); }
function stripeClient() { const k = cfg('STRIPE_SECRET_KEY'); return k ? new Stripe(k) : null; }
function lineSourceKey(source = {}) {
  if (source?.userId) return `user:${String(source.userId).trim()}`;
  if (source?.groupId) return `group:${String(source.groupId).trim()}`;
  if (source?.roomId) return `room:${String(source.roomId).trim()}`;
  return '';
}
function lineSessionIdFromSource(source = {}) {
  const seed = lineSourceKey(source);
  if (!seed) return '';
  return `L${crypto.createHash('sha256').update(seed).digest('hex').toUpperCase().slice(0, 15)}`;
}
function lineChannelLabel(channel = '') {
  return String(channel || '').trim() === 'line_oa' ? 'LINE OA' : 'LIVE CHAT';
}
const LINE_CHAT_MODE_REPLY = 'line_reply';
const LINE_CHAT_MODE_WEB_ROOM = 'web_room';
const LINE_WEB_ROOM_TOKEN_TTL_MINUTES = 60 * 12;
function normalizeLineChatMode(value = '') {
  return String(value || '').trim() === LINE_CHAT_MODE_WEB_ROOM ? LINE_CHAT_MODE_WEB_ROOM : LINE_CHAT_MODE_REPLY;
}
function lineChatMode() {
  return normalizeLineChatMode(cfg('LINE_CHAT_MODE') || LINE_CHAT_MODE_REPLY);
}
function lineWebChatPath() {
  const raw = String(cfg('LINE_WEB_CHAT_PATH') || '/line-room').trim();
  if (!raw) return '/line-room';
  return raw.startsWith('/') ? raw.replace(/\/+$/, '') || '/line-room' : `/${raw.replace(/^\/+|\/+$/g, '')}`;
}
function publicBaseUrl() {
  return String(cfg('PUBLIC_URL') || '').trim().replace(/\/+$/, '');
}
function lineBridgeCompatEnabled() {
  return /^(1|true|yes|on)$/i.test(String(cfg('LINEOA_BRIDGE_COMPAT_ENABLED') || '').trim());
}
function lineWebRoomTokenSecret() {
  return String(cfg('LINEOA_API_SECRET') || lineChannelSecret() || '').trim();
}
function createLineWebRoomToken(payload = {}) {
  const secret = lineWebRoomTokenSecret();
  if (!secret) return '';
  const normalized = {
    v: 1,
    sessionId: normalizeChatSessionId(payload.sessionId || ''),
    lineUserId: String(payload.lineUserId || '').trim(),
    customerName: String(payload.customerName || '').trim().slice(0, 80),
    replyMode: normalizeLineChatMode(payload.replyMode || LINE_CHAT_MODE_WEB_ROOM),
    issuedAt: Number(payload.issuedAt || Date.now()) || Date.now(),
    exp: Number(payload.exp || (Date.now() + LINE_WEB_ROOM_TOKEN_TTL_MINUTES * 60000)) || (Date.now() + LINE_WEB_ROOM_TOKEN_TTL_MINUTES * 60000),
  };
  if (!normalized.sessionId || !normalized.lineUserId) return '';
  const body = Buffer.from(JSON.stringify(normalized), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function parseLineWebRoomToken(token = '') {
  const secret = lineWebRoomTokenSecret();
  const raw = String(token || '').trim();
  if (!secret || !raw.includes('.')) return null;
  const [body, sig] = raw.split('.', 2);
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (!hasMatchingSecret(expected, sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return null;
    const exp = Number(payload.exp || 0);
    if (!exp || exp < Date.now()) return null;
    const sessionId = normalizeChatSessionId(payload.sessionId || '');
    const lineUserId = String(payload.lineUserId || '').trim();
    if (!sessionId || !lineUserId) return null;
    return {
      ...payload,
      sessionId,
      lineUserId,
      customerName: String(payload.customerName || '').trim().slice(0, 80),
      replyMode: normalizeLineChatMode(payload.replyMode || LINE_CHAT_MODE_WEB_ROOM),
      exp,
    };
  } catch {
    return null;
  }
}
function lineWebRoomEntryUrl(payload = {}) {
  const token = createLineWebRoomToken(payload);
  if (!token) return '';
  const path = `${lineWebChatPath()}/${encodeURIComponent(token)}`;
  const base = publicBaseUrl();
  return base ? `${base}${path}` : path;
}
function lineWebRoomDiagnostics() {
  const base = publicBaseUrl();
  const path = lineWebChatPath();
  if (!base) return { ok: false, reason: 'missing_public_url', entryUrl: '', path };
  if (!lineWebRoomTokenSecret()) return { ok: false, reason: 'missing_line_web_room_secret', entryUrl: '', path };
  const payload = {
    sessionId: 'LTESTDDD01',
    lineUserId: 'U-LINE-ROOM-TEST',
    customerName: 'LINE Room Test',
    replyMode: LINE_CHAT_MODE_WEB_ROOM,
    issuedAt: Date.now(),
  };
  const entryUrl = lineWebRoomEntryUrl(payload);
  if (!entryUrl) return { ok: false, reason: 'entry_url_empty', entryUrl: '', path };
  const expectedPrefix = `${base}${path}/`;
  if (!entryUrl.startsWith(expectedPrefix)) {
    return { ok: false, reason: 'entry_url_prefix_mismatch', entryUrl, path };
  }
  const token = entryUrl.slice(expectedPrefix.length);
  const parsed = parseLineWebRoomToken(decodeURIComponent(token || ''));
  if (!parsed) return { ok: false, reason: 'token_parse_failed', entryUrl, path };
  if (parsed.sessionId !== payload.sessionId || parsed.lineUserId !== payload.lineUserId) {
    return { ok: false, reason: 'token_payload_mismatch', entryUrl, path };
  }
  return { ok: true, reason: 'ok', entryUrl, path, sessionId: parsed.sessionId };
}

function cfgSource(key = '') {
  const normalized = String(key || '').trim();
  if (!normalized) return 'none';
  if (settingsCache[normalized]) return 'db';
  if (process.env[normalized]) return 'env';
  return 'none';
}

function envPresent(key = '') {
  return Boolean(String(process.env[String(key || '').trim()] || '').trim());
}

function maskedValuePreview(key = '', value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/SECRET|TOKEN|PASS|KEY/i.test(String(key || ''))) return `set (${raw.slice(-4)})`;
  return raw.slice(0, 80);
}

function buildSystemValidationReport(reason = 'runtime') {
  const supabase = supabaseEnv();
  const smtpFields = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const smtpConfiguredCount = smtpFields.filter((key) => Boolean(String(cfg(key) || '').trim())).length;
  const stripeSecret = Boolean(String(cfg('STRIPE_SECRET_KEY') || '').trim());
  const stripeWebhook = Boolean(String(cfg('STRIPE_WEBHOOK_SECRET') || '').trim());
  const slipokUrl = Boolean(String(cfg('SLIPOK_API_URL') || '').trim());
  const slipokKey = Boolean(String(cfg('SLIPOK_API_KEY') || '').trim());
  const checks = [
    {
      key: 'PUBLIC_URL',
      label: 'Public URL',
      status: publicBaseUrl() ? 'ok' : 'error',
      source: cfgSource('PUBLIC_URL'),
      note: publicBaseUrl() ? 'ใช้สร้างลิงก์ production และ redirect ได้' : 'ยังไม่ได้ตั้งค่าโดเมนหลักสำหรับลิงก์ production',
      value: maskedValuePreview('PUBLIC_URL', publicBaseUrl()),
    },
    {
      key: 'LINE_CHANNEL_ACCESS_TOKEN',
      label: 'LINE Channel Access Token',
      status: lineChannelAccessToken() ? 'ok' : 'error',
      source: cfgSource('LINE_CHANNEL_ACCESS_TOKEN') !== 'none' ? cfgSource('LINE_CHANNEL_ACCESS_TOKEN') : cfgSource('LINE_CHANEL_ACCESS_TOKEN'),
      note: lineChannelAccessToken() ? 'พร้อมส่ง reply/push ไป LINE OA' : 'LINE OA จะรับ event ได้แต่ส่งข้อความกลับไม่ได้',
      value: maskedValuePreview('LINE_CHANNEL_ACCESS_TOKEN', lineChannelAccessToken()),
    },
    {
      key: 'LINE_CHANNEL_SECRET',
      label: 'LINE Channel Secret',
      status: lineChannelSecret() ? 'ok' : 'error',
      source: cfgSource('LINE_CHANNEL_SECRET') !== 'none' ? cfgSource('LINE_CHANNEL_SECRET') : cfgSource('LINE_CHANEL_SECRET'),
      note: lineChannelSecret() ? 'พร้อม verify webhook signature' : 'webhook LINE ไม่สามารถ verify signature ได้',
      value: maskedValuePreview('LINE_CHANNEL_SECRET', lineChannelSecret()),
    },
    {
      key: 'LINE_ADMIN_USER_ID',
      label: 'LINE Admin User ID',
      status: adminUserId() ? 'ok' : 'warn',
      source: cfgSource('LINE_ADMIN_USER_ID'),
      note: adminUserId() ? 'พร้อมรับ test message และ system alert ทาง LINE' : 'ยังส่ง alert หรือ test message ไปหาแอดมินทาง LINE ไม่ได้',
      value: maskedValuePreview('LINE_ADMIN_USER_ID', adminUserId()),
    },
    {
      key: 'LINE_CHAT_MODE',
      label: 'LINE Chat Mode',
      status: 'info',
      source: cfgSource('LINE_CHAT_MODE'),
      note: lineChatMode() === LINE_CHAT_MODE_WEB_ROOM ? 'ลูกค้าจะถูกพาไปคุยต่อในห้องเว็บ' : 'แอดมินตอบกลับหา LINE โดยตรง',
      value: lineChatMode(),
    },
    {
      key: 'LINEOA_API_SECRET',
      label: 'LINE Web Room Secret',
      status: lineChatMode() === LINE_CHAT_MODE_WEB_ROOM
        ? (lineWebRoomTokenSecret() ? 'ok' : 'error')
        : (lineWebRoomTokenSecret() ? 'ok' : 'warn'),
      source: cfgSource('LINEOA_API_SECRET') !== 'none' ? cfgSource('LINEOA_API_SECRET') : (lineChannelSecret() ? 'derived' : 'none'),
      note: lineWebRoomDiagnostics().ok
        ? 'สร้าง signed token สำหรับห้องแชตเว็บได้'
        : `line-room ยังไม่พร้อม: ${lineWebRoomDiagnostics().reason}`,
      value: maskedValuePreview('LINEOA_API_SECRET', lineWebRoomTokenSecret()),
    },
    {
      key: 'SUPABASE_URL',
      label: 'Supabase URL',
      status: activeProvider === 'supabase' ? (supabase.url ? 'ok' : 'error') : (supabase.url ? 'ok' : 'info'),
      source: envPresent('SUPABASE_URL') ? 'env' : 'none',
      note: activeProvider === 'supabase'
        ? (supabase.url ? 'DB หลักชี้ Supabase แล้ว' : 'DB provider ใช้ Supabase แต่ยังไม่พบ URL')
        : 'ใช้แสดงสถานะ realtime และ migration',
      value: maskedValuePreview('SUPABASE_URL', supabase.url || ''),
    },
    {
      key: 'SUPABASE_SERVICE_ROLE_KEY',
      label: 'Supabase Service Role',
      status: activeProvider === 'supabase' ? (supabase.serviceRoleKey ? 'ok' : 'error') : (supabase.serviceRoleKey ? 'ok' : 'info'),
      source: envPresent('SUPABASE_SERVICE_ROLE_KEY') ? 'env' : 'none',
      note: supabase.serviceRoleKey ? 'พร้อมใช้หลังบ้าน/realtime broadcast' : 'ฟีเจอร์ realtime และงานหลังบ้านบางส่วนจะทำงานไม่ครบ',
      value: maskedValuePreview('SUPABASE_SERVICE_ROLE_KEY', supabase.serviceRoleKey || ''),
    },
    {
      key: 'SUPABASE_PUBLISHABLE_KEY',
      label: 'Supabase Publishable Key',
      status: chatRealtimeEnabled() ? (supabase.publishableKey ? 'ok' : 'warn') : (supabase.publishableKey ? 'ok' : 'info'),
      source: envPresent('SUPABASE_ANON_KEY') || envPresent('SUPABASE_PUBLISHABLE_KEY') ? 'env' : 'none',
      note: chatRealtimeEnabled()
        ? (supabase.publishableKey ? 'พร้อมให้ client subscribe realtime' : 'client realtime อาจ fallback ไป polling')
        : 'ใช้เฉพาะตอน client ต่อ realtime',
      value: maskedValuePreview('SUPABASE_PUBLISHABLE_KEY', supabase.publishableKey || ''),
    },
    {
      key: 'SESSION_SIGNING_SECRET',
      label: 'Session Signing Secret',
      status: envPresent('SESSION_SIGNING_SECRET') ? 'ok' : 'warn',
      source: envPresent('SESSION_SIGNING_SECRET') ? 'env' : 'none',
      note: envPresent('SESSION_SIGNING_SECRET') ? 'ใช้ sign cookie/admin grant แยกจาก admin key แล้ว' : 'ยังใช้ fallback จาก ADMIN_ACCESS_KEY อยู่ ควรแยก secret สำหรับ production',
      value: maskedValuePreview('SESSION_SIGNING_SECRET', process.env.SESSION_SIGNING_SECRET || ''),
    },
    {
      key: 'SMTP_STACK',
      label: 'SMTP Stack',
      status: smtpConfiguredCount === 0 ? 'info' : (smtpConfiguredCount === smtpFields.length ? 'ok' : 'warn'),
      source: smtpConfiguredCount ? 'mixed' : 'none',
      note: smtpConfiguredCount === 0
        ? 'ยังไม่ได้เปิดส่งอีเมล'
        : (smtpConfiguredCount === smtpFields.length ? 'พร้อมส่งอีเมล' : 'ตั้งค่า SMTP ยังไม่ครบทุกช่อง'),
      value: smtpConfiguredCount ? `${smtpConfiguredCount}/${smtpFields.length} fields` : '',
    },
    {
      key: 'STRIPE_STACK',
      label: 'Stripe Keys',
      status: (!stripeSecret && !stripeWebhook) ? 'info' : ((stripeSecret && stripeWebhook) ? 'ok' : 'warn'),
      source: stripeSecret || stripeWebhook ? 'mixed' : 'none',
      note: (!stripeSecret && !stripeWebhook)
        ? 'ยังไม่ได้เปิด Stripe'
        : ((stripeSecret && stripeWebhook) ? 'พร้อมรับชำระและ verify webhook' : 'ตั้งค่า Stripe ไม่ครบทั้ง secret และ webhook secret'),
      value: `${stripeSecret ? 'secret' : '-'} / ${stripeWebhook ? 'webhook' : '-'}`,
    },
    {
      key: 'SLIPOK_STACK',
      label: 'SlipOK',
      status: (!slipokUrl && !slipokKey) ? 'info' : ((slipokUrl && slipokKey) ? 'ok' : 'warn'),
      source: slipokUrl || slipokKey ? 'mixed' : 'none',
      note: (!slipokUrl && !slipokKey)
        ? 'ยังไม่ได้เปิดตรวจสลิปอัตโนมัติ'
        : ((slipokUrl && slipokKey) ? 'พร้อมตรวจสลิปอัตโนมัติ' : 'ตั้งค่า SlipOK ยังไม่ครบ'),
      value: `${slipokUrl ? 'url' : '-'} / ${slipokKey ? 'key' : '-'}`,
    },
  ];
  const errorCount = checks.filter((item) => item.status === 'error').length;
  const warningCount = checks.filter((item) => item.status === 'warn').length;
  return {
    checkedAt: Date.now(),
    ok: errorCount === 0,
    reason: String(reason || 'runtime').trim() || 'runtime',
    errorCount,
    warningCount,
    items: checks,
  };
}

async function runStartupValidation(reason = 'startup') {
  const report = buildSystemValidationReport(reason);
  await updateRuntimeDiagnostics((state) => {
    state.startup = report;
    return state;
  });
  if (!report.ok || report.warningCount) {
    await recordSystemEvent({
      level: report.ok ? 'warn' : 'error',
      source: 'config_guard',
      type: 'startup_validation',
      message: report.ok
        ? `Startup validation completed with ${report.warningCount} warning(s)`
        : `Startup validation found ${report.errorCount} error(s)`,
      data: { reason, errorCount: report.errorCount, warningCount: report.warningCount },
      alert: !report.ok,
      dedupeKey: 'config_guard:startup_validation',
    });
  }
  return report;
}

async function pushAdminAlert(text = '') {
  const c = lineClient();
  const to = adminUserId();
  const message = String(text || '').trim();
  if (!c || !to || !message) return false;
  try {
    await c.pushMessage({ to, messages: [{ type: 'text', text: message.slice(0, 1000) }] });
    return true;
  } catch (err) {
    console.error('[line] alert push fail:', err?.body || err?.message || err);
    return false;
  }
}

async function recordSystemEvent({ level = 'info', source = 'system', type = 'event', message = '', data = {}, alert = false, dedupeKey = '' } = {}) {
  const normalizedMessage = String(message || '').trim().slice(0, 240);
  if (!normalizedMessage) return null;
  const now = Date.now();
  const entry = {
    id: makeRuntimeEntryId('evt'),
    at: now,
    level: String(level || 'info').trim() || 'info',
    source: String(source || 'system').trim() || 'system',
    type: String(type || 'event').trim() || 'event',
    message: normalizedMessage,
    data: trimObjectStringValues(data, 220),
  };
  let shouldAlert = false;
  let alertKey = '';
  await updateRuntimeDiagnostics((state) => {
    state.events.unshift(entry);
    state.events = state.events.slice(0, RUNTIME_EVENT_LIMIT);
    alertKey = String(dedupeKey || `${entry.source}:${entry.type}:${entry.message}`).trim();
    if (alert || entry.level === 'error' || entry.level === 'critical') {
      const lastAlertAt = Number(state.alertCooldowns[alertKey] || 0);
      shouldAlert = !lastAlertAt || (now - lastAlertAt) >= ALERT_COOLDOWN_MS;
      if (shouldAlert) {
        state.alertCooldowns[alertKey] = now;
        state.alerts.unshift({
          ...entry,
          alertKey,
          delivered: false,
        });
        state.alerts = state.alerts.slice(0, RUNTIME_ALERT_LIMIT);
      }
    }
    return state;
  });
  if (shouldAlert) {
    const delivered = await pushAdminAlert(`[SYSTEM ALERT]\n${entry.source}\n${entry.message}`);
    await updateRuntimeDiagnostics((state) => {
      const target = state.alerts.find((item) => item.id === entry.id);
      if (target) {
        target.delivered = delivered;
        target.deliveredAt = delivered ? Date.now() : 0;
      }
      return state;
    });
  }
  return entry;
}

function lineWebhookEventKey(event = {}) {
  const explicit = String(event?.webhookEventId || '').trim();
  if (explicit) return explicit;
  const seed = JSON.stringify({
    type: event?.type || '',
    timestamp: Number(event?.timestamp || 0),
    replyToken: String(event?.replyToken || '').trim(),
    source: lineSourceKey(event?.source || {}),
    messageId: String(event?.message?.id || '').trim(),
    text: String(event?.message?.text || '').trim().slice(0, 80),
  });
  return `fallback_${crypto.createHash('sha1').update(seed).digest('hex')}`;
}

// idempotency ผ่านตาราง line_webhook_events (INSERT-if-absent แบบ atomic — ไม่มี race ข้าม instance)
async function ensureLineWebhookEventIdempotency(event = {}) {
  const eventKey = lineWebhookEventKey(event);
  const { duplicate } = await claimLineWebhookEvent(eventKey, Date.now());
  void maybeCleanupLineWebhookStorage();
  return { eventKey, duplicate };
}

let lineWebhookCleanupAt = 0;
const LINE_WEBHOOK_AUDIT_RETENTION_MS = 1000 * 60 * 60 * 24 * 14;
async function maybeCleanupLineWebhookStorage() {
  const now = Date.now();
  if (now - lineWebhookCleanupAt < 3600000) return;
  lineWebhookCleanupAt = now;
  try {
    await cleanupLineWebhookEvents(now - LINE_WEBHOOK_PROCESSED_TTL_MS);
    await cleanupLineWebhookAudits(now - LINE_WEBHOOK_AUDIT_RETENTION_MS);
  } catch (err) {
    console.error('[line] webhook storage cleanup fail:', err?.message || err);
  }
}

async function recordLineWebhookAudit(entry = {}) {
  const now = Date.now();
  const audit = {
    id: makeRuntimeEntryId('line'),
    at: now,
    eventKey: String(entry.eventKey || '').trim(),
    eventType: String(entry.eventType || '').trim(),
    sourceKey: String(entry.sourceKey || '').trim(),
    messageType: String(entry.messageType || '').trim(),
    textPreview: String(entry.textPreview || '').trim().slice(0, 160),
    result: String(entry.result || 'unknown').trim(),
    durationMs: Math.max(0, Number(entry.durationMs || 0)),
    error: String(entry.error || '').trim().slice(0, 240),
    note: String(entry.note || '').trim().slice(0, 240),
  };
  try {
    await insertLineWebhookAudit(audit);
  } catch (err) {
    console.error('[line] webhook audit insert fail:', err?.message || err);
  }
  return audit;
}

function summarizeLineWebhookAudits(audits = []) {
  const counters = { received: 0, duplicate: 0, success: 0, failed: 0, signatureRejected: 0, parseFailed: 0, ignored: 0 };
  for (const audit of audits) {
    counters.received += 1;
    const result = String(audit?.result || '');
    if (result === 'success') counters.success += 1;
    else if (result === 'duplicate') { counters.duplicate += 1; counters.ignored += 1; }
    else if (result === 'signature_rejected') counters.signatureRejected += 1;
    else if (result === 'parse_failed') counters.parseFailed += 1;
    else if (result !== 'received') counters.failed += 1;
  }
  return counters;
}

function buildHealthSnapshot() {
  const startup = runtimeDiagnosticsState().startup;
  return {
    ok: true,
    lineConfigured: Boolean(lineClient() && lineChannelSecret()),
    lineWebRoomReady: lineWebRoomDiagnostics().ok,
    stripeConfigured: Boolean(stripeClient()),
    promptpayConfigured: Boolean(cfg('PROMPTPAY_ID')),
    slipokConfigured: slipokConfig().enabled,
    mailConfigured: mailConfigured(),
    dbProvider: activeProvider,
    dbProviderRequested: process.env.DB_PROVIDER || 'sqlite',
    dbProviderForced: /^(1|true|yes|on)$/i.test(String(process.env.FORCE_SUPABASE || '').trim()),
    supabaseConfigured: isSupabaseConfigured({ requireServiceRole: true }),
    chatRealtimeMode: chatRealtimeEnabled() ? 'supabase-broadcast' : (isServerless ? 'polling' : 'socket'),
    configGuardOk: startup.ok === true,
    configGuardCheckedAt: Number(startup.checkedAt || 0),
    configGuardErrorCount: Math.max(0, Number(startup.errorCount || 0)),
    configGuardWarningCount: Math.max(0, Number(startup.warningCount || 0)),
  };
}
function lineReplyMode(meta = {}) {
  return normalizeLineChatMode(meta?.replyMode || lineChatMode());
}
async function fetchLineProfile(source = {}) {
  const accessToken = lineChannelAccessToken();
  const userId = String(source?.userId || '').trim();
  if (!accessToken || !userId) return null;
  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const profile = await response.json().catch(() => null);
    return profile && typeof profile === 'object' ? profile : null;
  } catch {
    return null;
  }
}
async function syncLineInboxSession(source = {}, patch = {}) {
  const sessionId = lineSessionIdFromSource(source);
  if (!CHAT_SESSION_ID_RE.test(sessionId)) return null;
  const profile = await fetchLineProfile(source);
  const displayName = String(
    patch.displayName
    || patch.customerName
    || profile?.displayName
    || (source?.userId ? `LINE-${String(source.userId).slice(-6)}` : 'ลูกค้า LINE')
  ).trim().slice(0, 80);
  const now = Number(patch.at || Date.now()) || Date.now();
  const metaPatch = {
    channel: 'line_oa',
    channelLabel: lineChannelLabel('line_oa'),
    replyMode: normalizeLineChatMode(patch.replyMode || patch?.metaPatch?.replyMode || lineChatMode()),
    lineSourceType: String(source?.type || '').trim(),
    lineUserId: String(source?.userId || '').trim(),
    lineGroupId: String(source?.groupId || '').trim(),
    lineRoomId: String(source?.roomId || '').trim(),
    lineReplyToken: String(patch.replyToken || '').trim(),
    lineReplyTokenAt: patch.replyToken ? now : Number(patch.lineReplyTokenAt || 0),
    lineProfileRaw: profile || patch.lineProfileRaw || null,
    customerName: displayName,
    visitorName: displayName,
    customerAvatar: String(profile?.pictureUrl || patch.customerAvatar || '').trim(),
    lineStatusMessage: String(profile?.statusMessage || '').trim(),
    lastLineEventType: String(patch.eventType || '').trim(),
    lastLineMessageType: String(patch.messageType || '').trim(),
    lastMessageVia: 'line_oa',
    ...patch.metaPatch,
  };
  await patchChatInboxMeta(sessionId, metaPatch);
  const current = sessions.get(sessionId) || { socketId: '', name: displayName, lastActiveAt: now };
  current.name = displayName;
  current.lastActiveAt = now;
  sessions.set(sessionId, current);
  lastActiveSession = sessionId;
  return { sessionId, displayName, profile, metaPatch };
}
async function deliverLineReply(sessionId, text, meta = {}) {
  const client = lineClient();
  const recipientId = String(meta?.lineUserId || meta?.lineGroupId || meta?.lineRoomId || '').trim();
  if (!client || !recipientId) throw new Error('ยังไม่พบปลายทาง LINE ของห้องนี้');
  try {
    await client.pushMessage({
      to: recipientId,
      messages: [{ type: 'text', text: String(text || '').trim().slice(0, 1000) }],
    });
    await patchChatInboxMeta(sessionId, { lastLinePushAt: Date.now(), lastLineReplyError: '' });
    return true;
  } catch (error) {
    const raw = error?.body?.message || error?.message || 'LINE push failed';
    await patchChatInboxMeta(sessionId, {
      lastLineReplyError: String(raw).trim().slice(0, 500),
      lastLineReplyErrorAt: Date.now(),
    });
    await recordSystemEvent({
      level: 'error',
      source: 'line_delivery',
      type: 'push_failed',
      message: `ส่งข้อความกลับ LINE ไม่สำเร็จสำหรับห้อง ${sessionId}`,
      data: {
        sessionId,
        lineUserId: recipientId,
        error: String(raw).trim().slice(0, 180),
      },
      alert: true,
      dedupeKey: `line_delivery:${sessionId}`,
    });
    throw new Error(`ส่งข้อความกลับ LINE ไม่สำเร็จ: ${String(raw).trim() || 'unknown error'}`);
  }
}
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');            // ซ่อน fingerprint ของ stack
app.disable('etag');                    // ลด fingerprinting จาก ETag
const server = isServerless ? null : http.createServer(app);
const io = isServerless
  ? { on() {}, to() { return { emit() {} }; } }
  : new SocketIOServer(server);

// ──────────────────── security hardening ────────────────────
// ป้องกัน clickjacking / sniffing / รั่ว referrer + จำกัดแหล่งทรัพยากร (กันสแครป/แกะ stack)
app.use((req, res, next) => {
  const isCropPreview = req.path.startsWith('/crops/') && String(req.query?.preview || '') === '1';
  const localAssetOrigins = ' http://localhost:3005 http://127.0.0.1:3005';
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', isCropPreview ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "base-uri 'self'", "object-src 'none'", `frame-ancestors ${isCropPreview ? "'self'" : "'none'"}`,
    `img-src 'self' data: blob: https:${localAssetOrigins}`, `media-src 'self' https: data: blob:${localAssetOrigins}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' https://cdn.jsdelivr.net https://www.googletagmanager.com https://connect.facebook.net https://analytics.tiktok.com 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    "connect-src 'self' ws: wss: https: blob: data:",
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(async (req, res, next) => {
  const needsFreshSettings = req.path.startsWith('/api/')
    || req.path.startsWith('/webhook/')
    || req.path === '/robots.txt'
    || req.path === '/sitemap.xml';
  if (!needsFreshSettings) return next();
  try {
    await ensureSettingsFresh();
    await cleanupExpiredReservations();
    next();
  } catch (err) {
    next(err);
  }
});

// rate limiting (กันบรูตฟอร์ซ/บอท) — เก็บใน memory
const _rl = new Map();
function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const k = (req.ip || 'x') + '|' + req.method + req.baseUrl + req.path;
    const now = Date.now();
    let b = _rl.get(k);
    if (!b || now > b.reset) { b = { n: 0, reset: now + windowMs }; _rl.set(k, b); }
    if (++b.n > max) return res.status(429).json({ error: 'คำขอถี่เกินไป กรุณาลองใหม่ในภายหลัง' });
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 5 * 60000, max: 50 });
const orderLimiter = rateLimit({ windowMs: 5 * 60000, max: 30 });
const leadLimiter = rateLimit({ windowMs: 5 * 60000, max: 20 });
const adminLimiter = rateLimit({ windowMs: 5 * 60000, max: 180 });
setInterval(() => { const now = Date.now(); for (const [k, b] of _rl) if (now > b.reset) _rl.delete(k); }, 10 * 60000).unref?.();

// ──────────────────── สถานะออเดอร์ ────────────────────
const STATUS_LABEL = {
  awaiting_payment: 'รอชำระเงิน', paid: 'ชำระเงินแล้ว', preparing: 'กำลังเตรียมสินค้า',
  shipped: 'จัดส่งแล้ว', delivered: 'จัดส่งสำเร็จ', cancelled: 'ยกเลิก', expired: 'หมดเวลาชำระ',
};

// ──────────────────── seed ────────────────────
// หมายเหตุ: ราคาบางรายการเป็นค่าเริ่มต้น (เว็บแบรนด์ไม่ได้ระบุ) — แก้ได้ในหลังบ้าน
const faqPairs = (...items) => items.map(([q, a]) => ({ q, a }));
const agriExtra = (extra = {}) => ({
  cropTargets: [],
  registrationNo: 'รออัปเดตเลขทะเบียน',
  labelUrl: '',
  labelNote: 'ควรอ่านฉลากและคำแนะนำก่อนใช้ทุกครั้ง',
  applicationMethod: 'ฉีดพ่นทางใบ',
  dosage: '5 ซีซี ต่อน้ำ 20 ลิตร',
  usageSteps: ['เขย่าขวดก่อนใช้', 'ผสมน้ำสะอาดตามอัตราแนะนำ', 'ฉีดพ่นช่วงเช้าหรือเย็น'],
  warnings: ['เก็บให้พ้นมือเด็ก', 'หลีกเลี่ยงการผสมเกินอัตรา', 'ทดสอบในพื้นที่เล็กก่อนใช้จริง'],
  faq: faqPairs(
    ['ใช้ร่วมกับสารจับใบได้ไหม?', 'ใช้ได้ และช่วยให้การเกาะใบดีขึ้นเมื่อฉีดพ่นในสภาพอากาศแปรปรวน'],
    ['ควรฉีดช่วงเวลาไหน?', 'แนะนำช่วงเช้าหรือเย็น หลีกเลี่ยงแดดจัดและช่วงฝนตกทันทีหลังฉีด']
  ),
  ...extra,
});
const lifestyleExtra = (extra = {}) => ({
  labelUrl: '',
  faq: [],
  ...extra,
});
const DEFAULT_PRODUCTS = [
  { id: 'p1', name: 'นุชฟอร์ไลฟ์ 1', icon: 'sprout', price: 450, tag: 'เกษตร', short: 'เร่งโต ขยายโครงสร้างพืช รากแข็งแรง',
    desc: 'อาหารเสริมพืชสูตรเร่งการเจริญเติบโต ช่วยขยายโครงสร้างพืช เพิ่มขนาดผล และเสริมระบบรากให้แข็งแรง เหมาะกับพืชทุกชนิด',
    specs: { 'ประเภท': 'อาหารเสริมพืช', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], usageSteps: ['ใช้ช่วงเร่งแตกยอดหรือเร่งการเจริญเติบโต', 'ฉีดพ่นทุก 7-10 วันตามความเหมาะสม', 'ใช้ต่อเนื่องร่วมกับการจัดการธาตุอาหารหลัก'], warnings: ['ไม่ควรฉีดช่วงแดดจัด', 'หลีกเลี่ยงการผสมกับผลิตภัณฑ์ที่มีความเป็นด่างสูง'], faq: faqPairs(['ใช้กับต้นอ่อนได้ไหม?', 'ใช้ได้ โดยลดอัตราเริ่มต้นและสังเกตการตอบสนองของพืช'], ['เหมาะกับช่วงไหนที่สุด?', 'ช่วงเร่งใบ แตกยอด และฟื้นต้นหลังเก็บเกี่ยว']) }), stock: 60 },
  { id: 'p2', name: 'นุชฟอร์ไลฟ์ 2', icon: 'drop', price: 450, tag: 'เกษตร', short: 'เพิ่มคุณภาพผล สี รสชาติ น้ำหนัก',
    desc: 'สูตรเพิ่มคุณภาพผลผลิต ช่วยเรื่องสี รสชาติ ขนาด และเพิ่มน้ำหนัก สะสมธาตุอาหารในผล เหมาะช่วงติดผล–ก่อนเก็บเกี่ยว',
    specs: { 'ประเภท': 'เพิ่มคุณภาพผลผลิต', 'ใช้กับ': 'ไม้ผล/พืชผัก', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], dosage: '5 ซีซี ต่อน้ำ 20 ลิตร', usageSteps: ['ใช้ช่วงติดผลถึงก่อนเก็บเกี่ยว', 'ฉีดพ่นให้เปียกทั่วทรงพุ่ม', 'ใช้ต่อเนื่องทุก 7-10 วัน'], faq: faqPairs(['ช่วยเรื่องสีและน้ำหนักผลไหม?', 'ออกแบบมาเพื่อช่วยเพิ่มคุณภาพผล สี รสชาติ และน้ำหนักเมื่อใช้ร่วมกับการจัดการปุ๋ยที่เหมาะสม'], ['ใช้ช่วงผลอ่อนได้ไหม?', 'ใช้ได้ โดยเริ่มจากอัตราแนะนำต่ำก่อนและสังเกตผล']) }), stock: 60 },
  { id: 'p3', name: 'นุชฟอร์ไลฟ์ 8', icon: 'shieldleaf', price: 480, tag: 'เกษตร', short: 'ต้านเครียด ลดดอก/ผลร่วง ใบไม่เหลือง',
    desc: 'สูตรเสริมความแข็งแรงของเซลล์พืช ช่วยให้พืชทนต่อสภาพเครียด ลดการหลุดร่วงของดอกและผล ป้องกันใบเหลือง',
    specs: { 'ประเภท': 'เสริมภูมิต้านทาน', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], dosage: '5 ซีซี ต่อน้ำ 20 ลิตร', usageSteps: ['ใช้ก่อนหรือระหว่างช่วงพืชเจอความเครียด', 'ฉีดซ้ำเมื่อสภาพอากาศแปรปรวน', 'ใช้ร่วมกับโปรแกรมบำรุงปกติได้'], faq: faqPairs(['ใช้หลังฝนตกหนักได้ไหม?', 'ใช้ได้เพื่อช่วยฟื้นต้นและลดอาการเครียดของพืช'], ['ช่วยลดผลร่วงหรือไม่?', 'เหมาะกับการช่วยดูแลพืชในช่วงเสี่ยงต่อการเครียดและการร่วง']) }), stock: 50 },
  { id: 'p4', name: 'นุชฟอร์ไลฟ์ 9', icon: 'leaf', price: 480, tag: 'เกษตร', short: 'ป้องกันใบจุด สนิม ดอกสม่ำเสมอ',
    desc: 'สูตรช่วยป้องกันอาการใบจุด แผลคล้ายสนิม และช่วยให้การออกดอกสม่ำเสมอ เสริมความสมบูรณ์ของใบและดอก',
    specs: { 'ประเภท': 'ป้องกันโรคพืช', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], dosage: '5 ซีซี ต่อน้ำ 20 ลิตร', faq: faqPairs(['เหมาะกับพืชผักหรือไม่?', 'เหมาะกับพืชผักและไม้ผลในช่วงที่ต้องการดูแลความสมบูรณ์ของใบและดอก'], ['ควรใช้ถี่แค่ไหน?', 'ขึ้นกับสภาพแปลง โดยทั่วไปใช้ทุก 7-10 วันหรือตามโปรแกรมที่ปรึกษา']) }), stock: 50 },
  { id: 'p5', name: 'นุชฟอร์ไลฟ์ เน็ก-1', icon: 'bottle', price: 890, tag: 'เกษตร', short: 'อาหารเสริมทางใบ เร่งยอด บำรุงใบ (500cc)',
    desc: 'อาหารเสริมฉีดพ่นทางใบ ช่วยเร่งยอดและปลายให้แข็งแรง บำรุงใบให้สมบูรณ์ ป้องกันผลแตก ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'อาหารเสริมทางใบ', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿290)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], labelNote: 'มีหลายขนาดบรรจุ กรุณาตรวจสอบฉลากขนาดก่อนสั่งซื้อ', faq: faqPairs(['เหมาะกับพืชช่วงไหน?', 'เหมาะกับช่วงเร่งยอดและบำรุงใบ'], ['มีขนาดอื่นไหม?', 'มีตัวเลือกขนาดเล็กเพิ่มเติม กรุณาสอบถามทีมงาน']) }), stock: 40 },
  { id: 'p6', name: 'นุชฟอร์ไลฟ์ เน็ก-2', icon: 'bottle', price: 890, tag: 'เกษตร', short: 'อาหารเสริมทางใบ บำรุงผล (500cc)',
    desc: 'อาหารเสริมฉีดพ่นทางใบสูตรบำรุงผล ช่วยให้ผลสมบูรณ์ ขนาดดี ป้องกันผลแตก ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'อาหารเสริมทางใบ', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿290)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง'], dosage: '5 ซีซี ต่อน้ำ 20 ลิตร', faq: faqPairs(['เหมาะกับไม้ผลชนิดใด?', 'เหมาะกับไม้ผลที่ต้องการดูแลคุณภาพและขนาดผล'], ['ควรเริ่มใช้เมื่อไร?', 'เริ่มใช้ตั้งแต่ระยะติดผลอ่อนและต่อเนื่องตามโปรแกรม']) }), stock: 40 },
  { id: 'p7', name: 'สารเสริมประสิทธิภาพจับใบ', icon: 'drop', price: 390, tag: 'เกษตร', short: 'ลดการชะล้างปุ๋ย/ยาในฤดูฝน (500cc)',
    desc: 'สารจับใบช่วยให้ปุ๋ยและยาเกาะติดใบได้ดี ลดการสูญเสียจากการชะล้างในฤดูฝน เพิ่มประสิทธิภาพการฉีดพ่น ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'สารจับใบ', 'วิธีใช้': 'ผสมร่วมกับปุ๋ย/ยา', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿139)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], applicationMethod: 'ผสมร่วมกับปุ๋ยหรือผลิตภัณฑ์ฉีดพ่นอื่น', dosage: '5 ซีซี ต่อน้ำ 20 ลิตร', usageSteps: ['เติมหลังจากผสมสารหลักเรียบร้อยแล้ว', 'คนให้เข้ากันก่อนฉีดพ่น', 'เหมาะกับช่วงหน้าฝนหรือเมื่อต้องการเพิ่มการเกาะใบ'], faq: faqPairs(['ใช้เดี่ยวๆ ได้ไหม?', 'โดยทั่วไปใช้เป็นสารเสริมร่วมกับผลิตภัณฑ์ฉีดพ่นอื่น'], ['ช่วยตอนหน้าฝนอย่างไร?', 'ช่วยลดการชะล้างและเพิ่มการเกาะติดใบ']) }), stock: 80 },
  { id: 'p8', name: 'ไบโอ-อี พลัส (เอนไซม์)', icon: 'health', price: 590, tag: 'สุขภาพ', short: 'เอนไซม์จากธัญพืชและสาหร่ายสไปรูลิน่า',
    desc: 'ผลิตภัณฑ์เสริมอาหารสูตรเอนไซม์จากธัญพืชและสาหร่ายสไปรูลิน่า ช่วยดูแลสุขภาพจากภายใน',
    specs: { 'ประเภท': 'ผลิตภัณฑ์เสริมอาหาร', 'ส่วนประกอบเด่น': 'เอนไซม์ธัญพืช + สไปรูลิน่า' }, segment: 'lifestyle',
    extra: lifestyleExtra({ audience: 'สุขภาพ', faq: faqPairs(['เหมาะกับใคร?', 'เหมาะกับผู้ที่ต้องการดูแลสุขภาพทั่วไป'], ['วิธีใช้?', 'โปรดอ่านฉลากผลิตภัณฑ์ก่อนบริโภค']) }), stock: 35 },
  { id: 'p9', name: 'สมุนไพรคาวตอง', icon: 'herb', price: 350, tag: 'สุขภาพ', short: 'เครื่องดื่มสมุนไพร เสริมภูมิ (640 มล.)',
    desc: 'เครื่องดื่มสมุนไพรคาวตอง ช่วยเสริมภูมิคุ้มกัน มีคุณสมบัติช่วยลดการอักเสบ ขนาด 640 มล.',
    specs: { 'ขนาด': '640 มล.', 'ประเภท': 'เครื่องดื่มสมุนไพร' }, segment: 'lifestyle',
    extra: lifestyleExtra({ audience: 'สุขภาพ', faq: faqPairs(['มีขนาดเดียวไหม?', 'โปรดตรวจสอบรายละเอียดสินค้าก่อนสั่งซื้อ'], ['ควรเก็บอย่างไร?', 'เก็บตามคำแนะนำบนฉลากสินค้า']) }), stock: 30 },
  { id: 'p10', name: 'สบู่สมุนไพรธิดาทิพย์', icon: 'soap', price: 120, tag: 'ความงาม', short: 'สบู่สมุนไพรบำรุงผิว',
    desc: 'สบู่สมุนไพรธรรมชาติ อ่อนโยนต่อผิว ช่วยบำรุงและทำความสะอาดผิว',
    specs: { 'ประเภท': 'สบู่สมุนไพร', 'ส่วนผสม': 'สมุนไพรธรรมชาติ' }, segment: 'lifestyle',
    extra: lifestyleExtra({ audience: 'ความงาม', faq: faqPairs(['เหมาะกับผิวแบบใด?', 'ควรทดสอบกับผิวบริเวณเล็กก่อนใช้'], ['ใช้ได้ทุกวันไหม?', 'ใช้ตามความเหมาะสมและอ่านคำแนะนำบนฉลาก']) }), stock: 100 },
];
async function seedAdmin() {
  const email = String(process.env.ADMIN_SEED_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_SEED_PASSWORD || '').trim();
  const name = String(process.env.ADMIN_SEED_NAME || 'Admin').trim();
  if (!email || !password) return;
  if (password.length < 8) {
    console.warn('[seed] ข้ามการสร้างบัญชีแอดมิน: ADMIN_SEED_PASSWORD ต้องยาวอย่างน้อย 8 ตัวอักษร');
    return;
  }
  if (!await getUserByEmail(email)) {
    const { salt, hash } = hashPassword(password);
    await createUser({ id: 'u_' + crypto.randomBytes(6).toString('hex'), email, name, salt, hash, role: 'admin' });
    console.log('[seed] สร้างบัญชีแอดมิน:', email);
  }
}
async function seedProducts() {
  if ((await listProducts(true)).length === 0) {
    for (const [i, p] of DEFAULT_PRODUCTS.entries()) await createProduct({ ...p, sort: i });
    console.log('[seed] เพิ่มสินค้าเริ่มต้น', DEFAULT_PRODUCTS.length, 'รายการ');
  }
}
async function seedArticles() {
  const existing = await listArticles(true);
  if (existing.length === 0) {
    for (const article of DEFAULT_ARTICLES) await createArticle(article);
    console.log('[seed] เพิ่มบทความเริ่มต้น', DEFAULT_ARTICLES.length, 'บทความ');
    return;
  }
  const byId = new Map(existing.map((article) => [article.id, article]));
  let backfilled = 0;
  for (const article of DEFAULT_ARTICLES) {
    const current = byId.get(article.id);
    if (!current) {
      await createArticle(article);
      backfilled += 1;
      continue;
    }
    if (!String(current.cover || '').trim()) {
      await updateArticle(article.id, { cover: article.cover });
      backfilled += 1;
    }
  }
  if (backfilled) console.log('[seed] เติมรูปบทความเริ่มต้น', backfilled, 'บทความ');
}

// ──────────────────── chat sessions (in-memory) ────────────────────
const sessions = new Map();
const ADMIN_INBOX_ROOM = 'admin:inbox';
const ADMIN_INBOX_REALTIME_CHANNEL = 'realtime:admin:inbox';
let lastActiveSession = null;
const CHAT_SESSION_ID_RE = /^[A-Z0-9]{4,16}$/;
const CHAT_INBOX_META_KEY = 'SITE_CHAT_INBOX_META';
function normalizeChatSessionId(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function makeChatSessionId() {
  return crypto.randomBytes(8).toString('hex').toUpperCase().slice(0, 10);
}
function makeSessionId() { let id; do { id = makeChatSessionId(); } while (sessions.has(id)); return id; }
function parseChatInboxMeta(raw = '') {
  try {
    const parsed = JSON.parse(String(raw || '').trim() || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
// meta ต่อห้องเก็บเป็นแถวใน chat_session_meta (ตารางจริง) — cache ใน memory ให้ helper sync ใช้ได้
let chatMetaCache = {};
let chatMetaBlobMigrated = false;
function chatInboxMetaMap() {
  return chatMetaCache || {};
}
// ย้ายข้อมูลจาก blob เดิมใน settings เข้าตารางครั้งเดียว (รองรับ deploy แรกหลังเปลี่ยนโครงสร้าง)
async function migrateLegacyChatMetaBlob() {
  if (chatMetaBlobMigrated) return;
  chatMetaBlobMigrated = true;
  const legacy = parseChatInboxMeta(settingsCache[CHAT_INBOX_META_KEY] || '');
  const keys = Object.keys(legacy);
  if (!keys.length) return;
  for (const key of keys) {
    if (chatMetaCache[key]) continue;
    chatMetaCache[key] = legacy[key];
    await upsertChatSessionMeta(key, legacy[key]);
  }
  await setSetting(CHAT_INBOX_META_KEY, '');
  settingsCache[CHAT_INBOX_META_KEY] = '';
  console.log(`[chat-meta] migrated ${keys.length} legacy sessions from settings blob`);
}
async function patchChatInboxMeta(sessionId, patch = {}) {
  const key = normalizeChatSessionId(sessionId);
  if (!key) return {};
  const current = chatMetaCache[key] || (await getChatSessionMeta(key)) || {};
  const merged = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  chatMetaCache[key] = merged;
  await upsertChatSessionMeta(key, merged);
  return merged;
}
async function removeChatInboxMeta(sessionId) {
  const key = normalizeChatSessionId(sessionId);
  if (!key) return false;
  delete chatMetaCache[key];
  await deleteChatSessionMeta(key);
  return true;
}
async function markChatSessionRead(sessionId, at = Date.now()) {
  return patchChatInboxMeta(sessionId, { lastReadAt: Number(at || Date.now()) });
}
async function markChatSessionVisitorRead(sessionId, at = Date.now()) {
  return patchChatInboxMeta(sessionId, { visitorLastReadAt: Number(at || Date.now()) });
}
function publicChatMessages(messages = []) {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    id: message?.id || '',
    from: message?.sender === 'admin' ? 'admin' : message?.sender === 'customer' ? 'customer' : 'system',
    text: String(message?.text || ''),
    at: Number(message?.at || 0),
  })).filter((message) => message.text);
}
function sessionSocketId(sessionId) {
  return String(sessions.get(sessionId)?.socketId || '').trim();
}
function chatRealtimeEnabled() {
  return activeProvider === 'supabase' && isSupabaseConfigured({ requireServiceRole: true });
}
function chatRealtimeSessionChannel(sessionId) {
  const normalized = normalizeChatSessionId(sessionId);
  return normalized ? `realtime:chat:${normalized}` : '';
}
async function sendSupabaseBroadcast(channelName, eventName, payload = {}) {
  const channelId = String(channelName || '').trim();
  const event = String(eventName || '').trim();
  if (!chatRealtimeEnabled() || !channelId || !event) return false;
  const env = supabaseEnv();
  const apiUrl = String(env.url || '').trim();
  const serviceRoleKey = String(env.serviceRoleKey || '').trim();
  if (!apiUrl || !serviceRoleKey) return false;
  try {
    const response = await fetch(`${apiUrl}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [{
          topic: channelId,
          event,
          private: false,
          payload: { ...payload, at: Number(payload?.at || Date.now()) },
        }],
      }),
    });
    if (!response.ok) {
      console.error('[chat:realtime] broadcast http fail:', await response.text().catch(() => response.statusText));
      return false;
    }
    return true;
  } catch (err) {
    console.error('[chat:realtime] broadcast fail:', err?.message || err);
    return false;
  }
}
async function emitChatMessageToSession(sessionId, payload) {
  const room = `chat:${normalizeChatSessionId(sessionId)}`;
  io.to(room).emit('chat:message', payload);
  return sendSupabaseBroadcast(chatRealtimeSessionChannel(sessionId), 'admin_message', payload);
}
async function emitAdminInboxUpdate(payload = {}) {
  io.to(ADMIN_INBOX_ROOM).emit('chat:admin:update', { at: Date.now(), ...payload });
  const safePayload = {
    at: Date.now(),
    type: String(payload?.type || '').trim(),
    sessionId: normalizeChatSessionId(payload?.sessionId || ''),
    orderId: String(payload?.orderId || '').trim(),
  };
  return sendSupabaseBroadcast(ADMIN_INBOX_REALTIME_CHANNEL, 'inbox_update', safePayload);
}
async function routeCustomerMessage({ sessionId, name, text, via = 'rest', at = Date.now(), channel = 'web', metaPatch = {} }) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  const clean = String(text || '').trim().slice(0, 1000);
  if (!normalizedSessionId || !clean) return null;
  const visitorName = String(name || '').trim().slice(0, 80) || `ลูกค้า-${normalizedSessionId}`;
  const now = Number(at || Date.now()) || Date.now();
  const currentMeta = chatInboxMetaMap()[normalizedSessionId] || {};
  const effectiveChannel = String(metaPatch.channel || currentMeta.channel || channel || 'web').trim() || 'web';
  const effectiveReplyMode = effectiveChannel === 'line_oa'
    ? normalizeLineChatMode(metaPatch.replyMode || currentMeta.replyMode || (String(channel || '').trim() === 'line_oa' ? lineChatMode() : LINE_CHAT_MODE_REPLY))
    : '';
  const current = sessions.get(normalizedSessionId) || { socketId: '', name: visitorName, lastActiveAt: now };
  current.name = visitorName;
  current.lastActiveAt = now;
  sessions.set(normalizedSessionId, current);
  lastActiveSession = normalizedSessionId;
  await saveMessage(normalizedSessionId, 'customer', clean, now);
  await patchChatInboxMeta(normalizedSessionId, {
    visitorName,
    customerName: metaPatch.customerName || visitorName,
    channel: effectiveChannel,
    channelLabel: lineChannelLabel(effectiveChannel),
    replyMode: effectiveReplyMode || undefined,
    lastCustomerAt: now,
    lastMessageVia: via,
    ...metaPatch,
  });
  await emitAdminInboxUpdate({ type: 'customer_message', sessionId: normalizedSessionId, text: clean, name: visitorName });
  if (effectiveChannel === 'line_oa') return { sessionId: normalizedSessionId, name: visitorName, at: now };
  await pushToAdmin(`[#${normalizedSessionId}] ${visitorName}:\n${clean}\n\n(ตอบกลับ: #${normalizedSessionId} ข้อความ)`);
  return { sessionId: normalizedSessionId, name: visitorName, at: now };
}
async function saveAdminReply(sessionId, text, options = {}) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  const clean = String(text || '').trim().slice(0, 1000);
  if (!normalizedSessionId || !clean) return null;
  const at = Number(options.at || Date.now());
  const meta = chatInboxMetaMap()[normalizedSessionId] || {};
  const channel = String(meta.channel || options.channel || 'web').trim() || 'web';
  const replyMode = channel === 'line_oa' ? lineReplyMode(meta) : LINE_CHAT_MODE_REPLY;
  if (channel === 'line_oa' && replyMode !== LINE_CHAT_MODE_WEB_ROOM) await deliverLineReply(normalizedSessionId, clean, meta);
  await saveMessage(normalizedSessionId, 'admin', clean, at);
  await markChatSessionRead(normalizedSessionId, at);
  await patchChatInboxMeta(normalizedSessionId, {
    lastAdminAt: at,
    lastMessageVia: channel === 'line_oa' && replyMode !== LINE_CHAT_MODE_WEB_ROOM ? 'line_push' : 'admin_reply',
    replyMode: channel === 'line_oa' ? replyMode : undefined,
  });
  await emitChatMessageToSession(normalizedSessionId, { from: 'admin', text: clean, at });
  await emitAdminInboxUpdate({ type: 'admin_message', sessionId: normalizedSessionId, text: clean });
  return { sessionId: normalizedSessionId, text: clean, at };
}
async function resolveSocketAdmin(auth = {}) {
  const adminKey = String(auth?.adminKey || '').trim();
  const cookies = parseCookies(this?.handshake?.headers?.cookie || '');
  const resolved = await resolveAuthenticatedUser({
    token: String(auth?.token || '').trim() || cookies.nfl_session || cookies['__Host-nfl_session'] || '',
    adminKey,
    adminGrant: cookies.nfl_admin || cookies['__Host-nfl_admin'] || '',
  });
  return canAccessAdminInbox(resolved.user) ? resolved.user : null;
}

async function pushToAdmin(text) {
  return pushAdminAlert(text);
}
async function notifyCustomer(order, text) {
  if (!order?.session_id) return;
  await saveAdminReply(order.session_id, text);
}
async function buildPromptPay(amount) {
  const id = cfg('PROMPTPAY_ID'); if (!id) return null;
  const qr = await QRCode.toDataURL(promptPayPayload(id, amount), { width: 280, margin: 1 });
  return { qr, promptpayId: id, name: cfg('PROMPTPAY_NAME'), amount };
}
function hasMatchingSecret(expected, provided) {
  const a = Buffer.from(String(expected || '').trim(), 'utf8');
  const b = Buffer.from(String(provided || '').trim(), 'utf8');
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function newOrderAccessToken() {
  return crypto.randomBytes(24).toString('hex');
}
function orderAccessTokenFromRequest(req) {
  return String(req.query?.access || req.body?.access || req.headers['x-order-access'] || '').trim();
}
function canAccessOrder(req, order) {
  if (!order) return false;
  if (isAdminRole(req.user?.role)) return true;
  if (req.user?.id && order.user_id && req.user.id === order.user_id) return true;
  return hasMatchingSecret(order.accessToken, orderAccessTokenFromRequest(req));
}
function clientOrder(order) {
  if (!order) return null;
  const { accessToken, ...rest } = order;
  return rest;
}
function summarizeOrderLineQty(item = {}) {
  const qty = parseInt(item?.qty, 10) || 0;
  return qty > 0 ? qty : 1;
}
function summarizeOrderItems(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const parts = items
    .slice(0, 3)
    .map((item) => `${String(item?.name || 'สินค้า').trim()}×${summarizeOrderLineQty(item)}`);
  if (items.length > 3) parts.push(`+${items.length - 3} รายการ`);
  return parts.join(', ');
}
function clientAdminOrderSummary(order) {
  if (!order) return null;
  const items = Array.isArray(order.items) ? order.items : [];
  return {
    id: order.id,
    total: Number(order.total || 0),
    payment_method: order.payment_method || '',
    status: order.status || '',
    paid: !!order.paid,
    payment_claimed: !!order.payment_claimed,
    tracking: order.tracking || '',
    createdAt: order.createdAt || order.created_at || 0,
    user_id: order.user_id || '',
    channel: order.channel || 'web',
    line_user_id: order.line_user_id || order.lineUserId || '',
    session_id: order.session_id || '',
    customerName: String(order.customerName ?? order.customer?.name ?? '').trim(),
    customerPhone: String(order.customerPhone ?? order.customer?.phone ?? '').trim(),
    itemCount: Number(order.itemCount || items.reduce((sum, item) => sum + summarizeOrderLineQty(item), 0) || 0),
    itemSummary: String(order.itemSummary || summarizeOrderItems(items)).trim(),
  };
}
async function enrichInboxSessionItem(item = {}) {
  const sessionId = normalizeChatSessionId(item?.session_id || '');
  if (!sessionId) return null;
  const meta = chatInboxMetaMap()[sessionId] || {};
  const linkedOrderRaw = await findLatestOrderBySessionId(sessionId);
  const linkedOrder = linkedOrderRaw ? clientAdminOrderSummary(linkedOrderRaw) : null;
  const lastReadAt = Number(meta.lastReadAt || 0);
  let unreadCount = 0;
  if (Number(item?.last_customer_at || 0) > lastReadAt) {
    const recent = await listMessagesSince(sessionId, lastReadAt);
    unreadCount = recent.filter((message) => message?.sender === 'customer').length;
  }
  return {
    ...item,
    session_id: sessionId,
    channel: String(meta.channel || 'web').trim() || 'web',
    channelLabel: lineChannelLabel(meta.channel || 'web'),
    unreadCount,
    customerName: String(meta.customerName || linkedOrder?.customerName || meta.visitorName || '').trim(),
    customerPhone: String(meta.customerPhone || linkedOrder?.customerPhone || '').trim(),
    customerAvatar: String(meta.customerAvatar || '').trim(),
    lineUserId: String(meta.lineUserId || '').trim(),
    lineGroupId: String(meta.lineGroupId || '').trim(),
    lineRoomId: String(meta.lineRoomId || '').trim(),
    lineStatusMessage: String(meta.lineStatusMessage || '').trim(),
    replyMode: lineReplyMode(meta),
    lineRoomEntryUrl: String(meta.lineRoomEntryUrl || '').trim(),
    lastProductId: String(meta.lastProductId || '').trim(),
    lastProductName: String(meta.lastProductName || '').trim(),
    lastProductUrl: String(meta.lastProductUrl || '').trim(),
    lastProductIntentAt: Number(meta.lastProductIntentAt || 0),
    lastReadAt,
    order: linkedOrder ? {
      id: linkedOrder.id,
      status: linkedOrder.status,
      statusLabel: STATUS_LABEL[linkedOrder.status] || linkedOrder.status || '',
      total: linkedOrder.total,
      createdAt: linkedOrder.createdAt,
      customerName: linkedOrder.customerName,
      customerPhone: linkedOrder.customerPhone,
      itemSummary: linkedOrder.itemSummary,
    } : null,
  };
}
function parseAdminListQuery(req, defaultLimit = 20) {
  const rawLimit = parseInt(req.query.limit, 10);
  const rawPage = parseInt(req.query.page, 10);
  const limit = Math.min(100, Math.max(10, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));
  const page = Math.max(1, Number.isFinite(rawPage) ? rawPage : 1);
  const offset = (page - 1) * limit;
  const search = String(req.query.q || '').trim().slice(0, 80);
  const status = String(req.query.status || '').trim();
  const role = String(req.query.role || '').trim();
  return { page, limit, offset, search, status, role };
}
function pagedAdminResponse({ items = [], page = 1, limit = 20, total = 0 } = {}) {
  const safeTotal = Math.max(0, Number(total || 0));
  const totalPages = Math.max(1, Math.ceil(safeTotal / Math.max(1, limit)));
  return {
    items,
    page,
    limit,
    total: safeTotal,
    totalPages,
    hasPrev: page > 1,
    hasMore: page < totalPages,
  };
}
function slipokConfig() {
  return {
    apiUrl: String(cfg('SLIPOK_API_URL') || '').trim(),
    apiKey: String(cfg('SLIPOK_API_KEY') || '').trim(),
    enabled: Boolean(String(cfg('SLIPOK_API_URL') || '').trim() && String(cfg('SLIPOK_API_KEY') || '').trim()),
  };
}
async function verifySlipWithSlipok({ imageBase64 = '', amount = 0 } = {}) {
  const slipok = slipokConfig();
  if (!slipok.enabled) throw new Error('ยังไม่ได้ตั้งค่า SlipOK');
  const body = { files: String(imageBase64 || '').trim(), log: true };
  if (amount > 0) body.amount = Number(amount);
  const res = await fetch(slipok.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-authorization': slipok.apiKey,
      'User-Agent': 'pod-website/1.0',
    },
    body: JSON.stringify(body),
  });
  let payload = {};
  try { payload = await res.json(); } catch {}
  return { ok: res.ok, payload };
}
function parseSlipUpload(body = {}) {
  const imageBase64 = String(body.imageBase64 || '').trim();
  if (!imageBase64) throw new Error('กรุณาแนบรูปสลิป');
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i.exec(imageBase64);
  if (!m) throw new Error('รูปสลิปต้องเป็นไฟล์ภาพแบบ base64');
  const raw = m[2];
  const buf = Buffer.from(raw, 'base64');
  if (!buf.length) throw new Error('ไฟล์สลิปไม่ถูกต้อง');
  if (buf.length > 8 * 1024 * 1024) throw new Error('รูปสลิปใหญ่เกิน 8MB');
  return { rawBase64: raw, contentType: `image/${m[1].toLowerCase().replace('jpeg', 'jpg')}` };
}
function normalizeSlipokResult(result = {}) {
  const payload = result?.payload && typeof result.payload === 'object' ? result.payload : {};
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const receiver = data?.receiver && typeof data.receiver === 'object' ? data.receiver : {};
  const sender = data?.sender && typeof data.sender === 'object' ? data.sender : {};
  const receiverAccount = receiver?.account?.value || receiver?.proxy?.value || data?.ref1 || '';
  return {
    ok: Boolean(result?.ok),
    verified: Boolean(payload?.success) && Boolean(data?.success),
    code: payload?.code || 0,
    message: data?.message || payload?.message || '',
    amount: data?.amount || 0,
    accountNumber: receiverAccount || '',
    receiverName: receiver?.displayName || receiver?.name || '',
    senderName: sender?.displayName || sender?.name || '',
    transRef: data?.transRef || '',
    transTimestamp: data?.transTimestamp || '',
    raw: payload,
  };
}
function isSlipokManualReviewCode(code) {
  return new Set([1003, 1004, 1006, 1007, 1008, 1009, 1010, 1011, 1015]).has(Number(code));
}
function isSlipokVerificationFailureCode(code) {
  return new Set([1012, 1013, 1014]).has(Number(code));
}
async function createCardCheckoutSession({ id, stripe, base, subtotal, discount, shipping }) {
  const merchTotal = subtotal - discount;
  const line_items = [];
  if (merchTotal > 0) {
    line_items.push({
      price_data: {
        currency: 'thb',
        product_data: { name: `คำสั่งซื้อ ${id}` },
        unit_amount: merchTotal * 100,
      },
      quantity: 1,
    });
  }
  if (shipping > 0) {
    line_items.push({
      price_data: {
        currency: 'thb',
        product_data: { name: 'ค่าจัดส่ง' },
        unit_amount: shipping * 100,
      },
      quantity: 1,
    });
  }
  if (!line_items.length) throw new Error('ยอดชำระด้วยบัตรต้องมากกว่า 0 บาท');
  return stripe.checkout.sessions.create({
    mode: 'payment',
    line_items,
    success_url: `${base}/#/order/${id}`,
    cancel_url: `${base}/#/order/${id}`,
    expires_at: Math.floor((Date.now() + reservationTtlMinutes() * 60000) / 1000),
    metadata: { orderId: id },
  });
}

// ตรวจคูปอง → { ok, discount, coupon, error }
async function evalCoupon(code, subtotal) {
  if (!code) return { ok: true, discount: 0, coupon: '' };
  const c = await getCoupon(code);
  if (!c || !c.active) return { ok: false, error: 'คูปองไม่ถูกต้องหรือถูกปิดใช้งาน' };
  if (c.expiresAt && Date.now() > c.expiresAt) return { ok: false, error: 'คูปองหมดอายุแล้ว' };
  if (c.maxUses && c.used >= c.maxUses) return { ok: false, error: 'คูปองถูกใช้ครบจำนวนแล้ว' };
  if (c.minTotal && subtotal < c.minTotal) return { ok: false, error: `ยอดขั้นต่ำ ฿${c.minTotal.toLocaleString()} จึงใช้คูปองนี้ได้` };
  let discount = c.type === 'percent' ? Math.round(subtotal * c.value / 100) : c.value;
  discount = Math.max(0, Math.min(discount, subtotal));
  return { ok: true, discount, coupon: c.code, type: c.type, value: c.value };
}

// status action ใช้ร่วมกัน (คำสั่ง LINE + หลังบ้าน)
async function applyOrderAction(id, action, tracking = '') {
  const map = {
    paid: { patch: { paid: true, status: 'paid', payment_claimed: false }, note: 'ยืนยันการชำระเงินแล้ว ✅ กำลังเตรียมจัดส่ง' },
    preparing: { patch: { status: 'preparing' }, note: 'ออเดอร์ของคุณกำลังเตรียมสินค้า 📦' },
    shipped: { patch: { status: 'shipped', tracking }, note: `จัดส่งแล้ว 🚚${tracking ? ` เลขพัสดุ: ${tracking}` : ''}` },
    delivered: { patch: { status: 'delivered' }, note: 'จัดส่งสำเร็จแล้ว ขอบคุณที่อุดหนุน 🙏' },
    cancelled: { patch: { status: 'cancelled' }, note: 'ออเดอร์ถูกยกเลิก หากมีข้อสงสัยทักแชทได้เลย' },
    expired: { patch: { status: 'expired', payment_claimed: false }, note: 'ออเดอร์หมดเวลาชำระแล้ว หากยังต้องการสั่งซื้อสามารถสร้างออเดอร์ใหม่ได้' },
  };
  const a = map[action]; if (!a) return null;
  const prev = await getOrder(id); if (!prev) return null;
  let o = await updateOrder(id, a.patch); if (!o) return null;
  if (action === 'cancelled' && prev.status !== 'cancelled' && prev.resourcesReserved) {
    await releaseOrderResources({ items: prev.items, coupon: prev.coupon || '' });
    o = await updateOrder(id, { resources_reserved: false }) || o;
  }
  await notifyCustomer(o, `[ออเดอร์ ${id}] ${a.note}`);
  if (o.customer.email) await sendMail(o.customer.email, `อัปเดตออเดอร์ ${id} · ${STATUS_LABEL[o.status]}`, orderEmailHTML(o, `อัปเดตสถานะ: ${STATUS_LABEL[o.status]}`));
  return o;
}
async function markOrderPaid(id) {
  const o = await getOrder(id); if (!o || o.paid) return;
  const updated = await applyOrderAction(id, 'paid');
  if (updated?.resourcesReserved) await updateOrder(id, { resources_reserved: false });
  await pushToAdmin(`💳 ออเดอร์ ${id} ชำระเงินแล้ว ฿${o.total.toLocaleString()}`);
}
let reservationCleanupPromise = null;
let reservationCleanupAt = 0;
async function cleanupExpiredReservations(force = false) {
  const now = Date.now();
  if (!force && reservationCleanupPromise) return reservationCleanupPromise;
  if (!force && now - reservationCleanupAt < 60000) return 0;
  reservationCleanupAt = now;
  reservationCleanupPromise = (async () => {
    const beforeTs = Date.now() - reservationTtlMinutes() * 60000;
    const expired = await listExpiredOrderReservations(beforeTs, 30);
    let released = 0;
    for (const order of expired) {
      if (order.payment_method === 'card' && order.stripe_session) {
        const stripe = stripeClient();
        if (stripe) {
          try {
            const session = await stripe.checkout.sessions.retrieve(order.stripe_session);
            if (session?.status === 'open') await stripe.checkout.sessions.expire(order.stripe_session);
          } catch (err) {
            console.error('[cleanup] stripe expire fail:', err?.message || err);
          }
        }
      }
      if (order.resourcesReserved) await releaseOrderResources({ items: order.items, coupon: order.coupon || '' });
      await updateOrder(order.id, { status: 'expired', resources_reserved: false, payment_claimed: false });
      released += 1;
    }
    return released;
  })().finally(() => { reservationCleanupPromise = null; });
  return reservationCleanupPromise;
}
async function expireOrderIfNeeded(order) {
  if (!order || order.paid || order.payment_claimed || !order.resourcesReserved || order.status !== 'awaiting_payment') return order;
  if (Date.now() < reservationExpiresAt(order)) return order;
  if (order.payment_method === 'card' && order.stripe_session) {
    const stripe = stripeClient();
    if (stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_session);
        if (session?.status === 'open') await stripe.checkout.sessions.expire(order.stripe_session);
      } catch (err) {
        console.error('[expire-order] stripe expire fail:', err?.message || err);
      }
    }
  }
  await releaseOrderResources({ items: order.items, coupon: order.coupon || '' });
  return updateOrder(order.id, { status: 'expired', resources_reserved: false, payment_claimed: false });
}

async function handleAdminMessage(text) {
  const oc = text.match(/^(ordersddd|orderddd|paidddd|prepareddd|shipddd|doneddd|cancelddd)\b\s*([\s\S]*)$/i);
  if (oc) return handleOrderCommand(oc[1].toLowerCase(), oc[2].trim());
  if (/^listddd\b/i.test(text)) {
    const lines = [...sessions.entries()].map(([id, s]) => `#${id} — ${s.name} (ล่าสุด ${timeAgo(s.lastActiveAt)})`);
    return pushToAdmin(lines.length ? 'ลูกค้าออนไลน์:\n' + lines.join('\n') : 'ยังไม่มีลูกค้าออนไลน์');
  }
  const tagged = text.match(/^#([A-Z0-9]{4,16})\s+([\s\S]+)$/i);
  let sessionId, reply;
  if (tagged) { sessionId = tagged[1].toUpperCase(); reply = tagged[2]; }
  else if (lastActiveSession && sessions.has(lastActiveSession)) { sessionId = lastActiveSession; reply = text; }
  else return pushToAdmin('ตอบไม่ได้ — ใส่รหัสห้องก่อนข้อความ เช่น #7E72D9CF9A สวัสดีครับ\nคำสั่ง: listddd, ordersddd, orderddd <id>, paidddd <id>, prepareddd <id>, shipddd <id> <เลขพัสดุ>, doneddd <id>, cancelddd <id>');
  await saveAdminReply(sessionId, reply);
}
async function handleOrderCommand(cmd, rest) {
  if (cmd === 'ordersddd') {
    const list = await listOrders(15);
    if (!list.length) return pushToAdmin('ยังไม่มีออเดอร์');
    return pushToAdmin('ออเดอร์ล่าสุด:\n' + list.map((o) => `${o.id} · ${STATUS_LABEL[o.status]} · ฿${o.total.toLocaleString()} · ${o.customer.name}${o.payment_claimed && !o.paid ? ' ⚠️แจ้งโอน' : ''}`).join('\n'));
  }
  const parts = rest.split(/\s+/);
  const id = (parts.shift() || '').toUpperCase();
  const order = id && await getOrder(id);
  if (!order) return pushToAdmin(`ไม่พบออเดอร์ ${id || '(ไม่ระบุ)'}\nเช่น: shipddd VYU-AB12CDE TH1234567890`);
  if (cmd === 'orderddd') {
    return pushToAdmin(`${order.id} · ${STATUS_LABEL[order.status]}\n${order.items.map((it) => `• ${it.name} x${it.qty}`).join('\n')}\nรวม ฿${order.total.toLocaleString()} · ${order.payment_method === 'card' ? 'บัตร' : 'PromptPay'}${order.paid ? ' (จ่ายแล้ว)' : ''}\n👤 ${order.customer.name}\n📞 ${order.customer.phone}\n📦 ${order.customer.address}${order.tracking ? `\n🚚 ${order.tracking}` : ''}`);
  }
  const action = { paidddd: 'paid', prepareddd: 'preparing', shipddd: 'shipped', doneddd: 'delivered', cancelddd: 'cancelled' }[cmd];
  const o = await applyOrderAction(id, action, parts.join(' ').trim());
  pushToAdmin(`✓ ${id}: ${STATUS_LABEL[o.status]}${o.tracking ? ` (${o.tracking})` : ''}`);
}

const orderService = createOrderService({
  cfg,
  stripeClient,
  createCardCheckoutSession,
  buildPromptPay,
  reservationExpiresAt,
  listProductsByIds,
  effPrice,
  evalCoupon,
  shippingFor,
  reserveOrderResources,
  releaseOrderResources,
  createOrder,
  getOrder,
  updateOrder,
  getPaymentLog,
  upsertPaymentLog,
  markOrderPaid,
  pushToAdmin,
  sendMail,
  orderEmailHTML,
  siteValue,
  patchChatInboxMeta,
  emitAdminInboxUpdate,
  normalizeChatSessionId,
  newOrderAccessToken,
  verifySlipWithSlipok,
  normalizeSlipokResult,
  isSlipokManualReviewCode,
  isSlipokVerificationFailureCode,
  clientOrder,
  statusLabel: STATUS_LABEL,
});

const { handleLineWebhookRequest } = createLineRuntime({
  crypto,
  lineChannelAccessToken,
  lineChannelSecret,
  listProducts,
  publicBaseUrl,
  lineWebRoomEntryUrl,
  syncLineInboxSession,
  patchChatInboxMeta,
  lineChatMode,
  lineChatModeWebRoom: LINE_CHAT_MODE_WEB_ROOM,
  chatInboxMetaMap,
  routeCustomerMessage,
  emitAdminInboxUpdate,
  listOrders,
  statusLabel: STATUS_LABEL,
  applyOrderAction,
  adminUserId,
  handleAdminMessage,
  ensureSettingsFresh,
  ensureLineWebhookEventIdempotency,
  recordLineWebhookAudit,
  recordSystemEvent,
  createCheckoutOrder: orderService.createCheckoutOrder,
  claimOrderPayment: orderService.claimPayment,
  verifyOrderSlip: orderService.verifyPromptpaySlip,
  buildPromptPayQrUrl(orderId, accessToken) {
    const base = publicBaseUrl();
    const order = String(orderId || '').trim();
    const access = String(accessToken || '').trim();
    if (!base || !order || !access) return '';
    return `${base}/api/orders/${encodeURIComponent(order)}/promptpay-qr?access=${encodeURIComponent(access)}`;
  },
});

app.post('/webhook/line', express.raw({ type: 'application/json' }), handleLineWebhookRequest);
app.post('/api/integrations/line/webhook', express.raw({ type: 'application/json' }), handleLineWebhookRequest);

// ════════════ Stripe Webhook ════════════
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = stripeClient(); const wh = cfg('STRIPE_WEBHOOK_SECRET');
  if (!stripe || !wh) return res.status(200).end();
  let event;
  try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], wh); }
  catch (err) { console.error('[stripe] bad signature:', err.message); return res.status(400).end(); }
  if (event.type === 'checkout.session.completed') {
    const oid = event.data.object.metadata?.orderId;
    if (oid) await markOrderPaid(oid);
  }
  res.status(200).end();
});

// ════════════ JSON + static + auth ════════════
const jsonParser = express.json({ limit: '8mb' });
app.use((req, res, next) => {
  if (req.path === '/webhook/line' || req.path === '/api/integrations/line/webhook' || req.path === '/webhook/stripe') return next();
  return jsonParser(req, res, next);
});
function setSensitiveNoStore(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}
function denyAdminSurface(res) {
  setSensitiveNoStore(res);
  return res.status(404).type('text/plain').send('Not Found');
}
function requireOpaqueAdmin(req, res, next) {
  const allowed = canAccessAdminShell(req.user);
  // #region debug-point C:opaque-admin-gate
  reportServerDebug('C', 'server/index.js:requireOpaqueAdmin', `[DEBUG] opaque admin gate ${allowed ? 'allow' : 'deny'}`, {
    path: req.path,
    method: req.method,
    userId: req.user?.id || '',
    userRole: req.user?.role || '',
    sessionCookiePresent: Boolean(req.cookies?.nfl_session || req.cookies?.['__Host-nfl_session']),
    adminGrantPresent: Boolean(req.cookies?.nfl_admin || req.cookies?.['__Host-nfl_admin']),
    adminKeyAccepted: Boolean(req.adminKeyAccepted),
  });
  // #endregion
  if (!allowed) return denyAdminSurface(res);
  return next();
}
app.use(express.static(publicDir, {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const base = path.basename(filePath).toLowerCase();
    if (base === 'sw.js' || ext === '.html' || ext === '.js' || ext === '.json' || ext === '.map') {
      setSensitiveNoStore(res);
    }
  },
}));
app.use(authMiddleware);
app.use('/api/auth', authLimiter);
app.use('/api/admin', adminLimiter);

app.get(/^\/secure-admin(?:\/.*)?$/, requireOpaqueAdmin, (_req, res) => {
  setSensitiveNoStore(res);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  // #region debug-point D:secure-admin-serve
  reportServerDebug('D', 'server/index.js:/secure-admin', '[DEBUG] secure-admin shell served', {
    fileExists: fs.existsSync(adminHtmlFile),
    assetExists: fs.existsSync(adminClientFile),
  });
  // #endregion
  res.sendFile(adminHtmlFile);
});
app.get('/api/admin/client/app.js', requireOpaqueAdmin, (_req, res) => {
  setSensitiveNoStore(res);
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
  res.type('application/javascript');
  res.sendFile(adminClientFile);
});

app.get('/api/health', (_req, res) => res.json(buildHealthSnapshot()));

// ──────────── LINE OA bridge callback (admin reply -> website widget) ────────────
// The bot POSTs here when the LINE OA admin replies `#<sessionId> text`.
app.post('/api/webhooks/lineoa-bridge', async (req, res) => {
  if (!lineBridgeCompatEnabled()) return res.status(410).json({ error: 'legacy_lineoa_bridge_disabled' });
  if (!verifyBridgeRequest(req, cfg)) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const sessionId = normalizeChatSessionId(b.website_session_id || b.session_id || '');
  const text = String(b.message?.content || b.text || '').trim();
  if (!sessionId || !text) return res.status(400).json({ error: 'missing session or text' });
  const delivered = await saveAdminReply(sessionId, text);
  res.json({ ok: true, delivered: true, live: Boolean(sessionSocketId(sessionId)), message: delivered });
});
app.post('/api/webhooks/lineoa-customer-bridge', async (req, res) => {
  if (!lineBridgeCompatEnabled()) return res.status(410).json({ error: 'legacy_lineoa_bridge_disabled' });
  if (!verifyBridgeRequest(req, cfg)) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const lineUserId = String(b.line_user_id || b.message?.metadata?.line_user_id || '').trim();
  const lineDisplayName = String(b.line_display_name || '').trim();
  const text = String(b.message?.content || b.text || '').trim();
  const at = Number(b.message?.created_at || b.at || Date.now()) || Date.now();
  if (!lineUserId || !text) return res.status(400).json({ error: 'missing line_user_id or text' });

  const synced = await syncLineInboxSession({ type: 'user', userId: lineUserId }, {
    at,
    displayName: lineDisplayName,
    customerName: lineDisplayName,
    eventType: 'message',
    messageType: 'text',
    metaPatch: {
      channel: 'line_oa',
      channelLabel: lineChannelLabel('line_oa'),
      lineUserId,
      bridgeId: String(b.bridge_id || '').trim(),
      bridgeSource: 'lineoa_bot',
    },
  });
  if (!synced?.sessionId) return res.status(400).json({ error: 'unable to resolve line session' });

  const message = await routeCustomerMessage({
    sessionId: synced.sessionId,
    name: synced.displayName || lineDisplayName || `LINE-${lineUserId.slice(-6)}`,
    text,
    via: 'lineoa_bridge',
    at,
    channel: 'line_oa',
    metaPatch: synced.metaPatch,
  });
  res.json({ ok: true, sessionId: synced.sessionId, message });
});
app.get('/api/integrations/line/chat-mode', async (req, res) => {
  if (!lineBridgeCompatEnabled()) return res.status(410).json({ error: 'legacy_lineoa_bridge_disabled' });
  if (!verifyBridgeRequest(req, cfg)) return res.status(401).json({ error: 'unauthorized' });
  await ensureSettingsFresh();
  const mode = lineChatMode();
  res.json({
    ok: true,
    mode,
    publicUrl: publicBaseUrl(),
    webRoomPath: lineWebChatPath(),
    webRoomEnabled: Boolean(publicBaseUrl() && lineWebRoomTokenSecret()),
  });
});
app.post('/api/integrations/line/web-room-link', async (req, res) => {
  if (!lineBridgeCompatEnabled()) return res.status(410).json({ error: 'legacy_lineoa_bridge_disabled' });
  if (!verifyBridgeRequest(req, cfg)) return res.status(401).json({ error: 'unauthorized' });
  await ensureSettingsFresh();
  const lineUserId = String(req.body?.line_user_id || '').trim();
  const displayName = String(req.body?.line_display_name || '').trim();
  if (!lineUserId) return res.status(400).json({ error: 'missing line_user_id' });
  if (!publicBaseUrl()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า PUBLIC_URL สำหรับเปิดห้องแชตเว็บ' });
  if (!lineWebRoomTokenSecret()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า LINEOA_API_SECRET หรือ secret สำหรับสร้างลิงก์ห้องเว็บ' });
  const synced = await syncLineInboxSession(
    { type: 'user', userId: lineUserId },
    {
      displayName,
      metaPatch: {
        replyMode: LINE_CHAT_MODE_WEB_ROOM,
        lineRoomEnabled: true,
        lineRoomLinkedAt: Date.now(),
        lineEntrySource: 'lineoa_bot',
      },
    }
  );
  if (!synced?.sessionId) return res.status(400).json({ error: 'unable to resolve line session' });
  const entryUrl = lineWebRoomEntryUrl({
    sessionId: synced.sessionId,
    lineUserId,
    customerName: synced.displayName || displayName,
    replyMode: LINE_CHAT_MODE_WEB_ROOM,
  });
  await patchChatInboxMeta(synced.sessionId, {
    replyMode: LINE_CHAT_MODE_WEB_ROOM,
    lineRoomEntryUrl: entryUrl,
    lineRoomLinkedAt: Date.now(),
  });
  res.json({
    ok: true,
    mode: LINE_CHAT_MODE_WEB_ROOM,
    sessionId: synced.sessionId,
    customerName: synced.displayName || displayName,
    entryUrl,
  });
});
app.get('/api/line/web-room-entry/:token', async (req, res) => {
  await ensureSettingsFresh();
  const payload = parseLineWebRoomToken(req.params.token || '');
  if (!payload) return res.status(400).json({ error: 'ลิงก์ห้องแชตหมดอายุหรือไม่ถูกต้อง' });
  const sessionId = normalizeChatSessionId(payload.sessionId || '');
  const lineUserId = String(payload.lineUserId || '').trim();
  const customerName = String(payload.customerName || '').trim();
  if (!sessionId || !lineUserId) return res.status(400).json({ error: 'ข้อมูลห้องแชตไม่ครบถ้วน' });
  await patchChatInboxMeta(sessionId, {
    channel: 'line_oa',
    channelLabel: lineChannelLabel('line_oa'),
    lineUserId,
    customerName: customerName || `LINE-${lineUserId.slice(-6)}`,
    visitorName: customerName || `LINE-${lineUserId.slice(-6)}`,
    replyMode: LINE_CHAT_MODE_WEB_ROOM,
    lineRoomLastEnterAt: Date.now(),
  });
  res.json({
    ok: true,
    sessionId,
    lineUserId,
    customerName: customerName || `LINE-${lineUserId.slice(-6)}`,
    replyMode: LINE_CHAT_MODE_WEB_ROOM,
  });
});

// ──────────── Live Chat (serverless-friendly: POST send + GET poll) ────────────
// แทน Socket.IO บน Vercel — visitor ส่งข้อความ + poll คำตอบแอดมินจาก LINE
const chatLimiter = rateLimit({ windowMs: 60000, max: 60 });
const chatPollLimiter = rateLimit({ windowMs: 60000, max: 60 });
app.post('/api/chat/send', chatLimiter, async (req, res) => {
  const b = req.body || {};
  let sessionId = normalizeChatSessionId(b.sessionId || b.session_id || b.website_session_id || '');
  if (!CHAT_SESSION_ID_RE.test(sessionId)) sessionId = makeChatSessionId();
  const text = String(b.text || '').trim().slice(0, 1000);
  const name = String(b.name || '').trim().slice(0, 40) || `ลูกค้า-${sessionId}`;
  const at = Number(b.at || Date.now()) || Date.now();
  if (!text) return res.status(400).json({ error: 'ไม่มีข้อความ' });
  const message = await routeCustomerMessage({ sessionId, name, text, via: 'rest', at });
  res.json({ ok: true, sessionId, message: { from: 'customer', text, at: message?.at || at } });
});
app.get('/api/chat/history', chatPollLimiter, async (req, res) => {
  const sessionId = normalizeChatSessionId(req.query.session || '');
  const limit = Math.min(300, Math.max(1, parseInt(req.query.limit, 10) || 200));
  if (!sessionId) return res.json({ sessionId: '', messages: [], now: Date.now() });
  const messages = publicChatMessages(await listChatMessages(sessionId, limit));
  res.json({ sessionId, messages, now: Date.now() });
});
app.post('/api/chat/read', chatLimiter, async (req, res) => {
  const b = req.body || {};
  const sessionId = normalizeChatSessionId(b.sessionId || b.session_id || b.website_session_id || '');
  const at = Number(b.at || Date.now()) || Date.now();
  if (!sessionId) return res.json({ ok: true });
  await markChatSessionVisitorRead(sessionId, at);
  res.json({ ok: true, sessionId, at });
});
app.get('/api/chat/poll', chatPollLimiter, async (req, res) => {
  const sessionId = normalizeChatSessionId(req.query.session || '');
  const after = parseInt(req.query.after, 10) || 0;
  if (!sessionId) return res.json({ messages: [], now: Date.now() });
  const rows = await listMessagesSince(sessionId, after);
  // ส่งกลับเฉพาะข้อความที่ไม่ใช่ของ visitor เอง (คำตอบแอดมิน/ระบบ)
  const messages = rows.filter((m) => m.sender !== 'customer').map((m) => ({ from: m.sender, text: m.text, at: m.at }));
  res.json({ messages, now: Date.now() });
});

// ──────────── site branding (public) ────────────
const SITE_DEFAULTS = {
  SITE_NAME: 'นุชฟอร์ไลฟ์',
  SITE_TAGLINE: 'นวัตกรรมเพื่อเกษตรกรไทย',
  SITE_ANNOUNCE: 'อาหารเสริมพืช · ฮอร์โมน · สารจับใบ · สมุนไพรสุขภาพ · จัดส่งทั่วไทย',
  SITE_PRODUCT_CATEGORIES: '["สินค้าเดี่ยว","ชุดเซต","โปรโมชั่น","สุขภาพ","ความงาม"]',
  SITE_HERO_TITLE: 'เพิ่มผลผลิต',
  SITE_HERO_ACCENT: 'อย่างแม่นยำ',
  SITE_HERO_TITLE2: 'ด้วยสูตรที่เหมาะกับพืช',
  SITE_HERO_SUB: 'ช่วยเกษตรกรเลือกสูตรที่ใช่ตามชนิดพืช ปัญหา และช่วงการเติบโต พร้อมจัดส่งไวและมีนักวิชาการให้คำแนะนำผ่าน LINE และ Live Chat',
  SITE_FOOTER: '© จูนนุชฟอร์ไลฟ์ · ผลิตภัณฑ์เพื่อการเกษตรและสุขภาพ · จัดส่งทั่วไทย',
  SITE_HOME_FEATURED_EYEBROW: 'สินค้าแนะนำ',
  SITE_HOME_FEATURED_TITLE: 'รวมชุดเซตและโปรโมชันพิเศษให้ดูง่ายในจุดเดียว',
  SITE_HOME_CROP_EYEBROW: 'สูตรตามพืช',
  SITE_HOME_CROP_TITLE: 'กดเข้าหน้าเฉพาะพืชได้ทันที',
  SITE_HOME_CONSULT_EYEBROW: 'ขอคำแนะนำเร็ว',
  SITE_HOME_CONSULT_TITLE: 'กรอกสั้น ๆ แล้วให้คุณจูนช่วยเลือกสูตรต่อ',
  SITE_HOME_CONSULT_BODY: 'กรอกเฉพาะข้อมูลหลักก่อนก็พอ หรือถ้าไม่สะดวกกรอกฟอร์ม โทรหรือทัก LINE ได้ทันที คุณจูนช่วยอธิบายให้แบบง่าย ๆ',
  SITE_HOME_CONTACT_TITLE: 'ไม่ต้องกรอกฟอร์มก็ได้',
  SITE_HOME_CONTACT_BODY: 'โทรหรือทัก LINE ได้ทันที เหมาะกับลูกค้าที่ใช้มือถือเป็นหลักและอยากคุยกับคนจริงก่อนตัดสินใจ',
  SITE_HOME_CONTACT_NOTE: 'สั่งซื้อ สอบถาม และดูข้อมูลต่าง ๆ แบบเรียลไทม์ได้ทันที ถ้าไม่แน่ใจว่าจะเริ่มตรงไหน โทรหรือทักไลน์ได้เลย',
  SITE_HOME_CONTACT_CALL_PRIMARY_LABEL: 'โทรหาคุณจูน',
  SITE_HOME_CONTACT_CALL_SECONDARY_LABEL: 'โทรหาเบอร์ร้าน',
  SITE_HOME_CONTACT_PERSONAL_LABEL: 'LINE ส่วนตัว',
  SITE_HOME_CONTACT_OA_LABEL: 'ทัก LINE OA ตอนนี้',
  CONTACT_PRIMARY_LABEL: 'คุณจูน นุชฟอร์ไลฟ์',
  CONTACT_PRIMARY_PHONE: '0924842250',
  CONTACT_SECONDARY_LABEL: 'เบอร์ร้าน / คุณจูน',
  CONTACT_SECONDARY_PHONE: '0851239829',
  CONTACT_LINE_ID: '0924842250',
  CONTACT_LINE_PERSONAL_URL: 'https://line.me/ti/p/~0924842250',
  CONTACT_LINE_OA_ID: '@221fmmrs',
  SITE_DOCK_TITLE: 'ไม่ต้องกรอกฟอร์มก็ได้',
  SITE_DOCK_BODY: 'โทรหาคุณจูนผู้มีประสบการณ์ด้านเกษตรกว่า 10 ปี หรือทัก LINE ได้ทันที',
  SITE_DOCK_LIVECHAT_LABEL: 'LIVECHAT',
  SITE_DOCK_CALL_LABEL: 'โทรเลย',
  SITE_DOCK_PERSONAL_LABEL: 'LINE คุณจูน',
  SITE_DOCK_OA_LABEL: 'LINE OA',
  SITE_TRUST_ITEMS: 'แนะนำสูตรตามพืชและช่วงการปลูกได้ชัดเจน\nมีฉลาก วิธีใช้ อัตราผสม และ FAQ ให้เปิดดูบนหน้าเว็บ\nปรึกษาคุณจูนฟรีก่อนซื้อและตามต่อใน LINE ได้\nสั่งซื้อออนไลน์ ติดตามออเดอร์ และเช็กสถานะได้หลังชำระเงิน',
  SITE_CASE_STUDIES: 'สวนทุเรียนและมะม่วง :: ใช้หน้าเฉพาะพืชเพื่อพาลูกค้าจากโฆษณาไปยังสูตรที่ตรงกับปัญหาจริงของสวน\nทีมขายเกษตร :: เก็บชื่อ เบอร์ พืช จังหวัด และปัญหาของลูกค้าไว้โทรกลับและปิดต่อใน LINE ได้ง่าย\nหน้าสินค้าเกษตร :: ลูกค้าเห็นวิธีใช้ อัตราผสม คำเตือน และ FAQ ก่อนตัดสินใจสั่งซื้อ',
  SITE_CHECKOUT_POINTS: 'รองรับการชำระเงินผ่าน PromptPay และบัตรเครดิต\nลูกค้าทัก LINE หรือกรอกฟอร์มเพื่อขอคำแนะนำก่อนซื้อได้\nหลังสั่งซื้อสามารถติดตามสถานะออเดอร์และเลขพัสดุได้จากเว็บไซต์',
  SITE_CROP_LANDING_DATA: '',
  SITE_CALC_KNOWLEDGE: '',
  // จัดส่ง (บาท)
  SHIP_HOME: 'ไทย',
  SHIP_FEE: '50',
  SHIP_INTL_FEE: '350',
  SHIP_FREE_OVER: '1500',
  // Flash sale
  SALE_ACTIVE: '',          // '1' = เปิด
  SALE_PERCENT: '0',
  SALE_ENDS: '',            // ISO datetime
  SALE_TEXT: 'FLASH SALE ⚡',
  LINE_OA_URL: '',
  GA4_ID: '',
  META_PIXEL_ID: '',
  TIKTOK_PIXEL_ID: '',
  // สถิติหน้า "เกี่ยวกับเรา" — ใส่ตัวเลขเอง หรือใส่ 'auto' เพื่อให้คำนวณจากข้อมูลจริง
  SITE_STAT_FARMERS: '20000',   // baseline เกษตรกรเดิมก่อนเอาข้อมูลในระบบมารวม
  SITE_STAT_PRODUCTS: 'auto',   // ผลิตภัณฑ์ (auto = นับสินค้าที่เปิดขายจริง)
  SITE_STAT_RATING: 'auto',     // คะแนนเฉลี่ย (auto = เฉลี่ยรีวิวจริง)
  SITE_STAT_ONTIME: '99',       // fallback % หากยังไม่มีฐานข้อมูลส่งจริง
  SITE_STAT_ONTIME_BASE_TOTAL: '0',   // baseline จำนวนออเดอร์ส่งสำเร็จเดิม
  SITE_STAT_ONTIME_BASE_ONTIME: '0',  // baseline จำนวนออเดอร์ที่ส่งตรงเวลาเดิม
  SITE_STAT_ONTIME_TARGET_DAYS: '7',  // นับว่าส่งตรงเวลาหากส่งสำเร็จภายในกี่วัน
};
const SITE_KEYS = Object.keys(SITE_DEFAULTS);
const SITE_HEAVY_KEYS = ['SITE_CROP_LANDING_DATA', 'SITE_CALC_KNOWLEDGE'];
const SITE_PUBLIC_KEYS = SITE_KEYS.filter((key) => !SITE_HEAVY_KEYS.includes(key));
function siteValue(k) { return settingsCache[k] || SITE_DEFAULTS[k]; }
const siteConfig = () => Object.fromEntries(SITE_KEYS.map((k) => [k, siteValue(k)]));
const sitePublicConfig = () => Object.fromEntries(SITE_PUBLIC_KEYS.map((k) => [k, siteValue(k)]));
const siteHeavyConfig = () => Object.fromEntries(SITE_HEAVY_KEYS.map((k) => [k, siteValue(k)]));
function siteRealtimeConfig() {
  const env = supabaseEnv();
  return {
    SUPABASE_URL: String(env.url || '').trim(),
    SUPABASE_PUBLISHABLE_KEY: String(env.publishableKey || '').trim(),
    CHAT_REALTIME_MODE: chatRealtimeEnabled() ? 'supabase-broadcast' : (isServerless ? 'polling' : 'socket'),
  };
}
const REVIEW_GALLERY_OVERRIDES_KEY = 'SITE_REVIEW_GALLERY_OVERRIDES';
let siteStatsCache = null;
let siteStatsCacheAt = 0;
let siteStatsCachePromise = null;
const SITE_STATS_CACHE_TTL_MS = isServerless ? 180000 : 120000;

function readReviewGallerySource() {
  if (!fs.existsSync(reviewGalleryFile)) {
    return { updatedAt: '', total: 0, duplicatesRemoved: 0, duplicates: [], items: [] };
  }
  const parsed = safeParseJson(fs.readFileSync(reviewGalleryFile, 'utf8'), null);
  if (!parsed || !Array.isArray(parsed.items)) {
    return { updatedAt: '', total: 0, duplicatesRemoved: 0, duplicates: [], items: [] };
  }
  return {
    updatedAt: String(parsed.updatedAt || ''),
    total: Math.max(0, parseInt(parsed.total, 10) || parsed.items.length || 0),
    duplicatesRemoved: Math.max(0, parseInt(parsed.duplicatesRemoved, 10) || 0),
    duplicates: Array.isArray(parsed.duplicates) ? parsed.duplicates : [],
    items: parsed.items,
  };
}
function reviewOverrideKey(item = {}) {
  return String(item.hash || '').trim().toUpperCase() || String(item.sourceName || '').trim();
}
function parseReviewGalleryOverrides(raw = '') {
  const parsed = safeParseJson(raw, []);
  const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.items) ? parsed.items : []);
  return list.map((item) => ({
    hash: String(item?.hash || '').trim().toUpperCase(),
    sourceName: String(item?.sourceName || '').trim(),
    title: String(item?.title || '').trim(),
    note: String(item?.note || '').trim(),
    badge: String(item?.badge || '').trim(),
    spotlight: item?.spotlight === true,
  })).filter((item) => reviewOverrideKey(item));
}
function sanitizeReviewGalleryItem(base = {}, override = {}, index = 0) {
  const normalizeReviewTitle = (value = '') => {
    const title = String(value || '').trim();
    return title === 'ผลงานจริงจากลูกค้าที่ไว้วางใจนุชฟอร์ไลฟ์'
      ? 'ผลงานจริงจากลูกค้าที่ไว้วางใจของคุณจูน'
      : title;
  };
  return {
    id: String(base.id || `review-${index + 1}`),
    image: String(base.image || '').trim(),
    title: normalizeReviewTitle(override.title || base.title || `รีวิวจากลูกค้า ${index + 1}`),
    note: String(override.note || base.note || 'ภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์').trim(),
    badge: String(override.badge || base.badge || 'รีวิวจากผู้ใช้จริง').trim(),
    sourceName: String(base.sourceName || '').trim(),
    hash: String(base.hash || '').trim().toUpperCase(),
    spotlight: override.spotlight === true || base.spotlight === true,
  };
}
function mergedReviewGalleryData() {
  const source = readReviewGallerySource();
  const overrideMap = new Map(parseReviewGalleryOverrides(settingsCache[REVIEW_GALLERY_OVERRIDES_KEY] || '').map((item) => [reviewOverrideKey(item), item]));
  const items = source.items.map((base, index) => sanitizeReviewGalleryItem(base, overrideMap.get(reviewOverrideKey(base)) || {}, index)).filter((item) => item.image);
  let spotlightRank = 0;
  items.forEach((item) => {
    if (item.spotlight) {
      spotlightRank += 1;
      item.spotlightRank = spotlightRank;
    } else {
      item.spotlightRank = 0;
    }
  });
  return {
    updatedAt: source.updatedAt,
    total: items.length,
    duplicatesRemoved: source.duplicatesRemoved,
    duplicates: source.duplicates,
    items,
  };
}
function serializeReviewGalleryOverrides(items = []) {
  return JSON.stringify(items.map((item) => ({
    hash: String(item?.hash || '').trim().toUpperCase(),
    sourceName: String(item?.sourceName || '').trim(),
    title: String(item?.title || '').trim(),
    note: String(item?.note || '').trim(),
    badge: String(item?.badge || '').trim(),
    spotlight: item?.spotlight === true,
  })).filter((item) => reviewOverrideKey(item)), null, 2);
}

function normalizeEmail(value = '') {
  const email = String(value || '').trim().toLowerCase();
  return email.includes('@') ? email : '';
}
function normalizePhone(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  return digits.length >= 8 ? digits : '';
}
function normalizeLineId(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '');
}
function normalizeName(value = '') {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function safeParseJson(raw, fallback) {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}
function recordIdentity(...candidates) {
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}
function orderDeliveredOnTime(order, targetDays) {
  const createdAt = Number(order?.createdAt || 0);
  const updatedAt = Number(order?.updatedAt || 0);
  if (!createdAt || !updatedAt || updatedAt < createdAt) return false;
  return (updatedAt - createdAt) <= Math.max(1, targetDays) * 86400000;
}
async function computeFarmersHybridTotal(baseValue) {
  const [orders, leads, users] = await Promise.all([listOrderIdentityRows(), listLeadIdentityRows(), listUserIdentityRows()]);
  const seen = new Set();
  for (const lead of leads) {
    const id = recordIdentity(normalizePhone(lead.phone), `line:${normalizeLineId(lead.line_id)}`, `lead:${normalizeName(lead.name)}|${normalizeName(lead.province)}`);
    if (id) seen.add(id);
  }
  for (const user of users) {
    if (String(user?.role || '').trim() === 'admin') continue;
    const id = recordIdentity(`email:${normalizeEmail(user.email)}`, `user:${String(user.id || '').trim()}`);
    if (id) seen.add(id);
  }
  for (const order of orders) {
    if (['cancelled', 'expired'].includes(String(order?.status || '').trim())) continue;
    const customer = order?.customer || {};
    const id = recordIdentity(normalizePhone(customer.phone), `email:${normalizeEmail(customer.email)}`, `name:${normalizeName(customer.name)}|${normalizeName(customer.country || customer.address)}`);
    if (id) seen.add(id);
  }
  return Math.max(0, Math.round(baseValue)) + seen.size;
}
async function computeOnTimeHybridRate() {
  const fallbackRate = Math.min(100, Math.max(0, parseFloat(siteValue('SITE_STAT_ONTIME')) || 0));
  const baseTotal = Math.max(0, Math.round(parseFloat(siteValue('SITE_STAT_ONTIME_BASE_TOTAL')) || 0));
  const baseOnTimeInput = parseFloat(siteValue('SITE_STAT_ONTIME_BASE_ONTIME'));
  const baseOnTime = Math.max(0, Math.round(Number.isFinite(baseOnTimeInput) ? baseOnTimeInput : (baseTotal * fallbackRate / 100)));
  const targetDays = Math.max(1, Math.round(parseFloat(siteValue('SITE_STAT_ONTIME_TARGET_DAYS')) || 7));
  const delivered = await listDeliveredOrderTimingRows();
  const actualDelivered = delivered.length;
  const actualOnTime = delivered.filter((order) => orderDeliveredOnTime({ createdAt: order.created_at, updatedAt: order.updated_at }, targetDays)).length;
  const totalDelivered = baseTotal + actualDelivered;
  if (!totalDelivered) return Math.round(fallbackRate);
  return Math.min(100, Math.max(0, Math.round(((baseOnTime + actualOnTime) / totalDelivered) * 100)));
}

// คำนวณตัวเลขสถิติหน้าเกี่ยวกับเรา — รองรับ 'auto' (คำนวณจากข้อมูลจริง) หรือเลขที่ตั้งเอง
async function computeSiteStats() {
  const cacheFresh = siteStatsCache && (Date.now() - siteStatsCacheAt) < SITE_STATS_CACHE_TTL_MS;
  if (cacheFresh) return siteStatsCache;
  if (siteStatsCachePromise) return siteStatsCachePromise;
  siteStatsCachePromise = (async () => {
  const manual = (k, fb) => { const n = parseFloat(siteValue(k)); return Number.isFinite(n) ? n : fb; };
  const farmersBase = manual('SITE_STAT_FARMERS', 0);
  let products = manual('SITE_STAT_PRODUCTS', 0);
  let rating = manual('SITE_STAT_RATING', 0);
  let farmers = farmersBase;
  let ontime = Math.min(100, Math.max(0, Math.round(manual('SITE_STAT_ONTIME', 0))));
  if (siteValue('SITE_STAT_PRODUCTS') === 'auto') products = await countProducts(false);
  if (siteValue('SITE_STAT_RATING') === 'auto') {
    const stats = await allReviewStats();
    let sum = 0, cnt = 0;
    for (const s of Object.values(stats)) { sum += (s.avg || 0) * (s.count || 0); cnt += (s.count || 0); }
    rating = cnt ? Math.round((sum / cnt) * 10) / 10 : 5.0;   // ยังไม่มีรีวิว → แสดง 5.0
  }
  farmers = await computeFarmersHybridTotal(farmersBase);
  ontime = await computeOnTimeHybridRate();
  const result = {
    farmers: Math.max(0, Math.round(farmers)),
    products: Math.max(0, Math.round(products)),
    rating: Math.min(5, Math.max(0, rating)),
    ontime: Math.min(100, Math.max(0, Math.round(ontime))),
  };
  siteStatsCache = result;
  siteStatsCacheAt = Date.now();
  return result;
  })().finally(() => { siteStatsCachePromise = null; });
  return siteStatsCachePromise;
}
app.get('/api/site', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const productCategories = await resolvedPublicProductCategories();
  res.json({
    ...sitePublicConfig(),
    ...siteRealtimeConfig(),
    SITE_PRODUCT_CATEGORIES: JSON.stringify(productCategories),
    stats: await computeSiteStats(),
  });
});
app.get('/api/site/content', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(siteHeavyConfig());
});
app.get('/api/reviews/gallery', async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(mergedReviewGalleryData());
});

// ── flash sale / shipping / email helpers ──
function saleConfig() {
  const active = siteValue('SALE_ACTIVE') === '1';
  const pct = Math.max(0, Math.min(90, parseInt(siteValue('SALE_PERCENT'), 10) || 0));
  const ends = siteValue('SALE_ENDS') ? Date.parse(siteValue('SALE_ENDS')) : 0;
  const live = active && pct > 0 && (!ends || ends > Date.now());
  return { active: live, percent: pct, ends: ends || 0, text: siteValue('SALE_TEXT') };
}
function effPrice(p) {
  const s = saleConfig();
  const manual = resolveManualProductCurrentPrice(p);
  if (manual > 0) return manual;
  return s.active ? Math.max(1, Math.round(p.price * (1 - s.percent / 100))) : p.price;
}
function normalizeProductSalePriceValue(value) {
  const amount = parseInt(value, 10) || 0;
  return amount > 0 ? amount : 0;
}
function resolveManualProductPricePair(product = {}) {
  const base = Math.max(0, parseInt(product?.price, 10) || 0);
  const candidates = [product?.salePrice, product?.comparePrice, product?.extra?.salePrice, product?.extra?.comparePrice]
    .map((value) => normalizeProductSalePriceValue(value))
    .filter(Boolean);
  const rawAlt = candidates.find((value) => value !== base) || candidates[0] || 0;
  if (!base && !rawAlt) return { current: 0, compare: 0 };
  if (!rawAlt || rawAlt === base) return { current: base || rawAlt, compare: 0 };
  return { current: Math.min(base, rawAlt), compare: Math.max(base, rawAlt) };
}
function resolveManualProductCurrentPrice(product = {}) {
  return resolveManualProductPricePair(product).current;
}
function resolveManualProductComparePrice(product = {}) {
  return resolveManualProductPricePair(product).compare;
}
function resolvePublicProductSalePrice(product = {}) {
  const pair = resolveManualProductPricePair(product);
  if (pair.compare > pair.current) return pair.current;
  const flash = effPrice(product);
  return flash > 0 && flash < (parseInt(product?.price, 10) || 0) ? flash : 0;
}
function shippingFor(country, amount) {
  const home = (siteValue('SHIP_HOME') || 'ไทย').trim();
  const freeOver = parseInt(siteValue('SHIP_FREE_OVER'), 10) || 0;
  if (freeOver && amount >= freeOver) return 0;
  const isHome = !country || country.trim() === home;
  return parseInt(isHome ? siteValue('SHIP_FEE') : siteValue('SHIP_INTL_FEE'), 10) || 0;
}
function mailConfigured() { return Boolean(cfg('SMTP_HOST') && cfg('SMTP_USER')); }
function mailer() {
  if (!mailConfigured()) return null;
  const port = parseInt(cfg('SMTP_PORT'), 10) || 587;
  return nodemailer.createTransport({ host: cfg('SMTP_HOST'), port, secure: port === 465, auth: { user: cfg('SMTP_USER'), pass: cfg('SMTP_PASS') } });
}
async function sendMail(to, subject, html) {
  const t = mailer(); if (!t || !to) return;
  try { await t.sendMail({ from: cfg('SMTP_FROM') || cfg('SMTP_USER'), to, subject, html }); }
  catch (err) { console.error('[mail] ส่งไม่สำเร็จ:', err.message); }
}
const PRODUCT_CATEGORY_ALIAS_MAP = {
  เกษตร: 'สินค้าเดี่ยว',
  สินค้าเดี่ยว: 'สินค้าเดี่ยว',
  แพ็กคู่: 'ชุดเซต',
  แพ็กโปร: 'ชุดเซต',
  แพ็กสุดคุ้ม: 'ชุดเซต',
  ชุดแพ็ก: 'ชุดเซต',
  ชุดเซต: 'ชุดเซต',
  โปรแรง: 'โปรโมชั่น',
  โปรโมชัน: 'โปรโมชั่น',
  โปรโมชั่น: 'โปรโมชั่น',
  สุขภาพ: 'สุขภาพ',
  ความงาม: 'ความงาม',
};
const PRODUCT_STRUCTURAL_TAGS = new Set(['เกษตร', 'สินค้าเดี่ยว', 'ชุดแพ็ก', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม']);
function normalizeProductCategoryValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return PRODUCT_CATEGORY_ALIAS_MAP[text] || text;
}
function normalizeProductTagValue(value = '') {
  const text = String(value || '').trim();
  if (!text || PRODUCT_STRUCTURAL_TAGS.has(text)) return '';
  return text;
}
function inferProductCategoryValue({ extra = {}, category = '', tag = '', segment = 'agri' } = {}) {
  const explicit = normalizeProductCategoryValue(extra?.category || category || '');
  if (explicit) return explicit;
  const tagText = normalizeProductCategoryValue(tag || '');
  if (tagText) return tagText;
  return segment === 'lifestyle' ? 'สุขภาพ' : 'สินค้าเดี่ยว';
}
function ensureProductCategoryExtra(extra = {}, source = {}) {
  const next = (extra && typeof extra === 'object' && !Array.isArray(extra)) ? { ...extra } : {};
  next.category = inferProductCategoryValue({ extra: next, category: source.category, tag: source.tag, segment: source.segment });
  const rawAlt = normalizeProductSalePriceValue(next.salePrice ?? next.comparePrice ?? source?.salePrice ?? source?.comparePrice);
  delete next.salePrice;
  if (rawAlt) next.comparePrice = rawAlt;
  else delete next.comparePrice;
  return next;
}
function canonicalizeProductPricingPayload(payload = {}, fallback = {}) {
  const rawPrice = payload.price !== undefined ? payload.price : fallback.price;
  const rawExtra = (payload.extra && typeof payload.extra === 'object' && !Array.isArray(payload.extra))
    ? payload.extra
    : ((fallback.extra && typeof fallback.extra === 'object' && !Array.isArray(fallback.extra)) ? fallback.extra : {});
  const pair = resolveManualProductPricePair({
    ...fallback,
    ...payload,
    price: normalizeProductSalePriceValue(rawPrice),
    extra: rawExtra,
  });
  const nextExtra = { ...rawExtra };
  delete nextExtra.salePrice;
  delete nextExtra.comparePrice;
  if (pair.compare > pair.current) nextExtra.comparePrice = pair.compare;
  return {
    price: pair.current || normalizeProductSalePriceValue(rawPrice),
    extra: nextExtra,
  };
}
function sanitizeProductTag(source = {}) {
  return normalizeProductTagValue(source.tag || '');
}
function normalizeProductModelValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}
function parseProductCategorySettings(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return parseProductCategorySettings(SITE_DEFAULTS.SITE_PRODUCT_CATEGORIES);
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return [...new Set(parsed.map((item) => normalizeProductCategoryValue(item)).filter(Boolean))];
  } catch {}
  return [...new Set(text.split(/\r?\n|,/).map((item) => normalizeProductCategoryValue(item)).filter(Boolean))];
}
function serializeProductCategorySettings(list = []) {
  return JSON.stringify(parseProductCategorySettings(list));
}
function normalizeProductForClient(product = {}) {
  const extra = ensureProductCategoryExtra(product?.extra, product);
  const price = Math.max(0, parseInt(product?.price, 10) || 0);
  const sort = parseInt(product?.sort, 10) || 0;
  const pair = resolveManualProductPricePair({ ...product, extra, price });
  return {
    ...product,
    price,
    sort,
    extra,
    salePrice: pair.compare > pair.current ? pair.current : 0,
    comparePrice: pair.compare > pair.current ? pair.compare : 0,
    tag: sanitizeProductTag(product),
    model: normalizeProductModelValue(product?.model || ''),
  };
}
async function resolvedPublicProductCategories() {
  const configured = parseProductCategorySettings(siteValue('SITE_PRODUCT_CATEGORIES'));
  const liveProducts = await listProducts(false);
  const live = liveProducts.map((item) => inferProductCategoryValue(item)).filter(Boolean);
  return [...new Set([...configured, ...live])];
}
async function replaceProductCategoryAcrossCatalog({ sourceCategory = '', targetCategory = '', mode = 'merge' } = {}) {
  const source = normalizeProductCategoryValue(sourceCategory);
  const target = normalizeProductCategoryValue(targetCategory) || String(targetCategory || '').trim();
  if (!source) throw new Error('กรุณาเลือกหมวดหมู่ต้นทาง');
  if (!target) throw new Error('กรุณาระบุหมวดหมู่ปลายทาง');
  if (source === target) throw new Error(mode === 'rename' ? 'ชื่อหมวดหมู่ใหม่ต้องไม่ซ้ำกับชื่อเดิม' : 'หมวดต้นทางและปลายทางต้องไม่ซ้ำกัน');

  const products = await listProducts(true);
  let updatedProducts = 0;
  for (const product of products) {
    if (inferProductCategoryValue(product) !== source) continue;
    const extra = ensureProductCategoryExtra(product?.extra, product);
    extra.category = target;
    await updateProduct(product.id, {
      extra,
      tag: sanitizeProductTag(product),
      model: normalizeProductModelValue(product?.model || ''),
    });
    updatedProducts += 1;
  }

  const currentCategories = parseProductCategorySettings(await getSetting('SITE_PRODUCT_CATEGORIES'));
  const sourceIndex = currentCategories.indexOf(source);
  let nextCategories = currentCategories.slice();
  if (mode === 'rename') {
    nextCategories = nextCategories.map((item) => (item === source ? target : item));
  } else {
    nextCategories = nextCategories.filter((item) => item !== source);
    if (!nextCategories.includes(target)) {
      const insertAt = sourceIndex >= 0 ? sourceIndex : nextCategories.length;
      nextCategories.splice(insertAt, 0, target);
    }
  }
  nextCategories = [...new Set(nextCategories.map((item) => normalizeProductCategoryValue(item)).filter(Boolean))];
  if (!nextCategories.length) nextCategories = parseProductCategorySettings(SITE_DEFAULTS.SITE_PRODUCT_CATEGORIES);
  await setSetting('SITE_PRODUCT_CATEGORIES', serializeProductCategorySettings(nextCategories));
  await ensureSettingsFresh(true);
  return { sourceCategory: source, targetCategory: target, updatedProducts, categories: nextCategories };
}
function orderEmailHTML(o, heading) {
  const items = o.items.map((it) => `<tr><td style="padding:4px 0">${it.name} ×${it.qty}</td><td align="right">฿${(it.price * it.qty).toLocaleString()}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1b1733">
    <h2 style="color:#7b5cff">${heading}</h2>
    <p>ออเดอร์ <b>${o.id}</b> · สถานะ: <b>${STATUS_LABEL[o.status]}</b>${o.tracking ? ` · เลขพัสดุ ${o.tracking}` : ''}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${items}
      <tr><td style="padding:4px 0">ค่าจัดส่ง</td><td align="right">฿${(o.shipping || 0).toLocaleString()}</td></tr>
      ${o.discount ? `<tr><td>ส่วนลด</td><td align="right">-฿${o.discount.toLocaleString()}</td></tr>` : ''}
      <tr><td style="border-top:1px solid #eee;padding-top:8px"><b>รวมสุทธิ</b></td><td align="right" style="border-top:1px solid #eee;padding-top:8px"><b>฿${o.total.toLocaleString()}</b></td></tr>
    </table>
    <p style="color:#999;font-size:12px;margin-top:18px">ขอบคุณที่อุดหนุน ${siteValue('SITE_NAME')}</p>
  </div>`;
}

// ──────────── auth ────────────
app.post('/api/auth/register', async (req, res) => {
  setSensitiveNoStore(res);
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่าน' });
  if (String(password).length < 6) return res.status(400).json({ error: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร' });
  if (await getUserByEmail(email)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
  const { salt, hash } = hashPassword(password);
  const user = await createUser({ id: 'u_' + crypto.randomBytes(6).toString('hex'), email: String(email).toLowerCase(), name: (name || '').trim() || String(email).split('@')[0], salt, hash, role: ROLE_USER });
  const token = newToken(); await createToken(token, user.id);
  writeSessionCookies(req, res, { token, adminGrant: '' });
  res.json({ user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  setSensitiveNoStore(res);
  const { email, password, adminKey } = req.body || {};
  const user = await getUserByEmail(email || '');
  if (!user || !verifyPassword(password || '', user.salt, user.hash)) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  if (adminKey && !hasValidAdminKey(adminKey)) return res.status(403).json({ error: 'คีย์แอดมินไม่ถูกต้อง' });
  const resolvedUser = withResolvedAdminRole(user, adminKey);
  const token = newToken(); await createToken(token, user.id);
  // #region debug-point E:login-before-cookies
  reportServerDebug('E', 'server/index.js:/api/auth/login:before-cookies', '[DEBUG] login about to write cookies', {
    email: String(email || '').trim().toLowerCase(),
    userId: user.id,
    storedRole: user.role || '',
    adminKeyPresent: Boolean(String(adminKey || '').trim()),
    grantPreview: adminKey && isAdminRole(user.role) ? createAdminGrant(user.id) : '',
  });
  // #endregion
  writeSessionCookies(req, res, { token, adminGrant: adminKey && isAdminRole(user.role) ? createAdminGrant(user.id) : '' });
  // #region debug-point E:login-response
  reportServerDebug('E', 'server/index.js:/api/auth/login', '[DEBUG] login issued session cookies', {
    email: String(email || '').trim().toLowerCase(),
    userId: user.id,
    storedRole: user.role || '',
    adminKeyPresent: Boolean(String(adminKey || '').trim()),
    responseRole: resolvedUser.role || '',
    adminGrantIssued: Boolean(String(adminKey || '').trim()) && isAdminRole(user.role),
  });
  // #endregion
  res.json({ user: publicUser(resolvedUser) });
});
app.get('/api/auth/me', (req, res) => { setSensitiveNoStore(res); res.json({ user: publicUser(req.user) }); });
app.post('/api/auth/logout', async (req, res) => {
  setSensitiveNoStore(res);
  if (req.token) await deleteToken(req.token);
  clearSessionCookies(req, res);
  res.json({ ok: true });
});

// ──────────── products (public) ────────────
app.get('/api/products', async (_req, res) => {
  const st = await allReviewStats(); const sale = saleConfig();
  res.json((await listProducts(false)).map((p) => {
    const item = normalizeProductForClient(p);
    return { ...item, rating: st[item.id]?.avg || 0, reviews: st[item.id]?.count || 0, salePrice: item.salePrice || (sale.active ? resolvePublicProductSalePrice(item) : 0) };
  }));
});
app.get('/api/products/:id', async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || !p.active) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const s = await reviewStats(p.id); const sale = saleConfig();
  const item = normalizeProductForClient(p);
  res.json({ ...item, rating: s.avg, reviews: s.count, salePrice: item.salePrice || (sale.active ? resolvePublicProductSalePrice(item) : 0) });
});

// ──────────── articles (public) ────────────
app.get('/api/articles', async (_req, res) => res.json(await listArticles(false)));
app.get('/api/articles/:id', async (req, res) => {
  const a = await getArticle(req.params.id);
  if (!a || !a.published) return res.status(404).json({ error: 'ไม่พบบทความ' });
  res.json(a);
});

// ──────────── leads / consultation ────────────
app.post('/api/leads', leadLimiter, async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 80);
  const phone = String(b.phone || '').trim().slice(0, 30);
  if (!name || !phone) return res.status(400).json({ error: 'กรุณากรอกชื่อและเบอร์โทร' });
  const lead = await createLead({
    name,
    phone,
    lineId: String(b.lineId || '').trim().slice(0, 60),
    province: String(b.province || '').trim().slice(0, 80),
    crop: String(b.crop || '').trim().slice(0, 80),
    stage: String(b.stage || '').trim().slice(0, 80),
    areaRai: String(b.areaRai || '').trim().slice(0, 40),
    problem: String(b.problem || '').trim().slice(0, 1000),
    source: String(b.source || '').trim().slice(0, 80),
    landingPage: String(b.landingPage || '').trim().slice(0, 180),
    utmSource: String(b.utmSource || '').trim().slice(0, 80),
    utmMedium: String(b.utmMedium || '').trim().slice(0, 80),
    utmCampaign: String(b.utmCampaign || '').trim().slice(0, 80),
    note: '',
    status: 'new',
  });
  await pushToAdmin([
    '🌱 มีลีดใหม่จากเว็บไซต์',
    `ชื่อ: ${lead.name}`,
    `โทร: ${lead.phone}`,
    lead.lineId ? `LINE: ${lead.lineId}` : '',
    lead.crop ? `พืช: ${lead.crop}` : '',
    lead.stage ? `ช่วง: ${lead.stage}` : '',
    lead.province ? `จังหวัด: ${lead.province}` : '',
    lead.areaRai ? `พื้นที่: ${lead.areaRai} ไร่` : '',
    lead.problem ? `ปัญหา: ${lead.problem}` : '',
    lead.source ? `แหล่งที่มา: ${lead.source}` : '',
    lead.utmSource || lead.utmMedium || lead.utmCampaign
      ? `UTM: ${lead.utmSource || '-'} / ${lead.utmMedium || '-'} / ${lead.utmCampaign || '-'}`
      : '',
  ].filter(Boolean).join('\n'));
  res.json({ ok: true, lead });
});

// ──────────── reviews ────────────
app.get('/api/products/:id/reviews', async (req, res) => {
  res.json({ reviews: await listReviews(req.params.id), stats: await reviewStats(req.params.id) });
});
app.post('/api/products/:id/reviews', requireAuth, async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const rating = Math.max(1, Math.min(5, parseInt(req.body?.rating, 10) || 0));
  if (!rating) return res.status(400).json({ error: 'กรุณาให้คะแนน 1–5 ดาว' });
  if (await userReviewed(p.id, req.user.id)) return res.status(409).json({ error: 'คุณรีวิวสินค้านี้ไปแล้ว' });
  await addReview(p.id, req.user.id, req.user.name || req.user.email, rating, (req.body?.comment || '').slice(0, 500));
  res.json({ ok: true, reviews: await listReviews(p.id), stats: await reviewStats(p.id) });
});

// ──────────── orders ────────────
app.post('/api/coupons/validate', async (req, res) => {
  const { code, subtotal } = req.body || {};
  const r = await evalCoupon(code, parseInt(subtotal, 10) || 0);
  if (!r.ok) return res.status(400).json({ error: r.error });
  res.json({ ok: true, discount: r.discount, coupon: r.coupon });
});

app.post('/api/orders', orderLimiter, async (req, res) => {
  const { items, customer, payment, sessionId, coupon } = req.body || {};
  try {
    const result = await orderService.createCheckoutOrder({
      items,
      customer,
      payment,
      sessionId,
      coupon,
      userId: req.user?.id || '',
      baseUrl: cfg('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`,
      channel: 'web',
    });
    res.json({ ok: true, order: clientOrder(result.order), accessToken: result.accessToken, checkoutUrl: result.checkoutUrl, promptpay: result.promptpay });
  } catch (err) {
    const message = err?.message || 'สร้างคำสั่งซื้อไม่สำเร็จ';
    const conflict = /สินค้า|คูปอง|ยอดชำระด้วยบัตร/.test(message);
    res.status(conflict ? 409 : 400).json({ error: message });
  }
});
app.get('/api/orders/:id', async (req, res) => {
  const o = await expireOrderIfNeeded(await getOrder(req.params.id));
  if (!o || !canAccessOrder(req, o)) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  res.json(await orderService.getClientOrderDetails(o.id));
});
app.get('/api/orders/:id/promptpay-qr', async (req, res) => {
  const o = await expireOrderIfNeeded(await getOrder(req.params.id));
  if (!o || !canAccessOrder(req, o)) return res.status(404).end();
  const buffer = await orderService.buildPromptPayQrBuffer(o.id);
  if (!buffer) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.end(buffer);
});
app.post('/api/orders/:id/notify-payment', async (req, res) => {
  const o = await expireOrderIfNeeded(await getOrder(req.params.id));
  if (!o || !canAccessOrder(req, o)) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  if (o.status === 'expired') return res.status(410).json({ error: 'ออเดอร์นี้หมดเวลาชำระแล้ว กรุณาสั่งซื้อใหม่' });
  const result = await orderService.claimPayment(o.id);
  res.json({ ok: true, order: clientOrder(result.order), alreadyPaid: !!result.alreadyPaid });
});
app.post('/api/orders/:id/confirm-stripe', async (req, res) => {
  const o = await expireOrderIfNeeded(await getOrder(req.params.id));
  if (!o || !canAccessOrder(req, o)) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  if (o.status === 'expired') return res.status(410).json({ error: 'ออเดอร์นี้หมดเวลาชำระแล้ว กรุณาสั่งซื้อใหม่' });
  const result = await orderService.confirmStripePayment(o.id);
  res.json({ ok: true, order: clientOrder(result.order), alreadyPaid: !!result.alreadyPaid });
});
app.post('/api/orders/:id/verify-slip', async (req, res) => {
  const o = await expireOrderIfNeeded(await getOrder(req.params.id));
  if (!o || !canAccessOrder(req, o)) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  if (o.status === 'expired') return res.status(410).json({ error: 'ออเดอร์นี้หมดเวลาชำระแล้ว กรุณาสั่งซื้อใหม่' });
  try {
    const { rawBase64 } = parseSlipUpload(req.body || {});
    const result = await orderService.verifyPromptpaySlip({
      orderId: o.id,
      rawBase64,
      slipMessageId: `web-${Date.now()}`,
      slipReceivedAt: new Date().toISOString(),
      userId: o.user_id || '',
      source: 'web',
    });
    if (result.verified || result.alreadyPaid) {
      return res.json({
        ok: true,
        verified: true,
        alreadyPaid: !!result.alreadyPaid,
        order: clientOrder(result.order),
        paymentLog: result.paymentLog,
      });
    }
    return res.status(result.manualReview ? 202 : 400).json({
      ok: !!result.manualReview,
      verified: false,
      manualReview: !!result.manualReview,
      error: result.manualReview ? '' : (result.error || 'สลิปไม่ผ่านการตรวจสอบ'),
      order: clientOrder(result.order),
      paymentLog: result.paymentLog,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'ตรวจสลิปไม่สำเร็จ' });
  }
});
app.get('/api/my/orders', requireAuth, async (req, res) => res.json((await listOrdersByUser(req.user.id)).map((o) => ({ ...clientOrder(o), statusLabel: STATUS_LABEL[o.status] }))));

// ════════════ ADMIN ════════════
function saveLocalAsset(dataUrl) {
  const m = /^data:((image\/(png|jpe?g|webp|gif))|application\/pdf);base64,(.+)$/i.exec(dataUrl);
  if (!m) return '';
  const ext = m[2] ? m[2].toLowerCase().replace('jpeg', 'jpg') : 'pdf';
  const buf = Buffer.from(m[4], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 6MB');
  const fname = Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(uploadsDir, fname), buf);
  return '/uploads/' + fname;
}
async function saveAsset(dataUrl) {
  const m = /^data:((image\/(png|jpe?g|webp|gif))|application\/pdf);base64,(.+)$/i.exec(dataUrl);
  if (!m) return '';
  const contentType = m[1].toLowerCase();
  const ext = m[2] ? m[2].toLowerCase().replace('jpeg', 'jpg') : 'pdf';
  const buf = Buffer.from(m[4], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw new Error('รูปใหญ่เกิน 6MB');
  if (isSupabaseConfigured({ requireServiceRole: true })) {
    return uploadPublicAsset({ buffer: buf, contentType, extension: ext, folder: 'site-assets' });
  }
  if (isServerless) throw new Error('ต้องตั้งค่า Supabase Storage ก่อน deploy บน Vercel');
  return saveLocalAsset(dataUrl);
}
app.post('/api/admin/upload', requireAdmin, async (req, res) => {
  try {
    const dataUrl = String(req.body?.dataUrl || '');
    if (!dataUrl) return res.status(400).json({ error: 'ไม่พบไฟล์ที่อัปโหลด' });
    res.json({ ok: true, url: await saveAsset(dataUrl) });
  } catch (err) { res.status(400).json({ error: err.message || 'อัปโหลดไม่สำเร็จ' }); }
});
const SETTING_KEYS = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_ADMIN_USER_ID', 'LINE_CHAT_MODE', 'LINE_WEB_CHAT_PATH', 'LINEOA_API_BASE_URL', 'LINEOA_API_CLIENT_ID', 'LINEOA_API_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PROMPTPAY_ID', 'PROMPTPAY_NAME', 'SLIPOK_API_URL', 'SLIPOK_API_KEY', 'ORDER_RESERVATION_TTL_MINUTES', 'PUBLIC_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const SECRET_KEYS = new Set(['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINEOA_API_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SLIPOK_API_KEY', 'SMTP_PASS']);

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  const stats = await getAdminDashboardStats();
  res.json({
    ...stats,
    recent: (stats.recent || []).map((order) => ({ ...order, statusLabel: STATUS_LABEL[order.status] })),
  });
});
app.get('/api/admin/products', requireAdmin, async (_req, res) => res.json((await listProducts(true)).map((item) => normalizeProductForClient(item))));
app.post('/api/admin/products', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !b.price) return res.status(400).json({ error: 'กรอกชื่อและราคา' });
    let image = b.image || '';
    if (typeof image === 'string' && image.startsWith('data:')) image = await saveAsset(image);
    const images = Array.isArray(b.images)
      ? (await Promise.all(b.images.map(async (im) => ((typeof im === 'string' && im.startsWith('data:')) ? saveAsset(im) : im)))).filter(Boolean)
      : [];
    let extra = b.extra || {};
    if (typeof extra !== 'object' || Array.isArray(extra)) extra = {};
    if (typeof extra.labelUrl === 'string' && extra.labelUrl.startsWith('data:')) extra.labelUrl = await saveAsset(extra.labelUrl);
    extra = ensureProductCategoryExtra(extra, b);
    const pricing = canonicalizeProductPricingPayload({ price: parseInt(b.price, 10) || 0, salePrice: b.salePrice, comparePrice: b.comparePrice, extra });
    extra = pricing.extra;
    const id = b.id || ('p_' + crypto.randomBytes(4).toString('hex'));
    const p = await createProduct({ id, name: b.name, tag: sanitizeProductTag(b), price: pricing.price, short: b.short, desc: b.desc, specs: b.specs || {}, segment: b.segment || 'agri', extra, icon: b.icon || 'pod', image, video: (b.video || '').trim(), images, model: normalizeProductModelValue(b.model), stock: parseInt(b.stock, 10) || 0, active: b.active !== false, sort: parseInt(b.sort, 10) || 0 });
    res.json({ ok: true, product: p });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const current = await getProduct(req.params.id);
    if (!current) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    const b = req.body || {};
    const patch = { ...b };
    if (b.price !== undefined) patch.price = parseInt(b.price, 10) || 0;
    if (b.stock !== undefined) patch.stock = parseInt(b.stock, 10) || 0;
    if (b.sort !== undefined) patch.sort = parseInt(b.sort, 10) || 0;
    if (typeof b.image === 'string' && b.image.startsWith('data:')) patch.image = await saveAsset(b.image);
    if (Array.isArray(b.images)) {
      patch.images = (await Promise.all(b.images.map(async (im) => ((typeof im === 'string' && im.startsWith('data:')) ? saveAsset(im) : im)))).filter(Boolean);
    }
    if (b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra) && typeof b.extra.labelUrl === 'string' && b.extra.labelUrl.startsWith('data:')) {
      patch.extra = { ...b.extra, labelUrl: await saveAsset(b.extra.labelUrl) };
    }
    if (b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra)) {
      patch.extra = ensureProductCategoryExtra(patch.extra || b.extra, { ...b, extra: patch.extra || b.extra });
    }
    if (b.tag !== undefined) patch.tag = sanitizeProductTag(b);
    if (b.model !== undefined) patch.model = normalizeProductModelValue(b.model);
    const pricing = canonicalizeProductPricingPayload({
      ...current,
      ...patch,
      salePrice: b.salePrice ?? patch.salePrice,
      comparePrice: b.comparePrice ?? patch.comparePrice,
      extra: patch.extra ?? current.extra,
    }, current);
    patch.price = pricing.price;
    patch.extra = pricing.extra;
    const p = await updateProduct(req.params.id, patch);
    if (!p) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    res.json({ ok: true, product: p });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => { await deleteProduct(req.params.id); res.json({ ok: true }); });
app.post('/api/admin/product-categories/merge', requireAdmin, async (req, res) => {
  try {
    const result = await replaceProductCategoryAcrossCatalog({
      sourceCategory: req.body?.sourceCategory,
      targetCategory: req.body?.targetCategory,
      mode: req.body?.mode || 'merge',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message || 'จัดการหมวดหมู่ไม่สำเร็จ' });
  }
});

// articles (admin)
app.get('/api/admin/articles', requireAdmin, async (_req, res) => res.json(await listArticles(true)));
app.post('/api/admin/articles', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.title) return res.status(400).json({ error: 'กรอกหัวข้อบทความ' });
    let cover = b.cover || '';
    if (typeof cover === 'string' && cover.startsWith('data:')) cover = await saveAsset(cover);
    const id = b.id || ('a_' + crypto.randomBytes(4).toString('hex'));
    res.json({ ok: true, article: await createArticle({ id, title: b.title, cover, excerpt: b.excerpt, body: b.body, published: b.published !== false }) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/admin/articles/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {}; const patch = { ...b };
    if (typeof b.cover === 'string' && b.cover.startsWith('data:')) patch.cover = await saveAsset(b.cover);
    const a = await updateArticle(req.params.id, patch);
    if (!a) return res.status(404).json({ error: 'ไม่พบบทความ' });
    res.json({ ok: true, article: a });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/admin/articles/:id', requireAdmin, async (req, res) => { await deleteArticle(req.params.id); res.json({ ok: true }); });

app.get('/api/admin/leads', requireAdmin, async (req, res) => {
  const { page, limit, offset, search, status } = parseAdminListQuery(req, 20);
  const [items, total] = await Promise.all([
    listAdminLeads(limit, offset, { search, status }),
    countLeads({ search, status }),
  ]);
  res.json(pagedAdminResponse({ items, page, limit, total }));
});
app.put('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await getLead(id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบลีด' });
  const status = ['new', 'contacted', 'qualified', 'won', 'lost'].includes(req.body?.status) ? req.body.status : cur.status;
  const note = req.body?.note !== undefined ? String(req.body.note).slice(0, 1000) : cur.note;
  const lead = await updateLead(id, { status, note });
  res.json({ ok: true, lead });
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const { page, limit, offset, search, status } = parseAdminListQuery(req, 20);
  const [items, total] = await Promise.all([
    listAdminOrderSummaries(limit, offset, { search, status }),
    countOrders({ search, status }),
  ]);
  res.json(pagedAdminResponse({
    items: items.map((o) => ({ ...clientAdminOrderSummary(o), statusLabel: STATUS_LABEL[o.status] })),
    page,
    limit,
    total,
  }));
});
app.get('/api/admin/inbox', requireAdminInbox, async (req, res) => {
  const { page, limit, offset, search } = parseAdminListQuery(req, 30);
  const data = await listChatSessions({ search, limit, offset });
  const items = (await Promise.all((data.items || []).map((item) => enrichInboxSessionItem(item)))).filter(Boolean);
  res.json(pagedAdminResponse({ items, page, limit, total: data.total || 0 }));
});
app.get('/api/admin/inbox/summary', requireAdminInbox, async (_req, res) => {
  const data = await listChatSessions({ limit: 500, offset: 0 });
  const items = (await Promise.all((data.items || []).map((item) => enrichInboxSessionItem(item)))).filter(Boolean);
  const unreadTotal = items.reduce((sum, item) => sum + Math.max(0, Number(item?.unreadCount || 0)), 0);
  const unreadSessions = items.filter((item) => Number(item?.unreadCount || 0) > 0).length;
  res.json({ unreadTotal, unreadSessions, totalSessions: Number(data?.total || items.length || 0) });
});
app.get('/api/admin/inbox/:sessionId', requireAdminInbox, async (req, res) => {
  const sessionId = normalizeChatSessionId(req.params.sessionId);
  if (!CHAT_SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'รหัสห้องแชตไม่ถูกต้อง' });
  const messages = await listChatMessages(sessionId, 300);
  if (!messages.length) return res.status(404).json({ error: 'ไม่พบห้องแชตนี้แล้ว' });
  await markChatSessionRead(sessionId, messages.length ? Number(messages[messages.length - 1]?.at || Date.now()) : Date.now());
  const detail = await enrichInboxSessionItem({ session_id: sessionId, last_customer_at: messages.filter((message) => message?.sender === 'customer').slice(-1)[0]?.at || 0 });
  res.json({ sessionId, messages, detail });
});
app.delete('/api/admin/inbox/:sessionId', requireAdminInbox, async (req, res) => {
  const sessionId = normalizeChatSessionId(req.params.sessionId);
  if (!CHAT_SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'รหัสห้องแชตไม่ถูกต้อง' });
  const existing = await listChatMessages(sessionId, 1);
  if (!existing.length) return res.status(404).json({ error: 'ไม่พบห้องแชตนี้แล้ว' });
  await deleteChatSession(sessionId);
  await removeChatInboxMeta(sessionId);
  sessions.delete(sessionId);
  if (lastActiveSession === sessionId) lastActiveSession = null;
  await emitAdminInboxUpdate({ type: 'session_deleted', sessionId });
  res.json({ ok: true, sessionId });
});
app.post('/api/admin/inbox/:sessionId/reply', requireAdminInbox, async (req, res) => {
  const sessionId = normalizeChatSessionId(req.params.sessionId);
  const text = String(req.body?.text || '').trim().slice(0, 1000);
  if (!CHAT_SESSION_ID_RE.test(sessionId)) return res.status(400).json({ error: 'รหัสห้องแชตไม่ถูกต้อง' });
  if (!text) return res.status(400).json({ error: 'กรอกข้อความก่อนตอบกลับ' });
  try {
    const message = await saveAdminReply(sessionId, text);
    res.json({ ok: true, sessionId, message });
  } catch (err) {
    const message = String(err?.message || '').trim();
    if (/ส่งข้อความกลับ LINE ไม่สำเร็จ/i.test(message)) {
      return res.status(502).json({ error: message });
    }
    throw err;
  }
});
app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  let account = null;
  if (o.user_id) { const u = await getUserById(o.user_id); if (u) account = { id: u.id, email: u.email, name: u.name }; }
  res.json({ ...clientOrder(o), statusLabel: STATUS_LABEL[o.status], account });
});
app.post('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { action, tracking } = req.body || {};
  const o = await applyOrderAction(req.params.id, action, tracking || '');
  if (!o) return res.status(400).json({ error: 'ไม่พบออเดอร์หรือสถานะไม่ถูกต้อง' });
  res.json({ ok: true, order: { ...clientOrder(o), statusLabel: STATUS_LABEL[o.status] } });
});
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const { page, limit, offset, search, role } = parseAdminListQuery(req, 20);
  const [items, total] = await Promise.all([
    listAdminUsers(limit, offset, { search, role }),
    countUsers({ search, role }),
  ]);
  res.json(pagedAdminResponse({ items, page, limit, total }));
});
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  const { email, password, name, role } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedRole = String(role || '').trim();
  const allowedRoles = new Set([ROLE_ADMIN, ROLE_CHAT_ADMIN, ROLE_USER]);
  if (!normalizedEmail || !password) return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่านให้ครบ' });
  if (String(password).length < 6) return res.status(400).json({ error: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร' });
  if (!allowedRoles.has(normalizedRole)) return res.status(400).json({ error: 'สิทธิ์ที่เลือกไม่ถูกต้อง' });
  if (await getUserByEmail(normalizedEmail)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
  const { salt, hash } = hashPassword(password);
  const user = await createUser({
    id: 'u_' + crypto.randomBytes(6).toString('hex'),
    email: normalizedEmail,
    name: String(name || '').trim() || normalizedEmail.split('@')[0],
    salt,
    hash,
    role: normalizedRole,
  });
  res.json({ ok: true, user: publicUser(user) });
});
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const { name, role } = req.body || {};
  const allowedRoles = new Set([ROLE_USER, ROLE_ADMIN, ROLE_CHAT_ADMIN]);
  const newRole = allowedRoles.has(String(role || '').trim()) ? String(role || '').trim() : target.role;
  if (target.role === ROLE_ADMIN && newRole !== ROLE_ADMIN && await countAdmins() <= 1) return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คน' });
  const u = await updateUser(req.params.id, { name: name !== undefined ? String(name).slice(0, 80) : target.name, role: newRole });
  res.json({ ok: true, user: publicUser(u) });
});
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'ลบบัญชีตัวเองไม่ได้' });
  if (target.role === ROLE_ADMIN && await countAdmins() <= 1) return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คน' });
  await deleteUser(req.params.id);
  res.json({ ok: true });
});

// coupons
app.get('/api/admin/coupons', requireAdmin, async (_req, res) => res.json(await listCoupons()));
app.post('/api/admin/coupons', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.code || !b.value) return res.status(400).json({ error: 'กรอกรหัสคูปองและมูลค่า' });
  if (await getCoupon(b.code)) return res.status(409).json({ error: 'มีคูปองรหัสนี้แล้ว' });
  res.json({ ok: true, coupon: await createCoupon(b) });
});
app.put('/api/admin/coupons/:code', requireAdmin, async (req, res) => {
  const c = await updateCoupon(req.params.code, req.body || {});
  if (!c) return res.status(404).json({ error: 'ไม่พบคูปอง' });
  res.json({ ok: true, coupon: c });
});
app.delete('/api/admin/coupons/:code', requireAdmin, async (req, res) => { await deleteCoupon(req.params.code); res.json({ ok: true }); });

// analytics สำหรับแดชบอร์ด
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
  const days = Math.min(90, Math.max(7, parseInt(req.query.days, 10) || 30));
  const analytics = await getAdminOrderAnalytics(days);
  res.json({
    ...analytics,
    statusLabels: STATUS_LABEL,
  });
});

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  const dbS = await allSettings();
  res.json(SETTING_KEYS.map((k) => {
    const val = dbS[k] || process.env[k] || '';
    const source = dbS[k] ? 'db' : (process.env[k] ? 'env' : 'none');
    const display = !val ? '' : (SECRET_KEYS.has(k) ? '••••••' + val.slice(-4) : val);
    return { key: k, set: Boolean(val), source, display, secret: SECRET_KEYS.has(k) };
  }));
});
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const s = req.body?.settings || {};
  for (const k of [...SETTING_KEYS, ...SITE_KEYS]) {
    if (typeof s[k] === 'string') await setSetting(k, s[k].trim());
  }
  await refreshSettingsCache();
  await runStartupValidation('settings_update');
  siteStatsCache = null;
  siteStatsCacheAt = 0;
  res.json({ ok: true });
});
app.get('/api/admin/diagnostics', requireAdmin, async (_req, res) => {
  await ensureSettingsFresh();
  const runtime = runtimeDiagnosticsState();
  const currentValidation = buildSystemValidationReport('admin_diagnostics');
  const health = buildHealthSnapshot();
  const audits = await listLineWebhookAudits(300).catch(() => []);
  res.json({
    ok: true,
    generatedAt: Date.now(),
    health,
    startupValidation: runtime.startup,
    currentValidation,
    runtime: {
      recentEvents: Array.isArray(runtime.events) ? runtime.events.slice(0, 30) : [],
      recentAlerts: Array.isArray(runtime.alerts) ? runtime.alerts.slice(0, 20) : [],
      webhook: {
        counters: summarizeLineWebhookAudits(audits),
        processedCount: audits.length,
        audits: audits.slice(0, 40),
      },
    },
  });
});
app.post('/api/admin/diagnostics/recheck', requireAdmin, async (_req, res) => {
  await ensureSettingsFresh(true);
  const report = await runStartupValidation('manual_recheck');
  res.json({ ok: true, report, health: buildHealthSnapshot() });
});
// ข้อมูลร้าน/แบรนด์สำหรับหลังบ้าน (ค่าจริง ไม่ปิดบัง)
app.get('/api/admin/site', requireAdmin, (_req, res) => res.json(siteConfig()));
app.get('/api/admin/reviews', requireAdmin, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(mergedReviewGalleryData());
});
app.put('/api/admin/reviews', requireAdmin, async (req, res) => {
  const base = mergedReviewGalleryData();
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  const baseMap = new Map(base.items.map((item) => [reviewOverrideKey(item), item]));
  const overrides = [];
  for (const item of incoming) {
    const key = reviewOverrideKey(item);
    const baseItem = baseMap.get(key);
    if (!key || !baseItem) continue;
    overrides.push({
      hash: baseItem.hash,
      sourceName: baseItem.sourceName,
      title: String(item?.title || baseItem.title || '').trim().slice(0, 160),
      note: String(item?.note || baseItem.note || '').trim().slice(0, 600),
      badge: String(item?.badge || baseItem.badge || '').trim().slice(0, 80),
      spotlight: item?.spotlight === true,
    });
  }
  await setSetting(REVIEW_GALLERY_OVERRIDES_KEY, serializeReviewGalleryOverrides(overrides));
  await refreshSettingsCache();
  res.json({ ok: true, gallery: mergedReviewGalleryData() });
});
// รายชื่อคนที่เคยทัก LINE OA (จาก inbox meta) — ใช้เลือกตั้ง LINE_ADMIN_USER_ID ให้ push แจ้งเตือนถึงจริง
app.get('/api/admin/line/recent-senders', requireAdmin, async (_req, res) => {
  await ensureSettingsFresh();
  const currentAdminUserId = String(adminUserId() || '').trim();
  const byUserId = new Map();
  for (const [sessionId, meta] of Object.entries(chatInboxMetaMap())) {
    const lineUserId = String(meta?.lineUserId || '').trim();
    if (!lineUserId) continue;
    const lastActiveAt = Number(meta.lastCustomerAt || meta.updatedAt || 0);
    const existing = byUserId.get(lineUserId);
    if (existing && existing.lastActiveAt >= lastActiveAt) continue;
    byUserId.set(lineUserId, {
      sessionId,
      lineUserId,
      name: String(meta.customerName || meta.visitorName || '').trim() || `LINE-${lineUserId.slice(-6)}`,
      avatar: String(meta.customerAvatar || '').trim(),
      lastActiveAt,
      isCurrentAdmin: lineUserId === currentAdminUserId,
    });
  }
  const senders = [...byUserId.values()].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 20);
  res.json({ ok: true, currentAdminUserId, senders });
});
app.post('/api/admin/test-line', requireAdmin, async (req, res) => {
  if (!lineClient() || !adminUserId()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า LINE token หรือ admin userId' });
  try {
    const delivered = await pushToAdmin(`🔔 ทดสอบการเชื่อมต่อ LINE OA จากหลังบ้าน ${siteValue('SITE_NAME')} สำเร็จ`);
    if (!delivered) throw new Error('LINE push ไม่สำเร็จ');
    res.json({ ok: true });
  }
  catch (err) { res.status(400).json({ error: 'ส่งไม่สำเร็จ: ' + (err?.message || '') }); }
});
app.post('/api/admin/test-line-room', requireAdmin, async (_req, res) => {
  const check = lineWebRoomDiagnostics();
  if (!check.ok) return res.status(400).json({ error: `line-room ไม่พร้อม: ${check.reason}` });
  res.json({
    ok: true,
    entryUrl: check.entryUrl,
    path: check.path,
    sessionId: check.sessionId,
  });
});
app.post('/api/admin/test-mail', requireAdmin, async (req, res) => {
  if (!mailConfigured()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า SMTP (host/user)' });
  const to = (req.body?.to || '').trim() || cfg('SMTP_FROM') || cfg('SMTP_USER');
  try {
    const t = mailer();
    await t.sendMail({ from: cfg('SMTP_FROM') || cfg('SMTP_USER'), to, subject: 'ทดสอบอีเมล · ' + siteValue('SITE_NAME'), html: '<p>การตั้งค่าอีเมล (SMTP) ใช้งานได้แล้ว ✓</p>' });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: 'ส่งไม่สำเร็จ: ' + err.message }); }
});

// ════════════ Socket.IO ════════════
io.on('connection', (socket) => {
  socket.on('chat:join', async (payload = {}) => {
    let sessionId = normalizeChatSessionId(payload?.sessionId || '');
    if (!CHAT_SESSION_ID_RE.test(sessionId)) sessionId = makeSessionId();
    const visitorName = String(payload?.name || '').trim().slice(0, 80) || `ลูกค้า-${sessionId}`;
    const current = sessions.get(sessionId) || { socketId: socket.id, name: visitorName, lastActiveAt: Date.now() };
    current.socketId = socket.id;
    current.name = visitorName;
    current.lastActiveAt = Date.now();
    sessions.set(sessionId, current);
    socket.data.chatSessionId = sessionId;
    socket.join(`chat:${sessionId}`);
    socket.emit('chat:ready', { sessionId, connected: true });
  });
  socket.on('chat:setName', async (name) => {
    const sessionId = normalizeChatSessionId(socket.data.chatSessionId || '');
    if (!sessionId || typeof name !== 'string' || !name.trim()) return;
    const s = sessions.get(sessionId) || { socketId: socket.id, name: '', lastActiveAt: Date.now() };
    s.socketId = socket.id;
    s.name = name.trim().slice(0, 80);
    s.lastActiveAt = Date.now();
    sessions.set(sessionId, s);
    await patchChatInboxMeta(sessionId, { visitorName: s.name });
  });
  socket.on('chat:message', async (payload = {}) => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    const at = Number(payload?.at || Date.now()) || Date.now();
    const sessionId = normalizeChatSessionId(socket.data.chatSessionId || payload?.sessionId || '');
    if (!sessionId || !text || !text.trim()) return;
    const s = sessions.get(sessionId) || { socketId: socket.id, name: `ลูกค้า-${sessionId}`, lastActiveAt: Date.now() };
    s.socketId = socket.id;
    s.lastActiveAt = Date.now();
    sessions.set(sessionId, s);
    await routeCustomerMessage({ sessionId, name: s.name, text, via: 'socket', at });
  });
  socket.on('chat:admin:watch', async (payload = {}) => {
    const admin = await resolveSocketAdmin.call(socket, payload);
    if (!admin) return socket.emit('chat:admin:error', { error: 'unauthorized' });
    socket.data.adminUserId = admin.id;
    socket.join(ADMIN_INBOX_ROOM);
    socket.emit('chat:admin:ready', { ok: true });
  });
  socket.on('disconnect', () => {
    const sessionId = normalizeChatSessionId(socket.data.chatSessionId || '');
    if (!sessionId) return;
    const session = sessions.get(sessionId);
    if (session?.socketId === socket.id) {
      session.socketId = '';
      session.lastActiveAt = Date.now();
      sessions.set(sessionId, session);
    }
    if (lastActiveSession === sessionId && !session?.socketId) lastActiveSession = null;
  });
});

// ──────────────────── ตัวจัดการท้ายสุด (ไม่รั่วข้อมูลเซิร์ฟเวอร์) ────────────────────
// ── SEO ──
app.get('/robots.txt', (req, res) => {
  const base = cfg('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send(`User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`);
});
app.get('/sitemap.xml', async (req, res) => {
  const base = cfg('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`;
  const urls = ['/', '/#/products', '/#/about', '/crops/durian', '/crops/mango', '/crops/rice', '/crops/vegetables', ...(await listProducts(false)).map((p) => '/#/product/' + p.id)];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n')}\n</urlset>`);
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'ไม่พบรายการที่ร้องขอ' }));
app.use((req, res, next) => {
  if (/^\/(client-src|server|supabase|private-build|\.git)(?:\/|$)/i.test(req.path) || /^\/package(?:-lock)?\.json$/i.test(req.path)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  return next();
});
app.get('*', (_req, res) => { setSensitiveNoStore(res); res.sendFile(path.join(publicDir, 'index.html')); });  // SPA fallback + ซ่อนหน้า 404 ของเซิร์ฟเวอร์
app.use((err, req, res, _next) => {
  // #region debug-point F:error-middleware
  reportServerDebug('F', 'server/index.js:error-middleware', '[DEBUG] request failed in express error middleware', {
    path: req?.path || '',
    method: req?.method || '',
    message: err?.message || String(err || ''),
    stackTop: String(err?.stack || '').split('\n').slice(0, 3).join(' | '),
  });
  // #endregion
  void recordSystemEvent({
    level: 'error',
    source: 'express',
    type: 'request_failed',
    message: `Express error on ${req?.method || ''} ${req?.path || ''}`.trim(),
    data: {
      path: req?.path || '',
      method: req?.method || '',
      error: err?.message || String(err || ''),
    },
    alert: true,
    dedupeKey: `express:${req?.path || ''}:${req?.method || ''}`,
  });
  console.error('[error]', err?.message);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' });
});

function timeAgo(ts) { const s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return `${s} วินาทีก่อน`; if (s < 3600) return `${Math.floor(s / 60)} นาทีก่อน`; return `${Math.floor(s / 3600)} ชม.ก่อน`; }

// init แบบรันครั้งเดียว (ใช้ได้ทั้ง local server และ Vercel serverless cold start)
let _initPromise = null;
async function ensureInit() {
  if (!_initPromise) {
    _initPromise = (async () => {
      await seedAdmin();
      await seedProducts();
      await seedArticles();
      await refreshSettingsCache();
      await runStartupValidation('bootstrap');
    })();
  }
  return _initPromise;
}

// บน Vercel (serverless): export app ให้ api/index.js เรียก ไม่ต้อง listen / ไม่ใช้ Socket.IO
// ใน local: seed แล้ว listen ตามปกติ (Socket.IO ใช้ได้)
if (!isServerless) {
  ensureInit()
    .then(() => server.listen(PORT, () => {
      const seededAdmin = String(process.env.ADMIN_SEED_EMAIL || '').trim();
      console.log(`\n  ✓ เว็บไซต์:  http://localhost:${PORT}`);
      console.log(`  ✓ หลังบ้าน: http://localhost:${PORT}/secure-admin#/admin${seededAdmin ? `  (แอดมิน: ${seededAdmin})` : ''}`);
      console.log(`  ✓ Webhook:  /webhook/line , /webhook/stripe\n`);
    }))
    .catch((err) => { console.error('[bootstrap]', err?.message || err); process.exit(1); });
}

export { app, ensureInit };
export default app;
