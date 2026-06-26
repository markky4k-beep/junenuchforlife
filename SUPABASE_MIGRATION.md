# Supabase Migration

ไฟล์นี้ใช้เป็น checklist สำหรับย้ายฐานข้อมูลจาก SQLite ไป Supabase แบบค่อยเป็นค่อยไป

## 1. ตั้งค่า env

เพิ่มค่าต่อไปนี้ใน `.env`

```env
DB_PROVIDER=sqlite
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

หมายเหตุ:
- `SUPABASE_PUBLISHABLE_KEY` ใช้ตรวจว่าโปรเจกต์เชื่อม Supabase ได้
- `SUPABASE_SERVICE_ROLE_KEY` จำเป็นสำหรับการย้ายข้อมูลและงานฝั่งเซิร์ฟเวอร์

## 2. สร้าง schema ใน Supabase

เปิด Supabase SQL Editor แล้วรันไฟล์:

`supabase/schema.sql`

ไฟล์นี้จะสร้างตารางหลักทั้งหมด:
- `orders`
- `messages`
- `users`
- `auth_tokens`
- `products`
- `settings`
- `reviews`
- `coupons`
- `leads`
- `articles`

## 3. ย้ายข้อมูลจาก SQLite

รันคำสั่ง:

```bash
npm run migrate:supabase
```

สคริปต์จะอ่านข้อมูลจาก:

`data/app.db`

แล้ว upsert ไปยัง Supabase ตามตารางที่สร้างไว้

### ถ้าไม่ต้องการใช้ Data API / key ฝั่ง server

สามารถ export ออกมาเป็นไฟล์ SQL เพื่อนำไปรันใน Supabase SQL Editor เองได้:

```bash
npm run export:supabase-sql
```

ไฟล์ที่จะได้:

`supabase/sqlite-export.sql`

ไฟล์นี้จะรวม:
- schema ของตาราง
- คำสั่ง upsert ข้อมูลทั้งหมดจาก SQLite
- คำสั่ง set sequence ของตารางที่ใช้ id แบบ auto increment

จากนั้นเปิด Supabase SQL Editor แล้ววางไฟล์นี้ไปรันได้เลย

ถ้าต้องการระบุ path ของ SQLite เอง:

```bash
SQLITE_DB_PATH=path/to/app.db npm run migrate:supabase
```

## 4. ตรวจสอบสถานะเซิร์ฟเวอร์

หลังตั้งค่า env แล้ว endpoint ต่อไปนี้จะแสดงสถานะ:

`/api/health`

โดยจะมีค่าเพิ่ม:
- `dbProvider`
- `supabaseConfigured`

## 5. ขั้นถัดไป

งานรอบนี้ยังเป็น `migration preparation` และ `data import`

รอบถัดไปควรทำ:
1. สร้าง db adapter สำหรับ `sqlite` / `supabase`
2. สลับ query หลักใน `server/db.js` ให้รองรับ Supabase
3. ย้าย uploads จาก local `/public/uploads` ไป Supabase Storage
4. วาง RLS policy สำหรับตาราง public/admin
