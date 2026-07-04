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
    username TEXT DEFAULT '', avatar TEXT DEFAULT '', bio TEXT DEFAULT '',
    line_id TEXT DEFAULT '', phone TEXT DEFAULT '', location TEXT DEFAULT '',
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
const userCols = db.pragma('table_info(users)').map((c) => c.name);
if (!userCols.includes('username')) db.exec(`ALTER TABLE users ADD COLUMN username TEXT DEFAULT ''`);
if (!userCols.includes('avatar')) db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ''`);
if (!userCols.includes('bio')) db.exec(`ALTER TABLE users ADD COLUMN bio TEXT DEFAULT ''`);
if (!userCols.includes('line_id')) db.exec(`ALTER TABLE users ADD COLUMN line_id TEXT DEFAULT ''`);
if (!userCols.includes('phone')) db.exec(`ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''`);
if (!userCols.includes('location')) db.exec(`ALTER TABLE users ADD COLUMN location TEXT DEFAULT ''`);

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
const messageCols = db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name);
if (!messageCols.includes('store_id')) db.exec(`ALTER TABLE messages ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
const leadCols = db.prepare(`PRAGMA table_info(leads)`).all().map((c) => c.name);
if (!leadCols.includes('store_id')) db.exec(`ALTER TABLE leads ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
const couponCols = db.prepare(`PRAGMA table_info(coupons)`).all().map((c) => c.name);
if (!couponCols.includes('store_id')) db.exec(`ALTER TABLE coupons ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
const reviewCols = db.prepare(`PRAGMA table_info(reviews)`).all().map((c) => c.name);
if (!reviewCols.includes('store_id')) db.exec(`ALTER TABLE reviews ADD COLUMN store_id TEXT DEFAULT 'store_main'`);

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
addCol('store_id', `TEXT DEFAULT 'store_main'`);
// migration: products.video
const productCols = db.prepare(`PRAGMA table_info(products)`).all().map((c) => c.name);
if (!productCols.includes('video')) db.exec(`ALTER TABLE products ADD COLUMN video TEXT DEFAULT ''`);
if (!productCols.includes('images')) db.exec(`ALTER TABLE products ADD COLUMN images TEXT DEFAULT '[]'`);
if (!productCols.includes('model')) db.exec(`ALTER TABLE products ADD COLUMN model TEXT DEFAULT ''`);
if (!productCols.includes('segment')) db.exec(`ALTER TABLE products ADD COLUMN segment TEXT DEFAULT 'agri'`);
if (!productCols.includes('extra')) db.exec(`ALTER TABLE products ADD COLUMN extra TEXT DEFAULT '{}'`);
if (!productCols.includes('store_id')) db.exec(`ALTER TABLE products ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
db.exec(`CREATE TABLE IF NOT EXISTS articles (
  store_id TEXT DEFAULT 'store_main',
  id TEXT PRIMARY KEY, title TEXT NOT NULL, cover TEXT DEFAULT '', excerpt TEXT DEFAULT '',
  body TEXT DEFAULT '', published INTEGER DEFAULT 1, created_at INTEGER NOT NULL
);`);
const articleCols = db.pragma('table_info(articles)').map((c) => c.name);
if (!articleCols.includes('store_id')) db.exec(`ALTER TABLE articles ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
db.exec(`
  CREATE TABLE IF NOT EXISTS community_posts (
    store_id TEXT DEFAULT 'store_main',
    id TEXT PRIMARY KEY,
    user_id TEXT DEFAULT '',
    author_name TEXT DEFAULT '',
    author_avatar TEXT DEFAULT '',
    author_role TEXT DEFAULT 'member',
    caption TEXT DEFAULT '',
    media TEXT DEFAULT '[]',
    hashtags TEXT DEFAULT '[]',
    article_id TEXT DEFAULT '',
    product_ids TEXT DEFAULT '[]',
    status TEXT DEFAULT 'approved',
    pinned INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS community_comments (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    user_id TEXT DEFAULT '',
    author_name TEXT DEFAULT '',
    text TEXT NOT NULL,
    status TEXT DEFAULT 'approved',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS community_reactions (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    type TEXT DEFAULT 'like',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id, type)
  );
  CREATE TABLE IF NOT EXISTS community_saves (
    post_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_stories (
    store_id TEXT DEFAULT 'store_main',
    id TEXT PRIMARY KEY,
    post_id TEXT DEFAULT '',
    author_name TEXT DEFAULT '',
    title TEXT DEFAULT '',
    media TEXT DEFAULT '',
    caption TEXT DEFAULT '',
    status TEXT DEFAULT 'approved',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);
const communityPostCols = db.pragma('table_info(community_posts)').map((c) => c.name);
if (!communityPostCols.includes('store_id')) db.exec(`ALTER TABLE community_posts ADD COLUMN store_id TEXT DEFAULT 'store_main'`);
if (!communityPostCols.includes('author_avatar')) db.exec(`ALTER TABLE community_posts ADD COLUMN author_avatar TEXT DEFAULT ''`);
const communityStoryCols = db.pragma('table_info(community_stories)').map((c) => c.name);
if (!communityStoryCols.includes('store_id')) db.exec(`ALTER TABLE community_stories ADD COLUMN store_id TEXT DEFAULT 'store_main'`);

db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT DEFAULT '',
    subdomain TEXT UNIQUE,
    status TEXT DEFAULT 'active',
    template_key TEXT DEFAULT 'default',
    primary_domain TEXT DEFAULT '',
    owner_user_id TEXT DEFAULT '',
    is_default INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store_id TEXT NOT NULL,
    host TEXT UNIQUE NOT NULL,
    is_primary INTEGER DEFAULT 0,
    verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS store_settings (
    store_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT DEFAULT '',
    PRIMARY KEY (store_id, key)
  );
  CREATE TABLE IF NOT EXISTS store_databases (
    store_id TEXT PRIMARY KEY,
    database_key TEXT DEFAULT '',
    provider TEXT DEFAULT 'sqlite',
    schema_name TEXT DEFAULT 'main',
    namespace TEXT DEFAULT '',
    status TEXT DEFAULT 'ready',
    tenant_tables TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_store_roles (
    user_id TEXT NOT NULL,
    store_id TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, store_id)
  );
`);
const nowStoreBootstrap = Date.now();
db.prepare(`INSERT OR IGNORE INTO stores (id,name,slug,subdomain,status,template_key,primary_domain,owner_user_id,is_default,metadata,created_at,updated_at)
  VALUES ('store_main','Main Store','main',NULL,'active','default','','',1,'{}',?,?)`).run(nowStoreBootstrap, nowStoreBootstrap);
db.prepare(`INSERT OR IGNORE INTO store_databases (store_id,database_key,provider,schema_name,namespace,status,tenant_tables,metadata,created_at,updated_at)
  VALUES ('store_main','db_store_main','sqlite','main','store_main','ready',?,'{}',?,?)`)
  .run(JSON.stringify(['products', 'orders', 'reviews', 'leads', 'messages', 'articles', 'coupons', 'store_settings']), nowStoreBootstrap, nowStoreBootstrap);

// ───────────── orders ─────────────
function rowToOrder(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
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
  insOrder: db.prepare(`INSERT INTO orders (store_id,id,items,total,subtotal,discount,shipping,coupon,customer,payment_method,status,paid,payment_claimed,tracking,session_id,stripe_session,user_id,channel,line_user_id,access_token,resources_reserved,created_at,updated_at)
    VALUES (@store_id,@id,@items,@total,@subtotal,@discount,@shipping,@coupon,@customer,@payment_method,@status,@paid,@payment_claimed,@tracking,@session_id,@stripe_session,@user_id,@channel,@line_user_id,@access_token,@resources_reserved,@created_at,@updated_at)`),
  adjStock: db.prepare(`UPDATE products SET stock = MAX(0, stock + ?) WHERE id = ? AND store_id = ?`),
  getOrder: db.prepare(`SELECT * FROM orders WHERE id=?`),
  listOrders: db.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`),
  listOrdersByUser: db.prepare(`SELECT * FROM orders WHERE user_id=? AND store_id=? ORDER BY created_at DESC LIMIT ?`),
  listExpiredReservations: db.prepare(`SELECT * FROM orders WHERE paid=0 AND payment_claimed=0 AND resources_reserved=1 AND status='awaiting_payment' AND created_at < ? ORDER BY created_at ASC LIMIT ?`),
  updOrder: db.prepare(`UPDATE orders SET status=@status,paid=@paid,payment_claimed=@payment_claimed,tracking=@tracking,stripe_session=@stripe_session,resources_reserved=@resources_reserved,updated_at=@updated_at WHERE id=@id`),
  insMsg: db.prepare(`INSERT INTO messages (store_id,session_id,sender,text,at) VALUES (?,?,?,?,?)`),
  // users
  insUser: db.prepare(`INSERT INTO users (id,email,name,username,avatar,bio,line_id,phone,location,salt,hash,role,created_at) VALUES (@id,@email,@name,@username,@avatar,@bio,@line_id,@phone,@location,@salt,@hash,@role,@created_at)`),
  userByEmail: db.prepare(`SELECT * FROM users WHERE email=?`),
  userById: db.prepare(`SELECT * FROM users WHERE id=?`),
  listUsers: db.prepare(`SELECT id,email,name,username,avatar,bio,line_id,phone,location,role,created_at FROM users ORDER BY created_at DESC`),
  // tokens
  insToken: db.prepare(`INSERT INTO auth_tokens (token,user_id,created_at,expires_at) VALUES (?,?,?,?)`),
  getToken: db.prepare(`SELECT * FROM auth_tokens WHERE token=?`),
  delToken: db.prepare(`DELETE FROM auth_tokens WHERE token=?`),
  // products
  insProduct: db.prepare(`INSERT INTO products (store_id,id,name,tag,price,short,description,specs,segment,extra,icon,image,video,images,model,stock,active,sort,created_at)
    VALUES (@store_id,@id,@name,@tag,@price,@short,@description,@specs,@segment,@extra,@icon,@image,@video,@images,@model,@stock,@active,@sort,@created_at)`),
  getProduct: db.prepare(`SELECT * FROM products WHERE id=?`),
  listProductsAll: db.prepare(`SELECT * FROM products ORDER BY sort ASC, created_at ASC`),
  listProductsActive: db.prepare(`SELECT * FROM products WHERE active=1 ORDER BY sort ASC, created_at ASC`),
  updProduct: db.prepare(`UPDATE products SET name=@name,tag=@tag,price=@price,short=@short,description=@description,specs=@specs,segment=@segment,extra=@extra,icon=@icon,image=@image,video=@video,images=@images,model=@model,stock=@stock,active=@active,sort=@sort WHERE id=@id AND store_id=@store_id`),
  delProduct: db.prepare(`DELETE FROM products WHERE id=? AND store_id=?`),
  // settings
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(`INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`),
  allSettings: db.prepare(`SELECT key,value FROM settings`),
  // reviews
  insReview: db.prepare(`INSERT INTO reviews (store_id,product_id,user_id,name,rating,comment,created_at) VALUES (?,?,?,?,?,?,?)`),
  listReviews: db.prepare(`SELECT * FROM reviews WHERE product_id=? AND store_id=? ORDER BY created_at DESC`),
  reviewStat: db.prepare(`SELECT COUNT(*) c, AVG(rating) a FROM reviews WHERE product_id=? AND store_id=?`),
  allReviewStats: db.prepare(`SELECT product_id, COUNT(*) c, AVG(rating) a FROM reviews WHERE store_id=? GROUP BY product_id`),
  userReviewed: db.prepare(`SELECT id FROM reviews WHERE product_id=? AND user_id=? AND store_id=? LIMIT 1`),
  // articles
  insArticle: db.prepare(`INSERT INTO articles (store_id,id,title,cover,excerpt,body,published,created_at) VALUES (@store_id,@id,@title,@cover,@excerpt,@body,@published,@created_at)`),
  getArticle: db.prepare(`SELECT * FROM articles WHERE id=?`),
  listArticlesAll: db.prepare(`SELECT * FROM articles ORDER BY created_at DESC`),
  listArticlesPub: db.prepare(`SELECT * FROM articles WHERE published=1 ORDER BY created_at DESC`),
  updArticle: db.prepare(`UPDATE articles SET title=@title,cover=@cover,excerpt=@excerpt,body=@body,published=@published WHERE id=@id AND store_id=@store_id`),
  delArticle: db.prepare(`DELETE FROM articles WHERE id=? AND store_id=?`),
  // community
  insCommunityPost: db.prepare(`INSERT INTO community_posts (store_id,id,user_id,author_name,author_avatar,author_role,caption,media,hashtags,article_id,product_ids,status,pinned,created_at,updated_at)
    VALUES (@store_id,@id,@user_id,@author_name,@author_avatar,@author_role,@caption,@media,@hashtags,@article_id,@product_ids,@status,@pinned,@created_at,@updated_at)`),
  getCommunityPost: db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.type='like') AS likes,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.status='approved') AS comments,
      (SELECT COUNT(*) FROM community_saves s WHERE s.post_id=p.id) AS saves
    FROM community_posts p WHERE p.id=? AND p.store_id=?`),
  listCommunityPosts: db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.type='like') AS likes,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.status='approved') AS comments,
      (SELECT COUNT(*) FROM community_saves s WHERE s.post_id=p.id) AS saves
    FROM community_posts p WHERE p.status='approved' AND p.store_id=@store_id ORDER BY p.pinned DESC, p.created_at DESC LIMIT @limit`),
  listCommunityPostsAll: db.prepare(`SELECT p.*,
      (SELECT COUNT(*) FROM community_reactions r WHERE r.post_id=p.id AND r.type='like') AS likes,
      (SELECT COUNT(*) FROM community_comments c WHERE c.post_id=p.id AND c.status='approved') AS comments,
      (SELECT COUNT(*) FROM community_saves s WHERE s.post_id=p.id) AS saves
    FROM community_posts p WHERE p.store_id=@store_id ORDER BY p.created_at DESC LIMIT @limit`),
  updCommunityPostStatus: db.prepare(`UPDATE community_posts SET status=@status, pinned=@pinned, updated_at=@updated_at WHERE id=@id AND store_id=@store_id`),
  delCommunityPost: db.prepare(`DELETE FROM community_posts WHERE id=? AND store_id=?`),
  insCommunityComment: db.prepare(`INSERT INTO community_comments (id,post_id,user_id,author_name,text,status,created_at) VALUES (@id,@post_id,@user_id,@author_name,@text,@status,@created_at)`),
  listCommunityComments: db.prepare(`SELECT * FROM community_comments WHERE post_id=? AND status='approved' ORDER BY created_at ASC LIMIT ?`),
  upsertCommunityReaction: db.prepare(`INSERT INTO community_reactions (post_id,user_id,type,created_at) VALUES (?,?,?,?) ON CONFLICT(post_id,user_id,type) DO NOTHING`),
  delCommunityReaction: db.prepare(`DELETE FROM community_reactions WHERE post_id=? AND user_id=? AND type=?`),
  userCommunityReaction: db.prepare(`SELECT post_id FROM community_reactions WHERE post_id=? AND user_id=? AND type=? LIMIT 1`),
  upsertCommunitySave: db.prepare(`INSERT INTO community_saves (post_id,user_id,created_at) VALUES (?,?,?) ON CONFLICT(post_id,user_id) DO NOTHING`),
  delCommunitySave: db.prepare(`DELETE FROM community_saves WHERE post_id=? AND user_id=?`),
  userCommunitySave: db.prepare(`SELECT post_id FROM community_saves WHERE post_id=? AND user_id=? LIMIT 1`),
  insCommunityStory: db.prepare(`INSERT INTO community_stories (store_id,id,post_id,author_name,title,media,caption,status,created_at,expires_at)
    VALUES (@store_id,@id,@post_id,@author_name,@title,@media,@caption,@status,@created_at,@expires_at)`),
  listCommunityStories: db.prepare(`SELECT * FROM community_stories WHERE status='approved' AND expires_at>@now AND store_id=@store_id ORDER BY created_at DESC LIMIT @limit`),
  listCommunityStoriesAll: db.prepare(`SELECT * FROM community_stories WHERE store_id=@store_id ORDER BY created_at DESC LIMIT @limit`),
  delCommunityStory: db.prepare(`DELETE FROM community_stories WHERE id=? AND store_id=?`),
  // user update/delete
  updUser: db.prepare(`UPDATE users SET name=@name, username=@username, avatar=@avatar, bio=@bio, line_id=@line_id, phone=@phone, location=@location, role=@role WHERE id=@id`),
  delUser: db.prepare(`DELETE FROM users WHERE id=?`),
  countAdmins: db.prepare(`SELECT COUNT(*) n FROM users WHERE role='admin'`),
  // coupons
  insCoupon: db.prepare(`INSERT INTO coupons (store_id,code,type,value,min_total,max_uses,used,active,expires_at,created_at)
    VALUES (@store_id,@code,@type,@value,@min_total,@max_uses,0,@active,@expires_at,@created_at)`),
  getCoupon: db.prepare(`SELECT * FROM coupons WHERE code=? AND store_id=?`),
  listCoupons: db.prepare(`SELECT * FROM coupons WHERE store_id=? ORDER BY created_at DESC`),
  updCoupon: db.prepare(`UPDATE coupons SET type=@type,value=@value,min_total=@min_total,max_uses=@max_uses,active=@active,expires_at=@expires_at WHERE code=@code AND store_id=@store_id`),
  delCoupon: db.prepare(`DELETE FROM coupons WHERE code=? AND store_id=?`),
  incCoupon: db.prepare(`UPDATE coupons SET used=used+1 WHERE code=? AND store_id=?`),
  // leads
  insLead: db.prepare(`INSERT INTO leads (store_id,name,phone,line_id,province,crop,stage,area_rai,problem,source,landing_page,utm_source,utm_medium,utm_campaign,note,status,created_at,updated_at)
    VALUES (@store_id,@name,@phone,@line_id,@province,@crop,@stage,@area_rai,@problem,@source,@landing_page,@utm_source,@utm_medium,@utm_campaign,@note,@status,@created_at,@updated_at)`),
  listLeads: db.prepare(`SELECT * FROM leads WHERE store_id=? ORDER BY created_at DESC LIMIT ?`),
  getLead: db.prepare(`SELECT * FROM leads WHERE id=? AND store_id=?`),
  updLead: db.prepare(`UPDATE leads SET name=@name,phone=@phone,line_id=@line_id,province=@province,crop=@crop,stage=@stage,area_rai=@area_rai,problem=@problem,source=@source,landing_page=@landing_page,utm_source=@utm_source,utm_medium=@utm_medium,utm_campaign=@utm_campaign,note=@note,status=@status,updated_at=@updated_at WHERE id=@id AND store_id=@store_id`),
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
  WHERE m.store_id = ? AND (? = '' OR m.session_id LIKE ? OR m.text LIKE ?)
  GROUP BY m.session_id
  ORDER BY last_at DESC
  LIMIT ? OFFSET ?
`);
const _countChatSessions = db.prepare(`
  SELECT COUNT(*) AS total FROM (
    SELECT m.session_id
    FROM messages m
    WHERE m.store_id = ? AND (? = '' OR m.session_id LIKE ? OR m.text LIKE ?)
    GROUP BY m.session_id
  ) t
`);
const _chatMessages = db.prepare(`SELECT id, session_id, sender, text, at FROM messages WHERE store_id=? AND session_id=? ORDER BY at ASC, id ASC LIMIT ?`);
const _deleteChatMessagesBySession = db.prepare(`DELETE FROM messages WHERE store_id=? AND session_id=?`);
const _latestOrderBySession = db.prepare(`SELECT * FROM orders WHERE session_id=? AND store_id=? ORDER BY created_at DESC LIMIT 1`);

export function createOrder(o) {
  const now = Date.now();
  S.insOrder.run({
    store_id: normalizeStoreId(o.storeId),
    id: o.id, items: JSON.stringify(o.items), total: o.total, subtotal: o.subtotal ?? o.total, discount: o.discount || 0, shipping: o.shipping || 0, coupon: o.coupon || '',
    customer: JSON.stringify(o.customer),
    payment_method: o.payment_method, status: o.status, paid: o.paid ? 1 : 0, payment_claimed: 0,
    tracking: o.tracking || '', session_id: o.session_id || '', stripe_session: o.stripe_session || '',
    user_id: o.user_id || '', channel: o.channel || 'web', line_user_id: o.line_user_id || '', access_token: o.access_token || '', resources_reserved: o.resources_reserved === false ? 0 : 1, created_at: now, updated_at: now,
  });
  return getOrder(o.id);
}
export function getOrder(id) { return rowToOrder(S.getOrder.get(id)); }
export function listOrders(limit = 50, options = {}) {
  const storeId = String(options?.storeId || '').trim();
  const sql = storeId ? `SELECT * FROM orders WHERE store_id=? ORDER BY created_at DESC LIMIT ?` : `SELECT * FROM orders ORDER BY created_at DESC LIMIT ?`;
  return (storeId ? db.prepare(sql).all(normalizeStoreId(storeId), limit) : db.prepare(sql).all(limit)).map(rowToOrder);
}
export function listAdminOrderSummaries(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminOrderWhere(filters);
  const storeId = String(filters.storeId || '').trim();
  const storeClause = storeId ? `${sql ? ' AND ' : ' WHERE '}store_id = ?` : '';
  const storeParams = storeId ? [normalizeStoreId(storeId)] : [];
  return db.prepare(`SELECT * FROM orders${sql}${storeClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, ...storeParams, safeLimit, safeOffset).map(rowToOrder).map(orderToAdminSummary);
}
export function listOrdersByUser(uid, limit = 50, options = {}) {
  return S.listOrdersByUser.all(uid, normalizeStoreId(options.storeId), limit).map(rowToOrder);
}
export function countOrders({ paid, status, deliveredOnly = false, search = '', storeId = '' } = {}) {
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
  if (String(storeId || '').trim()) { clauses.push(`store_id = ?`); params.push(normalizeStoreId(storeId)); }
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

const reserveOrderResourcesTx = db.transaction(({ items = [], coupon = '', storeId = '' } = {}) => {
  const normalizedStoreId = normalizeStoreId(storeId);
  for (const item of items) {
    const id = String(item?.id || '').trim();
    const qty = Math.max(1, parseInt(item?.qty, 10) || 0);
    if (!id || !qty) continue;
    const info = db.prepare(`UPDATE products SET stock = stock - ? WHERE id = ? AND store_id = ? AND stock >= ?`).run(qty, id, normalizedStoreId, qty);
    if (!info.changes) throw new Error(`สินค้าไม่พอสำหรับ ${id}`);
  }
  const code = String(coupon || '').trim().toUpperCase();
  if (code) {
    const info = db.prepare(`UPDATE coupons SET used = used + 1 WHERE code = ? AND store_id = ? AND (max_uses <= 0 OR used < max_uses)`).run(code, normalizedStoreId);
    if (!info.changes) throw new Error(`คูปอง ${code} ใช้งานไม่ได้แล้ว`);
  }
});

const releaseOrderResourcesTx = db.transaction(({ items = [], coupon = '', storeId = '' } = {}) => {
  const normalizedStoreId = normalizeStoreId(storeId);
  for (const item of items) {
    const id = String(item?.id || '').trim();
    const qty = Math.max(1, parseInt(item?.qty, 10) || 0);
    if (!id || !qty) continue;
    db.prepare(`UPDATE products SET stock = stock + ? WHERE id = ? AND store_id = ?`).run(qty, id, normalizedStoreId);
  }
  const code = String(coupon || '').trim().toUpperCase();
  if (code) db.prepare(`UPDATE coupons SET used = MAX(0, used - 1) WHERE code = ? AND store_id = ?`).run(code, normalizedStoreId);
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
export function saveMessage(sessionId, sender, text, at = Date.now(), options = {}) { S.insMsg.run(normalizeStoreId(options.storeId), sessionId, sender, text, at); }
const _msgsSince = db.prepare(`SELECT sender, text, at FROM messages WHERE store_id=? AND session_id=? AND at>? ORDER BY at ASC LIMIT 100`);
export function listMessagesSince(sessionId, after = 0, options = {}) { return _msgsSince.all(normalizeStoreId(options.storeId), String(sessionId || ''), Number(after) || 0); }
export function listChatSessions({ search = '', limit = 20, offset = 0, storeId = '' } = {}) {
  const normalizedSearch = String(search || '').trim().slice(0, 80);
  const like = normalizedSearch ? `%${normalizedSearch}%` : '';
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const normalizedStoreId = normalizeStoreId(storeId);
  const items = _listChatSessions.all(normalizedStoreId, normalizedSearch, like, like, safeLimit, safeOffset).map((row) => ({
    session_id: row.session_id,
    last_at: Number(row.last_at || 0),
    last_customer_at: Number(row.last_customer_at || 0),
    last_sender: String(row.last_sender || '').trim(),
    last_text: String(row.last_text || '').trim(),
    customer_count: Number(row.customer_count || 0),
    admin_count: Number(row.admin_count || 0),
  }));
  const total = Number(_countChatSessions.get(normalizedStoreId, normalizedSearch, like, like)?.total || 0);
  return { items, total };
}
export function listChatMessages(sessionId, limit = 200, options = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  return _chatMessages.all(normalizeStoreId(options.storeId), String(sessionId || '').trim(), safeLimit);
}
export function deleteChatSession(sessionId, options = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) return false;
  _deleteChatMessagesBySession.run(normalizeStoreId(options.storeId), normalizedSessionId);
  return true;
}
export function findLatestOrderBySessionId(sessionId, options = {}) {
  return rowToOrder(_latestOrderBySession.get(String(sessionId || '').trim(), normalizeStoreId(options.storeId)));
}

// ───────────── users / tokens ─────────────
export function createUser(u) { S.insUser.run({ username: '', avatar: '', bio: '', line_id: '', phone: '', location: '', ...u, created_at: Date.now() }); return getUserById(u.id); }
export function getUserByEmail(email) { return S.userByEmail.get(String(email).toLowerCase()); }
export function getUserById(id) { return S.userById.get(id); }
export function listUsers() { return S.listUsers.all(); }
export function listAdminUsers(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminUserWhere(filters);
  return db.prepare(`SELECT id,email,name,username,avatar,bio,line_id,phone,location,role,created_at FROM users${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, safeOffset);
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
  S.updUser.run({
    id,
    name: patch.name ?? u.name,
    username: patch.username ?? u.username ?? '',
    avatar: patch.avatar ?? u.avatar ?? '',
    bio: patch.bio ?? u.bio ?? '',
    line_id: patch.line_id ?? u.line_id ?? '',
    phone: patch.phone ?? u.phone ?? '',
    location: patch.location ?? u.location ?? '',
    role: patch.role ?? u.role,
  });
  return getUserById(id);
}
export function deleteUser(id) { S.delUser.run(id); }
export function countAdmins() { return S.countAdmins.get().n; }

// ───────────── coupons ─────────────
function rowToCoupon(r) {
  if (!r) return null;
  return { storeId: r.store_id || 'store_main', code: r.code, type: r.type, value: r.value, minTotal: r.min_total, maxUses: r.max_uses, used: r.used, active: !!r.active, expiresAt: r.expires_at, createdAt: r.created_at };
}
export function listCoupons(options = {}) { return S.listCoupons.all(normalizeStoreId(options.storeId)).map(rowToCoupon); }
export function getCoupon(code, options = {}) { return rowToCoupon(S.getCoupon.get(String(code).toUpperCase(), normalizeStoreId(options.storeId))); }
export function createCoupon(c) {
  const storeId = normalizeStoreId(c.storeId);
  S.insCoupon.run({ store_id: storeId, code: String(c.code).toUpperCase(), type: c.type === 'fixed' ? 'fixed' : 'percent', value: parseInt(c.value, 10) || 0, min_total: parseInt(c.minTotal, 10) || 0, max_uses: parseInt(c.maxUses, 10) || 0, active: c.active === false ? 0 : 1, expires_at: parseInt(c.expiresAt, 10) || 0, created_at: Date.now() });
  return getCoupon(c.code, { storeId });
}
export function updateCoupon(code, c) {
  const storeId = normalizeStoreId(c.storeId);
  const cur = getCoupon(code, { storeId }); if (!cur) return null;
  S.updCoupon.run({ store_id: storeId, code: String(code).toUpperCase(), type: c.type ?? cur.type, value: c.value !== undefined ? parseInt(c.value, 10) || 0 : cur.value, min_total: c.minTotal !== undefined ? parseInt(c.minTotal, 10) || 0 : cur.minTotal, max_uses: c.maxUses !== undefined ? parseInt(c.maxUses, 10) || 0 : cur.maxUses, active: (c.active ?? cur.active) ? 1 : 0, expires_at: c.expiresAt !== undefined ? parseInt(c.expiresAt, 10) || 0 : cur.expiresAt });
  return getCoupon(code, { storeId });
}
export function deleteCoupon(code, options = {}) { S.delCoupon.run(String(code).toUpperCase(), normalizeStoreId(options.storeId)); }
export function incCouponUse(code, options = {}) { S.incCoupon.run(String(code).toUpperCase(), normalizeStoreId(options.storeId)); }

// ───────────── leads ─────────────
function rowToLead(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
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
    store_id: normalizeStoreId(lead.storeId),
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
  return getLead(info.lastInsertRowid, { storeId: lead.storeId });
}
export function getLead(id, options = {}) { return rowToLead(S.getLead.get(id, normalizeStoreId(options.storeId))); }
export function listLeads(limit = 200, options = {}) { return S.listLeads.all(normalizeStoreId(options.storeId), limit).map(rowToLead); }
export function listAdminLeads(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const { sql, params } = buildAdminLeadWhere(filters);
  const storeId = String(filters.storeId || '').trim();
  const storeClause = storeId ? `${sql ? ' AND ' : ' WHERE '}store_id = ?` : '';
  const storeParams = storeId ? [normalizeStoreId(storeId)] : [];
  return db.prepare(`SELECT * FROM leads${sql}${storeClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, ...storeParams, safeLimit, safeOffset).map(rowToLead);
}
export function countLeads({ search = '', status = '', storeId = '' } = {}) {
  const { sql, params } = buildAdminLeadWhere({ search, status });
  const storeClause = storeId ? `${sql ? ' AND ' : ' WHERE '}store_id = ?` : '';
  const storeParams = storeId ? [normalizeStoreId(storeId)] : [];
  return db.prepare(`SELECT COUNT(*) n FROM leads${sql}${storeClause}`).get(...params, ...storeParams).n;
}
export function listLeadIdentityRows() { return db.prepare(`SELECT name,phone,line_id,province FROM leads ORDER BY created_at DESC`).all(); }
export function updateLead(id, patch) {
  const storeId = normalizeStoreId(patch.storeId);
  const cur = getLead(id, { storeId });
  if (!cur) return null;
  S.updLead.run({
    id,
    store_id: storeId,
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
  return getLead(id, { storeId });
}

// ───────────── products ─────────────
function normalizeStoreHost(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}
function rowToStore(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name || '',
    slug: r.slug || '',
    subdomain: r.subdomain || '',
    status: r.status || 'active',
    templateKey: r.template_key || 'default',
    primaryDomain: r.primary_domain || '',
    ownerUserId: r.owner_user_id || '',
    isDefault: !!r.is_default,
    metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at || 0,
    updatedAt: r.updated_at || 0,
  };
}
function rowToStoreDatabase(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
    databaseKey: r.database_key || '',
    provider: r.provider || 'sqlite',
    schemaName: r.schema_name || 'main',
    namespace: r.namespace || '',
    status: r.status || 'ready',
    tenantTables: parseJson(r.tenant_tables, []),
    metadata: parseJson(r.metadata, {}),
    createdAt: r.created_at || 0,
    updatedAt: r.updated_at || 0,
  };
}
export function getStoreSetting(storeId, key) {
  return db.prepare(`SELECT value FROM store_settings WHERE store_id=? AND key=?`).get(normalizeStoreId(storeId), key)?.value;
}
export function setStoreSetting(storeId, key, value) {
  db.prepare(`INSERT INTO store_settings (store_id,key,value) VALUES (?,?,?) ON CONFLICT(store_id,key) DO UPDATE SET value=excluded.value`).run(normalizeStoreId(storeId), key, value ?? '');
}
export function allStoreSettings(storeId) {
  return Object.fromEntries(db.prepare(`SELECT key,value FROM store_settings WHERE store_id=?`).all(normalizeStoreId(storeId)).map((r) => [r.key, r.value]));
}
export function getDefaultStore() {
  return rowToStore(db.prepare(`SELECT * FROM stores WHERE is_default=1 ORDER BY created_at ASC LIMIT 1`).get());
}
export function getStore(id) { return rowToStore(db.prepare(`SELECT * FROM stores WHERE id=?`).get(normalizeStoreId(id))); }
export function getStoreByHost(host) {
  const row = db.prepare(`SELECT store_id FROM store_domains WHERE host=?`).get(normalizeStoreHost(host));
  return row?.store_id ? getStore(row.store_id) : null;
}
export function listStores() {
  return db.prepare(`SELECT * FROM stores ORDER BY is_default DESC, created_at DESC`).all().map(rowToStore);
}
export function isStoreSubdomainAvailable(subdomain) {
  const normalized = String(subdomain || '').trim().toLowerCase();
  if (!normalized) return false;
  return !db.prepare(`SELECT id FROM stores WHERE subdomain=? LIMIT 1`).get(normalized);
}
export function createStore(store = {}) {
  const now = Date.now();
  const row = {
    id: normalizeStoreId(store.id),
    name: String(store.name || '').trim(),
    slug: String(store.slug || '').trim().toLowerCase(),
    subdomain: String(store.subdomain || '').trim().toLowerCase() || null,
    status: String(store.status || 'active').trim() || 'active',
    template_key: String(store.templateKey || 'default').trim() || 'default',
    primary_domain: normalizeStoreHost(store.primaryDomain),
    owner_user_id: String(store.ownerUserId || '').trim(),
    is_default: store.isDefault === true ? 1 : 0,
    metadata: JSON.stringify(store.metadata || {}),
    created_at: now,
    updated_at: now,
  };
  db.prepare(`INSERT INTO stores (id,name,slug,subdomain,status,template_key,primary_domain,owner_user_id,is_default,metadata,created_at,updated_at)
    VALUES (@id,@name,@slug,@subdomain,@status,@template_key,@primary_domain,@owner_user_id,@is_default,@metadata,@created_at,@updated_at)`).run(row);
  return getStore(row.id);
}
export function addStoreDomain(storeId, host, options = {}) {
  const now = Date.now();
  const row = { store_id: normalizeStoreId(storeId), host: normalizeStoreHost(host), is_primary: options.isPrimary === true ? 1 : 0, verified: options.verified === true ? 1 : 0, created_at: now, updated_at: now };
  db.prepare(`INSERT INTO store_domains (store_id,host,is_primary,verified,created_at,updated_at)
    VALUES (@store_id,@host,@is_primary,@verified,@created_at,@updated_at)
    ON CONFLICT(host) DO UPDATE SET store_id=excluded.store_id,is_primary=excluded.is_primary,verified=excluded.verified,updated_at=excluded.updated_at`).run(row);
  return { ...row, storeId: row.store_id, isPrimary: !!row.is_primary, verified: !!row.verified };
}
export function listStoreDomains(storeId = '') {
  const normalized = String(storeId || '').trim();
  const rows = normalized ? db.prepare(`SELECT * FROM store_domains WHERE store_id=? ORDER BY is_primary DESC, created_at ASC`).all(normalizeStoreId(normalized)) : db.prepare(`SELECT * FROM store_domains ORDER BY is_primary DESC, created_at ASC`).all();
  return rows.map((row) => ({ id: row.id, storeId: row.store_id, host: row.host || '', isPrimary: !!row.is_primary, verified: !!row.verified, createdAt: row.created_at || 0, updatedAt: row.updated_at || 0 }));
}
export function createStoreDatabase(storeId, options = {}) {
  const normalized = normalizeStoreId(storeId);
  const now = Date.now();
  const tenantTables = Array.isArray(options.tenantTables) && options.tenantTables.length ? options.tenantTables : ['products', 'orders', 'reviews', 'leads', 'messages', 'articles', 'coupons', 'store_settings'];
  const row = {
    store_id: normalized,
    database_key: String(options.databaseKey || `db_${normalized.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}`).trim(),
    provider: String(options.provider || 'sqlite').trim() || 'sqlite',
    schema_name: String(options.schemaName || 'main').trim() || 'main',
    namespace: String(options.namespace || normalized).trim() || normalized,
    status: String(options.status || 'ready').trim() || 'ready',
    tenant_tables: JSON.stringify(tenantTables),
    metadata: JSON.stringify({ isLogicalDatabase: true, isolationKey: 'store_id', ...(options.metadata || {}) }),
    created_at: now,
    updated_at: now,
  };
  db.prepare(`INSERT INTO store_databases (store_id,database_key,provider,schema_name,namespace,status,tenant_tables,metadata,created_at,updated_at)
    VALUES (@store_id,@database_key,@provider,@schema_name,@namespace,@status,@tenant_tables,@metadata,@created_at,@updated_at)
    ON CONFLICT(store_id) DO UPDATE SET database_key=excluded.database_key,status=excluded.status,tenant_tables=excluded.tenant_tables,metadata=excluded.metadata,updated_at=excluded.updated_at`).run(row);
  return rowToStoreDatabase(db.prepare(`SELECT * FROM store_databases WHERE store_id=?`).get(normalized));
}
export function getStoreDatabase(storeId) { return rowToStoreDatabase(db.prepare(`SELECT * FROM store_databases WHERE store_id=?`).get(normalizeStoreId(storeId))); }
export function listStoreDatabases(storeId = '') {
  const normalized = String(storeId || '').trim();
  const rows = normalized ? db.prepare(`SELECT * FROM store_databases WHERE store_id=?`).all(normalizeStoreId(normalized)) : db.prepare(`SELECT * FROM store_databases ORDER BY created_at DESC`).all();
  return rows.map(rowToStoreDatabase);
}
export function addUserStoreRole(userId, storeId, role = 'admin') {
  db.prepare(`INSERT INTO user_store_roles (user_id,store_id,role,created_at) VALUES (?,?,?,?)
    ON CONFLICT(user_id,store_id) DO UPDATE SET role=excluded.role`).run(String(userId || '').trim(), normalizeStoreId(storeId), String(role || 'admin').trim() || 'admin', Date.now());
}
export function listUserStoreRoles(userId = '') {
  const normalized = String(userId || '').trim();
  const rows = normalized ? db.prepare(`SELECT * FROM user_store_roles WHERE user_id=?`).all(normalized) : db.prepare(`SELECT * FROM user_store_roles`).all();
  return rows.map((row) => ({ userId: row.user_id, storeId: row.store_id, role: row.role || 'admin', createdAt: row.created_at || 0 }));
}
// ลบร้านย่อยพร้อมข้อมูล tenant ทั้งหมด — ห้ามใช้กับร้าน default (มี guard ซ้ำที่ endpoint)
const STORE_CASCADE_TABLES = [
  'products', 'orders', 'reviews', 'leads', 'payment_logs', 'messages', 'articles', 'coupons',
  'community_posts', 'community_comments', 'community_reactions', 'community_saves', 'community_stories',
  'store_settings', 'store_domains', 'store_databases', 'user_store_roles',
];
export function deleteStoreCascade(storeId) {
  const id = normalizeStoreId(storeId);
  if (!id || id === 'store_main') throw new Error('ลบร้านหลักไม่ได้');
  const cleared = [];
  const skipped = [];
  for (const table of STORE_CASCADE_TABLES) {
    try {
      db.prepare(`DELETE FROM ${table} WHERE store_id=?`).run(id);
      cleared.push(table);
    } catch (err) {
      skipped.push({ table, message: err?.message || String(err) });
    }
  }
  db.prepare(`DELETE FROM stores WHERE id=? AND is_default=0`).run(id);
  return { storeId: id, cleared, skipped };
}

function rowToProduct(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
    id: r.id, name: r.name, tag: r.tag, price: r.price, short: r.short,
    desc: r.description, specs: JSON.parse(r.specs || '{}'), segment: r.segment || 'agri', extra: JSON.parse(r.extra || '{}'), icon: r.icon, image: r.image, video: r.video || '',
    images: JSON.parse(r.images || '[]'), model: r.model || '',
    stock: r.stock, active: !!r.active, sort: r.sort,
  };
}
export function getProduct(id, options = {}) {
  const storeId = String(options.storeId || '').trim();
  if (storeId) return rowToProduct(db.prepare(`SELECT * FROM products WHERE id=? AND store_id=?`).get(id, normalizeStoreId(storeId)));
  return rowToProduct(S.getProduct.get(id));
}
export function listProducts(includeInactive = false, options = {}) {
  const storeId = normalizeStoreId(options.storeId);
  const sql = `SELECT * FROM products WHERE store_id=?${includeInactive ? '' : ' AND active=1'} ORDER BY sort ASC, created_at ASC`;
  return db.prepare(sql).all(storeId).map(rowToProduct);
}
export function listProductsByIds(ids = [], includeInactive = false, options = {}) {
  const cleanIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!cleanIds.length) return [];
  const placeholders = cleanIds.map(() => '?').join(',');
  const storeId = normalizeStoreId(options.storeId);
  const sql = `SELECT * FROM products WHERE store_id=? AND id IN (${placeholders})${includeInactive ? '' : ' AND active=1'}`;
  return db.prepare(sql).all(storeId, ...cleanIds).map(rowToProduct);
}
export function countProducts(includeInactive = false, options = {}) {
  const storeId = normalizeStoreId(options.storeId);
  return db.prepare(`SELECT COUNT(*) n FROM products WHERE store_id=?${includeInactive ? '' : ' AND active=1'}`).get(storeId).n;
}
export function createProduct(p) {
  S.insProduct.run({
    store_id: normalizeStoreId(p.storeId),
    id: p.id, name: p.name, tag: p.tag || '', price: p.price, short: p.short || '',
    description: p.desc || '', specs: JSON.stringify(p.specs || {}), segment: p.segment || 'agri', extra: JSON.stringify(p.extra || {}), icon: p.icon || 'pod',
    image: p.image || '', video: p.video || '', images: JSON.stringify(p.images || []), model: p.model || '',
    stock: p.stock ?? 0, active: p.active === false ? 0 : 1, sort: p.sort ?? 0, created_at: Date.now(),
  });
  return getProduct(p.id, { storeId: p.storeId });
}
export function updateProduct(id, p) {
  const storeId = normalizeStoreId(p.storeId);
  const cur = getProduct(id, { storeId });
  if (!cur) return null;
  S.updProduct.run({
    store_id: storeId,
    id, name: p.name ?? cur.name, tag: p.tag ?? cur.tag, price: p.price ?? cur.price,
    short: p.short ?? cur.short, description: p.desc ?? cur.desc,
    specs: JSON.stringify(p.specs ?? cur.specs), segment: p.segment ?? cur.segment, extra: JSON.stringify(p.extra ?? cur.extra), icon: p.icon ?? cur.icon,
    image: p.image ?? cur.image, video: p.video ?? cur.video,
    images: JSON.stringify(p.images ?? cur.images), model: p.model ?? cur.model, stock: p.stock ?? cur.stock,
    active: (p.active ?? cur.active) ? 1 : 0, sort: p.sort ?? cur.sort,
  });
  return getProduct(id, { storeId });
}
export function deleteProduct(id, options = {}) { S.delProduct.run(id, normalizeStoreId(options.storeId)); }
export function adjustStock(id, delta, options = {}) { S.adjStock.run(delta, id, normalizeStoreId(options.storeId)); }

// ───────────── settings ─────────────
export function getSetting(key) { return S.getSetting.get(key)?.value; }
export function setSetting(key, value) { S.setSetting.run(key, value ?? ''); }
export function allSettings() { return Object.fromEntries(S.allSettings.all().map((r) => [r.key, r.value])); }

// ───────────── reviews ─────────────
export function addReview(productId, userId, name, rating, comment, options = {}) {
  S.insReview.run(normalizeStoreId(options.storeId), productId, userId, name || '', rating, comment || '', Date.now());
}
export function listReviews(productId, options = {}) {
  return S.listReviews.all(productId, normalizeStoreId(options.storeId)).map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, userId: r.user_id }));
}
export function reviewStats(productId, options = {}) {
  const r = S.reviewStat.get(productId, normalizeStoreId(options.storeId));
  return { count: r.c || 0, avg: r.a ? Math.round(r.a * 10) / 10 : 0 };
}
export function allReviewStats(options = {}) {
  const out = {};
  for (const r of S.allReviewStats.all(normalizeStoreId(options.storeId))) out[r.product_id] = { count: r.c, avg: Math.round(r.a * 10) / 10 };
  return out;
}
export function getAdminOrderAnalytics(days = 30, options = {}) {
  const safeDays = Math.min(90, Math.max(7, parseInt(days, 10) || 30));
  const orders = listOrders(5000, { storeId: options.storeId });
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
export function userReviewed(productId, userId, options = {}) { return !!S.userReviewed.get(productId, userId, normalizeStoreId(options.storeId)); }

// ───────────── articles ─────────────
function rowToArticle(r) {
  if (!r) return null;
  return { storeId: r.store_id || 'store_main', id: r.id, title: r.title, cover: r.cover, excerpt: r.excerpt, body: r.body, published: !!r.published, createdAt: r.created_at };
}
export function createArticle(a) {
  const storeId = normalizeStoreId(a.storeId);
  S.insArticle.run({ store_id: storeId, id: a.id, title: a.title, cover: a.cover || '', excerpt: a.excerpt || '', body: a.body || '', published: a.published === false ? 0 : 1, created_at: Date.now() });
  return getArticle(a.id, { storeId });
}
export function getArticle(id, options = {}) {
  return rowToArticle(db.prepare(`SELECT * FROM articles WHERE id=? AND store_id=?`).get(id, normalizeStoreId(options.storeId)));
}
export function listArticles(all = false, options = {}) {
  const sql = `SELECT * FROM articles WHERE store_id=?${all ? '' : ' AND published=1'} ORDER BY created_at DESC`;
  return db.prepare(sql).all(normalizeStoreId(options.storeId)).map(rowToArticle);
}
export function updateArticle(id, a) {
  const storeId = normalizeStoreId(a.storeId);
  const c = getArticle(id, { storeId }); if (!c) return null;
  S.updArticle.run({ store_id: storeId, id, title: a.title ?? c.title, cover: a.cover ?? c.cover, excerpt: a.excerpt ?? c.excerpt, body: a.body ?? c.body, published: (a.published ?? c.published) ? 1 : 0 });
  return getArticle(id, { storeId });
}
export function deleteArticle(id, options = {}) { S.delArticle.run(id, normalizeStoreId(options.storeId)); }

// ───────────── community ─────────────
function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}
function normalizeStoreId(value = '') {
  return String(value || '').trim() || 'store_main';
}
function rowToCommunityPost(r, viewerId = '') {
  if (!r) return null;
  const viewer = String(viewerId || '').trim();
  return {
    storeId: r.store_id || 'store_main',
    id: r.id,
    userId: r.user_id || '',
    authorName: r.author_name || 'สมาชิก',
    authorAvatar: r.author_avatar || '',
    authorRole: r.author_role || 'member',
    caption: r.caption || '',
    media: parseJson(r.media, []),
    hashtags: parseJson(r.hashtags, []),
    articleId: r.article_id || '',
    productIds: parseJson(r.product_ids, []),
    status: r.status || 'approved',
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    likes: Number(r.likes || 0),
    comments: Number(r.comments || 0),
    saves: Number(r.saves || 0),
    liked: viewer ? !!S.userCommunityReaction.get(r.id, viewer, 'like') : false,
    saved: viewer ? !!S.userCommunitySave.get(r.id, viewer) : false,
  };
}
function rowToCommunityComment(r) {
  if (!r) return null;
  return { id: r.id, postId: r.post_id, userId: r.user_id || '', authorName: r.author_name || 'สมาชิก', text: r.text || '', status: r.status || 'approved', createdAt: r.created_at };
}
function rowToCommunityStory(r) {
  if (!r) return null;
  return { storeId: r.store_id || 'store_main', id: r.id, postId: r.post_id || '', authorName: r.author_name || 'Community', title: r.title || '', media: r.media || '', caption: r.caption || '', status: r.status || 'approved', createdAt: r.created_at, expiresAt: r.expires_at };
}
function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '').split(/[,\s#]+/).map((item) => item.trim()).filter(Boolean);
}
function articleToPost(article) {
  const body = String(article?.body || '').trim();
  const caption = [article?.excerpt, body.split(/\n+/)[0]].filter(Boolean).join('\n\n').slice(0, 1200);
  return {
    id: `post_${article.id}`,
    userId: '',
    authorName: 'ทีมจูนนุชฟอร์ไลฟ์',
    authorRole: 'admin',
    caption,
    media: article.cover ? [{ type: 'image', url: article.cover }] : [],
    hashtags: ['ความรู้', 'ประสบการณ์', 'จูนนุชฟอร์ไลฟ์'],
    articleId: article.id,
    productIds: [],
    status: article.published ? 'approved' : 'hidden',
    pinned: 0,
  };
}
export function createCommunityPost(post = {}) {
  const now = Date.now();
  const row = {
    store_id: normalizeStoreId(post.storeId),
    id: post.id || `cp_${now}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: post.userId || post.user_id || '',
    author_name: post.authorName || post.author_name || 'สมาชิก',
    author_avatar: post.authorAvatar || post.author_avatar || '',
    author_role: post.authorRole || post.author_role || 'member',
    caption: String(post.caption || '').trim(),
    media: JSON.stringify(Array.isArray(post.media) ? post.media : []),
    hashtags: JSON.stringify(normalizeArray(post.hashtags)),
    article_id: post.articleId || post.article_id || '',
    product_ids: JSON.stringify(normalizeArray(post.productIds || post.product_ids)),
    status: post.status || 'pending',
    pinned: post.pinned ? 1 : 0,
    created_at: post.createdAt || now,
    updated_at: now,
  };
  S.insCommunityPost.run(row);
  return getCommunityPost(row.id, { storeId: row.store_id });
}
export function getCommunityPost(id, options = {}) {
  return rowToCommunityPost(S.getCommunityPost.get(id, normalizeStoreId(options.storeId)), options.viewerId);
}
export function listCommunityPosts(options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30) || 30));
  const rows = (options.all ? S.listCommunityPostsAll : S.listCommunityPosts).all({ store_id: normalizeStoreId(options.storeId), limit });
  return rows.map((row) => rowToCommunityPost(row, options.viewerId));
}
export function updateCommunityPostStatus(id, patch = {}) {
  const storeId = normalizeStoreId(patch.storeId);
  const current = getCommunityPost(id, { storeId });
  if (!current) return null;
  const pinned = (patch.pinned ?? current.pinned) ? 1 : 0;
  S.updCommunityPostStatus.run({ id, store_id: storeId, status: patch.status || current.status, pinned, updated_at: Date.now() });
  return getCommunityPost(id, { storeId });
}
export function deleteCommunityPost(id, options = {}) { S.delCommunityPost.run(id, normalizeStoreId(options.storeId)); }
export function createCommunityComment(postId, comment = {}) {
  const storeId = normalizeStoreId(comment.storeId);
  const post = getCommunityPost(postId, { storeId });
  if (!post) return null;
  const row = {
    id: comment.id || `cc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    post_id: postId,
    user_id: comment.userId || '',
    author_name: comment.authorName || 'สมาชิก',
    text: String(comment.text || '').trim().slice(0, 1000),
    status: comment.status || 'approved',
    created_at: Date.now(),
  };
  S.insCommunityComment.run(row);
  return rowToCommunityComment(row);
}
export function listCommunityComments(postId, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50) || 50));
  if (!getCommunityPost(postId, { storeId: options.storeId })) return [];
  return S.listCommunityComments.all(postId, limit).map(rowToCommunityComment);
}
export function setCommunityReaction(postId, userId, type = 'like', active = true, options = {}) {
  const storeId = normalizeStoreId(options.storeId);
  if (!getCommunityPost(postId, { storeId })) return null;
  if (active) S.upsertCommunityReaction.run(postId, userId, type, Date.now());
  else S.delCommunityReaction.run(postId, userId, type);
  return getCommunityPost(postId, { storeId, viewerId: userId });
}
export function setCommunitySave(postId, userId, active = true, options = {}) {
  const storeId = normalizeStoreId(options.storeId);
  if (!getCommunityPost(postId, { storeId })) return null;
  if (active) S.upsertCommunitySave.run(postId, userId, Date.now());
  else S.delCommunitySave.run(postId, userId);
  return getCommunityPost(postId, { storeId, viewerId: userId });
}
export function createCommunityStory(story = {}) {
  const now = Date.now();
  const row = {
    store_id: normalizeStoreId(story.storeId),
    id: story.id || `story_${now}_${Math.random().toString(36).slice(2, 8)}`,
    post_id: story.postId || '',
    author_name: story.authorName || 'Community',
    title: story.title || '',
    media: story.media || '',
    caption: story.caption || '',
    status: story.status || 'approved',
    created_at: story.createdAt || now,
    expires_at: story.expiresAt || (now + 24 * 60 * 60 * 1000),
  };
  S.insCommunityStory.run(row);
  return rowToCommunityStory(row);
}
export function listCommunityStories(options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30) || 30));
  const params = { store_id: normalizeStoreId(options.storeId), now: Date.now(), limit };
  const rows = (options.all ? S.listCommunityStoriesAll.all(params) : S.listCommunityStories.all(params));
  return rows.map(rowToCommunityStory);
}
export function deleteCommunityStory(id, options = {}) { S.delCommunityStory.run(id, normalizeStoreId(options.storeId)); }
export function seedCommunityFromArticles(options = {}) {
  const articles = listArticles(Boolean(options.all), { storeId: options.storeId });
  let posts = 0;
  let stories = 0;
  for (const article of articles) {
    if (!article?.id) continue;
    const postId = `post_${article.id}`;
    if (!getCommunityPost(postId, { storeId: options.storeId })) {
      createCommunityPost({ ...articleToPost(article), storeId: options.storeId });
      posts += 1;
    }
    const storyId = `story_${article.id}`;
    const existingStory = S.listCommunityStoriesAll.all({ store_id: normalizeStoreId(options.storeId), limit: 500 }).find((item) => item.id === storyId);
    if (!existingStory && article.cover) {
      createCommunityStory({
        id: storyId,
        storeId: options.storeId,
        postId,
        authorName: 'ทีมจูนนุชฟอร์ไลฟ์',
        title: article.title,
        media: article.cover,
        caption: article.excerpt || article.title,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      stories += 1;
    }
  }
  return { posts, stories, totalArticles: articles.length };
}

export default db;
