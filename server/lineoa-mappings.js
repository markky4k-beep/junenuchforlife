export { LINE_CUSTOMER_COMMAND_ALIASES } from './lineoa-menu-schema.js';

export const LINE_CUSTOMER_LEGACY_POSTBACK_ACTIONS = {
  'lineoa:web-room': 'web_room',
  'lineoa:menu': 'menu',
  customer_home: 'menu',
  customer_product_menu: 'products',
  customer_promo: 'products_promo',
  customer_tracking: 'track',
  customer_tracking_latest: 'track',
  customer_order_history: 'track',
  customer_member_zone: 'account',
  customer_member_guide: 'account',
  customer_contact: 'web_room',
  customer_question_prompt: 'web_room',
  customer_repeat_latest: 'track',
};

export const LINE_CUSTOMER_TRACKING_PREFIXES = [
  'customer_tracking_detail|',
];

export const LINE_CUSTOMER_WEB_REDIRECT_PREFIXES = [
  'customer_buy|',
  'customer_buy_package|',
  'customer_payment_select|',
];

export const LINE_CUSTOMER_WEB_REDIRECT_EXACT = [
  'customer_checkout_confirm',
  'customer_back_to_packages',
  'customer_back_to_address',
  'customer_use_saved_address',
  'customer_back_to_payment',
  'customer_back_to_bank',
  'customer_slip_prompt',
  'customer_retry_slip',
];

export const LINE_ADMIN_ORDER_ACTION_ALIASES = {
  paid: 'paid',
  preparing: 'preparing',
  shipped: 'shipped',
  delivered: 'delivered',
  cancelled: 'cancelled',
  'รับออเดอร์แล้ว': 'paid',
  'กำลังจัดส่ง': 'shipped',
  'จัดส่งสำเร็จ': 'delivered',
  'ยกเลิกออเดอร์': 'cancelled',
  'ยกเลิก': 'cancelled',
};

export const LINE_ADMIN_MENU_SUMMARY_KEYS = {
  order_history: { limit: 10 },
  awaiting_payment: { status: 'awaiting_payment', limit: 10 },
  verified_orders: { status: 'paid', limit: 10 },
};

export const LINE_ADMIN_MENU_URL_KEYS = {
  priority_dashboard: '/admin/orders',
  product_wizard: '/admin/products',
  catalog_manage: '/admin/products',
  collection_manage: '/admin/products',
  inventory: '/admin/products',
  frequent_buyers: '/admin/users',
  daily_summary: '/admin',
  monthly_summary: '/admin',
  access_users: '/admin/users',
  export: '/admin/orders',
  cancel_order: '/admin/orders',
};
