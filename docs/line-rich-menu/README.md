# LINE OA Rich Menu Pack

ชุดนี้ออกแบบให้ตรงกับ flow ใหม่ของระบบ:

- ดูสินค้า
- โปรโมชัน
- คุยกับทีมงาน
- รีวิวลูกค้า
- ติดตามออเดอร์
- เปิดเมนูหมวดสินค้าแบบลึกขึ้น

## โครงสร้าง

- `customer-home-richmenu.json`
  - เมนูหลักสำหรับลูกค้าทั่วไป
- `customer-catalog-richmenu.json`
  - เมนูหมวดสินค้าและลิงก์เสริม
- `richmenu-aliases.example.json`
  - alias ที่แนะนำสำหรับ rich menu switch
- `customer-home-richmenu.svg`
  - artwork ต้นแบบเมนูหลัก ขนาด 2500x1686
- `customer-catalog-richmenu.svg`
  - artwork ต้นแบบเมนูหมวดสินค้า ขนาด 2500x1686

## Flow ที่แนะนำ

### Menu 1: Home

แถวบน:

- ดูสินค้า
- โปรโมชัน
- คุยกับทีมงาน

แถวล่าง:

- รีวิวลูกค้า
- ติดตามออเดอร์
- หมวดสินค้า

### Menu 2: Catalog

แถวบน:

- ชุดเซต
- ขวดเล็ก
- ขวดใหญ่

แถวล่าง:

- บทความ
- บัญชีลูกค้า
- กลับหน้าแรก

## Mapping ปุ่ม

### Home Menu

| ปุ่ม | Action | ปลายทาง |
|---|---|---|
| ดูสินค้า | `postback` | `lineoa:products-showcase` |
| โปรโมชัน | `postback` | `lineoa:products-category:promo` |
| คุยกับทีมงาน | `postback` | `lineoa:web-room` |
| รีวิวลูกค้า | `uri` | `https://www.junenuchforlife.com/#/reviews` |
| ติดตามออเดอร์ | `uri` | `https://www.junenuchforlife.com/#/track` |
| หมวดสินค้า | `richmenuswitch` | `line-catalog` |

### Catalog Menu

| ปุ่ม | Action | ปลายทาง |
|---|---|---|
| ชุดเซต | `postback` | `lineoa:products-category:sets` |
| ขวดเล็ก | `postback` | `lineoa:products-category:small` |
| ขวดใหญ่ | `postback` | `lineoa:products-category:large` |
| บทความ | `uri` | `https://www.junenuchforlife.com/#/articles` |
| บัญชีลูกค้า | `uri` | `https://www.junenuchforlife.com/#/login` |
| กลับหน้าแรก | `richmenuswitch` | `line-home` |

## วิธีใช้ใน LINE Official Account Manager

1. เปิดไฟล์ SVG แล้ว export เป็น PNG หรือ JPG ขนาด `2500x1686`
2. สร้าง rich menu 2 ชุดจากไฟล์ JSON ในโฟลเดอร์นี้
3. อัปโหลดรูปของแต่ละชุด
4. สร้าง alias:
   - `line-home`
   - `line-catalog`
5. ตั้ง `customer-home-richmenu.json` เป็นเมนู default ของลูกค้าทั่วไป

## วิธีใช้ผ่าน Messaging API

ลำดับโดยย่อ:

1. `POST /v2/bot/richmenu` เพื่อสร้าง Home
2. `POST /v2/bot/richmenu/{richMenuId}/content` เพื่ออัปโหลดรูป Home
3. `POST /v2/bot/richmenu` เพื่อสร้าง Catalog
4. `POST /v2/bot/richmenu/{richMenuId}/content` เพื่ออัปโหลดรูป Catalog
5. `POST /v2/bot/richmenu/alias` เพื่อสร้าง alias `line-home` และ `line-catalog`
6. `POST /v2/bot/user/all/richmenu/{homeRichMenuId}` เพื่อผูก Home เป็นค่าเริ่มต้น

## หมายเหตุสำคัญ

- ปุ่ม `postback` ทั้งหมดในแพ็กนี้สอดคล้องกับ runtime ปัจจุบันใน `server/lineoa-runtime.js`
- product card ในแชต LINE รองรับ flow `ซื้อใน LINE -> เลือกชำระเงิน -> แจ้งโอน -> ส่งสลิป` แล้ว โดยใช้ order service ชุดเดียวกับเว็บไซต์
- ถ้าลูกค้ากด `คุยเรื่องสินค้านี้` จาก product card ในแชต ระบบจะยังแนบ context สินค้าให้แอดมินเหมือนเดิม
- rich menu นี้เป็นเมนูระดับ customer flow; เมนูแอดมินยังควรใช้ในแชตหรือหลังบ้านตามเดิม
