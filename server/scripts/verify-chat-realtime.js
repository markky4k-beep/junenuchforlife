import '../env.js';
import crypto from 'crypto';
import { createOrder, createToken, listUsers } from '../db.js';

const baseUrl = String(process.env.CHAT_VERIFY_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const wsUrl = baseUrl.replace(/^http/, 'ws') + '/socket.io/?EIO=4&transport=websocket';
const adminKey = String(process.env.ADMIN_ACCESS_KEY || '').trim();

class SocketIoWsClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.queue = [];
    this.waiters = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (event) => this.#handleFrame(String(event.data || '')));
    this.ws.addEventListener('error', (event) => this.#rejectAll(new Error(event?.message || 'websocket error')));
    this.ws.addEventListener('close', () => this.#rejectAll(new Error('websocket closed')));
    await this.waitFor((packet) => packet.type === 'engine-open', 6000);
    this.ws.send('40');
    await this.waitFor((packet) => packet.type === 'namespace-open', 6000);
    return this;
  }

  emit(eventName, payload = {}) {
    if (!this.ws) throw new Error('socket not connected');
    this.ws.send(`42${JSON.stringify([eventName, payload])}`);
  }

  async waitForEvent(eventName, predicate = () => true, timeoutMs = 6000) {
    return this.waitFor((packet) => packet.type === 'event' && packet.event === eventName && predicate(packet.payload), timeoutMs);
  }

  async waitFor(matcher, timeoutMs = 6000) {
    const existing = this.queue.find(matcher);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((entry) => entry.resolve !== resolve);
        reject(new Error(`timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push({
        resolve: (packet) => {
          clearTimeout(timer);
          resolve(packet);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        matcher,
      });
    });
  }

  close() {
    try { this.ws?.close(); } catch {}
  }

  #handleFrame(frame) {
    if (!frame) return;
    if (frame === '2') {
      this.ws?.send('3');
      return;
    }
    let packet = null;
    if (frame.startsWith('0')) {
      packet = { type: 'engine-open', payload: safeJson(frame.slice(1)) };
    } else if (frame === '40' || frame.startsWith('40{')) {
      packet = { type: 'namespace-open', payload: safeJson(frame.slice(2)) };
    } else if (frame.startsWith('42')) {
      const parsed = safeJson(frame.slice(2));
      if (Array.isArray(parsed) && parsed.length >= 1) {
        packet = { type: 'event', event: parsed[0], payload: parsed[1] };
      }
    } else if (frame.startsWith('44')) {
      packet = { type: 'error', payload: safeJson(frame.slice(2)) };
    }
    if (!packet) return;
    this.queue.push(packet);
    const matched = this.waiters.filter((entry) => {
      try {
        return entry.matcher(packet);
      } catch {
        return false;
      }
    });
    if (matched.length) {
      this.waiters = this.waiters.filter((entry) => !matched.includes(entry));
      matched.forEach((entry) => entry.resolve(packet));
    }
  }

  #rejectAll(error) {
    const pending = [...this.waiters];
    this.waiters = [];
    pending.forEach((entry) => entry.reject(error));
  }
}

function safeJson(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function httpJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || `${options.method || 'GET'} ${path} failed`);
  }
  return data;
}

function findSession(items = [], sessionId = '') {
  return Array.isArray(items)
    ? items.find((item) => String(item?.session_id || '').trim().toUpperCase() === String(sessionId || '').trim().toUpperCase())
    : null;
}

async function createAdminToken() {
  const users = await listUsers();
  const admin = users.find((user) => user?.role === 'admin');
  assert(admin, 'ไม่พบบัญชีแอดมินสำหรับทดสอบ');
  const token = crypto.randomBytes(16).toString('hex');
  await createToken(token, admin.id);
  return { token, admin };
}

async function seedLinkedOrder(sessionId) {
  const orderId = `CHATV-${sessionId.slice(-6)}`;
  await createOrder({
    id: orderId,
    items: [{ id: 'p1', name: 'นุชฟอร์ไลฟ์ 1', price: 450, qty: 1 }],
    total: 450,
    subtotal: 450,
    shipping: 0,
    discount: 0,
    coupon: '',
    customer: {
      name: 'ลูกค้าทดสอบแชต',
      phone: '0899999999',
      email: 'chat-verify@example.com',
      address: 'ทดสอบระบบ',
    },
    payment_method: 'promptpay',
    status: 'awaiting_payment',
    paid: false,
    payment_claimed: false,
    tracking: '',
    session_id: sessionId,
    stripe_session: '',
    user_id: '',
    access_token: crypto.randomBytes(12).toString('hex'),
    resources_reserved: false,
  });
  return orderId;
}

async function main() {
  const sessionId = `CHATV${crypto.randomBytes(4).toString('hex').toUpperCase()}`.slice(0, 12);
  const { token, admin } = await createAdminToken();
  const orderId = await seedLinkedOrder(sessionId);
  const customer = new SocketIoWsClient(wsUrl);
  const watcher = new SocketIoWsClient(wsUrl);
  await Promise.all([customer.connect(), watcher.connect()]);

  watcher.emit('chat:admin:watch', { token, adminKey });
  customer.emit('chat:join', { sessionId, name: 'ลูกค้าทดสอบแชต' });

  const [adminReady, customerReady] = await Promise.all([
    watcher.waitForEvent('chat:admin:ready'),
    customer.waitForEvent('chat:ready', (payload) => String(payload?.sessionId || '') === sessionId),
  ]);
  assert(adminReady.payload?.ok === true, 'admin socket ไม่พร้อม');
  assert(customerReady.payload?.sessionId === sessionId, 'customer socket join ไม่สำเร็จ');

  const customerText = `ทดสอบ realtime ${Date.now()}`;
  customer.emit('chat:message', { sessionId, text: customerText });

  const adminUpdate = await watcher.waitForEvent('chat:admin:update', (payload) => payload?.type === 'customer_message' && payload?.sessionId === sessionId, 8000);
  assert(adminUpdate.payload?.text === customerText, 'แอดมินไม่ได้รับข้อความลูกค้าแบบ realtime');

  const authHeaders = {
    Authorization: `Bearer ${token}`,
    ...(adminKey ? { 'X-Admin-Key': adminKey } : {}),
    'Content-Type': 'application/json',
  };

  const inboxBeforeRead = await httpJson(`/api/admin/inbox?page=1&limit=20&q=${encodeURIComponent(sessionId)}`, { headers: authHeaders });
  const inboxItem = findSession(inboxBeforeRead.items, sessionId);
  assert(inboxItem?.session_id === sessionId, 'หา session ใน inbox ไม่เจอ');
  assert(Number(inboxItem?.unreadCount || 0) >= 1, 'unread badge ไม่เพิ่มหลังลูกค้าส่งข้อความ');
  assert(inboxItem?.customerName === 'ลูกค้าทดสอบแชต', 'ชื่อผู้ใช้ไม่ผูกใน inbox');
  assert(inboxItem?.customerPhone === '0899999999', 'เบอร์ลูกค้าไม่ผูกใน inbox');
  assert(inboxItem?.order?.id === orderId, 'ห้องแชตไม่ผูกกับออเดอร์');

  const thread = await httpJson(`/api/admin/inbox/${encodeURIComponent(sessionId)}`, { headers: authHeaders });
  assert(Array.isArray(thread.messages) && thread.messages.some((message) => message?.text === customerText), 'เปิด thread แล้วไม่พบข้อความลูกค้า');

  const inboxAfterRead = await httpJson(`/api/admin/inbox?page=1&limit=20&q=${encodeURIComponent(sessionId)}`, { headers: authHeaders });
  const readItem = findSession(inboxAfterRead.items, sessionId);
  assert(Number(readItem?.unreadCount || 0) === 0, 'mark as read ไม่ทำงานหลังเปิดห้อง');

  const adminReplyText = `ตอบกลับ realtime ${Date.now()}`;
  const replyResponse = await httpJson(`/api/admin/inbox/${encodeURIComponent(sessionId)}/reply`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ text: adminReplyText }),
  });
  assert(replyResponse?.ok === true, 'ส่งตอบกลับจากแอดมินไม่สำเร็จ');

  const customerReply = await customer.waitForEvent('chat:message', (payload) => payload?.from === 'admin' && payload?.text === adminReplyText, 8000);
  assert(customerReply.payload?.text === adminReplyText, 'ลูกค้าไม่ได้รับข้อความแอดมินแบบ realtime');

  const poll = await httpJson(`/api/chat/poll?session=${encodeURIComponent(sessionId)}&after=0`);
  assert(Array.isArray(poll.messages) && poll.messages.some((message) => message?.from === 'admin' && message?.text === adminReplyText), 'fallback poll ไม่พบข้อความแอดมิน');

  customer.close();
  watcher.close();

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    sessionId,
    orderId,
    admin: { id: admin.id, email: admin.email },
    checks: [
      'websocket admin watch connected',
      'customer websocket joined',
      'customer -> admin realtime update',
      'unread badge incremented',
      'customer/order linkage resolved',
      'mark as read after opening thread',
      'admin -> customer realtime reply',
      'poll fallback still returns persisted reply',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error('[verify-chat-realtime] failed:', error?.message || error);
  process.exitCode = 1;
});
