// ── Customer Data Platform (ระดับเริ่มต้น) ──
// รวมตัวตนลูกค้าจาก orders / leads / users / chat meta เป็นโปรไฟล์กลางเดียว
// แล้วคำนวณ segment + คิว "ลูกค้าที่ควรติดตามวันนี้" — pure functions ไม่แตะ DB เอง

const DAY_MS = 24 * 60 * 60 * 1000;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}
function sanitizeActivityAttachments(items = []) {
  return asArray(items)
    .map((item) => ({
      name: String(item?.name || '').trim().slice(0, 120),
      type: String(item?.type || '').trim().slice(0, 120),
      url: String(item?.url || '').trim(),
    }))
    .filter((item) => item.url);
}
function inferSupportType(entry = {}) {
  const direct = String(entry?.supportType || '').trim();
  if (direct === 'return' || direct === 'refund') return direct;
  const type = String(entry?.type || '').trim();
  if (type.startsWith('refund_')) return 'refund';
  if (type.startsWith('return_')) return 'return';
  return '';
}

function uniqueTrimmed(values = []) {
  return [...new Set(asArray(values).map((item) => String(item || '').trim()).filter(Boolean))];
}

function pushActivity(profile, item = {}) {
  if (!item || typeof item !== 'object') return;
  const at = Number(item.at || 0);
  if (!at) return;
  profile.activity.push({
    type: String(item.type || 'activity').trim(),
    title: String(item.title || '').trim(),
    detail: String(item.detail || '').trim(),
    at,
    href: String(item.href || '').trim(),
    status: String(item.status || '').trim(),
    actor: String(item.actor || '').trim(),
    orderId: String(item.orderId || '').trim(),
    supportType: String(item.supportType || '').trim(),
    attachments: sanitizeActivityAttachments(item.attachments),
  });
}

function sortedTopEntries(map = {}, limit = 5) {
  return Object.entries(map || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, score]) => ({ name, score }));
}

function productCategoryValue(product = {}) {
  return String(product?.extra?.category || product?.category || product?.tag || '').trim();
}

function productCropTargets(product = {}) {
  return uniqueTrimmed(product?.extra?.cropTargets);
}

function productKeywordBag(product = {}) {
  return uniqueTrimmed([
    product?.name,
    product?.short,
    product?.tag,
    productCategoryValue(product),
    ...(productCropTargets(product)),
    ...(asArray(product?.extra?.sellingPoints)),
    ...(asArray(product?.extra?.searchKeywords)),
    product?.extra?.highlight,
    product?.extra?.audienceShort,
    product?.extra?.applicationMethod,
    product?.extra?.dosage,
  ]).join(' ').toLowerCase();
}

export function normalizePhoneKey(value = '') {
  let digits = String(value || '').replace(/\D+/g, '');
  if (digits.startsWith('66') && digits.length >= 11) digits = '0' + digits.slice(2);
  return digits.length >= 9 ? digits : '';
}

function normalizeEmailKey(value = '') {
  const email = String(value || '').trim().toLowerCase();
  return /.+@.+\..+/.test(email) ? email : '';
}

function identityKeysOf({ phone = '', email = '', userId = '', lineUserId = '', sessionId = '' } = {}) {
  const keys = [];
  const p = normalizePhoneKey(phone);
  const e = normalizeEmailKey(email);
  if (p) keys.push(`phone:${p}`);
  if (e) keys.push(`email:${e}`);
  if (String(userId || '').trim()) keys.push(`user:${String(userId).trim()}`);
  if (String(lineUserId || '').trim()) keys.push(`line:${String(lineUserId).trim()}`);
  if (String(sessionId || '').trim()) keys.push(`session:${String(sessionId).trim()}`);
  return keys;
}

function newProfile() {
  return {
    key: '',
    name: '',
    phone: '',
    email: '',
    province: '',
    userId: '',
    lineUserId: '',
    sessionIds: [],
    channels: [],
    ordersCount: 0,
    paidOrdersCount: 0,
    totalSpent: 0,
    pendingOrders: [],
    lastOrderAt: 0,
    lastOrderId: '',
    lastOrderStatus: '',
    lastPaidAt: 0,
    leadId: '',
    leadStatus: '',
    leadCrop: '',
    leadAt: 0,
    lastChatAt: 0,
    chatUnanswered: false,
    topItems: {},
    interestKeywords: {},
    recentOrderIds: [],
    activity: [],
    firstSeenAt: 0,
    lastActiveAt: 0,
    avgOrderValue: 0,
    segment: 'visitor',
  };
}

function touch(profile, at = 0) {
  const ts = Number(at || 0);
  if (!ts) return;
  if (!profile.firstSeenAt || ts < profile.firstSeenAt) profile.firstSeenAt = ts;
  if (ts > profile.lastActiveAt) profile.lastActiveAt = ts;
}

function addChannel(profile, channel = '') {
  const c = String(channel || '').trim();
  if (c && !profile.channels.includes(c)) profile.channels.push(c);
}

export function buildCustomerProfiles({ orders = [], leads = [], users = [], chatMeta = {}, now = Date.now() } = {}) {
  const profiles = [];
  const index = new Map();

  function claim(identity) {
    const keys = identityKeysOf(identity);
    if (!keys.length) return null;
    let profile = null;
    for (const key of keys) {
      if (index.has(key)) { profile = index.get(key); break; }
    }
    if (!profile) {
      profile = newProfile();
      profiles.push(profile);
    }
    for (const key of keys) index.set(key, profile);
    return profile;
  }

  function fill(profile, { name = '', phone = '', email = '', province = '', userId = '', lineUserId = '', sessionId = '' } = {}) {
    if (!profile.name && String(name || '').trim()) profile.name = String(name).trim();
    if (!profile.phone && normalizePhoneKey(phone)) profile.phone = String(phone).trim();
    if (!profile.email && normalizeEmailKey(email)) profile.email = normalizeEmailKey(email);
    if (!profile.province && String(province || '').trim()) profile.province = String(province).trim();
    if (!profile.userId && String(userId || '').trim()) profile.userId = String(userId).trim();
    if (!profile.lineUserId && String(lineUserId || '').trim()) profile.lineUserId = String(lineUserId).trim();
    const sid = String(sessionId || '').trim();
    if (sid && !profile.sessionIds.includes(sid)) profile.sessionIds.push(sid);
  }

  // 1) ออเดอร์ (ข้อมูลแน่นสุด — เริ่มก่อน)
  for (const order of orders) {
    const customer = order?.customer || {};
    const supportOps = order?.customer?._ops || {};
    const supportTimeline = asArray(supportOps.timeline)
      .filter((item) => item && typeof item === 'object' && Number(item.at || 0))
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
      .slice(0, 8);
    const identity = {
      phone: customer.phone,
      email: customer.email,
      userId: order.user_id,
      lineUserId: order.line_user_id,
      sessionId: order.session_id,
    };
    const profile = claim(identity);
    if (!profile) continue;
    fill(profile, { ...identity, name: customer.name });
    addChannel(profile, order.channel === 'line_oa' ? 'LINE OA' : 'เว็บไซต์');
    profile.ordersCount += 1;
    const createdAt = Number(order.createdAt || 0);
    touch(profile, createdAt);
    if (createdAt > profile.lastOrderAt) {
      profile.lastOrderAt = createdAt;
      profile.lastOrderId = order.id;
      profile.lastOrderStatus = order.status;
    }
    if (order.paid) {
      profile.paidOrdersCount += 1;
      profile.totalSpent += Number(order.total || 0);
      if (createdAt > profile.lastPaidAt) profile.lastPaidAt = createdAt;
      if (order.id && !profile.recentOrderIds.includes(order.id)) profile.recentOrderIds.push(order.id);
      pushActivity(profile, {
        type: 'order_paid',
        title: `สั่งซื้อสำเร็จ ${order.id}`,
        detail: `ยอด ${Number(order.total || 0).toLocaleString()} บาท · ${asArray(order.items).slice(0, 2).map((item) => `${item.name}${item.variantLabel ? ` · ${item.variantLabel}` : ''}`).join(', ')}`,
        at: createdAt,
        href: `/admin/order/${order.id}`,
      });
      for (const item of (order.items || [])) {
        const label = String(item?.name || '').trim();
        if (label) profile.topItems[label] = (profile.topItems[label] || 0) + (parseInt(item.qty, 10) || 1);
      }
    } else if (order.status === 'awaiting_payment') {
      profile.pendingOrders.push({ id: order.id, total: Number(order.total || 0), createdAt, claimed: order.payment_claimed === true });
      pushActivity(profile, {
        type: 'pending_payment',
        title: `มีออเดอร์รอชำระ ${order.id}`,
        detail: `ยอด ${Number(order.total || 0).toLocaleString()} บาท`,
        at: createdAt,
        href: `/admin/order/${order.id}`,
      });
    }
    for (const entry of supportTimeline) {
      const supportType = inferSupportType(entry);
      pushActivity(profile, {
        type: supportType ? `support_${supportType}` : String(entry.type || 'support').trim(),
        title: String(entry.title || `อัปเดตออเดอร์ ${order.id}`).trim(),
        detail: [String(entry.detail || '').trim(), order.id ? `ออเดอร์ ${order.id}` : ''].filter(Boolean).join(' · '),
        at: Number(entry.at || 0),
        href: `/admin/order/${order.id}`,
        status: String(entry.status || '').trim(),
        actor: String(entry.actor || '').trim(),
        orderId: order.id,
        supportType,
        attachments: entry.attachments,
      });
    }
  }

  // 2) ลีด
  for (const lead of leads) {
    const identity = { phone: lead.phone, lineUserId: '', sessionId: '' };
    const profile = claim(identity) || claim({ sessionId: `lead:${lead.id}` });
    if (!profile) continue;
    fill(profile, { name: lead.name, phone: lead.phone, province: lead.province });
    addChannel(profile, 'ลีด');
    const at = Number(lead.createdAt || lead.created_at || 0);
    touch(profile, at);
    if (at > profile.leadAt) {
      profile.leadAt = at;
      profile.leadId = lead.id;
      profile.leadStatus = String(lead.status || 'new');
      profile.leadCrop = String(lead.crop || '');
    }
    if (profile.leadCrop) profile.interestKeywords[profile.leadCrop] = (profile.interestKeywords[profile.leadCrop] || 0) + 3;
    if (String(lead.problem || '').trim()) profile.interestKeywords[String(lead.problem || '').trim()] = (profile.interestKeywords[String(lead.problem || '').trim()] || 0) + 2;
    pushActivity(profile, {
      type: 'lead',
      title: `เข้ามาเป็นลีด ${profile.leadStatus || 'new'}`,
      detail: [lead.crop ? `สนใจ ${lead.crop}` : '', lead.province ? `จังหวัด ${lead.province}` : ''].filter(Boolean).join(' · '),
      at,
      href: '/admin/leads',
    });
  }

  // 3) สมาชิกเว็บ
  for (const user of users) {
    if (String(user?.role || '') !== 'user') continue;
    const profile = claim({ email: user.email, userId: user.id, phone: user.phone });
    if (!profile) continue;
    fill(profile, { name: user.name, email: user.email, phone: user.phone, userId: user.id });
    addChannel(profile, 'สมาชิก');
    touch(profile, Number(user.created_at || 0));
  }

  // 4) แชต
  for (const [sessionId, meta] of Object.entries(chatMeta || {})) {
    if (!meta || typeof meta !== 'object') continue;
    const profile = claim({
      phone: meta.customerPhone,
      email: meta.customerEmail,
      lineUserId: meta.lineUserId,
      sessionId,
    });
    if (!profile) continue;
    fill(profile, {
      name: meta.customerName || meta.visitorName,
      phone: meta.customerPhone,
      email: meta.customerEmail,
      lineUserId: meta.lineUserId,
      sessionId,
    });
    addChannel(profile, meta.lineUserId ? 'LINE OA' : 'Live Chat');
    const lastCustomerAt = Number(meta.lastCustomerAt || 0);
    touch(profile, lastCustomerAt || Number(meta.updatedAt || 0));
    if (lastCustomerAt > profile.lastChatAt) profile.lastChatAt = lastCustomerAt;
    if (lastCustomerAt && lastCustomerAt > Number(meta.lastReadAt || 0)) profile.chatUnanswered = true;
    if (lastCustomerAt) {
      pushActivity(profile, {
        type: 'chat',
        title: 'ทักเข้ามาทางแชต',
        detail: meta.lineUserId ? 'ช่องทาง LINE OA' : 'ช่องทาง Live Chat',
        at: lastCustomerAt,
        href: '/admin/inbox',
      });
    }
  }

  // สรุปโปรไฟล์: key หลัก + segment + สินค้าที่สนใจ
  for (const profile of profiles) {
    profile.key = identityKeysOf(profile)[0] || `session:${profile.sessionIds[0] || ''}`;
    profile.topItems = Object.entries(profile.topItems)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label, qty]) => ({ name: label, qty }));
    profile.interestKeywords = sortedTopEntries(profile.interestKeywords, 6);
    profile.activity = profile.activity.sort((a, b) => b.at - a.at).slice(0, 10);
    profile.avgOrderValue = profile.paidOrdersCount ? Math.round(profile.totalSpent / profile.paidOrdersCount) : 0;
    const inactiveDays = profile.lastActiveAt ? Math.floor((now - profile.lastActiveAt) / DAY_MS) : 0;
    if (profile.pendingOrders.length) profile.segment = 'at_risk';
    else if (profile.paidOrdersCount >= 3 || profile.totalSpent >= 3000) profile.segment = 'vip';
    else if (profile.paidOrdersCount >= 2) profile.segment = 'repeat';
    else if (profile.paidOrdersCount === 1) profile.segment = 'new_customer';
    else if (profile.leadId || profile.lastChatAt) profile.segment = 'lead';
    if (profile.paidOrdersCount > 0 && inactiveDays > 45 && profile.segment !== 'at_risk') profile.segment = 'dormant';
    profile.inactiveDays = inactiveDays;
  }

  profiles.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  return profiles;
}

export const CRM_SEGMENT_LABELS = {
  at_risk: 'รอชำระ / เสี่ยงหลุด',
  vip: 'ลูกค้า VIP',
  repeat: 'ซื้อซ้ำ',
  new_customer: 'ลูกค้าใหม่',
  dormant: 'ห่างหาย',
  lead: 'ว่าที่ลูกค้า',
  visitor: 'ผู้เยี่ยมชม',
};

// คิว "ลูกค้าที่ควรติดตามวันนี้" — จัดลำดับตามมูลค่าที่เสี่ยงหลุด + ความสดของสัญญาณ
export function buildFollowUps(profiles = [], { now = Date.now(), limit = 12 } = {}) {
  const items = [];
  const hoursAgo = (ts) => Math.max(0, Math.round((now - ts) / 3600000));
  for (const profile of profiles) {
    const displayName = profile.name || profile.phone || profile.email || 'ลูกค้าไม่ระบุชื่อ';
    for (const order of profile.pendingOrders) {
      const age = hoursAgo(order.createdAt);
      items.push({
        type: 'pending_payment',
        priority: 100 + Math.min(50, order.total / 100) - Math.min(40, age),
        icon: '💸',
        title: `ทวงชำระออเดอร์ ${order.id}`,
        detail: `${displayName} · ฿${Number(order.total || 0).toLocaleString()} · ค้างมา ${age} ชม.${order.claimed ? ' · ลูกค้าแจ้งโอนแล้ว รอตรวจสลิป' : ''}`,
        customerKey: profile.key,
        href: `/admin/order/${order.id}`,
        chatSessionId: profile.sessionIds[0] || '',
      });
    }
    if (profile.chatUnanswered && profile.lastChatAt && (now - profile.lastChatAt) < 3 * DAY_MS) {
      items.push({
        type: 'unanswered_chat',
        priority: 90 - Math.min(30, hoursAgo(profile.lastChatAt)),
        icon: '💬',
        title: `ตอบแชต ${displayName}`,
        detail: `ทักมาเมื่อ ${hoursAgo(profile.lastChatAt)} ชม.ที่แล้ว ยังไม่มีคนตอบ`,
        customerKey: profile.key,
        href: '/admin/inbox',
        chatSessionId: profile.sessionIds[0] || '',
      });
    }
    if (profile.leadId && profile.leadStatus === 'new' && (now - profile.leadAt) > 6 * 3600000) {
      items.push({
        type: 'new_lead',
        priority: 70 - Math.min(30, Math.floor((now - profile.leadAt) / DAY_MS) * 3),
        icon: '🎯',
        title: `โทร/ทักลีดใหม่: ${displayName}`,
        detail: `${profile.leadCrop ? `สนใจเรื่อง${profile.leadCrop} · ` : ''}${profile.phone || '-'} · เข้ามา ${Math.max(1, Math.floor((now - profile.leadAt) / 3600000))} ชม.ที่แล้ว`,
        customerKey: profile.key,
        href: '/admin/leads',
        chatSessionId: '',
      });
    }
    if (['repeat', 'vip'].includes(profile.segment) && profile.lastPaidAt) {
      const days = Math.floor((now - profile.lastPaidAt) / DAY_MS);
      if (days >= 30 && days <= 60) {
        const favorite = profile.topItems[0]?.name || '';
        items.push({
          type: 'reorder_nudge',
          priority: 40 + (profile.segment === 'vip' ? 10 : 0),
          icon: '🔁',
          title: `ชวนซื้อซ้ำ: ${displayName}`,
          detail: `ซื้อล่าสุด ${days} วันก่อน${favorite ? ` (${favorite})` : ''} — ช่วงเวลาดีที่จะทักไปเสนอโปร`,
          customerKey: profile.key,
          href: '/admin/customers',
          chatSessionId: profile.sessionIds[0] || '',
        });
      }
    }
  }
  items.sort((a, b) => b.priority - a.priority);
  return items.slice(0, limit);
}

// แนะนำสินค้า: co-occurrence จากออเดอร์จริง + fallback หมวด/ขายดี
export function buildProductRecommendations({ orders = [], products = [] } = {}) {
  const co = new Map();       // productId -> Map(otherId -> count)
  const soldQty = new Map();  // productId -> qty รวม
  for (const order of orders) {
    if (!order?.paid && order?.status !== 'delivered' && order?.status !== 'shipped' && order?.status !== 'paid' && order?.status !== 'preparing') continue;
    const ids = [...new Set((order.items || []).map((item) => String(item?.id || '').trim()).filter(Boolean))];
    for (const id of ids) {
      soldQty.set(id, (soldQty.get(id) || 0) + 1);
      let bucket = co.get(id);
      if (!bucket) { bucket = new Map(); co.set(id, bucket); }
      for (const other of ids) {
        if (other === id) continue;
        bucket.set(other, (bucket.get(other) || 0) + 1);
      }
    }
  }
  const activeProducts = products.filter((p) => p && p.active !== false);
  const byId = new Map(activeProducts.map((p) => [String(p.id), p]));
  for (const product of activeProducts) {
    const bundleIds = uniqueTrimmed(product?.extra?.bundleIds);
    const upsellIds = uniqueTrimmed(product?.extra?.upsellIds);
    for (const bundleId of bundleIds) {
      let bucket = co.get(String(product.id));
      if (!bucket) { bucket = new Map(); co.set(String(product.id), bucket); }
      bucket.set(bundleId, (bucket.get(bundleId) || 0) + 100);
    }
    for (const upsellId of upsellIds) {
      let bucket = co.get(String(product.id));
      if (!bucket) { bucket = new Map(); co.set(String(product.id), bucket); }
      bucket.set(upsellId, (bucket.get(upsellId) || 0) + 60);
    }
  }
  const bestSellers = [...soldQty.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => byId.get(id))
    .filter(Boolean);

  function recommendFor(productId, count = 4) {
    const product = byId.get(String(productId));
    const picked = [];
    const pickedIds = new Set([String(productId)]);
    const push = (candidate, reason) => {
      if (!candidate || pickedIds.has(String(candidate.id)) || picked.length >= count) return;
      pickedIds.add(String(candidate.id));
      picked.push({ product: candidate, reason });
    };
    // 1) ซื้อคู่กันบ่อยจากออเดอร์จริง
    for (const [otherId] of [...(co.get(String(productId)) || new Map()).entries()].sort((a, b) => b[1] - a[1])) {
      const source = byId.get(String(productId));
      const curatedBundle = uniqueTrimmed(source?.extra?.bundleIds).includes(String(otherId));
      const curatedUpsell = uniqueTrimmed(source?.extra?.upsellIds).includes(String(otherId));
      push(byId.get(otherId), curatedBundle ? 'curated_bundle' : (curatedUpsell ? 'curated_upsell' : 'bought_together'));
    }
    // 2) หมวด/กลุ่มเดียวกัน
    if (product) {
      const category = String(product.extra?.category || product.tag || '').trim();
      for (const candidate of activeProducts) {
        if (category && String(candidate.extra?.category || candidate.tag || '').trim() === category) push(candidate, 'same_category');
      }
      for (const candidate of activeProducts) {
        if (String(candidate.segment || '') === String(product.segment || '')) push(candidate, 'same_segment');
      }
    }
    // 3) ขายดีทั้งร้าน
    for (const candidate of bestSellers) push(candidate, 'best_seller');
    for (const candidate of activeProducts) push(candidate, 'catalog');
    return picked;
  }

  function recommendForMany(productIds = [], count = 4) {
    const scores = new Map();
    const seen = new Set(asArray(productIds).map((id) => String(id || '').trim()).filter(Boolean));
    const add = (candidate, reason = 'catalog', weight = 1) => {
      if (!candidate || seen.has(String(candidate.id || ''))) return;
      const current = scores.get(String(candidate.id)) || { product: candidate, score: 0, reasons: new Set() };
      current.score += weight;
      current.reasons.add(reason);
      scores.set(String(candidate.id), current);
    };
    for (const productId of seen) {
      for (const item of recommendFor(productId, Math.max(6, count + 2))) {
        const weights = {
          curated_bundle: 16,
          curated_upsell: 12,
          bought_together: 10,
          same_category: 5,
          same_segment: 3,
          best_seller: 2,
          catalog: 1,
        };
        add(item.product, item.reason, weights[item.reason] || 1);
      }
    }
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map((entry) => ({
        product: entry.product,
        reason: [...entry.reasons][0] || 'catalog',
        reasons: [...entry.reasons],
      }));
  }

  return { recommendFor, recommendForMany, bestSellers };
}

export function buildCustomerSpotlight(profile = {}, { products = [], recommendationEngine = null, now = Date.now(), limit = 4 } = {}) {
  if (!profile || typeof profile !== 'object') return { nextActions: [], suggestedProducts: [], insight: '' };
  const nextActions = buildFollowUps([profile], { now, limit: 4 });
  const activeProducts = asArray(products).filter((item) => item && item.active !== false);
  const byName = new Map(activeProducts.map((item) => [String(item.name || '').trim().toLowerCase(), item]));
  const picked = new Map();
  const pushProduct = (product, reason = 'catalog', score = 1) => {
    if (!product) return;
    const key = String(product.id || '').trim();
    if (!key) return;
    const current = picked.get(key) || { product, score: 0, reasons: new Set() };
    current.score += score;
    current.reasons.add(reason);
    picked.set(key, current);
  };
  const favoriteIds = asArray(profile.topItems)
    .map((item) => byName.get(String(item?.name || '').trim().toLowerCase()))
    .filter(Boolean)
    .map((item) => item.id);
  if (recommendationEngine?.recommendForMany && favoriteIds.length) {
    for (const entry of recommendationEngine.recommendForMany(favoriteIds, limit + 2)) pushProduct(entry.product, entry.reason, 10);
  }
  for (const favoriteId of favoriteIds) {
    if (recommendationEngine?.recommendFor) {
      for (const entry of recommendationEngine.recommendFor(favoriteId, limit + 2)) pushProduct(entry.product, entry.reason, 8);
    }
  }
  const leadCrop = String(profile.leadCrop || '').trim().toLowerCase();
  for (const product of activeProducts) {
    const bag = productKeywordBag(product);
    if (leadCrop && bag.includes(leadCrop)) pushProduct(product, 'crop_match', 6);
    for (const keyword of asArray(profile.interestKeywords).slice(0, 3)) {
      if (bag.includes(String(keyword.name || '').trim().toLowerCase())) pushProduct(product, 'interest_match', 4);
    }
  }
  for (const product of asArray(recommendationEngine?.bestSellers).slice(0, limit + 2)) pushProduct(product, 'best_seller', 2);
  const suggestedProducts = [...picked.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => ({
      product: entry.product,
      reason: [...entry.reasons][0] || 'catalog',
      reasons: [...entry.reasons],
    }));
  const summaryBits = [
    profile.pendingOrders?.length ? `มีออเดอร์ค้าง ${profile.pendingOrders.length} รายการ` : '',
    profile.chatUnanswered ? 'มีแชตที่ยังไม่ตอบ' : '',
    profile.leadCrop ? `สนใจ ${profile.leadCrop}` : '',
    profile.topItems?.[0]?.name ? `สินค้าที่ชอบคือ ${profile.topItems[0].name}` : '',
    profile.avgOrderValue ? `มูลค่าเฉลี่ยต่อออเดอร์ ${profile.avgOrderValue.toLocaleString()} บาท` : '',
  ].filter(Boolean);
  return {
    nextActions,
    suggestedProducts,
    insight: summaryBits.join(' · '),
    recentActivity: asArray(profile.activity).slice(0, 6),
  };
}
