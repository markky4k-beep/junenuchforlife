import { createOrderService } from '../order-service.js';

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

function clientOrder(order = {}) {
  return {
    id: order.id,
    total: order.total,
    status: order.status,
    payment_method: order.payment_method,
    paid: !!order.paid,
  };
}

async function main() {
  const orders = new Map();
  const paymentLogs = new Map();
  const adminMessages = [];
  const metaPatches = [];

  const products = [
    {
      id: 'p-set-1',
      name: 'เซต 1+2+9',
      active: true,
      stock: 20,
      price: 590,
    },
  ];

  const service = createOrderService({
    cfg(key) {
      if (key === 'PROMPTPAY_ID') return '0999999999';
      if (key === 'SITE_NAME') return 'Smoke Test Shop';
      return '';
    },
    stripeClient() {
      return null;
    },
    async createCardCheckoutSession() {
      return { id: 'stripe_test', url: 'https://example.com/checkout' };
    },
    async buildPromptPay(total) {
      const png = Buffer.from(`promptpay:${total}`).toString('base64');
      return {
        id: 'promptpay-test',
        qr: `data:image/png;base64,${png}`,
      };
    },
    reservationExpiresAt() {
      return Date.now() + 15 * 60 * 1000;
    },
    async listProductsByIds(ids = []) {
      return products.filter((item) => ids.includes(item.id));
    },
    effPrice(product) {
      return Number(product?.price || 0);
    },
    async evalCoupon() {
      return { ok: true, discount: 0, coupon: '' };
    },
    shippingFor() {
      return 0;
    },
    async reserveOrderResources() {},
    async releaseOrderResources() {},
    async createOrder(order) {
      const stored = {
        ...order,
        paid: !!order.paid,
        payment_claimed: !!order.payment_claimed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      orders.set(stored.id, stored);
      return stored;
    },
    async getOrder(orderId) {
      return orders.get(orderId) || null;
    },
    async updateOrder(orderId, patch = {}) {
      const current = orders.get(orderId);
      if (!current) return null;
      const next = { ...current, ...patch, updatedAt: Date.now() };
      orders.set(orderId, next);
      return next;
    },
    async getPaymentLog(orderId) {
      return paymentLogs.get(orderId) || null;
    },
    async upsertPaymentLog(orderId, payload = {}) {
      const next = { order_id: orderId, ...payload };
      paymentLogs.set(orderId, next);
      return next;
    },
    async markOrderPaid(orderId) {
      const current = orders.get(orderId);
      const next = { ...current, paid: true, status: 'paid', updatedAt: Date.now() };
      orders.set(orderId, next);
      return next;
    },
    async pushToAdmin(message) {
      adminMessages.push(String(message || ''));
    },
    async sendMail() {},
    orderEmailHTML(order) {
      return `<p>${order.id}</p>`;
    },
    siteValue() {
      return 'Smoke Test Shop';
    },
    async patchChatInboxMeta(sessionId, patch) {
      metaPatches.push({ sessionId, patch });
    },
    async emitAdminInboxUpdate() {},
    normalizeChatSessionId(value = '') {
      return String(value || '').trim().toUpperCase();
    },
    newOrderAccessToken() {
      return 'access-smoke-token';
    },
    async verifySlipWithSlipok() {
      return {
        success: true,
        verified: true,
        message: 'verified',
        amount: 590,
      };
    },
    normalizeSlipokResult(result = {}) {
      return {
        ok: result.success !== false,
        verified: !!result.verified,
        message: result.message || '',
        amount: result.amount || 0,
        raw: result,
        code: result.code || '',
      };
    },
    isSlipokManualReviewCode() {
      return false;
    },
    isSlipokVerificationFailureCode() {
      return false;
    },
    clientOrder,
    statusLabel: {
      awaiting_payment: 'รอชำระเงิน',
      paid: 'ชำระแล้ว',
    },
  });

  const checkout = await service.createCheckoutOrder({
    items: [{ id: 'p-set-1', qty: 1 }],
    customer: {
      name: 'ลูกค้าทดสอบ',
      phone: '0812345678',
      address: 'กรุงเทพมหานคร',
    },
    payment: 'promptpay',
    sessionId: 'line-smoke',
    channel: 'line_oa',
    lineUserId: 'U_SMOKE',
  });

  assert(checkout?.ok === true, 'create_checkout_failed', checkout);
  assert(checkout?.order?.payment_method === 'promptpay', 'wrong_payment_method', checkout);
  assert(checkout?.order?.line_user_id === 'U_SMOKE', 'missing_line_user_id', checkout?.order);

  const qrBuffer = await service.buildPromptPayQrBuffer(checkout.order.id);
  assert(Buffer.isBuffer(qrBuffer) && qrBuffer.length > 0, 'promptpay_qr_failed');

  const claim = await service.claimPayment(checkout.order.id);
  assert(claim?.alreadyPaid === false, 'claim_payment_failed', claim);

  const verify = await service.verifyPromptpaySlip({
    orderId: checkout.order.id,
    rawBase64: Buffer.from('slip-image').toString('base64'),
    slipMessageId: 'msg-smoke',
    source: 'line',
  });
  assert(verify?.verified === true, 'verify_slip_failed', verify);

  const client = await service.getClientOrderDetails(checkout.order.id);
  assert(client?.paid === true, 'client_order_not_paid', client);
  assert(paymentLogs.has(checkout.order.id), 'payment_log_missing');
  assert(adminMessages.length >= 2, 'admin_notifications_missing', adminMessages);
  assert(metaPatches.length >= 1, 'meta_patch_missing', metaPatches);

  console.log(JSON.stringify({
    ok: true,
    orderId: checkout.order.id,
    paid: client.paid,
    paymentLogStatus: paymentLogs.get(checkout.order.id)?.status || '',
    adminMessages: adminMessages.length,
    metaPatches: metaPatches.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    payload: error?.payload || null,
  }, null, 2));
  process.exit(1);
});
