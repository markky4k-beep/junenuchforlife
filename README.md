# POD Store — เว็บขายสินค้า + Live Chat เชื่อม LINE OA

เว็บไซต์ร้านค้าออนไลน์ พร้อมระบบ Live Chat ที่เชื่อมกับ LINE Official Account
ลูกค้าพิมพ์ในเว็บ → เด้งเข้า LINE OA ของแอดมิน → แอดมินตอบใน LINE → ข้อความขึ้นในเว็บแบบเรียลไทม์

> ⚠️ **กฎหมาย:** ใช้สำหรับการขายในประเทศที่ถูกกฎหมายเท่านั้น และต้องมีระบบยืนยันอายุ/ใบอนุญาตตามกฎหมายปลายทาง
> การจำหน่าย/นำเข้าบุหรี่ไฟฟ้าในประเทศไทยผิดกฎหมาย

---

## โครงสร้าง

```
POD/
├─ server/
│  ├─ index.js         ← Backend: Express + Socket.IO + LINE/Stripe webhook + API
│  ├─ db.js            ← SQLite (orders + messages) ผ่าน better-sqlite3
│  └─ promptpay.js     ← สร้าง payload PromptPay QR (มาตรฐาน EMVCo)
├─ public/             ← หน้าเว็บ (SPA + chat widget)
│  ├─ index.html       ← app shell (nav / ตะกร้า / แชต คงอยู่ทุกหน้า)
│  ├─ styles.css
│  └─ app.js           ← router + ทุกหน้า + ระบบสั่งซื้อ/ชำระเงิน/ติดตาม
├─ data/app.db         ← ฐานข้อมูล SQLite (สร้างอัตโนมัติ, ไม่ต้อง commit)
├─ .env.example        ← คัดลอกเป็น .env แล้วเติมค่า
└─ package.json
```

## หน้าเว็บ (client-side routing ด้วย hash)

| เส้นทาง | หน้า |
|---|---|
| `#/` | หน้าแรก (hero, จุดเด่น, สินค้าแนะนำ) |
| `#/products` | รวมสินค้าทั้งหมด |
| `#/product/:id` | รายละเอียดสินค้า (สเปก + สินค้าที่เกี่ยวข้อง) |
| `#/about` | เกี่ยวกับเรา + สถิติ |
| `#/checkout` | กรอกข้อมูลสั่งซื้อ |
| `#/order/:id` | ยืนยันคำสั่งซื้อ |

> แชต/ตะกร้าอยู่นอก router จึง **คงอยู่ข้ามหน้า** (แชตไม่หลุด, ตะกร้าจำใน localStorage)

## API

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/products` | รายการสินค้าทั้งหมด |
| GET | `/api/products/:id` | สินค้ารายตัว |
| POST | `/api/orders` | สร้างออเดอร์ (คำนวณราคาฝั่งเซิร์ฟเวอร์ + Stripe/PromptPay + push เข้า LINE) |
| GET | `/api/orders/:id` | ดูออเดอร์ + สถานะ (+ QR ถ้ายังไม่จ่าย) |
| POST | `/api/orders/:id/notify-payment` | ลูกค้าแจ้งว่าโอนแล้ว (PromptPay) |
| POST | `/api/orders/:id/confirm-stripe` | ยืนยันการจ่ายผ่านบัตร (fallback) |
| POST | `/webhook/stripe` | Stripe webhook (มาร์คชำระเงินอัตโนมัติ) |

**ระบบสั่งซื้อ:** ลูกค้ากด "ซื้อเลย"/"ดำเนินการสั่งซื้อ" → กรอกชื่อ/เบอร์/ที่อยู่ → เลือก **PromptPay QR หรือ บัตรเครดิต (Stripe)**
ราคารวมคำนวณจากฝั่งเซิร์ฟเวอร์ (ไม่เชื่อ client) แล้ว **ส่งสรุปเข้า LINE OA แอดมินทันที** + เก็บลง SQLite

### การชำระเงิน
- **PromptPay QR** — เซิร์ฟเวอร์สร้าง QR ตามยอด (จาก `PROMPTPAY_ID`) ลูกค้าสแกนจ่าย แล้วกด "แจ้งว่าชำระเงินแล้ว" → แอดมินได้แจ้งใน LINE → ยืนยันด้วย `#paid <id>`
- **บัตรเครดิต/เดบิต (Stripe)** — พาไปหน้า Stripe Checkout ที่ปลอดภัย จ่ายเสร็จเด้งกลับมา ระบบยืนยันอัตโนมัติ (ผ่าน webhook `/webhook/stripe` หรือ fallback ตอนกลับหน้า)

### สถานะ & ติดตามออเดอร์
สถานะ: `รอชำระเงิน → ชำระเงินแล้ว → เตรียมสินค้า → จัดส่งแล้ว → สำเร็จ` (+ ยกเลิก)
ลูกค้าดูสถานะแบบ timeline ที่ `#/order/:id` หรือ `#/track` — หน้า **poll อัปเดตเองทุก 5 วิ** + แจ้งเข้าแชตถ้าออนไลน์

### คำสั่งแอดมิน (พิมพ์ใน LINE OA)
| คำสั่ง | ทำอะไร |
|---|---|
| `#orders` | ดูออเดอร์ล่าสุด + สถานะ |
| `#order <id>` | ดูรายละเอียดออเดอร์ |
| `#paid <id>` | ยืนยันรับเงินแล้ว (PromptPay) |
| `#prepare <id>` | กำลังเตรียมสินค้า |
| `#ship <id> <เลขพัสดุ>` | จัดส่งแล้ว + เลขพัสดุ |
| `#done <id>` | จัดส่งสำเร็จ |
| `#cancel <id>` | ยกเลิกออเดอร์ |
| `#list` / `#<รหัสห้อง> ข้อความ` | ดู/ตอบแชตลูกค้า |

## ระบบสมาชิก & หลังบ้าน (Admin)

**สมาชิก:** สมัคร/เข้าสู่ระบบที่ `#/login`, `#/register` — รหัสผ่านเข้ารหัสด้วย scrypt, ใช้ token เก็บใน localStorage
ลูกค้าที่ล็อกอินจะเห็นประวัติคำสั่งซื้อที่ `#/account` และออเดอร์ผูกกับบัญชีอัตโนมัติ

**แอดมิน:** ตั้ง `ADMIN_SEED_EMAIL` และ `ADMIN_SEED_PASSWORD` ใน env หากต้องการสร้างบัญชีแอดมินอัตโนมัติตอนบูตครั้งแรก → เข้าหลังบ้านที่ `#/admin`
| เมนู | ทำอะไร |
|---|---|
| แดชบอร์ด | **กราฟยอดขาย 30 วัน** + ยอดเฉลี่ย/ส่วนลด + ช่องทางชำระเงิน + สินค้าขายดี + สถานะออเดอร์ |
| จัดการสินค้า | เพิ่ม/แก้ไข/ลบสินค้า + **อัปโหลดรูปจริง** + เปิด/ปิดการขาย |
| ออเดอร์ | ดูทุกออเดอร์ + เปลี่ยนสถานะ (ยืนยันจ่าย/เตรียม/จัดส่ง+เลขพัสดุ/สำเร็จ/ยกเลิก) |
| คูปองส่วนลด | สร้าง/แก้ไข/ลบคูปอง (% หรือจำนวนเงิน, ยอดขั้นต่ำ, จำกัดจำนวนครั้ง, วันหมดอายุ) |
| ผู้ใช้ | ดู/แก้ไขชื่อ + **เปลี่ยนสิทธิ์เป็นแอดมิน** + ลบสมาชิก (กันลบตัวเอง/แอดมินคนสุดท้าย) |
| ตั้งค่า API | แก้ token ของ **LINE / Stripe / PromptPay** จากเว็บ (มีผลทันที ไม่ต้องรีสตาร์ท) + ปุ่มทดสอบส่ง LINE |

ลูกค้าใช้คูปองได้ที่หน้า checkout (ส่วนลดคำนวณ/ตรวจสอบฝั่งเซิร์ฟเวอร์)

> 🔐 ค่า API ที่ตั้งในหลังบ้านเก็บใน DB และ **override ค่าใน .env** — สะดวกกว่าการแก้ไฟล์
> รูปสินค้าที่อัปโหลดเก็บใน `public/uploads/`

### Admin API (ต้องมี token แอดมิน)
`GET /api/admin/stats` · `GET /api/admin/analytics` · `GET/POST/PUT/DELETE /api/admin/products` · `GET /api/admin/orders` · `POST /api/admin/orders/:id/status` · `GET/PUT/DELETE /api/admin/users` · `GET/POST/PUT/DELETE /api/admin/coupons` · `GET/PUT /api/admin/settings` · `POST /api/admin/test-line`
สาธารณะ: `POST /api/coupons/validate`

## ดีไซน์
ธีม **luxury editorial** — โทนดำอุ่น + ทองแชมเปญ (สีเดียว), ฟอนต์ Serif (Cormorant Garamond / Noto Serif Thai) สำหรับหัวข้อ + IBM Plex Sans Thai สำหรับเนื้อหา, เส้น hairline, ไม่มี gradient รุ้ง/glassmorphism/นีออน — ดูเป็นแบรนด์จริง ไม่ใช่เทมเพลต

## ขั้นตอนติดตั้ง

### 1) ติดตั้ง dependencies
```bash
npm install
```

### 2) ตั้งค่า .env
```bash
copy .env.example .env      # Windows
```
แล้วเติมค่า 3 ตัวจาก LINE:

| ตัวแปร | หาได้จาก |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers Console → Channel → Messaging API → Issue token |
| `LINE_CHANNEL_SECRET` | LINE Developers Console → Channel → Basic settings |
| `LINE_ADMIN_USER_ID` | userId ของแอดมิน (ดูข้อ 4) |

### 3) สร้าง LINE OA + Messaging API Channel
1. สมัคร LINE Official Account ที่ https://manager.line.biz
2. ไปที่ https://developers.line.biz → สร้าง Provider → สร้าง **Messaging API channel** ผูกกับ OA
3. ที่หน้า Messaging API: ปิด **Auto-reply** และ **Greeting** (Settings → Response settings) เพื่อให้ webhook ทำงานเต็มที่

### 4) หา userId ของแอดมิน
วิธีง่ายสุด: รันเซิร์ฟเวอร์ + เปิด webhook ชั่วคราว แล้วให้แอดมิน "ทักหา OA ของตัวเอง" 1 ข้อความ
จากนั้นดู log `event.source.userId` — หรือเพิ่ม `console.log(event.source.userId)` ใน webhook ชั่วคราว
นำค่า `Uxxxxxxxx...` มาใส่ใน `LINE_ADMIN_USER_ID`

### 5) รันเซิร์ฟเวอร์
```bash
npm start
```
เปิด http://localhost:3000

### 6) เปิด public URL ให้ LINE เรียก webhook ได้
LINE ต้องเรียก webhook ผ่าน HTTPS สาธารณะ ตอนพัฒนาใช้ ngrok:
```bash
npx ngrok http 3000
```
นำ URL ที่ได้ไปตั้งใน LINE Console → Messaging API → **Webhook URL**:
```
https://xxxx.ngrok-free.app/webhook/line
```
กด **Verify** และเปิด **Use webhook**

---

## วิธีใช้งานแชท (ฝั่งแอดมิน)

- ลูกค้าทักมา → แอดมินจะได้ข้อความใน LINE OA หน้าตาแบบนี้:
  ```
  [#7E72D9CF9A] ลูกค้า-7E72D9CF9A:
  สนใจ Pro Mod 80W ครับ

  (ตอบกลับ: #7E72D9CF9A ข้อความ)
  ```
- **ตอบลูกค้า:** พิมพ์ `#7E72D9CF9A สวัสดีครับ สินค้าพร้อมส่งครับ`
- **ตอบคนล่าสุดเร็วๆ:** พิมพ์ข้อความเฉยๆ (ไม่ใส่รหัส) ระบบจะส่งให้ลูกค้าที่ทักล่าสุด
- **ดูห้องที่ออนไลน์:** พิมพ์ `#list`

รองรับลูกค้าหลายคนพร้อมกัน — แต่ละคนมีรหัสห้องของตัวเอง

---

## หมายเหตุสำหรับ Production
- เซสชันแชต **และออเดอร์** ตอนนี้เก็บใน memory (รีสตาร์ทแล้วหาย) → ควรย้ายไป **DB/Redis**
- ควรเพิ่มระบบ **คิว/หลายแอดมิน**, บันทึกประวัติแชท/ออเดอร์, และการชำระเงินจริง (PromptPay/Stripe)
- ควรเพิ่มการยืนยันอีเมล/SMS และหน้าติดตามสถานะออเดอร์
- Deploy หลัง HTTPS (เช่น Render, Railway, VPS + Nginx) แทน ngrok
