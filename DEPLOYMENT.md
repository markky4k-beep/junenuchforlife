# Deployment flow — นุชฟอร์ไลฟ์ (junenuchforlife.com)

สถาปัตยกรรมหลัง deploy:

```
junenuchforlife.com ──> Vercel (frontend static + Express API serverless)
                              │  อ่าน/เขียน
                              ▼
                    Supabase: JunenuchforlifeMain  ◀── อ่าน/เขียน ── Render: lineoa_bot (Flask, always-on)
                              ▲                                              │
                    Live Chat ผ่าน Supabase Realtime                LINE webhook /webhook
```

- **เว็บ** → Vercel (serverless, auto-deploy จาก GitHub)
- **bot** → Render (always-on, auto-deploy จาก GitHub) — ต้องแยกเพราะ Flask + scheduler + LINE webhook รันค้าง (Vercel serverless ทำไม่ได้)
- **DB** → Supabase `gtqpefjhaxheyllygbrn` (รวมแล้ว)
- **Live Chat** → Supabase Realtime (เลิกใช้ Socket.IO เพราะ serverless ไม่รองรับ WebSocket)
- **อัปโหลดรูป** → Supabase Storage (เลิกเขียนดิสก์เพราะ serverless ดิสก์ไม่ถาวร)

---

## งานที่ต้องทำ (checklist)

### A. Refactor เว็บให้ Vercel-native  *(โค้ด — Claude ทำ)*
- [x] `vercel.json` (static + serverless routing)
- [x] `api/index.js` (ห่อ Express เป็น serverless handler)
- [x] `server/index.js`: export `app`, guard `server.listen`/Socket.IO เฉพาะตอนรัน local (`process.env.VERCEL`)
- [x] Live Chat: Socket.IO → **REST polling** (`POST /api/chat/send` + `GET /api/chat/poll`) — ทดสอบ loop ผ่านแล้ว
- [x] `db.js`: dynamic import provider (better-sqlite3 ไม่โหลดบน Vercel)
- [x] settingsCache: `ensureInit()` รันครั้งเดียวต่อ cold start
- [x] อัปโหลด: `saveAsset()` ย้ายจากดิสก์ไปใช้ Supabase Storage อัตโนมัติเมื่อมีการตั้งค่า Supabase และ fallback เป็น local เฉพาะตอนรันนอก Vercel

### B. Bot → Render  *(Claude เตรียมไฟล์ / คุณกด import)*
- [x] `lineoa_bot/render.yaml`
- [ ] สร้าง Render account → New > Blueprint → เลือก repo
- [ ] ใส่ env (Supabase keys, CHANNEL_*, ADMIN_LINE_USER_ID, WEB_API_SECRET ฯลฯ) ตาม render.yaml
- [ ] ได้ URL เช่น `https://nuch-lineoa-bot.onrender.com`
- [ ] LINE Developers Console → Webhook URL = `<url>/webhook` → Verify

### C. โดเมน + ต่อสาย  *(ร่วมกัน)*
- [ ] สร้าง GitHub repo + push (root = เว็บ, มี lineoa_bot/ ข้างใน)
- [ ] Vercel: Import repo → ตั้ง Environment Variables:
  - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `LINEOA_API_BASE_URL=https://nuch-lineoa-bot.onrender.com`
  - `LINEOA_API_CLIENT_ID=website-primary`, `LINEOA_API_SECRET=<ตรงกับ bot>`
  - `PUBLIC_URL=https://junenuchforlife.com`
  - `PROMPTPAY_ID`, `PROMPTPAY_NAME`, `STRIPE_*`, `SMTP_*` (ตามต้องการ)
- [ ] Vercel: Add Domain `junenuchforlife.com` → ชี้ DNS ที่ registrar ตามที่ Vercel บอก
- [ ] ทดสอบ end-to-end จริง (สั่งซื้อ, แชต web↔LINE, อัปสลิป)

---

## ENV reference (ค่าที่ใช้แล้ว)

Supabase (Main): `https://gtqpefjhaxheyllygbrn.supabase.co`
- publishable: `sb_publishable_mNGziE1rv7qCvTjoJcTP9g_hLYmJy5T`
- service_role / anon: ดูใน `.env` (อย่า commit ค่าจริงขึ้น public repo)

Shared bridge secret (`WEB_API_SECRET` = website `LINEOA_API_SECRET`): ดูใน `lineoa_bot/.env`

> ⚠️ ก่อน push GitHub: ใส่ `.env`, `service_account.json`, `*.json` credentials ใน `.gitignore` — อย่า commit secret ขึ้น public repo
