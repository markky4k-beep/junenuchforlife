import { createSupabaseAdminClient } from './supabase-client.js';

const supabase = createSupabaseAdminClient();

function fail(error, context) {
  if (!error) return;
  throw new Error(context ? `${context}: ${error.message}` : (error.message || 'Supabase query failed'));
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id,
    items: Array.isArray(r.items) ? r.items : [],
    total: r.total,
    subtotal: r.subtotal || r.total,
    discount: r.discount || 0,
    shipping: r.shipping || 0,
    coupon: r.coupon || '',
    customer: r.customer || {},
    payment_method: r.payment_method,
    status: r.status,
    paid: bool(r.paid),
    payment_claimed: bool(r.payment_claimed),
    tracking: r.tracking || '',
    session_id: r.session_id || '',
    stripe_session: r.stripe_session || '',
    user_id: r.user_id || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

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

function rowToProduct(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    tag: r.tag || '',
    price: r.price,
    short: r.short || '',
    desc: r.description || '',
    specs: r.specs || {},
    segment: r.segment || 'agri',
    extra: r.extra || {},
    icon: r.icon || 'pod',
    image: r.image || '',
    video: r.video || '',
    images: Array.isArray(r.images) ? r.images : [],
    model: r.model || '',
    stock: r.stock || 0,
    active: bool(r.active),
    sort: r.sort || 0,
    createdAt: r.created_at,
  };
}

function rowToCoupon(r) {
  if (!r) return null;
  return {
    code: r.code,
    type: r.type,
    value: r.value,
    minTotal: r.min_total || 0,
    maxUses: r.max_uses || 0,
    used: r.used || 0,
    active: bool(r.active),
    expiresAt: r.expires_at || 0,
    createdAt: r.created_at,
  };
}

function rowToArticle(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    cover: r.cover || '',
    excerpt: r.excerpt || '',
    body: r.body || '',
    published: bool(r.published),
    createdAt: r.created_at,
  };
}

export async function createOrder(o) {
  const now = Date.now();
  const row = {
    id: o.id,
    items: o.items || [],
    total: o.total,
    subtotal: o.subtotal ?? o.total,
    discount: o.discount || 0,
    shipping: o.shipping || 0,
    coupon: o.coupon || '',
    customer: o.customer || {},
    payment_method: o.payment_method,
    status: o.status,
    paid: !!o.paid,
    payment_claimed: false,
    tracking: o.tracking || '',
    session_id: o.session_id || '',
    stripe_session: o.stripe_session || '',
    user_id: o.user_id || '',
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('orders').insert(row).select('*').single();
  fail(error, 'createOrder');
  return rowToOrder(data);
}

export async function getOrder(id) {
  const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle();
  fail(error, 'getOrder');
  return rowToOrder(data);
}

export async function listOrders(limit = 50) {
  const { data, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit);
  fail(error, 'listOrders');
  return (data || []).map(rowToOrder);
}

export async function listOrdersByUser(uid, limit = 50) {
  const { data, error } = await supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit);
  fail(error, 'listOrdersByUser');
  return (data || []).map(rowToOrder);
}

export async function updateOrder(id, patch) {
  const cur = await getOrder(id);
  if (!cur) return null;
  const payload = {
    status: patch.status ?? cur.status,
    paid: patch.paid ?? cur.paid,
    payment_claimed: patch.payment_claimed ?? cur.payment_claimed,
    tracking: patch.tracking ?? cur.tracking,
    stripe_session: patch.stripe_session ?? cur.stripe_session,
    updated_at: Date.now(),
  };
  const { data, error } = await supabase.from('orders').update(payload).eq('id', id).select('*').single();
  fail(error, 'updateOrder');
  return rowToOrder(data);
}

export async function saveMessage(sessionId, sender, text, at = Date.now()) {
  const { error } = await supabase.from('messages').insert({ session_id: sessionId, sender, text, at });
  fail(error, 'saveMessage');
}
export async function listMessagesSince(sessionId, after = 0) {
  const { data, error } = await supabase.from('messages')
    .select('sender, text, at').eq('session_id', String(sessionId || ''))
    .gt('at', Number(after) || 0).order('at', { ascending: true }).limit(100);
  fail(error, 'listMessagesSince');
  return data || [];
}

export async function createUser(u) {
  const row = { ...u, email: String(u.email).toLowerCase(), created_at: Date.now() };
  const { data, error } = await supabase.from('users').insert(row).select('*').single();
  fail(error, 'createUser');
  return data;
}

export async function getUserByEmail(email) {
  const { data, error } = await supabase.from('users').select('*').eq('email', String(email).toLowerCase()).maybeSingle();
  fail(error, 'getUserByEmail');
  return data;
}

export async function getUserById(id) {
  const { data, error } = await supabase.from('users').select('*').eq('id', id).maybeSingle();
  fail(error, 'getUserById');
  return data;
}

export async function listUsers() {
  const { data, error } = await supabase.from('users').select('id,email,name,role,created_at').order('created_at', { ascending: false });
  fail(error, 'listUsers');
  return data || [];
}

export async function createToken(token, userId, ttlMs = 1000 * 60 * 60 * 24 * 30) {
  const { error } = await supabase.from('auth_tokens').insert({
    token,
    user_id: userId,
    created_at: Date.now(),
    expires_at: Date.now() + ttlMs,
  });
  fail(error, 'createToken');
}

export async function getToken(token) {
  const { data, error } = await supabase.from('auth_tokens').select('*').eq('token', token).maybeSingle();
  fail(error, 'getToken');
  return data;
}

export async function deleteToken(token) {
  const { error } = await supabase.from('auth_tokens').delete().eq('token', token);
  fail(error, 'deleteToken');
}

export async function updateUser(id, patch) {
  const cur = await getUserById(id);
  if (!cur) return null;
  const { data, error } = await supabase.from('users').update({
    name: patch.name ?? cur.name,
    role: patch.role ?? cur.role,
  }).eq('id', id).select('*').single();
  fail(error, 'updateUser');
  return data;
}

export async function deleteUser(id) {
  const { error } = await supabase.from('users').delete().eq('id', id);
  fail(error, 'deleteUser');
}

export async function countAdmins() {
  const { count, error } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'admin');
  fail(error, 'countAdmins');
  return count || 0;
}

export async function listCoupons() {
  const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  fail(error, 'listCoupons');
  return (data || []).map(rowToCoupon);
}

export async function getCoupon(code) {
  const { data, error } = await supabase.from('coupons').select('*').eq('code', String(code).toUpperCase()).maybeSingle();
  fail(error, 'getCoupon');
  return rowToCoupon(data);
}

export async function createCoupon(c) {
  const row = {
    code: String(c.code).toUpperCase(),
    type: c.type === 'fixed' ? 'fixed' : 'percent',
    value: parseInt(c.value, 10) || 0,
    min_total: parseInt(c.minTotal, 10) || 0,
    max_uses: parseInt(c.maxUses, 10) || 0,
    used: 0,
    active: c.active === false ? false : true,
    expires_at: parseInt(c.expiresAt, 10) || 0,
    created_at: Date.now(),
  };
  const { data, error } = await supabase.from('coupons').insert(row).select('*').single();
  fail(error, 'createCoupon');
  return rowToCoupon(data);
}

export async function updateCoupon(code, c) {
  const cur = await getCoupon(code);
  if (!cur) return null;
  const { data, error } = await supabase.from('coupons').update({
    type: c.type ?? cur.type,
    value: c.value !== undefined ? parseInt(c.value, 10) || 0 : cur.value,
    min_total: c.minTotal !== undefined ? parseInt(c.minTotal, 10) || 0 : cur.minTotal,
    max_uses: c.maxUses !== undefined ? parseInt(c.maxUses, 10) || 0 : cur.maxUses,
    active: c.active ?? cur.active,
    expires_at: c.expiresAt !== undefined ? parseInt(c.expiresAt, 10) || 0 : cur.expiresAt,
  }).eq('code', String(code).toUpperCase()).select('*').single();
  fail(error, 'updateCoupon');
  return rowToCoupon(data);
}

export async function deleteCoupon(code) {
  const { error } = await supabase.from('coupons').delete().eq('code', String(code).toUpperCase());
  fail(error, 'deleteCoupon');
}

export async function incCouponUse(code) {
  const cur = await getCoupon(code);
  if (!cur) return;
  const { error } = await supabase.from('coupons').update({ used: (cur.used || 0) + 1 }).eq('code', String(code).toUpperCase());
  fail(error, 'incCouponUse');
}

export async function createLead(lead) {
  const now = Date.now();
  const row = {
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
  const { data, error } = await supabase.from('leads').insert(row).select('*').single();
  fail(error, 'createLead');
  return rowToLead(data);
}

export async function getLead(id) {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  fail(error, 'getLead');
  return rowToLead(data);
}

export async function listLeads(limit = 200) {
  const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(limit);
  fail(error, 'listLeads');
  return (data || []).map(rowToLead);
}

export async function updateLead(id, patch) {
  const cur = await getLead(id);
  if (!cur) return null;
  const { data, error } = await supabase.from('leads').update({
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
  }).eq('id', id).select('*').single();
  fail(error, 'updateLead');
  return rowToLead(data);
}

export async function getProduct(id) {
  const { data, error } = await supabase.from('products').select('*').eq('id', id).maybeSingle();
  fail(error, 'getProduct');
  return rowToProduct(data);
}

export async function listProducts(includeInactive = false) {
  let q = supabase.from('products').select('*').order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  fail(error, 'listProducts');
  return (data || []).map(rowToProduct);
}

export async function createProduct(p) {
  const row = {
    id: p.id,
    name: p.name,
    tag: p.tag || '',
    price: p.price,
    short: p.short || '',
    description: p.desc || '',
    specs: p.specs || {},
    segment: p.segment || 'agri',
    extra: p.extra || {},
    icon: p.icon || 'pod',
    image: p.image || '',
    video: p.video || '',
    images: p.images || [],
    model: p.model || '',
    stock: p.stock ?? 0,
    active: p.active === false ? false : true,
    sort: p.sort ?? 0,
    created_at: Date.now(),
  };
  const { data, error } = await supabase.from('products').insert(row).select('*').single();
  fail(error, 'createProduct');
  return rowToProduct(data);
}

export async function updateProduct(id, p) {
  const cur = await getProduct(id);
  if (!cur) return null;
  const { data, error } = await supabase.from('products').update({
    name: p.name ?? cur.name,
    tag: p.tag ?? cur.tag,
    price: p.price ?? cur.price,
    short: p.short ?? cur.short,
    description: p.desc ?? cur.desc,
    specs: p.specs ?? cur.specs,
    segment: p.segment ?? cur.segment,
    extra: p.extra ?? cur.extra,
    icon: p.icon ?? cur.icon,
    image: p.image ?? cur.image,
    video: p.video ?? cur.video,
    images: p.images ?? cur.images,
    model: p.model ?? cur.model,
    stock: p.stock ?? cur.stock,
    active: p.active ?? cur.active,
    sort: p.sort ?? cur.sort,
  }).eq('id', id).select('*').single();
  fail(error, 'updateProduct');
  return rowToProduct(data);
}

export async function deleteProduct(id) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  fail(error, 'deleteProduct');
}

export async function adjustStock(id, delta) {
  const cur = await getProduct(id);
  if (!cur) return;
  const { error } = await supabase.from('products').update({ stock: Math.max(0, (cur.stock || 0) + delta) }).eq('id', id);
  fail(error, 'adjustStock');
}

export async function getSetting(key) {
  const { data, error } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  fail(error, 'getSetting');
  return data?.value;
}

export async function setSetting(key, value) {
  const { error } = await supabase.from('settings').upsert({ key, value: value ?? '' }, { onConflict: 'key' });
  fail(error, 'setSetting');
}

export async function allSettings() {
  const { data, error } = await supabase.from('settings').select('key,value');
  fail(error, 'allSettings');
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}

export async function addReview(productId, userId, name, rating, comment) {
  const { error } = await supabase.from('reviews').insert({
    product_id: productId,
    user_id: userId,
    name: name || '',
    rating,
    comment: comment || '',
    created_at: Date.now(),
  });
  fail(error, 'addReview');
}

export async function listReviews(productId) {
  const { data, error } = await supabase.from('reviews').select('*').eq('product_id', productId).order('created_at', { ascending: false });
  fail(error, 'listReviews');
  return (data || []).map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, userId: r.user_id }));
}

export async function reviewStats(productId) {
  const { data, error } = await supabase.from('reviews').select('rating').eq('product_id', productId);
  fail(error, 'reviewStats');
  const count = data?.length || 0;
  const avg = count ? Math.round((data.reduce((sum, row) => sum + (row.rating || 0), 0) / count) * 10) / 10 : 0;
  return { count, avg };
}

export async function allReviewStats() {
  const { data, error } = await supabase.from('reviews').select('product_id,rating');
  fail(error, 'allReviewStats');
  const grouped = {};
  for (const row of data || []) {
    const entry = grouped[row.product_id] || { total: 0, sum: 0 };
    entry.total += 1;
    entry.sum += row.rating || 0;
    grouped[row.product_id] = entry;
  }
  return Object.fromEntries(Object.entries(grouped).map(([id, value]) => [id, { count: value.total, avg: Math.round((value.sum / value.total) * 10) / 10 }]));
}

export async function userReviewed(productId, userId) {
  const { data, error } = await supabase.from('reviews').select('id').eq('product_id', productId).eq('user_id', userId).limit(1).maybeSingle();
  fail(error, 'userReviewed');
  return !!data;
}

export async function createArticle(a) {
  const row = {
    id: a.id,
    title: a.title,
    cover: a.cover || '',
    excerpt: a.excerpt || '',
    body: a.body || '',
    published: a.published === false ? false : true,
    created_at: Date.now(),
  };
  const { data, error } = await supabase.from('articles').insert(row).select('*').single();
  fail(error, 'createArticle');
  return rowToArticle(data);
}

export async function getArticle(id) {
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).maybeSingle();
  fail(error, 'getArticle');
  return rowToArticle(data);
}

export async function listArticles(all = false) {
  let q = supabase.from('articles').select('*').order('created_at', { ascending: false });
  if (!all) q = q.eq('published', true);
  const { data, error } = await q;
  fail(error, 'listArticles');
  return (data || []).map(rowToArticle);
}

export async function updateArticle(id, a) {
  const cur = await getArticle(id);
  if (!cur) return null;
  const { data, error } = await supabase.from('articles').update({
    title: a.title ?? cur.title,
    cover: a.cover ?? cur.cover,
    excerpt: a.excerpt ?? cur.excerpt,
    body: a.body ?? cur.body,
    published: a.published ?? cur.published,
  }).eq('id', id).select('*').single();
  fail(error, 'updateArticle');
  return rowToArticle(data);
}

export async function deleteArticle(id) {
  const { error } = await supabase.from('articles').delete().eq('id', id);
  fail(error, 'deleteArticle');
}

export default supabase;
