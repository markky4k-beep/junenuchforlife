# Multi-Tenant Storefront Plan

เอกสารนี้อธิบายฐานสถาปัตยกรรมสำหรับการเปิดหลายเว็บไซต์จาก codebase เดียว โดยใช้ดีไซน์เดียวกับเว็บหลัก แต่แยกข้อมูลร้าน/สินค้า/การตั้งค่าออกจากกันผ่าน `store_id`

## เป้าหมาย

- เปิดร้านใหม่ได้ทันทีผ่าน `subdomain`
- ใช้ frontend/backend ชุดเดียวกัน
- ให้สินค้าของร้านใหม่เริ่มต้นว่าง
- ให้ชื่อร้านและ site config เริ่มต้น clone จาก template หลักได้
- รองรับการต่อยอดเป็นหลายร้าน หลายผู้ดูแล หลาย LINE OA ในเฟสถัดไป

## Foundation ที่เพิ่มแล้ว

- ตาราง `stores`
- ตาราง `store_domains`
- ตาราง `store_settings`
- ตาราง `user_store_roles`
- คอลัมน์ `store_id` ในตารางหลัก พร้อม default เป็น `store_main`
- middleware resolve tenant จาก host แล้วเก็บไว้ใน `req.store`
- public API บางส่วนเริ่มรองรับ scope ตาม store แล้ว:
  - `/api/site`
  - `/api/site/content`
  - `/api/products`
  - `/api/products/:id`
- admin API ชุดแรก:
  - `GET /api/admin/stores`
  - `GET /api/admin/stores/check-subdomain`
  - `POST /api/admin/stores`

## วิธีทำงาน

1. ระบบดู host จาก request
2. ค้นหา host ใน `store_domains`
3. ถ้าพบ จะโหลด `store` และ `store_settings` ของร้านนั้น
4. ถ้าไม่พบ จะ fallback ไปที่ `default store`
5. หน้าเว็บ public จะใช้ค่า `store_settings` ทับ global defaults เฉพาะร้านนั้น
6. สินค้า public จะ filter ตาม `store_id`

## การสร้างร้านใหม่

เมื่อเรียก `POST /api/admin/stores`

ระบบจะ:

1. ตรวจ format ของ `subdomain`
2. เช็กว่าซ้ำหรือไม่
3. สร้าง row ใน `stores`
4. สร้าง row ใน `store_domains`
5. ผูกผู้สร้างเข้ากับ `user_store_roles`
6. clone ค่า `SITE_*` ปัจจุบันไปยัง `store_settings`
7. override ค่าเริ่มต้น เช่น `SITE_NAME`, `PUBLIC_URL`, hero copy

## สิ่งที่ยังเป็น Phase ถัดไป

- scope admin data ทั้งหมดตาม `store_id`
- store switcher ในหลังบ้าน
- CRUD store settings ผ่าน UI โดยเลือก store เป้าหมาย
- tenant-aware orders / leads / inbox / coupons / articles / reviews ทั้งหมด
- custom domain mapping
- per-store LINE OA / payment / SMTP config
- role matrix แบบ `owner`, `admin`, `chat_admin`, `staff`

## Rollout ที่แนะนำ

### Phase 1

- migrate schema
- เปิดใช้งาน default store
- เปิด admin API สำหรับสร้างร้าน
- เปิด wildcard subdomain ใน Vercel

### Phase 2

- ทำ store switcher ในหลังบ้าน
- scope admin products/settings ตาม store
- seed onboarding page สำหรับร้านใหม่

### Phase 3

- scope orders/inbox/leads/articles/coupons/reviews
- แยก LINE OA / payment config ต่อร้าน
- รองรับ custom domain

## ข้อควรระวัง

- ขณะนี้หลังบ้านยังเป็น global-admin เป็นหลัก
- store ใหม่สามารถเปิด public storefront ได้ แต่การจัดการเชิงลึกต่อร้านใน admin ยังต้องต่อ Phase 2
- product IDs ตอนนี้ยังเป็น global primary key ควรตั้ง convention ให้ไม่ชนกัน เช่น prefix ด้วย store slug ในเฟสถัดไป
