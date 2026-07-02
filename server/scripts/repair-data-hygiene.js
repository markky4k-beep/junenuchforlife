import '../env.js';
import { activeProvider, listOrders, listProducts, updateProduct } from '../db.js';
import { createSupabaseAdminClient } from '../supabase-client.js';

const STRUCTURAL_TAGS = new Set(['เกษตร', 'สินค้าเดี่ยว', 'ชุดแพ็ก', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม']);
const CATEGORY_ALIAS_MAP = {
  เกษตร: 'สินค้าเดี่ยว',
  สินค้าเดี่ยว: 'สินค้าเดี่ยว',
  แพ็กคู่: 'ชุดเซต',
  แพ็กโปร: 'ชุดเซต',
  แพ็กสุดคุ้ม: 'ชุดเซต',
  ชุดแพ็ก: 'ชุดเซต',
  ชุดเซต: 'ชุดเซต',
  โปรแรง: 'โปรโมชั่น',
  โปรโมชัน: 'โปรโมชั่น',
  โปรโมชั่น: 'โปรโมชั่น',
  สุขภาพ: 'สุขภาพ',
  ความงาม: 'ความงาม',
};
const PRODUCT_NAME_OVERRIDES = {
  'nfl-pack-1-2-8-9': 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9',
};
const supabase = activeProvider === 'supabase' ? createSupabaseAdminClient() : null;

function normalizeText(value = '') {
  return String(value || '').trim();
}
function isPlaceholderText(value = '') {
  return /^\?+$/.test(normalizeText(value));
}
function normalizeCategory(value = '') {
  const text = normalizeText(value);
  return CATEGORY_ALIAS_MAP[text] || text;
}
function normalizeTag(value = '') {
  const text = normalizeText(value);
  return text && !STRUCTURAL_TAGS.has(text) ? text : '';
}
function normalizePrice(value) {
  const amount = parseInt(value, 10) || 0;
  return amount > 0 ? amount : 0;
}
function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}
function stableJson(value) {
  return JSON.stringify(stableValue(value));
}
function resolvePricePair(product = {}) {
  const base = normalizePrice(product.price);
  const candidates = [product?.salePrice, product?.comparePrice, product?.extra?.salePrice, product?.extra?.comparePrice]
    .map(normalizePrice)
    .filter(Boolean);
  const rawAlt = candidates.find((value) => value !== base) || candidates[0] || 0;
  if (!base && !rawAlt) return { current: 0, compare: 0 };
  if (!rawAlt || rawAlt === base) return { current: base || rawAlt, compare: 0 };
  return { current: Math.min(base, rawAlt), compare: Math.max(base, rawAlt) };
}
function normalizeModel(value = '') {
  const text = normalizeText(value);
  return text && /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}
function normalizeCustomer(customer = {}) {
  const next = (customer && typeof customer === 'object' && !Array.isArray(customer)) ? { ...customer } : {};
  const name = normalizeText(next.name);
  next.name = !name || isPlaceholderText(name) ? 'ลูกค้า' : name;
  if (next.phone !== undefined) next.phone = normalizeText(next.phone);
  return next;
}

async function main() {
  const repairs = {
    orders: [],
    reviews: [],
    products: [],
  };
  if (supabase) {
    const orders = await listOrders(5000);
    for (const order of orders) {
      const nextCustomer = normalizeCustomer(order.customer);
      const before = stableJson(order.customer || {});
      const after = stableJson(nextCustomer);
      if (before !== after) {
        const { error } = await supabase.from('orders').update({ customer: nextCustomer }).eq('id', order.id);
        if (error) throw new Error(`repair orders ${order.id}: ${error.message}`);
        repairs.orders.push({ id: order.id, customerName: nextCustomer.name, customerPhone: nextCustomer.phone || '' });
      }
    }
    const { data: reviews, error: reviewsError } = await supabase.from('reviews').select('id,name,user_id');
    if (reviewsError) throw new Error(`load reviews: ${reviewsError.message}`);
    for (const review of reviews || []) {
      const nextName = !normalizeText(review.name) || isPlaceholderText(review.name) ? 'ลูกค้า' : normalizeText(review.name);
      const nextUserId = normalizeText(review.user_id) || `guest:${review.id}`;
      if (nextName !== normalizeText(review.name) || nextUserId !== normalizeText(review.user_id)) {
        const { error } = await supabase.from('reviews').update({ name: nextName, user_id: nextUserId }).eq('id', review.id);
        if (error) throw new Error(`repair reviews ${review.id}: ${error.message}`);
        repairs.reviews.push({ id: review.id, name: nextName, userId: nextUserId });
      }
    }
  }
  const products = await listProducts(true);
  for (const product of products) {
    const pair = resolvePricePair(product);
    const nextExtra = { ...(product.extra || {}) };
    const nextCategory = normalizeCategory(nextExtra.category || product.category || product.tag || (product.segment === 'lifestyle' ? 'สุขภาพ' : 'สินค้าเดี่ยว'));
    nextExtra.category = nextCategory;
    delete nextExtra.salePrice;
    delete nextExtra.comparePrice;
    if (pair.compare > pair.current) nextExtra.comparePrice = pair.compare;
    const nextName = normalizeText(product.name) || PRODUCT_NAME_OVERRIDES[product.id] || product.name || '';
    const patch = {
      name: nextName,
      tag: normalizeTag(product.tag),
      price: pair.current || normalizePrice(product.price),
      extra: nextExtra,
      model: normalizeModel(product.model),
      sort: Math.max(0, parseInt(product.sort, 10) || 0),
    };
    const before = stableJson({
      name: product.name || '',
      tag: product.tag || '',
      price: normalizePrice(product.price),
      extra: product.extra || {},
      model: product.model || '',
      sort: Math.max(0, parseInt(product.sort, 10) || 0),
    });
    const after = stableJson(patch);
    if (before !== after) {
      await updateProduct(product.id, patch);
      repairs.products.push({ id: product.id, name: nextName, price: patch.price, comparePrice: patch.extra.comparePrice || 0, tag: patch.tag, category: patch.extra.category });
    }
  }
  console.log(JSON.stringify({
    repaired: repairs.orders.length + repairs.reviews.length + repairs.products.length,
    ...repairs,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
