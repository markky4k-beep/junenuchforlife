import crypto from 'crypto';
import { createLineRuntime } from '../lineoa-runtime.js';

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

function sign(secret, bodyBuffer) {
  return crypto.createHmac('SHA256', secret).update(bodyBuffer).digest('base64');
}

async function main() {
  const lineSecret = 'line-secret-smoke';
  const metaMap = {};
  const fetchCalls = [];
  const products = [
    {
      id: 'p-set-1',
      name: 'เซต 1+2+9',
      short: 'ชุดเด่นพร้อมสั่งซื้อ',
      tag: 'ชุดเซต',
      image: 'https://example.com/product.png',
      active: true,
      stock: 30,
      price: 590,
      extra: { category: 'sets' },
    },
  ];
  const orders = [
    {
      id: 'VYU-SMOKE1',
      items: [{ id: 'p-set-1', name: 'เซต 1+2+9', qty: 1 }],
      total: 590,
      customer: { name: 'ลูกค้าทดสอบ', phone: '0812345678', address: 'กรุงเทพมหานคร' },
      payment_method: 'promptpay',
      status: 'awaiting_payment',
      paid: false,
      payment_claimed: false,
      line_user_id: 'U_SMOKE',
      accessToken: 'access-order-smoke',
      createdAt: Date.now(),
    },
  ];

  global.fetch = async (url, options = {}) => {
    fetchCalls.push({
      url: String(url || ''),
      body: options?.body ? JSON.parse(String(options.body)) : null,
    });
    return {
      ok: true,
      headers: {
        get(name) {
          return String(name || '').toLowerCase() === 'content-type' ? 'application/json' : null;
        },
      },
      async text() {
        return '';
      },
      async arrayBuffer() {
        return new ArrayBuffer(0);
      },
    };
  };

  const runtime = createLineRuntime({
    crypto,
    lineChannelAccessToken() {
      return 'line-access-token-smoke';
    },
    lineChannelSecret() {
      return lineSecret;
    },
    async listProducts() {
      return products;
    },
    publicBaseUrl() {
      return 'https://www.junenuchforlife.com';
    },
    lineWebRoomEntryUrl({ sessionId }) {
      return `https://www.junenuchforlife.com/line-room/${sessionId}`;
    },
    async syncLineInboxSession(source = {}, info = {}) {
      const userId = String(source?.userId || 'UNKNOWN').trim();
      const sessionId = `LINE-${userId}`;
      metaMap[sessionId] = metaMap[sessionId] || {};
      if (info?.metaPatch && typeof info.metaPatch === 'object') {
        metaMap[sessionId] = { ...metaMap[sessionId], ...info.metaPatch };
      }
      return {
        sessionId,
        displayName: 'ลูกค้าทดสอบ',
        metaPatch: metaMap[sessionId],
      };
    },
    async patchChatInboxMeta(sessionId, patch = {}) {
      metaMap[sessionId] = { ...(metaMap[sessionId] || {}), ...patch };
    },
    lineChatMode() {
      return 'line_reply';
    },
    lineChatModeWebRoom: 'web_room',
    chatInboxMetaMap() {
      return metaMap;
    },
    async routeCustomerMessage() {},
    async emitAdminInboxUpdate() {},
    async listOrders() {
      return orders;
    },
    statusLabel: {
      awaiting_payment: 'รอชำระเงิน',
      paid: 'ชำระแล้ว',
    },
    async applyOrderAction() {},
    adminUserId() {
      return 'U_ADMIN';
    },
    async handleAdminMessage() {},
    async ensureSettingsFresh() {},
    async ensureLineWebhookEventIdempotency(event = {}) {
      return {
        duplicate: false,
        eventKey: String(event?.webhookEventId || `${event?.type || 'event'}-smoke`).trim(),
      };
    },
    async recordLineWebhookAudit() {},
    async recordSystemEvent() {},
    async createCheckoutOrder(payload = {}) {
      return {
        ok: true,
        order: {
          id: 'VYU-CHECKOUT1',
          total: 590,
          payment_method: payload.payment === 'card' ? 'card' : 'promptpay',
        },
        accessToken: 'access-checkout-1',
        checkoutUrl: 'https://example.com/checkout',
      };
    },
    async claimOrderPayment(orderId) {
      return { alreadyPaid: false, order: { id: orderId } };
    },
    async verifyOrderSlip() {
      return { verified: true };
    },
    buildPromptPayQrUrl(orderId, accessToken) {
      return `https://www.junenuchforlife.com/api/orders/${orderId}/promptpay-qr?access=${accessToken}`;
    },
    logger: console,
  });

  async function runEvent(event) {
    const body = Buffer.from(JSON.stringify({ destination: 'smoke', events: [event] }), 'utf8');
    const signature = sign(lineSecret, body);
    const resState = { statusCode: 0, ended: false };
    const req = {
      body,
      headers: {
        'x-line-signature': signature,
      },
    };
    const res = {
      status(code) {
        resState.statusCode = code;
        return this;
      },
      end() {
        resState.ended = true;
        return this;
      },
    };
    await runtime.handleLineWebhookRequest(req, res);
    return resState;
  }

  const menuEvent = {
    type: 'message',
    replyToken: 'reply-menu',
    timestamp: Date.now(),
    source: { type: 'user', userId: 'U_SMOKE' },
    message: { id: 'm1', type: 'text', text: 'menuddd' },
    webhookEventId: 'event-menu',
  };
  const menuResult = await runEvent(menuEvent);
  assert(menuResult.statusCode === 200, 'menu_status_not_200', menuResult);

  const productMenuEvent = {
    type: 'postback',
    replyToken: 'reply-products',
    timestamp: Date.now(),
    source: { type: 'user', userId: 'U_SMOKE' },
    postback: { data: 'customer_product_menu' },
    webhookEventId: 'event-products',
  };
  const productsResult = await runEvent(productMenuEvent);
  assert(productsResult.statusCode === 200, 'product_menu_status_not_200', productsResult);

  const buyEvent = {
    type: 'postback',
    replyToken: 'reply-buy',
    timestamp: Date.now(),
    source: { type: 'user', userId: 'U_SMOKE' },
    postback: { data: 'customer_buy_package|p-set-1|เซต 1+2+9' },
    webhookEventId: 'event-buy',
  };
  const buyResult = await runEvent(buyEvent);
  assert(buyResult.statusCode === 200, 'buy_status_not_200', buyResult);

  const trackEvent = {
    type: 'postback',
    replyToken: 'reply-track',
    timestamp: Date.now(),
    source: { type: 'user', userId: 'U_SMOKE' },
    postback: { data: 'customer_tracking' },
    webhookEventId: 'event-track',
  };
  const trackResult = await runEvent(trackEvent);
  assert(trackResult.statusCode === 200, 'track_status_not_200', trackResult);

  const replyCalls = fetchCalls.filter((item) => item.url.includes('/v2/bot/message/reply'));
  assert(replyCalls.length >= 4, 'reply_calls_missing', fetchCalls);

  console.log(JSON.stringify({
    ok: true,
    checked: {
      menu: menuResult.statusCode,
      productMenu: productsResult.statusCode,
      buy: buyResult.statusCode,
      track: trackResult.statusCode,
    },
    replyCalls: replyCalls.length,
    metaKeys: Object.keys(metaMap),
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
