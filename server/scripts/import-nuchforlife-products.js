import '../env.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProduct, getProduct, listProducts, updateProduct } from '../db-supabase.js';
import { uploadPublicAsset } from '../supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');
const assetDir = path.join(projectRoot, 'Nuchforlife', 'NuchforlifeMain');

function mimeFromExt(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function uploadImage(fileName) {
  const filePath = path.join(assetDir, fileName);
  const buffer = await fs.readFile(filePath);
  const extension = path.extname(fileName).replace('.', '') || 'jpg';
  return uploadPublicAsset({
    buffer,
    contentType: mimeFromExt(fileName),
    extension,
    folder: 'products/nuchforlife',
  });
}

async function uploadImages(fileNames = []) {
  const urls = [];
  for (const fileName of fileNames) {
    urls.push(await uploadImage(fileName));
  }
  return urls;
}

function inferCategory(definition = {}) {
  const explicit = String(definition.extra?.category || '').trim();
  if (explicit) return explicit;
  const tag = String(definition.tag || '').trim();
  if (['แพ็กคู่', 'แพ็กโปร', 'แพ็กสุดคุ้ม'].includes(tag)) return 'ชุดเซต';
  if (tag === 'โปรแรง') return 'โปรโมชั่น';
  return 'สินค้าเดี่ยว';
}

function normalizeTag(definition = {}) {
  const tag = String(definition.tag || '').trim();
  return ['แพ็กคู่', 'แพ็กโปร', 'แพ็กสุดคุ้ม', 'โปรแรง'].includes(tag) ? tag : '';
}
function normalizeModelUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}
function deriveComparePrice(sellingPrice, percent = 20) {
  const price = parseInt(sellingPrice, 10) || 0;
  if (price <= 0) return 0;
  const ratio = 1 - (percent / 100);
  if (ratio <= 0) return price;
  return Math.max(price + 1, Math.round(price / ratio));
}

async function upsertProduct(definition) {
  const current = await getProduct(definition.id);
  const image = definition.imageFile ? await uploadImage(definition.imageFile) : (current?.image || '');
  const images = definition.galleryFiles?.length ? await uploadImages(definition.galleryFiles) : (current?.images || []);
  const payload = {
    name: definition.name,
    tag: normalizeTag(definition),
    price: definition.price,
    short: definition.short,
    desc: definition.desc,
    specs: definition.specs || {},
    segment: 'agri',
    extra: { ...(definition.extra || {}), comparePrice: definition.comparePrice || 0 },
    icon: definition.icon || 'pod',
    image,
    images,
    model: normalizeModelUrl(definition.model),
    stock: definition.stock,
    active: definition.active !== false,
    sort: definition.sort,
  };

  if (current) {
    const updated = await updateProduct(definition.id, payload);
    return { action: 'updated', product: updated };
  }
  const created = await createProduct({ id: definition.id, ...payload });
  return { action: 'created', product: created };
}

const products = [
  {
    id: 'p1',
    name: 'นุชฟอร์ไลฟ์ 1',
    tag: '',
    price: 590,
    comparePrice: deriveComparePrice(590),
    short: 'สูตรเดี่ยวเร่งราก แตกยอด และฟื้นต้น ขนาด 500 CC',
    desc: 'นุชฟอร์ไลฟ์ 1 ขนาด 500 CC เหมาะสำหรับช่วงฟื้นต้น เร่งใบ และวางฐานความสมบูรณ์ของพืชก่อนเข้าสู่ระยะสะสมอาหาร',
    specs: { 'ขนาด': '500 CC', 'ประเภท': 'สูตรเดี่ยว', 'ราคาเดิม': `${deriveComparePrice(590)} บาท`, 'ราคาพิเศษ': '590 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 60,
    sort: 50,
    imageFile: 'นุชฟอร์ไลฟ์1 500cc 590.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['เขย่าขวดก่อนใช้', 'ผสมน้ำตามอัตราแนะนำ', 'ฉีดพ่นช่วงเช้าหรือเย็นเพื่อการดูดซึมที่ดี'],
      warnings: ['ควรทดสอบในพื้นที่เล็กก่อนใช้จริง', 'หลีกเลี่ยงแดดจัดขณะพ่น', 'อ่านฉลากก่อนใช้ทุกครั้ง'],
    },
  },
  {
    id: 'p2',
    name: 'นุชฟอร์ไลฟ์ 2',
    tag: '',
    price: 190,
    comparePrice: deriveComparePrice(190),
    short: 'สูตรเดี่ยวเน้นคุณภาพผล ผลสวย น้ำหนักดี ขนาด 100 CC',
    desc: 'นุชฟอร์ไลฟ์ 2 ขนาด 100 CC เหมาะกับช่วงบำรุงผล เพิ่มคุณภาพผลผลิต และช่วยให้ผิวผลดูสม่ำเสมอขึ้น',
    specs: { 'ขนาด': '100 CC', 'ประเภท': 'สูตรเดี่ยว', 'ราคาเดิม': `${deriveComparePrice(190)} บาท`, 'ราคาพิเศษ': '190 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 60,
    sort: 60,
    imageFile: 'นุชฟอร์ไลฟ์2 100cc 190.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'],
      usageSteps: ['ใช้ช่วงติดผลหรือเร่งคุณภาพผล', 'ผสมน้ำสะอาดตามอัตรา', 'ฉีดพ่นต่อเนื่องตามสภาพแปลง'],
      warnings: ['ไม่ควรใช้เกินอัตราแนะนำ', 'หลีกเลี่ยงการพ่นขณะฝนใกล้ตก', 'อ่านฉลากก่อนใช้ทุกครั้ง'],
    },
  },
  {
    id: 'p3',
    name: 'นุชฟอร์ไลฟ์ 1 + 2',
    tag: 'แพ็กคู่',
    price: 390,
    comparePrice: deriveComparePrice(390),
    short: 'แพ็กคู่พื้นฐานสำหรับฟื้นต้นและต่อยอดคุณภาพผล ขนาดรวม 200 CC',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 2 ขนาดรวม 200 CC เหมาะสำหรับผู้ที่ต้องการเริ่มใช้สูตรหลักแบบเข้าใจง่ายในชุดเดียว',
    specs: { 'ขนาด': '200 CC', 'ประเภท': 'แพ็กคู่', 'สูตรในชุด': '1 + 2', 'ราคาเดิม': `${deriveComparePrice(390)} บาท`, 'ราคาพิเศษ': '390 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 45,
    sort: 40,
    imageFile: 'นุชฟอร์ไลฟ์1+2 190cc 390.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['ใช้เป็นชุดเริ่มต้นสำหรับดูแลต้นและผล', 'เลือกจังหวะการใช้ตามช่วงการเจริญเติบโต', 'สอบถามคุณจูนเพื่อจัดลำดับการใช้ให้เหมาะกับแปลง'],
    },
  },
  {
    id: 'p4',
    name: 'นุชฟอร์ไลฟ์ 1 + 8 + 9',
    tag: 'แพ็กโปร',
    price: 570,
    comparePrice: deriveComparePrice(570),
    short: 'แพ็กโปรสำหรับเสริมความแข็งแรงและคุมความสมบูรณ์ของต้น ขนาด 100 CC',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 8 + 9 ขนาด 100 CC เหมาะสำหรับช่วงที่ต้องการดูแลความสมบูรณ์ของต้นและรับมือสภาพแวดล้อมที่ไม่นิ่ง',
    specs: { 'ขนาด': '100 CC', 'ประเภท': 'แพ็กโปร', 'สูตรในชุด': '1 + 8 + 9', 'ราคาเดิม': `${deriveComparePrice(570)} บาท`, 'ราคาพิเศษ': '570 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 35,
    sort: 20,
    imageFile: 'นุชฟอร์ไลฟ์1+8+9 100cc 570.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['ใช้ช่วงต้นเริ่มอ่อนแรงหรืออากาศไม่นิ่ง', 'ฉีดพ่นสม่ำเสมอตามระยะพืช', 'สอบถามแนวทางผสมก่อนใช้ร่วมกับสูตรอื่น'],
    },
  },
  {
    id: 'p5',
    name: 'นุชฟอร์ไลฟ์ 1 + 9',
    tag: 'แพ็กโปร',
    price: 1000,
    comparePrice: deriveComparePrice(1000),
    short: 'แพ็กโปรขนาด 500 CC สำหรับเร่งต้นและดูแลความสม่ำเสมอของแปลง',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 9 ขนาด 500 CC เหมาะสำหรับลูกค้าที่ต้องการแพ็กใช้งานต่อเนื่องในแปลงจริงและเน้นความคุ้มค่ามากขึ้น',
    specs: { 'ขนาด': '500 CC', 'ประเภท': 'แพ็กโปร', 'สูตรในชุด': '1 + 9', 'ราคาเดิม': `${deriveComparePrice(1000)} บาท`, 'ราคาพิเศษ': '1,000 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 30,
    sort: 21,
    imageFile: 'นุชฟอร์ไลฟ์1+9 500cc 1000.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'],
      usageSteps: ['เหมาะกับสวนที่ต้องการแพ็กขนาดใช้งานจริง', 'ใช้ตามช่วงใบ ดอก หรือผลตามคำแนะนำ', 'เก็บในที่แห้งและพ้นแสงแดด'],
    },
  },
  {
    id: 'p6',
    name: 'นุชฟอร์ไลฟ์ 1 + 2 + 9',
    tag: 'แพ็กสุดคุ้ม',
    price: 1500,
    comparePrice: deriveComparePrice(1500),
    short: 'แพ็กสุดคุ้มขนาด 500 CC สำหรับดูแลแปลงอย่างต่อเนื่อง',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 2 + 9 ขนาด 500 CC เหมาะสำหรับสวนที่ต้องการแพ็กใช้งานจริง ครบทั้งฟื้นต้น ต่อยอดคุณภาพ และดูแลความสมดุลของแปลง',
    specs: { 'ขนาด': '500 CC', 'ประเภท': 'แพ็กสุดคุ้ม', 'สูตรในชุด': '1 + 2 + 9', 'ราคาเดิม': `${deriveComparePrice(1500)} บาท`, 'ราคาพิเศษ': '1,500 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 24,
    sort: 0,
    imageFile: 'นุชฟอร์ไลฟ์1+2+9 500cc 1500.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'],
      usageSteps: ['เหมาะกับการวางโปรแกรมใช้งานต่อเนื่อง', 'แบ่งใช้ตามจังหวะของพืชและสภาพแปลง', 'สอบถามคุณจูนเพื่อเรียงลำดับการใช้ให้แม่นยำ'],
    },
  },
  {
    id: 'p7',
    name: 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9',
    tag: 'แพ็กสุดคุ้ม',
    price: 700,
    comparePrice: deriveComparePrice(700),
    short: 'แพ็กครบสูตร 4 ตัวในชุดเดียว เหมาะกับคนที่อยากเริ่มแบบครบจบ ขนาด 100 CC',
    desc: 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9 ขนาด 100 CC เหมาะสำหรับลูกค้าที่ต้องการชุดครบสูตรในครั้งเดียวเพื่อทดลองใช้งานและจัดโปรแกรมได้ยืดหยุ่น',
    specs: { 'ขนาด': '100 CC', 'ประเภท': 'แพ็กสุดคุ้ม', 'สูตรในชุด': '1 + 2 + 8 + 9', 'ราคาเดิม': `${deriveComparePrice(700)} บาท`, 'ราคาพิเศษ': '700 บาท', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 20,
    sort: 1,
    imageFile: 'นุชฟอร์ไลฟ์1+2+8+9 100cc 700.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['เหมาะกับคนที่อยากเริ่มด้วยชุดรวมครบสูตร', 'ปรับจังหวะใช้ตามระยะพืชและเป้าหมายของแปลง', 'ทักแชตเพื่อขอคำแนะนำการใช้แบบเป็นลำดับได้'],
    },
  },
];

const keepIds = new Set(products.map((item) => item.id));
const currentProducts = await listProducts(true);
for (const product of currentProducts) {
  if (keepIds.has(product.id)) continue;
  if (product.active === false) continue;
  await updateProduct(product.id, { active: false });
}

const results = [];
for (const product of products) {
  results.push(await upsertProduct(product));
}

console.log(JSON.stringify(results.map((item) => ({
  action: item.action,
  id: item.product.id,
  name: item.product.name,
  price: item.product.price,
  image: item.product.image,
})), null, 2));
