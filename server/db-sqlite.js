import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, items TEXT NOT NULL, total INTEGER NOT NULL, customer TEXT NOT NULL,
    payment_method TEXT NOT NULL, status TEXT NOT NULL, paid INTEGER DEFAULT 0,
    payment_claimed INTEGER DEFAULT 0, tracking TEXT DEFAULT '', session_id TEXT DEFAULT '',
    stripe_session TEXT DEFAULT '', user_id TEXT DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, sender TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT DEFAULT '',
    salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT DEFAULT 'user', created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, tag TEXT DEFAULT '', price INTEGER NOT NULL,
    short TEXT DEFAULT '', description TEXT DEFAULT '', specs TEXT DEFAULT '{}',
    segment TEXT DEFAULT 'agri', extra TEXT DEFAULT '{}',
    icon TEXT DEFAULT 'pod', image TEXT DEFAULT '', video TEXT DEFAULT '', images TEXT DEFAULT '[]', model TEXT DEFAULT '', stock INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1, sort INTEGER DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT DEFAULT '' );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT, product_id TEXT NOT NULL, user_id TEXT NOT NULL,
    name TEXT DEFAULT '', rating INTEGER NOT NULL, comment TEXT DEFAULT '', created_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY, type TEXT NOT NULL, value INTEGER NOT NULL,
    min_total INTEGER DEFAULT 0, max_uses INTEGER DEFAULT 0, used INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1, expires_at INTEGER DEFAULT 0, created_at INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    line_id TEXT DEFAULT '',
    province TEXT DEFAULT '',
    crop TEXT DEFAULT '',
    stage TEXT DEFAULT '',
    area_rai TEXT DEFAULT '',
    problem TEXT DEFAULT '',
    source TEXT DEFAULT '',
    landing_page TEXT DEFAULT '',
    utm_source TEXT DEFAULT '',
    utm_medium TEXT DEFAULT '',
    utm_campaign TEXT DEFAULT '',
    note TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS payment_logs (
    order_id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT '',
    product TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    bank_name TEXT DEFAULT '',
    account_name TEXT DEFAULT '',
    account_number TEXT DEFAULT '',
    status TEXT DEFAULT '',
    slip_file_path TEXT DEFAULT '',
    slip_message_id TEXT DEFAULT '',
    slip_received_at TEXT DEFAULT '',
    verification_message TEXT DEFAULT '',
    verification_payload TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
  );
`);

// migrations เผื่อ orders เก่าไม่มีคอลัมน์ใหม่
const orderCols = db.prepare(`PRAGMA table_info(orders)`).all().map((c) => c.name);
const addCol = (name, def) => { if (!orderCols.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${def}`); };
addCol('user_id', `TEXT DEFAULT ''`);
addCol('subtotal', `INTEGER DEFAULT 0`);
addCol('discount', `INTEGER DEFAULT 0`);
addCol('coupon', `TEXT DEFAULT ''`);
addCol('shipping', `INTEGER DEFAULT 0`);
addCol('access_token', `TEXT DEFAULT ''`);
addCol('resources_reserved', `INTEGER DEFAULT 0`);
addCol('channel', `TEXT DEFAULT 'web'`);
addCol('line_user_id', `TEXT DEFAULT ''`);
// migration: products.video
const productCols = db.prepare(`PRAGMA table_info(products)`).all().map((c) => c.name);
if (!productCols.includes('video')) db.exec(`ALTER TABLE products ADD COLUMN video TEXT DEFAULT ''`);
if (!productCols.includes('images')) db.exec(`ALTER TABLE products ADD COLUMN images TEXT DEFAULT '[]'`);
if (!productCols.includes('model')) db.exec(`ALTER TABLE products ADD COLUMN model TEXT DEFAULT ''`);
if (!productCols.includes('segment')) db.exec(`ALTER TABLE products ADD COLUMN segment TEXT DEFAULT 'agri'`);
if (!productCols.includes('extra')) db.exec(`ALTER TABLE products ADD COLUMN extra TEXT DEFAULT '{}'`);
db.exec(`CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, cover TEXT DEFAULT '', excerpt TEXT DEFAULT '',
  body TEXT DEFAULT '', published INTEGER DEFAULT 1, created_at INTEGER NOT NULL
);`);

// ───────────── orders ─────────────
function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id, items: JSON.parse(r.items), total: r.total, subtotal: r.subtotal || r.total, discount: r.discount || 0, shipping: r.shipping || 0, coupon: r.coupon || '',
    customer: JSON.parse(r.customer),
    payment_method: r.payment_method, status: r.status, paid: !!r.paid, payment_claimed: !!r.payment_claimed,
    tracking: r.tracking, session_id: r.session_id, stripe_session: r.stripe_session, user_id: r.user_id, channel: r.channel || 'web', line_user_id: r.line_user_id || '', accessToken: r.access_token || '',
    resourcesReserved: !!r.resources_reserved,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function orderItemQty(item = {}) {
  const qty = parseInt(item?.qty, 10) || 0;
  return qty > 0 ? qty : 1;
}
function orderItemsSummary(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  const parts = items
    .slice(0, 3)
    .map((item) => `${String(item?.name || 'สินค้า').trim()}×${orderItemQty(item)}`);
  if (items.length > 3) parts.push(`+${items.length - 3} รายการ`);
  return parts.join(', ');
}
function orderToAdminSummary(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return {
    id: order?.id || '',
    total: Number(order?.total || 0),
    payment_method: order?.payment_method || '',
    status: order?.status || '',
    paid: !!order?.paid,
    payment_claimed: !!order?.payment_claimed,
    tracking: order?.tracking || '',
    createdAt: order?.createdAt || 0,
    user_id: order?.user_id || '',
    channel: order?.channel || 'web',
    line_user_id: order?.line_user_id || '',
    customerName: String(order?.customer?.name || '').trim(),
    customerPhone: String(order?.customer?.phone || '').trim(),
    itemCount: items.reduce((sum, item) => sum + orderItemQty(item), 0),
    itemSummary: orderItemsSummary(items),
  };
}
function normalizeAdminSearch(value = '') {
  return String(value || '').trim().slice(0, 80);
}
function buildAdminOrderWhere({ search = '', status = '' } = {}) {
  const clauses = [];
  const params = [];
  const normalizedStatus = String(status || '').trim();
  if (normalizedStatus) {
    clauses.push(`status = ?`);
    params.push(normalizedStatus);
  }
  const normalizedSearch = normalizeAdminSearch(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    clauses.push(`(
      id LIKE ? COLLATE NOCASE OR
      tracking LIKE ? COLLATE NOCASE OR
      json_extract(customer, '$.name') LIKE ? COLLATE NOCASE OR
      json_extract(customer, '$.phone') LIKE ? COLLATE NOCASE
    )`);
    params.push(like, like, like, like);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}
function buildAdminUserWhere({ search = '', role = '' } = {}) {
  const clauses = [];
  const params = [];
  const normalizedRole = String(role || '').trim();
  if (normalizedRole) {
    clauses.push(`role = ?`);
    params.push(normalizedRole);
  }
  const normalizedSearch = normalizeAdminSearch(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    clauses.push(`(
      id LIKE ? COLLATE NOCASE OR
      email LIKE ? COLLATE NOCASE OR
      name LIKE ? COLLATE NOCASE
    )`);
    params.push(like, like, like);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}
function buildAdminLeadWhere({ search = '', status = '' } = {}) {
  const clauses = [];
  const params = [];
  const normalizedStatus = String(status || '').trim();
  if (normalizedStatus) {
    clauses.push(`status = ?`);
    params.push(normalizedStatus);
  }
  const normalizedSearch = normalizeAdminSearch(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    clauses.push(`(
      name LIKE ? COLLATE NOCASE OR
      phone LIKE ? COLLATE NOCASE OR
      line_id LIKE ? COLLATE NOCASE OR
      province LIKE ? COLLATE NOCASE OR
      crop LIKE ? COLLATE NOCASE OR
      source LIKE ? COLLATE NOCASE
    )`);
    params.push(like, like, like, like, like, like);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}
const S = {
  insOrder: db.prepare(`INSERT INTO orders (id,items,total,subtotal,discount,shipping,coupon,customer,payment_method,status,paid,payment_claimed,tracking,session_id,stripe_session,user_id,channel,line_user_id,access_token,resources_reserved,created_at,updated_at)
    VALUES (@id,@items,@total,@subtotal,@discount,@shipping,@coupon,@customer,@payment_method,@status,@paid,@payment_claimed,@tracking,@session_id,@stripe_session,@user_id,@channel,@line_user_id,@access_token,@resources_reserved,@created_at,@updated_at)`),
  adjStock: db.prepare(`UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ?`),
  getOrder: db.prepare(`SELECT * FROM orders WHERE id=?`),
  listOrders: db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`),
  listOrdersByUser: db.prepare(`SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT ?`),
  listExpiredReservations: db.prepare(`SELECT * FROM orders WHERE paid=0 AND payment_claimed=0 AND resources_reserved=1 AND status='awaiting_payment' AND created_at < ? ORDER BY created_at ASC LIMIT ?`),
  updOrder: db.prepare(`UPDATE orders SET status=@status,paid=@paid,payment_claimed=@payment_claimed,tracking=@tracking,stripe_session=@stripe_session,resources_reserved=@resources_reserved,updated_at=@updated_at WHERE id=@id`),
  insMsg: db.prepare(`INSERT INTO messages (session_id,sender,text,at) VALUES (?,?,?,?)`),
  // users
  insUser: db.prepare(`INSERT INTO users (id,email,name,salt,hash,role,created_at) VALUES (@id,@email,@name,@salt,@hash,@role,@created_at)`),
  userByEmail: db.prepare(`SELECT * FROM users WHERE email=?`),
  userById: db.prepare(`SELECT * FROM users WHERE id=?`),
  listUsers: db.prepare(`SELECT id,email,name,role,created_at FROM users ORDER BY created_at DESC`),
  // tokens
  insToken: db.prepare(`INSERT INTO auth_tokens (token,user_id,created_at,expires_at) VALUES (?,?,?,?)`),
  getToken: db.prepare(`SELECT * FROM auth_tokens WHERE token=?`),
  delToken: db.prepare(`DELETE FROM auth_tokens WHERE token=?`),
  // products
  insProduct: db.prepare(`INSERT INTO products (id,name,tag,price,short,description,specs,segment,extra,icon,image,video,images,model,stock,active,sort,created_at)
    VALUES (@id,@name,@tag,@price,@short,@description,@specs,@segment,@extra,@icon,@image,@video,@images,@model,@stock,@active,@sort,@created_at)`),
  getProduct: db.prepare(`SELECT * FROM products WHERE id=?`),
  listProductsAll: db.prepare(`SELECT * FROM products ORDER BY sort ASC, created_at ASC`),
  listProductsActive: db.prepare(`SELECT * FROM products WHERE active=1 ORDER BY sort ASC, created_at ASC`),
  updProduct: db.prepare(`UPDATE products SET name=@name,tag=@tag,price=@price,short=@short,description=@description,specs=@specs,segment=@segment,extra=@extra,icon=@icon,image=@image,video=@video,images=@images,model=@model,stock=@stock,active=@active,sort=@sort WHERE id=@id`),
  delProduct: db.prepare(`DELETE FROM products WHERE id=?`),
  // settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  allSettings: db.prepare(`SELECT key,value FROM settings`),
  // reviews
  insReview: db.prepare(`INSERT INTO reviews (product_id,user_id,name,rating,comment,created_at) VALUES (?,?,?,?,?,?)`),
  listReviews: db.prepare(`SELECT * FROM reviews WHERE product_id=? ORDER BY created_at DESC`),
  reviewStat: db.prepare(`SELECT COUNT(*) c, AVG(rating) a FROM reviews WHERE product_id=?`),
  allReviewStats: db.prepare(`SELECT product_id, COUNT(*) c, AVG(rating) a FROM reviews GROUP BY product_id`),
  userReviewed: db.prepare(`SELECT id FROM reviews WHERE product_id=? AND user_id=? LIMIT 1`),
  // articles
  insArticle: db.prepare(`INSERT INTO articles (id,title,cover,excerpt,body,published,created_at) VALUES (@id,@title,@cover,@excerpt,@body,@published,@created_at)`),
  getArticle: db.prepare(`SELECT * FROM articles WHERE id=?`),
  listArticlesAll: db.prepare(`SELECT * FROM articles ORDER BY created_at DESC`),
  listArticlesPub: db.prepare(`SELECT * FROM articles WHERE published=1 ORDER BY created_at DESC`),
  updArticle: db.prepare(`UPDATE articles SET title=@title,cover=@cover,excerpt=@excerpt,body=@body,published=@published WHERE id=@id`),
  delArticle: db.prepare(`DELETE FROM articles WHERE id=?`),
  // user update/delete
  updUser: db.prepare(`UPDATE users SET name=@name, role=@role WHERE id=@id`),
  delUser: db.prepare(`DELETE FROM users WHERE id=?`),
  countAdmins: db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`),
  // coupons
  insCoupon: db.prepare(`INSERT INTO coupons (code,type,value,min_total,max_uses,used,active,expires_at,created_at)
    VALUES (@code,@type,@value,@min_total,@max_uses,0,@active,@expires_at,@created_at)`),
  getCoupon: db.prepare(`SELECT * FROM coupons WHERE code=?`),
  listCoupons: db.prepare(`SELECT * FROM coupons ORDER BY created_at DESC`),
  updCoupon: db.prepare(`UPDATE coupons SET type=@type,value=@value,min_total=@min_total,max_uses=@max_uses,active=@active,expires_at=@expires_at WHERE code=@code`),
  delCoupon: db.prepare(`DELETE FROM coupons WHERE code=?`),
  incCoupon: db.prepare(`UPDATE coupons SET used=used+1 WHERE code=?`),
  // leads
  insLead: db.prepare(`INSERT INTO leads (name,phone,line_id,province,crop,stage,area_rai,problem,source,landing_page,utm_source,utm_medium,utm_campaign,note,status,created_at,updated_at)
    VALUES (@name,@phone,@line_id,@province,@crop,@stage,@area_rai,@problem,@source,@landing_page,@utm_source,@utm_medium,@utm_campaign,@note,@status,@created_at,@updated_at)`),
  listLeads: db.prepare(`SELECT * FROM leads ORDER BY created_at DESC LIMIT ?`),
  getLead: db.prepare(`SELECT * FROM leads WHERE id=?`),
  updLead: db.prepare(`UPDATE leads SET name=@name,phone=@phone,line_id=@line_id,province=@province,crop=@crop,stage=@stage,area_rai=@area_rai,problem=@problem,source=@source,landing_page=@landing_page,utm_source=@utm_source,utm_medium=@utm_medium,utm_campaign=@utm_campaign,note=@note,status=@status,updated_at=@updated_at WHERE id=@id`),
  getPaymentLog: db.prepare(`SELECT * FROM payment_logs WHERE order_id=?`),
  upsertPaymentLog: db.prepare(`INSERT INTO payment_logs (order_id,user_id,product,amount,bank_name,account_name,account_number,status,slip_file_path,slip_message_id,slip_received_at,verification_message,verification_payload,updated_at)
    VALUES (@order_id,@user_id,@product,@amount,@bank_name,@account_name,@account_number,@status,@slip_file_path,@slip_message_id,@slip_received_at,@verification_message,@verification_payload,@updated_at)
    ON CONFLICT(order_id) DO UPDATE SET
      user_id=excluded.user_id,
      product=excluded.product,
      amount=excluded.amount,
      bank_name=excluded.bank_name,
      account_name=excluded.account_name,
      account_number=excluded.account_number,
      status=excluded.status,
      slip_file_path=excluded.slip_file_path,
      slip_message_id=excluded.slip_message_id,
      slip_received_at=excluded.slip_received_at,
      verification_message=excluded.verification_message,
      verification_payload=excluded.verification_payload,
      updated_at=excluded.updated_at`),
};
const _listChatSessions = db.prepare(`
  SELECT
    m.session_id,
    MAX(m.at) AS last_at,
    MAX(CASE WHEN m.sender = 'customer' THEN m.at ELSE 0 END) AS last_customer_at,
    (SELECT x.sender FROM messages x WHERE x.session_id = m.session_id ORDER BY x.at DESC, x.id DESC LIMIT 1) AS last_sender,
    (SELECT x.text FROM messages x WHERE x.session_id = m.session_id ORDER BY x.at DESC, x.id DESC LIMIT 1) AS last_text,
    SUM(CASE WHEN m.sender = 'customer' THEN 1 ELSE 0 END) AS customer_count,
    SUM(CASE WHEN m.sender = 'admin' THEN 1 ELSE 0 END) AS admin_count
  FROM messages m
  WHERE (? = '' OR m.session_id LIKE ? OR m.text LIKE ?)
  GROUP BY m.session_id
  ORDER BY last_at DESC
  LIMIT ? OFFSET ?
`);
const _countChatSessions = db.prepare(`
  SELECT COUNT(*) AS total FROM (
    SELECT m.session_id
    FROM messages m
    WHERE (? = '' OR m.session_id LIKE ? OR m.text LIKE ?)
    GROUP BY m.session_id
  ) t
`);
const _chatMessages = db.prepare(`SELECT id, session_id, sender, text, at FROM messages WHERE session_id=? ORDER BY at ASC, id ASC LIMIT ?`);
const _deleteChatMessagesBySession = db.prepare(`DELETE FROM messages WHERE session_id=?`);
const _latestOrderBySession = db.prepare(`SELECT * FROM orders WHERE session_id=? ORDER BY created_at DESC LIMIT 1`);

export function createOrder(o) {
  const now = Date.now();
  S.insOrder.run({
    id: o.id, items: JSON.stringify(o.items), total: o.total, subtotal: o.subtotal ?? o.total, discount: o.discount || 0, shipping: o.shipping || 0, coupon: o.coupon || '',
    customer: JSON.stringify(o.customer),
    payment_method: o.payment_method, status: o.status, paid: o.paid ? 1 : 0, payment_claimed: 0,
    tracking: o.tracking || '', session_id: o.session_id || '', stripe_session: o.stripe_session || '',
    user_id: o.user_id || '', channel: o.channel || 'web', line_user_id: o.line_user_id || '', access_token: o.access_token || '', resources_reserved: o.resources_reserved === false ? 0 : 1, created_at: now, updated_at: now,
  });
  return getOrder(o.id);
}
export function getOrder(id) { return rowToOrder(S.getOrder.get(id)); }
export function listOrders(limit = 50) { return S.listOrders.all(limit).map(rowToOrder); }
export function listAdminOrderSummaries(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminOrderWhere(filters);
  return db.prepare(`SELECT * FROM orders${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset).map(rowToOrder).map(orderToAdminSummary);
}
export function listOrdersByUser(uid, limit = 50) { return S.listOrdersByUser.all(uid, limit).map(rowToOrder); }
export function countOrders({ paid, status, deliveredOnly = false, search = '' } = {}) {
  const clauses = [];
  const params = [];
  if (paid !== undefined) { clauses.push(`paid = ?`); params.push(paid ? 1 : 0); }
  const normalizedStatus = deliveredOnly ? 'delivered' : String(status || '').trim();
  if (normalizedStatus) { clauses.push(`status = ?`); params.push(normalizedStatus); }
  const normalizedSearch = normalizeAdminSearch(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    clauses.push(`(
      id LIKE ? COLLATE NOCASE OR
      tracking LIKE ? COLLATE NOCASE OR
      json_extract(customer, '$.name') LIKE ? COLLATE NOCASE OR
      json_extract(customer, '$.phone') LIKE ? COLLATE NOCASE
    )`);
    params.push(like, like, like, like);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`SELECT COUNT(*) n FROM orders${where}`).get(...params).n;
}
export function listOrderIdentityRows() {
  return db.prepare(`SELECT status, customer FROM orders ORDER BY created_at DESC`).all().map((row) => ({ status: row.status, customer: JSON.parse(row.customer || '{}') }));
}
export function listDeliveredOrderTimingRows() {
  return db.prepare(`SELECT created_at, updated_at FROM orders WHERE status='delivered' ORDER BY created_at DESC`).all();
}
export function listExpiredOrderReservations(beforeTs, limit = 50) { return S.listExpiredReservations.all(beforeTs, limit).map(rowToOrder); }
export function updateOrder(id, patch) {
  const cur = getOrder(id);
  if (!cur) return null;
  S.updOrder.run({
    id, status: patch.status ?? cur.status, paid: (patch.paid ?? cur.paid) ? 1 : 0,
    payment_claimed: (patch.payment_claimed ?? cur.payment_claimed) ? 1 : 0,
    tracking: patch.tracking ?? cur.tracking, stripe_session: patch.stripe_session ?? cur.stripe_session,
    resources_reserved: (patch.resources_reserved ?? cur.resourcesReserved) ? 1 : 0,
    updated_at: Date.now(),
  });
  return getOrder(id);
}

const reserveOrderResourcesTx = db.transaction(({ items = [], coupon = '' } = {}) => {
  for (const item of items) {
    const id = String(item?.id || '').trim();
    const qty = Math.max(1, parseInt(item?.qty, 10) || 0);
    if (!id || !qty) continue;
    const info = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`).run(qty, id, qty);
    if (!info.changes) throw new Error(`สินค้าไม่พอสำหรับ ${id}`);
  }
  const code = String(coupon || '').trim().toUpperCase();
  if (code) {
    const info = db.prepare(`UPDATE coupons SET used = used + 1 WHERE code = ? AND (max_uses <= 0 OR used < max_uses)`).run(code);
    if (!info.changes) throw new Error(`คูปอง ${code} ใช้งานไม่ได้แล้ว`);
  }
});

const releaseOrderResourcesTx = db.transaction(({ items = [], coupon = '' } = {}) => {
  for (const item of items) {
    const id = String(item?.id || '').trim();
    const qty = Math.max(1, parseInt(item?.qty, 10) || 0);
    if (!id || !qty) continue;
    db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`).run(qty, id);
  }
  const code = String(coupon || '').trim().toUpperCase();
  if (code) db.prepare(`UPDATE coupons SET used = MAX(0, used - 1) WHERE code = ?`).run(code);
});

export function reserveOrderResources(payload) { reserveOrderResourcesTx(payload || {}); }
export function releaseOrderResources(payload) { releaseOrderResourcesTx(payload || {}); }

function rowToPaymentLog(r) {
  if (!r) return null;
  return {
    order_id: r.order_id,
    user_id: r.user_id || '',
    product: r.product || '',
    amount: r.amount || 0,
    bank_name: r.bank_name || '',
    account_name: r.account_name || '',
    account_number: r.account_number || '',
    status: r.status || '',
    slip_file_path: r.slip_file_path || '',
    slip_message_id: r.slip_message_id || '',
    slip_received_at: r.slip_received_at || '',
    verification_message: r.verification_message || '',
    verification_payload: r.verification_payload || '',
    updated_at: r.updated_at || '',
  };
}

export function getPaymentLog(orderId) {
  return rowToPaymentLog(S.getPaymentLog.get(String(orderId || '').trim()));
}

export function upsertPaymentLog(orderId, patch = {}) {
  const payload = {
    order_id: String(orderId || '').trim(),
    user_id: '',
    product: '',
    amount: 0,
    bank_name: '',
    account_name: '',
    account_number: '',
    status: '',
    slip_file_path: '',
    slip_message_id: '',
    slip_received_at: '',
    verification_message: '',
    verification_payload: '',
    updated_at: new Date().toISOString(),
    ...(getPaymentLog(orderId) || {}),
    ...patch,
    order_id: String(orderId || '').trim(),
    updated_at: new Date().toISOString(),
  };
  S.upsertPaymentLog.run(payload);
  return getPaymentLog(orderId);
}
export function saveMessage(sessionId, sender, text, at = Date.now()) { S.insMsg.run(sessionId, sender, text, at); }
const _msgsSince = db.prepare(`SELECT sender, text, at FROM messages WHERE session_id=? AND at>? ORDER BY at ASC LIMIT 100`);
export function listMessagesSince(sessionId, after = 0) { return _msgsSince.all(String(sessionId || ''), Number(after) || 0); }
export function listChatSessions({ search = '', limit = 20, offset = 0 } = {}) {
  const normalizedSearch = String(search || '').trim().slice(0, 80);
  const like = normalizedSearch ? `%${normalizedSearch}%` : '';
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const items = _listChatSessions.all(normalizedSearch, like, like, safeLimit, safeOffset).map((row) => ({
    session_id: row.session_id,
    last_at: Number(row.last_at || 0),
    last_customer_at: Number(row.last_customer_at || 0),
    last_sender: String(row.last_sender || '').trim(),
    last_text: String(row.last_text || '').trim(),
    customer_count: Number(row.customer_count || 0),
    admin_count: Number(row.admin_count || 0),
  }));
  const total = Number(_countChatSessions.get(normalizedSearch, like, like)?.total || 0);
  return { items, total };
}
export function listChatMessages(sessionId, limit = 200) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  return _chatMessages.all(String(sessionId || '').trim(), safeLimit);
}
export function deleteChatSession(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return false;
  _deleteChatMessagesBySession.run(normalizedSessionId);
  return true;
}
export function findLatestOrderBySessionId(sessionId) {
  return rowToOrder(_latestOrderBySession.get(String(sessionId || '').trim()));
}

// ───────────── users / tokens ─────────────
export function createUser(u) { S.insUser.run({ ...u, created_at: Date.now() }); return getUserById(u.id); }
export function getUserByEmail(email) { return S.userByEmail.get(String(email).toLowerCase()); }
export function getUserById(id) { return S.userById.get(id); }
export function listUsers() { return S.listUsers.all(); }
export function listAdminUsers(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminUserWhere(filters);
  return db.prepare(`SELECT id,email,name,role,created_at FROM users${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset);
}
export function countUsers({ search = '', role = '' } = {}) {
  const { sql, params } = buildAdminUserWhere({ search, role });
  return db.prepare(`SELECT COUNT(*) n FROM users${sql}`).get(...params).n;
}
export function listUserIdentityRows() { return S.listUsers.all().map((u) => ({ id: u.id, email: u.email, role: u.role })); }
export function createToken(token, userId, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  S.insToken.run(token, userId, Date.now(), Date.now() + ttlMs);
}
export function getToken(token) { return S.getToken.get(token); }
export function deleteToken(token) { S.delToken.run(token); }
export function updateUser(id, patch) {
  const u = getUserById(id); if (!u) return null;
  S.updUser.run({ id, name: patch.name ?? u.name, role: patch.role ?? u.role });
  return getUserById(id);
}
export function deleteUser(id) { S.delUser.run(id); }
export function countAdmins() { return S.countAdmins.get().n; }

// ───────────── coupons ─────────────
function rowToCoupon(r) {
  if (!r) return null;
  return { code: r.code, type: r.type, value: r.value, minTotal: r.min_total, maxUses: r.max_uses, used: r.used, active: !!r.active, expiresAt: r.expires_at, createdAt: r.created_at };
}
export function listCoupons() { return S.listCoupons.all().map(rowToCoupon); }
export function getCoupon(code) { return rowToCoupon(S.getCoupon.get(String(code).toUpperCase())); }
export function createCoupon(c) {
  S.insCoupon.run({ code: String(c.code).toUpperCase(), type: c.type === 'fixed' ? 'fixed' : 'percent', value: parseInt(c.value, 10) || 0, min_total: parseInt(c.minTotal, 10) || 0, max_uses: parseInt(c.maxUses, 10) || 0, active: c.active === false ? 0 : 1, expires_at: parseInt(c.expiresAt, 10) || 0, created_at: Date.now() });
  return getCoupon(c.code);
}
export function updateCoupon(code, c) {
  const cur = getCoupon(code); if (!cur) return null;
  S.updCoupon.run({ code: String(code).toUpperCase(), type: c.type ?? cur.type, value: c.value !== undefined ? parseInt(c.value, 10) || 0 : cur.value, min_total: c.minTotal !== undefined ? parseInt(c.minTotal, 10) || 0 : cur.minTotal, max_uses: c.maxUses !== undefined ? parseInt(c.maxUses, 10) || 0 : cur.maxUses, active: (c.active ?? cur.active) ? 1 : 0, expires_at: c.expiresAt !== undefined ? parseInt(c.expiresAt, 10) || 0 : cur.expiresAt });
  return getCoupon(code);
}
export function deleteCoupon(code) { S.delCoupon.run(String(code).toUpperCase()); }
export function incCouponUse(code) { S.incCoupon.run(String(code).toUpperCase()); }

// ───────────── leads ─────────────
function rowToLead(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    lineId: r.line_id || '',
    province: r.province || '',
    crop: r.crop || '',
    stage: r.stage || '',
    areaRai: r.area_rai || '',
    problem: r.problem || '',
    source: r.source || '',
    landingPage: r.landing_page || '',
    utmSource: r.utm_source || '',
    utmMedium: r.utm_medium || '',
    utmCampaign: r.utm_campaign || '',
    note: r.note || '',
    status: r.status || 'new',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export function createLead(lead) {
  const now = Date.now();
  const payload = {
    name: lead.name || '',
    phone: lead.phone || '',
    line_id: lead.lineId || '',
    province: lead.province || '',
    crop: lead.crop || '',
    stage: lead.stage || '',
    area_rai: lead.areaRai || '',
    problem: lead.problem || '',
    source: lead.source || '',
    landing_page: lead.landingPage || '',
    utm_source: lead.utmSource || '',
    utm_medium: lead.utmMedium || '',
    utm_campaign: lead.utmCampaign || '',
    note: lead.note || '',
    status: lead.status || 'new',
    created_at: now,
    updated_at: now,
  };
  const info = S.insLead.run(payload);
  return getLead(info.lastInsertRowid);
}
export function getLead(id) { return rowToLead(S.getLead.get(id)); }
export function listLeads(limit = 200) { return S.listLeads.all(limit).map(rowToLead); }
export function listAdminLeads(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminLeadWhere(filters);
  return db.prepare(`SELECT * FROM leads${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset).map(rowToLead);
}
export function countLeads({ search = '', status = '' } = {}) {
  const { sql, params } = buildAdminLeadWhere({ search, status });
  return db.prepare(`SELECT COUNT(*) n FROM leads${sql}`).get(...params).n;
}
export function listLeadIdentityRows() { return db.prepare(`SELECT name,phone,line_id,province FROM leads ORDER BY created_at DESC`).all(); }
export function updateLead(id, patch) {
  const cur = getLead(id);
  if (!cur) return null;
  S.updLead.run({
    id,
    name: patch.name ?? cur.name,
    phone: patch.phone ?? cur.phone,
    line_id: patch.lineId ?? cur.lineId,
    province: patch.province ?? cur.province,
    crop: patch.crop ?? cur.crop,
    stage: patch.stage ?? cur.stage,
    area_rai: patch.areaRai ?? cur.areaRai,
    problem: patch.problem ?? cur.problem,
    source: patch.source ?? cur.source,
    landing_page: patch.landingPage ?? cur.landingPage,
    utm_source: patch.utmSource ?? cur.utmSource,
    utm_medium: patch.utmMedium ?? cur.utmMedium,
    utm_campaign: patch.utmCampaign ?? cur.utmCampaign,
    note: patch.note ?? cur.note,
    status: patch.status ?? cur.status,
    updated_at: Date.now(),
  });
  return getLead(id);
}

// ───────────── products ─────────────
function rowToProduct(r) {
  if (!r) return null;
  return {
    id: r.id, name: r.name, tag: r.tag, price: r.price, short: r.short,
    desc: r.description, specs: JSON.parse(r.specs || '{}'), segment: r.segment || 'agri', extra: JSON.parse(r.extra || '{}'), icon: r.icon, image: r.image, video: r.video || '',
    images: JSON.parse(r.images || '[]'), model: r.model || '',
    stock: r.stock, active: !!r.active, sort: r.sort,
  };
}
export function getProduct(id) { return rowToProduct(S.getProduct.get(id)); }
export function listProducts(includeInactive = false) {
  return (includeInactive ? S.listProductsAll : S.listProductsActive).all().map(rowToProduct);
}
export function listProductsByIds(ids = [], includeInactive = false) {
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!cleanIds.length) return [];
  const placeholders = cleanIds.map(() => '?').join(',');
  const sql = `SELECT * FROM products WHERE id IN (${placeholders})${includeInactive ? '' : ' AND active=1'}`;
  return db.prepare(sql).all(...cleanIds).map(rowToProduct);
}
export function countProducts(includeInactive = false) {
  return db.prepare(`SELECT COUNT(*) n FROM products ${includeInactive ? '' : 'WHERE active=1'}`).get().n;
}
export function createProduct(p) {
  S.insProduct.run({
    id: p.id, name: p.name, tag: p.tag || '', price: p.price, short: p.short || '',
    description: p.desc || '', specs: JSON.stringify(p.specs || {}), segment: p.segment || 'agri', extra: JSON.stringify(p.extra || {}), icon: p.icon || 'pod',
    image: p.image || '', video: p.video || '', images: JSON.stringify(p.images || []), model: p.model || '',
    stock: p.stock ?? 0, active: p.active === false ? 0 : 1, sort: p.sort ?? 0, created_at: Date.now(),
  });
  return getProduct(p.id);
}
export function updateProduct(id, p) {
  const cur = getProduct(id);
  if (!cur) return null;
  S.updProduct.run({
    id, name: p.name ?? cur.name, tag: p.tag ?? cur.tag, price: p.price ?? cur.price,
    short: p.short ?? cur.short, description: p.desc ?? cur.desc,
    specs: JSON.stringify(p.specs ?? cur.specs), segment: p.segment ?? cur.segment, extra: JSON.stringify(p.extra ?? cur.extra), icon: p.icon ?? cur.icon,
    image: p.image ?? cur.image, video: p.video ?? cur.video,
    images: JSON.stringify(p.images ?? cur.images), model: p.model ?? cur.model, stock: p.stock ?? cur.stock,
    active: (p.active ?? cur.active) ? 1 : 0, sort: p.sort ?? cur.sort,
  });
  return getProduct(id);
}
export function deleteProduct(id) { S.delProduct.run(id); }
export function adjustStock(id, delta) { S.adjStock.run(delta, id); }

// ───────────── settings ─────────────
export function getSetting(key) { return S.getSetting.get(key)?.value; }
export function setSetting(key, value) { S.setSetting.run(key, value ?? ''); }
export function allSettings() { return Object.fromEntries(S.allSettings.all().map((r) => [r.key, r.value])); }

// ───────────── reviews ─────────────
export function addReview(productId, userId, name, rating, comment) {
  S.insReview.run(productId, userId, name || '', rating, comment || '', Date.now());
}
export function listReviews(productId) {
  return S.listReviews.all(productId).map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, userId: r.user_id }));
}
export function reviewStats(productId) {
  const r = S.reviewStat.get(productId);
  return { count: r.c || 0, avg: r.a ? Math.round(r.a * 10) / 10 : 0 };
}
export function allReviewStats() {
  const out = {};
  for (const r of S.allReviewStats.all()) out[r.product_id] = { count: r.c, avg: Math.round(r.a * 10) / 10 };
  return out;
}
export function getAdminOrderAnalytics(days = 30) {
  const safeDays = Math.min(90, Math.max(7, parseInt(days, 10) || 30));
  const orders = listOrders(5000);
  const dayMs = 86400000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const series = [];
  for (let i = safeDays - 1; i >= 0; i--) {
    const start = today.getTime() - i * dayMs;
    const dayOrders = orders.filter((order) => order.createdAt >= start && order.createdAt < start + dayMs);
    const paidOrders = dayOrders.filter((order) => order.paid && order.status !== 'cancelled');
    series.push({
      date: new Date(start).toISOString().slice(0, 10),
      revenue: paidOrders.reduce((sum, order) => sum + order.total, 0),
      orders: dayOrders.length,
    });
  }
  const paidOrders = orders.filter((order) => order.paid && order.status !== 'cancelled');
  const revenue = paidOrders.reduce((sum, order) => sum + order.total, 0);
  const statusBreakdown = {};
  for (const order of orders) statusBreakdown[order.status] = (statusBreakdown[order.status] || 0) + 1;
  const payment = { promptpay: orders.filter((order) => order.payment_method === 'promptpay').length, card: orders.filter((order) => order.payment_method === 'card').length };
  const topProducts = Object.values(orders.reduce((map, order) => {
    for (const item of order.items || []) {
      const key = item.name || 'ไม่ระบุสินค้า';
      const row = map[key] || { name: key, qty: 0, revenue: 0 };
      row.qty += Number(item.qty || 0);
      row.revenue += Number(item.price || 0) * Number(item.qty || 0);
      map[key] = row;
    }
    return map;
  }, {})).sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 5);
  return {
    days: safeDays,
    series,
    totals: { revenue, orders: orders.length, paidOrders: paidOrders.length, aov: paidOrders.length ? Math.round(revenue / paidOrders.length) : 0, discountGiven: orders.reduce((sum, order) => sum + (order.discount || 0), 0) },
    statusBreakdown,
    payment,
    topProducts,
  };
}
export function getAdminDashboardStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS orders,
      COALESCE(SUM(CASE WHEN paid = 1 AND status <> 'cancelled' THEN total ELSE 0 END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN paid = 0 AND status NOT IN ('cancelled', 'expired') THEN 1 ELSE 0 END), 0) AS pending
    FROM orders
  `).get();
  const recent = db.prepare(`SELECT id, total, status, customer FROM orders ORDER BY created_at DESC LIMIT 6`).all();
  return {
    orders: Number(totals.orders || 0),
    revenue: Number(totals.revenue || 0),
    pending: Number(totals.pending || 0),
    leads: countLeads(),
    users: countUsers(),
    products: countProducts(true),
    recent: recent.map((order) => ({ id: order.id, total: order.total, status: order.status, name: JSON.parse(order.customer || '{}')?.name || '' })),
  };
}
export function userReviewed(productId, userId) { return !!S.userReviewed.get(productId, userId); }

// ───────────── articles ─────────────
function rowToArticle(r) {
  if (!r) return null;
  return { id: r.id, title: r.title, cover: r.cover, excerpt: r.excerpt, body: r.body, published: !!r.published, createdAt: r.created_at };
}
export function createArticle(a) {
  S.insArticle.run({ id: a.id, title: a.title, cover: a.cover || '', excerpt: a.excerpt || '', body: a.body || '', published: a.published === false ? 0 : 1, created_at: Date.now() });
  return getArticle(a.id);
}
export function getArticle(id) { return rowToArticle(S.getArticle.get(id)); }
export function listArticles(all = false) { return (all ? S.listArticlesAll : S.listArticlesPub).all().map(rowToArticle); }
export function updateArticle(id, a) {
  const c = getArticle(id); if (!c) return null;
  S.updArticle.run({ id, title: a.title ?? c.title, cover: a.cover ?? c.cover, excerpt: a.excerpt ?? c.excerpt, body: a.body ?? c.body, published: (a.published ?? c.published) ? 1 : 0 });
  return getArticle(id);
}
export function deleteArticle(id) { S.delArticle.run(id); }

export default db;
