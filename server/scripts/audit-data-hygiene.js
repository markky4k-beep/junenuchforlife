import '../env.js';
import { listOrders, listProducts, listReviews } from '../db.js';

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

function normalizeText(value = '') {
  return String(value || '').trim();
}
function normalizeCategory(value = '') {
  const text = normalizeText(value);
  return CATEGORY_ALIAS_MAP[text] || text;
}
function isPlaceholderText(value = '') {
  return /^\?+$/.test(normalizeText(value));
}
function parsePositiveInt(value) {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function main() {
  const orders = await listOrders(5000);
  const products = await listProducts(true);
  const reviewLists = await Promise.all(products.map(async (product) => ({
    id: product.id,
    reviews: await listReviews(product.id),
  })));
  const reviews = reviewLists.flatMap((entry) => entry.reviews.map((review) => ({ ...review, productId: entry.id })));

  const audit = {
    orders: [],
    reviews: [],
    products: [],
  };

  for (const order of orders) {
    const issues = [];
    const subtotal = Number(order.subtotal || 0);
    const discount = Number(order.discount || 0);
    const shipping = Number(order.shipping || 0);
    const total = Number(order.total || 0);
    const computed = subtotal - discount + shipping;
    if (computed !== total) issues.push(`total_mismatch:${subtotal}-${discount}+${shipping}!=${total}`);
    if (!['awaiting_payment', 'paid', 'preparing', 'shipped', 'delivered', 'cancelled', 'expired'].includes(String(order.status || ''))) issues.push(`invalid_status:${order.status}`);
    if (!['web', 'line'].includes(String(order.channel || 'web'))) issues.push(`invalid_channel:${order.channel}`);
    if (order.channel === 'line' && !normalizeText(order.line_user_id)) issues.push('line_channel_missing_line_user_id');
    if (order.payment_claimed && order.paid && order.status === 'awaiting_payment') issues.push('paid_but_awaiting_payment');
    if (!Array.isArray(order.items) || !order.items.length) issues.push('missing_items');
    if (!normalizeText(order.customer?.name)) issues.push('missing_customer_name');
    if (!normalizeText(order.customer?.phone)) issues.push('missing_customer_phone');
    if (isPlaceholderText(order.customer?.name)) issues.push(`placeholder_customer_name:${order.customer?.name}`);
    if (issues.length) audit.orders.push({ id: order.id, issues });
  }

  const seenReviews = new Set();
  for (const review of reviews) {
    const issues = [];
    if (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5) issues.push(`invalid_rating:${review.rating}`);
    const key = `${review.productId}::${normalizeText(review.userId)}`;
    if (normalizeText(review.userId)) {
      if (seenReviews.has(key)) issues.push('duplicate_product_user_review');
      seenReviews.add(key);
    } else {
      issues.push('missing_user_id');
    }
    if (!normalizeText(review.name)) issues.push('missing_name');
    if (isPlaceholderText(review.name)) issues.push(`placeholder_name:${review.name}`);
    if (issues.length) audit.reviews.push({ id: review.id, productId: review.productId, issues });
  }

  for (const product of products) {
    const issues = [];
    const category = normalizeCategory(product.extra?.category || product.category || product.tag || '');
    const tag = normalizeText(product.tag);
    const salePrice = parsePositiveInt(product.extra?.salePrice);
    const comparePrice = parsePositiveInt(product.extra?.comparePrice);
    const price = parsePositiveInt(product.price);
    const model = normalizeText(product.model);
    const name = normalizeText(product.name);
    const altPrice = Math.max(salePrice, comparePrice);
    if (!category) issues.push('missing_category');
    if (!name) issues.push('missing_name');
    if (tag && STRUCTURAL_TAGS.has(tag) && normalizeCategory(tag) !== category) issues.push(`structural_tag_mismatch:${tag}->${category}`);
    if (salePrice > 0 && salePrice === price) issues.push('sale_price_same_as_price');
    if (altPrice > 0 && altPrice < price) issues.push(`discount_pair_reversed:${price}/${altPrice}`);
    if (salePrice > 0 && comparePrice > 0) issues.push('both_sale_and_compare_price_present');
    if (salePrice > 0 && (salePrice < 0 || price < 0)) issues.push('negative_price');
    if (model && !/\.(glb|gltf)$/i.test(model)) issues.push(`invalid_model:${model}`);
    if (product.sort < 0) issues.push(`negative_sort:${product.sort}`);
    if (issues.length) audit.products.push({ id: product.id, name: product.name, tag, category, price, salePrice, comparePrice, sort: product.sort, issues });
  }

  console.log(JSON.stringify(audit, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
