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
function isMissingTable(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return code === '42P01'
    || /could not find the table/i.test(message)
    || /schema cache/i.test(message)
    || /relation .* does not exist/i.test(message);
}
function isMissingColumn(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return code === '42703'
    || code === 'PGRST204'
    || /column .* does not exist/i.test(message)
    || /could not find .* column/i.test(message)
    || /schema cache/i.test(message);
}
function failUnlessMissingTable(error, context) {
  if (!error) return false;
  if (isMissingTable(error)) return true;
  fail(error, context);
  return false;
}
function normalizeSearchTerm(value = '') {
  return String(value || '').trim().replace(/[\r\n,()]/g, ' ').replace(/\s+/g, ' ').slice(0, 80);
}
function normalizeChatSessionId(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}
function normalizeStoreId(value = '') {
  return String(value || '').trim() || 'store_main';
}
function normalizeStoreHost(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}
function applyStoreScope(query, storeId = '') {
  const normalizedStoreId = String(storeId || '').trim();
  return normalizedStoreId ? query.eq('store_id', normalizedStoreId) : query;
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
    storeId: r.store_id || 'store_main',
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
    storeId: r.store_id || 'store_main',
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
    storeId: r.store_id || 'store_main',
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
    isDefault: bool(r.is_default),
    metadata: r.metadata || {},
    createdAt: r.created_at || 0,
    updatedAt: r.updated_at || 0,
  };
}
function rowToStoreDatabase(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
    databaseKey: r.database_key || '',
    provider: r.provider || 'supabase',
    schemaName: r.schema_name || 'public',
    namespace: r.namespace || '',
    status: r.status || 'ready',
    tenantTables: Array.isArray(r.tenant_tables) ? r.tenant_tables : [],
    metadata: r.metadata || {},
    createdAt: r.created_at || 0,
    updatedAt: r.updated_at || 0,
  };
}

function rowToCoupon(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
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
    storeId: r.store_id || 'store_main',
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
    store_id: normalizeStoreId(o.storeId),
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

export async function listOrders(limit = 50, options = {}) {
  let query = supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(limit);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listOrders');
  return (data || []).map(rowToOrder);
}
export async function listAdminOrderSummaries(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  const normalizedStatus = String(filters?.status || '').trim();
  const normalizedSearch = normalizeSearchTerm(filters?.search);
  const normalizedStoreId = String(filters?.storeId || '').trim();
  if (!normalizedStatus && !normalizedSearch && !normalizedStoreId) {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_admin_order_summaries', { p_limit: safeLimit, p_offset: safeOffset });
    if (!rpcError) return (rpcData || []).map(rowToAdminOrderSummary);
    if (!isMissingRpc(rpcError)) fail(rpcError, 'listAdminOrderSummaries');
  }
  let query = supabase.from('orders')
    .select('id,total,payment_method,status,paid,payment_claimed,tracking,customer,items,created_at,user_id,channel,line_user_id')
    .order('created_at', { ascending: false })
    .range(safeOffset, safeOffset + safeLimit - 1);
  query = applyStoreScope(query, normalizedStoreId);
  query = applyAdminOrderFilters(query, { search: normalizedSearch, status: normalizedStatus });
  const { data, error } = await query;
  fail(error, 'listAdminOrderSummaries');
  return (data || []).map(rowToAdminOrderSummary);
}

export async function listOrdersByUser(uid, limit = 50, options = {}) {
  let query = supabase.from('orders').select('*').eq('user_id', uid).order('created_at', { ascending: false }).limit(limit);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listOrdersByUser');
  return (data || []).map(rowToOrder);
}
export async function countOrders({ paid, status, deliveredOnly = false, search = '', storeId = '' } = {}) {
  let q = supabase.from('orders').select('id', { count: 'exact', head: true });
  q = applyStoreScope(q, storeId);
  if (paid !== undefined) q = q.eq('paid', !!paid);
  if (status) q = q.eq('status', String(status));
  if (deliveredOnly) q = q.eq('status', 'delivered');
  if (search) q = applyAdminOrderFilters(q, { search, status: deliveredOnly ? 'delivered' : status });
  const { count, error } = await q;
  fail(error, 'countOrders');
  return count || 0;
}
export async function listOrderIdentityRows(options = {}) {
  const storeId = String(options.storeId || '').trim();
  const rows = await selectAllPages((from, to) => {
    let q = supabase
      .from('orders')
      .select('status,customer');
    if (storeId) q = applyStoreScope(q, storeId);
    return q
      .order('created_at', { ascending: false })
      .range(from, to);
  });
  return rows || [];
}
export async function listDeliveredOrderTimingRows(options = {}) {
  const storeId = String(options.storeId || '').trim();
  const rows = await selectAllPages((from, to) => {
    let q = supabase
      .from('orders')
      .select('created_at,updated_at')
      .eq('status', 'delivered');
    if (storeId) q = applyStoreScope(q, storeId);
    return q
      .order('created_at', { ascending: false })
      .range(from, to);
  });
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

export async function reserveOrderResources({ items = [], coupon = '', storeId = '' } = {}) {
  const normalizedStoreId = String(storeId || '').trim();
  if (normalizedStoreId) {
    for (const item of Array.isArray(items) ? items : []) {
      const id = String(item?.id || '').trim();
      const qty = Math.max(0, parseInt(item?.qty, 10) || 0);
      if (!id || !qty) continue;
      let query = supabase.from('products').select('id,stock').eq('id', id).maybeSingle();
      query = applyStoreScope(query, normalizedStoreId);
      const { data, error } = await query;
      fail(error, 'reserveOrderResources:product');
      if (!data) throw new Error('สินค้าไม่พร้อมขายในร้านนี้');
      const nextStock = Number(data.stock || 0) - qty;
      if (nextStock < 0) throw new Error('สินค้าไม่พอในสต็อก');
      let updateQuery = supabase.from('products').update({ stock: nextStock }).eq('id', id);
      updateQuery = applyStoreScope(updateQuery, normalizedStoreId);
      const { error: updateError } = await updateQuery;
      fail(updateError, 'reserveOrderResources:updateProduct');
    }
    const normalizedCoupon = String(coupon || '').trim().toUpperCase();
    if (normalizedCoupon) await incCouponUse(normalizedCoupon, { storeId: normalizedStoreId });
    return;
  }
  const { error } = await supabase.rpc('reserve_order_resources', {
    p_items: items,
    p_coupon: String(coupon || '').trim().toUpperCase(),
  });
  fail(error, 'reserveOrderResources');
}

export async function releaseOrderResources({ items = [], coupon = '', storeId = '' } = {}) {
  const normalizedStoreId = String(storeId || '').trim();
  if (normalizedStoreId) {
    for (const item of Array.isArray(items) ? items : []) {
      const id = String(item?.id || '').trim();
      const qty = Math.max(0, parseInt(item?.qty, 10) || 0);
      if (!id || !qty) continue;
      let query = supabase.from('products').select('id,stock').eq('id', id).maybeSingle();
      query = applyStoreScope(query, normalizedStoreId);
      const { data, error } = await query;
      fail(error, 'releaseOrderResources:product');
      if (!data) continue;
      let updateQuery = supabase.from('products').update({ stock: Number(data.stock || 0) + qty }).eq('id', id);
      updateQuery = applyStoreScope(updateQuery, normalizedStoreId);
      const { error: updateError } = await updateQuery;
      fail(updateError, 'releaseOrderResources:updateProduct');
    }
    const normalizedCoupon = String(coupon || '').trim().toUpperCase();
    if (normalizedCoupon) {
      const cur = await getCoupon(normalizedCoupon, { storeId: normalizedStoreId });
      if (cur) {
        let couponQuery = supabase.from('coupons').update({ used: Math.max(0, Number(cur.used || 0) - 1) }).eq('code', normalizedCoupon);
        couponQuery = applyStoreScope(couponQuery, normalizedStoreId);
        const { error: couponError } = await couponQuery;
        fail(couponError, 'releaseOrderResources:coupon');
      }
    }
    return;
  }
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

export async function saveMessage(sessionId, sender, text, at = Date.now(), options = {}) {
  const { error } = await supabase.from('messages').insert({ store_id: normalizeStoreId(options.storeId), session_id: sessionId, sender, text, at });
  fail(error, 'saveMessage');
}
export async function listMessagesSince(sessionId, after = 0, options = {}) {
  let query = supabase.from('messages')
    .select('sender, text, at').eq('session_id', String(sessionId || ''))
    .gt('at', Number(after) || 0).order('at', { ascending: true }).limit(100);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listMessagesSince');
  return data || [];
}
export async function listChatSessions({ search = '', limit = 20, offset = 0, storeId = '' } = {}) {
  const normalizedSearch = normalizeSearchTerm(search);
  const normalizedStoreId = String(storeId || '').trim();
  const rows = await selectAllPages((from, to) => {
    let query = supabase.from('messages').select('session_id, sender, text, at').order('at', { ascending: false });
    query = applyStoreScope(query, normalizedStoreId);
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
export async function listChatMessages(sessionId, limit = 200, options = {}) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return [];
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 200));
  let query = supabase.from('messages')
    .select('id, session_id, sender, text, at')
    .eq('session_id', normalizedSessionId)
    .order('at', { ascending: true })
    .limit(safeLimit);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listChatMessages');
  return data || [];
}
export async function deleteChatSession(sessionId, options = {}) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return false;
  let query = supabase.from('messages').delete().eq('session_id', normalizedSessionId);
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  fail(error, 'deleteChatSession');
  return true;
}
export async function findLatestOrderBySessionId(sessionId, options = {}) {
  const normalizedSessionId = normalizeChatSessionId(sessionId);
  if (!normalizedSessionId) return null;
  let query = supabase.from('orders')
    .select('id,total,payment_method,status,paid,payment_claimed,tracking,customer,items,created_at,user_id,channel,line_user_id,session_id')
    .eq('session_id', normalizedSessionId)
    .order('created_at', { ascending: false })
    .limit(1);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'findLatestOrderBySessionId');
  return rowToOrder(data);
}

export async function createUser(u) {
  const row = { username: '', avatar: '', bio: '', line_id: '', phone: '', location: '', ...u, email: String(u.email).toLowerCase(), created_at: Date.now() };
  const { data, error } = await supabase.from('users').insert(row).select('*').single();
  if (isMissingColumn(error)) {
    const { username, avatar, bio, line_id, phone, location, ...legacyRow } = row;
    const fallback = await supabase.from('users').insert(legacyRow).select('*').single();
    fail(fallback.error, 'createUser');
    return {
      username: fallback.data?.name || '',
      avatar: '',
      bio: '',
      line_id: '',
      phone: '',
      location: '',
      ...(fallback.data || {}),
    };
  }
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
  const { data, error } = await supabase.from('users').select('id,email,name,username,avatar,bio,line_id,phone,location,role,created_at').order('created_at', { ascending: false });
  if (isMissingColumn(error)) {
    const fallback = await supabase.from('users').select('id,email,name,role,created_at').order('created_at', { ascending: false });
    fail(fallback.error, 'listUsers');
    return (fallback.data || []).map((user) => ({
      username: user.name || '',
      avatar: '',
      bio: '',
      line_id: '',
      phone: '',
      location: '',
      ...user,
    }));
  }
  fail(error, 'listUsers');
  return data || [];
}
export async function listAdminUsers(limit = 500, offset = 0, filters = {}) {
  const safeLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 500));
  const safeOffset = Math.max(0, parseInt(offset, 10) || 0);
  let query = supabase.from('users').select('id,email,name,username,avatar,bio,line_id,phone,location,role,created_at').order('created_at', { ascending: false }).range(safeOffset, safeOffset + safeLimit - 1);
  query = applyAdminUserFilters(query, filters);
  const { data, error } = await query;
  if (isMissingColumn(error)) {
    let fallbackQuery = supabase.from('users').select('id,email,name,role,created_at').order('created_at', { ascending: false }).range(safeOffset, safeOffset + safeLimit - 1);
    fallbackQuery = applyAdminUserFilters(fallbackQuery, filters);
    const fallback = await fallbackQuery;
    fail(fallback.error, 'listAdminUsers');
    return (fallback.data || []).map((user) => ({
      username: user.name || '',
      avatar: '',
      bio: '',
      line_id: '',
      phone: '',
      location: '',
      ...user,
    }));
  }
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
  const payload = {
    name: patch.name ?? cur.name,
    username: patch.username ?? cur.username ?? '',
    avatar: patch.avatar ?? cur.avatar ?? '',
    bio: patch.bio ?? cur.bio ?? '',
    line_id: patch.line_id ?? cur.line_id ?? '',
    phone: patch.phone ?? cur.phone ?? '',
    location: patch.location ?? cur.location ?? '',
    role: patch.role ?? cur.role,
  };
  const { data, error } = await supabase.from('users').update(payload).eq('id', id).select('*').single();
  if (isMissingColumn(error)) {
    const { username, avatar, bio, line_id, phone, location, ...legacyPayload } = payload;
    const fallback = await supabase.from('users').update(legacyPayload).eq('id', id).select('*').single();
    fail(fallback.error, 'updateUser');
    return {
      username: fallback.data?.name || '',
      avatar: '',
      bio: '',
      line_id: '',
      phone: '',
      location: '',
      ...(fallback.data || {}),
    };
  }
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

export async function listCoupons(options = {}) {
  let query = supabase.from('coupons').select('*').order('created_at', { ascending: false });
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listCoupons');
  return (data || []).map(rowToCoupon);
}

export async function getCoupon(code, options = {}) {
  let query = supabase.from('coupons').select('*').eq('code', String(code).toUpperCase());
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'getCoupon');
  return rowToCoupon(data);
}

export async function createCoupon(c) {
  const row = {
    code: String(c.code).toUpperCase(),
    store_id: normalizeStoreId(c.storeId),
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
  const cur = await getCoupon(code, { storeId: c?.storeId });
  if (!cur) return null;
  const { data, error } = await supabase.from('coupons').update({
    type: c.type ?? cur.type,
    value: c.value !== undefined ? parseInt(c.value, 10) || 0 : cur.value,
    min_total: c.minTotal !== undefined ? parseInt(c.minTotal, 10) || 0 : cur.minTotal,
    max_uses: c.maxUses !== undefined ? parseInt(c.maxUses, 10) || 0 : cur.maxUses,
    active: c.active ?? cur.active,
    expires_at: c.expiresAt !== undefined ? parseInt(c.expiresAt, 10) || 0 : cur.expiresAt,
  }).eq('code', String(code).toUpperCase()).eq('store_id', normalizeStoreId(c?.storeId || cur.storeId)).select('*').single();
  fail(error, 'updateCoupon');
  return rowToCoupon(data);
}

export async function deleteCoupon(code, options = {}) {
  let query = supabase.from('coupons').delete().eq('code', String(code).toUpperCase());
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  fail(error, 'deleteCoupon');
}

export async function incCouponUse(code, options = {}) {
  const normalizedCode = String(code || '').toUpperCase();
  if (!normalizedCode) return;
  if (String(options.storeId || '').trim()) {
    const cur = await getCoupon(normalizedCode, options);
    if (!cur) return;
    let fallbackQuery = supabase.from('coupons').update({ used: (cur.used || 0) + 1 }).eq('code', normalizedCode);
    fallbackQuery = applyStoreScope(fallbackQuery, options.storeId || cur.storeId);
    const { error: fallbackError } = await fallbackQuery;
    fail(fallbackError, 'incCouponUse');
    return;
  }
  const { error } = await supabase.rpc('increment_coupon_use', { p_code: normalizedCode });
  if (error && !isMissingRpc(error)) fail(error, 'incCouponUse');
  if (!error) return;
  const cur = await getCoupon(normalizedCode, options);
  if (!cur) return;
  let fallbackQuery = supabase.from('coupons').update({ used: (cur.used || 0) + 1 }).eq('code', normalizedCode);
  fallbackQuery = applyStoreScope(fallbackQuery, options.storeId || cur.storeId);
  const { error: fallbackError } = await fallbackQuery;
  fail(fallbackError, 'incCouponUse');
}

export async function createLead(lead) {
  const now = Date.now();
  const row = {
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
  const { data, error } = await supabase.from('leads').insert(row).select('*').single();
  fail(error, 'createLead');
  return rowToLead(data);
}

export async function getLead(id, options = {}) {
  let query = supabase.from('leads').select('*').eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'getLead');
  return rowToLead(data);
}

export async function listLeads(limit = 200, options = {}) {
  let query = supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(limit);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
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
  query = applyStoreScope(query, filters.storeId);
  query = applyAdminLeadFilters(query, filters);
  const { data, error } = await query;
  fail(error, 'listAdminLeads');
  return (data || []).map(rowToLead);
}
export async function countLeads({ search = '', status = '', storeId = '' } = {}) {
  let query = supabase.from('leads').select('id', { count: 'exact', head: true });
  query = applyStoreScope(query, storeId);
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
  const cur = await getLead(id, { storeId: patch?.storeId });
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
  }).eq('id', id).eq('store_id', normalizeStoreId(patch?.storeId || cur.storeId)).select('*').single();
  fail(error, 'updateLead');
  return rowToLead(data);
}

export async function getProduct(id, options = {}) {
  let query = supabase.from('products').select('*').eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'getProduct');
  return rowToProduct(data);
}
export async function listProductsByIds(ids = [], includeInactive = false, options = {}) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) return [];
  let q = supabase.from('products').select('*').in('id', uniqueIds);
  q = applyStoreScope(q, options.storeId);
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  fail(error, 'listProductsByIds');
  return (data || []).map(rowToProduct);
}

export async function listProducts(includeInactive = false, options = {}) {
  let q = supabase.from('products').select('*').order('sort', { ascending: true }).order('created_at', { ascending: true });
  q = applyStoreScope(q, options.storeId);
  if (!includeInactive) q = q.eq('active', true);
  const { data, error } = await q;
  fail(error, 'listProducts');
  return (data || []).map(rowToProduct);
}
export async function countProducts(includeInactive = false, options = {}) {
  let q = supabase.from('products').select('id', { count: 'exact', head: true });
  q = applyStoreScope(q, options.storeId);
  if (!includeInactive) q = q.eq('active', true);
  const { count, error } = await q;
  fail(error, 'countProducts');
  return count || 0;
}

export async function createProduct(p) {
  const row = {
    store_id: normalizeStoreId(p.storeId),
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
  const cur = await getProduct(id, { storeId: p?.storeId });
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
  }).eq('id', id).eq('store_id', normalizeStoreId(p?.storeId || cur.storeId)).select('*').single();
  fail(error, 'updateProduct');
  return rowToProduct(data);
}

export async function deleteProduct(id, options = {}) {
  let query = supabase.from('products').delete().eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  fail(error, 'deleteProduct');
}

export async function adjustStock(id, delta, options = {}) {
  const cur = await getProduct(id, { storeId: options.storeId });
  if (!cur) return;
  const { error } = await supabase.from('products')
    .update({ stock: Math.max(0, (cur.stock || 0) + delta) })
    .eq('id', id)
    .eq('store_id', normalizeStoreId(options.storeId || cur.storeId));
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
export async function getStoreSetting(storeId, key) {
  const { data, error } = await supabase
    .from('store_settings')
    .select('value')
    .eq('store_id', normalizeStoreId(storeId))
    .eq('key', String(key || '').trim())
    .maybeSingle();
  fail(error, 'getStoreSetting');
  return data?.value;
}
export async function setStoreSetting(storeId, key, value) {
  const { error } = await supabase.from('store_settings').upsert({
    store_id: normalizeStoreId(storeId),
    key: String(key || '').trim(),
    value: value ?? '',
    updated_at: Date.now(),
  }, { onConflict: 'store_id,key' });
  fail(error, 'setStoreSetting');
}
export async function allStoreSettings(storeId) {
  const { data, error } = await supabase
    .from('store_settings')
    .select('key,value')
    .eq('store_id', normalizeStoreId(storeId));
  fail(error, 'allStoreSettings');
  return Object.fromEntries((data || []).map((row) => [row.key, row.value]));
}
export async function getDefaultStore() {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('is_default', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  fail(error, 'getDefaultStore');
  return rowToStore(data);
}
export async function getStore(id) {
  const { data, error } = await supabase.from('stores').select('*').eq('id', normalizeStoreId(id)).maybeSingle();
  fail(error, 'getStore');
  return rowToStore(data);
}
export async function getStoreByHost(host) {
  const normalizedHost = normalizeStoreHost(host);
  if (!normalizedHost) return null;
  const { data: domain, error: domainError } = await supabase
    .from('store_domains')
    .select('store_id')
    .eq('host', normalizedHost)
    .maybeSingle();
  fail(domainError, 'getStoreByHost:domain');
  if (!domain?.store_id) return null;
  return getStore(domain.store_id);
}
export async function listStores() {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });
  fail(error, 'listStores');
  return (data || []).map(rowToStore);
}
export async function isStoreSubdomainAvailable(subdomain) {
  const normalized = String(subdomain || '').trim().toLowerCase();
  if (!normalized) return false;
  const { count, error } = await supabase
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('subdomain', normalized);
  fail(error, 'isStoreSubdomainAvailable');
  return (count || 0) === 0;
}
export async function createStore(store = {}) {
  const now = Date.now();
  const row = {
    id: String(store.id || '').trim(),
    name: String(store.name || '').trim(),
    slug: String(store.slug || '').trim().toLowerCase(),
    subdomain: String(store.subdomain || '').trim().toLowerCase() || null,
    status: String(store.status || 'active').trim() || 'active',
    template_key: String(store.templateKey || 'default').trim() || 'default',
    primary_domain: String(store.primaryDomain || '').trim().toLowerCase(),
    owner_user_id: String(store.ownerUserId || '').trim(),
    is_default: store.isDefault === true,
    metadata: store.metadata || {},
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('stores').insert(row).select('*').single();
  fail(error, 'createStore');
  return rowToStore(data);
}
export async function addStoreDomain(storeId, host, options = {}) {
  const row = {
    store_id: normalizeStoreId(storeId),
    host: normalizeStoreHost(host),
    is_primary: options.isPrimary === true,
    verified: options.verified === true,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
  const { error } = await supabase.from('store_domains').upsert(row, { onConflict: 'host' });
  fail(error, 'addStoreDomain');
  return row;
}
export async function listStoreDomains(storeId = '') {
  let query = supabase
    .from('store_domains')
    .select('*')
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  const normalizedStoreId = normalizeStoreId(storeId);
  if (normalizedStoreId) query = query.eq('store_id', normalizedStoreId);
  const { data, error } = await query;
  fail(error, 'listStoreDomains');
  return (data || []).map((row) => ({
    id: row.id,
    storeId: row.store_id,
    host: row.host || '',
    isPrimary: bool(row.is_primary),
    verified: bool(row.verified),
    createdAt: row.created_at || 0,
    updatedAt: row.updated_at || 0,
  }));
}
export async function createStoreDatabase(storeId, options = {}) {
  const normalizedStoreId = normalizeStoreId(storeId);
  const now = Date.now();
  const databaseKey = String(options.databaseKey || `db_${normalizedStoreId.replace(/[^a-z0-9_]+/gi, '_').toLowerCase()}`).trim();
  const tenantTables = Array.isArray(options.tenantTables) && options.tenantTables.length
    ? options.tenantTables
    : ['products', 'orders', 'reviews', 'leads', 'payment_logs', 'members', 'messages', 'articles', 'coupons', 'store_settings'];
  const row = {
    store_id: normalizedStoreId,
    database_key: databaseKey,
    provider: String(options.provider || 'supabase').trim() || 'supabase',
    schema_name: String(options.schemaName || 'public').trim() || 'public',
    namespace: String(options.namespace || normalizedStoreId).trim() || normalizedStoreId,
    status: String(options.status || 'ready').trim() || 'ready',
    tenant_tables: tenantTables,
    metadata: {
      isLogicalDatabase: true,
      isolationKey: 'store_id',
      ...(options.metadata || {}),
    },
    created_at: now,
    updated_at: now,
  };
  const { data, error } = await supabase
    .from('store_databases')
    .upsert(row, { onConflict: 'store_id' })
    .select('*')
    .single();
  fail(error, 'createStoreDatabase');
  return rowToStoreDatabase(data);
}
export async function getStoreDatabase(storeId) {
  const { data, error } = await supabase
    .from('store_databases')
    .select('*')
    .eq('store_id', normalizeStoreId(storeId))
    .maybeSingle();
  fail(error, 'getStoreDatabase');
  return rowToStoreDatabase(data);
}
export async function listStoreDatabases(storeId = '') {
  let query = supabase
    .from('store_databases')
    .select('*')
    .order('created_at', { ascending: false });
  const normalizedStoreId = String(storeId || '').trim();
  if (normalizedStoreId) query = query.eq('store_id', normalizeStoreId(normalizedStoreId));
  const { data, error } = await query;
  fail(error, 'listStoreDatabases');
  return (data || []).map(rowToStoreDatabase);
}
export async function addUserStoreRole(userId, storeId, role = 'admin') {
  const { error } = await supabase.from('user_store_roles').upsert({
    user_id: String(userId || '').trim(),
    store_id: normalizeStoreId(storeId),
    role: String(role || 'admin').trim() || 'admin',
    created_at: Date.now(),
  }, { onConflict: 'user_id,store_id' });
  fail(error, 'addUserStoreRole');
}
export async function listUserStoreRoles(userId = '') {
  let query = supabase.from('user_store_roles').select('*').order('created_at', { ascending: false });
  const normalizedUserId = String(userId || '').trim();
  if (normalizedUserId) query = query.eq('user_id', normalizedUserId);
  const { data, error } = await query;
  fail(error, 'listUserStoreRoles');
  return (data || []).map((row) => ({
    userId: row.user_id,
    storeId: row.store_id,
    role: row.role || 'admin',
    createdAt: row.created_at || 0,
  }));
}
// ลบร้านย่อยพร้อมข้อมูล tenant ทั้งหมด — ห้ามใช้กับร้าน default (มี guard ซ้ำที่ endpoint)
const STORE_CASCADE_TABLES = [
  'products', 'orders', 'reviews', 'leads', 'payment_logs', 'messages', 'articles', 'coupons',
  'community_posts', 'community_comments', 'community_reactions', 'community_saves', 'community_stories',
  'chat_session_meta', 'store_settings', 'store_domains', 'store_databases', 'user_store_roles',
];
export async function deleteStoreCascade(storeId) {
  const id = normalizeStoreId(storeId);
  if (!id || id === 'store_main') throw new Error('ลบร้านหลักไม่ได้');
  const cleared = [];
  const skipped = [];
  for (const table of STORE_CASCADE_TABLES) {
    const { error } = await supabase.from(table).delete().eq('store_id', id);
    if (error) skipped.push({ table, message: error.message });
    else cleared.push(table);
  }
  const { error } = await supabase.from('stores').delete().eq('id', id).eq('is_default', false);
  fail(error, 'deleteStoreCascade:stores');
  return { storeId: id, cleared, skipped };
}

export async function addReview(productId, userId, name, rating, comment, options = {}) {
  const { error } = await supabase.from('reviews').insert({
    store_id: normalizeStoreId(options.storeId),
    product_id: productId,
    user_id: userId,
    name: name || '',
    rating,
    comment: comment || '',
    created_at: Date.now(),
  });
  fail(error, 'addReview');
}

export async function listReviews(productId, options = {}) {
  let query = supabase.from('reviews').select('*').eq('product_id', productId).order('created_at', { ascending: false });
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query;
  fail(error, 'listReviews');
  return (data || []).map((r) => ({ id: r.id, name: r.name, rating: r.rating, comment: r.comment, createdAt: r.created_at, userId: r.user_id }));
}

export async function reviewStats(productId, options = {}) {
  if (String(options.storeId || '').trim()) {
    let scopedQuery = supabase.from('reviews').select('rating').eq('product_id', productId);
    scopedQuery = applyStoreScope(scopedQuery, options.storeId);
    const { data: scopedData, error: scopedError } = await scopedQuery;
    fail(scopedError, 'reviewStats');
    const count = scopedData?.length || 0;
    const avg = count ? Math.round((scopedData.reduce((sum, row) => sum + (row.rating || 0), 0) / count) * 10) / 10 : 0;
    return { count, avg };
  }
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

export async function allReviewStats(options = {}) {
  if (String(options.storeId || '').trim()) {
    let fallbackQuery = supabase.from('reviews').select('product_id,rating,store_id');
    fallbackQuery = applyStoreScope(fallbackQuery, options.storeId);
    const { data: fallbackData, error: fallbackError } = await fallbackQuery;
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
  let fallbackQuery = supabase.from('reviews').select('product_id,rating,store_id');
  const { data: fallbackData, error: fallbackError } = await fallbackQuery;
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
export async function getAdminOrderAnalytics(days = 30, options = {}) {
  const safeDays = Math.min(90, Math.max(7, parseInt(days, 10) || 30));
  const normalizedStoreId = String(options.storeId || '').trim();
  if (normalizedStoreId) {
    const since = Date.now() - safeDays * 86400000;
    let query = supabase.from('orders').select('id,total,payment_method,status,paid,discount,items,created_at').gte('created_at', since);
    query = applyStoreScope(query, normalizedStoreId);
    const { data, error } = await query;
    fail(error, 'getAdminOrderAnalytics');
    const rows = Array.isArray(data) ? data : [];
    const byDate = new Map();
    for (let i = safeDays - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      byDate.set(d, { date: d, revenue: 0, orders: 0 });
    }
    const statusBreakdown = {};
    const payment = { promptpay: 0, card: 0 };
    const topMap = new Map();
    let revenue = 0;
    let paidOrders = 0;
    let discountGiven = 0;
    for (const row of rows) {
      const status = String(row.status || '');
      statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      if (row.payment_method === 'card') payment.card += 1;
      else payment.promptpay += 1;
      if (row.paid || ['paid', 'preparing', 'shipped', 'delivered'].includes(status)) {
        paidOrders += 1;
        revenue += Number(row.total || 0);
        discountGiven += Number(row.discount || 0);
        const date = new Date(Number(row.created_at || Date.now())).toISOString().slice(0, 10);
        const bucket = byDate.get(date) || { date, revenue: 0, orders: 0 };
        bucket.revenue += Number(row.total || 0);
        bucket.orders += 1;
        byDate.set(date, bucket);
      }
      for (const item of Array.isArray(row.items) ? row.items : []) {
        const id = String(item?.id || item?.productId || item?.name || '').trim();
        if (!id) continue;
        const qty = Math.max(0, Number(item?.qty || 0));
        const current = topMap.get(id) || { id, name: String(item?.name || id), qty: 0, revenue: 0 };
        current.qty += qty;
        current.revenue += Number(item?.price || 0) * qty;
        topMap.set(id, current);
      }
    }
    return {
      days: safeDays,
      series: [...byDate.values()],
      totals: { revenue, orders: rows.length, paidOrders, aov: paidOrders ? Math.round(revenue / paidOrders) : 0, discountGiven },
      statusBreakdown,
      payment,
      topProducts: [...topMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8),
    };
  }
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
export async function getAdminDashboardStats(options = {}) {
  const normalizedStoreId = String(options.storeId || '').trim();
  if (normalizedStoreId) {
    const [orders, revenueRows, pending, leads, products, recent] = await Promise.all([
      countOrders({ storeId: normalizedStoreId }),
      listAdminOrderSummaries(500, 0, { storeId: normalizedStoreId, status: 'paid' }),
      countOrders({ status: 'awaiting_payment', storeId: normalizedStoreId }),
      countLeads({ storeId: normalizedStoreId }),
      countProducts(true, { storeId: normalizedStoreId }),
      listAdminOrderSummaries(8, 0, { storeId: normalizedStoreId }),
    ]);
    const revenue = revenueRows.reduce((sum, order) => sum + Number(order.total || 0), 0);
    return { orders, revenue, pending, leads, users: 0, products, recent };
  }
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
export async function userReviewed(productId, userId, options = {}) {
  let query = supabase.from('reviews').select('id').eq('product_id', productId).eq('user_id', userId).limit(1);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'userReviewed');
  return !!data;
}

export async function createArticle(a) {
  const row = {
    store_id: normalizeStoreId(a.storeId),
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

export async function getArticle(id, options = {}) {
  let query = supabase.from('articles').select('*').eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  fail(error, 'getArticle');
  return rowToArticle(data);
}

export async function listArticles(all = false, options = {}) {
  let q = supabase.from('articles').select('*').order('created_at', { ascending: false });
  q = applyStoreScope(q, options.storeId);
  if (!all) q = q.eq('published', true);
  const { data, error } = await q;
  fail(error, 'listArticles');
  return (data || []).map(rowToArticle);
}

export async function updateArticle(id, a) {
  const cur = await getArticle(id, { storeId: a?.storeId });
  if (!cur) return null;
  const { data, error } = await supabase.from('articles').update({
    title: a.title ?? cur.title,
    cover: a.cover ?? cur.cover,
    excerpt: a.excerpt ?? cur.excerpt,
    body: a.body ?? cur.body,
    published: a.published ?? cur.published,
  }).eq('id', id).eq('store_id', normalizeStoreId(a?.storeId || cur.storeId)).select('*').single();
  fail(error, 'updateArticle');
  return rowToArticle(data);
}

export async function deleteArticle(id, options = {}) {
  let query = supabase.from('articles').delete().eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  fail(error, 'deleteArticle');
}

function normalizeCommunityArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function rowToCommunityPost(r, viewerState = {}) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
    id: r.id,
    userId: r.user_id || '',
    authorName: r.author_name || 'สมาชิก',
    authorAvatar: r.author_avatar || '',
    authorRole: r.author_role || 'member',
    caption: r.caption || '',
    media: Array.isArray(r.media) ? r.media : [],
    hashtags: Array.isArray(r.hashtags) ? r.hashtags : [],
    articleId: r.article_id || '',
    productIds: Array.isArray(r.product_ids) ? r.product_ids : [],
    status: r.status || 'pending',
    pinned: bool(r.pinned),
    likes: Number(r.likes || 0),
    comments: Number(r.comments || 0),
    saves: Number(r.saves || 0),
    liked: !!viewerState.liked,
    saved: !!viewerState.saved,
    createdAt: r.created_at || 0,
    updatedAt: r.updated_at || r.created_at || 0,
  };
}

function rowToCommunityComment(r) {
  if (!r) return null;
  return {
    id: r.id,
    postId: r.post_id,
    userId: r.user_id || '',
    authorName: r.author_name || 'สมาชิก',
    text: r.text || '',
    status: r.status || 'approved',
    createdAt: r.created_at || 0,
  };
}

function rowToCommunityStory(r) {
  if (!r) return null;
  return {
    storeId: r.store_id || 'store_main',
    id: r.id,
    postId: r.post_id || '',
    authorName: r.author_name || 'Community',
    title: r.title || '',
    media: r.media || '',
    caption: r.caption || '',
    status: r.status || 'approved',
    createdAt: r.created_at || 0,
    expiresAt: r.expires_at || 0,
  };
}

async function enrichCommunityPosts(rows = [], viewerId = '') {
  const ids = rows.map((row) => row.id).filter(Boolean);
  if (!ids.length) return [];
  const [reactions, comments, saves, viewerReactions, viewerSaves] = await Promise.all([
    supabase.from('community_reactions').select('post_id').in('post_id', ids).eq('type', 'like'),
    supabase.from('community_comments').select('post_id').in('post_id', ids).eq('status', 'approved'),
    supabase.from('community_saves').select('post_id').in('post_id', ids),
    viewerId ? supabase.from('community_reactions').select('post_id').in('post_id', ids).eq('user_id', viewerId).eq('type', 'like') : Promise.resolve({ data: [], error: null }),
    viewerId ? supabase.from('community_saves').select('post_id').in('post_id', ids).eq('user_id', viewerId) : Promise.resolve({ data: [], error: null }),
  ]);
  if ([reactions, comments, saves, viewerReactions, viewerSaves].some((result) => isMissingTable(result.error))) {
    return rows.map((row) => rowToCommunityPost(row));
  }
  fail(reactions.error, 'community reactions');
  fail(comments.error, 'community comments');
  fail(saves.error, 'community saves');
  fail(viewerReactions.error, 'community viewer reactions');
  fail(viewerSaves.error, 'community viewer saves');
  const count = (items = []) => items.reduce((map, item) => {
    map.set(item.post_id, (map.get(item.post_id) || 0) + 1);
    return map;
  }, new Map());
  const likeCounts = count(reactions.data || []);
  const commentCounts = count(comments.data || []);
  const saveCounts = count(saves.data || []);
  const liked = new Set((viewerReactions.data || []).map((item) => item.post_id));
  const saved = new Set((viewerSaves.data || []).map((item) => item.post_id));
  return rows.map((row) => rowToCommunityPost({
    ...row,
    likes: likeCounts.get(row.id) || 0,
    comments: commentCounts.get(row.id) || 0,
    saves: saveCounts.get(row.id) || 0,
  }, { liked: liked.has(row.id), saved: saved.has(row.id) }));
}

export async function createCommunityPost(post = {}) {
  const now = Date.now();
  const row = {
    store_id: normalizeStoreId(post.storeId),
    id: post.id || `cp_${now}_${Math.random().toString(36).slice(2, 8)}`,
    user_id: post.userId || '',
    author_name: post.authorName || 'สมาชิก',
    author_avatar: post.authorAvatar || '',
    author_role: post.authorRole || 'member',
    caption: String(post.caption || '').trim(),
    media: Array.isArray(post.media) ? post.media : [],
    hashtags: normalizeCommunityArray(post.hashtags),
    article_id: post.articleId || post.article_id || '',
    product_ids: normalizeCommunityArray(post.productIds || post.product_ids),
    status: post.status || 'pending',
    pinned: !!post.pinned,
    created_at: post.createdAt || now,
    updated_at: now,
  };
  const { data, error } = await supabase.from('community_posts').insert(row).select('*').single();
  if (failUnlessMissingTable(error, 'createCommunityPost')) return null;
  fail(error, 'createCommunityPost');
  const [mapped] = await enrichCommunityPosts([data], post.userId || '');
  return mapped || rowToCommunityPost(data);
}

export async function getCommunityPost(id, options = {}) {
  let query = supabase.from('community_posts').select('*').eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { data, error } = await query.maybeSingle();
  if (failUnlessMissingTable(error, 'getCommunityPost')) return null;
  fail(error, 'getCommunityPost');
  const [post] = await enrichCommunityPosts(data ? [data] : [], options.viewerId || '');
  return post || null;
}

export async function listCommunityPosts(options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30) || 30));
  let query = supabase.from('community_posts').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  query = applyStoreScope(query, options.storeId);
  if (!options.all) query = query.eq('status', 'approved');
  const { data, error } = await query;
  if (failUnlessMissingTable(error, 'listCommunityPosts')) return [];
  fail(error, 'listCommunityPosts');
  return enrichCommunityPosts(data || [], options.viewerId || '');
}

export async function updateCommunityPostStatus(id, patch = {}) {
  const current = await getCommunityPost(id, { storeId: patch.storeId });
  if (!current) return null;
  let query = supabase.from('community_posts').update({
    status: patch.status || current.status,
    pinned: patch.pinned ?? current.pinned,
    updated_at: Date.now(),
  }).eq('id', id);
  query = applyStoreScope(query, patch.storeId || current.storeId);
  const { data, error } = await query.select('*').single();
  if (failUnlessMissingTable(error, 'updateCommunityPostStatus')) return null;
  fail(error, 'updateCommunityPostStatus');
  const [post] = await enrichCommunityPosts([data], patch.viewerId || '');
  return post || rowToCommunityPost(data);
}

export async function deleteCommunityPost(id, options = {}) {
  let query = supabase.from('community_posts').delete().eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  if (failUnlessMissingTable(error, 'deleteCommunityPost')) return;
  fail(error, 'deleteCommunityPost');
}

export async function createCommunityComment(postId, comment = {}) {
  const post = await getCommunityPost(postId, { storeId: comment.storeId });
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
  const { data, error } = await supabase.from('community_comments').insert(row).select('*').single();
  if (failUnlessMissingTable(error, 'createCommunityComment')) return null;
  fail(error, 'createCommunityComment');
  return rowToCommunityComment(data);
}

export async function listCommunityComments(postId, options = {}) {
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50) || 50));
  const post = await getCommunityPost(postId, { storeId: options.storeId });
  if (!post) return [];
  const { data, error } = await supabase.from('community_comments').select('*').eq('post_id', postId).eq('status', 'approved').order('created_at', { ascending: true }).limit(limit);
  if (failUnlessMissingTable(error, 'listCommunityComments')) return [];
  fail(error, 'listCommunityComments');
  return (data || []).map(rowToCommunityComment);
}

export async function setCommunityReaction(postId, userId, type = 'like', active = true, options = {}) {
  const post = await getCommunityPost(postId, { storeId: options.storeId, viewerId: userId });
  if (!post) return null;
  if (active) {
    const { error } = await supabase.from('community_reactions').upsert({ post_id: postId, user_id: userId, type, created_at: Date.now() }, { onConflict: 'post_id,user_id,type' });
    if (failUnlessMissingTable(error, 'setCommunityReaction')) return post;
    fail(error, 'setCommunityReaction');
  } else {
    const { error } = await supabase.from('community_reactions').delete().eq('post_id', postId).eq('user_id', userId).eq('type', type);
    if (failUnlessMissingTable(error, 'setCommunityReaction')) return post;
    fail(error, 'setCommunityReaction');
  }
  return getCommunityPost(postId, { storeId: options.storeId, viewerId: userId });
}

export async function setCommunitySave(postId, userId, active = true, options = {}) {
  const post = await getCommunityPost(postId, { storeId: options.storeId, viewerId: userId });
  if (!post) return null;
  if (active) {
    const { error } = await supabase.from('community_saves').upsert({ post_id: postId, user_id: userId, created_at: Date.now() }, { onConflict: 'post_id,user_id' });
    if (failUnlessMissingTable(error, 'setCommunitySave')) return post;
    fail(error, 'setCommunitySave');
  } else {
    const { error } = await supabase.from('community_saves').delete().eq('post_id', postId).eq('user_id', userId);
    if (failUnlessMissingTable(error, 'setCommunitySave')) return post;
    fail(error, 'setCommunitySave');
  }
  return getCommunityPost(postId, { storeId: options.storeId, viewerId: userId });
}

export async function createCommunityStory(story = {}) {
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
  const { data, error } = await supabase.from('community_stories').insert(row).select('*').single();
  if (failUnlessMissingTable(error, 'createCommunityStory')) return null;
  fail(error, 'createCommunityStory');
  return rowToCommunityStory(data);
}

export async function listCommunityStories(options = {}) {
  const limit = Math.min(100, Math.max(1, Number(options.limit || 30) || 30));
  let query = supabase.from('community_stories').select('*').order('created_at', { ascending: false }).limit(limit);
  query = applyStoreScope(query, options.storeId);
  if (!options.all) query = query.eq('status', 'approved').gt('expires_at', Date.now());
  const { data, error } = await query;
  if (failUnlessMissingTable(error, 'listCommunityStories')) return [];
  fail(error, 'listCommunityStories');
  return (data || []).map(rowToCommunityStory);
}

export async function deleteCommunityStory(id, options = {}) {
  let query = supabase.from('community_stories').delete().eq('id', id);
  query = applyStoreScope(query, options.storeId);
  const { error } = await query;
  if (failUnlessMissingTable(error, 'deleteCommunityStory')) return;
  fail(error, 'deleteCommunityStory');
}

function articleToCommunityPost(article = {}) {
  return {
    storeId: article.storeId,
    id: `post_${article.id}`,
    userId: 'system',
    authorName: 'ทีมจูนุชฟอร์ไลฟ์',
    authorRole: 'admin',
    caption: [article.title, article.excerpt].filter(Boolean).join('\n\n'),
    media: article.cover ? [{ type: 'image', url: article.cover }] : [],
    hashtags: ['ความรู้', 'ประสบการณ์'],
    articleId: article.id,
    status: 'approved',
    pinned: false,
    createdAt: article.createdAt || Date.now(),
  };
}

export async function seedCommunityFromArticles(options = {}) {
  const articles = await listArticles(Boolean(options.all), options);
  const existingPosts = await listCommunityPosts({ ...options, all: true, limit: 100 });
  const existingPostIds = new Set(existingPosts.map((post) => post.id));
  const existingStories = await listCommunityStories({ ...options, all: true, limit: 100 });
  const existingStoryIds = new Set(existingStories.map((story) => story.id));
  let posts = 0;
  let stories = 0;
  for (const article of articles) {
    if (!article?.id) continue;
    const postId = `post_${article.id}`;
    if (!existingPostIds.has(postId)) {
      await createCommunityPost(articleToCommunityPost(article));
      posts += 1;
    }
    const storyId = `story_${article.id}`;
    if (!existingStoryIds.has(storyId) && article.cover) {
      await createCommunityStory({
        storeId: article.storeId,
        id: storyId,
        postId,
        authorName: 'ทีมจูนุชฟอร์ไลฟ์',
        title: article.title,
        media: article.cover,
        caption: article.excerpt || article.title,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      stories += 1;
    }
  }
  return { posts, stories, totalArticles: articles.length };
}

export default supabase;
