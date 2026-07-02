import { createSupabaseAdminClient } from './supabase-client.js';

const supabase = createSupabaseAdminClient();

function fail(error, context) {
  if (!error) return;
  throw new Error(context ? `${context}: ${error.message}` : (error.message || 'Supabase query failed'));
}
function isMissingRpc(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return code === 'PGRST202' || /function .* does not exist/i.test(message);
}
function normalizeSearchTerm(value = '') {
  return String(value || '').trim().replace(/[\r\n,()]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}
function normalizeChatSessionId(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function applyAdminOrderFilters(query, { search = '', status = '' } = {}) {
  let next = query;
  const normalizedStatus = String(status || '').trim();
  if (normalizedStatus) next = next.eq('status', normalizedStatus);
  const normalizedSearch = normalizeSearchTerm(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    next = next.or([
      `id.ilike.${like}`,
      `tracking.ilike.${like}`,
      `line_user_id.ilike.${like}`,
      `customer->>name.ilike.${like}`,
      `customer->>phone.ilike.${like}`,
    ].join(','));
  }
  return next;
}
function applyAdminUserFilters(query, { search = '', role = '' } = {}) {
  let next = query;
  const normalizedRole = String(role || '').trim();
  if (normalizedRole) next = next.eq('role', normalizedRole);
  const normalizedSearch = normalizeSearchTerm(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    next = next.or([
      `id.ilike.${like}`,
      `email.ilike.${like}`,
      `name.ilike.${like}`,
    ].join(','));
  }
  return next;
}
function applyAdminLeadFilters(query, { search = '', status = '' } = {}) {
  let next = query;
  const normalizedStatus = String(status || '').trim();
  if (normalizedStatus) next = next.eq('status', normalizedStatus);
  const normalizedSearch = normalizeSearchTerm(search);
  if (normalizedSearch) {
    const like = `%${normalizedSearch}%`;
    next = next.or([
      `name.ilike.${like}`,
      `phone.ilike.${like}`,
      `line_id.ilike.${like}`,
      `province.ilike.${like}`,
      `crop.ilike.${like}`,
      `source.ilike.${like}`,
    ].join(','));
  }
  return next;
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}
async function selectAllPages(buildQuery, { pageSize = 1000 } = {}) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    fail(error, 'selectAllPages');
    const chunk = data || [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return rows;
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
    channel: r.channel || 'web',
    line_user_id: r.line_user_id || '',
    accessToken: r.access_token || '',
    resourcesReserved: bool(r.resources_reserved),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
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
function rowToAdminOrderSummary(r) {
  if (!r) return null;
  const items = Array.isArray(r.items) ? r.items : [];
  return {
    id: r.id,
    total: Number(r.total || 0),
    payment_method: r.payment_method || '',
    status: r.status || '',
    paid: bool(r.paid),
    payment_claimed: bool(r.payment_claimed),
    tracking: r.tracking || '',
    createdAt: r.created_at || 0,
    user_id: r.user_id || '',
    channel: r.channel || 'web',
    line_user_id: r.line_user_id || '',
    customerName: String(r.customer_name || r.customer?.name || '').trim(),
    customerPhone: String(r.customer_phone || r.customer?.phone || '').trim(),
    itemCount: Number(r.item_count || items.reduce((sum, item) => sum + orderItemQty(item), 0) || 0),
    itemSummary: String(r.item_summary || orderItemsSummary(items)).trim(),
  };
}

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
    channel: o.channel || 'web',
    line_user_id: o.line_user_id || '',
    access_token: o.access_token || '',
    resources_reserved: o.resources_reserved === false ? false : true,
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
export async function listAdminOrderSummaries(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const normalizedStatus = String(filters?.status || '').trim();
  const normalizedSearch = normalizeSearchTerm(filters?.search);
  if (!normalizedStatus && !normalizedSearch) {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_admin_order_summaries', { p_limit: safeLimit, p_offset: safeOffset });
    if (!rpcError) return (rpcData || []).map(rowToAdminOrderSummary);
    if (!isMissingRpc(rpcError)) fail(rpcError, 'listAdminOrderSummaries');
  }
  let query = supabase.from('orders')
    .select('id,total,payment_method,status,paid,payment_claimed,tracking,customer,items,created_at,user_id,channel,line_user_id')
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);
  query = applyAdminOrderFilters(query, { search: normalizedSearch, status: normalizedStatus });
  const { data, error } = await query;
  fail(error, 'listAdminOrderSummaries');
  return (data || []).map(rowToAdminOrderSummary);
}

export async function listOrdersByUser(uid, limit = 50) {
  const { data, error } = await supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit);
  fail(error, 'listOrdersByUser');
  return (data || []).map(rowToOrder);
}
export async function countOrders({ paid, status, deliveredOnly = false, search = '' } = {}) {
  let q = supabase.from('orders').select('id', { count: 'exact', head: true });
  if (paid !== undefined) q = q.eq('paid', !!paid);
  if (status) q = q.eq('status', String(status));
  if (deliveredOnly) q = q.eq('status', 'delivered');
  if (search) q = applyAdminOrderFilters(q, { search, status: deliveredOnly ? 'delivered' : status });
  const { count, error } = await q;
  fail(error, 'countOrders');
  return count || 0;
}
export async function listOrderIdentityRows() {
  const rows = await selectAllPages((from, to) => supabase
    .from('orders')
    .select('status,customer')
    .order('created_at', { ascending: false })
    .range(from, to));
  return rows || [];
}
export async function listDeliveredOrderTimingRows() {
  const rows = await selectAllPages((from, to) => supabase
    .from('orders')
    .select('created_at,updated_at')
    .eq('status', 'delivered')
    .order('created_at', { ascending: false })
    .range(from, to));
  return rows || [];
}

export async function listExpiredOrderReservations(beforeTs, limit = 50) {
  const { data, error } = await supabase.from('orders')
    .select('*')
    .eq('paid', false)
    .eq('payment_claimed', false)
    .eq('resources_reserved', true)
    .eq('status', 'awaiting_payment')
    .lt('created_at', Number(beforeTs) || 0)
    .order('created_at', { ascending: true })
    .limit(limit);
  fail(error, 'listExpiredOrderReservations');
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
    resources_reserved: patch.resources_reserved ?? cur.resourcesReserved,
    updated_at: Date.now(),
  };
  const { data, error } = await supabase.from('orders').update(payload).eq('id', id).select('*').single();
  fail(error, 'updateOrder');
  return rowToOrder(data);
}

export async function reserveOrderResources({ items = [], coupon = '' } = {}) {
  const { error } = await supabase.rpc('reserve_order_resources', {
    p_items: items,
    p_coupon: String(coupon || '').trim().toUpperCase(),
  });
  fail(error, 'reserveOrderResources');
}

export async function releaseOrderResources({ items = [], coupon = '' } = {}) {
  const { error } = await supabase.rpc('release_order_resources', {
    p_items: items,
    p_coupon: String(coupon || '').trim().toUpperCase(),
  });
  fail(error, 'releaseOrderResources');
}

export async function getPaymentLog(orderId) {
  const { data, error } = await supabase.from('payment_logs').select('*').eq('order_id', String(orderId || '').trim()).maybeSingle();
  fail(error, 'getPaymentLog');
  return rowToPaymentLog(data);
}

export async function upsertPaymentLog(orderId, patch = {}) {
  const current = await getPaymentLog(orderId);
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
    ...(current || {}),
    ...patch,
    order_id: String(orderId || '').trim(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('payment_logs').upsert(payload, { onConflict: 'order_id' }).select('*').single();
  fail(error, 'upsertPaymentLog');
  return rowToPaymentLog(data);
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
export async function listChatSessions({ search = '', limit = 20, offset = 0 } = {}) {
  const normalizedSearch = normalizeSearchTerm(search);
  const rows = await selectAllPages((from, to) => {
    let query = supabase.from('messages').select('session_id, sender, text, at').order('at', { ascending: false });
    if (normalizedSearch) {
      const like = `%${normalizedSearch}%`;
      query = query.or(`session_id.ilike.${like},text.ilike.${like}`);
    }
    return query.range(from, to);
  }, { pageSize: 1000 });
  const summaryMap = new Map();
  for (const row of rows) {
    const sessionId = normalizeChatSessionId(row?.session_id);
    if (!sessionId) continue;
    const at = Number(row?.at || 0);
    const existing = summaryMap.get(sessionId) || {
      session_id: sessionId,
      last_at: 0,
      last_customer_at: 0,
      last_sender: '',
      last_text: '',
      customer_count: 0,
      admin_count: 0,
    };
    if (!summaryMap.has(sessionId)) {
      existing.last_at = at;
      existing.last_sender = String(row?.sender || '').trim();
      existing.last_text = String(row?.text || '').trim();
    }
    if (row?.sender === 'customer') {
      existing.customer_count += 1;
      existing.last_customer_at = Math.max(existing.last_customer_at || 0, at);
    }
    if (row?.sender === 'admin') existing.admin_count += 1;
    summaryMap.set(sessionId, existing);
  }
  const allItems = [...summaryMap.values()].sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return {
    items: allItems.slice(safeOffset, safeOffset + safeLimit),
    total: allItems.length,
  };
}
export async function listChatMessages(sessionId, limit = 200) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return [];
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  const { data, error } = await supabase.from('messages')
    .select('id, session_id, sender, text, at')
    .eq('session_id', normalizedSessionId)
    .order('at', { ascending: true })
    .limit(safeLimit);
  fail(error, 'listChatMessages');
  return data || [];
}
export async function deleteChatSession(sessionId) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return false;
  const { error } = await supabase.from('messages').delete().eq('session_id', normalizedSessionId);
  fail(error, 'deleteChatSession');
  return true;
}
export async function findLatestOrderBySessionId(sessionId) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return null;
  const { data, error } = await supabase.from('orders')
    .select('id,total,payment_method,status,paid,payment_claimed,tracking,customer,items,created_at,user_id,channel,line_user_id,session_id')
    .eq('session_id', normalizedSessionId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error, 'findLatestOrderBySessionId');
  return rowToOrder(data);
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
export async function listAdminUsers(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  let query = supabase.from('users').select('id,email,name,role,created_at').order('created_at', { ascending: false }).range(safeOffset, safeOffset + safeLimit - 1);
  query = applyAdminUserFilters(query, filters);
  const { data, error } = await query;
  fail(error, 'listAdminUsers');
  return data || [];
}
export async function countUsers({ search = '', role = '' } = {}) {
  let query = supabase.from('users').select('id', { count: 'exact', head: true });
  query = applyAdminUserFilters(query, { search, role });
  const { count, error } = await query;
  fail(error, 'countUsers');
  return count || 0;
}
export async function listUserIdentityRows() {
  const rows = await selectAllPages((from, to) => supabase
    .from('users')
    .select('id,email,role')
    .order('created_at', { ascending: false })
    .range(from, to));
  return rows || [];
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
  const normalizedCode = String(code || '').toUpperCase();
  if (!normalizedCode) return;
  const { error } = await supabase.rpc('increment_coupon_use', { p_code: normalizedCode });
  if (error && !isMissingRpc(error)) fail(error, 'incCouponUse');
  if (!error) return;
  const cur = await getCoupon(normalizedCode);
  if (!cur) return;
  const { error: fallbackError } = await supabase.from('coupons').update({ used: (cur.used || 0) + 1 }).eq('code', normalizedCode);
  fail(fallbackError, 'incCouponUse');
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
export async function listAdminLeads(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  let query = supabase.from('leads')
    .select('id,name,phone,line_id,province,crop,stage,problem,source,utm_source,utm_medium,utm_campaign,note,status,created_at,updated_at')
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);
  query = applyAdminLeadFilters(query, filters);
  const { data, error } = await query;
  fail(error, 'listAdminLeads');
  return (data || []).map(rowToLead);
}
export async function countLeads({ search = '', status = '' } = {}) {
  let query = supabase.from('leads').select('id', { count: 'exact', head: true });
  query = applyAdminLeadFilters(query, { search, status });
  const { count, error } = await query;
  fail(error, 'countLeads');
  return count || 0;
}
export async function listLeadIdentityRows() {
  const rows = await selectAllPages((from, to) => supabase
    .from('leads')
    .select('name,phone,line_id,province')
    .order('created_at', { ascending: false })
    .range(from, to));
  return rows || [];
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
export async function listProductsByIds(ids = [], includeInactive = false) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) return [];
  let q = supabase.from('products').select('*').in('id', uniqueIds);
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  fail(error, 'listProductsByIds');
  return (data || []).map(rowToProduct);
}

export async function listProducts(includeInactive = false) {
  let q = supabase.from('products').select('*').order('sort', { ascending: true }).order('created_at', { ascending: true });
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  fail(error, 'listProducts');
  return (data || []).map(rowToProduct);
}
export async function countProducts(includeInactive = false) {
  let q = supabase.from('products').select('id', { count: 'exact', head: true });
  if (!includeInactive) q = q.eq('active', true);
  const { count, error } = await q;
  fail(error, 'countProducts');
  return count || 0;
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
  const { data, error } = await supabase.rpc('get_review_stats', { p_product_id: String(productId || '') || null });
  if (error && !isMissingRpc(error)) fail(error, 'reviewStats');
  if (!error) {
    const row = Array.isArray(data) ? data[0] : null;
    return {
      count: Number(row?.review_count || 0),
      avg: Math.round((Number(row?.review_avg || 0) || 0) * 10) / 10,
    };
  }
  const { data: fallbackData, error: fallbackError } = await supabase.from('reviews').select('rating').eq('product_id', productId);
  fail(fallbackError, 'reviewStats');
  const count = fallbackData?.length || 0;
  const avg = count ? Math.round((fallbackData.reduce((sum, row) => sum + (row.rating || 0), 0) / count) * 10) / 10 : 0;
  return { count, avg };
}

export async function allReviewStats() {
  const { data, error } = await supabase.rpc('get_review_stats', { p_product_id: null });
  if (error && !isMissingRpc(error)) fail(error, 'allReviewStats');
  if (!error) {
    return Object.fromEntries((data || []).map((row) => [
      row.product_id,
      {
        count: Number(row.review_count || 0),
        avg: Math.round((Number(row.review_avg || 0) || 0) * 10) / 10,
      },
    ]));
  }
  const { data: fallbackData, error: fallbackError } = await supabase.from('reviews').select('product_id,rating');
  fail(fallbackError, 'allReviewStats');
  const grouped = {};
  for (const row of fallbackData || []) {
    const entry = grouped[row.product_id] || { total: 0, sum: 0 };
    entry.total += 1;
    entry.sum += row.rating || 0;
    grouped[row.product_id] = entry;
  }
  return Object.fromEntries(Object.entries(grouped).map(([id, value]) => [id, { count: value.total, avg: Math.round((value.sum / value.total) * 10) / 10 }]));
}
export async function getAdminOrderAnalytics(days = 30) {
  const safeDays = Math.min(90, Math.max(7, parseInt(days, 10) || 30));
  const { data, error } = await supabase.rpc('get_admin_order_analytics', { p_days: safeDays });
  fail(error, 'getAdminOrderAnalytics');
  return {
    days: Number(data?.days || safeDays),
    series: Array.isArray(data?.series) ? data.series : [],
    totals: data?.totals || { revenue: 0, orders: 0, paidOrders: 0, aov: 0, discountGiven: 0 },
    statusBreakdown: data?.statusBreakdown || {},
    payment: data?.payment || { promptpay: 0, card: 0 },
    topProducts: Array.isArray(data?.topProducts) ? data.topProducts : [],
  };
}
export async function getAdminDashboardStats() {
  const { data, error } = await supabase.rpc('get_admin_dashboard_stats');
  fail(error, 'getAdminDashboardStats');
  return {
    orders: Number(data?.orders || 0),
    revenue: Number(data?.revenue || 0),
    pending: Number(data?.pending || 0),
    leads: Number(data?.leads || 0),
    users: Number(data?.users || 0),
    products: Number(data?.products || 0),
    recent: Array.isArray(data?.recent) ? data.recent : [],
  };
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
