import '../env.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProduct, getProduct, getSetting, setSetting, updateProduct } from '../db-supabase.js';
import { uploadPublicAsset } from '../supabase-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');
const assetDir = path.join(projectRoot, 'POD');

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
  const extension = path.extname(fileName).replace('.', '') || 'png';
  return uploadPublicAsset({
    buffer,
    contentType: mimeFromExt(fileName),
    extension,
    folder: 'products/pod',
  });
}

function comparePriceFromSale(price) {
  const amount = parseInt(price, 10) || 0;
  if (amount <= 0) return 0;
  return Math.round(amount * 1.25);
}

function normalizeCategoryList(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean);
  } catch {}
  return text.split(/\r?\n|,/).map((item) => String(item || '').trim()).filter(Boolean);
}

const products = [
  {
    id: 'pod_01',
    fileName: '1.png',
    name: 'พอตลักซ์ คัลเลอร์ไลน์',
    tag: 'พร้อมส่ง',
    price: 399,
    short: 'พอตโทนสีสด ดีไซน์เรียบดูแพง เลือกง่าย ขายง่าย พกสะดวกทุกวัน',
    desc: 'พอตคอลเลกชันโทนสีเด่นที่ให้ลุคสะอาดและทันสมัย เหมาะกับลูกค้าที่ชอบดีไซน์มินิมอล ดูแพง แต่ยังใช้งานง่ายและตัดสินใจซื้อได้ไวจากภาพแรก',
    stock: 25,
    sort: 10,
    extra: {
      category: 'พอต',
      comparePrice: comparePriceFromSale(399),
      sku: 'POD-01',
      highlight: 'สีเด่น ลุคแพง พกง่าย เหมาะลงตู้หน้าร้าน',
      style: 'มินิมอลโทนสีสด',
      audience: 'เหมาะกับลูกค้าที่ชอบพอตลุคเรียบ ดูสะอาด และต้องการเลือกตัวที่ถือแล้วดูดีทันที',
      audienceShort: 'สายมินิมอล เลือกง่าย ถือแล้วดูดี',
      sellingNote: 'ตัวนี้เหมาะทำเป็นสินค้าหน้าแรกหรือวางเป็นตัวเปิดหมวด เพราะภาพรวมดูสะอาดและเข้าถึงลูกค้าง่าย',
      sellingPoints: [
        'ภาพรวมสีเด่น ช่วยให้ลูกค้าเลือกจากลุคได้เร็ว',
        'ทรงเรียบพกง่าย เหมาะกับการใช้งานทุกวัน',
        'ราคา 399 บาท เปิดการขายง่ายและปิดจบไว',
      ],
      usageSteps: [
        'แนะนำลูกค้าจากโทนสีที่ชอบก่อน เพื่อให้ตัดสินใจง่ายขึ้น',
        'เน้นว่าตัวนี้เหมาะกับคนที่อยากได้ลุคสะอาดและถือแล้วดูดี',
        'ปิดการขายด้วยราคาเดียว 399 บาทและสถานะพร้อมส่ง',
      ],
      warnings: ['ควรตรวจสอบอุปกรณ์และการใช้งานให้เป็นไปตามกฎหมายที่เกี่ยวข้อง', 'เก็บให้พ้นมือเด็กและหลีกเลี่ยงความร้อนสูง', 'ใช้และจัดจำหน่ายภายใต้ข้อกำหนดของร้านอย่างเคร่งครัด'],
      faq: [
        { q: 'รุ่นนี้เด่นตรงไหน', a: 'เด่นที่โทนสีสดและลุคมินิมอล ทำให้ลูกค้าเลือกง่ายและถือแล้วดูสะอาดทันที' },
        { q: 'เหมาะกับลูกค้าแบบไหน', a: 'เหมาะกับลูกค้าที่อยากได้พอตใช้งานง่าย ลุคดี และราคาเข้าถึงง่าย' },
      ],
    },
  },
  {
    id: 'pod_02',
    fileName: '2.png',
    name: 'พอตแบล็ก ซิกเนเจอร์',
    tag: 'ขายดี',
    price: 399,
    short: 'พอตลุคเข้ม ดูจริงจัง ภาพจำชัด จับถนัดมือ และให้ฟีลพรีเมียม',
    desc: 'พอตโทนเข้มสไตล์พรีเมียมสำหรับลูกค้าที่ชอบอุปกรณ์ภาพลักษณ์จริงจัง ดูแพง และถือใช้งานแล้วมีบุคลิกชัด เหมาะทำเป็นตัวขายดีของร้าน',
    stock: 25,
    sort: 20,
    extra: {
      category: 'พอต',
      comparePrice: comparePriceFromSale(399),
      sku: 'POD-02',
      highlight: 'ลุคเข้มพรีเมียม ขายง่าย เหมาะเป็นตัวฮิตของร้าน',
      style: 'โทนเข้มพรีเมียม',
      audience: 'เหมาะกับลูกค้าที่ต้องการพอตลุคเข้ม ดูจริงจัง และอยากได้ตัวที่ถือแล้วให้ภาพลักษณ์ชัดเจน',
      audienceShort: 'สายลุคเข้ม ชอบความพรีเมียม',
      sellingNote: 'ตัวนี้เหมาะใช้เป็นตัวตอบลูกค้ากลุ่มที่ถามหาพอตลุคเท่ ดูจริงจัง และอยากได้ตัวที่ภาพจำแรง',
      sellingPoints: [
        'ลุคเข้มดูแพง เหมาะกับลูกค้าที่ชอบภาพลักษณ์จริงจัง',
        'ทรงจับถนัดมือ เหมาะกับการใช้งานประจำวัน',
        'เป็นตัวที่ใช้ดันหมวดขายดีได้ง่ายเพราะภาพจำชัด',
      ],
      usageSteps: [
        'นำเสนอเป็นตัวเลือกสำหรับลูกค้าที่ไม่ชอบสีหวานหรือโทนสด',
        'ปิดการขายด้วยภาพลักษณ์พรีเมียมและราคาที่ตัดสินใจง่าย',
        'แนะนำคู่กับรุ่นโทนสว่างเพื่อให้ลูกค้าเปรียบเทียบลุคได้ทันที',
      ],
      warnings: ['ควรตรวจสอบอุปกรณ์และการใช้งานให้เป็นไปตามกฎหมายที่เกี่ยวข้อง', 'เก็บให้พ้นมือเด็กและหลีกเลี่ยงความร้อนสูง', 'ใช้และจัดจำหน่ายภายใต้ข้อกำหนดของร้านอย่างเคร่งครัด'],
      faq: [
        { q: 'ตัวนี้เหมาะกับใคร', a: 'เหมาะกับลูกค้าที่ชอบลุคเข้ม ดูจริงจัง และอยากได้พอตที่ภาพลักษณ์ชัด' },
        { q: 'ทำไมถึงเป็นตัวขายง่าย', a: 'เพราะภาพจำชัดและลุคพรีเมียม ทำให้ลูกค้าตัดสินใจจากสไตล์ได้เร็ว' },
      ],
    },
  },
  {
    id: 'pod_03',
    fileName: '3.png',
    name: 'พอตพีชไอซ์ เอดิชัน',
    tag: 'แนะนำ',
    price: 399,
    short: 'โทนสดใส ลุคแฟชั่น ภาพจำแรง เหมาะดันเป็นตัวเด่นของหน้าร้าน',
    desc: 'พอตภาพลักษณ์สดใสแนวแฟชั่นที่ช่วยดึงสายตาได้ดี เหมาะสำหรับใช้เป็นตัวเด่นในแบนเนอร์ หน้าแนะนำ หรือช่วงโปรโมชันที่ต้องการเพิ่มโอกาสคลิกและการถามซื้อ',
    stock: 25,
    sort: 30,
    extra: {
      category: 'พอต',
      comparePrice: comparePriceFromSale(399),
      sku: 'POD-03',
      highlight: 'ภาพจำชัด เหมาะทำตัวเด่นหน้าแรกและหน้าโปรโมชัน',
      style: 'แฟชั่นโทนสดใส',
      audience: 'เหมาะกับลูกค้าที่ชอบพอตลุคแฟชั่น สีชัด และอยากได้ตัวที่สะดุดตาตั้งแต่ครั้งแรกที่เห็น',
      audienceShort: 'สายแฟชั่น ชอบสีสด ภาพจำชัด',
      sellingNote: 'เหมาะใช้เป็นตัวเรียกสายตาในหน้าแรกและดันยอดเข้าหมวดพอต เพราะภาพสินค้าเด่นกว่าตัวอื่นชัดเจน',
      sellingPoints: [
        'ภาพสินค้าโดดเด่น เหมาะใช้เป็นตัวเรียกคลิกในหน้าแรก',
        'ลุคแฟชั่นและสีสด ทำให้ปิดการขายกับสายแฟชั่นได้ง่าย',
        'ราคา 399 บาท เหมาะกับการทำดีลเปิดหมวดและโปรโมชัน',
      ],
      usageSteps: [
        'วางเป็นตัวเด่นในหน้าแรกหรือ section คอลเลกชันพอต',
        'ใช้กับคำขายแนวสีสด ลุคแฟชั่น และภาพจำชัด',
        'จับคู่กับรุ่นโทนเข้มเพื่อให้ลูกค้าเลือกสไตล์ได้เร็วขึ้น',
      ],
      warnings: ['ควรตรวจสอบอุปกรณ์และการใช้งานให้เป็นไปตามกฎหมายที่เกี่ยวข้อง', 'เก็บให้พ้นมือเด็กและหลีกเลี่ยงความร้อนสูง', 'ใช้และจัดจำหน่ายภายใต้ข้อกำหนดของร้านอย่างเคร่งครัด'],
      faq: [
        { q: 'รุ่นนี้เหมาะทำโปรโมชันไหม', a: 'เหมาะมาก เพราะภาพจำชัดและสีสันเด่น ทำให้เรียกความสนใจได้ดี' },
        { q: 'ทำไมควรเป็นตัวเด่นของหมวด', a: 'เพราะมองแล้วสะดุดตาและช่วยให้ลูกค้ากดเข้าดูหมวดพอตได้ง่ายขึ้น' },
      ],
    },
  },
  {
    id: 'pod_04',
    fileName: '4.png',
    name: 'พอตสปอร์ต แบล็กเรด',
    tag: 'พร้อมส่ง',
    price: 399,
    short: 'พอตทรงกล่องโทนดำแดง ลุคสปอร์ต ดุดัน และเหมาะกับสายใช้งานจริง',
    desc: 'พอตทรงกล่องดีไซน์ดำแดงแบบสปอร์ต ให้ภาพลักษณ์แข็งแรง ดุดัน และคล่องตัว เหมาะสำหรับลูกค้าที่มองหาตัวเลือกที่ดูจริงจังและตอบโจทย์สายใช้งาน',
    stock: 25,
    sort: 40,
    extra: {
      category: 'พอต',
      comparePrice: comparePriceFromSale(399),
      sku: 'POD-04',
      highlight: 'ลุคสปอร์ต ดุดัน เหมาะกับสายใช้งานจริง',
      style: 'สปอร์ตโทนดำแดง',
      audience: 'เหมาะกับลูกค้าที่ชอบพอตทรงชัด ลุคเท่ ดุดัน และต้องการตัวที่ดูพร้อมใช้งานจริง',
      audienceShort: 'สายสปอร์ต ชอบลุคแข็งแรง',
      sellingNote: 'ใช้เสนอเป็นตัวเลือกสำหรับลูกค้าที่ไม่ชอบทรงมินิมอลและอยากได้ภาพลักษณ์แรงขึ้นชัดเจน',
      sellingPoints: [
        'ทรงกล่องดูชัดและให้ลุคสปอร์ตแตกต่างจากรุ่นอื่น',
        'โทนดำแดงช่วยให้ภาพรวมดูแรงและจดจำง่าย',
        'เหมาะกับลูกค้าที่อยากได้ตัวใช้งานจริงและลุคเท่',
      ],
      usageSteps: [
        'เสนอรุ่นนี้เมื่อลูกค้าต้องการลุคเข้มแต่มีความสปอร์ตชัดขึ้น',
        'ใช้คำขายเรื่องทรงชัด ลุคแรง และเหมาะกับสายใช้งานจริง',
        'วางคู่กับรุ่นโทนดำเพื่อให้ลูกค้าเลือกความดุดันตามสไตล์',
      ],
      warnings: ['ควรตรวจสอบอุปกรณ์และการใช้งานให้เป็นไปตามกฎหมายที่เกี่ยวข้อง', 'เก็บให้พ้นมือเด็กและหลีกเลี่ยงความร้อนสูง', 'ใช้และจัดจำหน่ายภายใต้ข้อกำหนดของร้านอย่างเคร่งครัด'],
      faq: [
        { q: 'ตัวนี้ต่างจากรุ่นลุคเข้มทั่วไปยังไง', a: 'ตัวนี้เด่นที่ทรงกล่องและโทนดำแดง ทำให้ลุคออกสปอร์ตและดุดันกว่ารุ่นเรียบ' },
        { q: 'เหมาะกับลูกค้าแบบไหน', a: 'เหมาะกับลูกค้าที่ชอบลุคเท่จริงจังและอยากได้พอตที่ภาพลักษณ์ดูพร้อมใช้งาน' },
      ],
    },
  },
  {
    id: 'pod_05',
    fileName: '5.png',
    name: 'พอตคลาสสิก แบล็กทัช',
    tag: 'ใหม่เข้า',
    price: 399,
    short: 'พอตทรงกระบอกโทนดำเงา เรียบหรู จับถนัดมือ และดูคลาสสิก',
    desc: 'พอตทรงกระบอกลุคโมเดิร์นสีดำเงา เหมาะกับลูกค้าที่ชอบสไตล์เรียบหรูและอยากได้ตัวเลือกที่ดูคลาสสิก พกง่าย และหยิบขึ้นมาแล้วดูดีทันที',
    stock: 25,
    sort: 50,
    extra: {
      category: 'พอต',
      comparePrice: comparePriceFromSale(399),
      sku: 'POD-05',
      highlight: 'ทรงกระบอก เรียบหรู จับถนัดมือ และดูคลาสสิก',
      style: 'คลาสสิกเรียบหรู',
      audience: 'เหมาะกับลูกค้าที่ชอบพอตโทนดำเงา เรียบแต่ดูดี และไม่ต้องการดีไซน์ที่หวือหวาเกินไป',
      audienceShort: 'สายเรียบหรู ชอบดีไซน์คลาสสิก',
      sellingNote: 'ใช้เป็นตัวเลือกสำหรับลูกค้าที่ชอบลุคคลาสสิกและอยากได้พอตที่ดูดีแบบไม่ต้องแต่งเยอะ',
      sellingPoints: [
        'ทรงกระบอกจับกระชับมือและให้ฟีลคลาสสิกชัดเจน',
        'โทนดำเงาช่วยให้สินค้าดูเรียบหรูและขายง่าย',
        'เหมาะเป็นตัวเลือกสำหรับลูกค้าที่ไม่ชอบสีสดหรือทรงเหลี่ยม',
      ],
      usageSteps: [
        'เสนอเป็นตัวเลือกสำหรับลูกค้าที่ขอรุ่นเรียบหรูหรือดูผู้ใหญ่ขึ้น',
        'ใช้คำขายเรื่องทรงคลาสสิกและจับถนัดมือเป็นหลัก',
        'ปิดการขายด้วยความเรียบหรูและราคา 399 บาทที่ตัดสินใจง่าย',
      ],
      warnings: ['ควรตรวจสอบอุปกรณ์และการใช้งานให้เป็นไปตามกฎหมายที่เกี่ยวข้อง', 'เก็บให้พ้นมือเด็กและหลีกเลี่ยงความร้อนสูง', 'ใช้และจัดจำหน่ายภายใต้ข้อกำหนดของร้านอย่างเคร่งครัด'],
      faq: [
        { q: 'ตัวนี้เด่นตรงไหน', a: 'เด่นที่ลุคเรียบหรู ทรงกระบอกคลาสสิก และภาพรวมที่ดูดีแบบไม่ต้องแต่งเยอะ' },
        { q: 'เหมาะกับใครที่สุด', a: 'เหมาะกับลูกค้าที่ชอบดีไซน์เรียบ สุภาพ และอยากได้พอตที่ถือแล้วดูแพง' },
      ],
    },
  },
];

async function upsertProduct(definition) {
  const current = await getProduct(definition.id);
  const imageUrl = await uploadImage(definition.fileName);
  const payload = {
    name: definition.name,
    tag: definition.tag,
    price: definition.price,
    short: definition.short,
    desc: definition.desc,
    specs: {
      ราคา: `${definition.price} บาท`,
      หมวด: 'พอต',
      สถานะ: 'พร้อมขาย',
      สไตล์: definition.extra?.style || '',
      เหมาะกับ: definition.extra?.audienceShort || '',
      จุดเด่น: definition.extra?.highlight || '',
    },
    segment: 'lifestyle',
    extra: definition.extra,
    icon: 'pod',
    image: imageUrl,
    images: [imageUrl],
    model: '',
    stock: definition.stock,
    active: true,
    sort: definition.sort,
  };

  if (current) {
    const updated = await updateProduct(definition.id, payload);
    return { action: 'updated', product: updated };
  }
  const created = await createProduct({ id: definition.id, ...payload });
  return { action: 'created', product: created };
}

const results = [];
for (const product of products) {
  results.push(await upsertProduct(product));
}

const currentCategories = normalizeCategoryList(await getSetting('SITE_PRODUCT_CATEGORIES'));
const nextCategories = [...new Set([...currentCategories, 'พอต'])];
await setSetting('SITE_PRODUCT_CATEGORIES', JSON.stringify(nextCategories));

console.log(JSON.stringify(results.map((item) => ({
  action: item.action,
  id: item.product.id,
  name: item.product.name,
  price: item.product.price,
  image: item.product.image,
})), null, 2));
