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
  createOrder, getOrder, listOrders, listOrdersByUser, updateOrder, saveMessage, listMessagesSince,
  createUser, getUserByEmail, getUserById, listUsers, createToken, deleteToken,
  updateUser, deleteUser, countAdmins,
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  getSetting, setSetting, allSettings,
  listCoupons, getCoupon, createCoupon, updateCoupon, deleteCoupon, incCouponUse,
  addReview, listReviews, reviewStats, allReviewStats, userReviewed,
  adjustStock,
  createLead, getLead, listLeads, updateLead,
  createArticle, getArticle, listArticles, updateArticle, deleteArticle,
  activeProvider,
} from './db.js';
import { hashPassword, verifyPassword, newToken, authMiddleware, requireAuth, requireAdmin, publicUser, hasValidAdminKey, withResolvedAdminRole } from './auth.js';
import { promptPayPayload } from './promptpay.js';
import { isSupabaseConfigured, uploadPublicAsset } from './supabase-client.js';
import { sendVisitorMessage, verifyBridgeRequest, isBridgeConfigured } from './lineoa-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const uploadsDir = path.join(publicDir, 'uploads');
const isServerless = Boolean(process.env.VERCEL);
if (!isServerless) fs.mkdirSync(uploadsDir, { recursive: true });

const { PORT = 3000 } = process.env;
console.log(`[bootstrap] db provider active=${activeProvider} requested=${process.env.DB_PROVIDER || 'sqlite'} force=${process.env.FORCE_SUPABASE || 'false'}`);

// config: cache ค่า settings จาก DB ไว้ใน memory เพื่อให้ helper ใช้งานแบบ sync ได้
let settingsCache = {};
async function refreshSettingsCache() {
  settingsCache = await allSettings();
  return settingsCache;
}
function cfg(key) {
  const v = settingsCache[key];
  return v ? v : (process.env[key] || '');
}
function lineClient() { const t = cfg('LINE_CHANNEL_ACCESS_TOKEN'); return t ? new line.messagingApi.MessagingApiClient({ channelAccessToken: t }) : null; }
function adminUserId() { return cfg('LINE_ADMIN_USER_ID'); }
function stripeClient() { const k = cfg('STRIPE_SECRET_KEY'); return k ? new Stripe(k) : null; }

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
setInterval(() => { const now = Date.now(); for (const [k, b] of _rl) if (now > b.reset) _rl.delete(k); }, 10 * 60000).unref?.();

// ──────────────────── สถานะออเดอร์ ────────────────────
const STATUS_LABEL = {
  awaiting_payment: 'รอชำระเงิน', paid: 'ชำระเงินแล้ว', preparing: 'กำลังเตรียมสินค้า',
  shipped: 'จัดส่งแล้ว', delivered: 'จัดส่งสำเร็จ', cancelled: 'ยกเลิก',
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
  dosage: '20-30 ซีซี ต่อน้ำ 20 ลิตร',
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
    specs: { 'ประเภท': 'อาหารเสริมพืช', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '20–30 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], usageSteps: ['ใช้ช่วงเร่งแตกยอดหรือเร่งการเจริญเติบโต', 'ฉีดพ่นทุก 7-10 วันตามความเหมาะสม', 'ใช้ต่อเนื่องร่วมกับการจัดการธาตุอาหารหลัก'], warnings: ['ไม่ควรฉีดช่วงแดดจัด', 'หลีกเลี่ยงการผสมกับผลิตภัณฑ์ที่มีความเป็นด่างสูง'], faq: faqPairs(['ใช้กับต้นอ่อนได้ไหม?', 'ใช้ได้ โดยลดอัตราเริ่มต้นและสังเกตการตอบสนองของพืช'], ['เหมาะกับช่วงไหนที่สุด?', 'ช่วงเร่งใบ แตกยอด และฟื้นต้นหลังเก็บเกี่ยว']) }), stock: 60 },
  { id: 'p2', name: 'นุชฟอร์ไลฟ์ 2', icon: 'drop', price: 450, tag: 'เกษตร', short: 'เพิ่มคุณภาพผล สี รสชาติ น้ำหนัก',
    desc: 'สูตรเพิ่มคุณภาพผลผลิต ช่วยเรื่องสี รสชาติ ขนาด และเพิ่มน้ำหนัก สะสมธาตุอาหารในผล เหมาะช่วงติดผล–ก่อนเก็บเกี่ยว',
    specs: { 'ประเภท': 'เพิ่มคุณภาพผลผลิต', 'ใช้กับ': 'ไม้ผล/พืชผัก', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '20–30 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], dosage: '20-30 ซีซี ต่อน้ำ 20 ลิตร ช่วงบำรุงผล', usageSteps: ['ใช้ช่วงติดผลถึงก่อนเก็บเกี่ยว', 'ฉีดพ่นให้เปียกทั่วทรงพุ่ม', 'ใช้ต่อเนื่องทุก 7-10 วัน'], faq: faqPairs(['ช่วยเรื่องสีและน้ำหนักผลไหม?', 'ออกแบบมาเพื่อช่วยเพิ่มคุณภาพผล สี รสชาติ และน้ำหนักเมื่อใช้ร่วมกับการจัดการปุ๋ยที่เหมาะสม'], ['ใช้ช่วงผลอ่อนได้ไหม?', 'ใช้ได้ โดยเริ่มจากอัตราแนะนำต่ำก่อนและสังเกตผล']) }), stock: 60 },
  { id: 'p3', name: 'นุชฟอร์ไลฟ์ 8', icon: 'shieldleaf', price: 480, tag: 'เกษตร', short: 'ต้านเครียด ลดดอก/ผลร่วง ใบไม่เหลือง',
    desc: 'สูตรเสริมความแข็งแรงของเซลล์พืช ช่วยให้พืชทนต่อสภาพเครียด ลดการหลุดร่วงของดอกและผล ป้องกันใบเหลือง',
    specs: { 'ประเภท': 'เสริมภูมิต้านทาน', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '20 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], dosage: '20 ซีซี ต่อน้ำ 20 ลิตร', usageSteps: ['ใช้ก่อนหรือระหว่างช่วงพืชเจอความเครียด', 'ฉีดซ้ำเมื่อสภาพอากาศแปรปรวน', 'ใช้ร่วมกับโปรแกรมบำรุงปกติได้'], faq: faqPairs(['ใช้หลังฝนตกหนักได้ไหม?', 'ใช้ได้เพื่อช่วยฟื้นต้นและลดอาการเครียดของพืช'], ['ช่วยลดผลร่วงหรือไม่?', 'เหมาะกับการช่วยดูแลพืชในช่วงเสี่ยงต่อการเครียดและการร่วง']) }), stock: 50 },
  { id: 'p4', name: 'นุชฟอร์ไลฟ์ 9', icon: 'leaf', price: 480, tag: 'เกษตร', short: 'ป้องกันใบจุด สนิม ดอกสม่ำเสมอ',
    desc: 'สูตรช่วยป้องกันอาการใบจุด แผลคล้ายสนิม และช่วยให้การออกดอกสม่ำเสมอ เสริมความสมบูรณ์ของใบและดอก',
    specs: { 'ประเภท': 'ป้องกันโรคพืช', 'ใช้กับ': 'พืชทุกชนิด', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '20 ซีซี/น้ำ 20 ลิตร' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], dosage: '20 ซีซี ต่อน้ำ 20 ลิตร', faq: faqPairs(['เหมาะกับพืชผักหรือไม่?', 'เหมาะกับพืชผักและไม้ผลในช่วงที่ต้องการดูแลความสมบูรณ์ของใบและดอก'], ['ควรใช้ถี่แค่ไหน?', 'ขึ้นกับสภาพแปลง โดยทั่วไปใช้ทุก 7-10 วันหรือตามโปรแกรมที่ปรึกษา']) }), stock: 50 },
  { id: 'p5', name: 'นุชฟอร์ไลฟ์ เน็ก-1', icon: 'bottle', price: 890, tag: 'เกษตร', short: 'อาหารเสริมทางใบ เร่งยอด บำรุงใบ (500cc)',
    desc: 'อาหารเสริมฉีดพ่นทางใบ ช่วยเร่งยอดและปลายให้แข็งแรง บำรุงใบให้สมบูรณ์ ป้องกันผลแตก ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'อาหารเสริมทางใบ', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿290)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'], labelNote: 'มีหลายขนาดบรรจุ กรุณาตรวจสอบฉลากขนาดก่อนสั่งซื้อ', faq: faqPairs(['เหมาะกับพืชช่วงไหน?', 'เหมาะกับช่วงเร่งยอดและบำรุงใบ'], ['มีขนาดอื่นไหม?', 'มีตัวเลือกขนาดเล็กเพิ่มเติม กรุณาสอบถามทีมงาน']) }), stock: 40 },
  { id: 'p6', name: 'นุชฟอร์ไลฟ์ เน็ก-2', icon: 'bottle', price: 890, tag: 'เกษตร', short: 'อาหารเสริมทางใบ บำรุงผล (500cc)',
    desc: 'อาหารเสริมฉีดพ่นทางใบสูตรบำรุงผล ช่วยให้ผลสมบูรณ์ ขนาดดี ป้องกันผลแตก ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'อาหารเสริมทางใบ', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿290)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง'], dosage: '20-30 ซีซี ต่อน้ำ 20 ลิตร ช่วงบำรุงผล', faq: faqPairs(['เหมาะกับไม้ผลชนิดใด?', 'เหมาะกับไม้ผลที่ต้องการดูแลคุณภาพและขนาดผล'], ['ควรเริ่มใช้เมื่อไร?', 'เริ่มใช้ตั้งแต่ระยะติดผลอ่อนและต่อเนื่องตามโปรแกรม']) }), stock: 40 },
  { id: 'p7', name: 'สารเสริมประสิทธิภาพจับใบ', icon: 'drop', price: 390, tag: 'เกษตร', short: 'ลดการชะล้างปุ๋ย/ยาในฤดูฝน (500cc)',
    desc: 'สารจับใบช่วยให้ปุ๋ยและยาเกาะติดใบได้ดี ลดการสูญเสียจากการชะล้างในฤดูฝน เพิ่มประสิทธิภาพการฉีดพ่น ขนาด 500 ซีซี',
    specs: { 'ขนาด': '500 ซีซี', 'ประเภท': 'สารจับใบ', 'วิธีใช้': 'ผสมร่วมกับปุ๋ย/ยา', 'หมายเหตุ': 'มีขนาด 100 ซีซี (฿139)' }, segment: 'agri',
    extra: agriExtra({ cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'], applicationMethod: 'ผสมร่วมกับปุ๋ยหรือผลิตภัณฑ์ฉีดพ่นอื่น', dosage: '5-10 ซีซี ต่อน้ำ 20 ลิตร หรือใช้ตามสูตรที่แนะนำ', usageSteps: ['เติมหลังจากผสมสารหลักเรียบร้อยแล้ว', 'คนให้เข้ากันก่อนฉีดพ่น', 'เหมาะกับช่วงหน้าฝนหรือเมื่อต้องการเพิ่มการเกาะใบ'], faq: faqPairs(['ใช้เดี่ยวๆ ได้ไหม?', 'โดยทั่วไปใช้เป็นสารเสริมร่วมกับผลิตภัณฑ์ฉีดพ่นอื่น'], ['ช่วยตอนหน้าฝนอย่างไร?', 'ช่วยลดการชะล้างและเพิ่มการเกาะติดใบ']) }), stock: 80 },
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
  if ((await listArticles(true)).length > 0) return;
  const A = [
    { id: 'a_welcome', title: 'ทำไมพืชต้องการอาหารเสริมทางใบ?', excerpt: 'การให้อาหารทางใบช่วยให้พืชดูดซึมธาตุอาหารได้เร็ว เห็นผลไว เสริมการให้ปุ๋ยทางดิน',
      body: 'การให้ธาตุอาหารทางใบ (foliar feeding) เป็นการเสริมธาตุอาหารให้พืชดูดซึมผ่านปากใบได้โดยตรง เห็นผลเร็วกว่าทางดิน เหมาะกับช่วงที่พืชต้องการธาตุอาหารเร่งด่วน เช่น ช่วงเร่งโต ติดดอก หรือบำรุงผล\n\nควรฉีดพ่นช่วงเช้าหรือเย็นที่อากาศไม่ร้อนจัด และผสมสารจับใบเพื่อให้เกาะติดใบได้ดี ลดการชะล้างจากน้ำค้างหรือฝน' },
    { id: 'a_rainy', title: 'ฉีดพ่นหน้าฝนอย่างไรให้คุ้มค่า', excerpt: 'ฤดูฝนปุ๋ยและยาถูกชะล้างง่าย การใช้สารจับใบช่วยลดการสูญเสียได้มาก',
      body: 'ในฤดูฝน น้ำฝนมักชะล้างปุ๋ยและยาที่ฉีดพ่นออกจากใบก่อนพืชจะดูดซึม ทำให้สิ้นเปลือง\n\nการผสม "สารเสริมประสิทธิภาพจับใบ" ช่วยให้ละอองยาเกาะติดผิวใบได้ดีขึ้น ทนต่อการชะล้าง เพิ่มประสิทธิภาพการดูดซึม และลดต้นทุนการฉีดซ้ำ' },
    { id: 'a_consult', title: 'ปรึกษานักวิชาการก่อนเลือกสูตร', excerpt: 'ไม่แน่ใจว่าพืชของคุณควรใช้สูตรไหน? ทักแชทปรึกษาทีมงานได้ฟรี',
      body: 'แต่ละช่วงการเจริญเติบโตของพืชต้องการธาตุอาหารต่างกัน การเลือกสูตรให้เหมาะกับชนิดพืชและช่วงอายุจะให้ผลลัพธ์ดีที่สุด\n\nหากไม่แน่ใจ สามารถกดปุ่มแชทมุมขวาล่างเพื่อปรึกษาทีมนักวิชาการของนุชฟอร์ไลฟ์ได้โดยตรง พร้อมแนะนำอัตราการใช้ที่เหมาะกับแปลงของคุณ' },
  ];
  for (const a of A) await createArticle(a);
  console.log('[seed] เพิ่มบทความเริ่มต้น', A.length, 'บทความ');
}

// ──────────────────── chat sessions (in-memory) ────────────────────
const sessions = new Map();
let lastActiveSession = null;
function makeSessionId() { let id; do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); } while (sessions.has(id)); return id; }

async function pushToAdmin(text) {
  const c = lineClient(); const to = adminUserId();
  if (!c || !to) return;
  try { await c.pushMessage({ to, messages: [{ type: 'text', text }] }); }
  catch (err) { console.error('[line] push fail:', err?.body || err.message); }
}
async function notifyCustomer(order, text) {
  if (!order?.session_id) return;
  const s = sessions.get(order.session_id);
  await saveMessage(order.session_id, 'admin', text);
  if (s) io.to(s.socketId).emit('chat:message', { from: 'admin', text, at: Date.now() });
}
async function buildPromptPay(amount) {
  const id = cfg('PROMPTPAY_ID'); if (!id) return null;
  const qr = await QRCode.toDataURL(promptPayPayload(id, amount), { width: 280, margin: 1 });
  return { qr, promptpayId: id, name: cfg('PROMPTPAY_NAME'), amount };
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
  };
  const a = map[action]; if (!a) return null;
  const prev = await getOrder(id); if (!prev) return null;
  const o = await updateOrder(id, a.patch); if (!o) return null;
  if (action === 'cancelled' && prev.status !== 'cancelled') {
    for (const it of o.items) await adjustStock(it.id, it.qty);
  }
  await notifyCustomer(o, `[ออเดอร์ ${id}] ${a.note}`);
  if (o.customer.email) await sendMail(o.customer.email, `อัปเดตออเดอร์ ${id} · ${STATUS_LABEL[o.status]}`, orderEmailHTML(o, `อัปเดตสถานะ: ${STATUS_LABEL[o.status]}`));
  return o;
}
async function markOrderPaid(id) {
  const o = await getOrder(id); if (!o || o.paid) return;
  await applyOrderAction(id, 'paid');
  await pushToAdmin(`💳 ออเดอร์ ${id} ชำระเงินแล้ว ฿${o.total.toLocaleString()}`);
}

// ════════════ LINE Webhook (ตรวจลายเซ็นแบบ dynamic) ════════════
app.post('/webhook/line', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = cfg('LINE_CHANNEL_SECRET');
  if (!secret) return res.status(200).end();
  const sig = crypto.createHmac('sha256', secret).update(req.body).digest('base64');
  if (sig !== req.headers['x-line-signature']) return res.status(401).end();
  res.status(200).end();
  let body; try { body = JSON.parse(req.body.toString('utf8')); } catch { return; }
  for (const event of body.events || []) {
    if (event.type === 'message' && event.message.type === 'text' && event.source.userId === adminUserId())
      handleAdminMessage(event.message.text.trim());
  }
});

async function handleAdminMessage(text) {
  const oc = text.match(/^#(orders|order|paid|prepare|ship|done|cancel)\b\s*([\s\S]*)$/i);
  if (oc) return handleOrderCommand(oc[1].toLowerCase(), oc[2].trim());
  if (/^#list\b/i.test(text)) {
    const lines = [...sessions.entries()].map(([id, s]) => `#${id} — ${s.name} (ล่าสุด ${timeAgo(s.lastActiveAt)})`);
    return pushToAdmin(lines.length ? 'ลูกค้าออนไลน์:\n' + lines.join('\n') : 'ยังไม่มีลูกค้าออนไลน์');
  }
  const tagged = text.match(/^#([A-Z0-9]{4})\s+([\s\S]+)$/i);
  let sessionId, reply;
  if (tagged) { sessionId = tagged[1].toUpperCase(); reply = tagged[2]; }
  else if (lastActiveSession && sessions.has(lastActiveSession)) { sessionId = lastActiveSession; reply = text; }
  else return pushToAdmin('ตอบไม่ได้ — ใส่รหัสห้องก่อนข้อความ เช่น #A3F2 สวัสดีครับ\nคำสั่ง: #list, #orders, #paid <id>, #ship <id> <เลขพัสดุ>');
  const session = sessions.get(sessionId);
  if (!session) return pushToAdmin(`ไม่พบห้อง #${sessionId} (ออฟไลน์แล้ว) — พิมพ์ #list`);
  await saveMessage(sessionId, 'admin', reply);
  io.to(session.socketId).emit('chat:message', { from: 'admin', text: reply, at: Date.now() });
}
async function handleOrderCommand(cmd, rest) {
  if (cmd === 'orders') {
    const list = await listOrders(15);
    if (!list.length) return pushToAdmin('ยังไม่มีออเดอร์');
    return pushToAdmin('ออเดอร์ล่าสุด:\n' + list.map((o) => `${o.id} · ${STATUS_LABEL[o.status]} · ฿${o.total.toLocaleString()} · ${o.customer.name}${o.payment_claimed && !o.paid ? ' ⚠️แจ้งโอน' : ''}`).join('\n'));
  }
  const parts = rest.split(/\s+/);
  const id = (parts.shift() || '').toUpperCase();
  const order = id && await getOrder(id);
  if (!order) return pushToAdmin(`ไม่พบออเดอร์ ${id || '(ไม่ระบุ)'}\nเช่น: #ship VYU-AB12CDE TH1234567890`);
  if (cmd === 'order') {
    return pushToAdmin(`${order.id} · ${STATUS_LABEL[order.status]}\n${order.items.map((it) => `• ${it.name} x${it.qty}`).join('\n')}\nรวม ฿${order.total.toLocaleString()} · ${order.payment_method === 'card' ? 'บัตร' : 'PromptPay'}${order.paid ? ' (จ่ายแล้ว)' : ''}\n👤 ${order.customer.name}\n📞 ${order.customer.phone}\n📦 ${order.customer.address}${order.tracking ? `\n🚚 ${order.tracking}` : ''}`);
  }
  const action = { paid: 'paid', prepare: 'preparing', ship: 'shipped', done: 'delivered', cancel: 'cancelled' }[cmd];
  const o = await applyOrderAction(id, action, parts.join(' ').trim());
  pushToAdmin(`✓ ${id}: ${STATUS_LABEL[o.status]}${o.tracking ? ` (${o.tracking})` : ''}`);
}

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
  if (req.path === '/webhook/line' || req.path === '/webhook/stripe') return next();
  return jsonParser(req, res, next);
});
app.use(express.static(publicDir, { etag: false, lastModified: false }));
app.use(authMiddleware);
app.use('/api/auth', authLimiter);

app.get('/api/health', (_req, res) => res.json({
  ok: true, lineConfigured: Boolean(lineClient() && adminUserId()),
  stripeConfigured: Boolean(stripeClient()), promptpayConfigured: Boolean(cfg('PROMPTPAY_ID')),
  mailConfigured: mailConfigured(),
  dbProvider: activeProvider,
  dbProviderRequested: process.env.DB_PROVIDER || 'sqlite',
  dbProviderForced: /^(1|true|yes|on)$/i.test(String(process.env.FORCE_SUPABASE || '').trim()),
  supabaseConfigured: isSupabaseConfigured(),
}));

// ──────────── LINE OA bridge callback (admin reply -> website widget) ────────────
// The bot POSTs here when the LINE OA admin replies `#<sessionId> text`.
app.post('/api/webhooks/lineoa-bridge', async (req, res) => {
  if (!verifyBridgeRequest(req, cfg)) return res.status(401).json({ error: 'unauthorized' });
  const b = req.body || {};
  const sessionId = String(b.website_session_id || b.session_id || '').trim().toUpperCase();
  const text = String(b.message?.content || b.text || '').trim();
  if (!sessionId || !text) return res.status(400).json({ error: 'missing session or text' });
  await saveMessage(sessionId, 'admin', text);
  const s = sessions.get(sessionId);
  if (s) io.to(s.socketId).emit('chat:message', { from: 'admin', text, at: Date.now() });
  res.json({ ok: true, delivered: Boolean(s) });
});

// ──────────── Live Chat (serverless-friendly: POST send + GET poll) ────────────
// แทน Socket.IO บน Vercel — visitor ส่งข้อความ + poll คำตอบแอดมินจาก LINE
const chatLimiter = rateLimit({ windowMs: 60000, max: 60 });
function makeChatSessionId() { return Math.random().toString(36).slice(2, 6).toUpperCase(); }
app.post('/api/chat/send', chatLimiter, async (req, res) => {
  const b = req.body || {};
  let sessionId = String(b.sessionId || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(sessionId)) sessionId = makeChatSessionId();
  const text = String(b.text || '').trim().slice(0, 1000);
  const name = String(b.name || '').trim().slice(0, 40) || `ลูกค้า-${sessionId}`;
  if (!text) return res.status(400).json({ error: 'ไม่มีข้อความ' });
  await saveMessage(sessionId, 'customer', text);
  if (isBridgeConfigured(cfg)) {
    try { await sendVisitorMessage(cfg, { sessionId, name, text }); }
    catch (err) { console.error('[chat] bridge fail:', err.message); await pushToAdmin(`[#${sessionId}] ${name}:\n${text}\n\n(ตอบกลับ: #${sessionId} ข้อความ)`); }
  } else {
    await pushToAdmin(`[#${sessionId}] ${name}:\n${text}\n\n(ตอบกลับ: #${sessionId} ข้อความ)`);
  }
  res.json({ ok: true, sessionId });
});
app.get('/api/chat/poll', async (req, res) => {
  const sessionId = String(req.query.session || '').trim().toUpperCase();
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
  SITE_HERO_TITLE: 'เพิ่มผลผลิต',
  SITE_HERO_ACCENT: 'อย่างแม่นยำ',
  SITE_HERO_TITLE2: 'ด้วยสูตรที่เหมาะกับพืช',
  SITE_HERO_SUB: 'ช่วยเกษตรกรเลือกสูตรที่ใช่ตามชนิดพืช ปัญหา และช่วงการเติบโต พร้อมจัดส่งไวและมีนักวิชาการให้คำแนะนำผ่าน LINE และ Live Chat',
  SITE_FOOTER: '© นุชฟอร์ไลฟ์ · ผลิตภัณฑ์เพื่อการเกษตรและสุขภาพ · จัดส่งทั่วไทย',
  SITE_TRUST_ITEMS: 'แนะนำสูตรตามพืชและช่วงการปลูกได้ชัดเจน\nมีฉลาก วิธีใช้ อัตราผสม และ FAQ ให้เปิดดูบนหน้าเว็บ\nปรึกษาทีมงานฟรีก่อนซื้อและตามต่อใน LINE ได้\nสั่งซื้อออนไลน์ ติดตามออเดอร์ และเช็กสถานะได้หลังชำระเงิน',
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
};
const SITE_KEYS = Object.keys(SITE_DEFAULTS);
const siteValue = (k) => settingsCache[k] || SITE_DEFAULTS[k];
const siteConfig = () => Object.fromEntries(SITE_KEYS.map((k) => [k, siteValue(k)]));
app.get('/api/site', (_req, res) => res.json(siteConfig()));

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
  return s.active ? Math.max(1, Math.round(p.price * (1 - s.percent / 100))) : p.price;
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
  const { email, password, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'กรอกอีเมลและรหัสผ่าน' });
  if (String(password).length < 6) return res.status(400).json({ error: 'รหัสผ่านอย่างน้อย 6 ตัวอักษร' });
  if (await getUserByEmail(email)) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้แล้ว' });
  const { salt, hash } = hashPassword(password);
  const user = await createUser({ id: 'u_' + crypto.randomBytes(6).toString('hex'), email: String(email).toLowerCase(), name: (name || '').trim() || String(email).split('@')[0], salt, hash, role: 'user' });
  const token = newToken(); await createToken(token, user.id);
  res.json({ token, user: publicUser(user) });
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password, adminKey } = req.body || {};
  const user = await getUserByEmail(email || '');
  if (!user || !verifyPassword(password || '', user.salt, user.hash)) return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
  if (adminKey && !hasValidAdminKey(adminKey)) return res.status(403).json({ error: 'คีย์แอดมินไม่ถูกต้อง' });
  const token = newToken(); await createToken(token, user.id);
  res.json({ token, user: publicUser(withResolvedAdminRole(user, adminKey)) });
});
app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));
app.post('/api/auth/logout', async (req, res) => { if (req.token) await deleteToken(req.token); res.json({ ok: true }); });

// ──────────── products (public) ────────────
app.get('/api/products', async (_req, res) => {
  const st = await allReviewStats(); const sale = saleConfig();
  res.json((await listProducts(false)).map((p) => ({ ...p, rating: st[p.id]?.avg || 0, reviews: st[p.id]?.count || 0, salePrice: sale.active ? effPrice(p) : 0 })));
});
app.get('/api/products/:id', async (req, res) => {
  const p = await getProduct(req.params.id);
  if (!p || !p.active) return res.status(404).json({ error: 'ไม่พบสินค้า' });
  const s = await reviewStats(p.id); const sale = saleConfig();
  res.json({ ...p, rating: s.avg, reviews: s.count, salePrice: sale.active ? effPrice(p) : 0 });
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
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'ไม่มีสินค้าในคำสั่งซื้อ' });
  if (!customer?.name?.trim() || !customer?.phone?.trim() || !customer?.address?.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบ' });
  const method = payment === 'card' ? 'card' : 'promptpay';
  const stripe = stripeClient();
  if (method === 'card' && !stripe) return res.status(400).json({ error: 'ระบบบัตรยังไม่พร้อม (ยังไม่ได้ตั้งค่า Stripe)' });
  if (method === 'promptpay' && !cfg('PROMPTPAY_ID')) return res.status(400).json({ error: 'ระบบ PromptPay ยังไม่พร้อม (ยังไม่ได้ตั้งค่า PromptPay ID)' });

  let subtotal = 0; const detailed = []; const lines = [];
  for (const it of items) {
    const p = await getProduct(it.id); if (!p || !p.active) continue;
    const qty = Math.max(1, Math.min(99, parseInt(it.qty, 10) || 1));
    if (p.stock <= 0) return res.status(409).json({ error: `"${p.name}" สินค้าหมดแล้ว` });
    if (p.stock < qty) return res.status(409).json({ error: `"${p.name}" เหลือเพียง ${p.stock} ชิ้น` });
    const unit = effPrice(p);
    subtotal += unit * qty; detailed.push({ id: p.id, name: p.name, price: unit, qty });
    lines.push(`• ${p.name} x${qty} = ฿${(unit * qty).toLocaleString()}`);
  }
  if (!detailed.length) return res.status(400).json({ error: 'รายการสินค้าไม่ถูกต้อง' });

  const cp = await evalCoupon(coupon, subtotal);
  if (!cp.ok) return res.status(400).json({ error: cp.error });
  const discount = cp.discount || 0;
  const country = (customer.country || '').trim();
  const shipping = shippingFor(country, subtotal - discount);
  const total = subtotal - discount + shipping;

  const id = 'VYU-' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase().slice(-7);
  const cust = {
    name: customer.name.trim().slice(0, 80), phone: customer.phone.trim().slice(0, 30),
    address: customer.address.trim().slice(0, 400), note: (customer.note || '').trim().slice(0, 300),
    email: (customer.email || '').trim().slice(0, 120), country: country.slice(0, 60),
  };
  let order = await createOrder({ id, items: detailed, total, subtotal, discount, shipping, coupon: cp.coupon || '', customer: cust, payment_method: method, status: 'awaiting_payment', paid: false, session_id: typeof sessionId === 'string' ? sessionId : '', user_id: req.user?.id || '' });
  if (cp.coupon) await incCouponUse(cp.coupon);
  for (const it of detailed) await adjustStock(it.id, -it.qty);   // ตัดสต็อก

  const extra = {};
  if (method === 'card') {
    const base = cfg('PUBLIC_URL') || `${req.protocol}://${req.get('host')}`;
    const line_items = detailed.map((it) => ({ price_data: { currency: 'thb', product_data: { name: it.name }, unit_amount: it.price * 100 }, quantity: it.qty }));
    if (shipping > 0) line_items.push({ price_data: { currency: 'thb', product_data: { name: 'ค่าจัดส่ง' }, unit_amount: shipping * 100 }, quantity: 1 });
    if (discount > 0) line_items.push({ price_data: { currency: 'thb', product_data: { name: `ส่วนลด (${cp.coupon})` }, unit_amount: -discount * 100 }, quantity: 1 });
    const s = await stripe.checkout.sessions.create({ mode: 'payment', line_items, success_url: `${base}/#/order/${id}`, cancel_url: `${base}/#/order/${id}`, metadata: { orderId: id } });
    order = await updateOrder(id, { stripe_session: s.id }); extra.checkoutUrl = s.url;
  } else extra.promptpay = await buildPromptPay(total);

  await pushToAdmin(`🛒 ออเดอร์ใหม่  ${id}\n${lines.join('\n')}${discount ? `\nส่วนลด (${cp.coupon}): -฿${discount.toLocaleString()}` : ''}\nค่าส่ง: ฿${shipping.toLocaleString()}\nรวม: ฿${total.toLocaleString()}\n\n👤 ${cust.name}\n📞 ${cust.phone}${cust.email ? `\n✉️ ${cust.email}` : ''}\n📦 ${cust.address}${cust.country ? ` (${cust.country})` : ''}\n💳 ${method === 'card' ? 'บัตร' : 'PromptPay'}${cust.note ? `\n📝 ${cust.note}` : ''}\n\nสถานะ: รอชำระเงิน`);
  if (cust.email) await sendMail(cust.email, `ยืนยันคำสั่งซื้อ ${id} · ${siteValue('SITE_NAME')}`, orderEmailHTML(order, 'ได้รับคำสั่งซื้อของคุณแล้ว 🎉'));
  res.json({ ok: true, order, ...extra });
});
app.get('/api/orders/:id', async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  const out = { ...o, statusLabel: STATUS_LABEL[o.status] };
  if (o.payment_method === 'promptpay' && !o.paid) out.promptpay = await buildPromptPay(o.total);
  res.json(out);
});
app.post('/api/orders/:id/notify-payment', async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  if (o.paid) return res.json({ ok: true, order: o });
  const updated = await updateOrder(o.id, { payment_claimed: true });
  await pushToAdmin(`💰 ลูกค้าแจ้งชำระเงินแล้ว: ${o.id} ฿${o.total.toLocaleString()} (${o.customer.name})\nตรวจสอบแล้วยืนยัน: #paid ${o.id}`);
  res.json({ ok: true, order: updated });
});
app.post('/api/orders/:id/confirm-stripe', async (req, res) => {
  const o = await getOrder(req.params.id); const stripe = stripeClient();
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  if (o.paid) return res.json({ ok: true, order: o });
  if (stripe && o.stripe_session) {
    try { const s = await stripe.checkout.sessions.retrieve(o.stripe_session); if (s.payment_status === 'paid') await markOrderPaid(o.id); }
    catch (err) { console.error('[stripe] retrieve fail:', err.message); }
  }
  res.json({ ok: true, order: await getOrder(o.id) });
});
app.get('/api/my/orders', requireAuth, async (req, res) => res.json((await listOrdersByUser(req.user.id)).map((o) => ({ ...o, statusLabel: STATUS_LABEL[o.status] }))));

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
  if (isSupabaseConfigured()) {
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
const SETTING_KEYS = ['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'LINE_ADMIN_USER_ID', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PROMPTPAY_ID', 'PROMPTPAY_NAME', 'PUBLIC_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'];
const SECRET_KEYS = new Set(['LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SMTP_PASS']);

app.get('/api/admin/stats', requireAdmin, async (_req, res) => {
  const orders = await listOrders(2000);
  res.json({
    orders: orders.length,
    revenue: orders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0),
    pending: orders.filter((o) => !o.paid && o.status !== 'cancelled').length,
    leads: (await listLeads(5000)).length,
    users: (await listUsers()).length, products: (await listProducts(true)).length,
    recent: orders.slice(0, 6).map((o) => ({ id: o.id, total: o.total, status: o.status, statusLabel: STATUS_LABEL[o.status], name: o.customer.name })),
  });
});
app.get('/api/admin/products', requireAdmin, async (_req, res) => res.json(await listProducts(true)));
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
    const id = b.id || ('p_' + crypto.randomBytes(4).toString('hex'));
    const p = await createProduct({ id, name: b.name, tag: b.tag, price: parseInt(b.price, 10) || 0, short: b.short, desc: b.desc, specs: b.specs || {}, segment: b.segment || 'agri', extra, icon: b.icon || 'pod', image, video: (b.video || '').trim(), images, model: (b.model || '').trim(), stock: parseInt(b.stock, 10) || 0, active: b.active !== false, sort: parseInt(b.sort, 10) || 0 });
    res.json({ ok: true, product: p });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const patch = { ...b };
    if (b.price !== undefined) patch.price = parseInt(b.price, 10) || 0;
    if (b.stock !== undefined) patch.stock = parseInt(b.stock, 10) || 0;
    if (typeof b.image === 'string' && b.image.startsWith('data:')) patch.image = await saveAsset(b.image);
    if (Array.isArray(b.images)) {
      patch.images = (await Promise.all(b.images.map(async (im) => ((typeof im === 'string' && im.startsWith('data:')) ? saveAsset(im) : im)))).filter(Boolean);
    }
    if (b.extra && typeof b.extra === 'object' && !Array.isArray(b.extra) && typeof b.extra.labelUrl === 'string' && b.extra.labelUrl.startsWith('data:')) {
      patch.extra = { ...b.extra, labelUrl: await saveAsset(b.extra.labelUrl) };
    }
    const p = await updateProduct(req.params.id, patch);
    if (!p) return res.status(404).json({ error: 'ไม่พบสินค้า' });
    res.json({ ok: true, product: p });
  } catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => { await deleteProduct(req.params.id); res.json({ ok: true }); });

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

app.get('/api/admin/leads', requireAdmin, async (_req, res) => res.json(await listLeads(500)));
app.put('/api/admin/leads/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const cur = await getLead(id);
  if (!cur) return res.status(404).json({ error: 'ไม่พบลีด' });
  const status = ['new', 'contacted', 'qualified', 'won', 'lost'].includes(req.body?.status) ? req.body.status : cur.status;
  const note = req.body?.note !== undefined ? String(req.body.note).slice(0, 1000) : cur.note;
  const lead = await updateLead(id, { status, note });
  res.json({ ok: true, lead });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => res.json((await listOrders(500)).map((o) => ({ ...o, statusLabel: STATUS_LABEL[o.status] }))));
app.get('/api/admin/orders/:id', requireAdmin, async (req, res) => {
  const o = await getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'ไม่พบคำสั่งซื้อ' });
  let account = null;
  if (o.user_id) { const u = await getUserById(o.user_id); if (u) account = { id: u.id, email: u.email, name: u.name }; }
  res.json({ ...o, statusLabel: STATUS_LABEL[o.status], account });
});
app.post('/api/admin/orders/:id/status', requireAdmin, async (req, res) => {
  const { action, tracking } = req.body || {};
  const o = await applyOrderAction(req.params.id, action, tracking || '');
  if (!o) return res.status(400).json({ error: 'ไม่พบออเดอร์หรือสถานะไม่ถูกต้อง' });
  res.json({ ok: true, order: { ...o, statusLabel: STATUS_LABEL[o.status] } });
});
app.get('/api/admin/users', requireAdmin, async (_req, res) => res.json(await listUsers()));
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  const { name, role } = req.body || {};
  const newRole = role === 'admin' ? 'admin' : (role === 'user' ? 'user' : target.role);
  if (target.role === 'admin' && newRole !== 'admin' && await countAdmins() <= 1) return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คน' });
  const u = await updateUser(req.params.id, { name: name !== undefined ? String(name).slice(0, 80) : target.name, role: newRole });
  res.json({ ok: true, user: publicUser(u) });
});
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'ลบบัญชีตัวเองไม่ได้' });
  if (target.role === 'admin' && await countAdmins() <= 1) return res.status(400).json({ error: 'ต้องมีแอดมินอย่างน้อย 1 คน' });
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
  const orders = await listOrders(5000);
  const dayMs = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = today.getTime() - i * dayMs;
    const dayOrders = orders.filter((o) => o.createdAt >= start && o.createdAt < start + dayMs);
    series.push({
      date: new Date(start).toISOString().slice(0, 10),
      revenue: dayOrders.filter((o) => o.paid).reduce((s, o) => s + o.total, 0),
      orders: dayOrders.length,
    });
  }
  const paidOrders = orders.filter((o) => o.paid);
  const revenue = paidOrders.reduce((s, o) => s + o.total, 0);
  const statusBreakdown = {};
  for (const o of orders) statusBreakdown[o.status] = (statusBreakdown[o.status] || 0) + 1;
  const payment = { promptpay: orders.filter((o) => o.payment_method === 'promptpay').length, card: orders.filter((o) => o.payment_method === 'card').length };
  const prodMap = {};
  for (const o of orders) for (const it of o.items) { const m = prodMap[it.name] || { name: it.name, qty: 0, revenue: 0 }; m.qty += it.qty; m.revenue += it.price * it.qty; prodMap[it.name] = m; }
  const topProducts = Object.values(prodMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
  res.json({
    days, series,
    totals: { revenue, orders: orders.length, paidOrders: paidOrders.length, aov: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0, discountGiven: orders.reduce((s, o) => s + (o.discount || 0), 0) },
    statusBreakdown, payment, topProducts,
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
  res.json({ ok: true });
});
// ข้อมูลร้าน/แบรนด์สำหรับหลังบ้าน (ค่าจริง ไม่ปิดบัง)
app.get('/api/admin/site', requireAdmin, (_req, res) => res.json(siteConfig()));
app.post('/api/admin/test-line', requireAdmin, async (req, res) => {
  if (!lineClient() || !adminUserId()) return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า LINE token หรือ admin userId' });
  try { await pushToAdmin(`🔔 ทดสอบการเชื่อมต่อ LINE OA จากหลังบ้าน ${siteValue('SITE_NAME')} สำเร็จ`); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: 'ส่งไม่สำเร็จ: ' + (err?.message || '') }); }
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
  const sessionId = makeSessionId();
  sessions.set(sessionId, { socketId: socket.id, name: `ลูกค้า-${sessionId}`, lastActiveAt: Date.now() });
  socket.emit('chat:ready', { sessionId });
  socket.on('chat:setName', (name) => { const s = sessions.get(sessionId); if (s && typeof name === 'string' && name.trim()) s.name = name.trim().slice(0, 40); });
  socket.on('chat:message', async (payload) => {
    const text = typeof payload === 'string' ? payload : payload?.text;
    if (!text || !text.trim()) return;
    const clean = text.trim().slice(0, 1000);
    const s = sessions.get(sessionId); if (s) s.lastActiveAt = Date.now();
    lastActiveSession = sessionId;
    await saveMessage(sessionId, 'customer', clean);
    // Route the visitor message into the unified LINE OA so the admin sees and
    // replies from LINE; falls back to the legacy direct push if not configured.
    if (isBridgeConfigured(cfg)) {
      try {
        await sendVisitorMessage(cfg, { sessionId, name: s?.name || sessionId, text: clean });
      } catch (err) {
        console.error('[bridge] inbound fail:', err.message);
        await pushToAdmin(`[#${sessionId}] ${s?.name || sessionId}:\n${clean}\n\n(ตอบกลับ: #${sessionId} ข้อความ)`);
      }
    } else {
      await pushToAdmin(`[#${sessionId}] ${s?.name || sessionId}:\n${clean}\n\n(ตอบกลับ: #${sessionId} ข้อความ)`);
    }
  });
  socket.on('disconnect', () => { sessions.delete(sessionId); if (lastActiveSession === sessionId) lastActiveSession = null; });
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
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));  // SPA fallback + ซ่อนหน้า 404 ของเซิร์ฟเวอร์
app.use((err, _req, res, _next) => { console.error('[error]', err?.message); res.status(500).json({ error: 'เกิดข้อผิดพลาดภายในระบบ' }); });

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
      console.log(`  ✓ หลังบ้าน: http://localhost:${PORT}/#/admin${seededAdmin ? `  (แอดมิน: ${seededAdmin})` : ''}`);
      console.log(`  ✓ Webhook:  /webhook/line , /webhook/stripe\n`);
    }))
    .catch((err) => { console.error('[bootstrap]', err?.message || err); process.exit(1); });
}

export { app, ensureInit };
export default app;
