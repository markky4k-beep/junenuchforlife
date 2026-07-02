import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const sourceDir = path.resolve('Reviewbest');
const targetDir = path.resolve('public', 'uploads', 'review-gallery');
const targetJson = path.resolve('public', 'review-gallery.json');
const IMAGE_RE = /\.(jpg|jpeg|png|webp)$/i;
const REVIEW_BADGES = ['ผลงานจริง', 'ลูกค้าส่งกลับมา', 'รีวิวผู้ใช้จริง', 'ภาพจากหน้างาน', 'ความประทับใจจากลูกค้า'];
const REVIEW_TITLES = [
  'ลูกค้าใช้งานจริงและส่งผลลัพธ์กลับมา',
  'ภาพรีวิวที่ช่วยให้ลูกค้าใหม่ตัดสินใจง่ายขึ้น',
  'รีวิวจากผู้ใช้จริงที่เห็นผลลัพธ์ชัดเจน',
  'ผลงานจริงจากลูกค้าที่ไว้วางใจของคุณจูน',
  'ภาพใช้งานจริงที่สะท้อนความตั้งใจของลูกค้า',
];
const REVIEW_NOTES = [
  'ภาพรีวิวและผลงานจริงจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์ เพื่อช่วยให้ลูกค้าใหม่เห็นภาพก่อนเลือกสูตร',
  'รีวิวจากผู้ใช้จริงที่ช่วยให้เห็นความจริงใจของคุณจูนนุชฟอร์ไลฟ์และผลลัพธ์หน้างานได้ชัดขึ้นก่อนตัดสินใจสั่งซื้อ',
  'ภาพผลงานจากลูกค้าของคุณจูนนุชฟอร์ไลฟ์ที่ช่วยสร้างความมั่นใจได้มากกว่าคำโฆษณา เพราะเป็นการใช้งานจริง',
  'ตัวอย่างรีวิวจากลูกค้าจริงที่สะท้อนทั้งความเชื่อมั่นและประสบการณ์หลังเลือกใช้ผลิตภัณฑ์ของคุณจูนนุชฟอร์ไลฟ์',
  'ภาพส่งกลับจากลูกค้าที่ช่วยให้ลูกค้าใหม่รู้สึกอุ่นใจ เห็นงานจริง และตัดสินใจคุยต่อกับคุณจูนได้ง่ายขึ้น',
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function clearTargetDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && IMAGE_RE.test(entry.name)) fs.unlinkSync(path.join(dir, entry.name));
  }
}
function fileHash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}
function spotlightIndexes(total, count = 5) {
  if (total <= 0) return [];
  if (total <= count) return Array.from({ length: total }, (_, index) => index);
  const picks = new Set([0]);
  for (let step = 1; step < count; step += 1) {
    picks.add(Math.min(total - 1, Math.round((step * (total - 1)) / (count - 1))));
  }
  return [...picks].sort((a, b) => a - b);
}

function normalizeName(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const base = path.basename(fileName, path.extname(fileName))
    .normalize('NFKD')
    .replace(/[^\w\s-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return `${base || 'review'}${ext}`;
}

function titleFromFileName(fileName, index) {
  const match = String(fileName).match(/_(\d+)(?=\.[^.]+$)/);
  const number = match ? parseInt(match[1], 10) : index + 1;
  const title = REVIEW_TITLES[index % REVIEW_TITLES.length];
  return `${title}`;
}
function badgeFromIndex(index) {
  return REVIEW_BADGES[index % REVIEW_BADGES.length];
}
function noteFromIndex(index) {
  return REVIEW_NOTES[index % REVIEW_NOTES.length];
}

async function main() {
  if (!fs.existsSync(sourceDir)) throw new Error(`ไม่พบโฟลเดอร์รูปรีวิว: ${sourceDir}`);
  ensureDir(targetDir);
  clearTargetDir(targetDir);

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && IMAGE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'th', { numeric: true, sensitivity: 'base' }));

  const gallery = [];
  const seenHashes = new Map();
  const duplicates = [];
  for (const fileName of entries) {
    const sourcePath = path.join(sourceDir, fileName);
    const hash = fileHash(sourcePath);
    if (seenHashes.has(hash)) {
      duplicates.push({ sourceName: fileName, sameAs: seenHashes.get(hash), hash });
      continue;
    }
    seenHashes.set(hash, fileName);
    const index = gallery.length;
    const targetName = normalizeName(fileName);
    const targetPath = path.join(targetDir, targetName);
    fs.copyFileSync(sourcePath, targetPath);
    gallery.push({
      id: `review-${index + 1}`,
      image: `/uploads/review-gallery/${encodeURIComponent(targetName).replace(/%2F/g, '/')}`,
      title: titleFromFileName(fileName, index),
      note: noteFromIndex(index),
      badge: badgeFromIndex(index),
      sourceName: fileName,
      hash,
    });
  }
  const spotlightSet = new Set(spotlightIndexes(gallery.length, 5));
  gallery.forEach((item, index) => {
    item.spotlight = spotlightSet.has(index);
    item.spotlightRank = item.spotlight ? [...spotlightSet].indexOf(index) + 1 : 0;
  });

  fs.writeFileSync(targetJson, JSON.stringify({
    updatedAt: new Date().toISOString(),
    total: gallery.length,
    duplicatesRemoved: duplicates.length,
    duplicates,
    items: gallery,
  }, null, 2));

  console.log(JSON.stringify({ imported: gallery.length, duplicatesRemoved: duplicates.length, targetDir, targetJson }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
