// ════════════════════════ State ════════════════════════
let PRODUCTS = [];
const productById = (id) => PRODUCTS.find((p) => p.id === id);
const clientOrders = new Map(); // เก็บออเดอร์ที่เพิ่งสร้าง
let currentSessionId = '';       // ห้องแชตปัจจุบัน (ส่งไปผูกกับออเดอร์)

// ════════════════════════ Auth ════════════════════════
let authToken = localStorage.getItem('token') || '';
let adminAccessKey = localStorage.getItem('adminAccessKey') || '';
let currentUser = null;
function setAuth(token, user, adminKey = adminAccessKey) {
  authToken = token || ''; currentUser = user || null;
  if (token) localStorage.setItem('token', token); else localStorage.removeItem('token');
  adminAccessKey = adminKey || '';
  if (adminAccessKey) localStorage.setItem('adminAccessKey', adminAccessKey); else localStorage.removeItem('adminAccessKey');
  renderAccountNav();
}
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (authToken) headers.Authorization = 'Bearer ' + authToken;
  if (adminAccessKey) headers['X-Admin-Key'] = adminAccessKey;
  return fetch(path, { ...opts, headers });
}
async function loadMe() {
  if (!authToken) { currentUser = null; return; }
  try { const d = await (await api('/api/auth/me')).json(); currentUser = d.user; if (!currentUser) setAuth('', null); }
  catch { currentUser = null; }
}

// ── site branding (ตั้งค่าได้จากหลังบ้าน) ──
let SITE = {
  SITE_NAME: 'นุชฟอร์ไลฟ์', SITE_TAGLINE: 'นวัตกรรมเพื่อเกษตรกรไทย', SITE_ANNOUNCE: 'อาหารเสริมพืช · ฮอร์โมน · สารจับใบ · สมุนไพรสุขภาพ · จัดส่งทั่วไทย',
  SITE_HERO_TITLE: 'เพิ่มผลผลิต', SITE_HERO_ACCENT: 'อย่างแม่นยำ', SITE_HERO_TITLE2: 'ด้วยสูตรที่เหมาะกับพืช',
  SITE_HERO_SUB: 'ช่วยเกษตรกรเลือกสูตรที่ใช่ตามชนิดพืช ปัญหา และช่วงการเติบโต พร้อมจัดส่งไวและมีนักวิชาการให้คำแนะนำผ่าน LINE และ Live Chat',
  SITE_FOOTER: '© นุชฟอร์ไลฟ์ · ผลิตภัณฑ์เพื่อการเกษตรและสุขภาพ · จัดส่งทั่วไทย',
  SITE_TRUST_ITEMS: 'แนะนำสูตรตามพืชและช่วงการปลูกได้ชัดเจน\nมีฉลาก วิธีใช้ อัตราผสม และ FAQ ให้เปิดดูบนหน้าเว็บ\nปรึกษาทีมงานฟรีก่อนซื้อและตามต่อใน LINE ได้\nสั่งซื้อออนไลน์ ติดตามออเดอร์ และเช็กสถานะได้หลังชำระเงิน',
  SITE_CASE_STUDIES: 'สวนทุเรียนและมะม่วง :: ใช้หน้าเฉพาะพืชเพื่อพาลูกค้าจากโฆษณาไปยังสูตรที่ตรงกับปัญหาจริงของสวน\nทีมขายเกษตร :: เก็บชื่อ เบอร์ พืช จังหวัด และปัญหาของลูกค้าไว้โทรกลับและปิดต่อใน LINE ได้ง่าย\nหน้าสินค้าเกษตร :: ลูกค้าเห็นวิธีใช้ อัตราผสม คำเตือน และ FAQ ก่อนตัดสินใจสั่งซื้อ',
  SITE_CHECKOUT_POINTS: 'รองรับการชำระเงินผ่าน PromptPay และบัตรเครดิต\nลูกค้าทัก LINE หรือกรอกฟอร์มเพื่อขอคำแนะนำก่อนซื้อได้\nหลังสั่งซื้อสามารถติดตามสถานะออเดอร์และเลขพัสดุได้จากเว็บไซต์',
  SITE_CROP_LANDING_DATA: '',
  SITE_CALC_KNOWLEDGE: '',
  LINE_OA_URL: '', GA4_ID: '', META_PIXEL_ID: '', TIKTOK_PIXEL_ID: '',
};
const SITE_SYNC_KEY = 'site_sync_token';
const siteSyncChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('site_sync') : null;
const S = (k) => SITE[k] || '';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const HERO_RATIO_OPTIONS = ['wide', 'square', 'portrait', 'story'];
const HERO_FOCUS_OPTIONS = ['center', 'top', 'bottom', 'left', 'right'];
function normalizeRoute(path = '/') {
  const raw = String(path || '/').trim();
  if (!raw || raw === '#') return '/';
  const clean = raw.replace(/^#/, '');
  return clean.startsWith('/') ? clean : '/' + clean;
}
function routeHref(path = '/') {
  const normalized = normalizeRoute(path);
  return normalized.startsWith('/crops/') ? normalized : `/#${normalized}`;
}
function routePathFromHref(href = '') {
  if (!href) return '/';
  try {
    const url = new URL(href, location.origin);
    return url.hash ? normalizeRoute(url.hash) : normalizeRoute(url.pathname);
  } catch {
    return normalizeRoute(href);
  }
}
function go(path = '/') {
  history.pushState({}, '', routeHref(path));
  render();
}
async function loadSite() { try { SITE = { ...SITE, ...(await (await fetch('/api/site')).json()) }; } catch {} }
function setMeta(selector, value = '') { const el = document.querySelector(selector); if (el) el.setAttribute('content', value || ''); }
function setPageMeta(title, desc, image = '') {
  const fullTitle = title ? `${title} | ${S('SITE_NAME')}` : `${S('SITE_NAME')} — ${S('SITE_TAGLINE')}`;
  const description = desc || `${S('SITE_NAME')} — ${S('SITE_HERO_SUB') || S('SITE_ANNOUNCE') || S('SITE_TAGLINE')}`;
  const socialImage = image || '/icon.svg';
  document.title = fullTitle;
  setMeta('meta[name="description"]', description);
  setMeta('meta[property="og:title"]', fullTitle);
  setMeta('meta[property="og:description"]', description);
  setMeta('meta[property="og:image"]', socialImage);
  setMeta('meta[name="twitter:title"]', fullTitle);
  setMeta('meta[name="twitter:description"]', description);
  setMeta('meta[name="twitter:image"]', socialImage);
}
function applySite() {
  marketingReady = false;
  setPageMeta('', '');
  document.querySelectorAll('.brand').forEach((b) => {
    const dot = b.querySelector('.brand-dot') ? '<span class="brand-dot"></span>' : '';
    b.innerHTML = dot + esc(S('SITE_NAME'));
  });
  const f = document.querySelector('.site-footer p'); if (f) f.textContent = S('SITE_FOOTER');
  initMarketing();
}
const SEGMENT_INFO = {
  agri: { label: 'เกษตร', title: 'สินค้าเกษตร', desc: 'อาหารเสริมพืช ฮอร์โมน สารจับใบ และโซลูชันสำหรับการเพาะปลูก' },
  lifestyle: { label: 'สุขภาพ/ความงาม', title: 'สุขภาพและความงาม', desc: 'ผลิตภัณฑ์เพื่อสุขภาพ สมุนไพร และความงามจากแบรนด์เดียวกัน' },
};
const DEFAULT_CROP_LANDING = {
  durian: {
    crop: 'ทุเรียน',
    hero: 'สูตรแนะนำสำหรับทุเรียน ตั้งแต่เร่งใบจนถึงบำรุงผล',
    problem: 'ช่วยวางลำดับการใช้สูตรในช่วงแตกใบ ออกดอก ติดผล และลดความเครียดของต้น',
    tip: 'เหมาะกับการทำแคมเปญยิงแอดและเก็บลีดลูกค้ากลุ่มสวนทุเรียน',
    offer: ['แยกข้อความยิงแอดตามช่วงใบ ดอก และผล', 'เก็บลีดลูกค้ากลุ่มสวนทุเรียนเข้า LINE ได้ทันที', 'มีสินค้าแนะนำพร้อมอัตราผสมและวิธีใช้'],
    painPoints: ['ใบไม่แตกสม่ำเสมอหรือแตกแล้วต้นอ่อนแรง', 'ช่วงดอกและผลอ่อนต้องการสูตรที่ไม่หนักเกินไป', 'อากาศแปรปรวนทำให้ต้นเครียดและผลร่วงง่าย'],
    stages: [
      { title: 'ฟื้นต้นและเร่งใบ', detail: 'เริ่มจากสูตรเร่งโครงสร้างต้นและช่วยให้ต้นแข็งแรงก่อนเข้าสะสมอาหาร', ids: ['p1', 'p3'] },
      { title: 'ดูแลช่วงดอกและผลอ่อน', detail: 'คุมความสมบูรณ์ของดอกและลดความเครียดของต้นในช่วงอากาศไม่นิ่ง', ids: ['p3', 'p4'] },
      { title: 'บำรุงผลและเพิ่มคุณภาพ', detail: 'ต่อยอดด้วยสูตรเพิ่มคุณภาพผลและสารจับใบเพื่อให้การฉีดพ่นคุ้มขึ้น', ids: ['p2', 'p7'] },
    ],
    proofTitle: 'เหมาะกับการยิงแอดแบบเฉพาะพืช',
    proofBody: 'คุณสามารถใช้หน้านี้ยิงแอดคำว่า ทุเรียน ใบ ดอก ผล หรือปัญหาผลร่วง แล้วดึงลูกค้าไปปิดการขายต่อใน LINE ได้ตรงกลุ่มกว่าเดิม',
    faq: faqPairs(
      ['ถ้าลูกค้ายังไม่แน่ใจว่าต้องใช้ตัวไหนก่อน?', 'ให้ลูกค้ากรอกฟอร์มพร้อมบอกช่วงการปลูกและอาการ ทีมงานจะช่วยจัดลำดับสูตรให้เหมาะกับต้นและช่วงเวลา'],
      ['หน้านี้ใช้ทำ SEO ได้อย่างไร?', 'สามารถใส่รูปสวนจริง รีวิวจริง และขยายคีย์เวิร์ดตามปัญหาของทุเรียนเพื่อเพิ่มทราฟฟิกจาก Google ได้']
    ),
    related: ['p1', 'p2', 'p3', 'p7'],
  },
  mango: {
    crop: 'มะม่วง',
    hero: 'หน้าโซลูชันมะม่วงสำหรับเร่งดอก บำรุงผล และจัดการความสมบูรณ์ของต้น',
    problem: 'รวมสูตรที่เหมาะกับการแตกใบสะสมอาหาร ช่วงติดผล และเพิ่มคุณภาพผลผลิต',
    tip: 'ใช้เป็น landing page เฉพาะกลุ่มลูกค้ามะม่วงได้ดีทั้ง SEO และ conversion',
    offer: ['โฟกัสข้อความขายเรื่องเร่งดอกและบำรุงผล', 'มี CTA ให้ขอคำแนะนำก่อนซื้อทันที', 'เหมาะกับการทำคอนเทนต์คู่กับรีวิวสวนจริง'],
    painPoints: ['แตกใบไม่พร้อมก่อนเข้าสะสมอาหาร', 'ติดผลแล้วต้องการบำรุงให้ผลสมบูรณ์ สีสวย ผิวดี', 'สภาพอากาศแกว่งทำให้ต้นเครียดและผลคุณภาพไม่สม่ำเสมอ'],
    stages: [
      { title: 'สะสมอาหารและเร่งความพร้อม', detail: 'ใช้สูตรช่วยสร้างความสมบูรณ์ของต้นก่อนเข้าสู่ช่วงทำดอก', ids: ['p1', 'p3'] },
      { title: 'เร่งดอกและดูแลใบ', detail: 'คุมความสมดุลของต้นและช่วยให้การออกดอกสม่ำเสมอมากขึ้น', ids: ['p3', 'p4'] },
      { title: 'บำรุงผลและเพิ่มคุณภาพผิว', detail: 'ใช้สูตรบำรุงผลต่อเนื่องเพื่อยกระดับขนาด สี และคุณภาพผลผลิต', ids: ['p2', 'p6'] },
    ],
    proofTitle: 'ใช้ได้ทั้งสายสวนและตัวแทนจำหน่าย',
    proofBody: 'หน้าเดียวสามารถตอบได้ทั้งคำถามเรื่องเร่งดอก บำรุงผล และการขอคำแนะนำสูตรเฉพาะแปลง ช่วยให้ปิดการขายได้เร็วขึ้น',
    faq: faqPairs(
      ['ถ้าลูกค้าปลูกมะม่วงหลายช่วงอายุ ใช้หน้าเดียวพอไหม?', 'ใช้ได้ โดยฟอร์มจะช่วยให้ทีมขายแยกคำแนะนำตามช่วงอายุและปัญหาของแต่ละสวน'],
      ['ควรมีอะไรเพิ่มเพื่อให้หน้าแปลงขายดี?', 'ควรใส่รูปผลผลิตจริง รีวิวสวนจริง และข้อความเปรียบเทียบช่วงก่อน-หลังการใช้สูตร']
    ),
    related: ['p1', 'p2', 'p3', 'p6'],
  },
  rice: {
    crop: 'ข้าว',
    hero: 'โซลูชันข้าวสำหรับเร่งแตกกอ เสริมความแข็งแรง และลดความเครียดของต้น',
    problem: 'เน้นสูตรช่วยให้ต้นสมบูรณ์ แตกกอดี และฟื้นต้นหลังสภาพอากาศไม่เอื้ออำนวย',
    tip: 'เหมาะกับการยิงแอดตามฤดูกาลเพาะปลูกและคอนเทนต์ให้ความรู้',
    offer: ['ใช้ทำแคมเปญตามฤดูนาปีและนาปรังได้', 'สื่อสารเรื่องแตกกอและฟื้นต้นได้ชัด', 'เหมาะกับคอนเทนต์ให้ความรู้และเก็บลีดเกษตรกร'],
    painPoints: ['ต้นไม่สมบูรณ์ แตกกอน้อย หรือโตช้า', 'หลังฝนหนักหรือแดดจัดต้นเกิดความเครียด', 'ต้องการลดความสิ้นเปลืองจากการฉีดพ่นหลายรอบ'],
    stages: [
      { title: 'เริ่มต้นแตกกอ', detail: 'ช่วยให้ต้นตั้งตัวดีและเร่งการเจริญเติบโตในช่วงเริ่มต้น', ids: ['p1', 'p3'] },
      { title: 'เสริมความแข็งแรง', detail: 'ดูแลต้นให้ทนต่อความแปรปรวนและลดอาการเครียดช่วงกลางฤดู', ids: ['p3'] },
      { title: 'เพิ่มประสิทธิภาพการพ่น', detail: 'ใช้ร่วมกับสารจับใบเพื่อลดการชะล้างและทำให้การพ่นคุ้มค่ามากขึ้น', ids: ['p7'] },
    ],
    proofTitle: 'เหมาะกับคอนเทนต์เชิงปัญหาและตามฤดูกาล',
    proofBody: 'หน้าข้าวเหมาะกับการวางคีย์เวิร์ดอย่าง แตกกอ โตช้า ฟื้นต้น หลังฝน และใช้ต่อกับบทความความรู้เพื่อดึงทราฟฟิกได้ดี',
    faq: faqPairs(
      ['ถ้าลูกค้าไม่รู้ว่าควรเริ่มที่สูตรไหน?', 'ให้เลือกปัญหาหลัก เช่น แตกกอน้อยหรือฟื้นต้น แล้วทีมงานจะช่วยจัดโปรแกรมให้ตามช่วงการปลูก'],
      ['หน้านี้เหมาะกับการยิงแอดแบบไหน?', 'เหมาะกับแคมเปญที่ยิงตามฤดูกาลและข้อความเชิงแก้ปัญหา เช่น เร่งแตกกอหรือฟื้นต้นหลังฝน']
    ),
    related: ['p1', 'p3', 'p7'],
  },
  vegetables: {
    crop: 'พืชผัก',
    hero: 'สูตรพืชผักสำหรับเร่งใบ เพิ่มคุณภาพ และจัดการการฉีดพ่นให้คุ้มค่ามากขึ้น',
    problem: 'เหมาะกับการตลาดเชิงแก้ปัญหา เช่น ใบไม่เขียว โตช้า หรือหน้าฝนฉีดพ่นไม่คุ้ม',
    tip: 'ใช้ต่อยอดทำหน้าเฉพาะพืชผักใบ ผักผล และแปลงปลูกเชิงการค้าได้',
    offer: ['เหมาะกับกลุ่มผักใบ ผักผล และแปลงการค้า', 'ใช้ข้อความแก้ปัญหา โตช้า ใบไม่เขียว ได้ชัด', 'ดึงลูกค้าจากโฆษณาไปเข้า LINE และปิดการขายต่อได้ง่าย'],
    painPoints: ['พืชผักโตช้า ใบไม่เขียว หรือคุณภาพผลผลิตไม่สม่ำเสมอ', 'ต้องการฉีดพ่นให้คุ้มในช่วงฝนหรือสภาพอากาศแปรปรวน', 'ต้องการสูตรที่เข้าใจง่ายและใช้งานไว'],
    stages: [
      { title: 'เร่งใบและโครงสร้างต้น', detail: 'ใช้สูตรที่ช่วยผลักการเจริญเติบโตและเพิ่มความสมบูรณ์ของใบ', ids: ['p1'] },
      { title: 'เพิ่มคุณภาพและความสม่ำเสมอ', detail: 'ต่อยอดด้วยสูตรเสริมคุณภาพสำหรับผักผลหรือแปลงที่ต้องการคุณภาพสวย', ids: ['p2', 'p4'] },
      { title: 'ช่วยให้การพ่นคุ้มขึ้น', detail: 'ใช้สารจับใบในช่วงฝนหรือเมื่อต้องการเพิ่มประสิทธิภาพการเกาะติด', ids: ['p7'] },
    ],
    proofTitle: 'หน้าเดียวตอบได้ทั้ง SEO และ Conversion',
    proofBody: 'หน้า landing สำหรับพืชผักช่วยรวมคำถามยอดฮิตที่คนค้นหาบ่อย เช่น เร่งใบ ผักโตช้า ใบซีด และพาไปสู่การขอคำแนะนำได้ทันที',
    faq: faqPairs(
      ['ใช้ได้ทั้งผักใบและผักผลไหม?', 'ใช้ได้ โดยทีมงานจะช่วยจัดสูตรและจังหวะการใช้ให้เหมาะกับชนิดพืชและระยะปลูก'],
      ['ถ้าต้องการยิงแอดหลายข้อความ ควรทำอย่างไร?', 'สามารถแยกครีเอทีฟตามปัญหา เช่น โตช้า ใบไม่เขียว หรือฝนชะล้าง แล้วใช้หน้าพืชผักนี้เป็นหน้าเก็บลีดหลัก']
    ),
    related: ['p1', 'p2', 'p4', 'p7'],
  },
};
function asArray(v) { return Array.isArray(v) ? v.filter(Boolean) : []; }
function splitLines(v) { return String(v || '').split('\n').map((x) => x.trim()).filter(Boolean); }
function splitCsv(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
function splitPairs(v) {
  return splitLines(v).map((line) => {
    const idx = line.indexOf('::');
    if (idx === -1) return null;
    return { title: line.slice(0, idx).trim(), detail: line.slice(idx + 2).trim() };
  }).filter((item) => item && item.title && item.detail);
}
function faqPairs(...items) { return items.map(([q, a]) => ({ q, a })); }
function heroRatioValue(value = '') {
  const ratio = String(value || '').trim().toLowerCase();
  return HERO_RATIO_OPTIONS.includes(ratio) ? ratio : 'wide';
}
function heroFocusValue(value = '') {
  const focus = String(value || '').trim().toLowerCase();
  return HERO_FOCUS_OPTIONS.includes(focus) ? focus : 'center';
}
function heroFocusObjectPosition(value = '') {
  const focus = heroFocusValue(value);
  return ({
    center: '50% 50%',
    top: '50% 18%',
    bottom: '50% 82%',
    left: '24% 50%',
    right: '76% 50%',
  })[focus] || '50% 50%';
}
function normalizeLocalAssetUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^https?:\/\/localhost:3005(?=\/)/i, '')
    .replace(/^https?:\/\/127\.0\.0\.1:3005(?=\/)/i, '');
}
let lastCropPreviewSignature = '';
function normalizeCropLandingMediaItem(item = {}) {
  return {
    image: normalizeLocalAssetUrl(item?.image || ''),
    title: String(item?.title || '').trim(),
    note: String(item?.note || '').trim(),
  };
}
function normalizeCropLandingEntry(slug, entry = {}) {
  const rawEnabled = entry?.enabled;
  const sortOrder = parseInt(entry?.sortOrder ?? entry?.sort ?? '0', 10) || 0;
  return {
    slug: String(slug || '').trim(),
    crop: String(entry.crop || '').trim(),
    enabled: !(rawEnabled === false || String(rawEnabled || '').trim() === '0' || String(rawEnabled || '').trim().toLowerCase() === 'false'),
    sortOrder,
    seoTitle: String(entry.seoTitle || '').trim(),
    seoDescription: String(entry.seoDescription || '').trim(),
    seoImage: normalizeLocalAssetUrl(entry.seoImage || ''),
    hero: String(entry.hero || '').trim(),
    heroImage: normalizeLocalAssetUrl(entry.heroImage || entry.image || ''),
    heroRatio: heroRatioValue(entry.heroRatio),
    heroFocus: heroFocusValue(entry.heroFocus),
    problem: String(entry.problem || '').trim(),
    tip: String(entry.tip || '').trim(),
    offer: asArray(entry.offer).map((item) => String(item || '').trim()).filter(Boolean),
    painPoints: asArray(entry.painPoints).map((item) => String(item || '').trim()).filter(Boolean),
    gallery: asArray(entry.gallery).map((item) => normalizeCropLandingMediaItem(item)).filter((item) => item.image || item.title || item.note),
    stages: asArray(entry.stages).map((stage) => ({
      title: String(stage?.title || '').trim(),
      detail: String(stage?.detail || '').trim(),
      ids: asArray(stage?.ids).map((id) => String(id || '').trim()).filter(Boolean),
    })).filter((stage) => stage.title && stage.detail),
    proofTitle: String(entry.proofTitle || '').trim(),
    proofBody: String(entry.proofBody || '').trim(),
    faq: asArray(entry.faq).map((item) => ({
      q: String(item?.q || '').trim(),
      a: String(item?.a || '').trim(),
    })).filter((item) => item.q && item.a),
    related: asArray(entry.related).map((id) => String(id || '').trim()).filter(Boolean),
    reviews: asArray(entry.reviews).map((item) => normalizeCropLandingMediaItem(item)).filter((item) => item.image || item.title || item.note),
  };
}
function cropLandingMap() {
  const raw = String(S('SITE_CROP_LANDING_DATA') || '').trim();
  const map = cropLandingMapFromRaw(raw);
  const previewMode = new URLSearchParams(location.search).get('preview') === '1';
  if (previewMode) {
    try {
      const draft = JSON.parse(localStorage.getItem('cropLandingPreviewDraft') || '{}');
      const preview = normalizeCropLandingEntry(draft.slug || '', draft);
      if (preview.slug && preview.crop) map[preview.slug] = preview;
    } catch {}
  }
  return Object.fromEntries(Object.entries(map)
    .filter(([, entry]) => previewMode || entry.enabled !== false)
    .sort((a, b) => (a[1].sortOrder || 0) - (b[1].sortOrder || 0) || String(a[1].crop || '').localeCompare(String(b[1].crop || ''), 'th')));
}
function cropLandingMapFromRaw(raw = '') {
  const normalizedRaw = String(raw || '').trim();
  if (!normalizedRaw) return Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  try {
    const parsed = JSON.parse(normalizedRaw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const entries = Object.entries(parsed).map(([slug, entry]) => {
      const normalized = normalizeCropLandingEntry(slug, entry);
      return normalized.slug && normalized.crop ? [normalized.slug, normalized] : null;
    }).filter(Boolean);
    return entries.length ? Object.fromEntries(entries) : Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  } catch {
    return Object.fromEntries(Object.entries(DEFAULT_CROP_LANDING).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)]));
  }
}
function cropSlugMap() {
  return Object.fromEntries(Object.entries(cropLandingMap()).map(([slug, cfg]) => [cfg.crop, slug]));
}
function cropGuideMap() {
  const map = {};
  Object.values(cropLandingMap()).forEach((entry) => {
    if (!entry.crop) return;
    map[entry.crop] = { ids: entry.related, tip: entry.tip || entry.problem || '' };
  });
  return map;
}
function serializeCropLandingMap(map) {
  return JSON.stringify(Object.fromEntries(Object.entries(map).map(([slug, entry]) => [slug, normalizeCropLandingEntry(slug, entry)])));
}
function sortCropLandingEntries(entries = []) {
  return [...entries].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.crop || '').localeCompare(String(b.crop || ''), 'th'));
}
const DEFAULT_TRUST_ITEMS = [
  'เลือกสูตรตามพืชและช่วงการปลูกได้',
  'มีข้อมูลฉลาก วิธีใช้ อัตราผสม และคำเตือน',
  'เก็บลีดจากเว็บไซต์แล้วติดตามต่อใน LINE ได้',
  'จัดส่งทั่วไทยและติดตามออเดอร์ได้หลังซื้อ',
];
const DEFAULT_CASE_STUDIES = [
  { title: 'สวนทุเรียน', detail: 'ทำหน้าเฉพาะพืชเพื่อยิงแอดและเก็บลูกค้ากลุ่มสวนทุเรียนได้ตรงขึ้น' },
  { title: 'ทีมขายเกษตร', detail: 'เก็บชื่อ เบอร์ พืช ปัญหา จังหวัด และพื้นที่ปลูก เพื่อโทรกลับได้ง่ายขึ้น' },
  { title: 'ร้านค้าออนไลน์', detail: 'ลูกค้ากดซื้อผ่านเว็บได้ทันที พร้อมวัดผลจาก Pixel และ Analytics' },
];
const DEFAULT_CHECKOUT_POINTS = [
  'ชำระเงินได้ทั้ง PromptPay และบัตรเครดิต',
  'มีทีมงานช่วยตอบคำถามก่อนและหลังสั่งซื้อ',
  'ติดตามออเดอร์และเลขพัสดุได้จากหน้าเว็บไซต์',
];
function settingLines(key, fallback = []) {
  const items = splitLines(S(key));
  return items.length ? items : fallback;
}
function settingPairs(key, fallback = []) {
  const items = splitPairs(S(key));
  return items.length ? items : fallback;
}
function productSegment(p) {
  const tag = String(p?.tag || '').trim();
  if (p?.segment === 'lifestyle') return 'lifestyle';
  if (p?.segment === 'agri') return ['สุขภาพ', 'ความงาม'].includes(tag) ? 'lifestyle' : 'agri';
  return tag === 'เกษตร' ? 'agri' : 'lifestyle';
}
function defaultAgriExtra(p) {
  const method = p?.specs?.['วิธีใช้'] || 'ฉีดพ่นทางใบ';
  const dosage = p?.specs?.['อัตรา'] || '20-30 ซีซี ต่อน้ำ 20 ลิตร';
  return {
    cropTargets: [],
    registrationNo: 'รออัปเดตเลขทะเบียน',
    labelUrl: '',
    labelNote: 'ควรอ่านฉลากและคำแนะนำก่อนใช้ทุกครั้ง',
    applicationMethod: method,
    dosage,
    usageSteps: ['เขย่าหรือคนผลิตภัณฑ์ก่อนใช้', 'ผสมน้ำสะอาดตามอัตราแนะนำ', 'ฉีดพ่นช่วงเช้าหรือเย็นและสังเกตการตอบสนองของพืช'],
    warnings: ['เก็บให้พ้นมือเด็ก', 'หลีกเลี่ยงการใช้เกินอัตราที่แนะนำ', 'ควรทดสอบในพื้นที่เล็กก่อนใช้จริงทั้งแปลง'],
    faq: faqPairs(
      ['ใช้ร่วมกับสารจับใบได้ไหม?', 'ใช้ได้ โดยควรผสมตามลำดับและอัตราที่เหมาะสมก่อนฉีดพ่นจริง'],
      ['ควรฉีดช่วงเวลาไหน?', 'แนะนำช่วงเช้าหรือเย็น หลีกเลี่ยงแดดจัดและฝนที่อาจชะล้างผลิตภัณฑ์']
    ),
  };
}
function defaultLifestyleExtra() {
  return { labelUrl: '', faq: [] };
}
function productExtra(p) {
  const extra = (p && typeof p.extra === 'object' && p.extra) ? p.extra : {};
  if (productSegment(p) === 'agri') {
    const base = defaultAgriExtra(p);
    return {
      ...base,
      ...extra,
      cropTargets: asArray(extra.cropTargets).length ? asArray(extra.cropTargets) : base.cropTargets,
      usageSteps: asArray(extra.usageSteps).length ? asArray(extra.usageSteps) : base.usageSteps,
      warnings: asArray(extra.warnings).length ? asArray(extra.warnings) : base.warnings,
      faq: Array.isArray(extra.faq) && extra.faq.length ? extra.faq : base.faq,
    };
  }
  return { ...defaultLifestyleExtra(), ...extra };
}

const CALC_RESEARCH_LIBRARY = [
  {
    match: /นุชฟอร์ไลฟ์ 1$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงราก ต้น ใบ และเร่งโครงสร้างพืช',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 1”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะช่วงเร่งใบ แตกยอด และฟื้นต้น', 'เริ่มที่อัตราต่ำก่อนถ้าเป็นต้นอ่อนหรือพ่นครั้งแรก'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 2$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงดอก ผล สี รสชาติ และน้ำหนัก',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 2”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะช่วงติดผลถึงก่อนเก็บเกี่ยว', 'เลือกโหมดเข้มขึ้นได้เมื่อแปลงใหญ่และต้องการคุมคุณภาพผล'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 8$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'เสริมความแข็งแรง ลดเครียด ลดดอกและผลร่วง',
    interval: 'ใช้ก่อนหรือระหว่างช่วงอากาศแปรปรวน',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 8”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะใช้ช่วงร้อนจัด ฝนสลับแดด หรือฟื้นต้นหลังเครียด', 'ช่วยดูแลใบเหลือง ใบแก้ว และการชะงักการเจริญเติบโต'],
  },
  {
    match: /นุชฟอร์ไลฟ์ 9$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'ดูแลอาการใบจุด สนิม และความสมบูรณ์ของดอก',
    interval: 'ทุก 7-10 วัน หรือถี่ขึ้นตามอาการและคำแนะนำหน้างาน',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” และหน้าสินค้า “นุชฟอร์ไลฟ์ 9”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['ใช้ได้กับพืชทุกชนิดและทุกระยะตามข้อมูลเว็บไซต์แบรนด์', 'ถ้ามีอาการรุนแรงควรให้ทีมงานช่วยดูอาการร่วมด้วย'],
  },
  {
    match: /เน็ก-1$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงยอด ใบอ่อน และโครงสร้างช่วงเร่งต้น',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'อ้างอิงเรทกลางจากหน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” ของแบรนด์',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เหมาะกับช่วงเร่งยอดและบำรุงใบ', 'ควรเริ่มที่อัตราต่ำก่อนถ้ายังไม่มีฉลากอยู่ในมือ'],
  },
  {
    match: /เน็ก-2$/i,
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'บำรุงผล ยอด และผิวผล พร้อมดูแลผลแตก',
    interval: 'ทุก 5-7 วันตามข้อมูลหน้า “นุชฟอร์ไลฟ์ เน็ก-2”',
    sourceLabel: 'หน้า “นุชฟอร์ไลฟ์ เน็ก-2” และหน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์”',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%e0%b8%b7next2/',
    points: ['เหมาะกับช่วงบำรุงผลและดอกสมบูรณ์', 'เว็บไซต์แบรนด์ระบุรอบพ่น 5-7 วันตามชนิดพืช'],
  },
];
function normalizeCalcText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}
function parseRateText(raw = '') {
  const s = String(raw || '').replace(/,/g, '').trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?\s*ซีซี[\s\S]*?(\d+(?:\.\d+)?)\s*ลิตร/i);
  if (!m) return null;
  return {
    min: +m[1],
    max: m[2] ? +m[2] : +m[1],
    per: +m[3],
    raw: s,
  };
}
function researchRateProfile(p) {
  const name = normalizeCalcText(p?.name);
  if (!name) return null;
  const matched = CALC_RESEARCH_LIBRARY.find((item) => item.match.test(name));
  if (!matched && !(productSegment(p) === 'agri' && !/จับใบ|108/.test(name))) return null;
  const rule = matched || {
    rateRaw: '5 ซีซี ต่อน้ำ 20 ลิตร',
    title: 'อัตราเริ่มต้นสำหรับผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์',
    interval: 'ทุก 7-10 วันตามความเหมาะสม',
    sourceLabel: 'หน้า “ผลิตภัณฑ์เกษตรนุชฟอร์ไลฟ์” ของแบรนด์',
    sourceUrl: 'https://nuchforlife.co.th/mainpage/%E0%B8%AA%E0%B8%B4%E0%B8%99%E0%B8%84%E0%B9%89%E0%B8%B2%E0%B8%99%E0%B8%B8%E0%B8%8A%E0%B8%9F%E0%B8%AD%E0%B8%A3%E0%B9%8C%E0%B9%84%E0%B8%A5%E0%B8%9F%E0%B9%8C/',
    points: ['เว็บไซต์แบรนด์ระบุว่าใช้เพียง 5 ซีซี ต่อน้ำ 20 ลิตร และใช้ได้กับพืชทุกชนิด', 'ถ้ามีฉลากขวดจริงอยู่ในมือ ให้ยึดตามฉลากก่อนเสมอ'],
  };
  const rate = parseRateText(rule.rateRaw);
  return rate ? { ...rule, rate } : null;
}
function productRateProfile(p) {
  const extra = productExtra(p);
  const raw = String(extra.dosage || p?.specs?.['อัตรา'] || p?.specs?.['อัตราการใช้'] || '').trim();
  const specRate = parseRateText(raw);
  const research = researchRateProfile(p);
  const selectedRate = research?.rate || specRate;
  if (!selectedRate) return null;
  const stickerProduct = PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
  const stickerRaw = String(productExtra(stickerProduct).dosage || stickerProduct?.specs?.['อัตรา'] || '').trim();
  return {
    raw,
    specRate,
    research,
    selectedRate,
    basis: research?.rate ? 'research' : 'spec',
    stickerProduct,
    stickerRate: stickerProduct ? parseRateText(stickerRaw) : null,
  };
}
function parseRate(p) {
  return productRateProfile(p)?.selectedRate || null;
}
function fmtCalcNumber(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function calcDoseValues(rate, liters) {
  const totalLiters = Math.max(0, Number(liters || 0));
  const factor = totalLiters / rate.per;
  return {
    min: factor * rate.min,
    max: factor * rate.max,
  };
}
function doseByStrength(rate, liters, strength = 'mid') {
  const values = calcDoseValues(rate, liters);
  if (strength === 'low') return values.min;
  if (strength === 'high') return values.max;
  return values.min === values.max ? values.min : ((values.min + values.max) / 2);
}
function calcResult(rate, tank, strength = 'mid') {
  const values = calcDoseValues(rate, tank);
  const picked = doseByStrength(rate, tank, strength);
  if (values.min === values.max) return `${fmtCalcNumber(picked)} ซีซี`;
  return `${fmtCalcNumber(values.min)}–${fmtCalcNumber(values.max)} ซีซี`;
}
function parsePackSizes(p) {
  const bag = new Set();
  const text = [p?.name, p?.desc, JSON.stringify(p?.specs || {}), JSON.stringify(productExtra(p) || {})].join(' ');
  String(text).replace(/(\d+(?:\.\d+)?)\s*(?:ซีซี|cc|CC|มล\.|มล)/g, (_, n) => {
    const size = Number(n);
    if (size > 0 && size <= 5000) bag.add(size);
    return _;
  });
  return [...bag].sort((a, b) => a - b);
}
function defaultWaterPerRai(p) {
  const crops = productCrops(p);
  if (crops.includes('ข้าว')) return 30;
  if (crops.includes('พืชผัก')) return 60;
  if (crops.includes('ทุเรียน') || crops.includes('มะม่วง')) return 80;
  return 60;
}
const DEFAULT_CALC_KNOWLEDGE = {
  crops: {
    'ทุเรียน': {
      waterPerRai: 90,
      mixes: [
        { key: 'durian-growth', stage: 'แตกใบ', title: 'เร่งใบ ฟื้นต้น', ids: ['p1', 'p3'], note: 'เหมาะกับช่วงเร่งใบ ฟื้นต้นหลังเครียด หรือหลังเก็บเกี่ยว' },
        { key: 'durian-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมต้น', ids: ['p1', 'p4'], note: 'ช่วยพยุงความสมบูรณ์ของใบและต้นในช่วงเตรียมสะสมอาหาร' },
        { key: 'durian-fruit', stage: 'ติดผล', title: 'บำรุงผล ลดร่วง', ids: ['p2', 'p3'], note: 'เหมาะกับช่วงติดผลและดูแลผลร่วงจากสภาพอากาศ' },
      ],
    },
    'มะม่วง': {
      waterPerRai: 80,
      mixes: [
        { key: 'mango-growth', stage: 'แตกใบ', title: 'บำรุงใบ เร่งยอด', ids: ['p1', 'p3'], note: 'ใช้ช่วงบำรุงทรงพุ่มและเร่งความสมบูรณ์ของต้น' },
        { key: 'mango-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมดอก', ids: ['p1', 'p4'], note: 'ใช้ก่อนเข้าช่วงสร้างตาดอกหรือช่วงเตรียมต้น' },
        { key: 'mango-fruit', stage: 'ติดผล', title: 'บำรุงผล คุณภาพผล', ids: ['p2', 'p6'], note: 'ช่วยเรื่องผลสมบูรณ์ ขนาด และคุณภาพผล' },
      ],
    },
    'ข้าว': {
      waterPerRai: 30,
      mixes: [
        { key: 'rice-growth', stage: 'แตกใบ', title: 'แตกกอ ฟื้นต้น', ids: ['p1', 'p3'], note: 'ใช้ช่วงแตกกอหรือฟื้นต้นจากความเครียด' },
        { key: 'rice-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร สมดุลต้น', ids: ['p1', 'p4'], note: 'ใช้ช่วงตั้งท้องหรือช่วงที่ต้องการสะสมอาหารและคุมความสมดุลของต้น' },
        { key: 'rice-balance', stage: 'ติดผล', title: 'สมดุลต้น ลดเครียด', ids: ['p3', 'p4'], note: 'ดูแลช่วงอากาศแปรปรวนและต้นเริ่มอ่อนแรง' },
      ],
    },
    'พืชผัก': {
      waterPerRai: 60,
      mixes: [
        { key: 'veg-leaf', stage: 'แตกใบ', title: 'เร่งใบ เขียวไว', ids: ['p1', 'p3'], note: 'เหมาะกับผักใบและแปลงที่ต้องการฟื้นความเขียว' },
        { key: 'veg-build', stage: 'สะสมอาหาร', title: 'สะสมอาหาร เตรียมดอก', ids: ['p1', 'p4'], note: 'ช่วยพยุงต้นให้พร้อมก่อนเข้าระยะให้ผลผลิต' },
        { key: 'veg-fruit', stage: 'ติดผล', title: 'บำรุงดอก ผล และผิว', ids: ['p2', 'p4'], note: 'เหมาะกับผักผลและช่วงติดดอกติดผล' },
      ],
    },
  },
  products: {
    p1: { label: 'เร่งใบและโครงสร้างต้น', preferredStrength: 'mid' },
    p2: { label: 'บำรุงดอกผล สี รสชาติ น้ำหนัก', preferredStrength: 'mid' },
    p3: { label: 'ลดเครียด เสริมความแข็งแรง', preferredStrength: 'mid' },
    p4: { label: 'ดูแลใบและดอก', preferredStrength: 'mid' },
    p5: { label: 'เร่งยอดและบำรุงใบ', preferredStrength: 'mid' },
    p6: { label: 'บำรุงผลและผิวผล', preferredStrength: 'mid' },
    p7: { label: 'ช่วยการเกาะใบและลดการชะล้าง', preferredStrength: 'low' },
  },
};
const DEFAULT_CALC_PROBLEM_PRESETS = {
  'ทุเรียน': [
    { key: 'durian-leaf-yellow', label: 'ใบเหลือง / แตกใบไม่สม่ำเสมอ', stage: 'แตกใบ', preset: 'durian-growth', note: 'เหมาะเมื่ออยากเริ่มจากสูตรฟื้นต้นและดันใบให้สม่ำเสมอขึ้น' },
    { key: 'durian-slow-build', label: 'ต้นอ่อนแรง / โตช้า', stage: 'สะสมอาหาร', preset: 'durian-build', note: 'เหมาะกับแปลงที่ต้องการพยุงต้นและสะสมอาหารก่อนเข้าระยะสำคัญ' },
    { key: 'durian-fruit-drop', label: 'ผลร่วง / ผลไม่สมบูรณ์', stage: 'ติดผล', preset: 'durian-fruit', note: 'เหมาะกับช่วงประคองผลและดูแลผลร่วงจากสภาพอากาศ' },
  ],
  'มะม่วง': [
    { key: 'mango-leaf-yellow', label: 'ใบซีด / พุ่มไม่สมบูรณ์', stage: 'แตกใบ', preset: 'mango-growth', note: 'เหมาะกับการเริ่มฟื้นทรงพุ่มและเร่งความสมบูรณ์ของใบ' },
    { key: 'mango-slow-build', label: 'สะสมอาหารไม่ดี / เตรียมดอกช้า', stage: 'สะสมอาหาร', preset: 'mango-build', note: 'เหมาะกับช่วงเตรียมต้นก่อนทำดอกหรือก่อนเข้าระยะสำคัญ' },
    { key: 'mango-fruit-drop', label: 'ผลเล็ก / คุณภาพผลไม่สม่ำเสมอ', stage: 'ติดผล', preset: 'mango-fruit', note: 'เหมาะกับการบำรุงผลและยกระดับคุณภาพผิวผล' },
  ],
  'ข้าว': [
    { key: 'rice-yellow', label: 'ใบเหลือง / แตกกอน้อย', stage: 'แตกใบ', preset: 'rice-growth', note: 'เหมาะกับช่วงเริ่มต้นที่ต้องการเร่งการแตกกอและฟื้นต้น' },
    { key: 'rice-slow', label: 'โตช้า / ต้นไม่สมบูรณ์', stage: 'สะสมอาหาร', preset: 'rice-build', note: 'เหมาะกับช่วงต้องการพยุงความสมบูรณ์ของต้นและสะสมอาหาร' },
    { key: 'rice-stress', label: 'เครียดจากอากาศ / ทรงต้นไม่สมดุล', stage: 'ติดผล', preset: 'rice-balance', note: 'เหมาะกับช่วงอากาศแปรปรวนและต้นเริ่มอ่อนแรง' },
  ],
  'พืชผัก': [
    { key: 'veg-yellow', label: 'ใบไม่เขียว / แตกใบช้า', stage: 'แตกใบ', preset: 'veg-leaf', note: 'เหมาะกับผักใบหรือแปลงที่ต้องการฟื้นความเขียวและเร่งทรงพุ่ม' },
    { key: 'veg-slow', label: 'โตช้า / ต้นไม่เดิน', stage: 'สะสมอาหาร', preset: 'veg-build', note: 'เหมาะกับการช่วยให้ต้นสะสมอาหารและเตรียมเข้าระยะให้ผลผลิต' },
    { key: 'veg-fruit-drop', label: 'ดอกผลไม่สวย / ติดผลไม่ดี', stage: 'ติดผล', preset: 'veg-fruit', note: 'เหมาะกับการดูแลดอก ผล และคุณภาพผลผลิต' },
  ],
};
const CALC_BUDGET_OPTIONS = [
  { key: 'economy', label: 'ประหยัด', desc: 'เริ่มต้นคุมงบ เลือกตัวหลักที่จำเป็นก่อน', tone: 'save' },
  { key: 'balanced', label: 'กลาง', desc: 'ได้สมดุลระหว่างงบประมาณกับความครอบคลุม', tone: 'balanced' },
  { key: 'premium', label: 'เน้นผลลัพธ์', desc: 'จัดชุดให้ครบขึ้นและเร่งผลลัพธ์ได้มากกว่า', tone: 'boost' },
];
const CALC_PLAN_DAY_OPTIONS = [7, 14, 21];
const CALC_LEAD_PREFILL_KEY = 'calc_lead_prefill';
function cloneCalcKnowledgeDefaults() {
  return JSON.parse(JSON.stringify(DEFAULT_CALC_KNOWLEDGE));
}
function normalizeCalcMixItem(item = {}) {
  return {
    key: String(item?.key || item?.title || '').trim(),
    stage: String(item?.stage || '').trim(),
    title: String(item?.title || '').trim(),
    ids: asArray(item?.ids).map((id) => String(id || '').trim()).filter(Boolean),
    note: String(item?.note || '').trim(),
  };
}
function normalizeCalcKnowledge(raw = '') {
  const base = cloneCalcKnowledgeDefaults();
  const parsed = (() => {
    const s = String(raw || '').trim();
    if (!s) return null;
    try { return JSON.parse(s); } catch { return null; }
  })();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return base;
  const cropEntries = { ...base.crops };
  Object.entries(parsed.crops || {}).forEach(([crop, cfg]) => {
    const defaultCfg = cropEntries[crop] || {};
    const mixes = asArray(cfg?.mixes).map((item) => normalizeCalcMixItem(item)).filter((item) => item.key && item.title && item.ids.length);
    cropEntries[crop] = {
      waterPerRai: Math.max(1, parseFloat(cfg?.waterPerRai ?? defaultCfg.waterPerRai ?? 60) || 60),
      mixes: mixes.length ? mixes : asArray(defaultCfg.mixes),
    };
  });
  const productEntries = { ...(base.products || {}) };
  Object.entries(parsed.products || {}).forEach(([id, cfg]) => {
    productEntries[id] = {
      ...(productEntries[id] || {}),
      label: String(cfg?.label || productEntries[id]?.label || '').trim(),
      preferredStrength: ['low', 'mid', 'high'].includes(String(cfg?.preferredStrength || '').trim()) ? String(cfg.preferredStrength).trim() : (productEntries[id]?.preferredStrength || 'mid'),
      note: String(cfg?.note || productEntries[id]?.note || '').trim(),
    };
  });
  return { crops: cropEntries, products: productEntries };
}
function calcKnowledge() {
  return normalizeCalcKnowledge(S('SITE_CALC_KNOWLEDGE'));
}
function calcCropConfig(crop = '') {
  return calcKnowledge().crops[String(crop || '').trim()] || null;
}
function calcCropList() {
  return Object.keys(calcKnowledge().crops);
}
function stickerCalcProduct() {
  return PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
}
function calcRatedProducts({ includeSticker = false } = {}) {
  return PRODUCTS.filter((p) => productRateProfile(p)).filter((p) => includeSticker || p.id !== stickerCalcProduct()?.id);
}
function calcSelectedProductIds() {
  return [...document.querySelectorAll('[data-calc-product]:checked')].map((el) => el.value).filter(Boolean);
}
function setCalcSelectedProducts(ids = []) {
  const picked = new Set(asArray(ids));
  document.querySelectorAll('[data-calc-product]').forEach((input) => { input.checked = picked.has(input.value); });
}
function calcPresetOptions(crop = '') {
  return asArray(calcCropConfig(crop)?.mixes);
}
function calcStageOptions(crop = '') {
  const list = [];
  calcPresetOptions(crop).forEach((item) => {
    const stage = String(item?.stage || '').trim();
    if (stage && !list.includes(stage)) list.push(stage);
  });
  return list;
}
function calcPresetDetails(crop = '', key = '') {
  return calcPresetOptions(crop).find((item) => item.key === key) || null;
}
function calcProblemOptions(crop = '') {
  return asArray(DEFAULT_CALC_PROBLEM_PRESETS[String(crop || '').trim()]).filter((item) => item.key && item.label);
}
function calcProblemDetails(crop = '', key = '') {
  return calcProblemOptions(crop).find((item) => item.key === key) || null;
}
function calcProblemIconName(problem = {}) {
  const text = `${problem?.key || ''} ${problem?.label || ''}`.toLowerCase();
  if (text.includes('ผล') || text.includes('fruit')) return 'drop';
  if (text.includes('โตช้า') || text.includes('อ่อนแรง') || text.includes('slow')) return 'sprout';
  if (text.includes('เครียด') || text.includes('stress')) return 'shieldleaf';
  return 'leaf';
}
function calcProblemSignal(problem = {}) {
  const text = `${problem?.key || ''} ${problem?.label || ''}`.toLowerCase();
  if (text.includes('ผล') || text.includes('fruit')) return { tone: 'warn', label: 'เร่งดูแลผล' };
  if (text.includes('โตช้า') || text.includes('อ่อนแรง') || text.includes('slow')) return { tone: 'cool', label: 'เน้นฟื้นต้น' };
  if (text.includes('เครียด') || text.includes('stress')) return { tone: 'info', label: 'พืชเครียด' };
  return { tone: 'good', label: 'เริ่มฟื้นใบ' };
}
function calcProblemVisual(crop = '', problem = {}) {
  const slug = cropSlugMap()[crop];
  const landing = slug ? cropLandingMap()[slug] : null;
  const image = landing?.heroImage || landing?.seoImage || landing?.gallery?.[0]?.image || landing?.reviews?.[0]?.image || '';
  return { image, signal: calcProblemSignal(problem) };
}
function calcProblemCardsHTML(crop = '', selectedKey = '') {
  const selected = String(selectedKey || '').trim();
  return calcProblemOptions(crop).map((item) => {
    const visual = calcProblemVisual(crop, item);
    return `<button type="button" class="calc-problem-card is-${esc(visual.signal.tone)} ${item.key === selected ? 'is-active' : ''}" data-calc-problem="${esc(item.key)}">
    <span class="calc-problem-media ${visual.image ? 'has-image' : ''}">
      ${visual.image ? `<img src="${esc(visual.image)}" alt="${esc(item.label)}" loading="lazy">` : icon(calcProblemIconName(item), 'mini-ico')}
      <i class="calc-problem-signal">${esc(visual.signal.label)}</i>
    </span>
    <span class="calc-problem-copy">
      <b>${esc(item.label)}</b>
      <small>${esc(item.note || 'กดเพื่อให้ระบบเลือกสูตรตั้งต้นให้')}</small>
    </span>
  </button>`;
  }).join('');
}
function calcBudgetMeta(level = 'balanced') {
  return CALC_BUDGET_OPTIONS.find((item) => item.key === level) || CALC_BUDGET_OPTIONS[1];
}
function calcBudgetPillsHTML(selected = 'balanced') {
  return CALC_BUDGET_OPTIONS.map((item) => `<button type="button" class="chip-btn ${item.key === selected ? 'on' : ''}" data-calcbudget="${item.key}">${esc(item.label)}</button>`).join('');
}
function calcBudgetLevel() {
  return String(document.getElementById('calcBudgetLevel')?.value || 'balanced').trim() || 'balanced';
}
function calcBudgetStrength(level = 'balanced') {
  return ({ economy: 'low', balanced: 'mid', premium: 'high' }[String(level || '').trim()] || 'mid');
}
function calcBudgetProductIds(level = 'balanced', crop = '', presetKey = '') {
  const preset = calcPresetDetails(crop, presetKey);
  const currentIds = calcSelectedProductsForRun().map((item) => item.id);
  const baseIds = [...new Set(asArray(preset?.ids).length ? preset.ids : currentIds)].filter((id) => productById(id));
  const stickerId = baseIds.find((id) => /จับใบ/.test(String(productById(id)?.name || '')));
  const nonSticker = baseIds.filter((id) => id !== stickerId).sort((a, b) => effPrice(productById(a)) - effPrice(productById(b)));
  if (!nonSticker.length) return baseIds;
  if (level === 'economy') return [nonSticker[0]];
  if (level === 'premium') {
    const stickerProduct = PRODUCTS.find((item) => /จับใบ/.test(String(item?.name || '')));
    const ids = [...nonSticker];
    if (stickerProduct && !ids.includes(stickerProduct.id)) ids.push(stickerProduct.id);
    return ids;
  }
  return [...nonSticker];
}
function syncCalcBudgetPills() {
  const level = calcBudgetLevel();
  document.querySelectorAll('[data-calcbudget]').forEach((btn) => btn.classList.toggle('on', btn.dataset.calcbudget === level));
  const summary = document.getElementById('calcBudgetSummary');
  const meta = calcBudgetMeta(level);
  if (summary) summary.textContent = meta?.desc || '';
}
function applyCalcBudgetSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const presetKey = document.getElementById('calcPreset')?.value || '';
  const level = calcBudgetLevel();
  const strengthEl = document.getElementById('calcStrength');
  const stickerEl = document.getElementById('calcIncludeSticker');
  const ids = calcBudgetProductIds(level, crop, presetKey);
  setCalcSelectedProducts(ids);
  if (strengthEl) strengthEl.value = calcBudgetStrength(level);
  if (stickerEl) stickerEl.checked = level === 'premium';
  document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
  syncCalcBudgetPills();
}
function calcFilteredPresetOptions(crop = '', stage = '') {
  const currentStage = String(stage || '').trim();
  return calcPresetOptions(crop).filter((item) => !currentStage || item.stage === currentStage);
}
function syncCalcProblemSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const select = document.getElementById('calcProblem');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const problems = calcProblemOptions(crop);
  select.innerHTML = `<option value="">เลือกจากอาการที่เจอ</option>${problems.map((item) => `<option value="${esc(item.key)}">${esc(item.label)}</option>`).join('')}`;
  if (problems.some((item) => item.key === current)) select.value = current;
  const cards = document.getElementById('calcProblemCards');
  if (cards) cards.innerHTML = calcProblemCardsHTML(crop, select.value || '');
  const note = document.getElementById('calcProblemNote');
  const selectedInfo = calcProblemDetails(crop, select.value || '');
  if (note) note.textContent = selectedInfo?.note || (crop ? `เลือกอาการที่ใกล้กับปัญหาของ${crop} เพื่อให้ระบบจัดระยะและสูตรตั้งต้นให้เร็วขึ้น` : 'เลือกพืชก่อน แล้วค่อยเลือกอาการที่ต้องการแก้');
}
function syncCalcStageSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const select = document.getElementById('calcStage');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const stages = calcStageOptions(crop);
  select.innerHTML = `<option value="">ทุกระยะ</option>${stages.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('')}`;
  if (stages.includes(current)) select.value = current;
  else if (!preserveSelection && stages[0]) select.value = stages[0];
}
function syncCalcPresetSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const stage = document.getElementById('calcStage')?.value || '';
  const select = document.getElementById('calcPreset');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const presets = calcFilteredPresetOptions(crop, stage);
  select.innerHTML = `<option value="">จัดเอง</option>${presets.map((item) => `<option value="${esc(item.key)}">${esc(item.title)}</option>`).join('')}`;
  if (presets.some((item) => item.key === current)) select.value = current;
  const note = document.getElementById('calcPresetNote');
  const chosen = calcPresetDetails(crop, select.value);
  if (note) note.textContent = chosen?.note || (crop ? `น้ำต่อไร่ของ${crop}ถูกตั้งให้อัตโนมัติแล้ว คุณยังปรับเองได้` : 'เลือกพืชหรือสูตรสำเร็จเพื่อให้ระบบช่วยจัดชุดสินค้าให้');
}
function syncCalcCompareSelect({ preserveSelection = true } = {}) {
  const crop = document.getElementById('calcCrop')?.value || '';
  const currentPreset = document.getElementById('calcPreset')?.value || '';
  const select = document.getElementById('calcComparePreset');
  if (!select) return;
  const current = preserveSelection ? select.value : '';
  const options = calcPresetOptions(crop).filter((item) => item.key !== currentPreset);
  select.innerHTML = `<option value="">เลือกสูตรมาเทียบ</option>${options.map((item) => `<option value="${esc(item.key)}">${esc(item.title)}</option>`).join('')}`;
  if (options.some((item) => item.key === current)) select.value = current;
  else if (!preserveSelection && options[0]) select.value = options[0].key;
}
function applyCalcPresetSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const preset = document.getElementById('calcPreset')?.value || '';
  const info = calcPresetDetails(crop, preset);
  if (info) setCalcSelectedProducts(info.ids);
}
function applyCalcProblemSelection() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const problem = document.getElementById('calcProblem')?.value || '';
  const info = calcProblemDetails(crop, problem);
  if (!info) return;
  const stageEl = document.getElementById('calcStage');
  if (stageEl && calcStageOptions(crop).includes(info.stage)) stageEl.value = info.stage;
  syncCalcPresetSelect({ preserveSelection: false });
  const presetEl = document.getElementById('calcPreset');
  if (presetEl && calcPresetDetails(crop, info.preset)) presetEl.value = info.preset;
  applyCalcPresetSelection();
}
function calcPlanDays() {
  return Math.max(7, parseInt(document.getElementById('calcPlanDays')?.value || '14', 10) || 14);
}
function calcPlanCycles(days = 14) {
  return Math.max(1, Math.round(Math.max(7, Number(days || 14)) / 7));
}
function calcSelectedProductsForRun() {
  const selected = calcSelectedProductIds().map((id) => productById(id)).filter(Boolean);
  const includeSticker = !!document.getElementById('calcIncludeSticker')?.checked;
  const sticker = stickerCalcProduct();
  if (includeSticker && sticker && !selected.some((item) => item.id === sticker.id)) selected.push(sticker);
  return selected;
}
function calcPackCount(totalCc = 0, packSize = 100) {
  const total = Math.max(0, Number(totalCc || 0));
  const size = Math.max(1, Number(packSize || 0));
  return Math.ceil(total / size);
}
function calcProductMixRows(products = [], totalWater = 0, strength = 'mid') {
  return products.map((p) => {
    const profile = productRateProfile(p);
    if (!profile) return null;
    const rate = profile.selectedRate;
    const exact = doseByStrength(rate, totalWater, strength);
    const range = calcDoseValues(rate, totalWater);
    return {
      product: p,
      profile,
      exact,
      range,
      isSticker: p.id === stickerCalcProduct()?.id,
    };
  }).filter(Boolean);
}
function buildCalcShareText({ crop = '', stage = '', presetTitle = '', totalWater = 0, rows = [], totalDose = 0 } = {}) {
  const head = ['สรุปสูตรผสมแนะนำจากนุชฟอร์ไลฟ์'];
  if (crop) head.push(`พืช: ${crop}`);
  if (stage) head.push(`ระยะ: ${stage}`);
  if (presetTitle) head.push(`สูตร: ${presetTitle}`);
  head.push(`น้ำรวม: ${fmtCalcNumber(totalWater)} ลิตร`);
  const lines = rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`);
  return `${head.join(' | ')}\n${lines.join('\n')}\nรวมทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี\nหมายเหตุ: หากมีฉลากขวดจริง ให้ยึดตามฉลากก่อนทุกครั้ง`;
}
function buildCalcPitchText({ crop = '', stage = '', presetTitle = '', totalWater = 0, rows = [], totalDose = 0, strength = 'mid' } = {}) {
  const cropText = crop || 'พืชของลูกค้า';
  const stageText = stage ? `ช่วง${stage}` : 'ช่วงที่ต้องการดูแล';
  const titleText = presetTitle || 'สูตรที่ทีมงานแนะนำ';
  const lineUrl = String(S('LINE_OA_URL') || '').trim();
  const rowLines = rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`);
  const highlights = rows
    .filter((row) => !row.isSticker)
    .map((row) => calcKnowledge().products?.[row.product.id]?.label || row.product.short || row.product.name)
    .filter(Boolean)
    .slice(0, 3)
    .map((text) => `- ${text}`);
  return [
    `สวัสดีครับ ทีมงาน ${S('SITE_NAME') || 'นุชฟอร์ไลฟ์'} สรุปสูตรแนะนำให้แล้ว`,
    `พืช: ${cropText}`,
    `ระยะ: ${stageText}`,
    `สูตรแนะนำ: ${titleText}`,
    `ระดับการใช้: ${calcStrengthLabel(strength)}`,
    `ผสมน้ำรวม ${fmtCalcNumber(totalWater)} ลิตร`,
    ...rowLines,
    `รวมทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี`,
    highlights.length ? 'จุดเด่นของสูตรนี้' : '',
    ...highlights,
    'หากต้องการให้ทีมงานช่วยปรับสูตรตามอาการจริง ส่งชื่อพืช ปัญหา และพื้นที่ปลูกมาได้เลยครับ',
    'หมายเหตุ: หากมีฉลากขวดจริง ให้ยึดตามฉลากก่อนทุกครั้ง',
    lineUrl ? `คุยกับทีมงานต่อทาง LINE: ${lineUrl}` : '',
  ].filter(Boolean).join('\n');
}
function calcModeLabel(mode = 'tank') {
  return ({ tank: 'ตามถัง', water: 'ตามน้ำรวม', area: 'ตามพื้นที่' }[String(mode || '').trim()] || 'ตามถัง');
}
function calcModeRecommendation(fields = {}) {
  if (fields.mode === 'area') return `เหมาะเมื่อคุณรู้พื้นที่ปลูกชัดเจน เช่น ${fmtCalcNumber(fields.areaRai)} ไร่ และต้องการให้ระบบคำนวณน้ำรวมจาก ${fmtCalcNumber(fields.waterPerRai)} ลิตรต่อไร่ให้อัตโนมัติ`;
  if (fields.mode === 'water') return `เหมาะเมื่อคุณเตรียมน้ำรวมไว้แล้ว ${fmtCalcNumber(fields.waterTotal)} ลิตร และต้องการคำนวณรวดเดียวสำหรับรอบพ่นนี้`;
  return `เหมาะกับการผสมหน้างานทีละถัง เช่น ถัง ${fmtCalcNumber(fields.tankSize)} ลิตร จำนวน ${fmtCalcNumber(fields.tankCount)} ถัง`;
}
function calcGuideStepsHTML({ crop = '', stage = '', presetTitle = '', fields = {}, rows = [], stickerRow = null } = {}) {
  const step1 = crop ? `เริ่มจากพืช ${crop}${stage ? ` และช่วง${stage}` : ''}${presetTitle ? ` โดยใช้สูตร ${presetTitle}` : ''}` : 'เริ่มจากเลือกพืชและระยะที่ต้องการดูแล';
  const step2 = `${calcModeLabel(fields.mode)}: ${calcModeRecommendation(fields)}`;
  const step3 = rows.length
    ? `ก่อนผสมจริง ให้ผสมตามลำดับ ${rows.filter((row) => !row.isSticker).map((row) => row.product.name).join(' -> ')}${stickerRow ? ` -> ${stickerRow.product.name}` : ''}`
    : 'เลือกสินค้าอย่างน้อย 1 ตัวก่อน เพื่อให้ระบบสรุปลำดับผสมและผลลัพธ์อัตโนมัติ';
  return [step1, step2, step3].map((text, idx) => `<article class="calc-step-card"><span>ขั้น ${idx + 1}</span><b>${esc(text)}</b></article>`).join('');
}
function calcExpectedEffects({ crop = '', stage = '', rows = [], strength = 'mid', stickerRow = null } = {}) {
  const productLabels = rows
    .filter((row) => !row.isSticker)
    .map((row) => calcKnowledge().products?.[row.product.id]?.label || row.product.short || row.product.name)
    .filter(Boolean);
  const effects = [];
  if (stage === 'แตกใบ') effects.push(`คาดว่าจะเห็นการเดินใบและการฟื้นตัวของ${crop || 'พืช'}สม่ำเสมอขึ้น หากต้นไม่เครียดและมีน้ำพอ`);
  if (stage === 'สะสมอาหาร') effects.push(`คาดว่าจะช่วยพยุงความสมบูรณ์ของใบและต้น เพื่อให้${crop || 'พืช'}สะสมอาหารได้ต่อเนื่องขึ้น`);
  if (stage === 'ติดผล') effects.push(`คาดว่าจะเน้นการประคองผลและคุณภาพผลผลิตมากขึ้น โดยเฉพาะถ้าให้ต่อเนื่องตามรอบพ่น`);
  if (!stage) effects.push(`สูตรนี้เหมาะกับการใช้เป็นแนวทางตั้งต้นสำหรับ${crop || 'พืช'} แล้วค่อยปรับตามอาการจริงในแปลง`);
  if (productLabels.length) effects.push(`บทบาทหลักของสูตรนี้คือ ${productLabels.slice(0, 3).join(' + ')}`);
  if (strength === 'low') effects.push('เลือกความเข้มเริ่มต้น จึงเหมาะกับการเริ่มลองหรือแปลงที่อยากคุมความเสี่ยงก่อน');
  if (strength === 'high') effects.push('เลือกความเข้มเข้มขึ้น จึงควรใช้เมื่อมั่นใจในสภาพพืช น้ำ และสภาพอากาศหน้างาน');
  if (stickerRow) effects.push(`มี ${stickerRow.product.name} ในสูตร จึงคาดว่าการเกาะใบและความสม่ำเสมอของการพ่นจะดีขึ้น`);
  return effects.slice(0, 4);
}
function calcCautionNotes({ rows = [], totalWater = 0, strength = 'mid', presetTitle = '' } = {}) {
  const notes = [];
  if (!presetTitle) notes.push('คุณกำลังจัดสูตรเอง ควรเช็กความเข้ากันได้ของสินค้าแต่ละตัวอีกครั้งก่อนผสมจริง');
  if (strength === 'high') notes.push('โหมดเข้มควรเริ่มทดลองในพื้นที่ย่อยก่อน หากยังไม่เคยใช้สูตรนี้กับแปลงจริง');
  if (totalWater > 1000) notes.push(`รอบนี้ใช้น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร ควรแบ่งผสมเป็นชุดย่อยเพื่อให้ตวงง่ายและลดความคลาดเคลื่อน`);
  if (rows.length >= 3) notes.push('สูตรหลายตัวควรคนให้เข้ากันทีละตัวและเติมตัวถัดไปหลังละลายสม่ำเสมอแล้ว');
  notes.push('หากมีฉลากหรือคำแนะนำจากนักวิชาการเฉพาะแปลง ให้ยึดข้อมูลนั้นก่อนผลวิเคราะห์อัตโนมัติ');
  return notes.slice(0, 4);
}
function calcConfidenceLabel({ presetTitle = '', rows = [] } = {}) {
  const researchCount = rows.filter((row) => row.profile?.research?.sourceUrl).length;
  if (presetTitle && researchCount === rows.length && rows.length) return 'สูง';
  if (presetTitle || researchCount > 0) return 'กลาง';
  return 'ตั้งต้น';
}
function calcAiAnalysisHTML({ crop = '', stage = '', presetTitle = '', fields = {}, rows = [], totalWater = 0, totalDose = 0, strength = 'mid', stickerRow = null } = {}) {
  const expected = calcExpectedEffects({ crop, stage, rows, strength, stickerRow });
  const cautions = calcCautionNotes({ rows, totalWater, strength, presetTitle });
  const confidence = calcConfidenceLabel({ presetTitle, rows });
  const title = presetTitle || (crop && stage ? `${crop} ช่วง${stage}` : crop || 'สูตรที่เลือก');
  return `<div class="calc-ai-card">
    <div class="calc-ai-head">
      <div>
        <span class="eyebrow">AI วิเคราะห์ผลลัพธ์ที่คาดว่าจะเกิดขึ้น</span>
        <h3>${esc(title)}</h3>
      </div>
      <span class="calc-ai-confidence">ความมั่นใจ ${esc(confidence)}</span>
    </div>
    <div class="calc-ai-grid">
      <article class="calc-ai-block">
        <b>ภาพรวมรอบพ่นนี้</b>
        <span>ระบบประเมินจาก ${calcModeLabel(fields.mode)} | น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร | ใช้ทั้งหมด ${fmtCalcNumber(totalDose)} ซีซี | ความเข้ม ${calcStrengthLabel(strength)}</span>
      </article>
      <article class="calc-ai-block">
        <b>ผลที่คาดว่าจะเห็น</b>
        <div class="calc-ai-list">${expected.map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </article>
      <article class="calc-ai-block">
        <b>ข้อควรระวัง</b>
        <div class="calc-ai-list">${cautions.map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </article>
    </div>
  </div>`;
}
function calcTimelineSteps({ crop = '', stage = '', rows = [], totalWater = 0, days = 14 } = {}) {
  const productNames = rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const sameSet = productNames.length ? productNames.join(' + ') : 'สูตรที่เลือก';
  const steps = [
    { day: 0, title: `เริ่มพ่นสูตร ${sameSet}`, detail: `ใช้น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร ตามผลคำนวณรอบนี้ และควรพ่นในช่วงอากาศนิ่ง` },
    { day: 7, title: 'เช็กอาการและตอบสนองของแปลง', detail: stage === 'ติดผล'
      ? 'ติดตามการตอบสนองของผลและความสมบูรณ์ของต้น แล้วพ่นซ้ำหากยังต้องการประคองผลต่อเนื่อง'
      : stage === 'สะสมอาหาร'
        ? 'สังเกตความสมบูรณ์ของใบและทรงต้น ถ้าตอบสนองดีให้พ่นซ้ำชุดเดิมหรือปรับความเข้มตามสภาพแปลง'
        : 'สังเกตการเดินใบและความเขียว ถ้าต้นเริ่มตอบสนองดีให้พ่นต่อรอบกลางเพื่อย้ำผลลัพธ์' },
    { day: 14, title: stage === 'ติดผล' ? 'ประเมินผลผลิตและคุณภาพผล' : 'พิจารณาปรับเข้าสูตรระยะถัดไป', detail: stage ? `หาก${crop || 'พืช'}เริ่มขยับเข้าสู่ระยะถัดไป ให้เปลี่ยนสูตรตามระยะใหม่แทนการพ่นชุดเดิมต่อเนื่องนานเกินไป` : 'เมื่อครบ 14 วัน ควรประเมินสภาพจริงในแปลงก่อนกำหนดรอบถัดไป' },
    { day: 21, title: 'สรุปผลและวางรอบถัดไป', detail: 'เก็บผลตอบรับจากแปลงจริง แล้วปรับสูตรหรือความเข้มให้เหมาะกับรอบถัดไปก่อนสั่งซื้อเพิ่ม' },
  ];
  return steps.filter((item) => item.day <= Math.max(7, days));
}
function calcTimelineHTML({ crop = '', stage = '', presetTitle = '', rows = [], strength = 'mid', totalWater = 0, days = 14 } = {}) {
  const title = presetTitle || (crop && stage ? `${crop} ช่วง${stage}` : 'โปรแกรมพ่นต่อเนื่อง');
  const steps = calcTimelineSteps({ crop, stage, rows, totalWater, days });
  const productNames = rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const sameSet = productNames.length ? productNames.join(' + ') : 'สูตรที่เลือก';
  return `<div class="calc-plan-card">
    <div class="calc-plan-head">
      <div>
        <span class="eyebrow">โปรแกรมพ่นต่อเนื่อง ${fmtCalcNumber(days)} วัน</span>
        <h3>${esc(title)}</h3>
      </div>
      <span class="calc-plan-badge">${esc(calcStrengthLabel(strength))}</span>
    </div>
    <div class="calc-plan-meta">สูตรหลักรอบนี้: ${esc(sameSet)}</div>
    <div class="calc-plan-timeline">
      ${steps.map((item) => `<article class="calc-plan-step">
        <span>Day ${fmtCalcNumber(item.day)}</span>
        <b>${esc(item.title)}</b>
        <small>${esc(item.detail)}</small>
      </article>`).join('')}
    </div>
  </div>`;
}
function calcRecommendedBottle(row, days = 14) {
  const cycles = calcPlanCycles(days);
  const totalCc = Math.max(0, row.exact * cycles);
  const packSize = totalCc > 120 ? 500 : 100;
  return {
    ...row,
    days,
    cycles,
    totalCc,
    packSize,
    qty: Math.max(1, Math.ceil(totalCc / packSize)),
  };
}
function calcBundleRecommendations(rows = [], days = 14) {
  return rows.map((row) => calcRecommendedBottle(row, days));
}
function calcBundleSummaryHTML(recommendations = []) {
  if (!recommendations.length) return '<div class="calc-bundle-empty">ยังไม่มีชุดที่พร้อมซื้อ</div>';
  return `<div class="calc-bundle-list">${recommendations.map((item) => `<article class="calc-bundle-item">
    <b>${esc(item.product.name)}</b>
    <span>ใช้จริงประมาณ ${fmtCalcNumber(item.totalCc)} ซีซี ตลอด ${fmtCalcNumber(item.days)} วัน</span>
    <strong>แนะนำ ${fmtCalcNumber(item.qty)} ขวด ขนาด ${fmtCalcNumber(item.packSize)} ซีซี</strong>
  </article>`).join('')}</div>`;
}
function calcBudgetLead(level = 'balanced') {
  const meta = calcBudgetMeta(level);
  return meta?.label || 'กลาง';
}
function buildCalcConsultText({ crop = '', problemLabel = '', stage = '', presetTitle = '', totalWater = 0, rows = [], days = 14 } = {}) {
  const bundle = calcBundleRecommendations(rows, days)
    .map((item) => `- ${item.product.name}: แนะนำ ${item.qty} ขวด ขนาด ${item.packSize} ซีซี`)
    .join('\n');
  return [
    `ต้องการให้ทีมงานช่วยตรวจสูตรสำหรับ${crop || 'พืช'}เพิ่มเติม`,
    problemLabel ? `อาการหลัก: ${problemLabel}` : '',
    stage ? `ระยะ: ${stage}` : '',
    presetTitle ? `สูตรที่ระบบเลือก: ${presetTitle}` : '',
    `น้ำรวมต่อรอบ: ${fmtCalcNumber(totalWater)} ลิตร`,
    `แผนที่ต้องการ: ${fmtCalcNumber(days)} วัน`,
    ...rows.map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี/รอบ`),
    bundle ? 'ขวดที่ระบบแนะนำ' : '',
    bundle,
    'ช่วยตรวจสอบความเหมาะสมกับอาการจริงของแปลงให้หน่อยครับ',
  ].filter(Boolean).join('\n');
}
function buildCalcSalesLineText({ crop = '', problemLabel = '', stage = '', presetTitle = '', totalWater = 0, rows = [], days = 14, budgetLevel = 'balanced' } = {}) {
  const slug = cropSlugMap()[crop];
  const landingUrl = `${location.origin}${slug ? `/crops/${slug}` : routeHref('/products')}`;
  const lineUrl = String(S('LINE_OA_URL') || '').trim();
  const bundle = calcBundleRecommendations(rows, days);
  const totalPrice = bundle.reduce((sum, item) => sum + (effPrice(item.product) * item.qty), 0);
  return [
    `แนะนำสูตรสำหรับ${crop || 'พืช'}${problemLabel ? ` อาการ${problemLabel}` : ''}`,
    stage ? `ช่วงที่เหมาะ: ${stage}` : '',
    presetTitle ? `ชุดแนะนำ: ${presetTitle}` : '',
    `ระดับงบ: ${calcBudgetLead(budgetLevel)}`,
    `ผสมน้ำรวม ${fmtCalcNumber(totalWater)} ลิตร / แผน ${fmtCalcNumber(days)} วัน`,
    ...rows.filter((row) => !row.isSticker).map((row) => `- ${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี/รอบ`),
    bundle.length ? 'ขวดที่ระบบแนะนำ' : '',
    ...bundle.map((item) => `- ${item.product.name}: ${item.qty} ขวด ขนาด ${item.packSize} ซีซี`),
    `งบชุดนี้ประมาณ ${baht(totalPrice)}`,
    `ดูรายละเอียดและสั่งซื้อได้ที่ ${landingUrl}`,
    lineUrl ? `หรือทักทีมงานทาง LINE OA: ${lineUrl}` : '',
  ].filter(Boolean).join('\n');
}
function setCalcLeadPrefill(data = {}) {
  try { localStorage.setItem(CALC_LEAD_PREFILL_KEY, JSON.stringify(data)); } catch {}
}
function calcLeadStageValue(stage = '', problemLabel = '') {
  const text = `${stage || ''} ${problemLabel || ''}`;
  if (text.includes('ติดผล') || text.includes('ผล')) return 'บำรุงผล';
  if (text.includes('แตกใบ') || text.includes('เร่งใบ') || text.includes('โตช้า') || text.includes('แตกกอ')) return 'เร่งโต/แตกกอ';
  if (text.includes('เครียด') || text.includes('ใบเหลือง')) return 'ใบเหลือง/พืชเครียด';
  if (text.includes('สะสมอาหาร') || text.includes('ดอก')) return 'เร่งดอก';
  return 'ยังไม่แน่ใจ ขอคำแนะนำ';
}
function applyCalcLeadPrefill() {
  const form = document.getElementById('leadForm');
  if (!form) return;
  let data = null;
  try { data = JSON.parse(localStorage.getItem(CALC_LEAD_PREFILL_KEY) || 'null'); } catch {}
  if (!data || typeof data !== 'object') return;
  const applyValues = () => {
    const cropInput = form.querySelector('[name="crop"]');
    const stageInput = form.querySelector('[name="stage"]');
    const problemInput = form.querySelector('[name="problem"]');
    if (cropInput) cropInput.value = data.crop || cropInput.value || '';
    if (stageInput) stageInput.value = data.stage || stageInput.value || '';
    if (problemInput) problemInput.value = data.problem || problemInput.value || '';
  };
  applyValues();
  setTimeout(() => {
    applyValues();
    try { localStorage.removeItem(CALC_LEAD_PREFILL_KEY); } catch {}
  }, 180);
}
function calcCompareHTML({ crop = '', currentPreset = null, comparePreset = null, currentRows = [], totalWater = 0, strength = 'mid' } = {}) {
  if (!comparePreset) return '<div class="calc-compare-empty">เลือกสูตรอีก 1 ชุดเพื่อเปรียบเทียบจุดเด่น จุดต่าง และใช้เป็นสคริปต์คุยกับลูกค้า</div>';
  const compareProducts = asArray(comparePreset.ids).map((id) => productById(id)).filter(Boolean);
  const compareRows = calcProductMixRows(compareProducts, totalWater, strength).filter((row) => !row.isSticker);
  const currentNames = currentRows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const compareNames = compareRows.map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/, ''));
  const overlap = currentNames.filter((name) => compareNames.includes(name));
  const currentOnly = currentNames.filter((name) => !compareNames.includes(name));
  const compareOnly = compareNames.filter((name) => !currentNames.includes(name));
  return `<div class="calc-compare-card">
    <div class="calc-compare-cols">
      <article class="calc-compare-side is-current">
        <span>สูตรที่กำลังดู</span>
        <b>${esc(currentPreset?.title || 'สูตรที่คุณจัดเอง')}</b>
        <small>${esc(currentPreset?.note || 'ใช้ผลจากการเลือกสินค้าปัจจุบัน')}</small>
      </article>
      <article class="calc-compare-side">
        <span>สูตรที่เอามาเทียบ</span>
        <b>${esc(comparePreset.title)}</b>
        <small>${esc(comparePreset.note || 'ใช้เป็นอีกทางเลือกสำหรับคุยกับลูกค้า')}</small>
      </article>
    </div>
    <div class="calc-compare-points">
      <div><b>เหมือนกัน</b><span>${esc(overlap.length ? overlap.join(' + ') : 'ไม่มีรายการซ้ำ')}</span></div>
      <div><b>สูตรนี้เด่น</b><span>${esc(currentOnly.length ? currentOnly.join(' + ') : 'เน้นแนวทางใกล้เคียงกัน')}</span></div>
      <div><b>สูตรเทียบเด่น</b><span>${esc(compareOnly.length ? compareOnly.join(' + ') : 'เน้นแนวทางใกล้เคียงกัน')}</span></div>
    </div>
    <div class="calc-compare-summary">ถ้าลูกค้าบอกอาการเอนไปทาง ${esc(comparePreset.stage || 'อีกระยะหนึ่ง')} สามารถสลับไปเสนอสูตร ${esc(comparePreset.title)} ได้ทันที</div>
  </div>`;
}
const CALC_STAGE_TEMPLATE_OPTIONS = ['แตกใบ', 'สะสมอาหาร', 'ติดผล'];
function calcStrengthLabel(strength = 'mid') {
  return ({
    low: 'เริ่มต้น',
    mid: 'กลาง',
    high: 'เข้มขึ้น',
  }[String(strength || '').trim()] || 'กลาง');
}
function calcKnowledgeEditorProducts(data) {
  const ids = new Set([
    ...Object.keys(data?.products || {}),
    ...calcRatedProducts({ includeSticker: true }).map((item) => item.id),
  ]);
  return [...ids].map((id) => {
    const product = productById(id);
    const meta = data?.products?.[id] || {};
    return { id, product, meta };
  }).filter((item) => item.product || item.meta.label || item.meta.note);
}
function calcKnowledgeCropSummaryText(card) {
  const crop = String(card?.dataset.cropName || '').trim() || 'พืชนี้';
  const count = card?.querySelectorAll('[data-mix-row]')?.length || 0;
  return `ตั้งค่าน้ำต่อไร่และสูตรตามระยะของ${crop} · ${count} สูตร`;
}
function updateCalcKnowledgeCropSummary(card) {
  const summary = card?.querySelector('[data-calc-crop-summary]');
  if (summary) summary.textContent = calcKnowledgeCropSummaryText(card);
}
function readCalcMixEditorRow(row, { crop = '', index = 0 } = {}) {
  const stage = String(row?.querySelector('[data-mix-field="stage"]')?.value || '').trim() || CALC_STAGE_TEMPLATE_OPTIONS[0];
  const title = String(row?.querySelector('[data-mix-field="title"]')?.value || '').trim();
  const note = String(row?.querySelector('[data-mix-field="note"]')?.value || '').trim();
  const ids = [...row?.querySelectorAll?.('[data-mix-product]:checked') || []].map((input) => input.value).filter(Boolean);
  return {
    key: `${slugifyCrop(crop)}-${slugifyCrop(stage || 'stage')}-${slugifyCrop(title || `mix-${index + 1}`) || `mix-${index + 1}`}`,
    stage,
    title,
    ids,
    note,
  };
}
function calcKnowledgeMixEditorRow(mix = {}) {
  const products = calcRatedProducts({ includeSticker: true });
  const stage = String(mix?.stage || '').trim();
  const title = String(mix?.title || '').trim();
  const note = String(mix?.note || '').trim();
  const selected = new Set(asArray(mix?.ids).map((id) => String(id || '').trim()).filter(Boolean));
  return `<article class="calc-mix-editor-row" data-mix-row draggable="true">
    <div class="calc-mix-editor-head">
      <div class="calc-mix-editor-title">
        <b>สูตรย่อย</b>
        <span>ลากเพื่อจัดลำดับสูตรได้</span>
      </div>
      <div class="calc-mix-editor-tools">
        <span class="calc-mix-drag-handle" aria-hidden="true">ลากเรียง</span>
        <button class="btn-mini" type="button" data-dupmix>ทำซ้ำ</button>
        <button class="btn-mini danger" type="button" data-delmix>ลบสูตร</button>
      </div>
    </div>
    <div class="calc-mix-editor-grid">
      <label class="set-field">
        <span>ระยะพืช</span>
        <select data-mix-field="stage">
          ${CALC_STAGE_TEMPLATE_OPTIONS.map((item) => `<option value="${esc(item)}" ${item === stage ? 'selected' : ''}>${esc(item)}</option>`).join('')}
        </select>
      </label>
      <label class="set-field">
        <span>ชื่อสูตร</span>
        <input data-mix-field="title" value="${esc(title)}" placeholder="เช่น เร่งใบ ฟื้นต้น">
      </label>
      <label class="set-field lead-wide">
        <span>คำอธิบายสำหรับทีมขาย / หน้าเครื่องคำนวณ</span>
        <textarea data-mix-field="note" rows="3" placeholder="เช่น เหมาะกับช่วงเร่งใบ ฟื้นต้นหลังเก็บเกี่ยว">${esc(note)}</textarea>
      </label>
      <div class="set-field lead-wide">
        <span>สินค้าที่อยู่ในสูตรนี้</span>
        <div class="calc-mix-product-checks">
          ${products.map((product) => `<label class="chip-check">
            <input type="checkbox" data-mix-product value="${product.id}" ${selected.has(product.id) ? 'checked' : ''}>
            <span>${esc(product.name)}</span>
          </label>`).join('')}
        </div>
      </div>
    </div>
  </article>`;
}
function calcKnowledgeEditorHTML(raw = '') {
  const data = normalizeCalcKnowledge(raw);
  const cropCards = Object.entries(data.crops || {}).map(([crop, cfg]) => `
    <article class="calc-knowledge-card" data-calc-crop-card data-crop-name="${esc(crop)}">
      <div class="calc-knowledge-card-head">
        <div>
          <b>${esc(crop)}</b>
          <span data-calc-crop-summary>ตั้งค่าน้ำต่อไร่และสูตรตามระยะของพืชนี้ · ${asArray(cfg?.mixes).length} สูตร</span>
        </div>
        <div class="calc-knowledge-card-tools">
          <label class="set-field calc-knowledge-water">
            <span>น้ำต่อไร่ (ลิตร)</span>
            <input type="number" min="1" max="5000" step="1" data-crop-water value="${esc(cfg?.waterPerRai || 60)}">
          </label>
          <button class="btn-mini" type="button" data-togglecalccrop>ย่อ</button>
        </div>
      </div>
      <div class="calc-knowledge-card-body">
        <div class="calc-mix-editor-list" data-mix-list>
          ${asArray(cfg?.mixes).map((mix) => calcKnowledgeMixEditorRow(mix)).join('')}
        </div>
        <div class="calc-knowledge-card-actions">
          <button class="btn btn-glass" type="button" data-addmix>+ เพิ่มสูตรในพืชนี้</button>
        </div>
      </div>
    </article>
  `).join('');
  const productCards = calcKnowledgeEditorProducts(data).map(({ id, product, meta }) => `
    <article class="calc-product-knowledge-card" data-product-knowledge="${esc(id)}">
      <div class="calc-product-knowledge-head">
        <b>${esc(product?.name || id)}</b>
        <span>${esc(product?.short || 'ใช้ข้อความนี้เป็นคำอธิบายสั้นบนหน้าเครื่องคำนวณ')}</span>
      </div>
      <div class="calc-product-knowledge-grid">
        <label class="set-field">
          <span>คำอธิบายสั้น</span>
          <input data-product-field="label" value="${esc(meta?.label || '')}" placeholder="เช่น เร่งใบและโครงสร้างต้น">
        </label>
        <label class="set-field">
          <span>ความเข้มเริ่มต้น</span>
          <select data-product-field="preferredStrength">
            <option value="low" ${meta?.preferredStrength === 'low' ? 'selected' : ''}>เริ่มต้น</option>
            <option value="mid" ${meta?.preferredStrength !== 'low' && meta?.preferredStrength !== 'high' ? 'selected' : ''}>กลาง</option>
            <option value="high" ${meta?.preferredStrength === 'high' ? 'selected' : ''}>เข้มขึ้น</option>
          </select>
        </label>
        <label class="set-field lead-wide">
          <span>โน้ตภายใน / คำแนะนำเพิ่มเติม</span>
          <textarea data-product-field="note" rows="3" placeholder="เช่น เหมาะกับแปลงที่ต้องการฟื้นต้นหลังเครียด">${esc(meta?.note || '')}</textarea>
        </label>
      </div>
    </article>
  `).join('');
  return `<div class="calc-knowledge-editor" id="calcKnowledgeEditor">
    <div class="calc-knowledge-intro">
      <b>ตั้งค่าฐานความรู้เครื่องคำนวณผ่านฟอร์มได้เลย</b>
      <span>ระบบจะบันทึกกลับไปเป็น JSON ให้อัตโนมัติ เพื่อให้หน้าเครื่องคำนวณยังใช้โครงสร้างเดิม แต่หลังบ้านแก้ง่ายขึ้นมาก</span>
    </div>
    <div class="calc-knowledge-section">
      <div class="calc-knowledge-section-head">
        <div>
          <b>สูตรแนะนำตามพืชและระยะ</b>
          <span>แต่ละสูตรจะไปเป็น preset ในหน้าเครื่องคำนวณทันที</span>
        </div>
        <div class="calc-knowledge-toolbar">
          <button class="btn-mini" type="button" data-expandcalccrops>ขยายทั้งหมด</button>
          <button class="btn-mini" type="button" data-collapsecalccrops>ย่อทั้งหมด</button>
        </div>
      </div>
      <div class="calc-knowledge-list">${cropCards}</div>
    </div>
    <div class="calc-knowledge-section">
      <div class="calc-knowledge-section-head">
        <div>
          <b>ข้อความประกอบรายสินค้า</b>
          <span>ไว้ควบคุมคำอธิบายสั้นและความเข้มเริ่มต้นของแต่ละตัว</span>
        </div>
      </div>
      <div class="calc-product-knowledge-list">${productCards}</div>
    </div>
  </div>`;
}
function serializeCalcKnowledgeEditor(root = document) {
  const data = { crops: {}, products: {} };
  root.querySelectorAll('[data-calc-crop-card]').forEach((card) => {
    const crop = String(card.dataset.cropName || '').trim();
    if (!crop) return;
    const waterPerRai = Math.max(1, parseFloat(card.querySelector('[data-crop-water]')?.value || '60') || 60);
    const mixes = [...card.querySelectorAll('[data-mix-row]')].map((row, idx) => {
      const stage = String(row.querySelector('[data-mix-field="stage"]')?.value || '').trim() || CALC_STAGE_TEMPLATE_OPTIONS[0];
      const title = String(row.querySelector('[data-mix-field="title"]')?.value || '').trim();
      const note = String(row.querySelector('[data-mix-field="note"]')?.value || '').trim();
      const ids = [...row.querySelectorAll('[data-mix-product]:checked')].map((input) => input.value).filter(Boolean);
      return {
        key: `${slugifyCrop(crop)}-${slugifyCrop(stage || 'stage')}-${slugifyCrop(title || `mix-${idx + 1}`) || `mix-${idx + 1}`}`,
        stage,
        title,
        ids,
        note,
      };
    }).filter((item) => item.title && item.ids.length);
    data.crops[crop] = { waterPerRai, mixes };
  });
  root.querySelectorAll('[data-product-knowledge]').forEach((card) => {
    const id = String(card.dataset.productKnowledge || '').trim();
    if (!id) return;
    data.products[id] = {
      label: String(card.querySelector('[data-product-field="label"]')?.value || '').trim(),
      preferredStrength: String(card.querySelector('[data-product-field="preferredStrength"]')?.value || 'mid').trim(),
      note: String(card.querySelector('[data-product-field="note"]')?.value || '').trim(),
    };
  });
  return JSON.stringify(data, null, 2);
}
function syncCalcKnowledgeEditor(root = document) {
  const input = root.querySelector('#calcKnowledgeJson');
  if (!input) return '';
  const raw = serializeCalcKnowledgeEditor(root);
  input.value = raw;
  return raw;
}
function setCalcCropEditorCollapsed(card, collapsed = false) {
  if (!card) return;
  card.classList.toggle('is-collapsed', !!collapsed);
  const btn = card.querySelector('[data-togglecalccrop]');
  if (btn) btn.textContent = collapsed ? 'ขยาย' : 'ย่อ';
  updateCalcKnowledgeCropSummary(card);
}
async function copyTextToClipboard(text = '') {
  const value = String(text || '');
  if (!value) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }
  const holder = document.createElement('textarea');
  holder.value = value;
  holder.setAttribute('readonly', 'readonly');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  holder.style.pointerEvents = 'none';
  document.body.appendChild(holder);
  holder.select();
  holder.setSelectionRange(0, holder.value.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  holder.remove();
  return ok;
}
function calcUsageMode() {
  return window.__calcMode || 'tank';
}
function setCalcUsageMode(mode) {
  window.__calcMode = ['tank', 'water', 'area'].includes(mode) ? mode : 'tank';
}
function calcModeFields() {
  const mode = calcUsageMode();
  const tankSize = parseFloat(document.getElementById('calcPageTank')?.value || '20') || 20;
  const tankCount = parseFloat(document.getElementById('calcTankCount')?.value || '1') || 1;
  const waterTotal = parseFloat(document.getElementById('calcWaterTotal')?.value || '20') || 20;
  const areaRai = parseFloat(document.getElementById('calcAreaRai')?.value || '1') || 1;
  const waterPerRai = parseFloat(document.getElementById('calcWaterPerRai')?.value || '60') || 60;
  const refTank = parseFloat(document.getElementById('calcRefTank')?.value || tankSize || '20') || 20;
  const totalWater = mode === 'tank'
    ? tankSize * tankCount
    : mode === 'water'
      ? waterTotal
      : areaRai * waterPerRai;
  return { mode, tankSize, tankCount, waterTotal, areaRai, waterPerRai, refTank, totalWater };
}
function renderCalcModeState() {
  const mode = calcUsageMode();
  const page = document.querySelector('.calc-page');
  if (page) page.dataset.calcMode = mode;
  document.querySelectorAll('[data-calcmode]').forEach((btn) => btn.classList.toggle('on', btn.dataset.calcmode === mode));
}
function calcHintsHTML(p, profile, totalWater, strength, includeSticker) {
  const hints = [];
  const extra = productExtra(p);
  if (profile.research?.title) hints.push(profile.research.title);
  if (profile.research?.interval) hints.push(`รอบพ่นแนะนำ: ${profile.research.interval}`);
  if (asArray(extra.cropTargets).length) hints.push(`เหมาะกับ ${extra.cropTargets.join(' / ')}`);
  if (totalWater > 0) hints.push(`น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร`);
  if (strength === 'low') hints.push('โหมดเริ่มต้น: เหมาะกับการเริ่มลองหรือพืชอ่อน');
  if (strength === 'high') hints.push('โหมดเข้ม: เหมาะกับแปลงที่ต้องการคุมผลลัพธ์เข้มขึ้น');
  if (includeSticker && profile.stickerProduct) hints.push(`เพิ่ม ${profile.stickerProduct.name} เพื่อช่วยการเกาะใบ`);
  return hints.slice(0, 6).map((item) => `<span>${esc(item)}</span>`).join('');
}
function isAgriProduct(p) { return productSegment(p) === 'agri'; }
function lineCTA(extraClass = '') {
  const url = S('LINE_OA_URL');
  const cls = ['line-add', extraClass].filter(Boolean).join(' ');
  return url ? `<a class="${cls}" href="${esc(url)}" target="_blank" rel="noopener" data-linecta>เพิ่มเพื่อน LINE</a>` : '';
}

// ── analytics / pixels ──
const loadedScripts = new Set();
let marketingReady = false;
function loadScriptOnce(src) {
  if (!src || loadedScripts.has(src)) return;
  loadedScripts.add(src);
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}
function initMarketing() {
  if (marketingReady) return;
  marketingReady = true;
  const ga4 = S('GA4_ID').trim();
  if (ga4) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    loadScriptOnce(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`);
    window.gtag('js', new Date());
    window.gtag('config', ga4, { send_page_view: false });
  }
  const meta = S('META_PIXEL_ID').trim();
  if (meta && !window.fbq) {
    window.fbq = function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
    window.fbq.q = window.fbq.q || [];
    window.fbq.loaded = true;
    window.fbq.version = '2.0';
    loadScriptOnce('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', meta);
  }
  const tiktok = S('TIKTOK_PIXEL_ID').trim();
  if (tiktok && !window.ttq) {
    const ttq = window.ttq = window.ttq || [];
    ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat([].slice.call(arguments, 0))); }; };
    for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
    ttq.instance = function (t) { const e = ttq._i[t] || []; for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e; };
    ttq._i = ttq._i || {};
    ttq._i[tiktok] = [];
    ttq.load = ttq.load || function () { loadScriptOnce('https://analytics.tiktok.com/i18n/pixel/events.js'); };
    ttq.load(tiktok);
    ttq.page();
  }
}
function trackEvent(name, params = {}) {
  initMarketing();
  const payload = { ...params };
  if (window.gtag && S('GA4_ID')) window.gtag('event', name, payload);
  if (window.fbq && S('META_PIXEL_ID')) {
    const map = { page_view: 'PageView', lead_submit: 'Lead', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', line_click: 'Contact' };
    if (map[name]) window.fbq('track', map[name], payload);
    else window.fbq('trackCustom', name, payload);
  }
  if (window.ttq && S('TIKTOK_PIXEL_ID')) {
    const map = { page_view: 'PageView', lead_submit: 'SubmitForm', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', line_click: 'Contact' };
    window.ttq.track(map[name] || name, payload);
  }
}
function trackPageView(path, title = document.title) {
  trackEvent('page_view', { page_path: path, page_title: title });
}
function markTracked(key) {
  if (!key) return false;
  if (sessionStorage.getItem(key)) return true;
  sessionStorage.setItem(key, '1');
  return false;
}

// ── marketing attribution / lead source ──
const ATTR_KEY = 'leadAttribution';
let leadAttribution = {};
function loadAttribution() {
  try { return JSON.parse(localStorage.getItem(ATTR_KEY) || '{}') || {}; }
  catch { return {}; }
}
function saveAttribution() { localStorage.setItem(ATTR_KEY, JSON.stringify(leadAttribution)); }
function detectSourceLabel(hostname) {
  if (!hostname) return 'referral';
  if (hostname.includes('facebook') || hostname.includes('fb.')) return 'facebook';
  if (hostname.includes('instagram')) return 'instagram';
  if (hostname.includes('google')) return 'google';
  if (hostname.includes('line')) return 'line';
  if (hostname.includes('tiktok')) return 'tiktok';
  return hostname.replace(/^www\./, '');
}
function captureAttribution() {
  const url = new URL(location.href);
  const next = { ...loadAttribution() };
  const utmSource = (url.searchParams.get('utm_source') || '').trim();
  const utmMedium = (url.searchParams.get('utm_medium') || '').trim();
  const utmCampaign = (url.searchParams.get('utm_campaign') || '').trim();
  if (utmSource) next.utmSource = utmSource;
  if (utmMedium) next.utmMedium = utmMedium;
  if (utmCampaign) next.utmCampaign = utmCampaign;
  if (!next.source) {
    if (utmSource) next.source = `${utmSource}${utmMedium ? '/' + utmMedium : ''}`;
    else if (document.referrer) {
      try { next.source = detectSourceLabel(new URL(document.referrer).hostname); }
      catch { next.source = 'referral'; }
    } else next.source = 'direct';
  }
  next.landingPage = url.pathname + url.search + url.hash;
  next.capturedAt = next.capturedAt || Date.now();
  leadAttribution = next;
  saveAttribution();
}

function renderAccountNav() {
  const el = document.getElementById('navAccount');
  if (!el) return;
  if (currentUser) {
    const accountLabel = currentUser.role === 'admin' ? 'ADMIN' : 'MEMBER';
    el.innerHTML =
      (currentUser.role === 'admin' ? `<a href="${routeHref('/admin')}" class="nav-admin" style="background:linear-gradient(135deg,#7b5cff,#9c63ff);background-color:#7b5cff;color:#fff;-webkit-text-fill-color:#fff;border-color:transparent;box-shadow:0 16px 28px -18px rgba(123,92,255,.75)">หลังบ้าน</a>` : '') +
      `<a href="${routeHref('/account')}" class="nav-acc">${accountLabel}</a>`;
  } else {
    el.innerHTML = `<a href="${routeHref('/login')}" class="nav-acc">เข้าสู่ระบบ</a>`;
  }
}

let mobileNavOpen = false;
function isMobileNav() { return window.innerWidth <= 980; }
function syncMobileNav() {
  const nav = document.querySelector('.nav');
  const panel = document.getElementById('navPanel');
  const burger = document.getElementById('navBurger');
  const dim = document.getElementById('navDim');
  if (!nav || !panel || !burger || !dim) return;
  const open = isMobileNav() && mobileNavOpen;
  nav.classList.toggle('menu-open', open);
  panel.classList.toggle('open', open);
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  dim.classList.toggle('show', open);
  document.body.classList.toggle('nav-open', open);
}
function closeMobileNav() {
  if (!mobileNavOpen) return;
  mobileNavOpen = false;
  syncMobileNav();
}
function toggleMobileNav() {
  if (!isMobileNav()) return;
  mobileNavOpen = !mobileNavOpen;
  syncMobileNav();
}

// toast
function toast(msg, type = 'info') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'toast show ' + type;
  clearTimeout(t._t); t._t = setTimeout(() => (t.className = 'toast'), 2800);
}

// ── Wishlist (localStorage) ──
let wishlist = new Set(JSON.parse(localStorage.getItem('wishlist') || '[]'));
function saveWishlist() { localStorage.setItem('wishlist', JSON.stringify([...wishlist])); renderWishCount(); }
function toggleWishlist(id) { wishlist.has(id) ? wishlist.delete(id) : wishlist.add(id); saveWishlist(); }
function renderWishCount() {
  const el = document.getElementById('wishCount'); if (!el) return;
  const link = document.getElementById('wishLink');
  el.textContent = wishlist.size;
  el.style.display = wishlist.size ? 'grid' : 'none';
  if (link) link.classList.toggle('has-items', wishlist.size > 0);
}
function heartBtn(id) {
  return `<button class="wish-btn ${wishlist.has(id) ? 'on' : ''}" data-wish="${id}" aria-label="รายการโปรด">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20.7 10.6 19.4C5.4 14.7 2 11.6 2 7.8 2 4.9 4.2 2.7 7.1 2.7c1.7 0 3.4.8 4.5 2.1 1.1-1.3 2.8-2.1 4.5-2.1 2.9 0 5.1 2.2 5.1 5.1 0 3.8-3.4 6.9-8.6 11.6L12 20.7Z"/>
    </svg>
  </button>`;
}

// ── star rating ──
function stars(rating) {
  const r = Math.round(rating || 0);
  let s = ''; for (let i = 1; i <= 5; i++) s += `<span class="${i <= r ? 'on' : ''}">★</span>`;
  return `<span class="stars">${s}</span>`;
}

// ── model-viewer (3D .glb) loader ──
let _mvLoaded = false;
function ensureModelViewer() {
  if (_mvLoaded) return; _mvLoaded = true;
  const s = document.createElement('script'); s.type = 'module';
  s.src = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js';
  document.head.appendChild(s);
}

// ── flash sale banner + countdown ──
let _saleTimer = null;
function renderSaleBanner() {
  const el = document.getElementById('saleBanner'); if (!el) return;
  if (_saleTimer) { clearInterval(_saleTimer); _saleTimer = null; }
  const active = S('SALE_ACTIVE') === '1' && (parseInt(S('SALE_PERCENT'), 10) || 0) > 0;
  const ends = S('SALE_ENDS') ? Date.parse(S('SALE_ENDS')) : 0;
  const live = active && (!ends || ends > Date.now());
  if (!live) { el.classList.remove('show'); el.innerHTML = ''; document.body.classList.remove('has-sale'); return; }
  el.classList.add('show'); document.body.classList.add('has-sale');
  const tick = () => {
    let cd = '';
    if (ends) {
      const d = ends - Date.now();
      if (d <= 0) return renderSaleBanner();
      const h = Math.floor(d / 3.6e6), m = Math.floor((d % 3.6e6) / 6e4), s = Math.floor((d % 6e4) / 1e3);
      cd = ` · หมดใน ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    el.innerHTML = `<a href="${routeHref('/products')}">⚡ ${esc(S('SALE_TEXT') || 'FLASH SALE')} · ลดทั้งร้าน ${parseInt(S('SALE_PERCENT'), 10)}%${cd} →</a>`;
  };
  tick(); if (ends) _saleTimer = setInterval(tick, 1000);
}

let appliedCoupon = null;        // { code, discount }
// cart: id -> qty (persist ใน localStorage)
const cart = new Map(Object.entries(JSON.parse(localStorage.getItem('cart') || '{}')));
function saveCart() { localStorage.setItem('cart', JSON.stringify(Object.fromEntries(cart))); }
const baht = (n) => '฿' + n.toLocaleString();
const effPrice = (p) => (p && p.salePrice && p.salePrice < p.price) ? p.salePrice : (p ? p.price : 0);
function priceHTML(p) {
  return effPrice(p) < p.price
    ? `<span class="price"><span class="price-old">${baht(p.price)}</span> ${baht(effPrice(p))}</span>`
    : `<span class="price">${baht(p.price)}</span>`;
}

// ════════════════════════ SVG icons ════════════════════════
const ICO = {
  pod: `<rect x="23" y="6" width="18" height="52" rx="7"/><rect x="28" y="15" width="8" height="15" rx="2" fill="url(#ig)" stroke="none" opacity=".9"/><line x1="28" y1="50" x2="36" y2="50"/>`,
  mod: `<rect x="20" y="8" width="24" height="48" rx="8"/><path d="M34 19l-9 15h7l-2 11 10-17h-6z" fill="url(#ig)" stroke="none"/>`,
  cartridge: `<rect x="24" y="9" width="16" height="46" rx="6"/><path d="M32 21c-4 5-6 8-6 11a6 6 0 0 0 12 0c0-3-2-6-6-11z" fill="url(#ig)" stroke="none"/>`,
  coil: `<circle cx="32" cy="32" r="13"/><circle cx="32" cy="32" r="8"/><circle cx="32" cy="32" r="3.4" fill="url(#ig)" stroke="none"/><path d="M19 32h-5"/><path d="M50 32h-5"/>`,
  case: `<rect x="13" y="20" width="38" height="26" rx="6"/><path d="M13 30h38"/><path d="M38 30l5 5"/><circle cx="38" cy="30" r="2.2" fill="url(#ig)" stroke="none"/>`,
  charger: `<path d="M26 11v9"/><path d="M38 11v9"/><rect x="21" y="20" width="22" height="15" rx="4"/><path d="M32 35v7a6 6 0 0 0 6 6h6"/>`,
  cpu: `<rect x="21" y="21" width="22" height="22" rx="4"/><rect x="28" y="28" width="8" height="8" rx="1.5" fill="url(#ig)" stroke="none"/><path d="M27 21v-5M37 21v-5M27 48v-5M37 48v-5M21 27h-5M21 37h-5M48 27h5M48 37h5"/>`,
  battery: `<rect x="12" y="23" width="34" height="18" rx="4"/><path d="M46 29h4v6h-4"/><path d="M29 26l-6 8h6l-2 6 7-8h-5z" fill="url(#ig)" stroke="none"/>`,
  diamond: `<path d="M22 25h20l-10 27z"/><path d="M22 25l4-8h12l4 8"/><path d="M32 52l-5-27M32 52l5-27"/>`,
  chat: `<path d="M14 17h36a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H30l-9 8v-8h-7a3 3 0 0 1-3-3V20a3 3 0 0 1 3-3z"/><circle cx="24" cy="29" r="2.2" fill="url(#ig)" stroke="none"/><circle cx="32" cy="29" r="2.2" fill="url(#ig)" stroke="none"/><circle cx="40" cy="29" r="2.2" fill="url(#ig)" stroke="none"/>`,
  truck: `<rect x="8" y="22" width="27" height="19" rx="2"/><path d="M35 28h8l7 7v6h-15z"/><circle cx="18" cy="45" r="4"/><circle cx="43" cy="45" r="4"/>`,
  shield: `<path d="M32 8l18 7v13c0 12-8 20-18 25-10-5-18-13-18-25V15z"/><path d="M24 31l5 5 10-12"/>`,
  // ── agriculture / health ──
  leaf: `<path d="M48 14C26 14 16 27 16 44c0 0 22 4 32-8 8-10 0-22 0-22z"/><path d="M22 44c8-12 18-18 24-20"/>`,
  sprout: `<path d="M32 56V30"/><path d="M22 56h20"/><path d="M32 32C23 32 17 26 17 17c9 0 15 6 15 15z" fill="url(#ig)" stroke="none"/><path d="M32 28c8 0 14-6 14-14-8 0-14 6-14 14z" fill="url(#ig)" stroke="none"/>`,
  drop: `<path d="M32 10c-8 10-13 16-13 24a13 13 0 0 0 26 0c0-8-5-14-13-24z"/><path d="M27 38a5 6 0 0 0 5 6" stroke-width="2"/>`,
  bottle: `<path d="M25 27h13v25a4 4 0 0 1-4 4h-5a4 4 0 0 1-4-4z"/><path d="M28 27v-6h7v6"/><path d="M35 13h9M44 13v6l-6 4"/>`,
  soap: `<rect x="15" y="27" width="34" height="20" rx="7"/><path d="M21 23c2-2 6-2 8 0M35 21c2-2 5-2 7 0"/>`,
  herb: `<path d="M32 56V22"/><path d="M32 32c-6 0-10-4-10-11 6 0 10 4 10 11zM32 40c6 0 10-4 10-11-6 0-10 4-10 11z" fill="url(#ig)" stroke="none"/>`,
  health: `<path d="M32 50S15 39 15 27a9 9 0 0 1 17-3 9 9 0 0 1 17 3c0 12-17 23-17 23z"/>`,
  shieldleaf: `<path d="M32 8l18 7v12c0 12-8 20-18 25-10-5-18-13-18-25V15z"/><path d="M41 23c-12 0-16 8-16 8s3 1 8-1c-1 4-3 7-3 7s9-2 11-8 0-6 0-6z" fill="url(#ig)" stroke="none"/>`,
};
const PROD_ICON = { p1: 'pod', p2: 'mod', p3: 'cartridge', p4: 'coil', p5: 'case', p6: 'charger' };

function icon(name, cls = 'ico') {
  return `<span class="${cls}"><svg viewBox="0 0 64 64" fill="none"><g stroke="url(#ig)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICO[name] || ICO.pod}</g></svg></span>`;
}
function productIcon(id, cls = 'ico') { return icon(PROD_ICON[id] || 'pod', cls); }

function addToCart(id, qty = 1) {
  cart.set(id, (Number(cart.get(id)) || 0) + qty);
  saveCart(); renderCart();
}
function cartCount() { let c = 0; cart.forEach((q) => (c += Number(q))); return c; }
function cartTotal() { let t = 0; cart.forEach((q, id) => { const p = productById(id); if (p) t += effPrice(p) * Number(q); }); return t; }
function calcBundlePlan(raw = '') {
  let plan = [];
  try { plan = JSON.parse(raw || '[]'); } catch {}
  if (!Array.isArray(plan)) return [];
  return plan
    .map((item) => ({
      id: String(item?.id || '').trim(),
      qty: Math.max(1, parseInt(item?.qty, 10) || 1),
      packSize: Math.max(0, parseFloat(item?.packSize || '0') || 0),
    }))
    .filter((item) => item.id && productById(item.id));
}
function applyCartPlan(plan = [], { replace = false } = {}) {
  const items = asArray(plan).filter((item) => item?.id && productById(item.id));
  if (!items.length) return 0;
  if (replace) cart.clear();
  items.forEach((item) => {
    const qty = Math.max(1, parseInt(item.qty, 10) || 1);
    cart.set(item.id, replace ? qty : ((Number(cart.get(item.id)) || 0) + qty));
  });
  saveCart();
  renderCart();
  return items.reduce((sum, item) => sum + (Math.max(1, parseInt(item.qty, 10) || 1)), 0);
}
function checkoutFromCalcPlan(raw = '') {
  const plan = calcBundlePlan(raw);
  if (!plan.length) {
    toast('ยังไม่มีชุดสูตรให้สั่งซื้อทันที', 'err');
    return;
  }
  const totalQty = applyCartPlan(plan, { replace: true });
  openCart();
  toast(`เตรียมชุดสูตรนี้ไว้ ${totalQty} ขวด แล้วพาไปขั้นตอนสั่งซื้อ`, 'ok');
  setTimeout(() => {
    closeCart();
    go('/checkout');
    requestAnimationFrame(() => scrollTo({ top: 0, behavior: 'smooth' }));
  }, 220);
}
// ── shipping (client-side display; server is authoritative) ──
function shipFee(country, amount) {
  const home = (S('SHIP_HOME') || 'ไทย').trim();
  const freeOver = parseInt(S('SHIP_FREE_OVER'), 10) || 0;
  if (freeOver && amount >= freeOver) return 0;
  const isHome = !country || country.trim() === home;
  return parseInt(isHome ? S('SHIP_FEE') : S('SHIP_INTL_FEE'), 10) || 0;
}

// ════════════════════════ Cart drawer (persistent) ════════════════════════
const cartDrawer = document.getElementById('cartDrawer');
const backdrop = document.getElementById('cartBackdrop');
const cartItemsEl = document.getElementById('cartItems');

function renderCart() {
  document.getElementById('cartCount').textContent = cartCount();
  document.getElementById('cartTotal').textContent = baht(cartTotal());
  cartItemsEl.innerHTML = '';
  if (cart.size === 0) { cartItemsEl.innerHTML = '<div class="empty">ตะกร้ายังว่างอยู่</div>'; return; }
  cart.forEach((qty, id) => {
    const p = productById(id); if (!p) return;
    const row = document.createElement('div');
    row.className = 'cart-row';
    const media = p.image
      ? `<div class="cart-media"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div>`
      : `<div class="cart-media">${productVisual(p, 'mini-ico')}</div>`;
    row.innerHTML = `
      <div class="cart-main">${media}<div class="cart-copy"><div class="nm">${p.name}</div><div class="pr">${baht(effPrice(p))}</div></div></div>
      <div class="qty"><button data-dec="${id}">−</button><span>${qty}</span><button data-inc="${id}">+</button></div>`;
    cartItemsEl.appendChild(row);
  });
}
function openCart() { cartDrawer.classList.add('open'); backdrop.classList.add('show'); }
function closeCart() { cartDrawer.classList.remove('open'); backdrop.classList.remove('show'); }
document.getElementById('cartLink').onclick = openCart;
document.getElementById('cartClose').onclick = closeCart;
backdrop.onclick = closeCart;
document.getElementById('checkoutBtn').onclick = () => { closeCart(); go('/checkout'); };

// ════════════════════════ Views ════════════════════════
function productVisual(p, cls = 'ico') {
  return p.image ? `<span class="${cls} pimg"><img src="${p.image}" alt="${esc(p.name)}" loading="lazy"></span>` : icon(p.icon || 'pod', cls);
}
// สื่อขนาดใหญ่ (วิดีโอ > รูปซูมได้ > ไอคอน) สำหรับหน้ารายละเอียด/quick view
function productMedia(p) {
  if (p.video) return `<video class="media-el" controls muted loop playsinline ${p.image ? `poster="${p.image}"` : ''} src="${p.video}"></video>`;
  if (p.image) return `<img class="media-el zoomable" src="${p.image}" alt="${esc(p.name)}" data-zoom="${p.image}">`;
  return icon(p.icon || 'pod', 'd-ico');
}
function productCard(p, i = 0) {
  const media = p.video
    ? `<video class="card-vid" muted loop playsinline preload="metadata" ${p.image ? `poster="${p.image}"` : ''} src="${p.video}"></video>`
    : productVisual(p);
  const out = p.stock <= 0;
  const onSale = effPrice(p) < p.price;
  return `<a class="card glass reveal ${out ? 'soldout' : ''}" href="${routeHref('/product/' + p.id)}" style="transition-delay:${(i % 3) * 0.07}s">
    <div class="thumb">${onSale ? `<span class="sale-badge">-${Math.round((1 - effPrice(p) / p.price) * 100)}%</span>` : ''}${p.video ? '<span class="vid-badge">▶</span>' : ''}${p.model ? '<span class="vid-badge model-badge">3D</span>' : ''}${heartBtn(p.id)}<span class="glow"></span>${media}
      ${out ? '<span class="soldout-tag">สินค้าหมด</span>' : `<button class="qv-btn" data-quick="${p.id}">ดูเร็ว</button>`}</div>
    <div class="body">
      <span class="tag">${p.tag}</span>
      <h3>${p.name}</h3>
      ${p.reviews ? `<div class="card-rate">${stars(p.rating)}<small>(${p.reviews})</small></div>` : ''}
      <p class="desc">${p.short}</p>
      <div class="row">
        ${priceHTML(p)}
        ${out ? '<button class="add" disabled>หมด</button>' : `<button class="add" data-add="${p.id}">เพิ่ม +</button>`}
      </div>
    </div></a>`;
}

// ── Quick View modal ──
function openQuickView(id) {
  const p = productById(id); if (!p) return;
  let m = document.getElementById('quickModal');
  if (!m) { m = document.createElement('div'); m.id = 'quickModal'; m.className = 'qv-overlay'; document.body.appendChild(m); }
  m.innerHTML = `<div class="qv-card glass">
    <button class="qv-close" data-qvclose>✕</button>
    <div class="qv-media media3d" data-tilt>${productMedia(p)}</div>
    <div class="qv-info">
      ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
      <h2>${esc(p.name)}</h2>
      <div class="d-price">${baht(p.price)}</div>
      <p class="muted">${esc(p.short || '')}</p>
      <div class="d-actions">
        <button class="btn btn-primary" data-add="${p.id}">เพิ่มลงตะกร้า</button>
        <a class="btn btn-glass" href="${routeHref('/product/' + p.id)}" data-qvclose>ดูรายละเอียดเต็ม →</a>
      </div>
    </div></div>`;
  requestAnimationFrame(() => m.classList.add('show'));
  attachTilt(m);
}
function closeQuickView() { const m = document.getElementById('quickModal'); if (m) m.classList.remove('show'); }

// ── Lightbox / Slider ──
let lightboxState = { items: [], index: 0 };
function lightboxItemsFromTrigger(trigger) {
  if (!trigger) return [];
  const group = String(trigger.dataset.lightboxGroup || '').trim();
  const nodes = group ? [...document.querySelectorAll(`[data-lightbox-group="${group}"]`)] : [trigger];
  return nodes.map((node) => ({
    src: String(node.dataset.zoom || node.getAttribute('href') || '').trim(),
    title: String(node.dataset.lightboxTitle || node.getAttribute('title') || '').trim(),
    note: String(node.dataset.lightboxNote || '').trim(),
  })).filter((item) => item.src);
}
function lightboxIndexFromTrigger(trigger, items) {
  const raw = parseInt(trigger?.dataset.lightboxIndex || '0', 10);
  if (Number.isFinite(raw) && raw >= 0 && raw < items.length) return raw;
  const src = String(trigger?.dataset.zoom || trigger?.getAttribute('href') || '').trim();
  const found = items.findIndex((item) => item.src === src);
  return found > -1 ? found : 0;
}
function renderLightbox() {
  const l = document.getElementById('lightbox');
  const item = lightboxState.items[lightboxState.index];
  if (!l || !item) return;
  const multiple = lightboxState.items.length > 1;
  l.innerHTML = `<div class="lb-dialog" role="dialog" aria-modal="true" aria-label="รูปภาพขยาย">
    <button class="lb-close" aria-label="ปิด">✕</button>
    ${multiple ? `<button class="lb-nav is-prev" type="button" data-lbnav="-1" aria-label="รูปก่อนหน้า">‹</button>
    <button class="lb-nav is-next" type="button" data-lbnav="1" aria-label="รูปถัดไป">›</button>` : ''}
    <img src="${esc(item.src)}" alt="${esc(item.title || '')}">
    ${(item.title || item.note || multiple) ? `<div class="lb-caption">
      ${multiple ? `<span class="lb-count">${lightboxState.index + 1} / ${lightboxState.items.length}</span>` : ''}
      ${item.title ? `<b>${esc(item.title)}</b>` : ''}
      ${item.note ? `<span>${esc(item.note)}</span>` : ''}
    </div>` : ''}
    ${multiple ? `<div class="lb-thumbs">${lightboxState.items.map((thumb, idx) => `<button class="lb-thumb ${idx === lightboxState.index ? 'is-active' : ''}" type="button" data-lbindex="${idx}" aria-label="ดูรูปที่ ${idx + 1}">
      <img src="${esc(thumb.src)}" alt="${esc(thumb.title || '')}">
    </button>`).join('')}</div>` : ''}
  </div>`;
}
function openLightbox(triggerOrSrc) {
  let l = document.getElementById('lightbox');
  if (!l) { l = document.createElement('div'); l.id = 'lightbox'; l.className = 'lb-overlay'; document.body.appendChild(l); }
  if (typeof triggerOrSrc === 'string') {
    lightboxState = { items: [{ src: triggerOrSrc, title: '', note: '' }], index: 0 };
  } else {
    const items = lightboxItemsFromTrigger(triggerOrSrc);
    lightboxState = { items: items.length ? items : [{ src: String(triggerOrSrc?.dataset.zoom || '').trim(), title: '', note: '' }], index: lightboxIndexFromTrigger(triggerOrSrc, items.length ? items : [{ src: String(triggerOrSrc?.dataset.zoom || '').trim() }]) };
  }
  renderLightbox();
  requestAnimationFrame(() => l.classList.add('show'));
}
function moveLightbox(step = 1) {
  if (!lightboxState.items.length) return;
  lightboxState.index = (lightboxState.index + step + lightboxState.items.length) % lightboxState.items.length;
  renderLightbox();
}
function setLightboxIndex(index = 0) {
  if (!lightboxState.items.length) return;
  if (!Number.isFinite(index)) return;
  lightboxState.index = Math.max(0, Math.min(lightboxState.items.length - 1, index));
  renderLightbox();
}
function closeLightbox() { const l = document.getElementById('lightbox'); if (l) l.classList.remove('show'); }

// ── 3D tilt (ลื่นด้วย rAF, หยุดเองเมื่อนิ่ง) ──
function attachTilt(root = document) {
  if (!window.matchMedia('(hover: hover)').matches) return;
  root.querySelectorAll('[data-tilt]').forEach((el) => {
    if (el._tilt) return; el._tilt = true;
    let tx = 0, ty = 0, cx = 0, cy = 0, raf = 0, active = false;
    const loop = () => {
      cx += (tx - cx) * 0.12; cy += (ty - cy) * 0.12;
      el.style.transform = `perspective(900px) rotateX(${cy.toFixed(2)}deg) rotateY(${cx.toFixed(2)}deg)`;
      raf = (active || Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) ? requestAnimationFrame(loop) : 0;
    };
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 16;
      ty = -((e.clientY - r.top) / r.height - 0.5) * 16;
      if (!raf) raf = requestAnimationFrame(loop);
    }, { passive: true });
    el.addEventListener('pointerenter', () => { active = true; if (!raf) raf = requestAnimationFrame(loop); });
    el.addEventListener('pointerleave', () => { active = false; tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(loop); });
  });
}

function viewHome() {
  setPageMeta('', '');
  const featured = PRODUCTS.filter(isAgriProduct).slice(0, 2);
  const lifestyle = PRODUCTS.filter((p) => !isAgriProduct(p)).slice(0, 2);
  const trustItems = settingLines('SITE_TRUST_ITEMS', DEFAULT_TRUST_ITEMS);
  const caseStudies = settingPairs('SITE_CASE_STUDIES', DEFAULT_CASE_STUDIES).slice(0, 2);
  const guideMap = cropGuideMap();
  const leadCropOptions = [...new Set([...Object.keys(guideMap), ...calcCropList()])].filter(Boolean);
  const slugMap = cropSlugMap();
  const cropCards = Object.entries(guideMap).slice(0, 4).map(([crop, cfg], i) => {
    const slug = slugMap[crop] || '';
    return `<a class="crop-shortcut glass reveal" style="transition-delay:${(i % 3) * 0.07}s" href="${slug ? `/crops/${slug}` : routeHref('/products')}">
      <b>${esc(crop)}</b>
      <span>${esc(cfg.tip)}</span>
    </a>`;
  }).join('');
  const quickStart = [
    { title: 'ดูสูตรตามพืช', desc: 'ทุเรียน มะม่วง ข้าว และพืชผัก', href: routeHref('/products') },
    { title: 'คำนวณอัตราผสม', desc: 'เปิดเครื่องมือแล้วเลือกสูตรได้ทันที', href: routeHref('/calc') },
    { title: 'ขอคำปรึกษาฟรี', desc: 'กรอกฟอร์มสั้น ๆ แล้วให้ทีมงานติดต่อกลับ', action: 'lead' },
  ];
  return `
  <section class="hero hero-compact">
    <div class="hero-copy">
      <div class="pill reveal"><span class="pulse"></span>${esc(S('SITE_ANNOUNCE'))}</div>
      <h1 class="reveal">${esc(S('SITE_HERO_TITLE'))}<span class="grad">${esc(S('SITE_HERO_ACCENT'))}</span><br />${esc(S('SITE_HERO_TITLE2'))}</h1>
      <p class="reveal">${esc(S('SITE_HERO_SUB'))}</p>
      <div class="hero-cta reveal">
        <a href="${routeHref('/products')}" class="btn btn-primary">เลือกซื้อสินค้า</a>
        <button class="btn btn-glass" type="button" data-scrolllead>ขอคำปรึกษาฟรี</button>
        ${lineCTA()}
      </div>
      <div class="hero-meta reveal">
        <div><b>10+</b><span>สูตรในร้าน</span></div>
        <div><b>24/7</b><span>แชตปรึกษาได้</span></div>
        <div><b>1–2 วัน</b><span>จัดส่งด่วน</span></div>
      </div>
    </div>
    <div class="hero-visual hero-panel reveal">
      <div class="hero-quick glass">
        <span class="eyebrow">เริ่มต้นง่าย</span>
        <h3>เห็นจุดสำคัญตั้งแต่หน้าจอแรก</h3>
        <div class="hero-quick-list">
          ${quickStart.map((item) => item.action === 'lead'
            ? `<button type="button" class="hero-quick-item" data-scrolllead><b>${esc(item.title)}</b><span>${esc(item.desc)}</span></button>`
            : `<a class="hero-quick-item" href="${item.href}"><b>${esc(item.title)}</b><span>${esc(item.desc)}</span></a>`).join('')}
        </div>
        <div class="hero-mini-proof">
          ${trustItems.map((item) => `<span>${esc(item)}</span>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="section-head reveal"><span class="eyebrow">สินค้าแนะนำ</span><h2>เริ่มจากสูตรหลักที่ลูกค้าตัดสินใจง่ายก่อน</h2></div>
    <div class="products">${featured.map((p, i) => productCard(p, i)).join('')}</div>
    <div class="compact-actions reveal"><a href="${routeHref('/products')}" class="btn btn-glass">ดูสินค้าทั้งหมด →</a></div>
  </section>

  <section class="section section-tight">
    <div class="section-head reveal"><span class="eyebrow">สูตรตามพืช</span><h2>กดเข้าหน้าเฉพาะพืชได้ทันที</h2></div>
    <div class="crop-grid">${cropCards}</div>
  </section>

  <section class="section section-tight">
    <div class="consult-band glass reveal home-consult" id="leadFormBlock">
      <div class="consult-copy">
        <span class="eyebrow">ขอคำแนะนำเร็ว</span>
        <h2>กรอกสั้น ๆ แล้วให้ทีมงานช่วยเลือกสูตรต่อ</h2>
        <p>ลูกค้ากรอกเฉพาะข้อมูลหลักก่อน จากนั้นทีมงานค่อยโทรกลับหรือคุยต่อใน LINE เพื่อเก็บรายละเอียดและปิดการขาย</p>
        <div class="consult-points">
          <div>${icon('leaf', 'mini-ico')} เก็บชื่อ เบอร์ พืช และปัญหาหลักให้ครบก่อน</div>
          <div>${icon('chat', 'mini-ico')} ส่งต่อให้ทีมงานโทรกลับหรือคุยต่อใน LINE ได้ทันที</div>
          <div>${icon('truck', 'mini-ico')} เชื่อมต่อออเดอร์และการติดตามหลังการขายได้จริง</div>
        </div>
        <div class="inline-proof-grid">
          ${caseStudies.map((item) => `<article class="inline-proof-card"><b>${esc(item.title)}</b><span>${esc(item.detail)}</span></article>`).join('')}
        </div>
        ${lifestyle.length ? `<div class="subtle-link-list">
          <span>หมวดรองของแบรนด์:</span>
          ${lifestyle.map((p) => `<a href="${routeHref('/product/' + p.id)}">${esc(p.name)}</a>`).join('')}
          <a href="${routeHref('/products')}">ดูหมวดสุขภาพ/ความงาม</a>
        </div>` : ''}
        ${lineCTA('line-inline')}
      </div>
      <form id="leadForm" class="lead-form">
        <div class="lead-form-intro lead-wide"><b>ส่งต่อให้ทีมงานได้ทันที</b><span>กรอกเฉพาะข้อมูลสำคัญก่อน แล้วให้แอดมินโทรกลับหรือคุยต่อใน LINE</span></div>
        <label>ชื่อเกษตรกร / ลูกค้า<input name="name" required autocomplete="name" placeholder="ชื่อ-นามสกุล" /></label>
        <label>เบอร์โทร<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
        <label>พืชที่ปลูก<select name="crop" id="leadCrop">
          <option value="">เลือกพืช</option>
          ${leadCropOptions.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
        </select></label>
        <label>ช่วงการปลูก / ปัญหา<select name="stage">
          <option value="">เลือกช่วงหรือปัญหา</option>
          <option>เร่งโต/แตกกอ</option>
          <option>เร่งดอก</option>
          <option>บำรุงผล</option>
          <option>ใบเหลือง/พืชเครียด</option>
          <option>หน้าฝน/ต้องการสารจับใบ</option>
          <option>ยังไม่แน่ใจ ขอคำแนะนำ</option>
        </select></label>
        <label class="lead-wide">รายละเอียดเพิ่มเติม<textarea name="problem" rows="3" placeholder="เช่น ใบไม่เขียว เร่งดอก ผลร่วง โตช้า หรืออยากได้สูตรสำหรับพืชที่ปลูก"></textarea></label>
        <button type="submit" class="btn btn-primary lead-submit">ส่งข้อมูลให้ทีมงานติดต่อกลับ</button>
        <p class="form-note">หลังส่งแล้ว ทีมงานสามารถนำข้อมูลไปติดตามต่อใน LINE, โทร หรือใช้วัดผลแคมเปญโฆษณาได้</p>
      </form>
    </div>
  </section>`;
}

function calcWidget(p) {
  const profile = productRateProfile(p); if (!profile) return '';
  const r = profile.selectedRate;
  const sourceText = profile.research?.sourceLabel || 'อัตราจากข้อมูลสินค้าในระบบ';
  return `<div class="calc-box glass" data-per="${r.per}" data-min="${r.min}" data-max="${r.max}">
    <h3>🧮 คำนวณอัตราผสม</h3>
    <div class="calc-inline-grid">
      <label>ขนาดถังพ่น (ลิตร)<input type="number" class="calc-tank" value="20" min="1" max="2000"></label>
      <label>ความเข้ม<select class="calc-strength"><option value="low">เริ่มต้น</option><option value="mid" selected>กลาง</option><option value="high">เข้มขึ้น</option></select></label>
    </div>
    <div class="calc-out">ใช้ <b>${calcResult(r, 20, 'mid')}</b> ต่อถัง</div>
    <p class="muted" style="font-size:12px">อัตราที่ระบบใช้คำนวณ: ${esc(profile.research?.rateRaw || r.raw)} · ${esc(sourceText)}</p>
  </div>`;
}
function trustStrip(items) {
  return `<div class="trust-strip reveal">${items.map((item) => `<span class="trust-pill">${esc(item)}</span>`).join('')}</div>`;
}
function caseStudyCards(items) {
  return `<div class="proof-grid">${items.map((item) => `<article class="proof-card glass reveal"><span class="eyebrow">Use Case</span><h3>${esc(item.title)}</h3><p>${esc(item.detail)}</p></article>`).join('')}</div>`;
}
function landingLeadSection(landing) {
  const stages = asArray(landing.stages).map((stage) => stage.title);
  return `<section class="section">
    <div class="consult-band glass reveal landing-consult" id="leadFormBlock">
      <div class="consult-copy">
        <span class="eyebrow">เก็บลีดจากหน้า ${esc(landing.crop)}</span>
        <h2>ให้ลูกค้ากลุ่ม${esc(landing.crop)} ทิ้งข้อมูลไว้ได้ทันที</h2>
        <p>เหมาะกับการยิงแอดและทำ SEO เพราะลูกค้ากรอกเฉพาะข้อมูลหลักก่อน แล้วทีมงานค่อยติดตามต่อใน LINE หรือโทรกลับเพื่อปิดการขาย</p>
        <div class="consult-points">
          <div>${icon('leaf', 'mini-ico')} ระบุพืช ช่วงการปลูก และปัญหาได้ตรงหน้า</div>
          <div>${icon('chat', 'mini-ico')} ส่งต่อให้ทีมขายติดตามต่อผ่าน LINE และโทรกลับ</div>
          <div>${icon('shieldleaf', 'mini-ico')} ใช้เป็นหน้าเฉพาะแคมเปญเพื่อวัดผลแยกตามพืชได้</div>
        </div>
        ${lineCTA('line-inline')}
      </div>
      <form id="leadForm" class="lead-form lead-form-compact">
        <div class="lead-form-intro lead-wide"><b>ขอคำแนะนำเฉพาะแปลง</b><span>ฟอร์มนี้ส่งตรงให้ทีมงาน เพื่อใช้ติดตามลูกค้ากลุ่ม${esc(landing.crop)} ต่อได้ทันที</span></div>
        <input type="hidden" name="crop" value="${esc(landing.crop)}">
        <label>ชื่อเกษตรกร / ลูกค้า<input name="name" required autocomplete="name" placeholder="ชื่อ-นามสกุล" /></label>
        <label>เบอร์โทร<input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
        <label>จังหวัด<input name="province" autocomplete="address-level1" placeholder="เช่น จันทบุรี" /></label>
        <label>ช่วงการปลูก / เป้าหมาย<select name="stage">
          <option value="">เลือกช่วงหรือเป้าหมาย</option>
          ${stages.map((stage) => `<option value="${esc(stage)}">${esc(stage)}</option>`).join('')}
          <option value="ยังไม่แน่ใจ ขอคำแนะนำ">ยังไม่แน่ใจ ขอคำแนะนำ</option>
        </select></label>
        <label class="lead-wide">ปัญหาหรือเป้าหมายของแปลง<textarea name="problem" rows="3" placeholder="เช่น ใบไม่เขียว ผลร่วง อยากเร่งใบ หรืออยากได้สูตรบำรุงผล"></textarea></label>
        <button type="submit" class="btn btn-primary lead-submit">ส่งข้อมูลเพื่อรับคำแนะนำสำหรับ${esc(landing.crop)}</button>
        <p class="form-note">ข้อมูลจะถูกบันทึกพร้อมแหล่งที่มาของหน้า landing นี้ เพื่อให้ติดตามผลแคมเปญและปิดการขายได้จริง</p>
      </form>
    </div>
  </section>`;
}
function productSupportSection(p, rev) {
  const extra = productExtra(p);
  const crops = productCrops(p);
  const reviewText = rev?.stats?.count ? `${rev.stats.avg} ดาว จาก ${rev.stats.count} รีวิว` : 'ยังไม่มีรีวิว ระบบพร้อมให้ลูกค้ารีวิวหลังซื้อ';
  const points = settingLines('SITE_CHECKOUT_POINTS', DEFAULT_CHECKOUT_POINTS);
  return `<section class="detail-panel glass reveal">
    <div class="panel-head"><span class="eyebrow">พร้อมขายจริง</span><h2>ช่วยให้ตัดสินใจง่ายก่อนสั่งซื้อ</h2></div>
    <div class="support-grid">
      <article class="support-card">
        <h3>เหมาะกับใคร</h3>
        <p>${isAgriProduct(p) ? `เหมาะกับเกษตรกรที่ปลูก${esc(crops.join(' / ') || 'พืชทั่วไป')} และต้องการสูตรที่มีข้อมูลการใช้ชัดเจน` : 'เหมาะกับลูกค้าที่มองหาสินค้าเพื่อสุขภาพและความงามจากแบรนด์เดียวกัน'}</p>
      </article>
      <article class="support-card">
        <h3>ความน่าเชื่อถือ</h3>
        <p>${esc(reviewText)}</p>
        <p class="muted">${extra.labelUrl ? 'มีเอกสารฉลากหรือไฟล์ประกอบให้เปิดดูได้จากหน้านี้' : 'สามารถใส่ฉลากหรือไฟล์ประกอบเพิ่มได้จากหลังบ้านเพื่อช่วยปิดการขายง่ายขึ้น'}</p>
      </article>
      <article class="support-card">
        <h3>ก่อนและหลังสั่งซื้อ</h3>
        <ul class="support-list">${points.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </article>
    </div>
    <div class="support-cta">
      ${lineCTA()}
      <a class="btn btn-glass" href="${routeHref('/checkout')}">ไปที่ขั้นตอนสั่งซื้อ</a>
    </div>
  </section>`;
}

let _pf = { q: '', cat: 'all', sort: 'default', crop: null, segment: 'agri' };
function productCrops(p) {
  const direct = asArray(productExtra(p).cropTargets);
  if (direct.length) return direct;
  return Object.entries(cropGuideMap()).filter(([, cfg]) => cfg.ids.includes(p.id)).map(([crop]) => crop);
}
function filteredProducts() {
  let list = PRODUCTS.slice();
  if (_pf.segment && _pf.segment !== 'all') list = list.filter((p) => productSegment(p) === _pf.segment);
  if (_pf.crop && cropGuideMap()[_pf.crop]) { const ids = cropGuideMap()[_pf.crop].ids; list = list.filter((p) => ids.includes(p.id)); }
  if (_pf.q) {
    const q = _pf.q.toLowerCase();
    list = list.filter((p) => (p.name + ' ' + p.short + ' ' + p.tag + ' ' + productCrops(p).join(' ')).toLowerCase().includes(q));
  }
  if (_pf.cat !== 'all') list = list.filter((p) => p.tag === _pf.cat);
  if (_pf.sort === 'price-asc') list.sort((a, b) => a.price - b.price);
  else if (_pf.sort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (_pf.sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
  return list;
}
function renderProductGrid() {
  const grid = document.getElementById('productGrid'); if (!grid) return;
  const list = filteredProducts();
  grid.innerHTML = list.length ? list.map((p, i) => productCard(p, i)).join('')
    : '<p class="muted" style="grid-column:1/-1;text-align:center;padding:40px">ไม่พบสินค้าที่ค้นหา</p>';
  enhance();
}
function viewProducts() {
  setPageMeta('สินค้าทั้งหมด', 'รวมสินค้าเกษตร สินค้าสุขภาพ และความงาม พร้อมตัวกรองตามหมวดและชนิดพืช');
  const cats = ['all', ...new Set(PRODUCTS.map((p) => p.tag).filter(Boolean))];
  const guideMap = cropGuideMap();
  return `
  <section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">คอลเลกชันทั้งหมด</span><h2>สินค้าของเรา</h2></div>
    <div class="segment-pick reveal">
      <button class="chip-btn ${(!_pf.segment || _pf.segment === 'all') ? 'on' : ''}" data-seg="all">ทุกกลุ่ม</button>
      <button class="chip-btn ${_pf.segment === 'agri' ? 'on' : ''}" data-seg="agri">สินค้าเกษตร</button>
      <button class="chip-btn ${_pf.segment === 'lifestyle' ? 'on' : ''}" data-seg="lifestyle">สุขภาพ/ความงาม</button>
    </div>
    <p class="brand-split-note reveal">${_pf.segment === 'lifestyle' ? 'หมวดนี้แยกจากแบรนด์หลักสายเกษตรอย่างชัดเจน เพื่อไม่ให้ภาพจำสินค้าปะปนกัน' : 'เว็บไซต์โฟกัสหลักที่สินค้าเกษตร และแยกสินค้าสุขภาพ/ความงามเป็นอีกกลุ่มชัดเจน'}</p>
    <div class="shop-toolbar reveal">
      <div class="search-wrap">
        <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="searchInput" placeholder="ค้นหาสินค้า…" value="${esc(_pf.q)}" autocomplete="off">
      </div>
      <div class="cat-chips">${cats.map((c) => `<button class="chip-btn ${_pf.cat === c ? 'on' : ''}" data-cat="${esc(c)}">${c === 'all' ? 'ทั้งหมด' : esc(c)}</button>`).join('')}</div>
      <select id="sortSelect" class="sort-sel">
        <option value="default" ${_pf.sort === 'default' ? 'selected' : ''}>แนะนำ</option>
        <option value="price-asc" ${_pf.sort === 'price-asc' ? 'selected' : ''}>ราคาน้อย→มาก</option>
        <option value="price-desc" ${_pf.sort === 'price-desc' ? 'selected' : ''}>ราคามาก→น้อย</option>
        <option value="rating" ${_pf.sort === 'rating' ? 'selected' : ''}>คะแนนสูงสุด</option>
      </select>
    </div>
    <div class="crop-pick reveal">
      <span class="crop-label">🌾 เลือกตามพืช:</span>
      <button class="chip-btn ${!_pf.crop ? 'on' : ''}" data-crop="">ทุกพืช</button>
      ${Object.keys(guideMap).map((c) => `<button class="chip-btn ${_pf.crop === c ? 'on' : ''}" data-crop="${esc(c)}">${esc(c)}</button>`).join('')}
    </div>
    <div id="cropTip">${_pf.crop && guideMap[_pf.crop] ? `<div class="crop-tip glass">💡 <b>${esc(_pf.crop)}:</b> ${esc(guideMap[_pf.crop].tip)}</div>` : ''}</div>
    <div class="products" id="productGrid">${filteredProducts().map((p, i) => productCard(p, i)).join('')}</div>
  </section>`;
}
function viewCropLanding({ slug }) {
  const landing = cropLandingMap()[slug];
  if (!landing) return viewNotFound();
  const products = PRODUCTS.filter((p) => landing.related.includes(p.id)).slice(0, 2);
  const reviews = asArray(landing.reviews);
  const gallery = asArray(landing.gallery);
  const visualItems = [];
  if (landing.heroImage) {
    visualItems.push({
      image: landing.heroImage,
      title: landing.hero || `${landing.crop} ใช้อะไรดี`,
      note: landing.tip || landing.problem,
    });
  }
  gallery.forEach((item) => {
    if (!item?.image) return;
    if (visualItems.some((entry) => entry.image === item.image)) return;
    visualItems.push(item);
  });
  if (!visualItems.length && reviews[0]?.image) {
    visualItems.push({
      image: reviews[0].image,
      title: reviews[0].title || `ภาพหน้างาน${landing.crop}`,
      note: reviews[0].note || landing.tip || landing.problem,
    });
  }
  const mainVisual = visualItems[0] || null;
  const mainVisualIsHero = !!(mainVisual && landing.heroImage && mainVisual.image === landing.heroImage);
  const mainVisualRatio = mainVisualIsHero ? landing.heroRatio : 'wide';
  const mainVisualFocus = mainVisualIsHero ? landing.heroFocus : 'center';
  const secondaryVisuals = visualItems.slice(1, 4);
  const reviewLead = reviews[0] || null;
  const reviewRest = reviewLead ? reviews.slice(1) : [];
  const stageCards = asArray(landing.stages).map((stage) => {
    const stageProducts = PRODUCTS.filter((p) => asArray(stage.ids).includes(p.id));
    return `<article class="stage-card">
      <span class="stage-step">${esc(stage.title)}</span>
      <p>${esc(stage.detail)}</p>
      <div class="stage-links">${stageProducts.map((p) => `<a href="${routeHref('/product/' + p.id)}">${esc(p.name)}</a>`).join('')}</div>
    </article>`;
  }).join('');
  setPageMeta(
    landing.seoTitle || `${landing.crop} ใช้อะไรดี`,
    landing.seoDescription || `โซลูชัน${landing.crop}ของ ${S('SITE_NAME')} สำหรับแก้ปัญหาและวางสูตรสินค้าให้ตรงช่วงการปลูก`,
    landing.seoImage || landing.heroImage || (gallery[0]?.image || '') || (reviews[0]?.image || '')
  );
  return `<section class="section page-top crop-landing">
    <div class="landing-hero-shell">
      <div class="landing-hero glass reveal">
        <span class="eyebrow">Landing Page</span>
        <h1>${esc(landing.hero)}</h1>
        <p>${esc(landing.problem)}</p>
        <div class="hero-cta">
          <a href="${routeHref('/products')}" class="btn btn-primary">ดูสินค้าที่เกี่ยวข้อง</a>
          <button class="btn btn-glass" type="button" data-prefillcrop="${esc(landing.crop)}">ขอคำแนะนำสำหรับ${esc(landing.crop)}</button>
          ${lineCTA()}
        </div>
        <div class="landing-pill-row">${asArray(landing.offer).map((item) => `<span class="landing-pill">${esc(item)}</span>`).join('')}</div>
        <div class="landing-inline-points">${asArray(landing.painPoints).slice(0, 3).map((item) => `<div>${esc(item)}</div>`).join('')}</div>
      </div>
      <aside class="landing-visual-panel glass reveal">
        ${mainVisual ? `<a class="landing-visual-main" href="${esc(mainVisual.image)}" data-zoom="${esc(mainVisual.image)}" data-lightbox-group="crop-${esc(slug)}-visual" data-lightbox-index="0" data-lightbox-title="${esc(mainVisual.title || `ภาพประกอบ${landing.crop}`)}" data-lightbox-note="${esc(mainVisual.note || landing.tip || landing.problem)}">
          <div class="landing-visual-media" data-ratio="${esc(mainVisualRatio)}">
            <img src="${esc(mainVisual.image)}" alt="${esc(mainVisual.title || landing.crop)}" style="object-position:${esc(heroFocusObjectPosition(mainVisualFocus))}">
            <div class="landing-visual-overlay">
              <span class="landing-visual-badge">ภาพเด่นของหน้า</span>
              <b>${esc(mainVisual.title || `ภาพประกอบ${landing.crop}`)}</b>
              <span>${esc(mainVisual.note || landing.tip || landing.problem)}</span>
            </div>
          </div>
        </a>` : `<div class="landing-visual-empty">
          <b>ยังไม่มีภาพหน้าแคมเปญ</b>
          <span>เพิ่มภาพปกหรือแกลเลอรีจากหลังบ้านเพื่อให้หน้าเฉพาะพืชดูโดดเด่นขึ้น</span>
        </div>`}
        ${secondaryVisuals.length ? `<div class="landing-visual-side">${secondaryVisuals.map((item, idx) => `<a class="landing-visual-mini" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-visual" data-lightbox-index="${idx + 1}" data-lightbox-title="${esc(item.title || `ภาพหน้างาน${landing.crop}`)}" data-lightbox-note="${esc(item.note || '')}">
          <div class="landing-visual-mini-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
          <div class="landing-visual-mini-copy">
            <b>${esc(item.title || `ภาพหน้างาน${landing.crop}`)}</b>
            ${item.note ? `<span>${esc(item.note)}</span>` : ''}
          </div>
        </a>`).join('')}</div>` : ''}
      </aside>
    </div>
    <div class="landing-grid landing-grid-compact">
      <section class="detail-panel glass reveal">
        <div class="panel-head"><span class="eyebrow">ลำดับแนะนำ</span><h2>เริ่มจากช่วงการปลูกที่ลูกค้ากำลังเจอ</h2></div>
        ${stageCards ? `<div class="stage-grid stage-grid-stack">${stageCards}</div>` : '<div class="empty-inline-note">ยังไม่มีลำดับแนะนำสำหรับหน้านี้</div>'}
      </section>
      <section class="detail-panel glass reveal">
        <div class="panel-head"><span class="eyebrow">สูตรแนะนำ</span><h2>เลือกตัวที่เกี่ยวข้องก่อน แล้วค่อยดูรายละเอียดเต็ม</h2></div>
        ${products.length ? `<div class="products products-compact">${products.map((p, i) => productCard(p, i)).join('')}</div>` : '<div class="empty-inline-note">ยังไม่มีสินค้าแนะนำสำหรับหน้านี้</div>'}
        <div class="proof-callout compact-callout">
          <h3>${esc(landing.proofTitle || 'ใช้เป็นหน้าแคมเปญเฉพาะพืชได้')}</h3>
          <p>${esc(landing.proofBody || landing.tip)}</p>
        </div>
      </section>
    </div>
    ${gallery.length ? `<section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">ภาพประกอบหน้า</span><h2>ภาพบรรยากาศและภาพประกอบสำหรับลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      <div class="landing-gallery-grid">${gallery.map((item, idx) => `<a class="landing-gallery-card ${idx === 0 ? 'is-featured' : ''}" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-gallery" data-lightbox-index="${idx}" data-lightbox-title="${esc(item.title || `ภาพประกอบ${landing.crop}`)}" data-lightbox-note="${esc(item.note || '')}">
        <div class="landing-gallery-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
        <div class="landing-gallery-copy">
          <b>${esc(item.title || `ภาพประกอบ${landing.crop}`)}</b>
          ${item.note ? `<span>${esc(item.note)}</span>` : ''}
        </div>
      </a>`).join('')}</div>
    </section>` : ''}
    <section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">รีวิวหน้างาน</span><h2>ภาพรีวิวและผลงานของลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      ${reviews.length ? `<div class="review-photo-layout">
        ${reviewLead ? `<a class="review-photo-spotlight" href="${esc(reviewLead.image)}" data-zoom="${esc(reviewLead.image)}" data-lightbox-group="crop-${esc(slug)}-reviews" data-lightbox-index="0" data-lightbox-title="${esc(reviewLead.title || 'รีวิวจากลูกค้า')}" data-lightbox-note="${esc(reviewLead.note || `ภาพผลงานจริงของลูกค้ากลุ่ม${landing.crop}`)}">
          <div class="review-photo-spotlight-thumb"><img src="${esc(reviewLead.image)}" alt="${esc(reviewLead.title || landing.crop)}"></div>
          <div class="review-photo-spotlight-copy">${reviewLead.title ? `<b>${esc(reviewLead.title)}</b>` : '<b>รีวิวจากลูกค้า</b>'}${reviewLead.note ? `<span>${esc(reviewLead.note)}</span>` : `<span>ภาพผลงานจริงของลูกค้ากลุ่ม${esc(landing.crop)}</span>`}</div>
        </a>` : ''}
        ${reviewRest.length ? `<div class="review-photo-grid">${reviewRest.map((item, idx) => `<a class="review-photo-card" href="${esc(item.image)}" data-zoom="${esc(item.image)}" data-lightbox-group="crop-${esc(slug)}-reviews" data-lightbox-index="${idx + 1}" data-lightbox-title="${esc(item.title || 'รีวิวจากลูกค้า')}" data-lightbox-note="${esc(item.note || '')}">
          <div class="review-photo-thumb"><img src="${esc(item.image)}" alt="${esc(item.title || landing.crop)}"></div>
          <div class="review-photo-copy">${item.title ? `<b>${esc(item.title)}</b>` : '<b>รีวิวจากลูกค้า</b>'}${item.note ? `<span>${esc(item.note)}</span>` : ''}</div>
        </a>`).join('')}</div>` : ''}
      </div>
      ` : `<div class="empty-inline-note">ยังไม่มีรูปรีวิวสำหรับ${esc(landing.crop)} คุณสามารถเพิ่มรูปผลงานจริงได้จากหลังบ้านในหัวข้อหน้าเฉพาะพืช</div>`}
    </section>
    ${landing.faq?.length ? `<section class="detail-panel glass reveal">
      <div class="panel-head"><span class="eyebrow">FAQ สำหรับทีมขาย</span><h2>คำถามที่ควรตอบให้ลูกค้ากลุ่ม${esc(landing.crop)}</h2></div>
      <div class="faq-list compact-faq">${landing.faq.map((item, idx) => `<details class="faq-item" ${idx === 0 ? 'open' : ''}><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}</div>
    </section>` : ''}
    ${landingLeadSection(landing)}
  </section>`;
}
function viewWishlist() {
  const list = PRODUCTS.filter((p) => wishlist.has(p.id));
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">รายการโปรด</span><h2>สินค้าที่คุณถูกใจ</h2></div>
    ${list.length ? `<div class="products">${list.map((p, i) => productCard(p, i)).join('')}</div>`
      : `<div class="empty-state glass reveal"><div class="es-ico">♥</div><h2>ยังไม่มีรายการโปรด</h2><p>กดหัวใจที่สินค้าเพื่อบันทึกไว้ดูภายหลัง</p><a class="btn btn-primary" href="${routeHref('/products')}">เลือกซื้อสินค้า</a></div>`}
  </section>`;
}

// ── เครื่องคำนวณอัตราผสม (standalone) ──
function viewCalc() {
  const rated = calcRatedProducts();
  if (!rated.length) return `<section class="section page-top"><div class="empty-state glass reveal"><div class="es-ico">🧮</div><h2>ยังไม่มีข้อมูลอัตราการใช้</h2><p>เพิ่มสเปก "อัตรา" ให้สินค้าในหลังบ้าน</p></div></section>`;
  const crops = calcCropList();
  const firstCrop = crops[0] || '';
  const firstCropCfg = calcCropConfig(firstCrop);
  const firstProblems = calcProblemOptions(firstCrop);
  const firstProblem = firstProblems[0] || null;
  const firstStage = firstProblem?.stage || calcStageOptions(firstCrop)[0] || '';
  const firstPreset = calcPresetDetails(firstCrop, firstProblem?.preset || '') || asArray(firstCropCfg?.mixes)[0] || null;
  const firstGuide = calcGuideStepsHTML({
    crop: firstCrop,
    stage: firstStage,
    presetTitle: firstPreset?.title || '',
    fields: {
      mode: 'tank',
      tankSize: 20,
      tankCount: 1,
      waterTotal: 200,
      areaRai: 1,
      waterPerRai: firstCropCfg?.waterPerRai || defaultWaterPerRai(rated[0]),
    },
    rows: [],
    stickerRow: null,
  });
  const productCards = rated.map((p) => {
    const knowledge = calcKnowledge().products?.[p.id] || {};
    const checked = firstPreset?.ids?.includes(p.id) ? 'checked' : '';
    return `<label class="calc-product-card ${checked ? 'is-selected' : ''}" data-calc-card>
      <input type="checkbox" data-calc-product value="${p.id}" ${checked}>
      <div class="calc-product-copy">
        <b>${esc(p.name)}</b>
        <span>${esc(knowledge.label || p.short || '')}</span>
      </div>
    </label>`;
  }).join('');
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">เครื่องมือเกษตรกร</span><h2>คำนวณอัตราผสม</h2></div>
    <div class="calc-page glass reveal">
      <div class="calc-smart-intro">
        <b>คำนวณได้หลายแบบในหน้าเดียว</b>
        <span>เลือกพืช เลือกสูตรแนะนำ หรือจัดชุดสูตรเองได้ พร้อมคำนวณตามถัง ตามน้ำรวม และตามพื้นที่ปลูก</span>
      </div>
      <div class="calc-onboarding">
        <article class="calc-onboarding-main">
          <b>เริ่มใช้งานแบบง่ายที่สุด</b>
          <span>1. เลือกพืชและระยะ 2. เลือกโหมดคำนวณ 3. ตรวจผลลัพธ์แล้วคัดลอกสูตรไปส่งลูกค้าหรือใช้หน้างานได้ทันที</span>
        </article>
        <div class="calc-onboarding-points">
          <span>มีสูตรตามระยะพืช</span>
          <span>คัดลอกข้อความพร้อมส่ง LINE ได้</span>
          <span>มี AI ช่วยสรุปผลที่คาดว่าจะเกิดขึ้น</span>
        </div>
      </div>
      <div class="calc-mode-pills">
        <button type="button" class="chip-btn on" data-calcmode="tank">ตามถัง</button>
        <button type="button" class="chip-btn" data-calcmode="water">ตามน้ำรวม</button>
        <button type="button" class="chip-btn" data-calcmode="area">ตามพื้นที่</button>
      </div>
      <div class="calc-page-grid">
        <label>เลือกพืช<select id="calcCrop">${crops.map((crop) => `<option value="${esc(crop)}">${esc(crop)}</option>`).join('')}</select></label>
        <label class="calc-hidden-select">เลือกจากปัญหา<select id="calcProblem"><option value="">เลือกจากอาการที่เจอ</option>${firstProblems.map((item) => `<option value="${esc(item.key)}" ${firstProblem?.key === item.key ? 'selected' : ''}>${esc(item.label)}</option>`).join('')}</select></label>
        <label>ระยะพืช<select id="calcStage"><option value="${esc(firstStage)}">${esc(firstStage || 'ทุกระยะ')}</option></select></label>
        <label>สูตรแนะนำตามพืช<select id="calcPreset"><option value="${esc(firstPreset?.key || '')}">${esc(firstPreset?.title || 'จัดเอง')}</option></select></label>
        <label>ความเข้ม<select id="calcStrength"><option value="low">เริ่มต้น</option><option value="mid" selected>กลาง</option><option value="high">เข้มขึ้น</option></select></label>
        <label>ถังอ้างอิง (ลิตร)<input type="number" id="calcRefTank" value="20" min="1" max="2000"></label>
        <div class="lead-wide calc-problem-shell">
          <span class="calc-section-label">เลือกอาการที่เจอ เพื่อให้ระบบเลือกสูตรตั้งต้นให้เร็วขึ้น</span>
          <div class="calc-problem-grid" id="calcProblemCards">${calcProblemCardsHTML(firstCrop, firstProblem?.key || '')}</div>
          <div class="calc-problem-note" id="calcProblemNote">${esc(firstProblem?.note || (firstCrop ? `เลือกอาการที่ใกล้กับปัญหาของ${firstCrop} เพื่อให้ระบบจัดระยะและสูตรตั้งต้นให้เร็วขึ้น` : 'เลือกพืชก่อน แล้วค่อยเลือกอาการที่ต้องการแก้'))}</div>
        </div>
        <label data-mode-field="tank">ขนาดถังพ่น (ลิตร)<input type="number" id="calcPageTank" value="20" min="1" max="2000"></label>
        <label data-mode-field="tank">จำนวนถัง<input type="number" id="calcTankCount" value="1" min="1" max="500"></label>
        <label data-mode-field="water" hidden>ปริมาณน้ำรวม (ลิตร)<input type="number" id="calcWaterTotal" value="200" min="1" max="200000"></label>
        <label data-mode-field="area" hidden>พื้นที่ (ไร่)<input type="number" id="calcAreaRai" value="1" min="0.1" step="0.1" max="10000"></label>
        <label data-mode-field="area" hidden>ปริมาณน้ำต่อไร่ (ลิตร)<input type="number" id="calcWaterPerRai" value="${esc(firstCropCfg?.waterPerRai || defaultWaterPerRai(rated[0]))}" min="1" max="2000"></label>
        <label class="lead-wide calc-toggle">
          <input type="checkbox" id="calcIncludeSticker">
          <span>เพิ่มสารจับใบในสูตรด้วย เพื่อช่วยการเกาะใบและลดการชะล้าง</span>
        </label>
        <div class="lead-wide calc-preset-note" id="calcPresetNote">${esc(firstPreset?.note || (firstCrop ? `น้ำต่อไร่ของ${firstCrop}ถูกตั้งให้อัตโนมัติแล้ว คุณยังปรับเองได้` : 'เลือกพืชหรือสูตรสำเร็จเพื่อให้ระบบช่วยจัดชุดสินค้าให้'))}</div>
        <div class="lead-wide calc-budget-shell">
          <span class="calc-section-label">เลือกงบประมาณ แล้วให้ระบบจัดชุดเหมาะกับเป้าหมาย</span>
          <div class="calc-budget-pills" id="calcBudgetPills">${calcBudgetPillsHTML('balanced')}</div>
          <div class="calc-budget-summary" id="calcBudgetSummary">${esc(calcBudgetMeta('balanced').desc)}</div>
          <input type="hidden" id="calcBudgetLevel" value="balanced">
        </div>
        <div class="lead-wide">
          <span class="calc-section-label">เลือกชุดสูตรที่จะคำนวณ</span>
          <div class="calc-product-list" id="calcProductList">${productCards}</div>
        </div>
      </div>
      <div class="calc-page-out" id="calcPageOut">—</div>
      <div class="calc-guide-grid" id="calcGuideGrid">${firstGuide}</div>
      <div class="calc-action-row">
        <button type="button" class="btn btn-primary" id="calcCopyBtn">คัดลอกสูตรผสม</button>
        <button type="button" class="btn btn-glass" id="calcPitchCopyBtn">คัดลอกข้อความพร้อมส่ง</button>
        <a class="btn btn-glass" id="calcLineShareBtn" href="#" target="_blank" rel="noopener">ส่งต่อทาง LINE</a>
      </div>
      <div class="calc-plan-duration">
        <span class="calc-section-label">เลือกแผนพ่น</span>
        <div class="calc-plan-day-pills">
          ${CALC_PLAN_DAY_OPTIONS.map((day) => `<button type="button" class="chip-btn ${day === 14 ? 'on' : ''}" data-calcplandays="${day}">${day} วัน</button>`).join('')}
        </div>
        <input type="hidden" id="calcPlanDays" value="14">
      </div>
      <div class="calc-support-grid">
        <div id="calcTimeline"></div>
        <div class="calc-compare-shell">
          <div class="calc-compare-top">
            <div>
              <span class="eyebrow">เปรียบเทียบ 2 สูตร</span>
              <h3>ใช้คุยกับลูกค้าให้คมขึ้น</h3>
            </div>
            <label class="calc-compare-select">เลือกสูตรอีกชุด
              <select id="calcComparePreset"><option value="">เลือกสูตรมาเทียบ</option></select>
            </label>
          </div>
          <div id="calcCompareOut"></div>
        </div>
      </div>
      <div class="calc-summary-grid">
        <article class="calc-summary-card"><span>น้ำรวมที่ใช้</span><b id="calcWaterOut">—</b></article>
        <article class="calc-summary-card"><span>ชุดสูตร</span><b id="calcProductOut">—</b></article>
        <article class="calc-summary-card"><span>สารจับใบ</span><b id="calcStickerOut">—</b></article>
        <article class="calc-summary-card"><span>เทียบเป็นจำนวนถัง</span><b id="calcTankOut">—</b></article>
        <article class="calc-summary-card"><span>ขวด 100 ซีซี</span><b id="calcBottle100Out">—</b></article>
        <article class="calc-summary-card"><span>ขวด 500 ซีซี</span><b id="calcBottle500Out">—</b></article>
      </div>
      <div class="calc-mix-plan" id="calcMixPlan"></div>
      <div class="calc-bundle-card" id="calcBundleCard">
        <div class="calc-bundle-copy">
          <span class="eyebrow">ต่อยอดเป็นการสั่งซื้อ</span>
          <b>เพิ่มทั้งชุดลงตะกร้าจากผลคำนวณนี้</b>
          <small id="calcBundleHint">ระบบจะหยิบสินค้าในสูตรปัจจุบันเข้าตะกร้าให้อัตโนมัติ</small>
          <div id="calcBundleItems"></div>
        </div>
        <div class="calc-bundle-actions">
          <button type="button" class="btn btn-primary" id="calcAddBundleBtn">เพิ่มทั้งชุดลงตะกร้า</button>
          <button type="button" class="btn btn-glass" id="calcCheckoutNowBtn">Checkout จากสูตรนี้เลย</button>
        </div>
      </div>
      <div class="calc-sales-card">
        <div class="calc-sales-copy">
          <span class="eyebrow">ปิดการขายต่อใน LINE</span>
          <b>ส่งข้อความขายกึ่งอัตโนมัติพร้อมลิงก์สินค้า</b>
          <small id="calcSalesHint">ระบบจะสรุปสูตร งบประมาณ และลิงก์ดูรายละเอียดให้พร้อมส่ง</small>
        </div>
        <div class="calc-action-row">
          <a class="btn btn-primary" id="calcSalesLineBtn" href="#" target="_blank" rel="noopener">ส่งข้อความขายเข้า LINE</a>
          <a class="btn btn-glass" id="calcOpenOaBtn" href="#" target="_blank" rel="noopener">เปิด LINE OA</a>
        </div>
      </div>
      <div class="calc-consult-card">
        <div class="calc-consult-copy">
          <span class="eyebrow">ต้องการให้ทีมงานช่วยตรวจต่อ?</span>
          <b>ส่งพืช อาการ สูตร และแผนพ่นให้ทีมงานต่อได้ทันที</b>
          <small id="calcConsultHint">เหมาะเมื่อต้องการให้ทีมงานช่วยปรับสูตรตามอาการจริงของแปลง</small>
        </div>
        <div class="calc-action-row">
          <a class="btn btn-glass" id="calcConsultLineBtn" href="#" target="_blank" rel="noopener">ขอคำแนะนำผ่าน LINE</a>
          <button type="button" class="btn btn-primary" id="calcConsultLeadBtn">ส่งสูตรนี้ให้ทีมงานช่วยจัดต่อ</button>
        </div>
      </div>
      <div class="calc-smart-hints" id="calcSmartHints"></div>
      <div id="calcAiAnalysis"></div>
      <div class="calc-rate-note" id="calcPageRate"></div>
      <p class="form-note">ระบบจะใช้อัตราที่ดีที่สุดจากข้อมูลสินค้าในระบบร่วมกับข้อมูลอ้างอิงจากเว็บไซต์นุชฟอร์ไลฟ์ที่หาได้ และเปิดให้แก้ฐานความรู้ชุดนี้ได้จากหลังบ้านในหัวข้อเครื่องคำนวณ</p>
    </div>
  </section>`;
}
function updateCalcPage() {
  const crop = document.getElementById('calcCrop')?.value || '';
  const stage = document.getElementById('calcStage')?.value || '';
  const out = document.getElementById('calcPageOut');
  const rate = document.getElementById('calcPageRate');
  const waterOut = document.getElementById('calcWaterOut');
  const productOut = document.getElementById('calcProductOut');
  const stickerOut = document.getElementById('calcStickerOut');
  const tankOut = document.getElementById('calcTankOut');
  const bottle100Out = document.getElementById('calcBottle100Out');
  const bottle500Out = document.getElementById('calcBottle500Out');
  const hints = document.getElementById('calcSmartHints');
  const mixPlan = document.getElementById('calcMixPlan');
  const guideGrid = document.getElementById('calcGuideGrid');
  const aiAnalysis = document.getElementById('calcAiAnalysis');
  const compareOut = document.getElementById('calcCompareOut');
  const timeline = document.getElementById('calcTimeline');
  const bundleBtn = document.getElementById('calcAddBundleBtn');
  const checkoutNowBtn = document.getElementById('calcCheckoutNowBtn');
  const bundleHint = document.getElementById('calcBundleHint');
  const bundleItems = document.getElementById('calcBundleItems');
  const salesLineBtn = document.getElementById('calcSalesLineBtn');
  const openOaBtn = document.getElementById('calcOpenOaBtn');
  const salesHint = document.getElementById('calcSalesHint');
  const consultLineBtn = document.getElementById('calcConsultLineBtn');
  const consultLeadBtn = document.getElementById('calcConsultLeadBtn');
  const consultHint = document.getElementById('calcConsultHint');
  const copyBtn = document.getElementById('calcCopyBtn');
  const pitchCopyBtn = document.getElementById('calcPitchCopyBtn');
  const lineShareBtn = document.getElementById('calcLineShareBtn');
  const problemInfo = calcProblemDetails(crop, document.getElementById('calcProblem')?.value || '');
  const planDays = calcPlanDays();
  const budgetLevel = calcBudgetLevel();
  const selectedProducts = calcSelectedProductsForRun();
  if (!selectedProducts.length) {
    out.textContent = '—';
    rate.innerHTML = '<div>ยังไม่ได้เลือกสูตรที่จะคำนวณ</div>';
    if (mixPlan) mixPlan.innerHTML = '<div class="calc-empty-note">เลือกอย่างน้อย 1 สูตร หรือเลือกสูตรแนะนำตามพืชก่อน</div>';
    if (guideGrid) guideGrid.innerHTML = calcGuideStepsHTML({ crop, stage, presetTitle: '', fields: calcModeFields(), rows: [], stickerRow: null });
    if (aiAnalysis) aiAnalysis.innerHTML = '<div class="calc-ai-card"><div class="calc-ai-head"><div><span class="eyebrow">AI วิเคราะห์ผลลัพธ์ที่คาดว่าจะเกิดขึ้น</span><h3>รอข้อมูลเพื่อเริ่มวิเคราะห์</h3></div><span class="calc-ai-confidence">ความมั่นใจ ตั้งต้น</span></div><div class="calc-ai-grid"><article class="calc-ai-block"><b>สิ่งที่ควรทำก่อน</b><div class="calc-ai-list"><div>เลือกพืช ระยะ และอย่างน้อย 1 สินค้าที่ต้องการคำนวณ</div><div>ถ้ามีสูตรสำเร็จ ให้เลือก preset ก่อนเพื่อให้ระบบจัดชุดให้เร็วขึ้น</div><div>จากนั้นค่อยดูผลวิเคราะห์และคัดลอกสูตรไปใช้งานหรือส่งลูกค้า</div></div></article></div></div>';
    if (compareOut) compareOut.innerHTML = '<div class="calc-compare-empty">เลือกสูตรก่อน แล้วค่อยนำอีกสูตรมาเทียบเพื่อใช้คุยกับลูกค้า</div>';
    if (timeline) timeline.innerHTML = '<div class="calc-plan-card"><div class="calc-plan-head"><div><span class="eyebrow">โปรแกรมพ่นต่อเนื่อง</span><h3>รอสูตรที่เลือก</h3></div><span class="calc-plan-badge">เริ่มต้น</span></div><div class="calc-plan-timeline"><article class="calc-plan-step"><span>Day 0</span><b>เลือกพืชและสูตรก่อน</b><small>เมื่อมีสูตรแล้ว ระบบจะสร้างลำดับการใช้งาน 7 / 14 / 21 วันให้ทันที</small></article></div></div>';
    if (copyBtn) copyBtn.disabled = true;
    if (pitchCopyBtn) pitchCopyBtn.disabled = true;
    if (lineShareBtn) lineShareBtn.setAttribute('href', '#');
    if (bundleBtn) { bundleBtn.disabled = true; bundleBtn.dataset.bundlePlan = ''; }
    if (checkoutNowBtn) { checkoutNowBtn.disabled = true; checkoutNowBtn.dataset.bundlePlan = ''; }
    if (bundleHint) bundleHint.textContent = 'ระบบจะหยิบสินค้าในสูตรปัจจุบันเข้าตะกร้าให้อัตโนมัติ';
    if (bundleItems) bundleItems.innerHTML = '';
    if (salesLineBtn) salesLineBtn.href = '#';
    if (openOaBtn) openOaBtn.href = S('LINE_OA_URL') || '#';
    if (salesHint) salesHint.textContent = 'ระบบจะสรุปสูตร งบประมาณ และลิงก์ดูรายละเอียดให้พร้อมส่ง';
    if (consultLineBtn) consultLineBtn.href = '#';
    if (consultLeadBtn) consultLeadBtn.disabled = true;
    if (consultHint) consultHint.textContent = 'เหมาะเมื่อต้องการให้ทีมงานช่วยปรับสูตรตามอาการจริงของแปลง';
    return;
  }
  const strength = document.getElementById('calcStrength')?.value || 'mid';
  const fields = calcModeFields();
  const cropCfg = calcCropConfig(crop);
  const areaWaterInput = document.getElementById('calcWaterPerRai');
  if (areaWaterInput && (!areaWaterInput.dataset.touched || areaWaterInput.value === '')) areaWaterInput.value = String(cropCfg?.waterPerRai || defaultWaterPerRai(selectedProducts[0]));
  const totalWater = Math.max(0, fields.totalWater);
  const rows = calcProductMixRows(selectedProducts, totalWater, strength);
  const totalDose = rows.reduce((sum, row) => sum + row.exact, 0);
  const stickerRow = rows.find((row) => row.isSticker) || null;
  const preset = calcPresetDetails(crop, document.getElementById('calcPreset')?.value || '');
  const comparePreset = calcPresetDetails(crop, document.getElementById('calcComparePreset')?.value || '');
  const eqTanks = fields.refTank > 0 ? totalWater / fields.refTank : 0;
  const bundleRecommendations = calcBundleRecommendations(rows, planDays);
  const shareText = buildCalcShareText({ crop, stage, presetTitle: preset?.title || '', totalWater, rows, totalDose });
  const pitchText = buildCalcPitchText({ crop, stage, presetTitle: preset?.title || '', totalWater, rows, totalDose, strength });
  const salesLineText = buildCalcSalesLineText({
    crop,
    problemLabel: problemInfo?.label || '',
    stage,
    presetTitle: preset?.title || '',
    totalWater,
    rows,
    days: planDays,
    budgetLevel,
  });
  const consultText = buildCalcConsultText({
    crop,
    problemLabel: problemInfo?.label || '',
    stage,
    presetTitle: preset?.title || '',
    totalWater,
    rows,
    days: planDays,
  });
  out.innerHTML = `ใช้ทั้งหมด <b>${fmtCalcNumber(totalDose)} ซีซี</b> สำหรับน้ำ ${fmtCalcNumber(totalWater)} ลิตร<br><small>${rows.map((row) => `${row.product.name} ${fmtCalcNumber(row.exact)} ซีซี`).join(' + ')}</small>`;
  waterOut.textContent = `${fmtCalcNumber(totalWater)} ลิตร`;
  productOut.textContent = rows.filter((row) => !row.isSticker).length
    ? (rows.filter((row) => !row.isSticker).length <= 2 ? rows.filter((row) => !row.isSticker).map((row) => row.product.name.replace(/^นุชฟอร์ไลฟ์\s*/,'')).join(' + ') : `${rows.filter((row) => !row.isSticker).length} รายการ`)
    : '—';
  stickerOut.textContent = stickerRow ? `${fmtCalcNumber(stickerRow.exact)} ซีซี` : 'ไม่เพิ่ม';
  tankOut.textContent = fields.refTank > 0 ? `${fmtCalcNumber(eqTanks)} ถัง` : '—';
  bottle100Out.textContent = `${calcPackCount(totalDose, 100)} ขวด`;
  bottle500Out.textContent = `${calcPackCount(totalDose, 500)} ขวด`;
  hints.innerHTML = [
    crop ? `พืชที่เลือก: ${crop}` : '',
    stage ? `ระยะ: ${stage}` : '',
    preset?.title ? `สูตรแนะนำ: ${preset.title}` : '',
    preset?.note || '',
    `น้ำรวม ${fmtCalcNumber(totalWater)} ลิตร`,
    strength === 'low' ? 'โหมดเริ่มต้น เหมาะกับแปลงที่ต้องการเริ่มเบา ๆ' : '',
    strength === 'high' ? 'โหมดเข้ม เหมาะกับแปลงที่ต้องการเร่งผลลัพธ์' : '',
    stickerRow ? `เพิ่ม ${stickerRow.product.name} เพื่อช่วยการเกาะใบ` : '',
  ].filter(Boolean).slice(0, 6).map((item) => `<span>${esc(item)}</span>`).join('');
  if (guideGrid) {
    guideGrid.innerHTML = calcGuideStepsHTML({
      crop,
      stage,
      presetTitle: preset?.title || '',
      fields,
      rows,
      stickerRow,
    });
  }
  if (aiAnalysis) {
    aiAnalysis.innerHTML = calcAiAnalysisHTML({
      crop,
      stage,
      presetTitle: preset?.title || '',
      fields,
      rows,
      totalWater,
      totalDose,
      strength,
      stickerRow,
    });
  }
  if (timeline) {
    timeline.innerHTML = calcTimelineHTML({
      crop,
      stage,
      presetTitle: preset?.title || '',
      rows,
      strength,
      totalWater,
      days: planDays,
    });
  }
  if (compareOut) {
    compareOut.innerHTML = calcCompareHTML({
      crop,
      currentPreset: preset,
      comparePreset,
      currentRows: rows,
      totalWater,
      strength,
    });
  }
  if (copyBtn) {
    copyBtn.disabled = false;
    copyBtn.dataset.copyText = shareText;
  }
  if (pitchCopyBtn) {
    pitchCopyBtn.disabled = false;
    pitchCopyBtn.dataset.copyText = pitchText;
  }
  if (lineShareBtn) {
    lineShareBtn.setAttribute('href', `https://line.me/R/msg/text/?${encodeURIComponent(pitchText)}`);
  }
  if (bundleBtn) {
    bundleBtn.disabled = !selectedProducts.length;
    bundleBtn.dataset.bundlePlan = JSON.stringify(bundleRecommendations.map((item) => ({ id: item.product.id, qty: item.qty, packSize: item.packSize })));
  }
  if (checkoutNowBtn) {
    checkoutNowBtn.disabled = !selectedProducts.length;
    checkoutNowBtn.dataset.bundlePlan = JSON.stringify(bundleRecommendations.map((item) => ({ id: item.product.id, qty: item.qty, packSize: item.packSize })));
  }
  if (bundleHint) {
    const bundlePrice = bundleRecommendations.reduce((sum, item) => sum + (effPrice(item.product) * item.qty), 0);
    bundleHint.textContent = `เพิ่มทั้งชุดตามแผน ${fmtCalcNumber(planDays)} วันได้ทันที ระดับงบ ${calcBudgetLead(budgetLevel)} มูลค่าประมาณ ${baht(bundlePrice)}`;
  }
  if (bundleItems) {
    bundleItems.innerHTML = calcBundleSummaryHTML(bundleRecommendations);
  }
  if (salesLineBtn) {
    salesLineBtn.href = `https://line.me/R/msg/text/?${encodeURIComponent(salesLineText)}`;
  }
  if (openOaBtn) {
    openOaBtn.href = S('LINE_OA_URL') || `https://line.me/R/msg/text/?${encodeURIComponent(salesLineText)}`;
  }
  if (salesHint) {
    salesHint.textContent = `พร้อมส่งข้อความขายของ${crop || 'พืช'} ระดับงบ ${calcBudgetLead(budgetLevel)} และลิงก์ดูรายละเอียดต่อให้ลูกค้า`;
  }
  if (consultLineBtn) {
    consultLineBtn.href = `https://line.me/R/msg/text/?${encodeURIComponent(consultText)}`;
  }
  if (consultLeadBtn) {
    consultLeadBtn.disabled = false;
    consultLeadBtn.dataset.leadPayload = JSON.stringify({
      crop,
      stage: calcLeadStageValue(stage, problemInfo?.label || ''),
      problem: [
        problemInfo?.label ? `อาการ: ${problemInfo.label}` : '',
        preset?.title ? `สูตรที่สนใจ: ${preset.title}` : '',
        `น้ำรวมต่อรอบ ${fmtCalcNumber(totalWater)} ลิตร`,
        `แผน ${fmtCalcNumber(planDays)} วัน`,
        ...bundleRecommendations.map((item) => `${item.product.name} แนะนำ ${item.qty} ขวด ขนาด ${item.packSize} ซีซี`),
      ].filter(Boolean).join('\n'),
    });
  }
  if (consultHint) {
    consultHint.textContent = `ตอนนี้ระบบพร้อมส่งข้อมูลของ${crop || 'พืช'}${problemInfo?.label ? ` อาการ${problemInfo.label}` : ''} และสูตร ${preset?.title || 'ที่กำลังเลือก'} ให้ทีมงานตรวจต่อ`;
  }
  if (mixPlan) {
    mixPlan.innerHTML = rows.map((row) => {
      const knowledge = calcKnowledge().products?.[row.product.id] || {};
      const sourceLink = row.profile.research?.sourceUrl ? `<a href="${esc(row.profile.research.sourceUrl)}" target="_blank" rel="noopener">อ้างอิง</a>` : '';
      return `<article class="calc-mix-row ${row.isSticker ? 'is-sticker' : ''}">
        <div class="calc-mix-copy">
          <b>${esc(row.product.name)}</b>
          <span>${esc(knowledge.label || row.profile.research?.title || row.product.short || '')}</span>
        </div>
        <div class="calc-mix-dose">
          <strong>${fmtCalcNumber(row.exact)} ซีซี</strong>
          <span>${row.range.min === row.range.max ? `คงที่ ${fmtCalcNumber(row.range.min)} ซีซี` : `ช่วง ${fmtCalcNumber(row.range.min)}-${fmtCalcNumber(row.range.max)} ซีซี`}</span>
        </div>
        <div class="calc-mix-meta">
          <span>${esc(row.profile.research?.interval || 'ฉีดพ่นตามรอบที่เหมาะกับพืช')}</span>
          ${sourceLink}
        </div>
      </article>`;
    }).join('');
  }
  rate.innerHTML = rows.map((row) => {
    const sourceLink = row.profile.research?.sourceUrl ? `<a href="${esc(row.profile.research.sourceUrl)}" target="_blank" rel="noopener">เปิดแหล่งอ้างอิง</a>` : '';
    const conflict = row.profile.research?.rateRaw && row.profile.raw && normalizeCalcText(row.profile.research.rateRaw) !== normalizeCalcText(row.profile.raw)
      ? `<div class="calc-alert">สำหรับ ${esc(row.product.name)} ข้อมูลอัตราในระบบเดิมคือ ${esc(row.profile.raw)} แต่ระบบเลือกใช้อัตราอ้างอิงจากเว็บแบรนด์ ${esc(row.profile.research.rateRaw)} เพื่อคำนวณแบบปลอดภัยกว่า หากมีฉลากสินค้าอยู่ในมือให้ยึดตามฉลากก่อน</div>`
      : '';
    return `<div class="calc-rate-block">
      <b>${esc(row.product.name)}</b>
      <div>อัตราที่ใช้คำนวณ: ${esc(row.profile.research?.rateRaw || row.profile.raw || row.profile.selectedRate.raw)}</div>
      ${row.profile.research?.sourceLabel ? `<div>แหล่งอ้างอิง: ${esc(row.profile.research.sourceLabel)} ${sourceLink}</div>` : ''}
      ${row.profile.research?.interval ? `<div>รอบพ่นแนะนำ: ${esc(row.profile.research.interval)}</div>` : ''}
      ${conflict}
    </div>`;
  }).join('');
}

// ── articles (ความรู้เกษตร) ──
async function viewArticles() {
  let list = [];
  try { list = await (await fetch('/api/articles')).json(); } catch {}
  setPageMeta('บทความความรู้เกษตร', 'รวมบทความ เคล็ดลับ และคำแนะนำที่ช่วยให้ลูกค้าเข้าใจการเลือกสูตรและการใช้งานได้ง่ายขึ้น');
  const featured = list[0];
  const cards = list.length ? list.slice(featured ? 1 : 0).map((a, i) => `<a class="card glass reveal article-card" href="${routeHref('/article/' + a.id)}" style="transition-delay:${(i % 3) * 0.07}s">
    <div class="art-cover">${a.cover ? `<img src="${a.cover}" alt="${esc(a.title)}" loading="lazy">` : icon('leaf', 'd-ico')}</div>
    <div class="body"><h3>${esc(a.title)}</h3><p class="desc">${esc(a.excerpt || '')}</p><span class="art-more">อ่านต่อ →</span></div>
  </a>`).join('') : '<p class="muted" style="text-align:center;grid-column:1/-1">ยังไม่มีบทความ</p>';
  return `<section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">ความรู้เกษตร</span><h2>บทความ & เคล็ดลับที่อ่านแล้วเข้าใจง่าย</h2><p class="muted">รวมเนื้อหาที่ช่วยลูกค้าเข้าใจปัญหา เลือกสูตร และตัดสินใจทักทีมงานได้เร็วขึ้น</p></div>
    ${featured ? `<a class="article-feature glass reveal" href="${routeHref('/article/' + featured.id)}">
      <div class="article-feature-media">${featured.cover ? `<img src="${featured.cover}" alt="${esc(featured.title)}" loading="lazy">` : icon('leaf', 'hero-ico')}</div>
      <div class="article-feature-copy"><span class="eyebrow">บทความแนะนำ</span><h3>${esc(featured.title)}</h3><p>${esc(featured.excerpt || '')}</p><div class="article-feature-points"><span>อ่านง่าย</span><span>เข้าใจไว</span><span>ใช้คุยกับลูกค้าได้จริง</span></div><span class="art-more">เปิดอ่านบทความนี้ →</span></div>
    </a>` : ''}
    <div class="products article-grid">${cards}</div></section>`;
}
async function viewArticle({ id }) {
  let a = null;
  let related = [];
  try { const r = await fetch('/api/articles/' + encodeURIComponent(id)); if (r.ok) a = await r.json(); } catch {}
  try {
    const list = await (await fetch('/api/articles')).json();
    related = asArray(list).filter((item) => item.id !== id).slice(0, 3);
  } catch {}
  if (!a) return viewNotFound();
  setPageMeta(a.title, a.excerpt || a.body?.slice(0, 150) || '');
  const paragraphs = (a.body || '').split('\n').map((p) => p.trim()).filter(Boolean);
  const paras = paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
  const highlights = paragraphs.slice(0, 3).map((p) => p.length > 96 ? `${p.slice(0, 96)}...` : p);
  const readMinutes = Math.max(1, Math.ceil((a.body || '').split(/\s+/).filter(Boolean).length / 180));
  return `<section class="section page-top article-read">
    <a class="back" href="${routeHref('/articles')}">← กลับไปบทความ</a>
    <div class="article-hero-block glass reveal">
      <div class="article-hero-copy">
        <span class="eyebrow">บทความความรู้</span>
        <h1>${esc(a.title)}</h1>
        <p class="article-excerpt">${esc(a.excerpt || paragraphs[0] || '')}</p>
        <div class="article-meta-row"><span>อัปเดต ${new Date(a.createdAt).toLocaleDateString('th-TH')}</span><span>อ่านประมาณ ${readMinutes} นาที</span><span>เหมาะสำหรับใช้ตอบคำถามลูกค้า</span></div>
      </div>
      <div class="article-hero-media">${a.cover ? `<img class="art-hero reveal" src="${a.cover}" alt="">` : icon('leaf', 'hero-ico')}</div>
    </div>
    <div class="article-layout">
      <div class="article-main">
        ${highlights.length ? `<div class="article-highlight-grid reveal">${highlights.map((item, idx) => `<article class="article-highlight-card"><b>ประเด็น ${idx + 1}</b><span>${esc(item)}</span></article>`).join('')}</div>` : ''}
        <div class="article-body glass reveal">${paras}</div>
        <div class="cta-band glass reveal article-cta"><h2>อ่านแล้วอยากให้ทีมงานช่วยแนะนำต่อ?</h2><p>กดขอคำแนะนำแล้วส่งข้อมูลให้แอดมินติดตามต่อได้ทันที หรือทักแชทเพื่อคุยรายละเอียดเพิ่ม</p><div class="hero-cta"><button class="btn btn-primary" type="button" data-scrolllead>ขอคำแนะนำเร็ว</button><button class="btn btn-glass" type="button" data-openchat>ปรึกษาตอนนี้ 💬</button></div></div>
      </div>
      <aside class="article-summary glass reveal">
        <span class="eyebrow">สรุปเร็ว</span>
        <h3>อ่านประเด็นสำคัญก่อน</h3>
        <div class="article-summary-list">${(highlights.length ? highlights : paragraphs.slice(0, 3)).map((item) => `<div>${esc(item)}</div>`).join('')}</div>
        <div class="article-summary-actions">
          <button class="btn btn-primary" type="button" data-scrolllead>ขอคำแนะนำเร็ว</button>
          <button class="btn btn-glass" type="button" data-openchat>คุยกับทีมงาน</button>
        </div>
      </aside>
    </div>
    ${related.length ? `<section class="article-related reveal"><div class="panel-head"><span class="eyebrow">อ่านต่อ</span><h2>บทความที่เกี่ยวข้อง</h2></div><div class="products article-grid">${related.map((item, i) => `<a class="card glass article-card" href="${routeHref('/article/' + item.id)}" style="transition-delay:${(i % 3) * 0.07}s"><div class="art-cover">${item.cover ? `<img src="${item.cover}" alt="${esc(item.title)}" loading="lazy">` : icon('leaf', 'd-ico')}</div><div class="body"><h3>${esc(item.title)}</h3><p class="desc">${esc(item.excerpt || '')}</p><span class="art-more">อ่านต่อ →</span></div></a>`).join('')}</div></section>` : ''}
  </section>`;
}

// ── product media gallery (3D model / video / images) ──
let _detailMedia = [], _detailProduct = null;
function buildMedia(p) {
  const m = [];
  if (p.model) m.push({ t: 'model', src: p.model });
  if (p.video) m.push({ t: 'video', src: p.video });
  if (p.image) m.push({ t: 'image', src: p.image });
  (p.images || []).forEach((src) => m.push({ t: 'image', src }));
  if (!m.length) m.push({ t: 'icon' });
  return m;
}
function mediaMain(item, p) {
  if (item.t === 'model') { ensureModelViewer(); return `<model-viewer class="mv" src="${item.src}" camera-controls auto-rotate ar shadow-intensity="1" exposure="1.1" loading="eager"></model-viewer>`; }
  if (item.t === 'video') return `<video class="media-el" controls muted loop playsinline ${p.image ? `poster="${p.image}"` : ''} src="${item.src}"></video>`;
  if (item.t === 'image') return `<img class="media-el zoomable" src="${item.src}" data-zoom="${item.src}" alt="${esc(p.name)}">`;
  return icon(p.icon || 'pod', 'd-ico');
}
function mediaThumb(item, i, active) {
  const inner = item.t === 'model' ? '<span class="t3d">3D</span>' : item.t === 'video' ? '<span class="t3d">▶</span>'
    : item.t === 'image' ? `<img src="${item.src}">` : icon(_detailProduct.icon || 'pod', 'g-ico');
  return `<button class="gthumb ${active ? 'on' : ''}" data-mi="${i}">${inner}</button>`;
}
function renderMain(i) {
  const main = document.getElementById('mainMedia'); if (!main) return;
  main.innerHTML = mediaMain(_detailMedia[i], _detailProduct);
  document.querySelectorAll('.gthumb').forEach((b, j) => b.classList.toggle('on', j === i));
  main._tilt = false; attachTilt(main.parentElement);
}
function reviewsHTML(p, data) {
  const { reviews, stats } = data;
  const reviewed = currentUser && reviews.some((r) => r.userId === currentUser.id);
  const form = !currentUser
    ? `<p class="muted"><a href="${routeHref('/login')}" style="color:var(--accent)">เข้าสู่ระบบ</a> เพื่อเขียนรีวิว</p>`
    : reviewed ? `<p class="muted">คุณรีวิวสินค้านี้แล้ว — ขอบคุณครับ 🙏</p>`
    : `<form id="reviewForm" class="review-form glass" data-pid="${p.id}">
        <div class="star-pick" id="starPick">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-star="${n}">★</button>`).join('')}</div>
        <input type="hidden" name="rating" value="0">
        <textarea name="comment" rows="2" placeholder="เล่าประสบการณ์การใช้งาน…"></textarea>
        <button class="btn btn-primary" type="submit">ส่งรีวิว</button>
      </form>`;
  const list = reviews.length ? reviews.map((r) => `<div class="review-item">
      <div class="rev-head"><b>${esc(r.name || 'ลูกค้า')}</b>${stars(r.rating)}</div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ''}<small class="muted">${new Date(r.createdAt).toLocaleDateString('th-TH')}</small>
    </div>`).join('') : '<p class="muted">ยังไม่มีรีวิว — เป็นคนแรกเลย!</p>';
  return `<section class="section reviews-sec">
    <div class="section-head reveal"><span class="eyebrow">รีวิวจากลูกค้า</span><h2>${stats.count ? `${stats.avg} ★ · ${stats.count} รีวิว` : 'ยังไม่มีรีวิว'}</h2></div>
    <div class="reviews-wrap reveal">${form}<div class="review-list">${list}</div></div>
  </section>`;
}
function faqItems(extra) {
  return asArray(extra.faq).map((it) => {
    if (!it) return null;
    if (typeof it === 'string') {
      const idx = it.indexOf('::');
      return idx > -1 ? { q: it.slice(0, idx).trim(), a: it.slice(idx + 2).trim() } : null;
    }
    return { q: it.q || '', a: it.a || '' };
  }).filter((it) => it && it.q && it.a);
}
function standardProductBlocks(p) {
  const extra = productExtra(p);
  const crops = productCrops(p);
  const usageSteps = asArray(extra.usageSteps);
  const warnings = asArray(extra.warnings);
  const faqs = faqItems(extra);
  return `<section class="detail-panel glass reveal">
    <div class="panel-head"><span class="eyebrow">ข้อมูลสำคัญ</span><h2>ดูข้อมูลจำเป็นก่อน แล้วค่อยเปิดรายละเอียดเพิ่ม</h2></div>
    <div class="detail-summary-grid">
      ${isAgriProduct(p) ? `<div class="summary-box"><span>เลขทะเบียน</span><b>${esc(extra.registrationNo || 'รออัปเดตเลขทะเบียน')}</b></div>` : ''}
      <div class="summary-box"><span>วิธีใช้หลัก</span><b>${esc(extra.applicationMethod || p.specs['วิธีใช้'] || '-')}</b></div>
      <div class="summary-box"><span>อัตราแนะนำ</span><b>${esc(extra.dosage || p.specs['อัตรา'] || '-')}</b></div>
      <div class="summary-box"><span>เหมาะกับพืช</span><b>${esc(crops.join(' / ') || 'พืชทั่วไป')}</b></div>
    </div>
    ${extra.labelUrl ? `<div class="detail-doc-link"><a class="btn btn-glass" href="${esc(extra.labelUrl)}" target="_blank" rel="noopener">เปิดฉลาก / เอกสาร</a>${extra.labelNote ? `<p class="form-note">${esc(extra.labelNote)}</p>` : ''}</div>` : ''}
    <div class="detail-folds">
      <details class="detail-fold" open>
        <summary>วิธีใช้และขั้นตอนแนะนำ</summary>
        <div class="standard-grid fold-content">
          <div class="std-card">
            <h3>วิธีใช้</h3>
            <div class="std-list">
              <div><span>รูปแบบการใช้</span><b>${esc(extra.applicationMethod || p.specs['วิธีใช้'] || '-')}</b></div>
              <div><span>อัตราแนะนำ</span><b>${esc(extra.dosage || p.specs['อัตรา'] || '-')}</b></div>
            </div>
          </div>
          <div class="std-card">
            <h3>ขั้นตอนแนะนำ</h3>
            <ol class="std-steps">${usageSteps.length ? usageSteps.map((step) => `<li>${esc(step)}</li>`).join('') : '<li>ศึกษาฉลากก่อนใช้ทุกครั้ง</li>'}</ol>
          </div>
        </div>
      </details>
      ${warnings.length ? `<details class="detail-fold">
        <summary>คำเตือนและข้อควรระวัง</summary>
        <ul class="warning-list fold-content">${warnings.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
      </details>` : ''}
      ${faqs.length ? `<details class="detail-fold">
        <summary>คำถามที่พบบ่อย</summary>
        <div class="faq-list fold-content">${faqs.map((item, idx) => `<details class="faq-item" ${idx === 0 ? 'open' : ''}><summary>${esc(item.q)}</summary><p>${esc(item.a)}</p></details>`).join('')}</div>
      </details>` : ''}
    </div>
    ${isAgriProduct(p) ? `<div class="crop-tags detail-crop-tags">${crops.length ? crops.map((crop) => {
      const slug = cropSlugMap()[crop];
      return slug ? `<a class="crop-tag" href="/crops/${slug}">${esc(crop)}</a>` : `<span class="crop-tag">${esc(crop)}</span>`;
    }).join('') : '<span class="crop-tag">พืชทั่วไป</span>'}</div>` : ''}
  </section>`;
}
async function viewProductDetail({ id }) {
  let p = productById(id);
  try { const fp = await (await fetch('/api/products/' + encodeURIComponent(id))).json(); if (fp && !fp.error) p = fp; } catch {}
  if (!p) return viewNotFound();
  setPageMeta(`${p.name}`, `${p.short || p.desc || ''}`);
  _detailProduct = p; _detailMedia = buildMedia(p);
  let rev = { reviews: [], stats: { avg: 0, count: 0 } };
  try { rev = await (await fetch('/api/products/' + encodeURIComponent(id) + '/reviews')).json(); } catch {}
  const cropSet = new Set(productCrops(p));
  const related = PRODUCTS.filter((x) => x.id !== id && productSegment(x) === productSegment(p))
    .sort((a, b) => {
      const aScore = productCrops(a).filter((crop) => cropSet.has(crop)).length;
      const bScore = productCrops(b).filter((crop) => cropSet.has(crop)).length;
      return bScore - aScore;
    }).slice(0, 3);
  const extra = productExtra(p);
  const quickPoints = isAgriProduct(p)
    ? [`ใช้กับ ${productCrops(p).join(' / ') || 'พืชทั่วไป'}`, extra.applicationMethod || p.specs['วิธีใช้'] || 'ฉีดพ่นทางใบ', extra.dosage || p.specs['อัตรา'] || 'อ่านฉลากก่อนใช้']
    : ['สินค้าจากแบรนด์เดียวกัน', 'สั่งซื้อออนไลน์ได้ทันที', 'มีทีมงานตอบคำถามก่อนสั่งซื้อ'];
  return `
  <section class="section page-top detail">
    <a class="back" href="${routeHref('/products')}">← กลับไปหน้าสินค้า</a>
    <div class="detail-grid">
      <div class="detail-visual glass reveal">
        <span class="d-glow"></span>
        <div class="media-main media3d" data-tilt id="mainMedia">${mediaMain(_detailMedia[0], p)}</div>
        ${_detailMedia.length > 1 ? `<div class="gallery-thumbs">${_detailMedia.map((m, i) => mediaThumb(m, i, i === 0)).join('')}</div>` : ''}
      </div>
      <div class="detail-info reveal">
        <div class="di-top"><span class="tag">${esc(p.tag || '')}</span>${heartBtn(p.id)}</div>
        <h1>${esc(p.name)}</h1>
        ${p.reviews ? `<div class="card-rate">${stars(p.rating)}<small>${p.rating} (${p.reviews} รีวิว)</small></div>` : ''}
        <div class="d-price">${effPrice(p) < p.price ? `<span class="price-old">${baht(p.price)}</span> ${baht(effPrice(p))} <span class="sale-badge">-${Math.round((1 - effPrice(p) / p.price) * 100)}%</span>` : baht(p.price)}</div>
        <div class="stock-line ${p.stock <= 0 ? 'out' : p.stock <= 5 ? 'low' : ''}">${p.stock <= 0 ? 'สินค้าหมด' : p.stock <= 5 ? `เหลือเพียง ${p.stock} ชิ้น` : 'มีสินค้าพร้อมส่ง'}</div>
        <p class="d-desc">${esc(p.desc || '')}</p>
        <div class="detail-points">${quickPoints.map((item) => `<span>${esc(item)}</span>`).join('')}</div>
        ${isAgriProduct(p) ? `<div class="detail-summary-grid compact-top-grid">
          <div class="summary-box"><span>เลขทะเบียน</span><b>${esc(extra.registrationNo || 'รออัปเดตเลขทะเบียน')}</b></div>
          <div class="summary-box"><span>พืชที่เหมาะ</span><b>${esc(productCrops(p).join(' / ') || 'พืชทั่วไป')}</b></div>
          <div class="summary-box"><span>เอกสาร</span><b>${extra.labelUrl ? 'มีฉลากให้เปิดดู' : 'ยังไม่มีไฟล์ฉลาก'}</b></div>
        </div>` : ''}
        <div class="qty-row"><span>จำนวน</span><div class="qtybox"><button data-qd>−</button><span id="detailQty">1</span><button data-qi>+</button></div></div>
        <div class="d-actions">
          ${p.stock <= 0
            ? '<button class="btn btn-primary" disabled>สินค้าหมด</button>'
            : `<button class="btn btn-primary" data-buynow="${p.id}">ซื้อเลย</button>
          <button class="btn btn-glass" data-addqty="${p.id}">เพิ่มลงตะกร้า</button>`}
        </div>
        <div class="detail-assurance">
          <div><b>จัดส่ง</b><span>ติดตามออเดอร์และเลขพัสดุได้</span></div>
          <div><b>ปรึกษาฟรี</b><span>ให้ทีมงานช่วยเลือกสูตรหรือวิธีใช้ก่อนซื้อ</span></div>
          <div><b>เอกสารประกอบ</b><span>${extra.labelUrl ? 'มีไฟล์ฉลาก / เอกสารเปิดดูได้' : 'เพิ่มฉลากและ FAQ ได้จากหลังบ้าน'}</span></div>
        </div>
        <ul class="specs">${Object.entries(p.specs).map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul>
        ${calcWidget(p)}
      </div>
    </div>
    ${standardProductBlocks(p)}
    ${productSupportSection(p, rev)}
    ${reviewsHTML(p, rev)}
    <div class="section-head reveal" style="margin-top:30px"><span class="eyebrow">สินค้าที่เกี่ยวข้อง</span><h2>อาจถูกใจคุณ</h2></div>
    <div class="products">${related.map((r, i) => productCard(r, i)).join('')}</div>
    ${p.stock > 0 ? `<div class="mobile-buybar">
      <div class="mobile-buybar-copy"><b>${esc(p.name)}</b><span>${baht(effPrice(p))}</span></div>
      <button class="btn btn-primary" data-buynow="${p.id}">ซื้อเลย</button>
    </div>` : ''}
  </section>`;
}

function viewAbout() {
  setPageMeta('เกี่ยวกับเรา', 'ข้อมูลแบรนด์นุชฟอร์ไลฟ์และแนวทางช่วยเกษตรกรไทยเพิ่มผลผลิต');
  return `
  <section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">เกี่ยวกับเรา</span><h2>นุชฟอร์ไลฟ์ — นวัตกรรมเพื่อเกษตรกรไทย</h2></div>
    <p class="about-lead reveal">เราพัฒนาและจำหน่ายอาหารเสริมพืช ฮอร์โมน และสารจับใบคุณภาพสูง รวมถึงผลิตภัณฑ์สมุนไพรเพื่อสุขภาพ มุ่งช่วยเกษตรกรไทยเพิ่มผลผลิต ลดต้นทุน และทำเกษตรอย่างยั่งยืน พร้อมทีมนักวิชาการให้คำปรึกษาอย่างใกล้ชิด</p>
  </section>
  <section class="section stats reveal">
    <div class="stat"><b data-count="20000">0</b><span>เกษตรกรไว้วางใจ</span></div>
    <div class="stat"><b data-count="10">0</b><span>ผลิตภัณฑ์</span></div>
    <div class="stat"><b data-count="4.9" data-decimals="1">0</b><span>คะแนนเฉลี่ย</span></div>
    <div class="stat"><b data-count="99" data-suffix="%">0</b><span>ส่งตรงเวลา</span></div>
  </section>
  <section class="section">
    <div class="features">
      <article class="feature glass reveal"><div class="f-ico">${icon('truck')}</div><h3>จัดส่งทั่วไทย</h3><p>ส่งไว พร้อมเลขพัสดุติดตามได้ทุกออเดอร์</p></article>
      <article class="feature glass reveal"><div class="f-ico">${icon('shieldleaf')}</div><h3>คุณภาพมั่นใจ</h3><p>ผลิตภัณฑ์คุณภาพ ใช้ได้จริง เกษตรกรทั่วประเทศไว้วางใจ</p></article>
      <article class="feature glass reveal"><div class="f-ico">${icon('chat')}</div><h3>ปรึกษาฟรี</h3><p>ทีมนักวิชาการตอบผ่าน Live Chat เชื่อม LINE ช่วยทุกขั้นตอน</p></article>
    </div>
  </section>
  <section class="cta-band glass reveal">
    <h2>พร้อมเพิ่มผลผลิตกับนุชฟอร์ไลฟ์แล้วหรือยัง?</h2>
    <p>เลือกชมสินค้าหรือทักแชทปรึกษานักวิชาการได้เลย</p>
    <a href="${routeHref('/products')}" class="btn btn-primary">เลือกซื้อสินค้า</a>
  </section>`;
}

function checkoutTotalsHTML() {
  const sub = cartTotal();
  const disc = appliedCoupon?.discount || 0;
  const country = document.getElementById('coCountry')?.value || S('SHIP_HOME') || 'ไทย';
  const ship = shipFee(country, Math.max(0, sub - disc));
  const total = Math.max(0, sub - disc) + ship;
  return `
    <div class="sum-row"><span>ยอดสินค้า</span><b>${baht(sub)}</b></div>
    ${disc ? `<div class="sum-row"><span>ส่วนลด${appliedCoupon ? ' (' + appliedCoupon.code + ')' : ''}</span><b>−${baht(disc)}</b></div>` : ''}
    <div class="sum-row"><span>ค่าจัดส่ง${ship === 0 ? ' · ฟรี' : ''}</span><b>${baht(ship)}</b></div>
    <div class="sum-total"><span>รวมทั้งหมด</span><b>${baht(total)}</b></div>`;
}
function viewCheckout() {
  setPageMeta('ชำระเงิน', 'กรอกข้อมูลสั่งซื้อและชำระเงินอย่างปลอดภัย');
  if (cart.size === 0) {
    return `<section class="section page-top"><div class="empty-state glass reveal">
      <div class="es-ico">🛒</div><h2>ตะกร้าว่างเปล่า</h2><p>ยังไม่มีสินค้าในตะกร้าของคุณ</p>
      <a class="btn btn-primary" href="${routeHref('/products')}">เลือกซื้อสินค้า</a></div></section>`;
  }
  let rows = '';
  const checkoutPoints = settingLines('SITE_CHECKOUT_POINTS', DEFAULT_CHECKOUT_POINTS);
  cart.forEach((qty, id) => {
    const p = productById(id); if (!p) return;
    rows += `<div class="sum-row"><span>${p.name} <em>×${qty}</em></span><b>${baht(effPrice(p) * qty)}</b></div>`;
  });
  return `
  <section class="section page-top">
    <div class="section-head reveal"><span class="eyebrow">ขั้นตอนสุดท้าย</span><h2>กรอกข้อมูลสั่งซื้อ</h2></div>
    <div class="checkout-grid">
      <form id="checkoutForm" class="checkout-form glass reveal">
        <label>ชื่อผู้รับ <input name="name" required autocomplete="name" placeholder="ชื่อ–นามสกุล" /></label>
        <label>เบอร์โทร <input name="phone" required inputmode="tel" autocomplete="tel" placeholder="08x-xxx-xxxx" /></label>
        <label>อีเมล (รับใบยืนยันออเดอร์) <input name="email" type="email" autocomplete="email" placeholder="you@email.com" /></label>
        <label>ที่อยู่จัดส่ง <textarea name="address" required autocomplete="street-address" rows="3" placeholder="บ้านเลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์"></textarea></label>
        <label>ประเทศจัดส่ง <select name="country" id="coCountry">
          <option>ไทย</option><option>สิงคโปร์</option><option>มาเลเซีย</option><option>ลาว</option><option>กัมพูชา</option><option>เวียดนาม</option><option>อื่นๆ (ต่างประเทศ)</option>
        </select></label>
        <label>หมายเหตุ (ถ้ามี) <input name="note" placeholder="เช่น สี/รุ่นที่ต้องการ, เวลาสะดวกรับของ" /></label>
        <div class="pay-options">
          <span class="pay-label">วิธีชำระเงิน</span>
          <label class="pay"><input type="radio" name="payment" value="promptpay" checked /><span><b>PromptPay QR</b><small>สแกนจ่ายด้วยแอปธนาคาร</small></span></label>
          <label class="pay"><input type="radio" name="payment" value="card" /><span><b>บัตรเครดิต / เดบิต</b><small>ชำระผ่าน Stripe ปลอดภัย</small></span></label>
        </div>
        <button type="submit" class="btn btn-primary">ดำเนินการชำระเงิน</button>
        <p class="form-note">PromptPay จะแสดง QR ให้สแกนจ่าย · บัตรเครดิตจะพาไปหน้าชำระเงินที่ปลอดภัยของ Stripe</p>
      </form>
      <aside class="summary glass reveal">
        <h3>สรุปคำสั่งซื้อ</h3>
        ${rows}
        <div class="coupon-box">
          ${appliedCoupon
            ? `<div class="coupon-applied"><span>คูปอง <b>${appliedCoupon.code}</b> · −${baht(appliedCoupon.discount)}</span><button type="button" id="couponRemove">ลบ</button></div>`
            : `<div class="coupon-input"><input id="couponInput" placeholder="รหัสคูปอง" autocomplete="off"><button type="button" id="couponApply">ใช้</button></div>`}
        </div>
        <div id="sumTotals">${checkoutTotalsHTML()}</div>
        <div class="checkout-trust">
          <h4>มั่นใจก่อนชำระเงิน</h4>
          <ul class="support-list">${checkoutPoints.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>
          ${lineCTA('line-inline')}
        </div>
        <a href="${routeHref('/products')}" class="back" style="margin-top:14px;display:inline-block">← เลือกซื้อเพิ่ม</a>
      </aside>
    </div>
  </section>`;
}

const STATUS_STEPS = [
  { key: 'awaiting_payment', label: 'รอชำระเงิน', icon: '💳' },
  { key: 'paid', label: 'ชำระเงินแล้ว', icon: '✅' },
  { key: 'preparing', label: 'เตรียมสินค้า', icon: '📦' },
  { key: 'shipped', label: 'จัดส่งแล้ว', icon: '🚚' },
  { key: 'delivered', label: 'สำเร็จ', icon: '🎉' },
];

async function fetchOrder(id) {
  try { const r = await fetch('/api/orders/' + encodeURIComponent(id)); if (r.ok) return await r.json(); } catch {}
  return null;
}

async function viewOrder({ id }) {
  let order = await fetchOrder(id);
  if (!order) return viewNotFound();
  // กลับมาจากหน้า Stripe → ลองยืนยันการชำระเงิน
  if (order.payment_method === 'card' && !order.paid) {
    try { await fetch('/api/orders/' + id + '/confirm-stripe', { method: 'POST' }); } catch {}
    order = (await fetchOrder(id)) || order;
  }
  setPageMeta(`ออเดอร์ ${id}`, 'ติดตามสถานะคำสั่งซื้อและการชำระเงิน');
  startOrderPoll(id, order);
  return renderOrderHTML(order);
}

function renderOrderHTML(o) {
  const cancelled = o.status === 'cancelled';
  const stepIndex = cancelled ? -1 : STATUS_STEPS.findIndex((s) => s.key === o.status);
  const timeline = cancelled ? '' : `<div class="timeline">${STATUS_STEPS.map((s, i) => `
    <div class="tl-step ${i <= stepIndex ? 'done' : ''} ${i === stepIndex ? 'cur' : ''}">
      <span class="tl-dot">${i < stepIndex ? '✓' : s.icon}</span><span class="tl-label">${s.label}</span></div>`).join('')}</div>`;

  let pay;
  if (cancelled) {
    pay = `<div class="pay-block cancel glass"><div class="es-ico">✕</div><h3>ออเดอร์ถูกยกเลิก</h3><p>หากมีข้อสงสัยทักแชทแอดมินได้เลย</p></div>`;
  } else if (o.paid) {
    if (!markTracked('purchase:' + o.id)) trackEvent('purchase', { value: o.total, currency: 'THB', order_id: o.id });
    pay = `<div class="pay-block paid glass"><div class="success-ico">✓</div><h3>ชำระเงินเรียบร้อย</h3><p>ขอบคุณสำหรับการสั่งซื้อ ทีมงานกำลังดูแลออเดอร์ของคุณ</p></div>`;
  } else if (o.payment_method === 'promptpay') {
    const pp = o.promptpay;
    pay = pp ? `<div class="pay-block glass">
        <h3>สแกนจ่ายด้วย PromptPay</h3>
        <img class="qr" src="${pp.qr}" alt="PromptPay QR" />
        <div class="pay-amt">${baht(o.total)}</div>
        <div class="pay-id">${pp.name ? pp.name + ' · ' : ''}${pp.promptpayId}</div>
        ${o.payment_claimed
          ? `<div class="claimed">⏳ แจ้งชำระแล้ว — รอแอดมินยืนยัน</div>`
          : `<button class="btn btn-primary" data-notifypay="${o.id}">แจ้งว่าชำระเงินแล้ว</button>`}
        <p class="form-note">สแกน QR ด้วยแอปธนาคาร โอนตามยอด แล้วกด "แจ้งว่าชำระเงินแล้ว" — สถานะจะอัปเดตอัตโนมัติ</p>
      </div>` : `<div class="pay-block glass"><p>ระบบ PromptPay ยังไม่พร้อม กรุณาทักแชทแอดมิน</p></div>`;
  } else {
    pay = `<div class="pay-block glass"><h3>รอการชำระเงิน</h3><p>หากยังไม่ได้ชำระผ่านบัตร กรุณาทักแชทแอดมินเพื่อขอลิงก์ชำระเงินใหม่</p></div>`;
  }

  const items = o.items.map((it) => `<div class="sum-row"><span>${it.name} <em>×${it.qty}</em></span><b>${baht(it.price * it.qty)}</b></div>`).join('');
  return `
  <section class="section page-top">
    <div class="order-page">
      <div class="order-head reveal">
        <span class="status-badge s-${o.status}">${o.statusLabel || ''}</span>
        <h2>ออเดอร์ ${o.id}</h2>
        <p class="muted">${new Date(o.createdAt).toLocaleString('th-TH')}</p>
      </div>
      ${timeline}
      <div class="order-cols">
        <div class="reveal">${pay}</div>
        <aside class="summary glass reveal">
          <h3>รายการสั่งซื้อ</h3>
          ${items}
          ${o.discount ? `<div class="sum-row"><span>ส่วนลด${o.coupon ? ' (' + o.coupon + ')' : ''}</span><b>−${baht(o.discount)}</b></div>` : ''}
          ${o.shipping ? `<div class="sum-row"><span>ค่าจัดส่ง</span><b>${baht(o.shipping)}</b></div>` : ''}
          <div class="sum-total"><span>รวมทั้งหมด</span><b>${baht(o.total)}</b></div>
          ${o.tracking ? `<div class="sum-row"><span>เลขพัสดุ</span><b>${o.tracking}</b></div>` : ''}
          <div class="sum-row"><span>ผู้รับ</span><b>${o.customer.name}</b></div>
          <div class="sum-row"><span>โทร</span><b>${o.customer.phone}</b></div>
        </aside>
      </div>
      <div class="d-actions" style="justify-content:center;margin-top:30px">
        <button class="btn btn-glass" id="confirmChat">สอบถามแอดมิน 💬</button>
        <a href="${routeHref('/products')}" class="btn btn-glass">เลือกซื้อต่อ</a>
      </div>
    </div>
  </section>`;
}

function viewTrack() {
  return `<section class="section page-top"><div class="track-box glass reveal">
    <div class="es-ico">🔎</div><h2>ติดตามคำสั่งซื้อ</h2><p>กรอกหมายเลขออเดอร์เพื่อดูสถานะ</p>
    <form id="trackForm" class="track-form">
      <input name="oid" placeholder="VYU-XXXXXXX" autocomplete="off" required />
      <button class="btn btn-primary" type="submit">ติดตาม</button>
    </form>
  </div></section>`;
}

function viewNotFound() {
  return `<section class="section page-top"><div class="empty-state glass reveal">
    <div class="es-ico">🧭</div><h2>ไม่พบหน้านี้</h2><p>หน้าที่คุณค้นหาอาจถูกย้ายหรือไม่มีอยู่</p>
    <a class="btn btn-primary" href="${routeHref('/')}">กลับหน้าแรก</a></div></section>`;
}

function loadingView() { return `<section class="section page-top"><p class="muted" style="text-align:center">กำลังโหลด…</p></section>`; }

// ════════════════════════ Auth views ════════════════════════
function viewLogin() {
  if (currentUser) { setTimeout(() => go('/account'), 0); return loadingView(); }
  return `<section class="section page-top"><div class="auth-card glass reveal">
    <h2>เข้าสู่ระบบ</h2><p class="muted">ยินดีต้อนรับกลับสู่ ${esc(S('SITE_NAME'))}</p>
    <form id="loginForm" class="auth-form">
      <label>อีเมล<input name="email" type="email" required autocomplete="email" placeholder="you@email.com"></label>
      <label>รหัสผ่าน<input name="password" type="password" required autocomplete="current-password" placeholder="••••••••"></label>
      <label>คีย์แอดมิน (ถ้ามี)<input name="adminKey" type="password" autocomplete="off" placeholder="กรอกคีย์จากผู้ดูแลระบบ"></label>
      <p class="form-note">ถ้าใส่คีย์ถูกต้อง ระบบจะเปิดสิทธิ์เข้าหลังบ้านให้บัญชีนี้ในอุปกรณ์นี้ทันที</p>
      <button class="btn btn-primary" type="submit">เข้าสู่ระบบ</button>
    </form>
    <p class="auth-alt">ยังไม่มีบัญชี? <a href="${routeHref('/register')}">สมัครสมาชิก</a></p>
  </div></section>`;
}
function viewRegister() {
  if (currentUser) { setTimeout(() => go('/account'), 0); return loadingView(); }
  return `<section class="section page-top"><div class="auth-card glass reveal">
    <h2>สมัครสมาชิก</h2><p class="muted">สร้างบัญชีเพื่อสั่งซื้อและติดตามออเดอร์ได้ง่ายขึ้น</p>
    <form id="registerForm" class="auth-form">
      <label>ชื่อ<input name="name" autocomplete="name" placeholder="ชื่อของคุณ"></label>
      <label>อีเมล<input name="email" type="email" required autocomplete="email" placeholder="you@email.com"></label>
      <label>รหัสผ่าน<input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="อย่างน้อย 6 ตัวอักษร"></label>
      <button class="btn btn-primary" type="submit">สมัครสมาชิก</button>
    </form>
    <p class="auth-alt">มีบัญชีแล้ว? <a href="${routeHref('/login')}">เข้าสู่ระบบ</a></p>
  </div></section>`;
}
async function viewAccount() {
  if (!currentUser) { setTimeout(() => go('/login'), 0); return loadingView(); }
  let orders = [];
  try { orders = await (await api('/api/my/orders')).json(); } catch {}
  const rows = orders.length
    ? orders.map((o) => `<a class="acc-order" href="${routeHref('/order/' + o.id)}"><div><b>${o.id}</b> <span class="muted">· ${new Date(o.createdAt).toLocaleDateString('th-TH')}</span></div><div><span class="status-badge s-${o.status}">${o.statusLabel}</span> <b>${baht(o.total)}</b></div></a>`).join('')
    : '<p class="muted" style="padding:18px">ยังไม่มีคำสั่งซื้อ</p>';
  return `<section class="section page-top"><div class="account">
    <div class="section-head reveal" style="text-align:left;margin-bottom:20px"><span class="eyebrow">บัญชีของฉัน</span><h2>${currentUser.name}</h2><p class="muted">${currentUser.email}${currentUser.role === 'admin' ? ' · ผู้ดูแลระบบ' : ''}</p></div>
    <div class="acc-actions reveal">${currentUser.role === 'admin' ? `<a class="btn btn-primary" href="${routeHref('/admin')}">เข้าสู่หลังบ้าน</a>` : ''}<button class="btn btn-glass" id="logoutBtn">ออกจากระบบ</button></div>
    <h3 style="margin:30px 0 14px">ประวัติคำสั่งซื้อ</h3>
    <div class="acc-orders glass reveal">${rows}</div>
  </div></section>`;
}

// ════════════════════════ Admin views ════════════════════════
function adminGuard() {
  if (!currentUser) { toast('กรุณาเข้าสู่ระบบก่อน', 'err'); setTimeout(() => go('/login'), 0); return false; }
  if (currentUser.role !== 'admin') { toast('เฉพาะผู้ดูแลระบบเท่านั้น', 'err'); setTimeout(() => go('/'), 0); return false; }
  return true;
}
function adminLayout(active, content) {
  const tabs = [['', 'แดชบอร์ด', '◴'], ['products', 'จัดการสินค้า', '❑'], ['articles', 'บทความ', '✐'], ['leads', 'ลีดลูกค้า', '◎'], ['orders', 'ออเดอร์', '❯'], ['coupons', 'คูปองส่วนลด', '٪'], ['users', 'ผู้ใช้', '◇'], ['site', 'ข้อมูลร้าน', '✎'], ['settings', 'ตั้งค่า API', '⚙']];
  const nav = tabs.map(([k, l, ic]) => `<a href="${routeHref('/admin' + (k ? '/' + k : ''))}" class="${active === k ? 'on' : ''}"><span>${ic}</span>${l}</a>`).join('');
  return `<section class="section page-top"><div class="admin">
    <aside class="admin-side glass"><div class="admin-brand"><span class="brand-dot"></span>หลังบ้าน ${esc(S('SITE_NAME'))}</div>${nav}<a href="${routeHref('/')}" class="admin-exit">← กลับหน้าเว็บ</a></aside>
    <div class="admin-main">${content}</div>
  </div></section>`;
}
function areaChart(series, key = 'revenue') {
  const w = 600, h = 170, pad = 10;
  const vals = series.map((s) => s[key]);
  const max = Math.max(1, ...vals);
  const n = series.length;
  const pts = series.map((s, i) => [pad + i * (w - 2 * pad) / Math.max(1, n - 1), h - pad - (s[key] / max) * (h - 2 * pad)]);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = `${line} L ${pts[n - 1][0].toFixed(1)} ${h - pad} L ${pts[0][0].toFixed(1)} ${h - pad} Z`;
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="${pad}" y1="${(h - pad) - g * (h - 2 * pad)}" x2="${w - pad}" y2="${(h - pad) - g * (h - 2 * pad)}" class="grid-l"/>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" class="chart">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
    ${grid}<path d="${area}" fill="url(#ag)"/><path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.6"/>
    ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2" fill="var(--accent)"/>`).join('')}
  </svg>`;
}
function barRows(items, labelKey, valKey, fmt = (v) => v) {
  const max = Math.max(1, ...items.map((x) => x[valKey]));
  return items.map((x) => `<div class="bar-row"><span class="bar-lbl">${x[labelKey]}</span><div class="bar"><i style="width:${(x[valKey] / max * 100).toFixed(0)}%"></i></div><b>${fmt(x[valKey])}</b></div>`).join('');
}
async function viewAdminDash() {
  if (!adminGuard()) return loadingView();
  const a = await (await api('/api/admin/analytics?days=30')).json();
  const s = await (await api('/api/admin/stats')).json();
  const t = a.totals;
  const tiles = `<div class="stat-cards">
    <div class="stat-card"><span>ยอดขายรวม</span><b>${baht(t.revenue)}</b></div>
    <div class="stat-card"><span>ออเดอร์</span><b>${t.orders}</b></div>
    <div class="stat-card"><span>เฉลี่ย/ออเดอร์</span><b>${baht(t.aov)}</b></div>
    <div class="stat-card"><span>ส่วนลดที่ให้</span><b>${baht(t.discountGiven)}</b></div>
    <div class="stat-card"><span>ลีดจากเว็บ</span><b>${s.leads || 0}</b></div></div>`;
  const payItems = [{ label: 'PromptPay', n: a.payment.promptpay }, { label: 'บัตรเครดิต', n: a.payment.card }];
  const status = Object.entries(a.statusBreakdown).map(([k, v]) => `<span class="chip">${a.statusLabels[k] || k} · ${v}</span>`).join('') || '<span class="muted">—</span>';
  const top = a.topProducts.length ? barRows(a.topProducts, 'name', 'qty', (v) => v + ' ชิ้น') : '<p class="muted">ยังไม่มีข้อมูล</p>';
  return adminLayout('', `<h2>แดชบอร์ด</h2>${tiles}
    <div class="dash-card"><div class="dash-head"><h3>ยอดขาย 30 วันล่าสุด</h3><span class="muted">รวม ${baht(t.revenue)} · ${t.paidOrders} ออเดอร์ที่ชำระแล้ว</span></div>${areaChart(a.series)}</div>
    <div class="dash-grid">
      <div class="dash-card"><h3>ช่องทางชำระเงิน</h3>${barRows(payItems, 'label', 'n')}</div>
      <div class="dash-card"><h3>สินค้าขายดี</h3>${top}</div>
    </div>
    <div class="dash-card"><h3>สถานะออเดอร์</h3><div class="chips">${status}</div></div>`);
}

let _adminProducts = [];
function productForm(p) {
  const e = p || { specs: {}, extra: {}, segment: 'agri' };
  const extra = productExtra(e);
  const specsText = Object.entries(e.specs || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const faqText = faqItems(extra).map((item) => `${item.q} :: ${item.a}`).join('\n');
  const icons = ['sprout', 'leaf', 'drop', 'bottle', 'shieldleaf', 'herb', 'health', 'soap'];
  return `<form id="productForm" class="prod-form glass">
    <input type="hidden" name="id" value="${e.id || ''}">
    <input type="hidden" name="existingExtra" value="${esc(JSON.stringify(extra || {}))}">
    <div class="pf-grid">
      <label>ชื่อสินค้า<input name="name" required value="${e.name || ''}"></label>
      <label>กลุ่มแบรนด์<select name="segment"><option value="agri" ${productSegment(e) === 'agri' ? 'selected' : ''}>สินค้าเกษตร</option><option value="lifestyle" ${productSegment(e) === 'lifestyle' ? 'selected' : ''}>สุขภาพ/ความงาม</option></select></label>
      <label>ป้าย (tag)<input name="tag" value="${e.tag || ''}" placeholder="เช่น Best Seller"></label>
      <label>ราคา (บาท)<input name="price" type="number" required value="${e.price || ''}"></label>
      <label>สต็อก<input name="stock" type="number" value="${e.stock ?? 0}"></label>
      <label>ไอคอน (ถ้าไม่อัปโหลดรูป)<select name="icon">${icons.map((i) => `<option value="${i}" ${e.icon === i ? 'selected' : ''}>${i}</option>`).join('')}</select></label>
      <label class="pf-check"><input type="checkbox" name="active" ${e.active === false ? '' : 'checked'}> เปิดขาย</label>
    </div>
    <label>คำโปรย (สั้น)<input name="short" value="${e.short || ''}"></label>
    <label>รายละเอียด<textarea name="desc" rows="3">${e.desc || ''}</textarea></label>
    <label>สเปก (บรรทัดละ "หัวข้อ: ค่า")<textarea name="specs" rows="4" placeholder="กำลังไฟ: 80W">${specsText}</textarea></label>
    <label>รูปสินค้า (อัปโหลดรูปจริงได้)<input name="image" type="file" accept="image/*"></label>
    ${e.image ? `<div class="pf-prev"><img src="${e.image}"></div>` : ''}
    <label>วิดีโอสินค้า (วาง URL .mp4 หรือ /uploads/...)<input name="video" value="${esc(e.video || '')}" placeholder="https://…/clip.mp4"></label>
    <label>รูปเพิ่มเติม — แกลเลอรี (เลือกได้หลายไฟล์)<input name="images" type="file" accept="image/*" multiple></label>
    <input type="hidden" name="existingImages" value="${esc(JSON.stringify(e.images || []))}">
    ${(e.images && e.images.length) ? `<div class="pf-prev">${e.images.map((im) => `<img src="${im}">`).join('')}</div>` : ''}
    <label>โมเดล 3D (URL .glb / .gltf) — หมุนดู 360°<input name="model" value="${esc(e.model || '')}" placeholder="https://…/model.glb"></label>
    <h3 class="set-group">ข้อมูลมาตรฐานสินค้าเกษตร / เอกสาร</h3>
    <div class="pf-grid">
      <label>เลขทะเบียน / อ้างอิง<input name="registrationNo" value="${esc(extra.registrationNo || '')}" placeholder="เช่น รออัปเดตเลขทะเบียน"></label>
      <label>พืชที่เหมาะ (คั่นด้วย comma)<input name="cropTargets" value="${esc(asArray(extra.cropTargets).join(', '))}" placeholder="ทุเรียน, มะม่วง, ข้าว"></label>
      <label>รูปแบบการใช้<input name="applicationMethod" value="${esc(extra.applicationMethod || '')}" placeholder="ฉีดพ่นทางใบ"></label>
      <label>อัตราแนะนำ<input name="dosage" value="${esc(extra.dosage || '')}" placeholder="20-30 ซีซี ต่อน้ำ 20 ลิตร"></label>
    </div>
    <label>คำอธิบายฉลาก / หมายเหตุ<input name="labelNote" value="${esc(extra.labelNote || '')}" placeholder="ควรอ่านฉลากก่อนใช้ทุกครั้ง"></label>
    <label>ไฟล์ฉลาก / PDF / รูป<input name="labelFile" type="file" accept="image/*,.pdf,application/pdf"></label>
    ${extra.labelUrl ? `<div class="pf-file"><a href="${esc(extra.labelUrl)}" target="_blank" rel="noopener">เปิดไฟล์ฉลากปัจจุบัน</a></div>` : ''}
    <label>ขั้นตอนวิธีใช้ (บรรทัดละ 1 ขั้นตอน)<textarea name="usageSteps" rows="4">${esc(asArray(extra.usageSteps).join('\n'))}</textarea></label>
    <label>คำเตือน / ข้อควรระวัง (บรรทัดละ 1 ข้อ)<textarea name="warnings" rows="4">${esc(asArray(extra.warnings).join('\n'))}</textarea></label>
    <label>FAQ (บรรทัดละ "คำถาม :: คำตอบ")<textarea name="faq" rows="4" placeholder="ใช้ร่วมกับสารจับใบได้ไหม? :: ใช้ได้">${esc(faqText)}</textarea></label>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">${e.id ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า'}</button><button class="btn btn-glass" type="button" id="cancelProd">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminProducts() {
  if (!adminGuard()) return loadingView();
  _adminProducts = await (await api('/api/admin/products')).json();
  const rows = _adminProducts.map((p) => `<div class="adm-prod">
    <div class="adm-prod-img">${p.image ? `<img src="${p.image}">` : icon(p.icon || 'pod')}</div>
    <div class="adm-prod-info"><b>${p.name}</b><span class="muted">${SEGMENT_INFO[productSegment(p)]?.label || '-'} · ${p.tag ? p.tag + ' · ' : ''}${baht(p.price)} · สต็อก ${p.stock}${p.active ? '' : ' · <span style="color:#ff7ab3">ปิดขาย</span>'}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" data-editprod="${p.id}">แก้ไข</button><button class="btn-mini danger" data-delprod="${p.id}">ลบ</button></div>
  </div>`).join('');
  return adminLayout('products', `<div class="adm-head"><h2>จัดการสินค้า</h2><button class="btn btn-primary" id="addProdBtn">+ เพิ่มสินค้า</button></div>
    <div id="prodFormWrap"></div>
    <div class="adm-list">${rows}</div>`);
}
let _adminArticles = [];
function articleForm(a) {
  const e = a || {};
  return `<form id="articleForm" class="prod-form glass">
    <input type="hidden" name="id" value="${e.id || ''}">
    <label>หัวข้อบทความ<input name="title" required value="${esc(e.title || '')}"></label>
    <label>เกริ่นนำสั้นๆ (excerpt)<input name="excerpt" value="${esc(e.excerpt || '')}"></label>
    <label>เนื้อหา (เว้นบรรทัด = ย่อหน้าใหม่)<textarea name="body" rows="8">${esc(e.body || '')}</textarea></label>
    <label>รูปปก (อัปโหลด)<input name="cover" type="file" accept="image/*"></label>
    ${e.cover ? `<div class="pf-prev"><img src="${e.cover}"></div>` : ''}
    <label class="pf-check"><input type="checkbox" name="published" ${e.published === false ? '' : 'checked'}> เผยแพร่</label>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">${e.id ? 'บันทึก' : 'เพิ่มบทความ'}</button><button class="btn btn-glass" type="button" id="cancelArticle">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminArticles() {
  if (!adminGuard()) return loadingView();
  _adminArticles = await (await api('/api/admin/articles')).json();
  const rows = _adminArticles.length ? _adminArticles.map((a) => `<div class="adm-prod">
    <div class="adm-prod-info"><b>${esc(a.title)} ${a.published ? '' : '<span style="color:#c99">· ซ่อน</span>'}</b><span class="muted">${new Date(a.createdAt).toLocaleDateString('th-TH')} · ${esc(a.excerpt || '')}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" data-editart="${a.id}">แก้ไข</button><button class="btn-mini danger" data-delart="${a.id}">ลบ</button></div>
  </div>`).join('') : '<p class="muted">ยังไม่มีบทความ</p>';
  return adminLayout('articles', `<div class="adm-head"><h2>บทความ</h2><button class="btn btn-primary" id="addArticleBtn">+ เพิ่มบทความ</button></div>
    <div id="articleFormWrap"></div>
    <div class="adm-list">${rows}</div>`);
}
async function viewAdminLeads() {
  if (!adminGuard()) return loadingView();
  const leads = await (await api('/api/admin/leads')).json();
  const statusLabel = { new: 'ใหม่', contacted: 'ติดต่อแล้ว', qualified: 'มีโอกาสซื้อ', won: 'ปิดการขายได้', lost: 'ยังไม่สำเร็จ' };
  const rows = leads.length ? leads.map((l) => `<div class="lead-card glass">
    <div class="lead-head">
      <div><h3>${esc(l.name)}</h3><p class="muted">${esc(l.phone)}${l.lineId ? ' · LINE ' + esc(l.lineId) : ''}</p></div>
      <span class="status-badge s-${esc(l.status)}">${statusLabel[l.status] || l.status}</span>
    </div>
    <div class="lead-meta">
      <span>พืช: <b>${esc(l.crop || '-')}</b></span>
      <span>จังหวัด: <b>${esc(l.province || '-')}</b></span>
      <span>ช่วง: <b>${esc(l.stage || '-')}</b></span>
      <span>ที่มา: <b>${esc(l.source || 'direct')}</b></span>
      <span>UTM: <b>${esc([l.utmSource, l.utmMedium, l.utmCampaign].filter(Boolean).join(' / ') || '-')}</b></span>
    </div>
    ${l.problem ? `<p class="lead-problem">${esc(l.problem)}</p>` : ''}
    <div class="lead-actions">
      <select data-lstatus="${l.id}">
        <option value="new" ${l.status === 'new' ? 'selected' : ''}>ใหม่</option>
        <option value="contacted" ${l.status === 'contacted' ? 'selected' : ''}>ติดต่อแล้ว</option>
        <option value="qualified" ${l.status === 'qualified' ? 'selected' : ''}>มีโอกาสซื้อ</option>
        <option value="won" ${l.status === 'won' ? 'selected' : ''}>ปิดการขายได้</option>
        <option value="lost" ${l.status === 'lost' ? 'selected' : ''}>ยังไม่สำเร็จ</option>
      </select>
      <input class="track-in" data-lnote="${l.id}" value="${esc(l.note || '')}" placeholder="บันทึกติดตามผล">
      <button class="btn-mini" data-savelead="${l.id}">บันทึก</button>
    </div>
  </div>`).join('') : '<p class="muted">ยังไม่มีลีดจากหน้าเว็บไซต์</p>';
  return adminLayout('leads', `<div class="adm-head"><h2>ลีดลูกค้า</h2><span class="muted">ติดตามลูกค้าที่มาจากเว็บไซต์ แชต และแคมเปญโฆษณา</span></div><div class="adm-list">${rows}</div>`);
}
async function viewAdminOrders() {
  if (!adminGuard()) return loadingView();
  const orders = await (await api('/api/admin/orders')).json();
  const rows = orders.length ? orders.map((o) => `<div class="adm-order glass">
    <div class="ao-top"><a href="${routeHref('/admin/order/' + o.id)}"><b>${o.id}</b> <span class="ao-view">ดูรายละเอียด →</span></a><span class="status-badge s-${o.status}">${o.statusLabel}</span></div>
    <div class="ao-info muted">${o.customer.name} · ${o.customer.phone} · ${baht(o.total)} · ${o.payment_method === 'card' ? 'บัตร' : 'PromptPay'}${o.payment_claimed && !o.paid ? ' · ⚠️แจ้งโอนแล้ว' : ''}</div>
    <div class="ao-items muted">${o.items.map((it) => `${it.name}×${it.qty}`).join(', ')}</div>
    <div class="ao-act">
      <button class="btn-mini" data-oaction="paid" data-oid="${o.id}">ยืนยันจ่าย</button>
      <button class="btn-mini" data-oaction="preparing" data-oid="${o.id}">เตรียม</button>
      <input class="track-in" data-track="${o.id}" placeholder="เลขพัสดุ" value="${o.tracking || ''}">
      <button class="btn-mini" data-oaction="shipped" data-oid="${o.id}">จัดส่ง</button>
      <button class="btn-mini" data-oaction="delivered" data-oid="${o.id}">สำเร็จ</button>
      <button class="btn-mini danger" data-oaction="cancelled" data-oid="${o.id}">ยกเลิก</button>
    </div>
  </div>`).join('') : '<p class="muted">ยังไม่มีออเดอร์</p>';
  return adminLayout('orders', `<h2>ออเดอร์ทั้งหมด</h2><div class="adm-list">${rows}</div>`);
}
async function viewAdminUsers() {
  if (!adminGuard()) return loadingView();
  const users = await (await api('/api/admin/users')).json();
  const rows = users.map((u) => `<div class="adm-user">
    <div class="au-info"><b>${u.email}</b> ${u.role === 'admin' ? '<span class="role-badge">แอดมิน</span>' : ''}<span class="muted">ID ${u.id} · สมัคร ${new Date(u.created_at).toLocaleDateString('th-TH')}</span></div>
    <div class="au-act">
      <input class="track-in" data-uname="${u.id}" value="${u.name || ''}" placeholder="ชื่อ">
      <select class="track-in" data-urole="${u.id}"><option value="user" ${u.role !== 'admin' ? 'selected' : ''}>สมาชิก</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>แอดมิน</option></select>
      <button class="btn-mini" data-saveuser="${u.id}">บันทึก</button>
      <button class="btn-mini danger" data-deluser="${u.id}" ${u.id === currentUser.id ? 'disabled' : ''}>ลบ</button>
    </div>
  </div>`).join('');
  return adminLayout('users', `<h2>ผู้ใช้ทั้งหมด (${users.length})</h2><p class="form-note" style="margin-bottom:16px">เปลี่ยนสิทธิ์เป็น "แอดมิน" เพื่อให้เข้าหลังบ้านได้ · ต้องมีแอดมินอย่างน้อย 1 คนเสมอ</p><div class="adm-list">${rows}</div>`);
}

let _coupons = [];
function couponForm(c) {
  const e = c || { type: 'percent', active: true };
  const exp = e.expiresAt ? new Date(e.expiresAt).toISOString().slice(0, 10) : '';
  return `<form id="couponForm" class="prod-form">
    <input type="hidden" name="orig" value="${e.code || ''}">
    <div class="pf-grid">
      <label>รหัสคูปอง<input name="code" required ${e.code ? 'readonly' : ''} value="${e.code || ''}" placeholder="WELCOME10" style="text-transform:uppercase"></label>
      <label>ประเภท<select name="type"><option value="percent" ${e.type === 'percent' ? 'selected' : ''}>เปอร์เซ็นต์ (%)</option><option value="fixed" ${e.type === 'fixed' ? 'selected' : ''}>จำนวนเงิน (฿)</option></select></label>
      <label>มูลค่า<input name="value" type="number" required value="${e.value || ''}"></label>
      <label>ยอดขั้นต่ำ (บาท)<input name="minTotal" type="number" value="${e.minTotal || 0}"></label>
      <label>จำกัดจำนวนครั้ง (0=ไม่จำกัด)<input name="maxUses" type="number" value="${e.maxUses || 0}"></label>
      <label>วันหมดอายุ (เว้นว่าง=ไม่หมด)<input name="expires" type="date" value="${exp}"></label>
      <label class="pf-check"><input type="checkbox" name="active" ${e.active === false ? '' : 'checked'}> เปิดใช้งาน</label>
    </div>
    <div class="pf-actions"><button class="btn btn-primary" type="submit">${e.code ? 'บันทึก' : 'สร้างคูปอง'}</button><button class="btn btn-glass" type="button" id="cancelCoupon">ยกเลิก</button></div>
  </form>`;
}
async function viewAdminCoupons() {
  if (!adminGuard()) return loadingView();
  _coupons = await (await api('/api/admin/coupons')).json();
  const rows = _coupons.length ? _coupons.map((c) => `<div class="adm-prod">
    <div class="adm-prod-info"><b>${c.code} <span class="role-badge">${c.type === 'percent' ? c.value + '%' : baht(c.value)}</span> ${c.active ? '' : '<span style="color:#c99">· ปิด</span>'}</b>
    <span class="muted">ใช้แล้ว ${c.used}${c.maxUses ? '/' + c.maxUses : ''}${c.minTotal ? ' · ขั้นต่ำ ' + baht(c.minTotal) : ''}${c.expiresAt ? ' · ถึง ' + new Date(c.expiresAt).toLocaleDateString('th-TH') : ''}</span></div>
    <div class="adm-prod-act"><button class="btn-mini" data-editcoupon="${c.code}">แก้ไข</button><button class="btn-mini danger" data-delcoupon="${c.code}">ลบ</button></div>
  </div>`).join('') : '<p class="muted">ยังไม่มีคูปอง</p>';
  return adminLayout('coupons', `<div class="adm-head"><h2>คูปองส่วนลด</h2><button class="btn btn-primary" id="addCouponBtn">+ สร้างคูปอง</button></div><div id="couponFormWrap"></div><div class="adm-list">${rows}</div>`);
}
async function viewAdminSettings() {
  if (!adminGuard()) return loadingView();
  const settings = await (await api('/api/admin/settings')).json();
  const health = await (await api('/api/health')).json();
  const labels = {
    LINE_CHANNEL_ACCESS_TOKEN: 'LINE Channel Access Token', LINE_CHANNEL_SECRET: 'LINE Channel Secret',
    LINE_ADMIN_USER_ID: 'LINE Admin userId', STRIPE_SECRET_KEY: 'Stripe Secret Key',
    STRIPE_WEBHOOK_SECRET: 'Stripe Webhook Secret', PROMPTPAY_ID: 'PromptPay ID (เบอร์/บัตรปชช.)',
    PROMPTPAY_NAME: 'ชื่อร้าน PromptPay', PUBLIC_URL: 'Public URL (สำหรับ Stripe redirect)',
    SMTP_HOST: 'อีเมล: SMTP Host', SMTP_PORT: 'อีเมล: Port (587/465)', SMTP_USER: 'อีเมล: Username',
    SMTP_PASS: 'อีเมล: Password', SMTP_FROM: 'อีเมล: ผู้ส่ง (From)',
  };
  const fields = settings.map((s) => `<label class="set-field">
    <span>${labels[s.key] || s.key} ${s.set ? `<em class="ok">✓ ตั้งค่าแล้ว (${s.source})</em>` : '<em class="no">ยังไม่ตั้ง</em>'}</span>
    <input name="${s.key}" ${s.secret ? 'type="password"' : ''} value="${s.secret ? '' : s.display}" placeholder="${s.secret && s.set ? s.display + ' (เว้นว่างไว้ = คงเดิม)' : 'กรอกค่า…'}">
  </label>`).join('');
  const badge = (ok) => ok ? '<span class="status-badge s-paid">เชื่อมแล้ว</span>' : '<span class="status-badge s-awaiting_payment">ยังไม่เชื่อม</span>';
  return adminLayout('settings', `<h2>ตั้งค่า API / LINE OA</h2>
    <div class="conn-status">LINE OA ${badge(health.lineConfigured)} · Stripe ${badge(health.stripeConfigured)} · PromptPay ${badge(health.promptpayConfigured)} · อีเมล ${badge(health.mailConfigured)}</div>
    <form id="settingsForm" class="set-form glass">${fields}
      <div class="pf-actions"><button class="btn btn-primary" type="submit">บันทึกการตั้งค่า</button><button class="btn btn-glass" type="button" id="testLineBtn">ทดสอบส่ง LINE</button><button class="btn btn-glass" type="button" id="testMailBtn">ทดสอบส่งอีเมล</button></div>
    </form>
    <p class="form-note">ค่า secret จะแสดงแบบปิดบัง เว้นว่างไว้ = ใช้ค่าเดิม · บันทึกแล้วมีผลทันทีไม่ต้องรีสตาร์ท</p>`);
}
function cropStageLines(stages) {
  return asArray(stages).map((stage) => `${stage.title} :: ${stage.detail} :: ${asArray(stage.ids).join(', ')}`).join('\n');
}
const ADMIN_CROP_DRAFT_KEY = 'adminCropLandingDraft_v1';
const REVIEW_TEMPLATES = [
  { key: 'before-after', label: 'ก่อนและหลังใช้', title: (crop) => `ก่อนและหลังใช้สูตร${crop || 'พืช'}`, note: (crop) => `แสดงผลลัพธ์ก่อนและหลังใช้กับ${crop || 'แปลงจริง'}ให้เห็นชัดเจน` },
  { key: 'orchard-result', label: 'ผลลัพธ์ในสวน', title: (crop) => `ผลลัพธ์จากสวน${crop || 'ลูกค้า'}`, note: (crop) => `สรุปสิ่งที่ดีขึ้นหลังใช้สูตรกับ${crop || 'แปลงลูกค้า'}` },
  { key: 'problem-solved', label: 'แก้ปัญหาหน้างาน', title: (crop) => `รีวิวการแก้ปัญหา${crop || 'หน้างาน'}`, note: () => 'เช่น ใบซีด ฟื้นต้น เร่งใบ บำรุงผล หรือช่วยให้ต้นสมบูรณ์ขึ้น' },
  { key: 'sales-th', label: 'ไทยเชิงขาย', title: (crop) => `${crop || 'พืช'}ตอบโจทย์ขึ้นหลังใช้ต่อเนื่อง`, note: () => 'เหมาะใช้เป็น caption สั้นสำหรับหน้าเว็บหรือยิงแอดแบบเน้นผลลัพธ์' },
  { key: 'eng-short', label: 'English Short', title: (crop) => `${crop || 'Crop'} review from customer plot`, note: () => 'Short proof note for bilingual landing pages or ads.' },
];
function currentCropCardSlugs(excludeCard = null) {
  return new Set([...document.querySelectorAll('[data-crop-card]')]
    .filter((card) => card !== excludeCard)
    .map((card) => slugifyCrop((card.querySelector('[data-field="slug"]')?.value || '').trim() || (card.querySelector('[data-field="crop"]')?.value || '').trim()))
    .filter(Boolean));
}
function uniqueCropSlug(base, excludeCard = null) {
  const used = currentCropCardSlugs(excludeCard);
  const root = slugifyCrop(base) || 'crop';
  if (!used.has(root)) return root;
  let i = 2;
  while (used.has(`${root}-${i}`)) i += 1;
  return `${root}-${i}`;
}
function updateSeoImagePreview(card, image = '') {
  const input = card?.querySelector('[data-field="seoImage"]');
  const preview = card?.querySelector('[data-seoimagepreview]');
  const value = String(image || '').trim();
  if (input && input.value !== value) input.value = value;
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}" alt="SEO preview">` : '<span>ยังไม่มีภาพ SEO</span>';
  }
}
function openCropPreviewPane(draft) {
  const normalizedDraft = normalizeCropLandingEntry(draft?.slug || '', draft || {});
  const signature = JSON.stringify(normalizedDraft);
  localStorage.setItem('cropLandingPreviewDraft', signature);
  const frame = document.getElementById('cropPreviewFrame');
  const link = document.getElementById('cropPreviewOpenNew');
  const title = document.getElementById('cropPreviewTitle');
  if (!normalizedDraft.slug) {
    if (frame) frame.removeAttribute('src');
    if (link) link.href = '#';
    if (title) title.textContent = 'ดูตัวอย่างหน้าเฉพาะพืช';
    lastCropPreviewSignature = '';
    return;
  }
  const previewUrl = `/crops/${encodeURIComponent(normalizedDraft.slug)}?preview=1`;
  if (signature === lastCropPreviewSignature) {
    if (link) link.href = previewUrl;
    if (title) title.textContent = normalizedDraft.crop ? `กำลังดูตัวอย่าง: ${normalizedDraft.crop}` : 'ดูตัวอย่างหน้าเฉพาะพืช';
    return;
  }
  lastCropPreviewSignature = signature;
  if (frame) frame.src = `${previewUrl}&t=${Date.now()}`;
  if (link) link.href = previewUrl;
  if (title) title.textContent = normalizedDraft.crop ? `กำลังดูตัวอย่าง: ${normalizedDraft.crop}` : 'ดูตัวอย่างหน้าเฉพาะพืช';
}
let cropPreviewTimer = null;
async function scheduleCropPreview(card, wait = 220) {
  if (!card || currentPath() !== '/admin/site') return;
  clearTimeout(cropPreviewTimer);
  cropPreviewTimer = setTimeout(async () => {
    try {
      const draft = await collectCropLandingCardData(card, { uploadFiles: false });
      openCropPreviewPane(draft);
    } catch {}
  }, wait);
}
function focusCropCard(card, { preview = true } = {}) {
  if (!card) return;
  card.classList.add('is-focused');
  setTimeout(() => card.classList.remove('is-focused'), 1800);
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  card.querySelector('[data-field="crop"]')?.focus();
  if (preview) scheduleCropPreview(card, 60);
}
function setCropPreviewDevice(device = 'desktop') {
  const shell = document.querySelector('.crop-preview-shell');
  if (!shell) return;
  shell.dataset.device = device;
  document.querySelectorAll('[data-previewdevice]').forEach((btn) => btn.classList.toggle('on', btn.dataset.previewdevice === device));
}
let cropDraftTimer = null;
async function scheduleCropDraftSave(wait = 600) {
  if (currentPath() !== '/admin/site') return;
  clearTimeout(cropDraftTimer);
  cropDraftTimer = setTimeout(async () => {
    try {
      const cards = [...document.querySelectorAll('[data-crop-card]')];
      const map = {};
      for (const card of cards) {
        const entry = await collectCropLandingCardData(card, { uploadFiles: false });
        if (!entry.slug || map[entry.slug]) continue;
        map[entry.slug] = entry;
      }
      localStorage.setItem(ADMIN_CROP_DRAFT_KEY, serializeCropLandingMap(map));
      setCropDraftStatus(`บันทึก draft อัตโนมัติแล้ว ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`);
    } catch {
      setCropDraftStatus('ยังไม่สามารถบันทึก draft อัตโนมัติได้');
    }
  }, wait);
}
function toggleCropCard(card, forceExpand = null) {
  const body = card?.querySelector('[data-cropbody]');
  const btn = card?.querySelector('[data-togglecrop]');
  if (!body || !btn) return;
  const collapsed = forceExpand == null ? !body.classList.contains('is-collapsed') : !forceExpand;
  body.classList.toggle('is-collapsed', collapsed);
  btn.textContent = collapsed ? 'ขยายการ์ด' : 'ย่อการ์ด';
}
function applyReviewTemplate(item, key) {
  const tpl = REVIEW_TEMPLATES.find((entry) => entry.key === key);
  if (!tpl || !item) return;
  const card = item.closest('[data-crop-card]');
  const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
  const titleInput = item.querySelector('[data-review-title]');
  const noteInput = item.querySelector('[data-review-note]');
  if (titleInput) titleInput.value = tpl.title(crop);
  if (noteInput) noteInput.value = tpl.note(crop);
}
function scrollToLeadBlock({ focusInput = false } = {}) {
  const el = document.getElementById('leadFormBlock');
  if (!el) {
    if (currentPath() !== '/') {
      go('/');
      setTimeout(() => scrollToLeadBlock({ focusInput }), 420);
    }
    return;
  }
  const navH = document.querySelector('.nav')?.offsetHeight || 88;
  const rect = el.getBoundingClientRect();
  const absoluteTop = rect.top + window.scrollY;
  const viewportH = window.innerHeight;
  const centerOffset = rect.height < viewportH * 0.9 ? Math.max(42, (viewportH - rect.height) * 0.46) : 28;
  const target = Math.max(0, absoluteTop - navH - centerOffset + 10);
  window.scrollTo({ top: target, behavior: 'smooth' });
  el.classList.add('is-focused');
  setTimeout(() => el.classList.remove('is-focused'), 1800);
  if (focusInput) setTimeout(() => el.querySelector('input, select, textarea')?.focus(), 420);
}
function setCropDraftStatus(text = 'ยังไม่มีการบันทึกอัตโนมัติ') {
  const el = document.getElementById('cropDraftStatus');
  if (el) el.textContent = text;
}
function leadSuccessHTML(body = {}) {
  return `<div class="lead-success-state reveal-now">
    <span class="eyebrow">ส่งข้อมูลสำเร็จ</span>
    <h3>ทีมงานได้รับข้อมูลแล้ว</h3>
    <p>ข้อมูลของ${esc(body.name || 'คุณ')}ถูกส่งเข้าระบบเรียบร้อย ทีมงานจะติดต่อกลับโดยเร็วผ่านเบอร์ที่ให้ไว้ หรือคุยต่อใน LINE ตามความเหมาะสม</p>
    <div class="lead-success-pills">
      ${body.crop ? `<span>${esc(body.crop)}</span>` : ''}
      ${body.stage ? `<span>${esc(body.stage)}</span>` : ''}
      ${body.phone ? `<span>${esc(body.phone)}</span>` : ''}
    </div>
    <div class="hero-cta">
      <button class="btn btn-primary" type="button" data-resetleadform>ส่งข้อมูลอีกครั้ง</button>
      ${lineCTA('line-inline')}
    </div>
  </div>`;
}
function cropGalleryEditor(item = {}) {
  const entry = normalizeCropLandingMediaItem(item);
  return `<div class="crop-gallery-item" data-crop-gallery draggable="true">
    <div class="pf-grid">
      <label>หัวข้อภาพ<input data-gallery-title value="${esc(entry.title)}" placeholder="เช่น ภาพสวนจริง / ภาพสินค้าในแปลง"></label>
      <label>คำอธิบายสั้น<input data-gallery-note value="${esc(entry.note)}" placeholder="เช่น ใช้ประกอบจุดขายหรือบรรยากาศในสวน"></label>
    </div>
    <label>ลิงก์รูปภาพ / path รูป<input data-gallery-image-input value="${esc(entry.image)}" placeholder="/uploads/landing-gallery.jpg หรือ https://..."></label>
    <label>รูปภาพ (อัปโหลดใหม่ได้)<input data-gallery-file type="file" accept="image/*"></label>
    <input type="hidden" data-gallery-image value="${esc(entry.image)}">
    <div class="pf-prev ${entry.image ? '' : 'is-empty'}" data-gallery-preview>${entry.image ? `<img src="${esc(entry.image)}">` : '<span>ยังไม่มีรูปภาพหน้า Landing</span>'}</div>
    <div class="pf-actions"><span class="drag-note">ลากการ์ดนี้เพื่อเรียงลำดับภาพ</span><button class="btn btn-glass" type="button" data-removegallery>ลบรูปนี้</button></div>
  </div>`;
}
function cropReviewEditor(review = {}) {
  return `<div class="crop-review-item" data-crop-review draggable="true">
    <div class="pf-grid">
      <label>หัวข้อรีวิว<input data-review-title value="${esc(review.title || '')}" placeholder="เช่น รีวิวสวนลูกค้า จันทบุรี"></label>
      <label>คำอธิบายสั้น<input data-review-note value="${esc(review.note || '')}" placeholder="เช่น หลังใช้สูตรบำรุงผลต่อเนื่อง"></label>
    </div>
    <label>เทมเพลตรีวิว<select data-reviewtemplate>
      <option value="">เลือกเทมเพลตช่วยกรอก</option>
      ${REVIEW_TEMPLATES.map((tpl) => `<option value="${tpl.key}">${tpl.label}</option>`).join('')}
    </select></label>
    <div class="review-template-buttons">${REVIEW_TEMPLATES.map((tpl) => `<button class="btn-mini" type="button" data-reviewtemplatebtn="${tpl.key}">${tpl.label}</button>`).join('')}</div>
    <label>ลิงก์รูปรีวิว / path รูป<input data-review-image-input value="${esc(review.image || '')}" placeholder="/uploads/review.jpg หรือ https://..."></label>
    <label>รูปรีวิว (อัปโหลดใหม่ได้)<input data-review-file type="file" accept="image/*"></label>
    <input type="hidden" data-review-image value="${esc(review.image || '')}">
    <div class="pf-prev ${review.image ? '' : 'is-empty'}" data-review-preview>${review.image ? `<img src="${esc(review.image)}">` : '<span>ยังไม่มีรูปรีวิว</span>'}</div>
    <div class="pf-actions"><span class="drag-note">ลากการ์ดนี้เพื่อเรียงลำดับรีวิว</span><button class="btn btn-glass" type="button" data-removereview>ลบรีวิวนี้</button></div>
  </div>`;
}
function updateHeroImagePreview(card, image = '') {
  const input = card?.querySelector('[data-field="heroImage"]');
  const preview = card?.querySelector('[data-heroimagepreview]');
  const value = String(image || '').trim();
  const ratio = heroRatioValue(card?.querySelector('[data-field="heroRatio"]')?.value || 'wide');
  const focus = heroFocusValue(card?.querySelector('[data-field="heroFocus"]')?.value || 'center');
  if (input && input.value !== value) input.value = value;
  if (preview) {
    preview.dataset.ratio = ratio;
    preview.dataset.focus = focus;
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}" alt="Hero image preview" style="object-position:${esc(heroFocusObjectPosition(focus))}">` : '<span>ยังไม่มีภาพปกหน้า</span>';
  }
}
function updateGalleryPreview(wrap, image = '') {
  const hidden = wrap?.querySelector('[data-gallery-image]');
  const input = wrap?.querySelector('[data-gallery-image-input]');
  const preview = wrap?.querySelector('[data-gallery-preview]');
  const value = String(image || '').trim();
  if (hidden) hidden.value = value;
  if (input && input.value !== value) input.value = value;
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}">` : '<span>ยังไม่มีรูปภาพหน้า Landing</span>';
  }
}
function cropLandingAdminCard(entry = {}, idx = 0) {
  const e = normalizeCropLandingEntry(entry.slug || '', entry);
  const faqText = asArray(e.faq).map((item) => `${item.q} :: ${item.a}`).join('\n');
  const productChecks = PRODUCTS.filter(isAgriProduct).map((p) => `<label class="chip-check"><input type="checkbox" data-related value="${p.id}" ${e.related.includes(p.id) ? 'checked' : ''}> <span>${esc(p.name)}</span></label>`).join('');
  return `<article class="crop-admin-card glass" data-crop-card draggable="true">
    <div class="crop-admin-head">
      <div><b>${esc(e.crop || `หน้าเฉพาะพืช ${idx + 1}`)}</b><span class="muted">slug: /crops/${esc(e.slug || 'new-crop')}</span><span class="crop-admin-state ${e.enabled ? 'is-on' : 'is-off'}">${e.enabled ? 'เปิดหน้า' : 'ปิดหน้า'}</span></div>
      <div class="crop-admin-actions">
        <button class="btn-mini" type="button" data-togglecrop>${idx < 2 ? 'ย่อการ์ด' : 'ขยายการ์ด'}</button>
        <button class="btn-mini" type="button" data-previewcrop>ดูตัวอย่าง</button>
        <button class="btn-mini" type="button" data-duplicatecrop>ทำซ้ำหน้า</button>
        <button class="btn-mini danger" type="button" data-removecrop>ลบหน้านี้</button>
      </div>
    </div>
    <div class="crop-admin-body ${idx < 2 ? '' : 'is-collapsed'}" data-cropbody>
    <div class="pf-grid">
      <label>Slug URL<input data-field="slug" value="${esc(e.slug)}" placeholder="durian"></label>
      <label>ชื่อพืช<input data-field="crop" value="${esc(e.crop)}" placeholder="ทุเรียน"></label>
      <label>ลำดับการแสดงผล<input data-field="sortOrder" type="number" value="${esc(e.sortOrder)}" placeholder="0"></label>
      <label class="lead-wide">หัวข้อใหญ่หน้า Landing<input data-field="hero" value="${esc(e.hero)}" placeholder="สูตรแนะนำสำหรับทุเรียน"></label>
    </div>
    <div class="pf-grid">
      <label class="pf-check"><input data-field="enabled" type="checkbox" ${e.enabled ? 'checked' : ''}> เปิดใช้งานหน้านี้</label>
      <label>SEO Title<input data-field="seoTitle" value="${esc(e.seoTitle)}" placeholder="เช่น สูตรทุเรียน เร่งใบ บำรุงผล | นุชฟอร์ไลฟ์"></label>
      <label>SEO Image<input data-field="seoImage" value="${esc(e.seoImage)}" placeholder="/uploads/seo-durian.jpg หรือ https://..."></label>
    </div>
    <div class="pf-grid">
      <label>อัปโหลดภาพ SEO<input data-seoimagefile type="file" accept="image/*"></label>
      <div class="pf-prev ${e.seoImage ? '' : 'is-empty'}" data-seoimagepreview>${e.seoImage ? `<img src="${esc(e.seoImage)}" alt="SEO image">` : '<span>ยังไม่มีภาพ SEO</span>'}</div>
    </div>
    <label>SEO Description<textarea data-field="seoDescription" rows="2">${esc(e.seoDescription)}</textarea></label>
    <label>คำอธิบายปัญหาหลัก<textarea data-field="problem" rows="3">${esc(e.problem)}</textarea></label>
    <label>คำอธิบายสั้น / จุดประสงค์หน้า (ใช้ใน cards และ tip)<textarea data-field="tip" rows="2">${esc(e.tip)}</textarea></label>
    <label>จุดขายบนหน้า (บรรทัดละ 1 ข้อ)<textarea data-field="offer" rows="3">${esc(asArray(e.offer).join('\n'))}</textarea></label>
    <label>Pain Point / ปัญหาลูกค้า (บรรทัดละ 1 ข้อ)<textarea data-field="painPoints" rows="3">${esc(asArray(e.painPoints).join('\n'))}</textarea></label>
    <div class="crop-review-block">
      <div class="crop-review-head">
        <b>ภาพเด่นบนหน้า Landing</b>
        <span class="drag-note">ใส่ภาพปกและภาพประกอบเพื่อให้หน้าเฉพาะพืชดูเด่นขึ้น</span>
      </div>
      <div class="pf-grid">
        <label class="lead-wide">Hero Image / ภาพปกหน้า<input data-field="heroImage" value="${esc(e.heroImage)}" placeholder="/uploads/hero-durian.jpg หรือ https://..."></label>
        <label>อัปโหลดภาพปกหน้า<input data-heroimagefile type="file" accept="image/*"></label>
        <label>สัดส่วนภาพ<select data-field="heroRatio">
          <option value="wide" ${e.heroRatio === 'wide' ? 'selected' : ''}>Wide 16:9</option>
          <option value="square" ${e.heroRatio === 'square' ? 'selected' : ''}>Square 1:1</option>
          <option value="portrait" ${e.heroRatio === 'portrait' ? 'selected' : ''}>Portrait 4:5</option>
          <option value="story" ${e.heroRatio === 'story' ? 'selected' : ''}>Story 3:4</option>
        </select></label>
        <label>จุดโฟกัสภาพ<select data-field="heroFocus">
          <option value="center" ${e.heroFocus === 'center' ? 'selected' : ''}>กึ่งกลาง</option>
          <option value="top" ${e.heroFocus === 'top' ? 'selected' : ''}>ด้านบน</option>
          <option value="bottom" ${e.heroFocus === 'bottom' ? 'selected' : ''}>ด้านล่าง</option>
          <option value="left" ${e.heroFocus === 'left' ? 'selected' : ''}>ด้านซ้าย</option>
          <option value="right" ${e.heroFocus === 'right' ? 'selected' : ''}>ด้านขวา</option>
        </select></label>
        <div class="pf-prev ${e.heroImage ? '' : 'is-empty'}" data-heroimagepreview data-ratio="${esc(e.heroRatio)}" data-focus="${esc(e.heroFocus)}">${e.heroImage ? `<img src="${esc(e.heroImage)}" alt="Hero image" style="object-position:${esc(heroFocusObjectPosition(e.heroFocus))}">` : '<span>ยังไม่มีภาพปกหน้า</span>'}</div>
      </div>
      <div class="crop-review-head">
        <b>แกลเลอรีภาพประกอบ</b>
        <div class="crop-review-actions">
          <button class="btn btn-glass" type="button" data-addgallery>+ เพิ่มรูปภาพ</button>
          <button class="btn btn-glass" type="button" data-addgallerybatch>อัปโหลดหลายรูป</button>
          <input data-bulkgalleryfiles type="file" accept="image/*" multiple hidden>
        </div>
      </div>
      <div class="crop-gallery-list" data-gallery-list>${asArray(e.gallery).map((item) => cropGalleryEditor(item)).join('')}</div>
    </div>
    <label>ลำดับแนะนำแต่ละช่วง (รูปแบบ: หัวข้อ :: รายละเอียด :: p1,p2)<textarea data-field="stages" rows="5">${esc(cropStageLines(e.stages))}</textarea></label>
    <div class="crop-product-pick">
      <span>สินค้าแนะนำบนหน้า</span>
      <div class="chip-check-grid">${productChecks}</div>
    </div>
    <div class="pf-grid">
      <label>หัวข้อกล่องปิดการขาย<input data-field="proofTitle" value="${esc(e.proofTitle)}" placeholder="เหมาะกับการยิงแอดแบบเฉพาะพืช"></label>
      <label>ข้อความกล่องปิดการขาย<input data-field="proofBody" value="${esc(e.proofBody)}" placeholder="สรุปว่าหน้านี้ช่วยขายอย่างไร"></label>
    </div>
    <label>FAQ (บรรทัดละ "คำถาม :: คำตอบ")<textarea data-field="faq" rows="4">${esc(faqText)}</textarea></label>
    <div class="crop-review-block">
      <div class="crop-review-head">
        <b>รูปรีวิว / รีวิวหน้างาน</b>
        <div class="crop-review-actions">
          <button class="btn btn-glass" type="button" data-addreview>+ เพิ่มรูปรีวิว</button>
          <button class="btn btn-glass" type="button" data-addreviewbatch>อัปโหลดหลายรูป</button>
          <input data-bulkreviewfiles type="file" accept="image/*" multiple hidden>
        </div>
      </div>
      <div class="crop-review-list" data-review-list>${asArray(e.reviews).map((review) => cropReviewEditor(review)).join('')}</div>
    </div>
    </div>
  </article>`;
}
async function viewAdminSite() {
  if (!adminGuard()) return loadingView();
  const s = await (await api('/api/admin/site')).json();
  const cropData = serializeCropLandingMap(cropLandingMap());
  const calcKnowledgeRaw = String(s.SITE_CALC_KNOWLEDGE || JSON.stringify(DEFAULT_CALC_KNOWLEDGE, null, 2));
  const field = (k, l, t = 'text') => `<label class="set-field"><span>${l}</span>${
    t === 'area' ? `<textarea name="${k}" rows="2">${esc(s[k] || '')}</textarea>`
    : t === 'area-lg' ? `<textarea name="${k}" rows="5">${esc(s[k] || '')}</textarea>`
    : t === 'datetime' ? `<input name="${k}" type="datetime-local" value="${esc(s[k] || '')}">`
    : `<input name="${k}" value="${esc(s[k] || '')}">`}</label>`;
  const brand = [['SITE_NAME', 'ชื่อร้าน / แบรนด์'], ['SITE_TAGLINE', 'คำโปรยใต้ชื่อ (อังกฤษ)'], ['SITE_ANNOUNCE', 'แถบประกาศบนสุด'], ['SITE_HERO_TITLE', 'หัวข้อใหญ่ (ส่วนที่ 1)'], ['SITE_HERO_ACCENT', 'หัวข้อใหญ่ (คำเน้นสี)'], ['SITE_HERO_TITLE2', 'หัวข้อใหญ่ (ส่วนที่ 2)'], ['SITE_HERO_SUB', 'ข้อความรอง', 'area'], ['SITE_FOOTER', 'ข้อความท้ายเว็บ', 'area']].map((a) => field(...a)).join('');
  const ship = [['SHIP_HOME', 'ประเทศของร้าน (= จัดส่งในประเทศ)'], ['SHIP_FEE', 'ค่าส่งในประเทศ (บาท)'], ['SHIP_INTL_FEE', 'ค่าส่งต่างประเทศ (บาท)'], ['SHIP_FREE_OVER', 'ส่งฟรีเมื่อยอดเกิน (บาท · 0=ปิด)']].map((a) => field(...a)).join('');
  const saleSel = `<label class="set-field"><span>สถานะ Flash Sale</span><select name="SALE_ACTIVE"><option value="0" ${s.SALE_ACTIVE !== '1' ? 'selected' : ''}>ปิด</option><option value="1" ${s.SALE_ACTIVE === '1' ? 'selected' : ''}>เปิด</option></select></label>`;
  const sale = saleSel + [['SALE_PERCENT', 'ลดกี่ % (ทั้งร้าน)'], ['SALE_TEXT', 'ข้อความแบนเนอร์']].map((a) => field(...a)).join('') + field('SALE_ENDS', 'สิ้นสุดเมื่อ (เว้นว่าง = ไม่จำกัด)', 'datetime');
  const marketing = [['LINE_OA_URL', 'ลิงก์ LINE OA'], ['GA4_ID', 'GA4 Measurement ID'], ['META_PIXEL_ID', 'Meta Pixel ID'], ['TIKTOK_PIXEL_ID', 'TikTok Pixel ID']].map((a) => field(...a)).join('');
  const conversion = [
    ['SITE_TRUST_ITEMS', 'จุดแข็ง / Trust Point (บรรทัดละ 1 ข้อ)', 'area-lg'],
    ['SITE_CASE_STUDIES', 'Use Case / หลักฐานการใช้งาน (รูปแบบ: หัวข้อ :: รายละเอียด)', 'area-lg'],
    ['SITE_CHECKOUT_POINTS', 'ข้อความสร้างความมั่นใจก่อนชำระเงิน (บรรทัดละ 1 ข้อ)', 'area-lg'],
  ].map((a) => field(...a)).join('');
  const draftRaw = localStorage.getItem(ADMIN_CROP_DRAFT_KEY) || '';
  const cropMap = cropLandingMapFromRaw(draftRaw || s.SITE_CROP_LANDING_DATA || cropData);
  const cropCards = sortCropLandingEntries(Object.values(cropMap)).map((entry, idx) => cropLandingAdminCard(entry, idx)).join('');
  return adminLayout('site', `<h2>ข้อมูลร้าน / เว็บไซต์</h2>
    <form id="settingsForm" class="set-form glass">
      <h3 class="set-group">แบรนด์ & ข้อความ</h3>${brand}
      <h3 class="set-group">การจัดส่ง</h3>${ship}
      <h3 class="set-group">Flash Sale ⚡</h3>${sale}
      <h3 class="set-group">Marketing & Pixel</h3>${marketing}
      <h3 class="set-group">Trust / Conversion Content</h3>${conversion}
      <h3 class="set-group">ฐานความรู้เครื่องคำนวณ</h3>
      <textarea name="SITE_CALC_KNOWLEDGE" id="calcKnowledgeJson" hidden>${esc(calcKnowledgeRaw)}</textarea>
      ${calcKnowledgeEditorHTML(calcKnowledgeRaw)}
      <p class="form-note">บันทึกครั้งเดียวแล้วหน้าเครื่องคำนวณจะอัปเดตทั้งสูตรตามระยะพืช คำอธิบายสินค้า และค่าพื้นฐานน้ำต่อไร่ทันที</p>
      <h3 class="set-group">หน้าเฉพาะพืช / Landing Page</h3>
      <textarea name="SITE_CROP_LANDING_DATA" id="siteCropLandingData" hidden>${esc(s.SITE_CROP_LANDING_DATA || cropData)}</textarea>
      <div class="crop-admin-wrap">
        <p class="form-note">เพิ่ม แก้ไข ลบ ทำซ้ำ เปิด/ปิดหน้า ตั้งค่า SEO พร้อมจัดการภาพปก แกลเลอรี และรูปรีวิวของหน้าเฉพาะพืชได้จากส่วนนี้ โดยดูตัวอย่างก่อนบันทึกได้ทันที</p>
        <p class="form-note" id="cropDraftStatus">${draftRaw ? 'กู้ draft ล่าสุดกลับมาแล้ว' : 'ยังไม่มีการบันทึกอัตโนมัติ'}</p>
        ${draftRaw ? `<div class="crop-draft-banner glass"><div><b>กู้ draft ล่าสุดกลับมาแล้ว</b><span>กำลังแสดงข้อมูลจาก draft ในเครื่องของคุณจนกว่าจะกดบันทึกขึ้นระบบหรือเลือกล้าง draft</span></div><div class="crop-draft-actions"><button class="btn-mini" type="button" data-cleardraft>ล้าง draft</button></div></div>` : ''}
        <div class="crop-preview-pane glass">
          <div class="crop-preview-head">
            <b id="cropPreviewTitle">ดูตัวอย่างหน้าเฉพาะพืช</b>
            <div class="crop-preview-actions">
              <button class="btn-mini on" type="button" data-previewdevice="desktop">Desktop</button>
              <button class="btn-mini" type="button" data-previewdevice="tablet">Tablet</button>
              <button class="btn-mini" type="button" data-previewdevice="mobile">Mobile</button>
              <a class="btn-mini" id="cropPreviewOpenNew" href="#" target="_blank" rel="noopener">เปิดแท็บใหม่</a>
            </div>
          </div>
          <div class="crop-preview-shell" data-device="desktop">
            <iframe id="cropPreviewFrame" class="crop-preview-frame" title="Crop landing preview"></iframe>
          </div>
        </div>
        <div class="crop-admin-toolbar">
          <button class="btn btn-glass" type="button" data-expandall>ขยายทั้งหมด</button>
          <button class="btn btn-glass" type="button" data-collapseall>ย่อทั้งหมด</button>
        </div>
        <div id="cropLandingAdminList" class="crop-admin-list">${cropCards}</div>
        <button class="btn btn-glass" type="button" id="addCropLandingBtn">+ เพิ่มหน้าเฉพาะพืช</button>
      </div>
      <div class="pf-actions"><button class="btn btn-primary" type="submit">บันทึกทั้งหมด</button></div>
    </form>
    <p class="form-note" style="margin-top:12px">บันทึกแล้วมีผลทันทีทุกหน้า · Flash Sale จะลดราคาทุกสินค้า + ขึ้นแบนเนอร์นับถอยหลัง</p>`);
}
async function viewAdminOrderDetail({ id }) {
  if (!adminGuard()) return loadingView();
  const o = await (await api('/api/admin/orders/' + encodeURIComponent(id))).json();
  if (!o || o.error) return adminLayout('orders', `<a class="back" href="${routeHref('/admin/orders')}">← กลับ</a><p class="muted">ไม่พบคำสั่งซื้อ</p>`);
  const items = o.items.map((it) => `<div class="sum-row"><span>${it.name} <em>×${it.qty}</em></span><b>${baht(it.price * it.qty)}</b></div>`).join('');
  const acct = o.account ? `${o.account.name || '-'} (${o.account.email})` : 'ลูกค้าทั่วไป (ไม่ได้ล็อกอิน)';
  const trackVal = o.tracking || '';
  return adminLayout('orders', `
    <a class="back" href="${routeHref('/admin/orders')}">← กลับไปรายการออเดอร์</a>
    <div class="adm-head"><h2>ออเดอร์ ${o.id}</h2><span class="status-badge s-${o.status}">${o.statusLabel}</span></div>
    <div class="od-grid">
      <div class="dash-card">
        <h3>รายการสินค้า</h3>${items}
        <div class="sum-row" style="margin-top:8px"><span>ยอดสินค้า</span><b>${baht(o.subtotal || o.total)}</b></div>
        ${o.discount ? `<div class="sum-row"><span>ส่วนลด${o.coupon ? ' (' + o.coupon + ')' : ''}</span><b>-${baht(o.discount)}</b></div>` : ''}
        <div class="sum-total"><span>รวมสุทธิ</span><b>${baht(o.total)}</b></div>
      </div>
      <div class="dash-card">
        <h3>ข้อมูลลูกค้า</h3>
        <div class="od-row"><span>ผู้รับ</span><b>${esc(o.customer.name)}</b></div>
        <div class="od-row"><span>โทร</span><b>${esc(o.customer.phone)}</b></div>
        <div class="od-row"><span>ที่อยู่</span><b>${esc(o.customer.address)}</b></div>
        ${o.customer.note ? `<div class="od-row"><span>หมายเหตุ</span><b>${esc(o.customer.note)}</b></div>` : ''}
        <div class="od-row"><span>บัญชี</span><b>${esc(acct)}</b></div>
        <div class="od-row"><span>ชำระเงิน</span><b>${o.payment_method === 'card' ? 'บัตรเครดิต' : 'PromptPay'} ${o.paid ? '✅ จ่ายแล้ว' : (o.payment_claimed ? '⏳ แจ้งโอนแล้ว' : '· รอชำระ')}</b></div>
        <div class="od-row"><span>สั่งเมื่อ</span><b>${new Date(o.createdAt).toLocaleString('th-TH')}</b></div>
      </div>
    </div>
    <div class="dash-card">
      <h3>จัดการสถานะ</h3>
      <div class="ao-act">
        <button class="btn-mini" data-oaction="paid" data-oid="${o.id}">ยืนยันจ่าย</button>
        <button class="btn-mini" data-oaction="preparing" data-oid="${o.id}">เตรียมสินค้า</button>
        <input class="track-in" data-track="${o.id}" placeholder="เลขพัสดุ" value="${esc(trackVal)}">
        <button class="btn-mini" data-oaction="shipped" data-oid="${o.id}">จัดส่งแล้ว</button>
        <button class="btn-mini" data-oaction="delivered" data-oid="${o.id}">สำเร็จ</button>
        <button class="btn-mini danger" data-oaction="cancelled" data-oid="${o.id}">ยกเลิก</button>
      </div>
    </div>`);
}

// ════════════════════════ Router ════════════════════════
const routes = [
  { re: /^\/?$/, view: viewHome },
  { re: /^\/crops\/([^/]+)\/?$/, view: viewCropLanding, keys: ['slug'] },
  { re: /^\/products\/?$/, view: viewProducts },
  { re: /^\/wishlist\/?$/, view: viewWishlist },
  { re: /^\/articles\/?$/, view: viewArticles },
  { re: /^\/article\/([^/]+)$/, view: viewArticle, keys: ['id'] },
  { re: /^\/calc\/?$/, view: viewCalc },
  { re: /^\/product\/([^/]+)$/, view: viewProductDetail, keys: ['id'] },
  { re: /^\/about\/?$/, view: viewAbout },
  { re: /^\/checkout\/?$/, view: viewCheckout },
  { re: /^\/track\/?$/, view: viewTrack },
  { re: /^\/order\/([^/]+)$/, view: viewOrder, keys: ['id'] },
  { re: /^\/login\/?$/, view: viewLogin },
  { re: /^\/register\/?$/, view: viewRegister },
  { re: /^\/account\/?$/, view: viewAccount },
  { re: /^\/admin\/?$/, view: viewAdminDash },
  { re: /^\/admin\/products\/?$/, view: viewAdminProducts },
  { re: /^\/admin\/articles\/?$/, view: viewAdminArticles },
  { re: /^\/admin\/leads\/?$/, view: viewAdminLeads },
  { re: /^\/admin\/orders\/?$/, view: viewAdminOrders },
  { re: /^\/admin\/order\/([^/]+)$/, view: viewAdminOrderDetail, keys: ['id'] },
  { re: /^\/admin\/coupons\/?$/, view: viewAdminCoupons },
  { re: /^\/admin\/users\/?$/, view: viewAdminUsers },
  { re: /^\/admin\/site\/?$/, view: viewAdminSite },
  { re: /^\/admin\/settings\/?$/, view: viewAdminSettings },
];

const app = document.getElementById('app');

function currentPath() {
  const hashPath = location.hash.replace(/^#/, '');
  if (hashPath) return hashPath;
  const clean = location.pathname.replace(/\/+$/, '') || '/';
  return clean === '/index.html' ? '/' : clean;
}

// polling สถานะออเดอร์
let orderPollTimer = null;
function clearOrderPoll() { if (orderPollTimer) { clearInterval(orderPollTimer); orderPollTimer = null; } }
function startOrderPoll(id, initial) {
  clearOrderPoll();
  let prev = JSON.stringify({ s: initial.status, p: initial.paid, c: initial.payment_claimed, t: initial.tracking });
  orderPollTimer = setInterval(async () => {
    if (currentPath() !== '/order/' + id) { clearOrderPoll(); return; }
    const o = await fetchOrder(id);
    if (!o) return;
    const j = JSON.stringify({ s: o.status, p: o.paid, c: o.payment_claimed, t: o.tracking });
    if (j !== prev) { prev = j; app.innerHTML = renderOrderHTML(o); enhance(); }
  }, 5000);
}

async function render() {
  clearOrderPoll();
  const path = currentPath();
  let match = { view: viewNotFound, params: {} };
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      (r.keys || []).forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      match = { view: r.view, params };
      break;
    }
  }
  app.classList.remove('view-in');
  const html = await match.view(match.params);
  app.innerHTML = html;
  window.scrollTo({ top: 0 });
  setActiveNav(path);
  closeMobileNav();
  syncMobileNav();
  enhance();
  if (path === '/admin/site') {
    setCropPreviewDevice(document.querySelector('.crop-preview-shell')?.dataset.device || 'desktop');
    if (localStorage.getItem(ADMIN_CROP_DRAFT_KEY) && !sessionStorage.getItem('adminCropDraftToastShown')) {
      sessionStorage.setItem('adminCropDraftToastShown', '1');
      setTimeout(() => toast('กู้ draft ล่าสุดกลับมาแล้ว', 'ok'), 60);
    }
    setTimeout(() => {
      const firstCard = document.querySelector('[data-crop-card]');
      if (firstCard) scheduleCropPreview(firstCard, 30);
    }, 40);
  }
  trackPageView(path, document.title);
  if (path === '/checkout' && !markTracked('checkout:' + cartCount() + ':' + cartTotal())) trackEvent('begin_checkout', { value: cartTotal(), currency: 'THB', items: [...cart.entries()].length });
  requestAnimationFrame(() => app.classList.add('view-in'));
}

function setActiveNav(path) {
  document.querySelectorAll('#navLinks a').forEach((a) => {
    const href = routePathFromHref(a.getAttribute('href'));
    const on = href === '/' ? path === '/' : path.startsWith(href);
    a.classList.toggle('active', on);
  });
}

window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
window.addEventListener('resize', syncMobileNav);
window.addEventListener('storage', async (e) => {
  if (e.key !== SITE_SYNC_KEY) return;
  await loadSite();
  applySite();
  renderSaleBanner();
  render();
});
siteSyncChannel?.addEventListener('message', async (e) => {
  if (e.data?.type !== 'site-updated') return;
  await loadSite();
  applySite();
  renderSaleBanner();
  render();
});

// ════════════════════════ Delegated interactions ════════════════════════
document.body.addEventListener('click', (e) => {
  const burger = e.target.closest('#navBurger');
  if (burger) {
    e.preventDefault();
    toggleMobileNav();
    return;
  }
  if (e.target.id === 'navDim') {
    closeMobileNav();
    return;
  }
  const navLink = e.target.closest('#navPanel a');
  if (navLink && isMobileNav()) closeMobileNav();

  const segBtn = e.target.closest('[data-seg]');
  if (segBtn) {
    _pf.segment = segBtn.dataset.seg || 'all';
    if (_pf.segment !== 'agri') _pf.crop = null;
    render();
    return;
  }
  const cropBtn = e.target.closest('[data-crop]');
  if (cropBtn) {
    _pf.crop = cropBtn.dataset.crop || null;
    if (_pf.crop) _pf.segment = 'agri';
    render();
    return;
  }
  const t = e.target.closest('[data-add],[data-inc],[data-dec],[data-qi],[data-qd],[data-addqty],[data-buynow],[data-notifypay]');
  if (!t) return;
  const d = t.dataset;

  if (d.add !== undefined) {                       // เพิ่มจากการ์ดสินค้า
    e.preventDefault();
    addToCart(d.add, 1); openCart();
    t.textContent = 'เพิ่มแล้ว ✓'; t.classList.add('added');
    setTimeout(() => { t.textContent = 'เพิ่ม +'; t.classList.remove('added'); }, 1000);
  }
  if (d.inc) { addToCart(d.inc, 1); }
  if (d.dec) { const q = (Number(cart.get(d.dec)) || 0) - 1; if (q <= 0) cart.delete(d.dec); else cart.set(d.dec, q); saveCart(); renderCart(); }

  // หน้า detail: ปุ่มจำนวน
  if (d.qi !== undefined || d.qd !== undefined) {
    const el = document.getElementById('detailQty');
    let n = parseInt(el.textContent, 10) || 1;
    n = d.qi !== undefined ? Math.min(99, n + 1) : Math.max(1, n - 1);
    el.textContent = n;
  }
  if (d.addqty) {
    const n = parseInt(document.getElementById('detailQty')?.textContent, 10) || 1;
    addToCart(d.addqty, n); openCart();
  }
  if (d.buynow) {
    const n = parseInt(document.getElementById('detailQty')?.textContent, 10) || 1;
    addToCart(d.buynow, n); go('/checkout');
  }
  if (d.notifypay) {
    t.disabled = true; t.textContent = 'กำลังแจ้ง…';
    (async () => {
      try {
        await fetch('/api/orders/' + d.notifypay + '/notify-payment', { method: 'POST' });
        const o = await fetchOrder(d.notifypay);
        if (o) { app.innerHTML = renderOrderHTML(o); enhance(); startOrderPoll(d.notifypay, o); }
      } catch { t.disabled = false; t.textContent = 'แจ้งว่าชำระเงินแล้ว'; }
    })();
  }
});

// confirm page chat button (delegated)
document.body.addEventListener('click', (e) => {
  if (e.target.id === 'confirmChat' || e.target.closest('[data-openchat]')) openChat();
  if (e.target.closest('[data-linecta]')) trackEvent('line_click', { placement: 'cta' });
});

// checkout submit (delegated)
document.body.addEventListener('submit', async (e) => {
  // ติดตามออเดอร์
  if (e.target.id === 'trackForm') {
    e.preventDefault();
    const oid = (new FormData(e.target).get('oid') || '').trim().toUpperCase();
    if (oid) go('/order/' + oid);
    return;
  }
  if (e.target.id !== 'checkoutForm') return;
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const payment = fd.get('payment') || 'promptpay';
  const customer = {
    name: (fd.get('name') || '').trim(),
    phone: (fd.get('phone') || '').trim(),
    address: (fd.get('address') || '').trim(),
    email: (fd.get('email') || '').trim(),
    country: (fd.get('country') || '').trim(),
    note: (fd.get('note') || '').trim(),
  };
  const items = [...cart.entries()].map(([id, qty]) => ({ id, qty: Number(qty) }));
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'กำลังดำเนินการ…';
  try {
    const r = await fetch('/api/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, customer, payment, sessionId: currentSessionId, coupon: appliedCoupon?.code || '' }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
    clientOrders.set(data.order.id, data.order);
    appliedCoupon = null;
    cart.clear(); saveCart(); renderCart();
    if (data.checkoutUrl) { window.location.href = data.checkoutUrl; return; } // ไป Stripe
    go('/order/' + data.order.id);                                              // PromptPay
  } catch (err) {
    toast(err.message, 'err');
    btn.disabled = false; btn.textContent = 'ดำเนินการชำระเงิน';
  }
});

// ───────── auth + admin form submits ─────────
document.body.addEventListener('submit', async (e) => {
  const form = e.target;
  // login / register
  if (form.id === 'loginForm' || form.id === 'registerForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const isReg = form.id === 'registerForm';
    const body = { email: fd.get('email'), password: fd.get('password') };
    const adminKey = String(fd.get('adminKey') || '').trim();
    if (isReg) body.name = fd.get('name');
    if (!isReg && adminKey) body.adminKey = adminKey;
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      setAuth(d.token, d.user, isReg ? '' : adminKey);
      toast(isReg ? 'สมัครสมาชิกสำเร็จ' : 'เข้าสู่ระบบสำเร็จ', 'ok');
      go(d.user.role === 'admin' ? '/admin' : '/account');
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // product create/edit
  if (form.id === 'productForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const specs = {};
    (fd.get('specs') || '').split('\n').forEach((line) => { const i = line.indexOf(':'); if (i > 0) specs[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
    const prevExtra = JSON.parse(fd.get('existingExtra') || '{}');
    const body = { name: fd.get('name'), segment: fd.get('segment') || 'agri', tag: fd.get('tag'), price: fd.get('price'), stock: fd.get('stock'), icon: fd.get('icon'), short: fd.get('short'), desc: fd.get('desc'), video: fd.get('video') || '', model: fd.get('model') || '', active: fd.get('active') === 'on', specs };
    body.extra = {
      ...prevExtra,
      registrationNo: (fd.get('registrationNo') || '').trim(),
      cropTargets: splitCsv(fd.get('cropTargets')),
      applicationMethod: (fd.get('applicationMethod') || '').trim(),
      dosage: (fd.get('dosage') || '').trim(),
      labelNote: (fd.get('labelNote') || '').trim(),
      labelUrl: prevExtra.labelUrl || '',
      usageSteps: splitLines(fd.get('usageSteps')),
      warnings: splitLines(fd.get('warnings')),
      faq: splitLines(fd.get('faq')).map((line) => {
        const idx = line.indexOf('::');
        return idx > -1 ? { q: line.slice(0, idx).trim(), a: line.slice(idx + 2).trim() } : null;
      }).filter(Boolean),
    };
    const id = fd.get('id');
    const file = form.querySelector('input[name=image]').files[0];
    const imgFiles = [...form.querySelector('input[name=images]').files];
    const labelFile = form.querySelector('input[name=labelFile]').files[0];
    const existingImages = JSON.parse(form.querySelector('[name=existingImages]')?.value || '[]');
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (file) body.image = await fileToDataUrl(file);
      if (imgFiles.length) body.images = [...existingImages, ...(await Promise.all(imgFiles.map(fileToDataUrl)))];
      if (labelFile) body.extra.labelUrl = await fileToDataUrl(labelFile);
      const r = await api(id ? '/api/admin/products/' + id : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      toast('บันทึกสินค้าแล้ว', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // article create/edit
  if (form.id === 'articleForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const body = { title: fd.get('title'), excerpt: fd.get('excerpt'), body: fd.get('body'), published: fd.get('published') === 'on' };
    const id = fd.get('id');
    const file = form.querySelector('input[name=cover]').files[0];
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (file) body.cover = await fileToDataUrl(file);
      const r = await api(id ? '/api/admin/articles/' + id : '/api/admin/articles', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
      toast('บันทึกบทความแล้ว', 'ok');
      render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // coupon create/edit
  if (form.id === 'couponForm') {
    e.preventDefault();
    const fd = new FormData(form);
    const orig = fd.get('orig');
    const body = { code: (fd.get('code') || '').toUpperCase(), type: fd.get('type'), value: fd.get('value'), minTotal: fd.get('minTotal'), maxUses: fd.get('maxUses'), active: fd.get('active') === 'on', expiresAt: fd.get('expires') ? new Date(fd.get('expires')).getTime() : 0 };
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const r = await api(orig ? '/api/admin/coupons/' + orig : '/api/admin/coupons', { method: orig ? 'PUT' : 'POST', body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error || 'ผิดพลาด');
      toast('บันทึกคูปองแล้ว', 'ok'); render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    return;
  }
  // settings
  if (form.id === 'settingsForm') {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await syncCropLandingSettings(form);
      const fd = new FormData(form);
      const settings = {};
      for (const [k, v] of fd.entries()) if (v !== '') settings[k] = v;
      const r = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
      if (!r.ok) throw new Error((await r.json()).error || 'ผิดพลาด');
      toast('บันทึกแล้ว', 'ok');
      localStorage.removeItem('cropLandingPreviewDraft');
      localStorage.removeItem(ADMIN_CROP_DRAFT_KEY);
      setCropDraftStatus('บันทึกขึ้นระบบแล้ว');
      localStorage.setItem(SITE_SYNC_KEY, String(Date.now()));
      siteSyncChannel?.postMessage({ type: 'site-updated', at: Date.now() });
      await loadSite(); applySite(); renderSaleBanner();
      if (currentPath() !== '/admin/site') render();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    btn.disabled = false;
    return;
  }
});

function fileToDataUrl(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}
function updateReviewPreview(wrap, image = '') {
  const hidden = wrap?.querySelector('[data-review-image]');
  const input = wrap?.querySelector('[data-review-image-input]');
  const preview = wrap?.querySelector('[data-review-preview]');
  const value = String(image || '').trim();
  if (hidden) hidden.value = value;
  if (input && input.value !== value) input.value = value;
  if (preview) {
    preview.classList.toggle('is-empty', !value);
    preview.innerHTML = value ? `<img src="${esc(value)}">` : '<span>ยังไม่มีรูปรีวิว</span>';
  }
}
function updateCropAdminCardSummary(card) {
  const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
  const rawSlug = (card?.querySelector('[data-field="slug"]')?.value || '').trim();
  const enabled = card?.querySelector('[data-field="enabled"]')?.checked !== false;
  const title = card?.querySelector('.crop-admin-head b');
  const slugEl = card?.querySelector('.crop-admin-head .muted');
  const state = card?.querySelector('.crop-admin-state');
  if (title) title.textContent = crop || 'หน้าเฉพาะพืชใหม่';
  if (slugEl) slugEl.textContent = `slug: /crops/${rawSlug || 'new-crop'}`;
  if (state) {
    state.textContent = enabled ? 'เปิดหน้า' : 'ปิดหน้า';
    state.classList.toggle('is-on', enabled);
    state.classList.toggle('is-off', !enabled);
  }
}
function slugifyCrop(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function uploadAdminAsset(file) {
  const dataUrl = await fileToDataUrl(file);
  const r = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ dataUrl }) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'อัปโหลดไฟล์ไม่สำเร็จ');
  return d.url || '';
}
async function collectCropLandingCardData(card, { uploadFiles = false } = {}) {
  const crop = (card.querySelector('[data-field="crop"]')?.value || '').trim();
  const rawSlug = (card.querySelector('[data-field="slug"]')?.value || '').trim();
  const slug = slugifyCrop(rawSlug || crop);
  if (!slug) throw new Error('กรุณากรอก slug หรือชื่อพืชก่อนดำเนินการ');
  if (!crop) throw new Error(`กรุณากรอกชื่อพืชในรายการ ${slug}`);
  const faq = splitLines(card.querySelector('[data-field="faq"]')?.value || '').map((line) => {
    const idx = line.indexOf('::');
    return idx > -1 ? { q: line.slice(0, idx).trim(), a: line.slice(idx + 2).trim() } : null;
  }).filter(Boolean);
  const stages = splitLines(card.querySelector('[data-field="stages"]')?.value || '').map((line) => {
    const parts = line.split('::').map((part) => part.trim());
    if (parts.length < 2) return null;
    return { title: parts[0], detail: parts[1], ids: splitCsv(parts.slice(2).join('::')) };
  }).filter(Boolean);
  const reviews = [];
  for (const item of card.querySelectorAll('[data-crop-review]')) {
    let image = (item.querySelector('[data-review-image]')?.value || '').trim();
    const file = item.querySelector('[data-review-file]')?.files?.[0];
    if (uploadFiles && file) {
      image = await uploadAdminAsset(file);
      updateReviewPreview(item, image);
      const fileInput = item.querySelector('[data-review-file]');
      if (fileInput) fileInput.value = '';
    }
    const title = (item.querySelector('[data-review-title]')?.value || '').trim();
    const note = (item.querySelector('[data-review-note]')?.value || '').trim();
    if (image || title || note) reviews.push({ image, title, note });
  }
  const gallery = [];
  for (const item of card.querySelectorAll('[data-crop-gallery]')) {
    let image = (item.querySelector('[data-gallery-image]')?.value || '').trim();
    const file = item.querySelector('[data-gallery-file]')?.files?.[0];
    if (uploadFiles && file) {
      image = await uploadAdminAsset(file);
      updateGalleryPreview(item, image);
      const fileInput = item.querySelector('[data-gallery-file]');
      if (fileInput) fileInput.value = '';
    }
    const title = (item.querySelector('[data-gallery-title]')?.value || '').trim();
    const note = (item.querySelector('[data-gallery-note]')?.value || '').trim();
    if (image || title || note) gallery.push({ image, title, note });
  }
  let seoImage = (card.querySelector('[data-field="seoImage"]')?.value || '').trim();
  const seoImageFile = card.querySelector('[data-seoimagefile]')?.files?.[0];
  if (uploadFiles && seoImageFile) {
    seoImage = await uploadAdminAsset(seoImageFile);
    updateSeoImagePreview(card, seoImage);
    const seoFileInput = card.querySelector('[data-seoimagefile]');
    if (seoFileInput) seoFileInput.value = '';
  }
  let heroImage = (card.querySelector('[data-field="heroImage"]')?.value || '').trim();
  const heroImageFile = card.querySelector('[data-heroimagefile]')?.files?.[0];
  if (uploadFiles && heroImageFile) {
    heroImage = await uploadAdminAsset(heroImageFile);
    updateHeroImagePreview(card, heroImage);
    const heroFileInput = card.querySelector('[data-heroimagefile]');
    if (heroFileInput) heroFileInput.value = '';
  }
  return normalizeCropLandingEntry(slug, {
    slug,
    crop,
    enabled: card.querySelector('[data-field="enabled"]')?.checked !== false,
    sortOrder: parseInt(card.querySelector('[data-field="sortOrder"]')?.value || '0', 10) || 0,
    seoTitle: (card.querySelector('[data-field="seoTitle"]')?.value || '').trim(),
    seoDescription: (card.querySelector('[data-field="seoDescription"]')?.value || '').trim(),
    seoImage,
    hero: (card.querySelector('[data-field="hero"]')?.value || '').trim(),
    heroImage,
    heroRatio: heroRatioValue(card.querySelector('[data-field="heroRatio"]')?.value || 'wide'),
    heroFocus: heroFocusValue(card.querySelector('[data-field="heroFocus"]')?.value || 'center'),
    problem: (card.querySelector('[data-field="problem"]')?.value || '').trim(),
    tip: (card.querySelector('[data-field="tip"]')?.value || '').trim(),
    offer: splitLines(card.querySelector('[data-field="offer"]')?.value || ''),
    painPoints: splitLines(card.querySelector('[data-field="painPoints"]')?.value || ''),
    gallery,
    stages,
    proofTitle: (card.querySelector('[data-field="proofTitle"]')?.value || '').trim(),
    proofBody: (card.querySelector('[data-field="proofBody"]')?.value || '').trim(),
    faq,
    related: [...card.querySelectorAll('[data-related]:checked')].map((el) => el.value),
    reviews,
  });
}
async function syncCropLandingSettings(form) {
  const hidden = form.querySelector('#siteCropLandingData');
  if (!hidden) return;
  const cards = [...form.querySelectorAll('[data-crop-card]')];
  const map = {};
  for (let i = 0; i < cards.length; i++) {
    const entry = await collectCropLandingCardData(cards[i], { uploadFiles: true });
    if (map[entry.slug]) throw new Error(`slug ซ้ำกัน: ${entry.slug}`);
    map[entry.slug] = entry;
  }
  hidden.value = serializeCropLandingMap(map);
}

// ───────── admin/account click actions ─────────
document.body.addEventListener('click', async (e) => {
  const id = e.target.id;
  if (id === 'logoutBtn') { try { await api('/api/auth/logout', { method: 'POST' }); } catch {} setAuth('', null, ''); toast('ออกจากระบบแล้ว', 'ok'); go('/'); return; }
  if (e.target.closest('[data-resetleadform]')) { render(); return; }
  if (id === 'addProdBtn') { const w = document.getElementById('prodFormWrap'); w.innerHTML = w.innerHTML ? '' : productForm(null); return; }
  if (id === 'cancelProd') { document.getElementById('prodFormWrap').innerHTML = ''; return; }
  if (id === 'addArticleBtn') { const w = document.getElementById('articleFormWrap'); w.innerHTML = w.innerHTML ? '' : articleForm(null); return; }
  if (id === 'cancelArticle') { document.getElementById('articleFormWrap').innerHTML = ''; return; }
  if (id === 'addCropLandingBtn') {
    e.preventDefault();
    e.stopPropagation();
    const list = document.getElementById('cropLandingAdminList');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropLandingAdminCard({}, list.children.length));
    updateCropAdminCardSummary(list.lastElementChild);
    focusCropCard(list.lastElementChild);
    scheduleCropDraftSave(120);
    return;
  }
  const clearDraft = e.target.closest('[data-cleardraft]');
  if (clearDraft) {
    e.preventDefault();
    e.stopPropagation();
    localStorage.removeItem(ADMIN_CROP_DRAFT_KEY);
    sessionStorage.removeItem('adminCropDraftToastShown');
    setCropDraftStatus('ล้าง draft แล้ว');
    render();
    return;
  }
  const expandAll = e.target.closest('[data-expandall]');
  if (expandAll) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('[data-crop-card]').forEach((card) => toggleCropCard(card, true));
    return;
  }
  const collapseAll = e.target.closest('[data-collapseall]');
  if (collapseAll) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('[data-crop-card]').forEach((card) => toggleCropCard(card, false));
    return;
  }
  const toggleCrop = e.target.closest('[data-togglecrop]');
  if (toggleCrop) {
    e.preventDefault();
    e.stopPropagation();
    toggleCropCard(toggleCrop.closest('[data-crop-card]'));
    return;
  }
  const previewCrop = e.target.closest('[data-previewcrop]');
  if (previewCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = previewCrop.closest('[data-crop-card]');
    if (!card) return;
    let draft = null;
    try { draft = await collectCropLandingCardData(card, { uploadFiles: false }); }
    catch (err) { toast(err.message, 'err'); return; }
    openCropPreviewPane(draft);
    return;
  }
  const duplicateCrop = e.target.closest('[data-duplicatecrop]');
  if (duplicateCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = duplicateCrop.closest('[data-crop-card]');
    if (!card) return;
    let entry = null;
    try { entry = await collectCropLandingCardData(card, { uploadFiles: false }); }
    catch (err) { toast(err.message, 'err'); return; }
    const clone = {
      ...entry,
      slug: uniqueCropSlug(`${entry.slug || slugifyCrop(entry.crop) || 'crop'}-copy`, card),
      crop: entry.crop ? `${entry.crop} (คัดลอก)` : '',
      enabled: false,
      seoTitle: entry.seoTitle ? `${entry.seoTitle} (คัดลอก)` : '',
      sortOrder: (entry.sortOrder || 0) + 1,
      gallery: asArray(entry.gallery).map((item) => ({ ...item })),
      reviews: asArray(entry.reviews).map((item) => ({ ...item })),
    };
    card.insertAdjacentHTML('afterend', cropLandingAdminCard(clone, document.querySelectorAll('[data-crop-card]').length));
    updateCropAdminCardSummary(card.nextElementSibling);
    focusCropCard(card.nextElementSibling);
    scheduleCropDraftSave(120);
    return;
  }
  const previewDevice = e.target.closest('[data-previewdevice]');
  if (previewDevice) {
    e.preventDefault();
    e.stopPropagation();
    setCropPreviewDevice(previewDevice.dataset.previewdevice || 'desktop');
    return;
  }
  const addReview = e.target.closest('[data-addreview]');
  if (addReview) {
    e.preventDefault();
    e.stopPropagation();
    const list = addReview.closest('[data-crop-card]')?.querySelector('[data-review-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropReviewEditor({}));
    scheduleCropPreview(list.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(180);
    return;
  }
  const addReviewBatch = e.target.closest('[data-addreviewbatch]');
  if (addReviewBatch) {
    e.preventDefault();
    e.stopPropagation();
    addReviewBatch.closest('.crop-review-head')?.querySelector('[data-bulkreviewfiles]')?.click();
    return;
  }
  const addGallery = e.target.closest('[data-addgallery]');
  if (addGallery) {
    e.preventDefault();
    e.stopPropagation();
    const list = addGallery.closest('[data-crop-card]')?.querySelector('[data-gallery-list]');
    if (!list) return;
    list.insertAdjacentHTML('beforeend', cropGalleryEditor({}));
    scheduleCropPreview(list.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(180);
    return;
  }
  const addGalleryBatch = e.target.closest('[data-addgallerybatch]');
  if (addGalleryBatch) {
    e.preventDefault();
    e.stopPropagation();
    addGalleryBatch.closest('.crop-review-head')?.querySelector('[data-bulkgalleryfiles]')?.click();
    return;
  }
  const removeGallery = e.target.closest('[data-removegallery]');
  if (removeGallery) {
    e.preventDefault();
    e.stopPropagation();
    const item = removeGallery.closest('[data-crop-gallery]');
    const card = item?.closest('[data-crop-card]');
    item?.remove();
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const removeReview = e.target.closest('[data-removereview]');
  if (removeReview) {
    e.preventDefault();
    e.stopPropagation();
    const item = removeReview.closest('[data-crop-review]');
    const card = item?.closest('[data-crop-card]');
    item?.remove();
    scheduleCropPreview(card, 80);
    scheduleCropDraftSave(180);
    return;
  }
  const templateBtn = e.target.closest('[data-reviewtemplatebtn]');
  if (templateBtn) {
    e.preventDefault();
    e.stopPropagation();
    const item = templateBtn.closest('[data-crop-review]');
    applyReviewTemplate(item, templateBtn.dataset.reviewtemplatebtn || '');
    scheduleCropPreview(item?.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
    return;
  }
  const removeCrop = e.target.closest('[data-removecrop]');
  if (removeCrop) {
    e.preventDefault();
    e.stopPropagation();
    const card = removeCrop.closest('[data-crop-card]');
    const crop = (card?.querySelector('[data-field="crop"]')?.value || '').trim();
    const rawSlug = (card?.querySelector('[data-field="slug"]')?.value || '').trim();
    const slug = slugifyCrop(rawSlug || crop);
    if (removeCrop.dataset.confirmRemove !== '1') {
      removeCrop.dataset.confirmRemove = '1';
      removeCrop.textContent = 'ยืนยันลบหน้านี้';
      removeCrop.classList.add('is-confirm');
      setTimeout(() => {
        if (removeCrop.isConnected) {
          removeCrop.dataset.confirmRemove = '';
          removeCrop.textContent = 'ลบหน้านี้';
          removeCrop.classList.remove('is-confirm');
        }
      }, 3500);
      return;
    }
    try {
      const draft = JSON.parse(localStorage.getItem('cropLandingPreviewDraft') || '{}');
      if (draft?.slug && draft.slug === slug) localStorage.removeItem('cropLandingPreviewDraft');
    } catch {}
    card?.remove();
    scheduleCropDraftSave(120);
    return;
  }
  if (id === 'testLineBtn') {
    e.target.disabled = true;
    try { const r = await api('/api/admin/test-line', { method: 'POST' }); const d = await r.json(); if (!r.ok) throw new Error(d.error); toast('ส่งข้อความทดสอบไป LINE แล้ว', 'ok'); }
    catch (err) { toast(err.message || 'ส่งไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  if (id === 'testMailBtn') {
    e.target.disabled = true;
    try { const r = await api('/api/admin/test-mail', { method: 'POST', body: JSON.stringify({}) }); const d = await r.json(); if (!r.ok) throw new Error(d.error); toast('ส่งอีเมลทดสอบแล้ว', 'ok'); }
    catch (err) { toast(err.message || 'ส่งไม่สำเร็จ', 'err'); }
    e.target.disabled = false; return;
  }
  const ed = e.target.closest('[data-editprod]'); if (ed) { const p = _adminProducts.find((x) => x.id === ed.dataset.editprod); document.getElementById('prodFormWrap').innerHTML = productForm(p); document.getElementById('prodFormWrap').scrollIntoView({ behavior: 'smooth' }); return; }
  const del = e.target.closest('[data-delprod]'); if (del) { if (!confirm('ลบสินค้านี้?')) return; await api('/api/admin/products/' + del.dataset.delprod, { method: 'DELETE' }); toast('ลบสินค้าแล้ว', 'ok'); render(); return; }
  const eda = e.target.closest('[data-editart]'); if (eda) { const a = _adminArticles.find((x) => x.id === eda.dataset.editart); document.getElementById('articleFormWrap').innerHTML = articleForm(a); document.getElementById('articleFormWrap').scrollIntoView({ behavior: 'smooth' }); return; }
  const dela = e.target.closest('[data-delart]'); if (dela) { if (!confirm('ลบบทความนี้?')) return; await api('/api/admin/articles/' + dela.dataset.delart, { method: 'DELETE' }); toast('ลบบทความแล้ว', 'ok'); render(); return; }
  const oa = e.target.closest('[data-oaction]'); if (oa) {
    const oid = oa.dataset.oid; const action = oa.dataset.oaction;
    const tracking = action === 'shipped' ? (document.querySelector(`[data-track="${oid}"]`)?.value || '') : '';
    oa.disabled = true;
    try { const r = await api('/api/admin/orders/' + oid + '/status', { method: 'POST', body: JSON.stringify({ action, tracking }) }); if (!r.ok) throw new Error((await r.json()).error); toast('อัปเดตสถานะแล้ว', 'ok'); render(); }
    catch (err) { toast(err.message || 'ผิดพลาด', 'err'); oa.disabled = false; }
    return;
  }
  // coupons (admin)
  if (id === 'addCouponBtn') { const w = document.getElementById('couponFormWrap'); w.innerHTML = w.innerHTML ? '' : couponForm(null); return; }
  if (id === 'cancelCoupon') { document.getElementById('couponFormWrap').innerHTML = ''; return; }
  const ec = e.target.closest('[data-editcoupon]'); if (ec) { const c = _coupons.find((x) => x.code === ec.dataset.editcoupon); document.getElementById('couponFormWrap').innerHTML = couponForm(c); return; }
  const dc = e.target.closest('[data-delcoupon]'); if (dc) { if (!confirm('ลบคูปอง ' + dc.dataset.delcoupon + '?')) return; await api('/api/admin/coupons/' + dc.dataset.delcoupon, { method: 'DELETE' }); toast('ลบคูปองแล้ว', 'ok'); render(); return; }
  // users (admin)
  const su = e.target.closest('[data-saveuser]'); if (su) {
    const uid = su.dataset.saveuser;
    const name = document.querySelector(`[data-uname="${uid}"]`)?.value || '';
    const role = document.querySelector(`[data-urole="${uid}"]`)?.value || 'user';
    su.disabled = true;
    try { const r = await api('/api/admin/users/' + uid, { method: 'PUT', body: JSON.stringify({ name, role }) }); if (!r.ok) throw new Error((await r.json()).error); toast('บันทึกผู้ใช้แล้ว', 'ok'); render(); }
    catch (err) { toast(err.message, 'err'); su.disabled = false; }
    return;
  }
  const du = e.target.closest('[data-deluser]'); if (du) { if (!confirm('ลบผู้ใช้นี้?')) return; const r = await api('/api/admin/users/' + du.dataset.deluser, { method: 'DELETE' }); if (!r.ok) { toast((await r.json()).error, 'err'); return; } toast('ลบผู้ใช้แล้ว', 'ok'); render(); return; }
  // coupon apply (checkout)
  if (id === 'couponApply') {
    const code = (document.getElementById('couponInput')?.value || '').trim();
    if (!code) return;
    e.target.disabled = true;
    try {
      const r = await api('/api/coupons/validate', { method: 'POST', body: JSON.stringify({ code, subtotal: cartTotal() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      appliedCoupon = { code: d.coupon, discount: d.discount };
      toast('ใช้คูปองสำเร็จ −' + baht(d.discount), 'ok'); render();
    } catch (err) { toast(err.message || 'คูปองไม่ถูกต้อง', 'err'); e.target.disabled = false; }
    return;
  }
  if (id === 'couponRemove') { appliedCoupon = null; render(); return; }
  const sl = e.target.closest('[data-savelead]');
  if (sl) {
    const id = sl.dataset.savelead;
    const status = document.querySelector(`[data-lstatus="${id}"]`)?.value || 'new';
    const note = document.querySelector(`[data-lnote="${id}"]`)?.value || '';
    sl.disabled = true;
    try {
      const r = await api('/api/admin/leads/' + id, { method: 'PUT', body: JSON.stringify({ status, note }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'บันทึกไม่สำเร็จ');
      toast('บันทึกสถานะลีดแล้ว', 'ok');
      render();
    } catch (err) {
      toast(err.message, 'err');
      sl.disabled = false;
    }
    return;
  }
});

// ════════════════════════ Live chat (REST send + poll — serverless-friendly) ════════════════════════
const chatBox = document.getElementById('chatBox');
const chatMessages = document.getElementById('chatMessages');
const chatStatus = document.getElementById('chatStatus');

// session id คงที่ต่อเบราว์เซอร์ (เก็บใน localStorage) เพื่อให้แอดมินตอบกลับห้องเดิมได้
currentSessionId = localStorage.getItem('nuch_chat_sid') || '';
let _chatLastAt = 0;
let _chatPollTimer = null;
let _chatGreeted = false;

document.getElementById('chatToggle').onclick = () => { chatBox.classList.toggle('open'); if (chatBox.classList.contains('open')) startChat(); };
document.getElementById('chatClose').onclick = () => chatBox.classList.remove('open');
function openChat() { chatBox.classList.add('open'); startChat(); }

function addMessage(from, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + from;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function pollChat() {
  if (!currentSessionId) return;
  try {
    const r = await fetch(`/api/chat/poll?session=${encodeURIComponent(currentSessionId)}&after=${_chatLastAt}`);
    const d = await r.json();
    for (const m of (d.messages || [])) { addMessage(m.from === 'admin' ? 'admin' : 'system', m.text); if (m.at > _chatLastAt) _chatLastAt = m.at; }
    chatStatus.textContent = '🟢 ออนไลน์';
  } catch { chatStatus.textContent = '🔴 ออฟไลน์'; }
}

function startChat() {
  if (!_chatGreeted) {
    _chatGreeted = true;
    addMessage('system', 'สวัสดีครับ พิมพ์สอบถามได้เลย ทีมงานจะตอบกลับโดยเร็วครับ');
  }
  if (!_chatPollTimer) { pollChat(); _chatPollTimer = setInterval(pollChat, 3000); }
}

async function sendChat(text) {
  if (!text || !text.trim()) return;
  addMessage('customer', text);
  try {
    const r = await fetch('/api/chat/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId || undefined, text }),
    });
    const d = await r.json();
    if (d.sessionId) { currentSessionId = d.sessionId; localStorage.setItem('nuch_chat_sid', d.sessionId); }
    startChat();
  } catch { addMessage('system', 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่'); }
}
document.getElementById('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('chatInput');
  sendChat(input.value); input.value = '';
});

// ════════════════════════ Motion ════════════════════════
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); revealObserver.unobserve(en.target); } });
}, { threshold: 0.12 });

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const el = en.target;
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    const dur = 1400, t0 = performance.now();
    (function tick(now) {
      const p = Math.min((now - t0) / dur, 1);
      const val = target * (1 - Math.pow(1 - p, 3));
      el.textContent = (dec ? val.toFixed(dec) : Math.floor(val).toLocaleString()) + suffix;
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = (dec ? target.toFixed(dec) : target.toLocaleString()) + suffix;
    })(t0);
    counterObserver.unobserve(el);
  });
}, { threshold: 0.5 });

// run after each view render
function enhance() {
  document.querySelectorAll('.reveal:not(.in)').forEach((el) => revealObserver.observe(el));
  document.querySelectorAll('[data-count]').forEach((el) => counterObserver.observe(el));
  if (document.getElementById('calcCrop')) {
    syncCalcProblemSelect({ preserveSelection: true });
    syncCalcStageSelect({ preserveSelection: true });
    syncCalcPresetSelect({ preserveSelection: true });
    syncCalcCompareSelect({ preserveSelection: false });
    applyCalcBudgetSelection();
    renderCalcModeState();
    updateCalcPage();
  }
  if (document.getElementById('leadForm')) applyCalcLeadPrefill();
  if (document.getElementById('calcKnowledgeJson')) syncCalcKnowledgeEditor();
  attachTilt(document);
  // เล่นวิดีโอบนการ์ดตอน hover
  document.querySelectorAll('.card-vid').forEach((v) => {
    const card = v.closest('.card'); if (!card || card._vid) return; card._vid = true;
    card.addEventListener('pointerenter', () => { v.play().catch(() => {}); });
    card.addEventListener('pointerleave', () => { v.pause(); v.currentTime = 0; });
  });
}

// scroll: progress bar + back-to-top + nav state
const nav = document.querySelector('.nav');
addEventListener('scroll', () => {
  const st = scrollY, h = document.documentElement.scrollHeight - innerHeight;
  const pb = document.getElementById('scrollProgress');
  const tt = document.getElementById('toTop');
  if (pb) pb.style.transform = `scaleX(${h > 0 ? (st / h) : 0})`;
  if (nav) nav.classList.toggle('scrolled', st > 30);
  if (tt) tt.classList.toggle('show', st > 600);
}, { passive: true });

// quick view / lightbox / escape
document.body.addEventListener('click', (e) => {
  const q = e.target.closest('[data-quick]');
  if (q) { e.preventDefault(); e.stopPropagation(); openQuickView(q.dataset.quick); return; }
  if (e.target.closest('[data-qvclose]') || e.target.id === 'quickModal') { closeQuickView(); return; }
  const z = e.target.closest('[data-zoom]');
  if (z) { e.preventDefault(); openLightbox(z); return; }
  const lbThumb = e.target.closest('[data-lbindex]');
  if (lbThumb) { e.preventDefault(); e.stopPropagation(); setLightboxIndex(parseInt(lbThumb.dataset.lbindex || '0', 10) || 0); return; }
  const lbNav = e.target.closest('[data-lbnav]');
  if (lbNav) { e.preventDefault(); e.stopPropagation(); moveLightbox(parseInt(lbNav.dataset.lbnav || '1', 10) || 1); return; }
  if (e.target.closest('.lb-dialog')) return;
  if (e.target.closest('#lightbox')) { closeLightbox(); return; }
  if (e.target.closest('[data-add]')) closeQuickView();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMobileNav(); closeQuickView(); closeLightbox(); }
  if (e.key === 'ArrowRight' && document.getElementById('lightbox')?.classList.contains('show')) moveLightbox(1);
  if (e.key === 'ArrowLeft' && document.getElementById('lightbox')?.classList.contains('show')) moveLightbox(-1);
});
document.addEventListener('click', (e) => { if (e.target.id === 'toTop') scrollTo({ top: 0, behavior: 'smooth' }); });

// wishlist / search / filter / gallery / review-stars
document.body.addEventListener('click', (e) => {
  const calcCopyBtn = e.target.closest('#calcCopyBtn');
  if (calcCopyBtn) {
    e.preventDefault();
    const text = calcCopyBtn.dataset.copyText || '';
    if (!text) { toast('ยังไม่มีสูตรให้คัดลอก', 'err'); return; }
    copyTextToClipboard(text).then((ok) => {
      toast(ok ? 'คัดลอกสูตรผสมแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
    });
    return;
  }
  const calcPitchCopyBtn = e.target.closest('#calcPitchCopyBtn');
  if (calcPitchCopyBtn) {
    e.preventDefault();
    const text = calcPitchCopyBtn.dataset.copyText || '';
    if (!text) { toast('ยังไม่มีข้อความให้คัดลอก', 'err'); return; }
    copyTextToClipboard(text).then((ok) => {
      toast(ok ? 'คัดลอกข้อความพร้อมส่งแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
    });
    return;
  }
  const calcAddBundleBtn = e.target.closest('#calcAddBundleBtn');
  if (calcAddBundleBtn) {
    e.preventDefault();
    const plan = calcBundlePlan(calcAddBundleBtn.dataset.bundlePlan || '');
    if (!plan.length) { toast('ยังไม่มีชุดสูตรให้เพิ่มลงตะกร้า', 'err'); return; }
    const totalQty = applyCartPlan(plan);
    toast(`เพิ่มทั้งชุดตามขวดแนะนำแล้ว ${totalQty} ขวด`, 'ok');
    openCart();
    return;
  }
  const calcCheckoutNowBtn = e.target.closest('#calcCheckoutNowBtn');
  if (calcCheckoutNowBtn) {
    e.preventDefault();
    checkoutFromCalcPlan(calcCheckoutNowBtn.dataset.bundlePlan || '');
    return;
  }
  const calcBudgetBtn = e.target.closest('[data-calcbudget]');
  if (calcBudgetBtn) {
    e.preventDefault();
    const input = document.getElementById('calcBudgetLevel');
    if (!input) return;
    input.value = calcBudgetBtn.dataset.calcbudget || 'balanced';
    applyCalcBudgetSelection();
    updateCalcPage();
    return;
  }
  const calcProblemBtn = e.target.closest('[data-calc-problem]');
  if (calcProblemBtn) {
    e.preventDefault();
    const select = document.getElementById('calcProblem');
    if (!select) return;
    select.value = calcProblemBtn.dataset.calcProblem || '';
    syncCalcProblemSelect({ preserveSelection: true });
    applyCalcProblemSelection();
    syncCalcCompareSelect({ preserveSelection: false });
    document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    updateCalcPage();
    return;
  }
  const calcPlanDaysBtn = e.target.closest('[data-calcplandays]');
  if (calcPlanDaysBtn) {
    e.preventDefault();
    const input = document.getElementById('calcPlanDays');
    if (input) input.value = calcPlanDaysBtn.dataset.calcplandays || '14';
    document.querySelectorAll('[data-calcplandays]').forEach((btn) => btn.classList.toggle('on', btn === calcPlanDaysBtn));
    updateCalcPage();
    return;
  }
  const calcConsultLeadBtn = e.target.closest('#calcConsultLeadBtn');
  if (calcConsultLeadBtn) {
    e.preventDefault();
    let payload = null;
    try { payload = JSON.parse(calcConsultLeadBtn.dataset.leadPayload || 'null'); } catch {}
    if (!payload) { toast('ยังไม่มีข้อมูลสูตรสำหรับส่งให้ทีมงาน', 'err'); return; }
    setCalcLeadPrefill(payload);
    scrollToLeadBlock({ focusInput: true });
    toast('พาสูตรนี้ไปกรอกในฟอร์มให้แล้ว', 'ok');
    return;
  }
  const calcLineLink = e.target.closest('#calcSalesLineBtn, #calcOpenOaBtn, #calcConsultLineBtn');
  if (calcLineLink) {
    const placement = calcLineLink.id === 'calcSalesLineBtn'
      ? 'calc_sales'
      : calcLineLink.id === 'calcOpenOaBtn'
        ? 'calc_open_oa'
        : 'calc_consult';
    trackEvent('line_click', { placement });
  }
  const addMixBtn = e.target.closest('[data-addmix]');
  if (addMixBtn) {
    e.preventDefault();
    const card = addMixBtn.closest('[data-calc-crop-card]');
    const list = card?.querySelector('[data-mix-list]');
    if (!list || !card) return;
    list.insertAdjacentHTML('beforeend', calcKnowledgeMixEditorRow({
      stage: CALC_STAGE_TEMPLATE_OPTIONS[0],
      title: '',
      note: '',
      ids: [],
    }));
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    return;
  }
  const toggleCalcCropBtn = e.target.closest('[data-togglecalccrop]');
  if (toggleCalcCropBtn) {
    e.preventDefault();
    const card = toggleCalcCropBtn.closest('[data-calc-crop-card]');
    if (!card) return;
    setCalcCropEditorCollapsed(card, !card.classList.contains('is-collapsed'));
    return;
  }
  const expandCalcCropsBtn = e.target.closest('[data-expandcalccrops]');
  if (expandCalcCropsBtn) {
    e.preventDefault();
    document.querySelectorAll('[data-calc-crop-card]').forEach((card) => setCalcCropEditorCollapsed(card, false));
    return;
  }
  const collapseCalcCropsBtn = e.target.closest('[data-collapsecalccrops]');
  if (collapseCalcCropsBtn) {
    e.preventDefault();
    document.querySelectorAll('[data-calc-crop-card]').forEach((card) => setCalcCropEditorCollapsed(card, true));
    return;
  }
  const dupMixBtn = e.target.closest('[data-dupmix]');
  if (dupMixBtn) {
    e.preventDefault();
    const row = dupMixBtn.closest('[data-mix-row]');
    const card = dupMixBtn.closest('[data-calc-crop-card]');
    const list = row?.parentElement;
    const crop = String(card?.dataset.cropName || '').trim();
    if (!row || !list || !card) return;
    const duplicated = readCalcMixEditorRow(row, { crop, index: list.querySelectorAll('[data-mix-row]').length });
    duplicated.title = duplicated.title ? `${duplicated.title} (คัดลอก)` : 'สูตรคัดลอก';
    row.insertAdjacentHTML('afterend', calcKnowledgeMixEditorRow(duplicated));
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    toast('ทำซ้ำสูตรแล้ว', 'ok');
    return;
  }
  const delMixBtn = e.target.closest('[data-delmix]');
  if (delMixBtn) {
    e.preventDefault();
    const row = delMixBtn.closest('[data-mix-row]');
    const card = delMixBtn.closest('[data-calc-crop-card]');
    if (!row) return;
    row.remove();
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
    return;
  }
  const scrollLead = e.target.closest('[data-scrolllead]');
  if (scrollLead) {
    e.preventDefault();
    scrollToLeadBlock({ focusInput: true });
    return;
  }
  const prefillCrop = e.target.closest('[data-prefillcrop]');
  if (prefillCrop) {
    e.preventDefault();
    scrollToLeadBlock({ focusInput: true });
    setTimeout(() => {
      const cropEl = document.getElementById('leadCrop');
      if (cropEl) {
        cropEl.value = prefillCrop.dataset.prefillcrop || '';
        cropEl.dataset.pendingCrop = cropEl.value;
      }
    }, 250);
    return;
  }
  const w = e.target.closest('[data-wish]');
  if (w) { e.preventDefault(); e.stopPropagation(); toggleWishlist(w.dataset.wish); w.classList.toggle('on', wishlist.has(w.dataset.wish)); if (currentPath() === '/wishlist') render(); return; }
  const cat = e.target.closest('[data-cat]');
  if (cat) { _pf.cat = cat.dataset.cat; document.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b === cat)); renderProductGrid(); return; }
  const cr = e.target.closest('[data-crop]');
  if (cr) {
    _pf.crop = cr.dataset.crop || null;
    document.querySelectorAll('[data-crop]').forEach((b) => b.classList.toggle('on', b === cr));
    const tip = document.getElementById('cropTip');
    const guideMap = cropGuideMap();
    if (tip) tip.innerHTML = (_pf.crop && guideMap[_pf.crop]) ? `<div class="crop-tip glass">💡 <b>${esc(_pf.crop)}:</b> ${esc(guideMap[_pf.crop].tip)}</div>` : '';
    renderProductGrid(); return;
  }
  const th = e.target.closest('[data-mi]');
  if (th) { renderMain(+th.dataset.mi); return; }
  const calcModeBtn = e.target.closest('[data-calcmode]');
  if (calcModeBtn) {
    setCalcUsageMode(calcModeBtn.dataset.calcmode);
    renderCalcModeState();
    updateCalcPage();
    return;
  }
  const sp = e.target.closest('[data-star]');
  if (sp) { const n = +sp.dataset.star; const pick = sp.closest('#starPick'); pick.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j < n)); pick.parentElement.querySelector('[name=rating]').value = n; return; }
  const reviewTemplate = e.target.closest('[data-reviewtemplate]');
  if (reviewTemplate) return;
});
document.body.addEventListener('input', (e) => {
  if (e.target.id === 'searchInput') { _pf.q = e.target.value; renderProductGrid(); }
  if (['calcPageTank', 'calcTankCount', 'calcWaterTotal', 'calcAreaRai', 'calcWaterPerRai', 'calcRefTank', 'calcStrength'].includes(e.target.id)) {
    if (e.target.id === 'calcWaterPerRai') e.target.dataset.touched = '1';
    updateCalcPage();
  }
  if (e.target.matches('[data-calc-product]')) {
    e.target.closest('[data-calc-card]')?.classList.toggle('is-selected', e.target.checked);
    const preset = document.getElementById('calcPreset');
    const problem = document.getElementById('calcProblem');
    if (preset) preset.value = '';
    if (problem) problem.value = '';
    syncCalcProblemSelect({ preserveSelection: true });
    syncCalcPresetSelect({ preserveSelection: true });
    syncCalcCompareSelect({ preserveSelection: true });
    updateCalcPage();
  }
  if (e.target.classList.contains('calc-tank')) {
    const box = e.target.closest('.calc-box');
    const r = { per: +box.dataset.per, min: +box.dataset.min, max: +box.dataset.max };
    const strength = box.querySelector('.calc-strength')?.value || 'mid';
    box.querySelector('.calc-out').innerHTML = `ใช้ <b>${calcResult(r, parseInt(e.target.value, 10) || 0, strength)}</b> ต่อถัง`;
  }
  if (e.target.classList.contains('calc-strength')) {
    const box = e.target.closest('.calc-box');
    const tank = parseInt(box?.querySelector('.calc-tank')?.value || '0', 10) || 0;
    const r = { per: +box.dataset.per, min: +box.dataset.min, max: +box.dataset.max };
    box.querySelector('.calc-out').innerHTML = `ใช้ <b>${calcResult(r, tank, e.target.value || 'mid')}</b> ต่อถัง`;
  }
  if (e.target.matches('[data-review-image-input]')) {
    updateReviewPreview(e.target.closest('[data-crop-review]'), e.target.value);
  }
  if (e.target.matches('[data-gallery-image-input]')) {
    updateGalleryPreview(e.target.closest('[data-crop-gallery]'), e.target.value);
  }
  if (e.target.matches('[data-field="seoImage"]')) {
    updateSeoImagePreview(e.target.closest('[data-crop-card]'), e.target.value);
  }
  if (e.target.matches('[data-field="heroImage"]')) {
    updateHeroImagePreview(e.target.closest('[data-crop-card]'), e.target.value);
  }
  if (e.target.matches('[data-field="heroRatio"], [data-field="heroFocus"]')) {
    const card = e.target.closest('[data-crop-card]');
    updateHeroImagePreview(card, card?.querySelector('[data-field="heroImage"]')?.value || '');
  }
  if (e.target.matches('[data-field="crop"], [data-field="slug"], [data-field="enabled"]')) {
    updateCropAdminCardSummary(e.target.closest('[data-crop-card]'));
  }
  if (e.target.closest('#calcKnowledgeEditor')) {
    syncCalcKnowledgeEditor();
  }
  const cropCard = e.target.closest('[data-crop-card]');
  if (cropCard && !e.target.matches('[type="file"]')) {
    scheduleCropPreview(cropCard);
    scheduleCropDraftSave();
  }
});
document.body.addEventListener('change', (e) => {
  if (e.target.id === 'sortSelect') { _pf.sort = e.target.value; renderProductGrid(); }
  if (e.target.id === 'coCountry') { const el = document.getElementById('sumTotals'); if (el) el.innerHTML = checkoutTotalsHTML(); }
  if (['calcCrop', 'calcProblem', 'calcStage', 'calcPreset', 'calcComparePreset', 'calcIncludeSticker', 'calcStrength'].includes(e.target.id)) {
    if (e.target.id === 'calcCrop') {
      syncCalcProblemSelect({ preserveSelection: false });
      syncCalcStageSelect({ preserveSelection: false });
      syncCalcPresetSelect({ preserveSelection: false });
      const cfg = calcCropConfig(e.target.value);
      const areaWaterInput = document.getElementById('calcWaterPerRai');
      if (areaWaterInput) {
        areaWaterInput.value = String(cfg?.waterPerRai || defaultWaterPerRai(calcRatedProducts()[0]));
        delete areaWaterInput.dataset.touched;
      }
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcProblem') {
      applyCalcProblemSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcStage') {
      const problem = document.getElementById('calcProblem');
      if (problem) problem.value = '';
      syncCalcProblemSelect({ preserveSelection: true });
      syncCalcPresetSelect({ preserveSelection: false });
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      syncCalcCompareSelect({ preserveSelection: false });
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
    }
    if (e.target.id === 'calcPreset') {
      const problem = document.getElementById('calcProblem');
      if (problem) problem.value = '';
      syncCalcProblemSelect({ preserveSelection: true });
      applyCalcPresetSelection();
      applyCalcBudgetSelection();
      document.querySelectorAll('[data-calc-product]').forEach((input) => input.closest('[data-calc-card]')?.classList.toggle('is-selected', input.checked));
      syncCalcPresetSelect({ preserveSelection: true });
      syncCalcCompareSelect({ preserveSelection: false });
    }
    updateCalcPage();
  }
  if (e.target.closest('#calcKnowledgeEditor')) {
    syncCalcKnowledgeEditor();
  }
  if (e.target.matches('[data-review-image-input]')) {
    updateReviewPreview(e.target.closest('[data-crop-review]'), e.target.value);
  }
  if (e.target.matches('[data-gallery-image-input]')) {
    updateGalleryPreview(e.target.closest('[data-crop-gallery]'), e.target.value);
  }
  if (e.target.matches('[data-review-file]')) {
    const wrap = e.target.closest('[data-crop-review]');
    const file = e.target.files?.[0];
    const input = wrap?.querySelector('[data-review-image-input]');
    const preview = wrap?.querySelector('[data-review-preview]');
    if (!preview) return;
    if (!file) {
      updateReviewPreview(wrap, input?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    if (input) input.value = '';
    preview.classList.remove('is-empty');
    preview.innerHTML = `<img src="${localUrl}">`;
  }
  if (e.target.matches('[data-gallery-file]')) {
    const wrap = e.target.closest('[data-crop-gallery]');
    const file = e.target.files?.[0];
    const input = wrap?.querySelector('[data-gallery-image-input]');
    const preview = wrap?.querySelector('[data-gallery-preview]');
    if (!preview) return;
    if (!file) {
      updateGalleryPreview(wrap, input?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    if (input) input.value = '';
    preview.classList.remove('is-empty');
    preview.innerHTML = `<img src="${localUrl}">`;
  }
  if (e.target.matches('[data-seoimagefile]')) {
    const card = e.target.closest('[data-crop-card]');
    const file = e.target.files?.[0];
    if (!card) return;
    if (!file) {
      updateSeoImagePreview(card, card.querySelector('[data-field="seoImage"]')?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    updateSeoImagePreview(card, localUrl);
    scheduleCropPreview(card, 80);
  }
  if (e.target.matches('[data-heroimagefile]')) {
    const card = e.target.closest('[data-crop-card]');
    const file = e.target.files?.[0];
    if (!card) return;
    if (!file) {
      updateHeroImagePreview(card, card.querySelector('[data-field="heroImage"]')?.value || '');
      return;
    }
    const localUrl = URL.createObjectURL(file);
    updateHeroImagePreview(card, localUrl);
    scheduleCropPreview(card, 80);
  }
  if (e.target.matches('[data-field="heroRatio"], [data-field="heroFocus"]')) {
    const card = e.target.closest('[data-crop-card]');
    updateHeroImagePreview(card, card?.querySelector('[data-field="heroImage"]')?.value || '');
  }
  if (e.target.matches('[data-bulkreviewfiles]')) {
    const input = e.target;
    const files = [...(input.files || [])];
    const list = input.closest('.crop-review-head')?.parentElement?.querySelector('[data-review-list]');
    if (!files.length || !list) return;
    input.disabled = true;
    (async () => {
      try {
        for (const file of files) {
          const image = await uploadAdminAsset(file);
          list.insertAdjacentHTML('beforeend', cropReviewEditor({ image }));
        }
        scheduleCropPreview(list.closest('[data-crop-card]'), 80);
        scheduleCropDraftSave(180);
        toast(`เพิ่มรูปรีวิว ${files.length} รูปแล้ว`, 'ok');
      } catch (err) {
        toast(err.message || 'อัปโหลดรูปรีวิวไม่สำเร็จ', 'err');
      } finally {
        input.value = '';
        input.disabled = false;
      }
    })();
  }
  if (e.target.matches('[data-bulkgalleryfiles]')) {
    const input = e.target;
    const files = [...(input.files || [])];
    const list = input.closest('.crop-review-head')?.parentElement?.querySelector('[data-gallery-list]');
    if (!files.length || !list) return;
    input.disabled = true;
    (async () => {
      try {
        for (const file of files) {
          const image = await uploadAdminAsset(file);
          list.insertAdjacentHTML('beforeend', cropGalleryEditor({ image }));
        }
        scheduleCropPreview(list.closest('[data-crop-card]'), 80);
        scheduleCropDraftSave(180);
        toast(`เพิ่มรูปภาพหน้า Landing ${files.length} รูปแล้ว`, 'ok');
      } catch (err) {
        toast(err.message || 'อัปโหลดรูปภาพหน้า Landing ไม่สำเร็จ', 'err');
      } finally {
        input.value = '';
        input.disabled = false;
      }
    })();
  }
  if (e.target.matches('[data-field="enabled"]')) {
    updateCropAdminCardSummary(e.target.closest('[data-crop-card]'));
  }
  if (e.target.matches('[data-reviewtemplate]')) {
    const item = e.target.closest('[data-crop-review]');
    applyReviewTemplate(item, e.target.value || '');
    scheduleCropPreview(item?.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const cropCard = e.target.closest('[data-crop-card]');
  if (cropCard) scheduleCropPreview(cropCard, 100);
});
let draggedCropCard = null;
let draggedGalleryItem = null;
let draggedReviewItem = null;
let draggedCalcMixRow = null;
document.body.addEventListener('dragstart', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (mixRow) {
    draggedCalcMixRow = mixRow;
    mixRow.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const gallery = e.target.closest('[data-crop-gallery]');
  if (gallery) {
    draggedGalleryItem = gallery;
    gallery.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const review = e.target.closest('[data-crop-review]');
  if (review) {
    draggedReviewItem = review;
    review.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    return;
  }
  const card = e.target.closest('[data-crop-card]');
  if (!card) return;
  draggedCropCard = card;
  card.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
});
document.body.addEventListener('dragover', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (draggedCalcMixRow && mixRow && mixRow !== draggedCalcMixRow) {
    e.preventDefault();
    const rect = mixRow.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = mixRow.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedCalcMixRow, after ? mixRow.nextSibling : mixRow);
    return;
  }
  if (draggedCalcMixRow) return;
  const gallery = e.target.closest('[data-crop-gallery]');
  if (draggedGalleryItem && gallery && gallery !== draggedGalleryItem) {
    e.preventDefault();
    const rect = gallery.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = gallery.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedGalleryItem, after ? gallery.nextSibling : gallery);
    return;
  }
  if (draggedGalleryItem) return;
  const review = e.target.closest('[data-crop-review]');
  if (draggedReviewItem && review && review !== draggedReviewItem) {
    e.preventDefault();
    const rect = review.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    const parent = review.parentElement;
    if (!parent) return;
    parent.insertBefore(draggedReviewItem, after ? review.nextSibling : review);
    return;
  }
  if (draggedReviewItem) return;
  const card = e.target.closest('[data-crop-card]');
  if (!draggedCropCard || !card || card === draggedCropCard) return;
  e.preventDefault();
  const rect = card.getBoundingClientRect();
  const after = e.clientY > rect.top + rect.height / 2;
  const parent = card.parentElement;
  if (!parent) return;
  parent.insertBefore(draggedCropCard, after ? card.nextSibling : card);
  [...parent.querySelectorAll('[data-crop-card]')].forEach((item, idx) => {
    const sortInput = item.querySelector('[data-field="sortOrder"]');
    if (sortInput) sortInput.value = String(idx);
  });
});
document.body.addEventListener('dragend', (e) => {
  const mixRow = e.target.closest('[data-mix-row]');
  if (mixRow) {
    mixRow.classList.remove('is-dragging');
    const card = mixRow.closest('[data-calc-crop-card]');
    updateCalcKnowledgeCropSummary(card);
    syncCalcKnowledgeEditor();
  }
  const gallery = e.target.closest('[data-crop-gallery]');
  if (gallery) {
    gallery.classList.remove('is-dragging');
    scheduleCropPreview(gallery.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const review = e.target.closest('[data-crop-review]');
  if (review) {
    review.classList.remove('is-dragging');
    scheduleCropPreview(review.closest('[data-crop-card]'), 80);
    scheduleCropDraftSave(120);
  }
  const card = e.target.closest('[data-crop-card]');
  if (card) {
    card.classList.remove('is-dragging');
    scheduleCropDraftSave(120);
  }
  draggedCropCard = null;
  draggedGalleryItem = null;
  draggedReviewItem = null;
  draggedCalcMixRow = null;
});
document.body.addEventListener('submit', async (e) => {
  if (e.target.id === 'leadForm') {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const body = {
      name: fd.get('name'),
      phone: fd.get('phone'),
      lineId: fd.get('lineId'),
      province: fd.get('province'),
      crop: fd.get('crop'),
      stage: fd.get('stage'),
      areaRai: fd.get('areaRai'),
      problem: fd.get('problem'),
      source: leadAttribution.source || 'website',
      landingPage: leadAttribution.landingPage || (location.pathname + location.hash),
      utmSource: leadAttribution.utmSource || '',
      utmMedium: leadAttribution.utmMedium || '',
      utmCampaign: leadAttribution.utmCampaign || '',
    };
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'กำลังส่งข้อมูล…';
    try {
      const r = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'ส่งข้อมูลไม่สำเร็จ');
      trackEvent('lead_submit', { crop: body.crop || '', source: body.source || 'website' });
      toast('ส่งข้อมูลเรียบร้อย ทีมงานจะติดต่อกลับเร็วที่สุด', 'ok');
      form.classList.add('is-success');
      form.innerHTML = leadSuccessHTML(body);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false; btn.textContent = 'ส่งข้อมูลให้ทีมงานติดต่อกลับ';
    }
    return;
  }
  if (e.target.id !== 'reviewForm') return;
  e.preventDefault();
  const f = e.target, fd = new FormData(f), rating = +fd.get('rating');
  if (!rating) { toast('เลือกจำนวนดาวก่อนครับ', 'err'); return; }
  const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
  try {
    const r = await api('/api/products/' + f.dataset.pid + '/reviews', { method: 'POST', body: JSON.stringify({ rating, comment: fd.get('comment') }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error || 'ผิดพลาด');
    toast('ขอบคุณสำหรับรีวิว!', 'ok'); render();
  } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
});

// ════════════════════════ Init ════════════════════════
(async function init() {
  captureAttribution();
  try { PRODUCTS = await (await fetch('/api/products')).json(); }
  catch { PRODUCTS = []; }
  await Promise.all([loadMe(), loadSite()]);
  applySite();
  renderSaleBanner();
  renderAccountNav();
  renderWishCount();
  renderCart();
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=20260625-3', { scope: '/' }).catch(() => {});
})();
