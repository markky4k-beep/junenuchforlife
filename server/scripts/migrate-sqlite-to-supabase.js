import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { createSupabaseAdminClient, requireSupabaseServiceRole, supabaseEnv } from '../supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const sqlitePath = process.env.SQLITE_DB_PATH || path.join(rootDir, 'data', 'app.db');
const BATCH_SIZE = parseInt(process.env.SUPABASE_MIGRATION_BATCH_SIZE || '200', 10) || 200;

const TABLES = [
  {
    name: 'users',
    query: 'SELECT * FROM users ORDER BY created_at ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      email: row.email,
      name: row.name || '',
      salt: row.salt,
      hash: row.hash,
      role: row.role || 'user',
      created_at: row.created_at,
    }),
  },
  {
    name: 'auth_tokens',
    query: 'SELECT * FROM auth_tokens ORDER BY created_at ASC',
    key: 'token',
    map: (row) => ({
      token: row.token,
      user_id: row.user_id,
      created_at: row.created_at,
      expires_at: row.expires_at,
    }),
  },
  {
    name: 'products',
    query: 'SELECT * FROM products ORDER BY sort ASC, created_at ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      name: row.name,
      tag: row.tag || '',
      price: row.price,
      short: row.short || '',
      description: row.description || '',
      specs: parseJson(row.specs, {}),
      segment: row.segment || 'agri',
      extra: parseJson(row.extra, {}),
      icon: row.icon || 'pod',
      image: row.image || '',
      video: row.video || '',
      images: parseJson(row.images, []),
      model: row.model || '',
      stock: row.stock || 0,
      active: Boolean(row.active),
      sort: row.sort || 0,
      created_at: row.created_at,
    }),
  },
  {
    name: 'settings',
    query: 'SELECT * FROM settings ORDER BY key ASC',
    key: 'key',
    map: (row) => ({ key: row.key, value: row.value || '' }),
  },
  {
    name: 'articles',
    query: 'SELECT * FROM articles ORDER BY created_at ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      title: row.title,
      cover: row.cover || '',
      excerpt: row.excerpt || '',
      body: row.body || '',
      published: Boolean(row.published),
      created_at: row.created_at,
    }),
  },
  {
    name: 'coupons',
    query: 'SELECT * FROM coupons ORDER BY created_at ASC',
    key: 'code',
    map: (row) => ({
      code: row.code,
      type: row.type,
      value: row.value,
      min_total: row.min_total || 0,
      max_uses: row.max_uses || 0,
      used: row.used || 0,
      active: Boolean(row.active),
      expires_at: row.expires_at || 0,
      created_at: row.created_at,
    }),
  },
  {
    name: 'leads',
    query: 'SELECT * FROM leads ORDER BY id ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      line_id: row.line_id || '',
      province: row.province || '',
      crop: row.crop || '',
      stage: row.stage || '',
      area_rai: row.area_rai || '',
      problem: row.problem || '',
      source: row.source || '',
      landing_page: row.landing_page || '',
      utm_source: row.utm_source || '',
      utm_medium: row.utm_medium || '',
      utm_campaign: row.utm_campaign || '',
      note: row.note || '',
      status: row.status || 'new',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },
  {
    name: 'orders',
    query: 'SELECT * FROM orders ORDER BY created_at ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      items: parseJson(row.items, []),
      total: row.total,
      subtotal: row.subtotal || row.total || 0,
      discount: row.discount || 0,
      shipping: row.shipping || 0,
      coupon: row.coupon || '',
      customer: parseJson(row.customer, {}),
      payment_method: row.payment_method,
      status: row.status,
      paid: Boolean(row.paid),
      payment_claimed: Boolean(row.payment_claimed),
      tracking: row.tracking || '',
      session_id: row.session_id || '',
      stripe_session: row.stripe_session || '',
      user_id: row.user_id || '',
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  },
  {
    name: 'messages',
    query: 'SELECT * FROM messages ORDER BY id ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      session_id: row.session_id,
      sender: row.sender,
      text: row.text,
      at: row.at,
    }),
  },
  {
    name: 'reviews',
    query: 'SELECT * FROM reviews ORDER BY id ASC',
    key: 'id',
    map: (row) => ({
      id: row.id,
      product_id: row.product_id,
      user_id: row.user_id,
      name: row.name || '',
      rating: row.rating,
      comment: row.comment || '',
      created_at: row.created_at,
    }),
  },
];

function parseJson(value, fallback) {
  try {
    if (value == null || value === '') return fallback;
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function upsertTable(supabase, table) {
  const rows = sqlite.prepare(table.query).all().map(table.map);
  if (!rows.length) {
    console.log(`[skip] ${table.name}: ไม่มีข้อมูล`);
    return;
  }
  console.log(`[migrate] ${table.name}: ${rows.length} records`);
  for (const batch of chunk(rows, BATCH_SIZE)) {
    const { error } = await supabase.from(table.name).upsert(batch, { onConflict: table.key });
    if (error) throw new Error(`${table.name}: ${error.message}`);
  }
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`[error] ไม่พบฐานข้อมูล SQLite ที่ ${sqlitePath}`);
  process.exit(1);
}

const { url } = supabaseEnv();
if (!url) {
  console.error('[error] ยังไม่ได้ตั้งค่า SUPABASE_URL');
  process.exit(1);
}

try {
  requireSupabaseServiceRole();
} catch (err) {
  console.error(`[error] ${err.message}`);
  console.error('[hint] ใส่ SUPABASE_SERVICE_ROLE_KEY ในไฟล์ .env ก่อนรันคำสั่ง migrate:supabase');
  process.exit(1);
}

const sqlite = new Database(sqlitePath, { readonly: true });
const supabase = createSupabaseAdminClient();

console.log(`[start] SQLite -> Supabase`);
console.log(`[sqlite] ${sqlitePath}`);
console.log(`[supabase] ${url}`);

try {
  for (const table of TABLES) {
    await upsertTable(supabase, table);
  }
  console.log('[done] ย้ายข้อมูลจาก SQLite ไป Supabase เรียบร้อย');
} catch (err) {
  console.error('[failed]', err.message || err);
  process.exitCode = 1;
} finally {
  sqlite.close();
}
