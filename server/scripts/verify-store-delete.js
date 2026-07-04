// ทดสอบ DELETE /api/admin/stores/:id — ลบร้านย่อยพร้อมข้อมูล tenant ทั้งหมด
// ต้องยืนยันด้วย subdomain, ห้ามลบร้านหลัก, ข้อมูลร้านอื่นต้องไม่หาย
// ต้องมีเซิร์ฟเวอร์รันอยู่ (BASE_URL, ดีฟอลต์ http://localhost:3100)
import '../env.js';
import crypto from 'crypto';
import {
  createUser, deleteUser, createToken, deleteToken,
  createStore, getStore, setStoreSetting, allStoreSettings,
  createProduct, listProducts,
} from '../db.js';
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
  const storeId = `store_iso_delete_${stamp}`;
  const subdomain = `iso-delete-${stamp}`;
  const keepStoreId = `store_iso_keep_${stamp}`;
  const userId = `iso_delete_admin_${stamp}`;
  const token = newToken();
  const { salt, hash } = hashPassword(crypto.randomBytes(8).toString('hex'));
  const cleanups = [];

  const del = (id, confirm) => fetch(`${BASE_URL}/api/admin/stores/${encodeURIComponent(id)}${confirm !== undefined ? `?confirm=${encodeURIComponent(confirm)}` : ''}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });

  try {
    await createUser({ id: userId, email: `${userId}@test.local`, name: 'ISO Delete Admin', role: 'admin', salt, hash });
    cleanups.push(() => deleteUser(userId));
    await createToken(token, userId, 10 * 60 * 1000);
    cleanups.push(() => deleteToken(token));

    await createStore({ id: storeId, name: `ISO Delete ${stamp}`, slug: storeId, subdomain });
    await createStore({ id: keepStoreId, name: `ISO Keep ${stamp}`, slug: keepStoreId, subdomain: `iso-keep-${stamp}` });
    await setStoreSetting(storeId, 'SITE_NAME', 'ร้านที่จะถูกลบ');
    await setStoreSetting(keepStoreId, 'SITE_NAME', 'ร้านที่ต้องรอด');
    await createProduct({ storeId, id: `iso_del_p_${stamp}`, name: 'Delete Me', price: 10, stock: 1, active: true });
    await createProduct({ storeId: keepStoreId, id: `iso_keep_p_${stamp}`, name: 'Keep Me', price: 10, stock: 1, active: true });

    // 1) ไม่ยืนยัน → 400
    assert((await del(storeId)).status === 400, 'delete without confirm must be rejected');
    // 2) ยืนยันผิด → 400
    assert((await del(storeId, 'wrong-word')).status === 400, 'delete with wrong confirm must be rejected');
    // 3) ลบร้านหลัก → 400
    assert((await del('store_main', 'store_main')).status === 400, 'default store must never be deletable');
    // 4) ยืนยันถูกต้อง → ลบสำเร็จ
    const ok = await del(storeId, subdomain);
    const okData = await ok.json().catch(() => ({}));
    assert(ok.ok && okData.ok === true, `valid delete failed: ${ok.status}`, okData);

    assert(!(await getStore(storeId)), 'store row still exists after delete');
    const settingsAfter = await allStoreSettings(storeId).catch(() => ({}));
    assert(!Object.keys(settingsAfter).length, 'store settings still exist after delete', settingsAfter);
    const productsAfter = await listProducts(true, { storeId });
    assert(!productsAfter.length, 'store products still exist after delete', productsAfter.map((p) => p.id));

    // 5) ร้านอื่นต้องไม่โดนหางเลข
    assert(await getStore(keepStoreId), 'unrelated store was deleted!');
    const keepSettings = await allStoreSettings(keepStoreId);
    assert(keepSettings.SITE_NAME === 'ร้านที่ต้องรอด', 'unrelated store settings were damaged', keepSettings);
    const keepProducts = await listProducts(true, { storeId: keepStoreId });
    assert(keepProducts.length === 1, 'unrelated store products were damaged');

    // เก็บกวาดร้าน keep ด้วย endpoint จริง (ทดสอบซ้ำอีกรอบไปในตัว)
    const cleanupRes = await del(keepStoreId, `iso-keep-${stamp}`);
    assert(cleanupRes.ok, 'cleanup delete of keep store failed');

    console.log(JSON.stringify({
      ok: true,
      rejectsWithoutConfirm: true,
      rejectsWrongConfirm: true,
      protectsDefaultStore: true,
      cascadeDeleted: okData.cascade?.cleared?.length || 0,
      unrelatedStoreUntouched: true,
    }, null, 2));
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message, payload: err.payload || null }, null, 2));
  process.exit(1);
});
