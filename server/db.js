import './env.js';
import { isSupabaseConfigured } from './supabase-client.js';

// โหลด provider แบบ dynamic เพื่อให้ better-sqlite3 (native) ไม่ถูกโหลดบน Vercel
// serverless ตอนใช้ Supabase — ป้องกัน crash จาก native binding / การเขียนไฟล์
const requestedProvider = String(process.env.DB_PROVIDER || 'sqlite').trim().toLowerCase();
const forceSupabase = /^(1|true|yes|on)$/i.test(String(process.env.FORCE_SUPABASE || '').trim());

export const activeProvider = forceSupabase ? 'supabase' : requestedProvider;

if (activeProvider === 'supabase' && !isSupabaseConfigured({ requireServiceRole: true })) {
  throw new Error('DB provider is forced to supabase but SUPABASE env is incomplete');
}

const active = activeProvider === 'supabase'
  ? await import('./db-supabase.js')
  : await import('./db-sqlite.js');

export const createOrder = (...args) => active.createOrder(...args);
export const getOrder = (...args) => active.getOrder(...args);
export const listOrders = (...args) => active.listOrders(...args);
export const listAdminOrderSummaries = (...args) => active.listAdminOrderSummaries(...args);
export const listOrdersByUser = (...args) => active.listOrdersByUser(...args);
export const countOrders = (...args) => active.countOrders(...args);
export const listOrderIdentityRows = (...args) => active.listOrderIdentityRows(...args);
export const listDeliveredOrderTimingRows = (...args) => active.listDeliveredOrderTimingRows(...args);
export const listExpiredOrderReservations = (...args) => active.listExpiredOrderReservations(...args);
export const updateOrder = (...args) => active.updateOrder(...args);
export const saveMessage = (...args) => active.saveMessage(...args);
export const listMessagesSince = (...args) => active.listMessagesSince(...args);
export const listChatSessions = (...args) => active.listChatSessions(...args);
export const listChatMessages = (...args) => active.listChatMessages(...args);
export const deleteChatSession = (...args) => active.deleteChatSession(...args);
export const findLatestOrderBySessionId = (...args) => active.findLatestOrderBySessionId(...args);

export const createUser = (...args) => active.createUser(...args);
export const getUserByEmail = (...args) => active.getUserByEmail(...args);
export const getUserById = (...args) => active.getUserById(...args);
export const listUsers = (...args) => active.listUsers(...args);
export const listAdminUsers = (...args) => active.listAdminUsers(...args);
export const countUsers = (...args) => active.countUsers(...args);
export const listUserIdentityRows = (...args) => active.listUserIdentityRows(...args);
export const createToken = (...args) => active.createToken(...args);
export const getToken = (...args) => active.getToken(...args);
export const deleteToken = (...args) => active.deleteToken(...args);
export const updateUser = (...args) => active.updateUser(...args);
export const deleteUser = (...args) => active.deleteUser(...args);
export const countAdmins = (...args) => active.countAdmins(...args);

export const listCoupons = (...args) => active.listCoupons(...args);
export const getCoupon = (...args) => active.getCoupon(...args);
export const createCoupon = (...args) => active.createCoupon(...args);
export const updateCoupon = (...args) => active.updateCoupon(...args);
export const deleteCoupon = (...args) => active.deleteCoupon(...args);
export const incCouponUse = (...args) => active.incCouponUse(...args);

export const createLead = (...args) => active.createLead(...args);
export const getLead = (...args) => active.getLead(...args);
export const listLeads = (...args) => active.listLeads(...args);
export const listAdminLeads = (...args) => active.listAdminLeads(...args);
export const countLeads = (...args) => active.countLeads(...args);
export const listLeadIdentityRows = (...args) => active.listLeadIdentityRows(...args);
export const updateLead = (...args) => active.updateLead(...args);

export const getProduct = (...args) => active.getProduct(...args);
export const listProducts = (...args) => active.listProducts(...args);
export const listProductsByIds = (...args) => active.listProductsByIds(...args);
export const countProducts = (...args) => active.countProducts(...args);
export const createProduct = (...args) => active.createProduct(...args);
export const updateProduct = (...args) => active.updateProduct(...args);
export const deleteProduct = (...args) => active.deleteProduct(...args);
export const adjustStock = (...args) => active.adjustStock(...args);
export const reserveOrderResources = (...args) => active.reserveOrderResources(...args);
export const releaseOrderResources = (...args) => active.releaseOrderResources(...args);
export const getPaymentLog = (...args) => active.getPaymentLog(...args);
export const upsertPaymentLog = (...args) => active.upsertPaymentLog(...args);

export const getSetting = (...args) => active.getSetting(...args);
export const setSetting = (...args) => active.setSetting(...args);
export const allSettings = (...args) => active.allSettings(...args);
export const getStoreSetting = (...args) => (typeof active.getStoreSetting === 'function' ? active.getStoreSetting(...args) : Promise.resolve(undefined));
export const setStoreSetting = (...args) => (typeof active.setStoreSetting === 'function' ? active.setStoreSetting(...args) : Promise.resolve());
export const allStoreSettings = (...args) => (typeof active.allStoreSettings === 'function' ? active.allStoreSettings(...args) : Promise.resolve({}));
export const getDefaultStore = (...args) => (typeof active.getDefaultStore === 'function' ? active.getDefaultStore(...args) : Promise.resolve(null));
export const getStore = (...args) => (typeof active.getStore === 'function' ? active.getStore(...args) : Promise.resolve(null));
export const getStoreByHost = (...args) => (typeof active.getStoreByHost === 'function' ? active.getStoreByHost(...args) : Promise.resolve(null));
export const listStores = (...args) => (typeof active.listStores === 'function' ? active.listStores(...args) : Promise.resolve([]));
export const isStoreSubdomainAvailable = (...args) => (typeof active.isStoreSubdomainAvailable === 'function' ? active.isStoreSubdomainAvailable(...args) : Promise.resolve(false));
export const createStore = (...args) => (typeof active.createStore === 'function' ? active.createStore(...args) : Promise.resolve(null));
export const addStoreDomain = (...args) => (typeof active.addStoreDomain === 'function' ? active.addStoreDomain(...args) : Promise.resolve(null));
export const listStoreDomains = (...args) => (typeof active.listStoreDomains === 'function' ? active.listStoreDomains(...args) : Promise.resolve([]));
export const createStoreDatabase = (...args) => (typeof active.createStoreDatabase === 'function' ? active.createStoreDatabase(...args) : Promise.resolve(null));
export const getStoreDatabase = (...args) => (typeof active.getStoreDatabase === 'function' ? active.getStoreDatabase(...args) : Promise.resolve(null));
export const listStoreDatabases = (...args) => (typeof active.listStoreDatabases === 'function' ? active.listStoreDatabases(...args) : Promise.resolve([]));
export const deleteStoreCascade = (...args) => {
  if (typeof active.deleteStoreCascade !== 'function') return Promise.reject(new Error('provider นี้ยังไม่รองรับการลบร้าน'));
  return active.deleteStoreCascade(...args);
};
export const addUserStoreRole = (...args) => (typeof active.addUserStoreRole === 'function' ? active.addUserStoreRole(...args) : Promise.resolve());
export const listUserStoreRoles = (...args) => (typeof active.listUserStoreRoles === 'function' ? active.listUserStoreRoles(...args) : Promise.resolve([]));

export const addReview = (...args) => active.addReview(...args);
export const listReviews = (...args) => active.listReviews(...args);
export const reviewStats = (...args) => active.reviewStats(...args);
export const allReviewStats = (...args) => active.allReviewStats(...args);
export const getAdminOrderAnalytics = (...args) => active.getAdminOrderAnalytics(...args);
export const getAdminDashboardStats = (...args) => active.getAdminDashboardStats(...args);
export const userReviewed = (...args) => active.userReviewed(...args);

export const createArticle = (...args) => active.createArticle(...args);
export const getArticle = (...args) => active.getArticle(...args);
export const listArticles = (...args) => active.listArticles(...args);
export const updateArticle = (...args) => active.updateArticle(...args);
export const deleteArticle = (...args) => active.deleteArticle(...args);
export const createCommunityPost = (...args) => (typeof active.createCommunityPost === 'function' ? active.createCommunityPost(...args) : Promise.resolve(null));
export const getCommunityPost = (...args) => (typeof active.getCommunityPost === 'function' ? active.getCommunityPost(...args) : Promise.resolve(null));
export const listCommunityPosts = (...args) => (typeof active.listCommunityPosts === 'function' ? active.listCommunityPosts(...args) : Promise.resolve([]));
export const updateCommunityPostStatus = (...args) => (typeof active.updateCommunityPostStatus === 'function' ? active.updateCommunityPostStatus(...args) : Promise.resolve(null));
export const deleteCommunityPost = (...args) => (typeof active.deleteCommunityPost === 'function' ? active.deleteCommunityPost(...args) : Promise.resolve());
export const createCommunityComment = (...args) => (typeof active.createCommunityComment === 'function' ? active.createCommunityComment(...args) : Promise.resolve(null));
export const listCommunityComments = (...args) => (typeof active.listCommunityComments === 'function' ? active.listCommunityComments(...args) : Promise.resolve([]));
export const setCommunityReaction = (...args) => (typeof active.setCommunityReaction === 'function' ? active.setCommunityReaction(...args) : Promise.resolve(null));
export const setCommunitySave = (...args) => (typeof active.setCommunitySave === 'function' ? active.setCommunitySave(...args) : Promise.resolve(null));
export const createCommunityStory = (...args) => (typeof active.createCommunityStory === 'function' ? active.createCommunityStory(...args) : Promise.resolve(null));
export const listCommunityStories = (...args) => (typeof active.listCommunityStories === 'function' ? active.listCommunityStories(...args) : Promise.resolve([]));
export const deleteCommunityStory = (...args) => (typeof active.deleteCommunityStory === 'function' ? active.deleteCommunityStory(...args) : Promise.resolve());
export const seedCommunityFromArticles = (...args) => (typeof active.seedCommunityFromArticles === 'function' ? active.seedCommunityFromArticles(...args) : Promise.resolve({ posts: 0, stories: 0, totalArticles: 0 }));

const chatSessionMetaStore = new Map();
const lineWebhookEventStore = new Map();
const lineWebhookAuditStore = [];

export async function listAllChatSessionMeta() {
  if (typeof active.listAllChatSessionMeta === 'function') return active.listAllChatSessionMeta();
  return Object.fromEntries(chatSessionMetaStore.entries());
}

export async function getChatSessionMeta(sessionId) {
  if (typeof active.getChatSessionMeta === 'function') return active.getChatSessionMeta(sessionId);
  const key = String(sessionId || '').trim();
  return key ? (chatSessionMetaStore.get(key) || null) : null;
}

export async function upsertChatSessionMeta(sessionId, meta = {}) {
  if (typeof active.upsertChatSessionMeta === 'function') return active.upsertChatSessionMeta(sessionId, meta);
  const key = String(sessionId || '').trim();
  if (!key) return null;
  const current = chatSessionMetaStore.get(key) || {};
  const next = { ...current, ...(meta && typeof meta === 'object' ? meta : {}) };
  chatSessionMetaStore.set(key, next);
  return next;
}

export async function deleteChatSessionMeta(sessionId) {
  if (typeof active.deleteChatSessionMeta === 'function') return active.deleteChatSessionMeta(sessionId);
  const key = String(sessionId || '').trim();
  if (!key) return false;
  return chatSessionMetaStore.delete(key);
}

export async function claimLineWebhookEvent(eventKey, processedAt = Date.now()) {
  if (typeof active.claimLineWebhookEvent === 'function') return active.claimLineWebhookEvent(eventKey, processedAt);
  const key = String(eventKey || '').trim();
  if (!key) return { duplicate: false };
  if (lineWebhookEventStore.has(key)) return { duplicate: true, existing: lineWebhookEventStore.get(key) };
  const record = { eventKey: key, processedAt: Number(processedAt || Date.now()) || Date.now() };
  lineWebhookEventStore.set(key, record);
  return { duplicate: false, record };
}

export async function cleanupLineWebhookEvents(olderThan = 0) {
  if (typeof active.cleanupLineWebhookEvents === 'function') return active.cleanupLineWebhookEvents(olderThan);
  const cutoff = Number(olderThan || 0);
  let removed = 0;
  for (const [key, value] of lineWebhookEventStore.entries()) {
    if (Number(value?.processedAt || 0) < cutoff) {
      lineWebhookEventStore.delete(key);
      removed += 1;
    }
  }
  return removed;
}

export async function insertLineWebhookAudit(entry = {}) {
  if (typeof active.insertLineWebhookAudit === 'function') return active.insertLineWebhookAudit(entry);
  lineWebhookAuditStore.unshift({ ...(entry && typeof entry === 'object' ? entry : {}) });
  if (lineWebhookAuditStore.length > 1000) lineWebhookAuditStore.length = 1000;
  return true;
}

export async function listLineWebhookAudits(limit = 100) {
  if (typeof active.listLineWebhookAudits === 'function') return active.listLineWebhookAudits(limit);
  const size = Math.max(0, Number(limit || 0) || 100);
  return lineWebhookAuditStore.slice(0, size);
}

export async function cleanupLineWebhookAudits(olderThan = 0) {
  if (typeof active.cleanupLineWebhookAudits === 'function') return active.cleanupLineWebhookAudits(olderThan);
  const cutoff = Number(olderThan || 0);
  const kept = lineWebhookAuditStore.filter((item) => Number(item?.at || 0) >= cutoff);
  const removed = lineWebhookAuditStore.length - kept.length;
  lineWebhookAuditStore.length = 0;
  lineWebhookAuditStore.push(...kept);
  return removed;
}

export default active.default || null;
