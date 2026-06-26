import './env.js';
import { isSupabaseConfigured } from './supabase-client.js';

// โหลด provider แบบ dynamic เพื่อให้ better-sqlite3 (native) ไม่ถูกโหลดบน Vercel
// serverless ตอนใช้ Supabase — ป้องกัน crash จาก native binding / การเขียนไฟล์
const requestedProvider = String(process.env.DB_PROVIDER || 'sqlite').trim().toLowerCase();
const forceSupabase = /^(1|true|yes|on)$/i.test(String(process.env.FORCE_SUPABASE || '').trim());

export const activeProvider = forceSupabase ? 'supabase' : requestedProvider;

if (activeProvider === 'supabase' && !isSupabaseConfigured()) {
  throw new Error('DB provider is forced to supabase but SUPABASE env is incomplete');
}

const active = activeProvider === 'supabase'
  ? await import('./db-supabase.js')
  : await import('./db-sqlite.js');

export const createOrder = (...args) => active.createOrder(...args);
export const getOrder = (...args) => active.getOrder(...args);
export const listOrders = (...args) => active.listOrders(...args);
export const listOrdersByUser = (...args) => active.listOrdersByUser(...args);
export const updateOrder = (...args) => active.updateOrder(...args);
export const saveMessage = (...args) => active.saveMessage(...args);
export const listMessagesSince = (...args) => active.listMessagesSince(...args);

export const createUser = (...args) => active.createUser(...args);
export const getUserByEmail = (...args) => active.getUserByEmail(...args);
export const getUserById = (...args) => active.getUserById(...args);
export const listUsers = (...args) => active.listUsers(...args);
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
export const updateLead = (...args) => active.updateLead(...args);

export const getProduct = (...args) => active.getProduct(...args);
export const listProducts = (...args) => active.listProducts(...args);
export const createProduct = (...args) => active.createProduct(...args);
export const updateProduct = (...args) => active.updateProduct(...args);
export const deleteProduct = (...args) => active.deleteProduct(...args);
export const adjustStock = (...args) => active.adjustStock(...args);

export const getSetting = (...args) => active.getSetting(...args);
export const setSetting = (...args) => active.setSetting(...args);
export const allSettings = (...args) => active.allSettings(...args);

export const addReview = (...args) => active.addReview(...args);
export const listReviews = (...args) => active.listReviews(...args);
export const reviewStats = (...args) => active.reviewStats(...args);
export const allReviewStats = (...args) => active.allReviewStats(...args);
export const userReviewed = (...args) => active.userReviewed(...args);

export const createArticle = (...args) => active.createArticle(...args);
export const getArticle = (...args) => active.getArticle(...args);
export const listArticles = (...args) => active.listArticles(...args);
export const updateArticle = (...args) => active.updateArticle(...args);
export const deleteArticle = (...args) => active.deleteArticle(...args);

export default active.default || null;
