// สร้าง payload มาตรฐาน EMVCo สำหรับ PromptPay QR (Thai QR Payment)
// รองรับเบอร์โทร / เลขบัตรประชาชน / e-Wallet ID

function tlv(id, value) {
  const len = String(value.length).padStart(2, '0');
  return id + len + value;
}

function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// target = เบอร์โทร (0xxxxxxxxx) / เลขบัตร 13 หลัก / e-wallet 15 หลัก
export function promptPayPayload(target, amount) {
  const t = String(target).replace(/[^0-9]/g, '');
  let proxyType, proxyVal;
  if (t.length >= 15) { proxyType = '03'; proxyVal = t; }
  else if (t.length >= 13) { proxyType = '02'; proxyVal = t; }
  else { proxyType = '01'; proxyVal = ('0000000000000' + t.replace(/^0/, '66')).slice(-13); }

  const merchant = tlv('00', 'A000000677010111') + tlv(proxyType, proxyVal);
  let payload =
    tlv('00', '01') +
    tlv('01', amount ? '12' : '11') +
    tlv('29', merchant) +
    tlv('53', '764') +                       // THB
    (amount ? tlv('54', Number(amount).toFixed(2)) : '') +
    tlv('58', 'TH');
  payload += '6304';                          // CRC tag + length
  return payload + crc16(payload);
}
