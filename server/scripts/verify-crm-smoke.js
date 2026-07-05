// Smoke test: CRM/CDP endpoints + Recommendation API
// ต้องมีเซิร์ฟเวอร์รันอยู่ (BASE_URL, ดีฟอลต์ http://localhost:3100)
import '../env.js';
import crypto from 'crypto';
import { createUser, deleteUser, createToken, deleteToken } from '../db.js';
import { hashPassword, newToken } from '../auth.js';

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

async function main() {
  const stamp = Date.now().toString(36);
  const userId = `crm_smoke_admin_${stamp}`;
  const token = newToken();
  const { salt, hash } = hashPassword(crypto.randomBytes(8).toString('hex'));
  const cleanups = [];
  try {
    await createUser({ id: userId, email: `${userId}@test.local`, name: 'CRM Smoke Admin', role: 'admin', salt, hash });
    cleanups.push(() => deleteUser(userId));
    await createToken(token, userId, 10 * 60 * 1000);
    cleanups.push(() => deleteToken(token));
    const adminGet = (path) => fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } });

    // 1) รายชื่อลูกค้ารวมศูนย์
    const customersRes = await adminGet('/api/admin/customers?limit=20');
    const customers = await customersRes.json();
    assert(customersRes.ok && customers.ok === true, `customers endpoint failed: ${customersRes.status}`, customers);
    assert(Array.isArray(customers.customers), 'customers must be an array');
    assert(customers.segmentLabels && typeof customers.segmentLabels === 'object', 'segmentLabels missing');
    const sample = customers.customers[0];
    if (sample) {
      assert(typeof sample.segment === 'string' && sample.key, 'profile shape invalid', sample);
    }

    // 2) กรองด้วย segment ต้องไม่พัง
    const vipRes = await adminGet('/api/admin/customers?segment=vip&limit=5');
    const vip = await vipRes.json();
    assert(vipRes.ok && Array.isArray(vip.customers), 'segment filter failed', vip);
    assert(vip.customers.every((c) => c.segment === 'vip'), 'segment filter leaked other segments');

    // 3) คิวติดตามวันนี้
    const followRes = await adminGet('/api/admin/customers/follow-ups');
    const follow = await followRes.json();
    assert(followRes.ok && follow.ok === true && Array.isArray(follow.items), 'follow-ups endpoint failed', follow);
    assert(follow.items.every((item) => item.title && item.type), 'follow-up item shape invalid');

    // 4) Recommendation API (public)
    const products = await (await fetch(`${BASE_URL}/api/products`)).json();
    assert(Array.isArray(products) && products.length, 'no products to test recommendations');
    const pid = products[0].id;
    const recoRes = await fetch(`${BASE_URL}/api/products/${encodeURIComponent(pid)}/recommendations?limit=4`);
    const reco = await recoRes.json();
    assert(recoRes.ok && Array.isArray(reco.items), 'recommendations endpoint failed', reco);
    assert(reco.items.every((item) => item.id && item.id !== pid && item.recoReason), 'recommendation items invalid', reco.items?.[0]);

    // 5) ต้องไม่หลุดให้คนไม่มีสิทธิ์
    const anonRes = await fetch(`${BASE_URL}/api/admin/customers`);
    assert([401, 403, 404].includes(anonRes.status), `unauthenticated access must be denied, got ${anonRes.status}`);

    console.log(JSON.stringify({
      ok: true,
      profiles: customers.totalProfiles || customers.customers.length,
      followUps: follow.items.length,
      recommendationsFor: pid,
      recommendations: reco.items.length,
      authGuarded: true,
    }, null, 2));
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, payload: err.payload || null }, null, 2));
  process.exit(1);
});
