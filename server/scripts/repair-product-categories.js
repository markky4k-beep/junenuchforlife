import '../env.js';
import { listProducts, updateProduct, getSetting, setSetting } from '../db.js';

function normalizeText(value = '') {
  return String(value || '').trim();
}

const CATEGORY_DEFAULTS = ['สินค้าเดี่ยว', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม'];
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
const STRUCTURAL_TAGS = new Set(['เกษตร', 'สินค้าเดี่ยว', 'ชุดแพ็ก', 'ชุดเซต', 'โปรโมชั่น', 'สุขภาพ', 'ความงาม']);

function normalizeCategory(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  return CATEGORY_ALIAS_MAP[text] || text;
}

function normalizePromoTag(value = '') {
  const text = normalizeText(value);
  if (!text || STRUCTURAL_TAGS.has(text)) return '';
  return text;
}
function normalizeModelUrl(value = '') {
  const text = normalizeText(value);
  if (!text) return '';
  return /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}

function inferCategory(product = {}) {
  const extra = (product.extra && typeof product.extra === 'object' && !Array.isArray(product.extra)) ? product.extra : {};
  const explicit = normalizeCategory(extra.category || product.category);
  if (explicit) return explicit;
  const tag = normalizeCategory(product.tag);
  if (tag) return tag;
  return product.segment === 'lifestyle' ? 'สุขภาพ' : 'สินค้าเดี่ยว';
}

function inferPromoTag(product = {}, category = '') {
  const tag = normalizePromoTag(product.tag);
  if (tag) return tag;
  if (category === 'ชุดเซต' && /แพ็ก/.test(normalizeText(product.name))) return 'แพ็กคู่';
  if (category === 'โปรโมชั่น') return 'โปรแรง';
  return '';
}

async function main() {
  const products = await listProducts(true);
  const repaired = [];
  const categories = [];

  for (const product of products) {
    const category = inferCategory(product);
    if (!category) continue;
    categories.push(category);
    const tag = inferPromoTag(product, category);
    const model = normalizeModelUrl(product.model);

    const extra = (product.extra && typeof product.extra === 'object' && !Array.isArray(product.extra)) ? { ...product.extra } : {};
    const currentCategoryRaw = normalizeText(extra.category || product.category);
    const currentTagRaw = normalizeText(product.tag);
    const currentModelRaw = normalizeText(product.model);
    if (currentCategoryRaw === category && currentTagRaw === tag && currentModelRaw === model) continue;

    extra.category = category;
    await updateProduct(product.id, { extra, tag, model });
    repaired.push({ id: product.id, name: product.name, category, tag, model });
  }

  const existingSetting = normalizeText(await getSetting('SITE_PRODUCT_CATEGORIES'));
  let configured = [];
  if (existingSetting) {
    try { configured = JSON.parse(existingSetting); } catch { configured = existingSetting.split(/\r?\n|,/); }
  }
  const merged = [...new Set([...CATEGORY_DEFAULTS, ...configured.map((item) => normalizeCategory(item)).filter(Boolean), ...categories.map(normalizeCategory).filter(Boolean)])];
  await setSetting('SITE_PRODUCT_CATEGORIES', JSON.stringify(merged));

  console.log(JSON.stringify({
    repairedCount: repaired.length,
    repaired,
    categories: merged,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
