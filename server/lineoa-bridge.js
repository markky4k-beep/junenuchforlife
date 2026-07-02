// Server-to-server connector between this website and the LINE OA bot.
//
// Outbound : website visitor chat -> bot /api/web-chat/inbound (admin sees it in LINE)
// Inbound  : bot posts admin replies back to /api/webhooks/lineoa-bridge (verified here)
//
// All secrets stay server-side. Configure via env:
//   LINEOA_API_BASE_URL   e.g. https://bot.example.com   (the Flask bot)
//   LINEOA_API_CLIENT_ID  must match the bot's WEB_API_CLIENT_ID
//   LINEOA_API_SECRET     must match the bot's WEB_API_SECRET
//   PUBLIC_URL            this website's public base (for the callback url)

const CLIENT_HEADER = process.env.LINEOA_API_CLIENT_HEADER_NAME || 'X-LineOA-Client';
const SECRET_HEADER = process.env.LINEOA_API_SECRET_HEADER_NAME || 'X-LineOA-Secret';

function cfg(getSetting) {
  // getSetting(key) reads DB-backed settings first, then process.env (see server cfg()).
  const read = typeof getSetting === 'function' ? getSetting : (k) => process.env[k] || '';
  return {
    baseUrl: (read('LINEOA_API_BASE_URL') || '').replace(/\/+$/, ''),
    clientId: read('LINEOA_API_CLIENT_ID') || 'website-primary',
    secret: read('LINEOA_API_SECRET') || '',
    publicUrl: (read('PUBLIC_URL') || '').replace(/\/+$/, ''),
  };
}

export function isBridgeConfigured(getSetting) {
  const c = cfg(getSetting);
  return Boolean(c.baseUrl && c.secret);
}

export function callbackUrl(getSetting) {
  const c = cfg(getSetting);
  return c.publicUrl ? `${c.publicUrl}/api/webhooks/lineoa-bridge` : '';
}

// Verify a callback request coming from the bot. Returns true if trusted.
export function verifyBridgeRequest(req, getSetting) {
  const c = cfg(getSetting);
  if (!c.secret) return false;
  const client = String(req.headers[CLIENT_HEADER.toLowerCase()] || '');
  const secret = String(req.headers[SECRET_HEADER.toLowerCase()] || '');
  if (client && client !== c.clientId) return false;
  return secret === c.secret;
}

// Push a website visitor message to the LINE OA admin via the bot.
export async function sendVisitorMessage(getSetting, { sessionId, name, text }) {
  const c = cfg(getSetting);
  if (!c.baseUrl || !c.secret) throw new Error('LINE OA bridge ยังไม่ได้ตั้งค่า (LINEOA_API_BASE_URL / LINEOA_API_SECRET)');
  const res = await fetch(`${c.baseUrl}/api/web-chat/inbound`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CLIENT_HEADER]: c.clientId,
      [SECRET_HEADER]: c.secret,
    },
    body: JSON.stringify({
      session_id: sessionId,
      website_session_id: sessionId,
      name: name || '',
      text,
      website_webhook_url: callbackUrl(getSetting),
      metadata: { source: 'website_live_chat' },
    }),
  });
  if (!res.ok) throw new Error(`bridge inbound failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.json().catch(() => ({}));
}
