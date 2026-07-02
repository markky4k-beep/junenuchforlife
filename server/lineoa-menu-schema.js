export const LINE_CUSTOMER_COMMAND_ALIASES = {
  menu: ['menuddd'],
  products: ['productsddd'],
  products_sets: ['setsddd', 'packsddd'],
  products_small: ['smallddd'],
  products_large: ['largeddd'],
  products_promo: ['promoddd'],
  reviews: ['reviewsddd'],
  track: ['trackddd'],
  articles: ['articlesddd'],
  about: ['aboutddd'],
  web_room: ['chatddd', 'webroomddd', 'supportddd'],
  account: ['accountddd', 'memberddd'],
};

export const LINE_HOME_MENU_TILES = [
  {
    title: 'สั่งซื้อสินค้า',
    subtitle: 'เลือกชุดที่ต้องการ',
    emoji: '🛍️',
    data: 'customer_product_menu',
  },
  {
    title: 'ติดตามออเดอร์',
    subtitle: 'ดูสถานะล่าสุด',
    emoji: '📋',
    data: 'customer_tracking',
  },
  {
    title: 'โปรโมชันวันนี้',
    subtitle: 'รวมชุดคุ้มพร้อมซื้อ',
    emoji: '🎯',
    data: 'customer_promo',
  },
  {
    title: 'สมัครสมาชิก',
    subtitle: 'สมัครใช้งานและดูสิทธิ์',
    emoji: '🪪',
    data: 'customer_member_zone',
  },
];

export const LINE_HOME_BOTTOM_ACTIONS = [
  {
    label: 'ติดต่อแอดมิน',
    data: 'customer_contact',
    backgroundColor: '#D8E7D8',
    textColor: '#2D5A40',
    borderColor: '#B7D0BE',
  },
  {
    label: 'สั่งซ้ำล่าสุด',
    data: 'customer_repeat_latest',
    backgroundColor: '#E6E6E8',
    textColor: '#4C5164',
    borderColor: '#D4D8E0',
  },
];

export const LINE_PRODUCT_COLLECTIONS = [
  {
    key: 'sets',
    title: 'ชุดเซต',
    subtitle: 'รวมชุดที่เลือกง่ายและพร้อมสั่งซื้อ',
  },
  {
    key: 'small',
    title: 'ขวดเล็ก',
    subtitle: 'เหมาะกับการเริ่มลองและใช้งบเบา',
  },
  {
    key: 'large',
    title: 'ขวดใหญ่',
    subtitle: 'เหมาะกับลูกค้าที่ใช้ต่อเนื่องหรือพื้นที่มากขึ้น',
  },
  {
    key: 'promo',
    title: 'โปรโมชัน',
    subtitle: 'รวมชุดคุ้มและราคาพิเศษล่าสุด',
  },
];

export const LINE_CHECKOUT_PAYMENT_OPTIONS = [
  {
    key: 'promptpay',
    label: 'โอนพร้อมสลิป',
    detail: 'โอน: ส่งสลิปในแชตนี้',
    postback: 'customer_payment_select|โอนเงินพร้อมสลิป',
  },
  {
    key: 'card',
    label: 'ชำระด้วยบัตร',
    detail: 'บัตร: เปิดหน้าชำระของร้าน',
    postback: 'customer_payment_select|ชำระด้วยบัตร',
  },
];

export function resolveLineCollectionKey(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  const found = LINE_PRODUCT_COLLECTIONS.find((item) => item.key === normalized || item.title === value);
  return found?.key || '';
}

export function getLineCollectionMeta(value = '') {
  const key = resolveLineCollectionKey(value) || String(value || '').trim().toLowerCase();
  return LINE_PRODUCT_COLLECTIONS.find((item) => item.key === key) || null;
}

export function normalizeLinePaymentMethod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'promptpay' || normalized === 'โอนเงินพร้อมสลิป') return 'promptpay';
  if (normalized === 'card' || normalized === 'ชำระด้วยบัตร') return 'card';
  return '';
}

export function linePaymentMethodLabel(value = '') {
  const method = normalizeLinePaymentMethod(value);
  return LINE_CHECKOUT_PAYMENT_OPTIONS.find((item) => item.key === method)?.label || '';
}
