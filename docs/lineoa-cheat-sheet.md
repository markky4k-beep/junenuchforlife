# LINE OA Cheat Sheet

ใช้โดเมน production:

- Website: `https://www.junenuchforlife.com`
- Webhook: `https://www.junenuchforlife.com/webhook/line`

## Customer Commands

ใช้เฉพาะคำสั่งภาษาอังกฤษที่ลงท้ายด้วย `DDD` เท่านั้น:

- `menuddd`
- `productsddd`
- `setsddd`
- `packsddd`
- `smallddd`
- `largeddd`
- `promoddd`
- `reviewsddd`
- `trackddd`
- `articlesddd`
- `aboutddd`
- `chatddd`
- `webroomddd`
- `supportddd`
- `accountddd`
- `memberddd`

หมายเหตุ:

- ข้อความธรรมดา เช่น `สวัสดี`, `ขอคำแนะนำ`, `สนใจตัวนี้` จะไม่ถือเป็น command
- ถ้า `LINE_CHAT_MODE=web_room` ข้อความธรรมดาจะถูกพาไปห้องแชตเว็บ
- ให้ใช้ปุ่ม Flex/Postback เป็นเมนูหลักของ LINE OA
- flow ที่แนะนำสำหรับลูกค้า: `ดูสินค้า -> ซื้อใน LINE -> เลือก PromptPay/บัตร -> ส่งสลิปใน LINE` หรือ `คุยกับทีมงาน -> เปิดห้องแชตเว็บ`
- ปุ่ม `ดูสินค้า` และคำสั่ง `productsddd` จะดึงสินค้า active จากเว็บไซต์โดยตรง
- การ์ดสินค้าใน LINE OA จะมีปุ่ม `ซื้อใน LINE`, `เปิดบนเว็บ`, และ `คุยเรื่องสินค้านี้`
- ถ้าลูกค้ากดถามจากการ์ดสินค้า ระบบจะส่ง context ชื่อสินค้าที่สนใจไปให้แอดมินเห็นใน Inbox ด้วย
- ถ้าต้องการตั้ง Rich Menu ใหม่ตาม flow นี้ ให้ใช้ไฟล์ใน `docs/line-rich-menu/`
- ถ้าต้องการเจาะหมวด ให้ใช้ `setsddd`, `smallddd`, `largeddd`, `promoddd`
- ถ้าแก้ราคา รายละเอียด รูปภาพ หรือลำดับสินค้าในหลังบ้าน เว็บไซต์และ LINE OA จะอัปเดตตามข้อมูลชุดเดียวกัน
- ถ้าลูกค้าเลือก `PromptPay` ระบบจะสร้างออเดอร์, ส่ง QR กลับใน LINE, และรอปุ่ม `ฉันโอนแล้ว` / `ส่งสลิป`
- ลูกค้าสามารถส่งรูปสลิปเป็น image message ในแชต LINE เดิมได้เลย ระบบจะดึงรูปจาก LINE Message Content API ไปตรวจผ่าน SlipOK อัตโนมัติ
- ถ้าลูกค้าเลือก `บัตร` ระบบจะสร้างออเดอร์เดียวกันและส่งลิงก์ Stripe checkout กลับใน LINE

## Admin Commands

คำสั่งแอดมินแบบ text:

- `listddd`
- `ordersddd`
- `orderddd ORDER_ID`
- `paidddd ORDER_ID`
- `prepareddd ORDER_ID`
- `shipddd ORDER_ID TRACKING`
- `doneddd ORDER_ID`
- `cancelddd ORDER_ID`

การตอบกลับห้องแชต:

- ใช้รูปแบบ `#SESSION_ID ข้อความ`
- ตัวอย่าง: `#7E72D9CF9A สวัสดีค่ะ ตอนนี้ทีมงานตอบกลับแล้วนะคะ`

## Web Room Checks

เงื่อนไขที่ต้องพร้อม:

- `PUBLIC_URL` ต้องเป็น `https://www.junenuchforlife.com`
- `LINE_CHANNEL_SECRET` ต้องตั้งค่าแล้ว
- `LINE_CHANNEL_ACCESS_TOKEN` ต้องตั้งค่าแล้ว
- `LINE_WEB_CHAT_PATH` ควรเป็น `/line-room`

วิธีตรวจจากหลังบ้าน:

- เปิด `Secure Admin -> Settings`
- กด `ทดสอบลิงก์ห้องแชต`
- ถ้าพร้อม ระบบจะเปิดลิงก์ตัวอย่างที่ตรวจ token ผ่านแล้ว

## Production Rule

- Production ใช้เว็บหลักบน Vercel เป็นตัวรับ webhook โดยตรง
- ไม่ใช้ Cloudflare tunnel
- ไม่ใช้ `lineoa_bot` เป็นเส้นทาง production หลัก
- หากข้อความลูกค้าเป็น free text ให้ถือเป็น chat intent ไม่ใช่ command
