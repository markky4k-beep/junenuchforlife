function articleCoverUrl(prompt, imageSize = 'landscape_16_9') {
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${encodeURIComponent(prompt)}&image_size=${imageSize}`;
}

export const DEFAULT_ARTICLES = [
  {
    id: 'a_welcome',
    title: 'ทำไมพืชต้องการอาหารเสริมทางใบ?',
    excerpt: 'การให้อาหารทางใบช่วยให้พืชดูดซึมธาตุอาหารได้เร็ว เห็นผลไว เสริมการให้ปุ๋ยทางดิน',
    cover: articleCoverUrl('premium agricultural foliar feeding scene, farmer hand spraying nutrient mist onto healthy green crop leaves at sunrise, realistic Thai farm atmosphere, crisp leaf texture, soft golden morning light, editorial website hero image, luxury natural composition'),
    body: 'การให้ธาตุอาหารทางใบ (foliar feeding) เป็นการเสริมธาตุอาหารให้พืชดูดซึมผ่านปากใบได้โดยตรง เห็นผลเร็วกว่าทางดิน เหมาะกับช่วงที่พืชต้องการธาตุอาหารเร่งด่วน เช่น ช่วงเร่งโต ติดดอก หรือบำรุงผล\n\nควรฉีดพ่นช่วงเช้าหรือเย็นที่อากาศไม่ร้อนจัด และผสมสารจับใบเพื่อให้เกาะติดใบได้ดี ลดการชะล้างจากน้ำค้างหรือฝน',
  },
  {
    id: 'a_rainy',
    title: 'ฉีดพ่นหน้าฝนอย่างไรให้คุ้มค่า',
    excerpt: 'ฤดูฝนปุ๋ยและยาถูกชะล้างง่าย การใช้สารจับใบช่วยลดการสูญเสียได้มาก',
    cover: articleCoverUrl('realistic rainy season crop care in Thailand, close view of water droplets on green leaves while farmer sprays agricultural solution, overcast premium editorial lighting, high detail leaf surface, practical farm guidance hero image'),
    body: 'ในฤดูฝน น้ำฝนมักชะล้างปุ๋ยและยาที่ฉีดพ่นออกจากใบก่อนพืชจะดูดซึม ทำให้สิ้นเปลือง\n\nการผสม "สารเสริมประสิทธิภาพจับใบ" ช่วยให้ละอองยาเกาะติดผิวใบได้ดีขึ้น ทนต่อการชะล้าง เพิ่มประสิทธิภาพการดูดซึม และลดต้นทุนการฉีดซ้ำ',
  },
  {
    id: 'a_consult',
    title: 'ปรึกษานักวิชาการก่อนเลือกสูตร',
    excerpt: 'ไม่แน่ใจว่าพืชของคุณควรใช้สูตรไหน? ทักแชทปรึกษาทีมงานได้ฟรี',
    cover: articleCoverUrl('professional agricultural consultant discussing plant nutrition with farmer in a green orchard, tablet and product guidance, warm trustworthy mood, realistic Thai agriculture setting, clean premium website hero image'),
    body: 'แต่ละช่วงการเจริญเติบโตของพืชต้องการธาตุอาหารต่างกัน การเลือกสูตรให้เหมาะกับชนิดพืชและช่วงอายุจะให้ผลลัพธ์ดีที่สุด\n\nหากไม่แน่ใจ สามารถกดปุ่มแชทมุมขวาล่างเพื่อปรึกษาทีมนักวิชาการของนุชฟอร์ไลฟ์ได้โดยตรง พร้อมแนะนำอัตราการใช้ที่เหมาะกับแปลงของคุณ',
  },
];
