# Production Hardening Checklist

ใช้ checklist นี้ก่อน deploy หรือหลังเปิดร้านใหม่ใน production

## Rotate Secrets

- Rotate Supabase service role key ที่เคยถูกส่งในแชตหรือแชร์นอกระบบ แล้วอัปเดต `SUPABASE_SERVICE_ROLE_KEY` ใน Vercel ทันที
- Rotate Vercel API token แล้วจำกัด scope เฉพาะ project/team ที่ใช้ deploy
- ตั้ง `SESSION_SIGNING_SECRET` แยกจาก `ADMIN_ACCESS_KEY`
- เปลี่ยน `ADMIN_ACCESS_KEY` หลังจบงาน deploy และหลังสร้าง admin คนใหม่
- ตรวจว่า secret ฝั่งร้าน เช่น LINE, PromptPay, SMTP ถูกตั้งใน per-store settings เฉพาะร้านที่ต้องใช้
- ห้ามใส่ secret ลง git, docs, screenshot หรือ issue tracker

## Wildcard And Custom Domain

- DNS root/apex ชี้ Vercel: `A @ 76.76.21.21`
- DNS `www` ชี้ Vercel: `CNAME www cname.vercel-dns.com`
- ถ้าจะเปิดร้านด้วย subdomain อัตโนมัติ ให้เพิ่ม wildcard DNS: `CNAME * cname.vercel-dns.com`
- ตรวจใน Vercel ว่า domain หลักและ wildcard/custom domain verified แล้ว
- ถ้าใช้ domain เฉพาะร้าน ให้บันทึก domain mapping ใน Store Manager และกด retry provision หากยัง pending
- ทดสอบ public URL ของแต่ละร้านว่า `/api/site`, `/api/products`, checkout และ inbox ใช้ข้อมูลร้านนั้นจริง

## Backup And Migration

- ก่อน apply migration ให้ export schema และ backup ตารางหลักใน Supabase
- Apply migration ตามลำดับ: `003_multi_tenant_foundation.sql`, `004_store_database_registry.sql` และ migration ใหม่ในอนาคต
- ตรวจคอลัมน์ `store_id` ใน `products`, `orders`, `reviews`, `leads`, `messages`, `articles`, `coupons`, `store_settings`
- ตรวจ default store (`store_main`) ว่ามีข้อมูลเดิมครบหลัง migration
- รัน `npm run verify:multistore` กับ production preview ก่อนเปิดใช้งานจริง
- เก็บผล smoke test, migration timestamp, Vercel deployment URL และ Supabase backup timestamp ไว้ใน release note

## Smoke Test Command

```bash
npm run verify:release
```

Release verification runs build, hard-isolation audit, community smoke, order-service smoke, and LINE OA runtime smoke.

For full live multi-store smoke, run against a preview/production URL with admin credentials:

```bash
BASE_URL=https://your-preview-or-production-url \
ADMIN_EMAIL=admin@example.com \
ADMIN_PASSWORD=your-password \
ADMIN_KEY=your-admin-key \
npm run verify:multistore
```

Smoke test จะสร้างร้านใหม่, เพิ่มสินค้าในร้านนั้น, สั่งซื้อ, ติดตามออเดอร์ และตรวจ inbox ที่ scoped ตาม `store_id`

## Store Backup / Restore

- Export per-store backup from Store Manager before large edits or deploy.
- Restore is intentionally safe by default: paste JSON and run dry-run first.
- Apply restore only after dry-run summary is correct.
- Restore upserts only store settings, products, articles, and coupons.
- Restore does not overwrite orders, leads, customers, or payment logs.
- After restore, run `npm run verify:hard-isolation` and test storefront checkout manually for that store.

## LINE OA Operations

- Check Diagnostics > LINE Rich Menu before deploy.
- Deploy rich menu from Diagnostics only when LINE token and both Home/Catalog assets are ready.
- Confirm aliases `line-home` and `line-catalog` exist after deploy.
- Watch Diagnostics > LINE Webhook for failed events after rich menu deploy.
- Keep `LINE_ADMIN_USER_ID` or bound LINE admins ready so system alerts reach an admin.
