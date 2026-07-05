// ทดสอบว่า PUT /api/admin/settings ที่เลือกร้านย่อย (x-store-id) เขียนเฉพาะ override ของร้านนั้น
// และ "ต้องไม่" กระทบค่ากลางของร้านหลัก — กัน regression ของบั๊กแชร์ลิงก์ข้ามร้าน
// ต้องมีเซิร์ฟเวอร์รันอยู่ (BASE_URL, ดีฟอลต์ http://localhost:3100)
import '../env.js';
import crypto from 'crypto';
import {
  createUser, deleteUser, createToken, deleteToken,
  createStore, deleteStoreCascade, getSetting, setSetting, getStoreSetting, setStoreSetting,
} from '../db.js';
import { hashPassword, newToken } from '../auth.js';

const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3100').replace(/\/+$/, '');
const TEST_KEY = 'SITE_SHARE_TITLE';

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

async function main() {
  const stamp = Date.now().toString(36);
  const storeId = `store_iso_settings_${stamp}`;
  const userId = `iso_settings_admin_${stamp}`;
  const token = newToken();
  const { salt, hash } = hashPassword(crypto.randomBytes(8).toString('hex'));

  const cleanups = [];
  try {
    await createUser({ id: userId, email: `${userId}@test.local`, name: 'ISO Settings Admin', role: 'admin', salt, hash });
    cleanups.push(() => deleteUser(userId));
    await createToken(token, userId, 10 * 60 * 1000);
    cleanups.push(() => deleteToken(token));
    await createStore({ id: storeId, name: `ISO Settings ${stamp}`, slug: storeId, subdomain: `iso-settings-${stamp}` });
    cleanups.push(() => deleteStoreCascade(storeId));

    const globalBefore = String(await getSetting(TEST_KEY) ?? '');
    const marker = `ISOLATION_${stamp}`;

    const put = (storeHeader) => fetch(`${BASE_URL}/api/admin/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'x-store-id': storeHeader,
      },
      body: JSON.stringify({ settings: { [TEST_KEY]: marker } }),
    });

    // 1) บันทึกโดยเลือกร้านย่อย → ต้องเป็น store override เท่านั้น
    const res = await put(storeId);
    const data = await res.json().catch(() => ({}));
    assert(res.ok, `PUT settings (store) failed: ${res.status}`, data);
    assert(data.storeScoped === true, 'response must be storeScoped for sub-store', data);
    assert(String(data.storeId) === storeId, 'storeScoped response targets wrong store', data);

    const storeValue = String(await getStoreSetting(storeId, TEST_KEY) ?? '');
    assert(storeValue === marker, 'store override was not written', { storeValue });

    const globalAfter = String(await getSetting(TEST_KEY) ?? '');
    assert(globalAfter === globalBefore, 'GLOBAL setting changed by sub-store save — cross-store leak!', {
      globalBefore, globalAfter,
    });

    // 2) เคลียร์ override (ส่งค่าว่าง) → กลับไป inherit ค่ากลาง
    const resClear = await fetch(`${BASE_URL}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-store-id': storeId },
      body: JSON.stringify({ settings: { [TEST_KEY]: '' } }),
    });
    assert(resClear.ok, 'clearing store override failed');
    const clearedValue = String(await getStoreSetting(storeId, TEST_KEY) ?? '');
    assert(clearedValue === '', 'store override was not cleared', { clearedValue });

    console.log(JSON.stringify({
      ok: true,
      storeId,
      storeScopedWrite: true,
      globalUntouched: true,
      overrideCleared: true,
    }, null, 2));
  } finally {
    await setStoreSetting(storeId, TEST_KEY, '').catch(() => {});
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, payload: err.payload || null }, null, 2));
  process.exit(1);
});
