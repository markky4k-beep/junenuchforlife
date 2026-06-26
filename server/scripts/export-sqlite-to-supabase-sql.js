import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const sqlitePath = process.env.SQLITE_DB_PATH || path.join(rootDir, 'data', 'app.db');
const schemaPath = path.join(rootDir, 'supabase', 'schema.sql');
const outputPath = process.env.SUPABASE_SQL_EXPORT_PATH || path.join(rootDir, 'supabase', 'sqlite-export.sql');

const TABLES = [
  {
    table: 'users',
    query: 'SELECT * FROM users ORDER BY created_at ASC',
    conflict: 'id',
    columns: ['id', 'email', 'name', 'salt', 'hash', 'role', 'created_at'],
    map: (row) => ({
      id: text(row.id),
      email: text(row.email),
      name: text(row.name || ''),
      salt: text(row.salt),
      hash: text(row.hash),
      role: text(row.role || 'user'),
      created_at: number(row.created_at),
    }),
  },
  {
    table: 'auth_tokens',
    query: 'SELECT * FROM auth_tokens ORDER BY created_at ASC',
    conflict: 'token',
    columns: ['token', 'user_id', 'created_at', 'expires_at'],
    map: (row) => ({
      token: text(row.token),
      user_id: text(row.user_id),
      created_at: number(row.created_at),
      expires_at: number(row.expires_at),
    }),
  },
  {
    table: 'products',
    query: 'SELECT * FROM products ORDER BY sort ASC, created_at ASC',
    conflict: 'id',
    columns: ['id', 'name', 'tag', 'price', 'short', 'description', 'specs', 'segment', 'extra', 'icon', 'image', 'video', 'images', 'model', 'stock', 'active', 'sort', 'created_at'],
    map: (row) => ({
      id: text(row.id),
      name: text(row.name),
      tag: text(row.tag || ''),
      price: number(row.price),
      short: text(row.short || ''),
      description: text(row.description || ''),
      specs: jsonb(row.specs, {}),
      segment: text(row.segment || 'agri'),
      extra: jsonb(row.extra, {}),
      icon: text(row.icon || 'pod'),
      image: text(row.image || ''),
      video: text(row.video || ''),
      images: jsonb(row.images, []),
      model: text(row.model || ''),
      stock: number(row.stock || 0),
      active: boolean(row.active),
      sort: number(row.sort || 0),
      created_at: number(row.created_at),
    }),
  },
  {
    table: 'settings',
    query: 'SELECT * FROM settings ORDER BY key ASC',
    conflict: 'key',
    columns: ['key', 'value'],
    map: (row) => ({
      key: text(row.key),
      value: text(row.value || ''),
    }),
  },
  {
    table: 'articles',
    query: 'SELECT * FROM articles ORDER BY created_at ASC',
    conflict: 'id',
    columns: ['id', 'title', 'cover', 'excerpt', 'body', 'published', 'created_at'],
    map: (row) => ({
      id: text(row.id),
      title: text(row.title),
      cover: text(row.cover || ''),
      excerpt: text(row.excerpt || ''),
      body: text(row.body || ''),
      published: boolean(row.published),
      created_at: number(row.created_at),
    }),
  },
  {
    table: 'coupons',
    query: 'SELECT * FROM coupons ORDER BY created_at ASC',
    conflict: 'code',
    columns: ['code', 'type', 'value', 'min_total', 'max_uses', 'used', 'active', 'expires_at', 'created_at'],
    map: (row) => ({
      code: text(row.code),
      type: text(row.type),
      value: number(row.value),
      min_total: number(row.min_total || 0),
      max_uses: number(row.max_uses || 0),
      used: number(row.used || 0),
      active: boolean(row.active),
      expires_at: number(row.expires_at || 0),
      created_at: number(row.created_at),
    }),
  },
  {
    table: 'leads',
    query: 'SELECT * FROM leads ORDER BY id ASC',
    conflict: 'id',
    columns: ['id', 'name', 'phone', 'line_id', 'province', 'crop', 'stage', 'area_rai', 'problem', 'source', 'landing_page', 'utm_source', 'utm_medium', 'utm_campaign', 'note', 'status', 'created_at', 'updated_at'],
    sequenceColumn: 'id',
    map: (row) => ({
      id: number(row.id),
      name: text(row.name),
      phone: text(row.phone),
      line_id: text(row.line_id || ''),
      province: text(row.province || ''),
      crop: text(row.crop || ''),
      stage: text(row.stage || ''),
      area_rai: text(row.area_rai || ''),
      problem: text(row.problem || ''),
      source: text(row.source || ''),
      landing_page: text(row.landing_page || ''),
      utm_source: text(row.utm_source || ''),
      utm_medium: text(row.utm_medium || ''),
      utm_campaign: text(row.utm_campaign || ''),
      note: text(row.note || ''),
      status: text(row.status || 'new'),
      created_at: number(row.created_at),
      updated_at: number(row.updated_at),
    }),
  },
  {
    table: 'orders',
    query: 'SELECT * FROM orders ORDER BY created_at ASC',
    conflict: 'id',
    columns: ['id', 'items', 'total', 'subtotal', 'discount', 'shipping', 'coupon', 'customer', 'payment_method', 'status', 'paid', 'payment_claimed', 'tracking', 'session_id', 'stripe_session', 'user_id', 'created_at', 'updated_at'],
    map: (row) => ({
      id: text(row.id),
      items: jsonb(row.items, []),
      total: number(row.total),
      subtotal: number((row.subtotal ?? row.total) || 0),
      discount: number(row.discount || 0),
      shipping: number(row.shipping || 0),
      coupon: text(row.coupon || ''),
      customer: jsonb(row.customer, {}),
      payment_method: text(row.payment_method),
      status: text(row.status),
      paid: boolean(row.paid),
      payment_claimed: boolean(row.payment_claimed),
      tracking: text(row.tracking || ''),
      session_id: text(row.session_id || ''),
      stripe_session: text(row.stripe_session || ''),
      user_id: text(row.user_id || ''),
      created_at: number(row.created_at),
      updated_at: number(row.updated_at),
    }),
  },
  {
    table: 'messages',
    query: 'SELECT * FROM messages ORDER BY id ASC',
    conflict: 'id',
    columns: ['id', 'session_id', 'sender', 'text', 'at'],
    sequenceColumn: 'id',
    map: (row) => ({
      id: number(row.id),
      session_id: text(row.session_id),
      sender: text(row.sender),
      text: text(row.text),
      at: number(row.at),
    }),
  },
  {
    table: 'reviews',
    query: 'SELECT * FROM reviews ORDER BY id ASC',
    conflict: 'id',
    columns: ['id', 'product_id', 'user_id', 'name', 'rating', 'comment', 'created_at'],
    sequenceColumn: 'id',
    map: (row) => ({
      id: number(row.id),
      product_id: text(row.product_id),
      user_id: text(row.user_id),
      name: text(row.name || ''),
      rating: number(row.rating),
      comment: text(row.comment || ''),
      created_at: number(row.created_at),
    }),
  },
];

function escapeSqlString(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function text(value) {
  return `'${escapeSqlString(value)}'`;
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? String(n) : '0';
}

function boolean(value) {
  return value ? 'true' : 'false';
}

function jsonb(value, fallback) {
  let parsed = fallback;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value || 'null') : value;
  } catch {
    parsed = fallback;
  }
  return `'${escapeSqlString(JSON.stringify(parsed ?? fallback))}'::jsonb`;
}

function chunk(items, size) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

function buildUpsertSql(def, rows) {
  if (!rows.length) return '';
  const updateCols = def.columns.filter((col) => col !== def.conflict);
  const updateSql = updateCols.map((col) => `${col} = excluded.${col}`).join(', ');
  const chunks = chunk(rows, 100);
  return chunks.map((batch) => {
    const values = batch.map((row) => `(${def.columns.map((col) => row[col]).join(', ')})`).join(',\n  ');
    return `insert into public.${def.table} (${def.columns.join(', ')})\nvalues\n  ${values}\non conflict (${def.conflict}) do update set ${updateSql};`;
  }).join('\n\n');
}

function buildSequenceSql(def, rows) {
  if (!def.sequenceColumn || !rows.length) return '';
  return `select setval(pg_get_serial_sequence('public.${def.table}', '${def.sequenceColumn}'), coalesce((select max(${def.sequenceColumn}) from public.${def.table}), 0), true);`;
}

if (!fs.existsSync(sqlitePath)) {
  console.error(`[error] ไม่พบฐานข้อมูล SQLite ที่ ${sqlitePath}`);
  process.exit(1);
}

if (!fs.existsSync(schemaPath)) {
  console.error(`[error] ไม่พบไฟล์ schema ที่ ${schemaPath}`);
  process.exit(1);
}

const db = new Database(sqlitePath, { readonly: true });
const schemaSql = fs.readFileSync(schemaPath, 'utf8').trim();
const sections = [
  '-- Generated by export-sqlite-to-supabase-sql.js',
  `-- Source SQLite: ${sqlitePath}`,
  `-- Generated at: ${new Date().toISOString()}`,
  '',
  'begin;',
  '',
  schemaSql,
];

for (const def of TABLES) {
  const rows = db.prepare(def.query).all().map(def.map);
  sections.push('', `-- ${def.table}: ${rows.length} rows`);
  if (!rows.length) continue;
  sections.push(buildUpsertSql(def, rows));
  const sequenceSql = buildSequenceSql(def, rows);
  if (sequenceSql) sections.push(sequenceSql);
}

sections.push('', 'commit;', '');

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, sections.join('\n'), 'utf8');
db.close();

console.log(`[done] Exported SQL file: ${outputPath}`);
