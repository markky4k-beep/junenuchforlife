import '../env.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProduct, getProduct, listProducts, updateProduct } from '../db-supabase.js';
import { uploadPublicAsset } from '../supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');
const markkyAssetDir = path.join(projectRoot, 'markkyproduction');
const legacyPackAssetDir = path.join(projectRoot, 'Nuchforlife', 'NuchforlifeMain');

function mimeFromExt(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function resolveAssetDir(folder = 'markky') {
  return folder === 'legacy-pack' ? legacyPackAssetDir : markkyAssetDir;
}

async function uploadImage(fileName, folder = 'markky') {
  const filePath = path.join(resolveAssetDir(folder), fileName);
  const buffer = await fs.readFile(filePath);
  const extension = path.extname(fileName).replace('.', '') || 'jpg';
  return uploadPublicAsset({
    buffer,
    contentType: mimeFromExt(fileName),
    extension,
    folder: folder === 'legacy-pack' ? 'products/nuchforlife-packs' : 'products/markkyproduction',
  });
}

function deriveComparePrice(sellingPrice, percent = 20) {
  const price = parseInt(sellingPrice, 10) || 0;
  if (price <= 0) return 0;
  const ratio = 1 - (percent / 100);
  if (ratio <= 0) return price;
  return Math.max(price + 1, Math.round(price / ratio));
}

function normalizeModelUrl(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return /\.(glb|gltf)(?:[?#].*)?$/i.test(text) ? text : '';
}

async function upsertProduct(definition) {
  const current = await getProduct(definition.id);
  const image = definition.imageFile ? await uploadImage(definition.imageFile, definition.assetFolder) : (current?.image || '');
  const payload = {
    name: definition.name,
    tag: definition.tag || '',
    price: definition.price,
    short: definition.short,
    desc: definition.desc,
    specs: definition.specs || {},
    segment: 'agri',
    extra: { ...(definition.extra || {}), comparePrice: definition.comparePrice || 0, category: definition.category || 'สินค้าเดี่ยว' },
    icon: definition.icon || 'pod',
    image,
    images: current?.images || [],
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

function formatPrice(price) {
  return `${new Intl.NumberFormat('th-TH').format(price)} บาท`;
}

function buildFormulaProduct({
  id,
  formulaNo,
  sizeCc,
  imageFile,
  price,
  sort,
  shortText,
  descText,
  bulletTitle,
}) {
  const comparePrice = deriveComparePrice(price);
  const isBig = sizeCc === 500;
  return {
    id,
    name: `นุชฟอร์ไลฟ์ ${formulaNo} (${sizeCc} CC)`,
    category: 'สินค้าเดี่ยว',
    price,
    comparePrice,
    short: `${bulletTitle} พร้อมส่ง ขนาด ${sizeCc} CC`,
    desc: `นุชฟอร์ไลฟ์ ${formulaNo} ขนาด ${sizeCc} CC ${descText} เหมาะกับลูกค้าที่ต้องการสูตรใช้งานชัดเจน ดูแลง่าย และเห็นภาพการใช้ได้ทันที`,
    specs: {
      'ขนาด': `${sizeCc} CC`,
      'สูตร': `นุชฟอร์ไลฟ์ ${formulaNo}`,
      'ประเภท': 'สินค้าเดี่ยว',
      'ราคาเดิม': formatPrice(comparePrice),
      'ราคาพิเศษ': formatPrice(price),
      'วิธีใช้': 'ฉีดพ่นทางใบ หรือรดโคนต้น',
      'อัตรา': '10-20 ซีซี ต่อน้ำ 20 ลิตร',
      'ความถี่': 'ใช้ทุก 7-10 วัน',
      'เหมาะสำหรับ': 'พืชทุกชนิด',
    },
    stock: sizeCc === 500 ? 60 : 80,
    sort,
    imageFile,
    assetFolder: 'markky',
    extra: {
      cropTargets: ['พริก', 'มะเขือเทศ', 'แตงกวา', 'ผักใบ', 'ไม้ดอก', 'ไม้ผล'],
      usageSteps: ['ผสมน้ำ 10-20 ซีซี ต่อน้ำ 20 ลิตร', 'ฉีดพ่นทางใบหรือรดโคนต้น', 'ใช้ซ้ำทุก 7-10 วันตามความเหมาะสม'],
      warnings: ['เขย่าขวดก่อนใช้', 'เก็บในที่แห้งและพ้นแสงแดด', 'ควรอ่านคำแนะนำก่อนใช้ทุกครั้ง'],
      tagline: bulletTitle,
      sizeLabel: `${sizeCc} CC`,
      bottleSize: sizeCc === 500 ? 'big' : 'small',
      cardName: `สูตร ${formulaNo} ${isBig ? 'ขวดใหญ่' : 'ขวดเล็ก'}`,
    },
  };
}

function buildPackProduct(definition) {
  const comparePrice = deriveComparePrice(definition.price);
  return {
    ...definition,
    category: 'ชุดเซต',
    comparePrice,
    tag: definition.tag,
    assetFolder: 'legacy-pack',
    specs: {
      ...(definition.specs || {}),
      'ราคาเดิม': formatPrice(comparePrice),
      'ราคาพิเศษ': formatPrice(definition.price),
    },
    extra: {
      ...(definition.extra || {}),
      comparePrice,
    },
  };
}

const products = [
  buildFormulaProduct({
    id: 'mk1b',
    formulaNo: 1,
    sizeCc: 500,
    imageFile: 'Nuchbig1.png',
    price: 590,
    sort: 200,
    bulletTitle: 'บำรุงต้น บำรุงราก ให้ทรงพุ่มแข็งแรง',
    descText: 'เด่นเรื่องการฟื้นต้น วางราก และช่วยให้ใบกับทรงพุ่มดูสมบูรณ์ขึ้น เหมาะสำหรับช่วงเริ่มบำรุงหรือช่วงที่ต้นต้องการแรงส่ง',
  }),
  buildFormulaProduct({
    id: 'mk1s',
    formulaNo: 1,
    sizeCc: 100,
    imageFile: 'Nuchsmall1.png',
    price: 190,
    sort: 100,
    bulletTitle: 'บำรุงต้น บำรุงราก ให้ทรงพุ่มแข็งแรง',
    descText: 'เด่นเรื่องการฟื้นต้น วางราก และช่วยให้ใบกับทรงพุ่มดูสมบูรณ์ขึ้น เหมาะสำหรับลูกค้าที่อยากเริ่มทดลองในงบเบาแต่เห็นทิศทางชัด',
  }),
  buildFormulaProduct({
    id: 'mk2b',
    formulaNo: 2,
    sizeCc: 500,
    imageFile: 'Nuchbig2.png',
    price: 590,
    sort: 210,
    bulletTitle: 'เร่งคุณภาพผล น้ำหนักดี สีสวย รสชาติดี',
    descText: 'ออกแบบมาสำหรับช่วงทำผลโดยเฉพาะ ช่วยดันคุณภาพผลให้ดูสวย น่าขาย และเพิ่มความมั่นใจเวลาส่งขายหรือเก็บผลผลิต',
  }),
  buildFormulaProduct({
    id: 'mk2s',
    formulaNo: 2,
    sizeCc: 100,
    imageFile: 'Nuchsmall2.png',
    price: 190,
    sort: 110,
    bulletTitle: 'เร่งคุณภาพผล น้ำหนักดี สีสวย รสชาติดี',
    descText: 'เหมาะสำหรับผู้ที่อยากลองสูตรบำรุงผลก่อน ช่วยเสริมคุณภาพผลให้จับตลาดง่ายขึ้นโดยไม่ต้องเริ่มจากขวดใหญ่',
  }),
  buildFormulaProduct({
    id: 'mk8b',
    formulaNo: 8,
    sizeCc: 500,
    imageFile: 'Nuchbig8.png',
    price: 590,
    sort: 220,
    bulletTitle: 'พืชแข็งแรง ทนสภาพอากาศ ลดร่วง',
    descText: 'เหมาะมากในช่วงอากาศไม่นิ่ง ฝนสลับร้อน หรือช่วงต้นอ่อนแรง ช่วยพยุงทรงต้นให้ดูนิ่งขึ้นและลดความเสี่ยงเรื่องดอกกับผลร่วง',
  }),
  buildFormulaProduct({
    id: 'mk8s',
    formulaNo: 8,
    sizeCc: 100,
    imageFile: 'Nuchsmall8.png',
    price: 190,
    sort: 120,
    bulletTitle: 'พืชแข็งแรง ทนสภาพอากาศ ลดร่วง',
    descText: 'เหมาะสำหรับลูกค้าที่อยากลองสูตรดูแลต้นช่วงสภาพอากาศแปรปรวนก่อน ช่วยให้ต้นดูแข็งแรงและดูแลง่ายขึ้น',
  }),
  buildFormulaProduct({
    id: 'mk9b',
    formulaNo: 9,
    sizeCc: 500,
    imageFile: 'Nuchbig9.png',
    price: 590,
    sort: 230,
    bulletTitle: 'ฟื้นใบสวย ลดใบเหลือง ใบจุด',
    descText: 'เหมาะสำหรับสวนที่ต้องการคืนความสมบูรณ์ให้ใบและทรงต้น ช่วยให้ภาพรวมของแปลงดูสดขึ้นและดูมีพลังมากกว่าเดิม',
  }),
  buildFormulaProduct({
    id: 'mk9s',
    formulaNo: 9,
    sizeCc: 100,
    imageFile: 'Nuchsmall9.png',
    price: 190,
    sort: 130,
    bulletTitle: 'ฟื้นใบสวย ลดใบเหลือง ใบจุด',
    descText: 'เหมาะสำหรับเริ่มทดลองสูตรฟื้นต้น ช่วยให้ต้นพร้อมต่อยอดการแตกยอดหรือติดผลได้อย่างมั่นใจยิ่งขึ้น',
  }),
  buildPackProduct({
    id: 'pack129',
    name: 'นุชฟอร์ไลฟ์ 1 + 2 + 9',
    tag: 'แพ็กสุดคุ้ม',
    price: 1500,
    short: 'ชุดขายดี ดูแลต้น ใบ และผลได้ครบในแพ็กเดียว',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 2 + 9 ขนาด 500 CC เป็นแพ็กคุ้มสำหรับลูกค้าที่ต้องการดูแลแปลงต่อเนื่องแบบครบสูตรในครั้งเดียว ทั้งฟื้นต้น ดันคุณภาพผล และเก็บความสมบูรณ์ของใบให้ดูสวยพร้อมขาย',
    specs: { 'ขนาด': '500 CC', 'ประเภท': 'แพ็กสุดคุ้ม', 'สูตรในชุด': '1 + 2 + 9', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 24,
    sort: 10,
    imageFile: 'นุชฟอร์ไลฟ์1+2+9 500cc 1500.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'],
      usageSteps: ['เหมาะกับการวางโปรแกรมใช้งานต่อเนื่อง', 'แบ่งใช้ตามจังหวะของพืชและสภาพแปลง', 'สอบถามคุณจูนเพื่อเรียงลำดับการใช้ให้แม่นยำ'],
      cardName: 'เซต 1+2+9',
    },
  }),
  buildPackProduct({
    id: 'pack1289',
    name: 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9',
    tag: 'แพ็กสุดคุ้ม',
    price: 700,
    short: 'แพ็กเริ่มต้นครบสูตร สำหรับคนอยากลองให้ครบในชุดเดียว',
    desc: 'แพ็กนุชฟอร์ไลฟ์ 1 + 2 + 8 + 9 ขนาด 100 CC เหมาะสำหรับลูกค้าที่ต้องการทดลองครบทุกมิติในงบเริ่มต้นเดียว ทั้งบำรุงต้น บำรุงผล เสริมความแข็งแรง และฟื้นสมดุลของแปลง',
    specs: { 'ขนาด': '100 CC', 'ประเภท': 'แพ็กสุดคุ้ม', 'สูตรในชุด': '1 + 2 + 8 + 9', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 20,
    sort: 11,
    imageFile: 'นุชฟอร์ไลฟ์1+2+8+9 100cc 700.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['เหมาะกับคนที่อยากเริ่มด้วยชุดรวมครบสูตร', 'ปรับจังหวะใช้ตามระยะพืชและเป้าหมายของแปลง', 'ทักแชตเพื่อขอคำแนะนำการใช้แบบเป็นลำดับได้'],
      cardName: 'เซต 1+2+8+9',
    },
  }),
  buildPackProduct({
    id: 'pack189',
    name: 'นุชฟอร์ไลฟ์ 1 + 8 + 9',
    tag: 'แพ็กโปร',
    price: 570,
    short: 'ชุดดูแลต้นให้แน่น ฟื้นไว รับมืออากาศไม่นิ่ง',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 8 + 9 ขนาด 100 CC เหมาะสำหรับช่วงที่ต้นต้องการแรงพยุงเป็นพิเศษ ช่วยให้ต้นดูนิ่ง แข็งแรง และพร้อมเดินโปรแกรมต่อได้ง่ายขึ้น',
    specs: { 'ขนาด': '100 CC', 'ประเภท': 'แพ็กโปร', 'สูตรในชุด': '1 + 8 + 9', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 35,
    sort: 20,
    imageFile: 'นุชฟอร์ไลฟ์1+8+9 100cc 570.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['ใช้ช่วงต้นเริ่มอ่อนแรงหรืออากาศไม่นิ่ง', 'ฉีดพ่นสม่ำเสมอตามระยะพืช', 'สอบถามแนวทางผสมก่อนใช้ร่วมกับสูตรอื่น'],
      cardName: 'เซต 1+8+9',
    },
  }),
  buildPackProduct({
    id: 'pack19',
    name: 'นุชฟอร์ไลฟ์ 1 + 9',
    tag: 'แพ็กโปร',
    price: 1000,
    short: 'แพ็กคุ้มสำหรับเร่งต้น พร้อมฟื้นใบให้ดูสมบูรณ์',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 9 ขนาด 500 CC เหมาะสำหรับลูกค้าที่ต้องการดูแลต้นและใบแบบใช้งานต่อเนื่อง ช่วยให้แปลงดูสด แข็งแรง และคุมภาพรวมได้ง่ายในระยะยาว',
    specs: { 'ขนาด': '500 CC', 'ประเภท': 'แพ็กโปร', 'สูตรในชุด': '1 + 9', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 30,
    sort: 21,
    imageFile: 'นุชฟอร์ไลฟ์1+9 500cc 1000.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'พืชผัก'],
      usageSteps: ['เหมาะกับสวนที่ต้องการแพ็กขนาดใช้งานจริง', 'ใช้ตามช่วงใบ ดอก หรือผลตามคำแนะนำ', 'เก็บในที่แห้งและพ้นแสงแดด'],
      cardName: 'เซต 1+9',
    },
  }),
  buildPackProduct({
    id: 'pack12',
    name: 'นุชฟอร์ไลฟ์ 1 + 2',
    tag: 'แพ็กคู่',
    price: 390,
    short: 'แพ็กคู่เริ่มต้น ใช้ง่าย เห็นภาพการใช้ชัด',
    desc: 'ชุดนุชฟอร์ไลฟ์ 1 + 2 ขนาดรวม 200 CC เหมาะสำหรับลูกค้าที่ต้องการเริ่มจากคู่หลักของแบรนด์ ใช้ง่าย เข้าใจลำดับง่าย และต่อยอดไปสู่โปรแกรมเต็มได้สบาย',
    specs: { 'ขนาด': '200 CC', 'ประเภท': 'แพ็กคู่', 'สูตรในชุด': '1 + 2', 'วิธีใช้': 'ฉีดพ่นทางใบ', 'อัตรา': '5 ซีซี ต่อน้ำ 20 ลิตร' },
    stock: 45,
    sort: 30,
    imageFile: 'นุชฟอร์ไลฟ์1+2 190cc 390.-.jpg',
    extra: {
      cropTargets: ['ทุเรียน', 'มะม่วง', 'ข้าว', 'พืชผัก'],
      usageSteps: ['ใช้เป็นชุดเริ่มต้นสำหรับดูแลต้นและผล', 'เลือกจังหวะการใช้ตามช่วงการเจริญเติบโต', 'สอบถามคุณจูนเพื่อจัดลำดับการใช้ให้เหมาะกับแปลง'],
      cardName: 'เซต 1+2',
    },
  }),
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
