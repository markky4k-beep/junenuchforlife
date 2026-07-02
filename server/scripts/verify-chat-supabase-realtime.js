import '../env.js';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { createOrder, createToken, listUsers } from '../db.js';
import { supabaseEnv } from '../supabase-client.js';

const baseUrl = String(process.env.CHAT_VERIFY_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const { url: supabaseUrl, publishableKey } = supabaseEnv();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizedSessionId(value = '') {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

async function httpJson(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `${options.method || 'GET'} ${path} failed`);
  return data;
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
  const orderId = `SBRT-${sessionId.slice(-6)}`;
  await createOrder({
    id: orderId,
    items: [{ id: 'p1', name: 'นุชฟอร์ไลฟ์ 1', price: 450, qty: 1 }],
    total: 450,
    subtotal: 450,
    shipping: 0,
    discount: 0,
    coupon: '',
    customer: {
      name: 'ลูกค้าทดสอบรีลไทม์',
      phone: '0811111111',
      email: 'supabase-realtime@example.com',
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

async function subscribeBroadcast(channelName, eventName, predicate = () => true) {
  assert(supabaseUrl && publishableKey, 'ยังไม่ได้ตั้งค่า Supabase public env สำหรับ verify realtime');
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const channel = client.channel(channelName, { config: { broadcast: { self: false } } });
  const queue = [];
  const waiters = [];
  channel.on('broadcast', { event: eventName }, ({ payload } = {}) => {
    const nextPayload = payload || {};
    if (!predicate(nextPayload)) return;
    if (waiters.length) {
      const waiter = waiters.shift();
      waiter(nextPayload);
      return;
    }
    queue.push(nextPayload);
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`subscribe ${channelName} timeout`)), 8000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        clearTimeout(timer);
        reject(new Error(`subscribe ${channelName} failed: ${status}`));
      }
    });
  });
  const next = (timeoutMs = 8000) => new Promise((resolve, reject) => {
    if (queue.length) {
      resolve(queue.shift());
      return;
    }
    const timer = setTimeout(() => reject(new Error(`wait ${eventName} timeout on ${channelName}`)), timeoutMs);
    waiters.push((payload) => {
      clearTimeout(timer);
      resolve(payload || {});
    });
  });
  return {
    ready,
    next,
    async close() {
      try { await channel.unsubscribe(); } catch {}
      try { client.removeChannel(channel); } catch {}
    },
  };
}

async function main() {
  const sessionId = normalizedSessionId(`SBRT${crypto.randomBytes(4).toString('hex')}`);
  const { token } = await createAdminToken();
  const orderId = await seedLinkedOrder(sessionId);
  const adminHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const adminInbox = await subscribeBroadcast('realtime:admin:inbox', 'inbox_update', (payload) => payload?.sessionId === sessionId);
  const customerRoom = await subscribeBroadcast(`realtime:chat:${sessionId}`, 'admin_message', (payload) => payload?.text);
  await Promise.all([adminInbox.ready, customerRoom.ready]);

  const customerText = `supabase realtime ${Date.now()}`;
  await httpJson('/api/chat/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, name: 'ลูกค้าทดสอบรีลไทม์', text: customerText }),
  });

  const adminUpdate = await adminInbox.next();
  assert(adminUpdate?.type === 'customer_message', 'admin inbox ไม่ได้รับ broadcast จากข้อความลูกค้า');

  const inbox = await httpJson(`/api/admin/inbox?page=1&limit=20&q=${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
  const item = (inbox.items || []).find((entry) => normalizedSessionId(entry?.session_id) === sessionId);
  assert(item?.order?.id === orderId, 'ห้องแชตไม่ผูก order บน inbox');
  assert(item?.customerName === 'ลูกค้าทดสอบรีลไทม์', 'customer name ไม่ขึ้นใน inbox');
  assert(item?.customerPhone === '0811111111', 'customer phone ไม่ขึ้นใน inbox');
  assert(Number(item?.unreadCount || 0) >= 1, 'unread badge ไม่เพิ่ม');

  const replyText = `reply via supabase ${Date.now()}`;
  await httpJson(`/api/admin/inbox/${encodeURIComponent(sessionId)}/reply`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ text: replyText }),
  });

  const customerMessage = await customerRoom.next();
  assert(customerMessage?.text === replyText, 'ลูกค้าไม่ได้รับ admin_message ผ่าน Supabase Realtime');

  const poll = await httpJson(`/api/chat/poll?session=${encodeURIComponent(sessionId)}&after=0`);
  assert((poll.messages || []).some((message) => message?.text === replyText), 'fallback poll ไม่พบข้อความแอดมิน');

  await adminInbox.close();
  await customerRoom.close();

  console.log(JSON.stringify({
    ok: true,
    baseUrl,
    sessionId,
    orderId,
    checks: [
      'customer message triggers admin inbox broadcast',
      'admin inbox still resolves unread and order linkage',
      'admin reply triggers customer Supabase Realtime broadcast',
      'poll fallback still works',
    ],
  }, null, 2));
}

main().catch((error) => {
  console.error('[verify-chat-supabase-realtime] failed:', error?.message || error);
  process.exitCode = 1;
});
