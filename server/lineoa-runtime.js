import {
  LINE_ADMIN_MENU_SUMMARY_KEYS,
  LINE_ADMIN_MENU_URL_KEYS,
  LINE_ADMIN_ORDER_ACTION_ALIASES,
  LINE_CUSTOMER_COMMAND_ALIASES,
  LINE_CUSTOMER_LEGACY_POSTBACK_ACTIONS,
  LINE_CUSTOMER_TRACKING_PREFIXES,
  LINE_CUSTOMER_WEB_REDIRECT_EXACT,
  LINE_CUSTOMER_WEB_REDIRECT_PREFIXES,
} from './lineoa-mappings.js';
import {
  LINE_CHECKOUT_PAYMENT_OPTIONS,
  LINE_HOME_BOTTOM_ACTIONS,
  LINE_HOME_MENU_TILES,
  LINE_PRODUCT_COLLECTIONS,
  getLineCollectionMeta,
  linePaymentMethodLabel,
  normalizeLinePaymentMethod,
  resolveLineCollectionKey,
} from './lineoa-menu-schema.js';

export function createLineRuntime(deps = {}) {
  const {
    crypto,
    lineChannelAccessToken,
    lineChannelSecret,
    listProducts,
    publicBaseUrl,
    lineWebRoomEntryUrl,
    syncLineInboxSession,
    patchChatInboxMeta,
    lineChatMode,
    lineChatModeWebRoom,
    chatInboxMetaMap,
    routeCustomerMessage,
    emitAdminInboxUpdate,
    listOrders,
    statusLabel,
    applyOrderAction,
    adminUserId,
    handleAdminMessage,
    ensureSettingsFresh,
    ensureLineWebhookEventIdempotency,
    recordLineWebhookAudit,
    recordSystemEvent,
    createCheckoutOrder,
    claimOrderPayment,
    verifyOrderSlip,
    buildPromptPayQrUrl,
    logger = console,
  } = deps;

  function lineEventText(event = {}) {
    const messageType = String(event?.message?.type || '').trim();
    if (messageType === 'text') return String(event?.message?.text || '').trim();
    const labels = {
      sticker: '[สติกเกอร์จาก LINE]',
      image: '[รูปภาพจาก LINE]',
      video: '[วิดีโอจาก LINE]',
      audio: '[เสียงจาก LINE]',
      file: '[ไฟล์จาก LINE]',
      location: '[ตำแหน่งจาก LINE]',
    };
    return labels[messageType] || '';
  }

  function lineSourceKey(source = {}) {
    if (source?.userId) return `user:${String(source.userId).trim()}`;
    if (source?.groupId) return `group:${String(source.groupId).trim()}`;
    if (source?.roomId) return `room:${String(source.roomId).trim()}`;
    return '';
  }

  // ต้องไม่ว่างทั้งคู่ — กันกรณี LINE_ADMIN_USER_ID ยังไม่ตั้ง ('' === '' จะกลายเป็นแอดมินทั้งที่ไม่ใช่)
  function isLineAdminSource(source = {}) {
    const admin = String(typeof adminUserId === 'function' ? adminUserId() || '' : '').trim();
    const userId = String(source?.userId || '').trim();
    return Boolean(admin && userId && userId === admin);
  }

  const lineTraceByReplyToken = new Map();

  function createLineTrace(event = {}) {
    return {
      startedAt: Date.now(),
      steps: [],
      eventType: String(event?.type || '').trim(),
      messageType: String(event?.message?.type || '').trim(),
      sourceKey: lineSourceKey(event?.source || {}),
      textPreview: lineEventText(event).slice(0, 160),
      step(name = '', data = {}) {
        this.steps.push({
          name: String(name || '').trim() || 'step',
          at: Date.now(),
          data: data && typeof data === 'object' ? data : {},
        });
      },
    };
  }

  function bindLineTrace(event = {}, trace = null) {
    const token = String(event?.replyToken || '').trim();
    if (!token || !trace) return;
    lineTraceByReplyToken.set(token, trace);
  }

  function releaseLineTrace(event = {}) {
    const token = String(event?.replyToken || '').trim();
    if (!token) return;
    lineTraceByReplyToken.delete(token);
  }

  function lineTraceStep(event = {}, name = '', data = {}) {
    event?.__lineTrace?.step?.(name, data);
  }

  async function flushLineTrace(event = {}, { result = 'success', eventKey = '', error = '' } = {}) {
    const trace = event?.__lineTrace;
    if (!trace) return;
    const totalMs = Date.now() - Number(trace.startedAt || Date.now());
    const slowThresholdMs = 1200;
    const isSlow = totalMs >= slowThresholdMs;
    if (!recordSystemEvent || (result === 'success' && !isSlow)) return;
    const steps = [];
    let lastAt = Number(trace.startedAt || Date.now());
    for (const step of trace.steps || []) {
      const at = Number(step?.at || lastAt);
      steps.push({
        name: String(step?.name || 'step').trim(),
        durationMs: Math.max(0, at - lastAt),
        ...(step?.data && Object.keys(step.data).length ? { data: step.data } : {}),
      });
      lastAt = at;
    }
    await recordSystemEvent({
      level: result === 'failed' ? 'error' : 'info',
      source: 'line_webhook',
      type: result === 'failed' ? 'latency_trace_failed' : 'latency_trace_slow',
      message: `LINE webhook ${result === 'failed' ? 'failed' : 'slow'} ${trace.eventType || 'event'} ${trace.messageType || 'none'} ${totalMs}ms`,
      data: {
        eventKey: String(eventKey || '').trim(),
        result,
        totalMs,
        eventType: trace.eventType,
        messageType: trace.messageType,
        sourceKey: trace.sourceKey,
        textPreview: trace.textPreview,
        error: String(error || '').trim(),
        steps,
      },
      alert: result === 'failed',
      dedupeKey: `line_webhook_trace:${trace.eventType}:${trace.messageType || 'none'}:${result}`,
    });
  }

  async function callLineMessagingApi(endpointPath, payload) {
    const accessToken = lineChannelAccessToken();
    if (!accessToken) throw new Error('LINE channel access token is not configured');
    const response = await fetch(`https://api.line.me${endpointPath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`LINE API ${endpointPath} failed: ${response.status} ${raw.slice(0, 300)}`);
    }
    return true;
  }

  async function callLineDataApi(endpointPath) {
    const accessToken = lineChannelAccessToken();
    if (!accessToken) throw new Error('LINE channel access token is not configured');
    const response = await fetch(`https://api-data.line.me${endpointPath}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`LINE data API ${endpointPath} failed: ${response.status} ${raw.slice(0, 300)}`);
    }
    return response;
  }

  async function fetchLineMessageContent(messageId = '') {
    const id = String(messageId || '').trim();
    if (!id) throw new Error('ไม่พบ message id ของรูปสลิป');
    const response = await callLineDataApi(`/v2/bot/message/${encodeURIComponent(id)}/content`);
    const contentType = String(response.headers.get('content-type') || '').trim().toLowerCase();
    const arrayBuffer = await response.arrayBuffer();
    return {
      contentType,
      buffer: Buffer.from(arrayBuffer),
    };
  }

  function asLineMessageArray(messages = []) {
    const list = Array.isArray(messages) ? messages : [messages];
    return list.filter(Boolean).slice(0, 5);
  }

  async function replyLineMessages(replyToken, messages = []) {
    const token = String(replyToken || '').trim();
    const list = asLineMessageArray(messages);
    if (!token || !list.length) return false;
    const trace = lineTraceByReplyToken.get(token);
    if (trace) trace.step('reply_prepare', { messageCount: list.length });
    await callLineMessagingApi('/v2/bot/message/reply', { replyToken: token, messages: list });
    if (trace) trace.step('reply_done', { messageCount: list.length });
    return true;
  }

  function publicHashUrl(hashPath = '/') {
    const normalized = String(hashPath || '/').trim() || '/';
    const route = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const base = publicBaseUrl();
    return base ? `${base}/#${route}` : `/#${route}`;
  }

  function lineMenuPostback(data, label) {
    return { type: 'postback', label, data };
  }

  function lineUriAction(label, uri) {
    return { type: 'uri', label, uri };
  }

  function lineProductsUrl() {
    return publicHashUrl('/products');
  }

  function lineTrackUrl() {
    return publicHashUrl('/track');
  }

  function lineReviewsUrl() {
    return publicHashUrl('/reviews');
  }

  function lineWebRoomPostbackData(productId = '') {
    const id = String(productId || '').trim();
    return id ? `lineoa:web-room:product:${id}` : 'lineoa:web-room';
  }

  function lineOrderUrl(orderId = '', accessToken = '') {
    const base = publicBaseUrl();
    const id = String(orderId || '').trim();
    const access = String(accessToken || '').trim();
    if (!base || !id || !access) return '';
    return `${base}/#/order/${encodeURIComponent(id)}?access=${encodeURIComponent(access)}`;
  }

  function secureAdminHashUrl(hashPath = '/admin') {
    const normalized = String(hashPath || '/admin').trim() || '/admin';
    const route = normalized.startsWith('/') ? normalized : `/${normalized}`;
    const base = publicBaseUrl();
    return base ? `${base}/secure-admin#${route}` : `/secure-admin#${route}`;
  }

  const LINE_PRODUCTS_CACHE_TTL_MS = 30000;
  let lineProductsCache = [];
  let lineProductsCacheAt = 0;
  let lineProductsCachePromise = null;

  async function getLineProductsCached(force = false) {
    const stale = force || !lineProductsCacheAt || (Date.now() - lineProductsCacheAt) >= LINE_PRODUCTS_CACHE_TTL_MS;
    if (!stale && Array.isArray(lineProductsCache) && lineProductsCache.length) return lineProductsCache;
    if (!lineProductsCachePromise) {
      lineProductsCachePromise = Promise.resolve(listProducts(false))
        .then((products) => Array.isArray(products) ? products : [])
        .then((products) => {
          lineProductsCache = products;
          lineProductsCacheAt = Date.now();
          return lineProductsCache;
        })
        .finally(() => {
          lineProductsCachePromise = null;
        });
    }
    return lineProductsCachePromise;
  }

  function buildLineActionPill({
    label = '',
    action = null,
    backgroundColor = '#F8F2E7',
    textColor = '#4B3A12',
    borderColor = '#D8C8A1',
    size = 'sm',
    weight = 'bold',
  } = {}) {
    return {
      type: 'box',
      layout: 'horizontal',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor,
      borderColor,
      borderWidth: '1px',
      cornerRadius: '999px',
      paddingTop: '8px',
      paddingBottom: '8px',
      paddingStart: '14px',
      paddingEnd: '14px',
      action,
      contents: [
        {
          type: 'text',
          text: String(label || '').trim().slice(0, 40),
          size,
          weight,
          color: textColor,
          align: 'center',
        },
      ],
    };
  }

  function buildLineActionRow(items = []) {
    const cells = items
      .filter((item) => item && item.label && item.action)
      .slice(0, 2)
      .map((item) => ({
        type: 'box',
        layout: 'vertical',
        flex: 1,
        contents: [
          buildLineActionPill({
            label: item.label,
            action: item.action,
            backgroundColor: item.backgroundColor,
            textColor: item.textColor,
            borderColor: item.borderColor,
            size: item.size,
          }),
        ],
      }));
    if (!cells.length) return null;
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      contents: cells,
    };
  }

  function buildLineShortcutFlex({
    eyebrow = '',
    title = '',
    body = '',
    primaryLabel = '',
    primaryAction = null,
    secondaryLabel = '',
    secondaryAction = null,
    accentColor = '#7B5CFF',
    backgroundColor = '#F4F1EC',
  } = {}) {
    return {
      type: 'flex',
      altText: String(title || 'เมนูทางลัด').trim(),
      contents: {
        type: 'bubble',
        size: 'giga',
        styles: {
          body: { backgroundColor },
          footer: { backgroundColor, separator: false },
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '20px',
          contents: [
            ...(eyebrow ? [{
              type: 'text',
              text: eyebrow,
              size: 'xs',
              weight: 'bold',
              color: accentColor,
            }] : []),
            {
              type: 'text',
              text: String(title || '').trim().slice(0, 60),
              size: 'xl',
              weight: 'bold',
              wrap: true,
              color: '#2C2158',
            },
            {
              type: 'text',
              text: String(body || '').trim().slice(0, 220),
              size: 'sm',
              wrap: true,
              color: '#6B5CA5',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingStart: '20px',
          paddingEnd: '20px',
          paddingBottom: '20px',
          contents: [
            ...(primaryAction ? [buildLineActionPill({
              label: primaryLabel,
              action: primaryAction,
              backgroundColor: '#F0E8FF',
              textColor: accentColor,
              borderColor: '#D8C8F6',
            })] : []),
            ...(secondaryAction ? [buildLineActionPill({
              label: secondaryLabel,
              action: secondaryAction,
              backgroundColor: '#FFF8EE',
              textColor: '#6B5CA5',
              borderColor: '#E6D9BE',
              weight: 'regular',
            })] : []),
          ],
        },
      },
    };
  }

  function buildLineMainMenuTile({
    emoji = '',
    title = '',
    subtitle = '',
    data = '',
    backgroundColor = '#EFE8D9',
  } = {}) {
    return {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      backgroundColor,
      cornerRadius: '18px',
      paddingAll: '16px',
      flex: 1,
      action: lineMenuPostback(data, title),
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          width: '34px',
          height: '34px',
          cornerRadius: '10px',
          backgroundColor: '#F8F2E7',
          justifyContent: 'center',
          alignItems: 'center',
          contents: [
            { type: 'text', text: emoji || '•', size: 'lg', align: 'center' },
          ],
        },
        {
          type: 'text',
          text: String(title || '').trim().slice(0, 24),
          weight: 'bold',
          size: 'md',
          wrap: true,
          color: '#4B3A12',
          margin: 'xs',
        },
        {
          type: 'text',
          text: String(subtitle || '').trim().slice(0, 60),
          size: 'xs',
          wrap: true,
          color: '#7A6740',
        },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          contents: [
            buildLineActionPill({
              label: 'แตะเพื่อเปิด',
              action: lineMenuPostback(data, title),
              backgroundColor: '#F8F2E7',
              textColor: '#A8832A',
              borderColor: '#D8C8A1',
              size: 'xs',
            }),
          ],
        },
      ],
    };
  }

  function buildLineMainMenuFlex() {
    const tiles = LINE_HOME_MENU_TILES.map((item) => buildLineMainMenuTile({
      emoji: item.emoji,
      title: item.title,
      subtitle: item.subtitle,
      data: item.data,
      backgroundColor: '#EAE2D1',
    }));
    const bottomActions = LINE_HOME_BOTTOM_ACTIONS.map((item) => ({
      type: 'box',
      layout: 'vertical',
      flex: 1,
      contents: [
        buildLineActionPill({
          label: item.label,
          action: lineMenuPostback(item.data, item.label),
          backgroundColor: item.backgroundColor,
          textColor: item.textColor,
          borderColor: item.borderColor,
        }),
      ],
    }));
    return {
      type: 'flex',
      altText: 'เมนูหลัก LINE OA',
      contents: {
        type: 'bubble',
        size: 'giga',
        styles: {
          body: {
            backgroundColor: '#F4F1EC',
          },
          footer: {
            backgroundColor: '#F4F1EC',
            separator: false,
          },
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            {
              type: 'text',
              text: 'LINE OA MEMBERSHIP',
              size: 'xs',
              weight: 'bold',
              color: '#A8832A',
            },
            {
              type: 'text',
              text: 'เมนูหลัก',
              weight: 'bold',
              size: 'xxl',
              color: '#A8832A',
              margin: 'xs',
            },
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#E7DAB7',
              cornerRadius: '18px',
              paddingAll: '16px',
              spacing: 'sm',
              contents: [
                { type: 'text', text: 'เริ่มใช้งาน 3 ขั้นตอน', weight: 'bold', size: 'md', color: '#5C4A1F' },
                { type: 'text', text: '1. เลือกสินค้าและโปรที่ต้องการ', size: 'sm', wrap: true, color: '#6C5930' },
                { type: 'text', text: '2. กรอกที่อยู่ เลือกวิธีชำระ', size: 'sm', wrap: true, color: '#6C5930' },
                { type: 'text', text: '3. ยืนยันคำสั่งซื้อ แล้วส่งสลิปหรือชำระผ่านระบบต่อ', size: 'sm', wrap: true, color: '#6C5930' },
              ],
            },
            {
              type: 'box',
              layout: 'horizontal',
              spacing: 'sm',
              margin: 'sm',
              contents: tiles.slice(0, 2),
            },
            {
              type: 'box',
              layout: 'horizontal',
              spacing: 'sm',
              contents: tiles.slice(2, 4),
            },
            {
              type: 'text',
              text: 'พิมพ์ productsddd เพื่อเปิดเมนูสินค้าโดยตรง หรือพิมพ์ข้อความธรรมดาเพื่อคุยกับทีมงานได้เลย',
              size: 'xs',
              wrap: true,
              color: '#8D7A57',
              margin: 'sm',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingStart: '18px',
          paddingEnd: '18px',
          paddingBottom: '18px',
          contents: [
            {
              type: 'box',
              layout: 'horizontal',
              spacing: 'sm',
              contents: bottomActions,
            },
          ],
        },
      },
    };
  }

  function buildLineAdminMenuFlex() {
    return {
      type: 'flex',
      altText: 'เมนูแอดมิน LINE OA',
      contents: {
        type: 'bubble',
        size: 'giga',
        hero: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#EEF4FF',
          paddingAll: '22px',
          contents: [
            { type: 'text', text: 'เมนูแอดมิน', weight: 'bold', size: 'lg', color: '#1F3B8A' },
            { type: 'text', text: 'จัดการออเดอร์และเปิดหลังบ้านจากปุ่มด้านล่างได้ทันที', size: 'sm', color: '#4C5F92', wrap: true, margin: 'sm' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#4B7BFF',
              height: 'sm',
              action: lineUriAction('เปิด Inbox', secureAdminHashUrl('/admin/inbox')),
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: lineUriAction('ดูรายการออเดอร์', secureAdminHashUrl('/admin/orders')),
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: lineMenuPostback('admin_menu|order_history', 'ออเดอร์ล่าสุด', 'ออเดอร์ล่าสุด'),
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: lineMenuPostback('admin_menu|search_order_help', 'ค้นหา order_id', 'ค้นหา order_id'),
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'link',
              height: 'sm',
              action: lineUriAction('ผู้ใช้ / สิทธิ์', secureAdminHashUrl('/admin/users')),
            },
          ],
        },
      },
    };
  }

  function normalizeLineCommandKey(text = '') {
    return String(text || '').trim().toLowerCase();
  }

  function resolveLineCommandAction(text = '') {
    const key = normalizeLineCommandKey(text);
    if (!key) return '';
    for (const [action, labels] of Object.entries(LINE_CUSTOMER_COMMAND_ALIASES)) {
      if (labels.includes(key)) return action;
    }
    return '';
  }

  function lineTextReply(text = '') {
    return { type: 'text', text: String(text || '').trim().slice(0, 1000) };
  }

  function formatLineCurrency(value = 0) {
    const num = Math.max(0, Number(value) || 0);
    try {
      return `฿${new Intl.NumberFormat('th-TH').format(num)}`;
    } catch {
      return `฿${num}`;
    }
  }

  function formatLineDateTime(value = 0) {
    const num = Number(value) || 0;
    if (!num) return '-';
    try {
      return new Intl.DateTimeFormat('th-TH', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(num));
    } catch {
      return new Date(num).toISOString();
    }
  }

  function lineProductDisplayName(product = {}) {
    return String(product?.extra?.cardName || product?.short || product?.name || 'สินค้าแนะนำ').trim().slice(0, 40);
  }

  function lineProductDescription(product = {}) {
    const parts = [
      String(product?.tag || '').trim(),
      String(product?.short || product?.description || '').trim(),
    ].filter(Boolean);
    return parts.join(' • ').slice(0, 110) || 'เปิดดูรายละเอียดเพิ่มเติมบนเว็บไซต์ได้ทันที';
  }

  function lineProductImage(product = {}) {
    const url = String(product?.image || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function lineProductUrl(product = {}) {
    const id = String(product?.id || '').trim();
    return publicHashUrl(id ? `/product/${id}` : '/products');
  }

  async function findLineProductById(productId = '') {
    const id = String(productId || '').trim();
    if (!id) return null;
    const products = await getLineProductsCached();
    return products.find((item) => item && item.active !== false && String(item.id || '').trim() === id) || null;
  }

  function lineProductIntentMetaPatch(product = {}) {
    const id = String(product?.id || '').trim();
    const name = lineProductDisplayName(product);
    const productUrl = lineProductUrl(product);
    return {
      lastLineIntent: id ? 'product_consult' : 'customer_chat',
      lastProductId: id,
      lastProductName: name,
      lastProductUrl: productUrl,
      lastProductIntentAt: Date.now(),
    };
  }

  function lineCheckoutDraftFromMeta(meta = {}) {
    const draft = meta?.lineCheckoutDraft;
    return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null;
  }

  function lineCheckoutCustomerFromDraft(draft = {}) {
    const customer = draft?.customer && typeof draft.customer === 'object' ? draft.customer : {};
    return {
      name: String(customer.name || '').trim().slice(0, 80),
      phone: String(customer.phone || '').trim().slice(0, 30),
      address: String(customer.address || '').trim().slice(0, 400),
      note: String(customer.note || '').trim().slice(0, 300),
      email: String(customer.email || '').trim().slice(0, 120),
      country: String(customer.country || '').trim().slice(0, 60),
    };
  }

  function lineCustomerMetaPatch(customer = {}) {
    return {
      customerName: String(customer.name || '').trim().slice(0, 80),
      customerPhone: String(customer.phone || '').trim().slice(0, 30),
      customerAddress: String(customer.address || '').trim().slice(0, 400),
      customerEmail: String(customer.email || '').trim().slice(0, 120),
    };
  }

  function lineCheckoutMissingField(customer = {}) {
    if (!String(customer.name || '').trim()) return { key: 'name', label: 'ชื่อผู้รับ' };
    if (!String(customer.phone || '').trim()) return { key: 'phone', label: 'เบอร์โทร' };
    if (!String(customer.address || '').trim()) return { key: 'address', label: 'ที่อยู่จัดส่ง' };
    return null;
  }

  function lineCheckoutFieldPrompt(field = '', draft = {}) {
    const productName = String(draft?.productName || '').trim();
    if (field === 'name') return `เริ่มสั่งซื้อ${productName ? `สินค้า ${productName}` : ''} ใน LINE แล้วค่ะ\nกรุณาพิมพ์ชื่อผู้รับ`;
    if (field === 'phone') return `ขอเบอร์โทรสำหรับติดต่อจัดส่งของ${productName ? `สินค้า ${productName}` : 'ออเดอร์นี้'}ค่ะ`;
    if (field === 'address') return `ขอที่อยู่จัดส่งแบบเต็มสำหรับ${productName ? productName : 'ออเดอร์นี้'}ค่ะ`;
    return 'กรุณาส่งข้อมูลการจัดส่งต่อได้เลยค่ะ';
  }

  function lineCheckoutActiveOrder(meta = {}) {
    return {
      orderId: String(meta?.lineActiveOrderId || '').trim(),
      accessToken: String(meta?.lineActiveOrderAccessToken || '').trim(),
      total: Number(meta?.lineActiveOrderTotal || 0),
      paymentMethod: String(meta?.lineActiveOrderPaymentMethod || '').trim(),
    };
  }

  function buildLineCheckoutPaymentMethodFlex(draft = {}) {
    const customer = lineCheckoutCustomerFromDraft(draft);
    const productName = String(draft?.productName || 'สินค้า').trim();
    return {
      type: 'flex',
      altText: 'เลือกวิธีชำระเงิน',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('ขั้นตอนที่ 2', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: `สินค้า ${productName || '-'}`, size: 'sm', color: '#5A3E00', weight: 'bold', wrap: true },
                { type: 'text', text: `ชื่อ ${customer.name || '-'}`, size: 'sm', color: '#7A6740', wrap: true },
                { type: 'text', text: `เบอร์ ${customer.phone || '-'}`, size: 'sm', color: '#7A6740', wrap: true },
                { type: 'text', text: `ที่อยู่ ${customer.address || '-'}`, size: 'xs', color: '#7A6740', wrap: true },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'เลือกวิธีชำระเงิน', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: 'เลือกวิธีที่ต้องการได้เลย โอน: ส่งสลิปในแชตนี้, บัตร: ระบบพาไปหน้าชำระของร้าน จากนั้นจะแสดงสรุปรายการก่อนยืนยันอีกครั้ง', size: 'sm', wrap: true, color: '#6B5CA5' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: LINE_CHECKOUT_PAYMENT_OPTIONS.map((option, index) => buildLineActionPill({
            label: option.label,
            action: lineMenuPostback(option.postback, option.label),
            backgroundColor: index === 0 ? '#F0E8FF' : '#FFF8EE',
            textColor: index === 0 ? '#7B5CFF' : '#6B5CA5',
            borderColor: index === 0 ? '#D8C8F6' : '#E6D9BE',
          })),
        },
      },
    };
  }

  function buildLineCheckoutSummaryFlex(draft = {}) {
    const customer = lineCheckoutCustomerFromDraft(draft);
    const productName = String(draft?.productName || 'สินค้า').trim();
    const paymentLabel = linePaymentMethodLabel(draft?.paymentMethod || '') || 'ยังไม่ได้เลือก';
    return {
      type: 'flex',
      altText: 'ยืนยันคำสั่งซื้อ',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('ขั้นตอนที่ 3', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: `สินค้า ${productName || '-'}`, size: 'sm', color: '#5A3E00', weight: 'bold', wrap: true },
                { type: 'text', text: `ชำระเงิน ${paymentLabel}`, size: 'sm', color: '#7A6740', wrap: true },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ข้อมูลผู้รับ', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: customer.name || '-', size: 'sm', color: '#5A3E00', weight: 'bold', wrap: true },
                { type: 'text', text: `โทร ${customer.phone || '-'}`, size: 'sm', color: '#7A6740', wrap: true },
                { type: 'text', text: customer.address || '-', size: 'xs', color: '#7A6740', wrap: true },
              ],
            },
            {
              type: 'text',
              text: 'ถ้าข้อมูลถูกต้อง กดปุ่มยืนยันคำสั่งซื้อได้เลย ถ้าต้องการแก้ไข สามารถเปลี่ยนที่อยู่หรือวิธีชำระได้ทันที',
              size: 'sm',
              wrap: true,
              color: '#6B5CA5',
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionPill({
              label: 'ยืนยันคำสั่งซื้อ',
              action: lineMenuPostback('customer_checkout_confirm', 'ยืนยันคำสั่งซื้อ'),
              backgroundColor: '#F0E8FF',
              textColor: '#7B5CFF',
              borderColor: '#D8C8F6',
            }),
            {
              type: 'box',
              layout: 'horizontal',
              spacing: 'sm',
              contents: [
                {
                  type: 'box',
                  layout: 'vertical',
                  flex: 1,
                  contents: [
                    buildLineActionPill({
                      label: 'แก้ไขที่อยู่',
                      action: lineMenuPostback('customer_back_to_address', 'แก้ไขที่อยู่'),
                      backgroundColor: '#FFF8EE',
                      textColor: '#6B5CA5',
                      borderColor: '#E6D9BE',
                      size: 'xs',
                    }),
                  ],
                },
                {
                  type: 'box',
                  layout: 'vertical',
                  flex: 1,
                  contents: [
                    buildLineActionPill({
                      label: 'เปลี่ยนวิธีชำระ',
                      action: lineMenuPostback('customer_back_to_payment', 'เปลี่ยนวิธีชำระ'),
                      backgroundColor: '#FFF8EE',
                      textColor: '#6B5CA5',
                      borderColor: '#E6D9BE',
                      size: 'xs',
                    }),
                  ],
                },
              ],
            },
          ],
        },
      },
    };
  }

  function buildLinePromptPayOrderFlex(order = {}, accessToken = '') {
    const qrUrl = buildPromptPayQrUrl ? buildPromptPayQrUrl(order?.id, accessToken) : '';
    const orderUrl = lineOrderUrl(order?.id, accessToken);
    return {
      type: 'flex',
      altText: `ออเดอร์ ${order?.id || ''} พร้อมชำระผ่าน PromptPay`,
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('ขั้นตอนที่ 4', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ข้อมูลบัญชีรับเงิน', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: `order_id ${String(order?.id || '-').trim() || '-'}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `ยอดชำระ ${formatLineCurrency(order?.total || 0)}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: 'สแกน QR ที่แนบไว้ด้านบนได้ทันที', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ขั้นตอนถัดไป', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: '1. โอนตามยอดที่ระบุ', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: '2. กดไปหน้าส่งสลิป แล้วแนบรูปได้ทันที', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ฉันโอนแล้ว',
                action: lineMenuPostback(`customer_checkout_confirm|${String(order?.id || '').trim()}`, 'ฉันโอนแล้ว'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
              {
                label: 'ส่งรูปสลิป',
                action: lineMenuPostback(`customer_slip_prompt|${String(order?.id || '').trim()}`, 'ส่งรูปสลิป'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
            buildLineActionRow([
              ...(qrUrl ? [{
                label: 'เปิด QR เต็มจอ',
                action: lineUriAction('เปิด QR เต็มจอ', qrUrl),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              }] : []),
              ...(orderUrl ? [{
                label: 'เปิดรายละเอียด',
                action: lineUriAction('เปิดรายละเอียด', orderUrl),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              }] : []),
            ]),
            buildLineActionRow([
              {
                label: 'ดูบัญชีอีกครั้ง',
                action: lineMenuPostback(`customer_back_to_bank|${String(order?.id || '').trim()}`, 'ดูบัญชีอีกครั้ง'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function buildLineCardOrderFlex(order = {}, checkoutUrl = '', accessToken = '') {
    const orderUrl = lineOrderUrl(order?.id, accessToken);
    return {
      type: 'flex',
      altText: `ออเดอร์ ${order?.id || ''} พร้อมชำระด้วยบัตร`,
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('คำสั่งซื้อสำเร็จ', '#2D9B5F'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#EAF7EF',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'รับคำสั่งซื้อเรียบร้อย', size: 'md', weight: 'bold', color: '#24553B' },
                { type: 'text', text: `order_id ${String(order?.id || '-').trim() || '-'}`, size: 'sm', wrap: true, color: '#24553B', weight: 'bold' },
                { type: 'text', text: `สถานะ ชำระด้วยบัตร`, size: 'sm', wrap: true, color: '#2D6A47' },
                { type: 'text', text: `ยอดรวม ${formatLineCurrency(order?.total || 0)}`, size: 'sm', wrap: true, color: '#2D6A47' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ขั้นตอนถัดไป', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: 'แตะปุ่มเปิดหน้าชำระเงิน แล้วทำรายการผ่านระบบเดิมของร้านได้ทันที', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'หลังชำระแล้ว สามารถเปิดรายละเอียดออเดอร์เพื่อติดตามสถานะต่อได้', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              ...(checkoutUrl ? [{
                label: 'เปิดหน้าชำระเงิน',
                action: lineUriAction('เปิดหน้าชำระเงิน', checkoutUrl),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              }] : []),
              ...(orderUrl ? [{
                label: 'เปิดรายละเอียด',
                action: lineUriAction('เปิดรายละเอียด', orderUrl),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              }] : []),
            ]),
            buildLineActionRow([
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function lineLegacyRedirectTarget(data = '') {
    const normalized = String(data || '').trim();
    if (!normalized) return { url: lineProductsUrl(), note: 'เปิดหน้าสินค้าหลัก' };
    if (normalized.startsWith('customer_tracking_detail|')) return { url: lineTrackUrl(), note: 'เปิดหน้าติดตามออเดอร์' };
    if (normalized.startsWith('customer_payment_select|')) return { url: publicHashUrl('/checkout'), note: 'เปิดหน้าชำระเงินบนเว็บ' };
    if (normalized.startsWith('customer_buy|') || normalized.startsWith('customer_buy_package|')) {
      return { url: lineProductsUrl(), note: 'เปิดหน้าสินค้าบนเว็บเพื่อเลือกซื้อได้ทันที' };
    }
    if (['customer_checkout_confirm', 'customer_back_to_payment', 'customer_back_to_bank', 'customer_use_saved_address', 'customer_back_to_address'].includes(normalized)) {
      return { url: publicHashUrl('/checkout'), note: 'กลับไปทำรายการสั่งซื้อบนเว็บต่อได้ทันที' };
    }
    if (['customer_back_to_packages', 'customer_slip_prompt', 'customer_retry_slip'].includes(normalized)) {
      return { url: lineProductsUrl(), note: 'เปิดหน้าสินค้าหรือเริ่มคำสั่งซื้อใหม่บนเว็บ' };
    }
    if (normalized.includes('member')) return { url: publicHashUrl('/login'), note: 'เปิดหน้าบัญชีลูกค้า' };
    return { url: lineProductsUrl(), note: 'เปิดหน้าสินค้าหลัก' };
  }

  const LINE_PRODUCT_CATEGORY_META = {
    all: { label: 'ทั้งหมด', accent: '#7B5CFF', note: 'คัดตัวเด่นจากสินค้าบนเว็บไซต์แบบอัปเดตสด' },
    sets: { label: 'ชุดเซต', accent: '#5C6BFF', note: 'เหมาะกับคนที่ต้องการความคุ้มค่าและใช้งานครบสูตร' },
    small: { label: 'ขวดเล็ก', accent: '#2D9CDB', note: 'เหมาะกับการเริ่มลองหรือใช้งบเบาแบบคล่องตัว' },
    large: { label: 'ขวดใหญ่', accent: '#8B5CF6', note: 'เหมาะกับลูกค้าที่ใช้ต่อเนื่องหรือมีพื้นที่แปลงมากขึ้น' },
    promo: { label: 'โปรโมชัน', accent: '#D97706', note: 'รวมสินค้าที่มีราคาเทียบหรือข้อเสนอเด่นในตอนนี้' },
  };

  function normalizeProductCategoryKey(product = {}) {
    const extraCategory = String(product?.extra?.category || '').trim();
    const specs = product?.specs || {};
    const sizeText = [specs['ขนาด'], specs.size, product?.name, product?.short, product?.tag, extraCategory].filter(Boolean).join(' ').toLowerCase();
    const promoSignals = [product?.tag, extraCategory, specs['ประเภท']].filter(Boolean).join(' ').toLowerCase();
    if (/(โปรโมชัน|โปรโมชั่น|promo|โปร\b)/i.test(promoSignals) || Number(product?.comparePrice || 0) > Number(product?.salePrice || product?.price || 0)) return 'promo';
    if (/(ชุดเซต|เซต|แพ็ก|pack|set)/i.test([extraCategory, product?.tag, product?.name].filter(Boolean).join(' '))) return 'sets';
    if (/(100\s*cc|100cc|ขวดเล็ก|small)/i.test(sizeText)) return 'small';
    if (/(500\s*cc|500cc|590\s*บาท|ขวดใหญ่|large)/i.test(sizeText)) return 'large';
    if (/ชุดเซต/i.test(extraCategory)) return 'sets';
    return 'all';
  }

  function filterProductsByLineCategory(products = [], categoryKey = 'all') {
    const key = String(categoryKey || 'all').trim().toLowerCase();
    if (key === 'all') return products;
    return products.filter((product) => normalizeProductCategoryKey(product) === key);
  }

  function lineCategoryBadge(label = '', color = '#7B5CFF') {
    return {
      type: 'box',
      layout: 'vertical',
      backgroundColor: color,
      cornerRadius: '12px',
      paddingStart: '8px',
      paddingEnd: '8px',
      paddingTop: '4px',
      paddingBottom: '4px',
      contents: [
        { type: 'text', text: String(label || '').slice(0, 18), size: 'xxs', color: '#FFFFFF', weight: 'bold' },
      ],
      flex: 0,
    };
  }

  function lineProductHeroOverlay(product = {}) {
    const categoryKey = normalizeProductCategoryKey(product);
    const categoryMeta = LINE_PRODUCT_CATEGORY_META[categoryKey] || LINE_PRODUCT_CATEGORY_META.all;
    const currentPrice = Number(product?.salePrice || product?.price || 0);
    const comparePrice = Number(product?.comparePrice || 0);
    const contents = [
      lineCategoryBadge(categoryMeta.label, categoryMeta.accent),
    ];
    if (comparePrice > currentPrice) {
      contents.push(lineCategoryBadge('PROMO', '#D97706'));
    }
    return {
      type: 'box',
      layout: 'horizontal',
      spacing: 'sm',
      position: 'absolute',
      offsetTop: '12px',
      offsetStart: '12px',
      contents,
    };
  }

  function lineProductHighlight(product = {}) {
    const usage = Array.isArray(product?.extra?.usageSteps) ? product.extra.usageSteps.find(Boolean) : '';
    const specSize = product?.specs?.['ขนาด'] || product?.specs?.size || '';
    return String(usage || specSize || product?.tag || '').trim().slice(0, 65);
  }

  function buildLineProductCategoryMenuFlex(selectedKey = 'all') {
    const order = ['all', 'sets', 'small', 'large', 'promo'];
    return {
      type: 'flex',
      altText: 'หมวดสินค้า LINE OA',
      contents: {
        type: 'bubble',
        size: 'giga',
        hero: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#F1E7D2',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: 'หมวดสินค้า', weight: 'bold', size: 'xl', color: '#5C4A1F' },
            { type: 'text', text: 'เลือกหมวดที่ต้องการ แล้วแตะ "ซื้อใน LINE" จากการ์ดสินค้าเพื่อทำรายการต่อได้ทันที', size: 'sm', color: '#7A6740', wrap: true, margin: 'sm' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: order.map((key) => {
            const meta = LINE_PRODUCT_CATEGORY_META[key];
            const isActive = key === selectedKey;
            return {
              type: 'box',
              layout: 'horizontal',
              justifyContent: 'center',
              alignItems: 'center',
              backgroundColor: isActive ? meta.accent : '#F7F3EA',
              borderColor: isActive ? meta.accent : '#E6D9BE',
              borderWidth: '1px',
              cornerRadius: '999px',
              paddingTop: '10px',
              paddingBottom: '10px',
              action: lineMenuPostback(`lineoa:products-category:${key}`, meta.label),
              contents: [
                {
                  type: 'text',
                  text: meta.label,
                  size: 'sm',
                  weight: 'bold',
                  color: isActive ? '#FFFFFF' : '#6B5CA5',
                  align: 'center',
                },
              ],
            };
          }),
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: (LINE_PRODUCT_CATEGORY_META[selectedKey] || LINE_PRODUCT_CATEGORY_META.all).note, size: 'xs', wrap: true, color: '#7A6740' },
            buildLineActionPill({
              label: 'กลับเมนูหลัก',
              action: lineMenuPostback('lineoa:menu', 'กลับเมนูหลัก'),
              backgroundColor: '#FFF8EE',
              textColor: '#6B5CA5',
              borderColor: '#E6D9BE',
            }),
            buildLineActionPill({
              label: 'เปิดสินค้าทั้งหมดบนเว็บ',
              action: lineUriAction('เปิดสินค้าทั้งหมดบนเว็บ', lineProductsUrl()),
              backgroundColor: '#F0E8FF',
              textColor: '#7B5CFF',
              borderColor: '#D8C8F6',
            }),
            buildLineActionPill({
              label: 'ติดต่อแอดมิน',
              action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
              backgroundColor: '#D8E7D8',
              textColor: '#2D5A40',
              borderColor: '#B7D0BE',
            }),
          ],
        },
      },
    };
  }

  async function buildLineProductShowcaseFlex(categoryKey = 'all') {
    const products = filterProductsByLineCategory((await getLineProductsCached())
      .filter((item) => item && item.active !== false)
      .sort((a, b) => (Number(a?.sort || 0) - Number(b?.sort || 0))), categoryKey)
      .slice(0, 8);
    if (!products.length) return null;
    const bubbles = products.map((product) => {
      const salePrice = Number(product?.salePrice || 0);
      const comparePrice = Number(product?.comparePrice || 0);
      const currentPrice = salePrice > 0 ? salePrice : Number(product?.price || 0);
      const imageUrl = lineProductImage(product);
      const categoryKeyOfProduct = normalizeProductCategoryKey(product);
      const categoryMeta = LINE_PRODUCT_CATEGORY_META[categoryKeyOfProduct] || LINE_PRODUCT_CATEGORY_META.all;
      const highlight = lineProductHighlight(product);
      const bodyContents = [
        {
          type: 'box',
          layout: 'horizontal',
          spacing: 'sm',
          contents: [
            lineCategoryBadge(categoryMeta.label, categoryMeta.accent),
            ...(comparePrice > currentPrice ? [lineCategoryBadge('ราคาพิเศษ', '#D97706')] : []),
          ],
        },
        { type: 'text', text: lineProductDisplayName(product), weight: 'bold', size: 'md', wrap: true, color: '#2C2158' },
        { type: 'text', text: lineProductDescription(product), size: 'xs', wrap: true, color: '#6B5CA5', margin: 'sm' },
        ...(highlight ? [{
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          backgroundColor: '#F7F4FF',
          cornerRadius: '12px',
          paddingAll: '10px',
          contents: [
            { type: 'text', text: 'Highlight', size: 'xxs', color: '#8B80B2', weight: 'bold' },
            { type: 'text', text: highlight, size: 'xs', wrap: true, color: '#3E3366', margin: 'xs' },
          ],
        }] : []),
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          contents: [
            { type: 'text', text: formatLineCurrency(currentPrice), weight: 'bold', size: 'lg', color: '#7B5CFF', flex: 0 },
            ...(comparePrice > currentPrice ? [{ type: 'text', text: formatLineCurrency(comparePrice), size: 'xs', color: '#AA9FD6', decoration: 'line-through', margin: 'md' }] : []),
          ],
        },
      ];
      const bubble = {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          paddingAll: '18px',
          contents: bodyContents,
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionPill({
              label: 'ซื้อใน LINE',
              action: lineMenuPostback(`customer_buy|${String(product?.id || '').trim()}|1`, 'ซื้อใน LINE'),
              backgroundColor: '#F0E8FF',
              textColor: '#7B5CFF',
              borderColor: '#D8C8F6',
            }),
            buildLineActionPill({
              label: 'เปิดบนเว็บ',
              action: lineUriAction('เปิดบนเว็บ', lineProductUrl(product)),
              backgroundColor: '#FFF8EE',
              textColor: '#6B5CA5',
              borderColor: '#E6D9BE',
            }),
            buildLineActionPill({
              label: 'คุยเรื่องสินค้านี้',
              action: lineMenuPostback(lineWebRoomPostbackData(product?.id), 'คุยเรื่องสินค้านี้'),
              backgroundColor: '#D8E7D8',
              textColor: '#2D5A40',
              borderColor: '#B7D0BE',
            }),
          ],
        },
      };
      if (imageUrl) {
        bubble.hero = {
          type: 'box',
          layout: 'vertical',
          paddingAll: '0px',
          height: '220px',
          contents: [
            {
              type: 'image',
              url: imageUrl,
              size: 'full',
              aspectRatio: '4:3',
              aspectMode: 'cover',
              animated: false,
            },
            lineProductHeroOverlay(product),
          ],
        };
      }
      return bubble;
    });
    bubbles.push({
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        justifyContent: 'center',
        paddingAll: '22px',
        spacing: 'md',
        contents: [
          { type: 'text', text: 'ดูสินค้าทั้งหมด', weight: 'bold', size: 'lg', color: '#2C2158' },
          { type: 'text', text: 'ข้อมูล ราคา รายละเอียด และรูปภาพชุดนี้ดึงจากเว็บไซต์โดยตรง แก้ในหลังบ้านแล้ว LINE OA อัปเดตตามทันที', wrap: true, size: 'sm', color: '#6B5CA5' },
          { type: 'text', text: 'กดซื้อใน LINE จากการ์ดสินค้าเพื่อสร้างออเดอร์ รับ QR และส่งสลิปกลับมาได้ทันที หรือจะเปิดหน้าเว็บถ้าต้องการดูรายละเอียดเต็มก็ได้', wrap: true, size: 'xs', color: '#8577B3' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildLineActionPill({
            label: 'เปิดหน้าสินค้าบนเว็บ',
            action: lineUriAction('เปิดหน้าสินค้าบนเว็บ', publicHashUrl('/products')),
            backgroundColor: '#F0E8FF',
            textColor: '#7B5CFF',
            borderColor: '#D8C8F6',
          }),
          buildLineActionPill({
            label: 'คุยกับทีมงาน',
            action: lineMenuPostback('lineoa:web-room', 'คุยกับทีมงาน'),
            backgroundColor: '#D8E7D8',
            textColor: '#2D5A40',
            borderColor: '#B7D0BE',
          }),
        ],
      },
    });
    return {
      type: 'flex',
      altText: `สินค้า${(LINE_PRODUCT_CATEGORY_META[categoryKey] || LINE_PRODUCT_CATEGORY_META.all).label}จากเว็บไซต์`,
      contents: {
        type: 'carousel',
        contents: bubbles.slice(0, 10),
      },
    };
  }

  async function listLineOrdersForUser(lineUserId = '', limit = 5) {
    const userId = String(lineUserId || '').trim();
    if (!userId) return [];
    const list = await listOrders(Math.max(30, limit * 20));
    return list
      .filter((order) => String(order?.line_user_id || '').trim() === userId)
      .slice(0, limit);
  }

  function lineOrderPrimaryProduct(order = {}) {
    const first = Array.isArray(order?.items) ? order.items[0] : null;
    return String(first?.name || order?.customer?.product || '').trim() || 'สินค้า';
  }

  function buildLegacyTrackingFlex(orders = [], latestOnly = false) {
    const target = latestOnly ? orders.slice(0, 1) : orders.slice(0, 5);
    if (!target.length) {
      return {
        type: 'flex',
        altText: 'ติดตามออเดอร์',
        contents: {
          type: 'bubble',
          size: 'mega',
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'md',
            paddingAll: '18px',
            contents: [
              lineCategoryBadge('ยังไม่มีออเดอร์', '#B68A2E'),
              { type: 'text', text: 'ติดตามออเดอร์', size: 'xl', weight: 'bold', color: '#2C2158' },
              { type: 'text', text: 'เริ่มสั่งซื้อครั้งแรกได้จากหน้าเมนูสินค้า เมื่อมีออเดอร์แล้ว ระบบจะแสดงสถานะล่าสุดให้ทันที', size: 'sm', wrap: true, color: '#6B5CA5' },
            ],
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              buildLineActionPill({
                label: 'สั่งซื้อสินค้า',
                action: lineMenuPostback('customer_product_menu', 'สั่งซื้อสินค้า'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              }),
              buildLineActionPill({
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              }),
            ],
          },
        },
      };
    }
    const summary = {
      total: target.length,
      awaiting: target.filter((order) => String(order?.status || '').trim() === 'awaiting_payment').length,
      active: target.filter((order) => ['paid', 'preparing', 'shipped'].includes(String(order?.status || '').trim())).length,
      completed: target.filter((order) => ['delivered'].includes(String(order?.status || '').trim())).length,
    };
    const bubbles = [
      {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('สรุปออเดอร์ของคุณ', '#B68A2E'),
            { type: 'text', text: 'ติดตามออเดอร์', size: 'xl', weight: 'bold', color: '#2C2158' },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: `ทั้งหมด ${summary.total}`, size: 'sm', color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `รอชำระ ${summary.awaiting} · กำลังดำเนินการ ${summary.active} · สำเร็จแล้ว ${summary.completed}`, size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ออเดอร์ล่าสุด',
                action: lineMenuPostback('customer_tracking_latest', 'ออเดอร์ล่าสุด'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
              {
                label: 'สั่งซ้ำล่าสุด',
                action: lineMenuPostback('customer_repeat_latest', 'สั่งซ้ำล่าสุด'),
                backgroundColor: '#E6E6E8',
                textColor: '#4C5164',
                borderColor: '#D4D8E0',
              },
            ]),
            buildLineActionRow([
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
            ]),
          ],
        },
      },
      ...target.map((order) => ({
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('รายการล่าสุด', '#B68A2E'),
            { type: 'text', text: String(order?.id || 'ออเดอร์'), size: 'lg', weight: 'bold', color: '#2C2158', wrap: true },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: `สินค้า ${lineOrderPrimaryProduct(order)}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `ชำระเงิน ${order?.payment_method === 'card' ? 'บัตร' : 'โอนพร้อมสลิป'}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `สถานะ ${statusLabel[order?.status] || order?.status || '-'}`, size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionPill({
              label: 'เปิดรายละเอียดออเดอร์',
              action: lineUriAction('เปิดรายละเอียดออเดอร์', lineOrderUrl(order?.id, order?.accessToken || '')),
              backgroundColor: '#F0E8FF',
              textColor: '#7B5CFF',
              borderColor: '#D8C8F6',
            }),
          ],
        },
      })),
    ];
    return {
      type: 'flex',
      altText: 'ติดตามออเดอร์',
      contents: {
        type: 'carousel',
        contents: bubbles.slice(0, 10),
      },
    };
  }

  function buildLegacyTrackingDetailFlex(order = {}) {
    const customer = order?.customer || {};
    const paymentStatus = order?.paid ? 'ชำระแล้ว' : (order?.payment_claimed ? 'รอตรวจการชำระ' : 'ยังไม่ชำระ');
    return {
      type: 'flex',
      altText: `รายละเอียดออเดอร์ ${String(order?.id || '').trim() || ''}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('ข้อมูลคำสั่งซื้อ', '#B68A2E'),
            { type: 'text', text: String(order?.id || 'รายละเอียดออเดอร์'), size: 'lg', weight: 'bold', color: '#2C2158', wrap: true },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: `สินค้า ${lineOrderPrimaryProduct(order)}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `ยอดชำระ ${formatLineCurrency(order?.total || 0)}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `วิธีชำระ ${order?.payment_method === 'card' ? 'ชำระด้วยบัตร' : 'โอนพร้อมสลิป'}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `สถานะออเดอร์ ${statusLabel[order?.status] || order?.status || '-'}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `สถานะชำระ ${paymentStatus}`, size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ข้อมูลจัดส่ง', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: `เบอร์โทร ${String(customer?.phone || '-').trim() || '-'}`, size: 'sm', wrap: true, color: '#5A3E00' },
                { type: 'text', text: `วันที่สั่ง ${formatLineDateTime(order?.createdAt || 0)}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: String(customer?.address || '-').trim() || '-', size: 'xs', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ดูออเดอร์ทั้งหมด',
                action: lineMenuPostback('customer_tracking', 'ดูออเดอร์ทั้งหมด'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'สั่งซ้ำล่าสุด',
                action: lineMenuPostback('customer_repeat_latest', 'สั่งซ้ำล่าสุด'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
            ]),
            buildLineActionRow([
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function buildLegacyMemberGuestFlex() {
    return {
      type: 'flex',
      altText: 'Member Zone',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('Member Zone', '#B68A2E'),
            { type: 'text', text: 'สิ่งที่คุณจะได้เมื่อสมัครสมาชิก', size: 'lg', weight: 'bold', color: '#2C2158', wrap: true },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'รับโปรและชุดแนะนำก่อนใคร', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'กลับมาสั่งซ้ำได้ไวจากหน้าหลัก', size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: 'คุยกับทีมงานเพื่อขอคำแนะนำได้ง่าย', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'เริ่มต้นใน 1 ข้อความ', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: 'พิมพ์: สมัครสมาชิก [ชื่อ] [เบอร์] [จังหวัด] [เกษตร] [อายุ] [ช่องทาง]', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'ตัวอย่าง: สมัครสมาชิก สมชาย 0923456789 ชลบุรี สวนทุเรียน 38 Facebook', size: 'xs', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ดูวิธีสมัคร',
                action: lineMenuPostback('customer_member_guide', 'ดูวิธีสมัคร'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
            ]),
            buildLineActionRow([
              {
                label: 'ดูโปรโมชัน',
                action: lineMenuPostback('customer_promo', 'ดูโปรโมชัน'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function buildLegacyMemberGuideFlex() {
    return {
      type: 'flex',
      altText: 'สมัครสมาชิกง่าย ๆ',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('สมัครง่ายในข้อความเดียว', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'พิมพ์: สมัครสมาชิก [ชื่อ] [เบอร์] [จังหวัด] [เกษตรที่ทำ] [อายุ] [ช่องทางรู้จัก]', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'ตัวอย่าง: สมัครสมาชิก สมชาย 09xxxxxxxx กรุงเทพมหานคร สวนข้าวโพด 30 Facebook', size: 'xs', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'สิทธิพิเศษ', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: 'ดูโปรและชุดแนะนำก่อนใคร', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'กลับมาสั่งซ้ำได้ลื่นขึ้น', size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: 'ติดต่อทีมงานได้สะดวกจาก Member Zone', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ดูโปรโมชัน',
                action: lineMenuPostback('customer_promo', 'ดูโปรโมชัน'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
            ]),
            buildLineActionRow([
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function buildLegacyMemberZoneFlex({ displayName = '', lineUserId = '', orders = [] } = {}) {
    const latest = orders[0] || {};
    const pseudoId = String(lineUserId || '').trim().slice(-6).toUpperCase() || 'LINEUSER';
    return {
      type: 'flex',
      altText: 'Member Zone',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('Member Zone', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ข้อมูลสมาชิก', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: `ชื่อ ${String(displayName || 'ลูกค้า LINE').trim()}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `รหัสสมาชิก LINE-${pseudoId}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `เข้าร่วม ${formatLineDateTime(latest?.createdAt || Date.now())}`, size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'สรุปของคุณ', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: `ออเดอร์สะสม ${orders.length}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: `ล่าสุด ${String(latest?.id || '-').trim() || '-'}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `สถานะล่าสุด ${statusLabel[latest?.status] || latest?.status || '-'}`, size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: `สินค้าเดิม ${lineOrderPrimaryProduct(latest)}`, size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'สั่งซ้ำล่าสุด',
                action: lineMenuPostback('customer_repeat_latest', 'สั่งซ้ำล่าสุด'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
              {
                label: 'ออเดอร์ล่าสุด',
                action: lineMenuPostback('customer_tracking_latest', 'ออเดอร์ล่าสุด'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
            buildLineActionRow([
              {
                label: 'ดูโปรโมชัน',
                action: lineMenuPostback('customer_promo', 'ดูโปรโมชัน'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'ติดต่อแอดมิน',
                action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
                backgroundColor: '#D8E7D8',
                textColor: '#2D5A40',
                borderColor: '#B7D0BE',
              },
            ]),
            buildLineActionRow([
              {
                label: 'เมนูสินค้า',
                action: lineMenuPostback('customer_product_menu', 'เมนูสินค้า'),
                backgroundColor: '#F0E8FF',
                textColor: '#7B5CFF',
                borderColor: '#D8C8F6',
              },
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
          ],
        },
      },
    };
  }

  function buildLegacySlipStatusFlex({
    orderId = '',
    title = '',
    body = '',
    tone = 'success',
    primaryAction = null,
    secondaryAction = null,
    tertiaryAction = null,
  } = {}) {
    const colorMap = {
      success: { badge: '#2D9B5F', card: '#EAF7EF', text: '#24553B' },
      warning: { badge: '#B68A2E', card: '#FFF8EE', text: '#5A3E00' },
      error: { badge: '#C75C5C', card: '#FCEEEE', text: '#7A3030' },
    };
    const palette = colorMap[tone] || colorMap.success;
    return {
      type: 'flex',
      altText: title || 'สถานะสลิป',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge(orderId ? `ออเดอร์ ${orderId}` : 'สถานะสลิป', palette.badge),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: palette.card,
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: title || 'อัปเดตสถานะสลิป', size: 'lg', weight: 'bold', color: palette.text, wrap: true },
                { type: 'text', text: body || '-', size: 'sm', wrap: true, color: palette.text },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            ...(primaryAction ? [buildLineActionPill({
              label: primaryAction.label,
              action: primaryAction.action,
              backgroundColor: '#F0E8FF',
              textColor: '#7B5CFF',
              borderColor: '#D8C8F6',
            })] : []),
            ...(secondaryAction ? [buildLineActionPill({
              label: secondaryAction.label,
              action: secondaryAction.action,
              backgroundColor: '#FFF8EE',
              textColor: '#6B5CA5',
              borderColor: '#E6D9BE',
            })] : []),
            ...(tertiaryAction ? [buildLineActionPill({
              label: tertiaryAction.label,
              action: tertiaryAction.action,
              backgroundColor: '#E6E6E8',
              textColor: '#4C5164',
              borderColor: '#D4D8E0',
            })] : []),
          ],
        },
      },
    };
  }

  function buildLegacySlipPromptFlex({ orderId = '', orderUrl = '' } = {}) {
    return {
      type: 'flex',
      altText: 'ส่งสลิป',
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          paddingAll: '18px',
          contents: [
            lineCategoryBadge('ขั้นตอนที่ 5', '#B68A2E'),
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#FFF8EE',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'ส่งสลิป', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: `order_id ${String(orderId || '-').trim() || '-'}`, size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: 'ถัดไป แนบรูปสลิปในแชตนี้', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              spacing: 'sm',
              backgroundColor: '#F7F3EA',
              cornerRadius: '16px',
              paddingAll: '14px',
              contents: [
                { type: 'text', text: 'แนบรูปตรงนี้ได้เลย', size: 'md', weight: 'bold', color: '#2C2158' },
                { type: 'text', text: '1. กด + แล้วเลือกรูปสลิปจากมือถือ', size: 'sm', wrap: true, color: '#5A3E00', weight: 'bold' },
                { type: 'text', text: '2. ส่งในแชตนี้ได้เลย ระบบจะตรวจสอบอัตโนมัติ', size: 'sm', wrap: true, color: '#7A6740' },
                { type: 'text', text: '3. ส่งเป็นรูปภาพเท่านั้น และถ้าไม่ผ่าน ระบบจะแจ้งให้ส่งใหม่', size: 'sm', wrap: true, color: '#7A6740' },
              ],
            },
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            buildLineActionRow([
              {
                label: 'ดูบัญชีอีกครั้ง',
                action: lineMenuPostback(`customer_back_to_bank|${String(orderId || '').trim()}`, 'ดูบัญชีอีกครั้ง'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
              {
                label: 'กลับหน้าหลัก',
                action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                backgroundColor: '#FFF8EE',
                textColor: '#6B5CA5',
                borderColor: '#E6D9BE',
              },
            ]),
            buildLineActionRow([
              ...(orderUrl ? [{
                label: 'เปิดรายละเอียด',
                action: lineUriAction('เปิดรายละเอียด', orderUrl),
                backgroundColor: '#E6E6E8',
                textColor: '#4C5164',
                borderColor: '#D4D8E0',
              }] : []),
            ]),
          ],
        },
      },
    };
  }

  function buildLegacyCatalogBubble(meta = {}, heroUrl = '') {
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          lineCategoryBadge('หมวดแนะนำวันนี้', '#B68A2E'),
          ...(heroUrl ? [{
            type: 'image',
            url: heroUrl,
            size: 'full',
            aspectRatio: '4:3',
            aspectMode: 'cover',
          }] : []),
          { type: 'text', text: String(meta?.title || 'สินค้า'), size: 'lg', weight: 'bold', color: '#2C2158', wrap: true },
          { type: 'text', text: String(meta?.subtitle || 'กดเข้าไปดูชุดสินค้าและราคาของหมวดนี้ได้ทันที'), size: 'sm', wrap: true, color: '#6B5CA5' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildLineActionPill({
            label: 'ดูชุดสินค้า',
            action: lineMenuPostback(`customer_detail|${String(meta?.key || '').trim()}`, 'ดูชุดสินค้า'),
            backgroundColor: '#F0E8FF',
            textColor: '#7B5CFF',
            borderColor: '#D8C8F6',
          }),
        ],
      },
    };
  }

  function buildLegacyCollectionIntroBubble(meta = {}, heroUrl = '') {
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          lineCategoryBadge('เลือกชุดที่เหมาะกับคุณ', '#B68A2E'),
          ...(heroUrl ? [{
            type: 'image',
            url: heroUrl,
            size: 'full',
            aspectRatio: '4:3',
            aspectMode: 'cover',
          }] : []),
          { type: 'text', text: String(meta?.title || 'สินค้า'), size: 'xl', weight: 'bold', color: '#2C2158', wrap: true },
          { type: 'text', text: String(meta?.subtitle || 'เริ่มต้นแบบสั้นและชัด เลือกชุดที่เหมาะกับคุณได้ทันที'), size: 'sm', wrap: true, color: '#6B5CA5' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildLineActionPill({
            label: 'เลือกหมวดสินค้า',
            action: lineMenuPostback('customer_product_menu', 'เลือกหมวดสินค้า'),
            backgroundColor: '#F0E8FF',
            textColor: '#7B5CFF',
            borderColor: '#D8C8F6',
          }),
          buildLineActionPill({
            label: 'กลับหน้าหลัก',
            action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
            backgroundColor: '#FFF8EE',
            textColor: '#6B5CA5',
            borderColor: '#E6D9BE',
          }),
        ],
      },
    };
  }

  function buildLegacyPackageBubble(meta = {}, product = {}) {
    const title = lineProductDisplayName(product);
    const price = Number(product?.salePrice || product?.price || 0);
    const comparePrice = Number(product?.comparePrice || 0);
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          lineCategoryBadge(String(meta?.title || 'สินค้า').slice(0, 24), '#B68A2E'),
          ...(lineProductImage(product) ? [{
            type: 'image',
            url: lineProductImage(product),
            size: 'full',
            aspectRatio: '4:3',
            aspectMode: 'cover',
          }] : []),
          { type: 'text', text: title, size: 'md', weight: 'bold', color: '#2C2158', wrap: true },
          { type: 'text', text: lineProductDescription(product), size: 'xs', wrap: true, color: '#6B5CA5' },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              { type: 'text', text: formatLineCurrency(price), size: 'lg', weight: 'bold', color: '#7B5CFF', flex: 0 },
              ...(comparePrice > price ? [{ type: 'text', text: formatLineCurrency(comparePrice), size: 'xs', color: '#AA9FD6', decoration: 'line-through' }] : []),
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildLineActionPill({
            label: 'สั่งซื้อชุดนี้',
            action: lineMenuPostback(`customer_buy_package|${String(product?.id || '').trim()}|${title}`, 'สั่งซื้อชุดนี้'),
            backgroundColor: '#F0E8FF',
            textColor: '#7B5CFF',
            borderColor: '#D8C8F6',
          }),
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  buildLineActionPill({
                    label: 'เลือกหมวด',
                    action: lineMenuPostback('customer_product_menu', 'เลือกหมวด'),
                    backgroundColor: '#FFF8EE',
                    textColor: '#6B5CA5',
                    borderColor: '#E6D9BE',
                    size: 'xs',
                  }),
                ],
              },
              {
                type: 'box',
                layout: 'vertical',
                flex: 1,
                contents: [
                  buildLineActionPill({
                    label: 'กลับหน้าหลัก',
                    action: lineMenuPostback('customer_home', 'กลับหน้าหลัก'),
                    backgroundColor: '#FFF8EE',
                    textColor: '#6B5CA5',
                    borderColor: '#E6D9BE',
                    size: 'xs',
                  }),
                ],
              },
            ],
          },
        ],
      },
    };
  }

  function buildLegacyCollectionSupportBubble(title = '') {
    return {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        paddingAll: '18px',
        contents: [
          lineCategoryBadge('พร้อมกดสั่งได้เลย', '#B68A2E'),
          { type: 'text', text: 'สั่งง่าย มั่นใจก่อนกด', size: 'xl', weight: 'bold', color: '#2C2158' },
          { type: 'text', text: `ดูชุดอื่นในหมวด ${title || 'สินค้า'} ต่อได้ หรือกดติดต่อแอดมินเพื่อให้ช่วยเลือกแพ็กที่เหมาะกับการใช้งานของคุณ`, size: 'sm', wrap: true, color: '#6B5CA5' },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          buildLineActionPill({
            label: 'ติดต่อแอดมิน',
            action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
            backgroundColor: '#D8E7D8',
            textColor: '#2D5A40',
            borderColor: '#B7D0BE',
          }),
          buildLineActionPill({
            label: 'เลือกหมวดอื่น',
            action: lineMenuPostback('customer_product_menu', 'เลือกหมวดอื่น'),
            backgroundColor: '#FFF8EE',
            textColor: '#6B5CA5',
            borderColor: '#E6D9BE',
          }),
        ],
      },
    };
  }

  async function buildLegacyProductMenuFlex() {
    const products = (await getLineProductsCached()).filter((item) => item && item.active !== false);
    const bubbles = LINE_PRODUCT_COLLECTIONS.map((meta) => {
      const hero = products.find((product) => normalizeProductCategoryKey(product) === meta.key);
      return buildLegacyCatalogBubble(meta, lineProductImage(hero || {}));
    });
    return {
      type: 'flex',
      altText: 'เมนูสินค้า',
      contents: {
        type: 'carousel',
        contents: bubbles.slice(0, 10),
      },
    };
  }

  async function buildLegacyPackageShowcaseFlex(categoryValue = '') {
    const categoryKey = resolveLineCollectionKey(categoryValue) || String(categoryValue || '').trim().toLowerCase();
    const meta = getLineCollectionMeta(categoryKey) || { key: categoryKey, title: categoryKey || 'สินค้า', subtitle: 'เลือกชุดที่เหมาะกับคุณ' };
    const products = filterProductsByLineCategory((await getLineProductsCached()).filter((item) => item && item.active !== false), meta.key).slice(0, 8);
    const hero = products[0] || {};
    const bubbles = [
      buildLegacyCollectionIntroBubble(meta, lineProductImage(hero)),
      ...products.map((product) => buildLegacyPackageBubble(meta, product)),
      buildLegacyCollectionSupportBubble(meta.title),
    ];
    return {
      type: 'flex',
      altText: `รายละเอียด ${meta.title}`,
      contents: {
        type: 'carousel',
        contents: bubbles.slice(0, 10),
      },
    };
  }

  function normalizeAdminOrderAction(value = '') {
    const normalized = String(value || '').trim().toLowerCase();
    return LINE_ADMIN_ORDER_ACTION_ALIASES[normalized] || '';
  }

  async function replyAdminOrdersSummary(replyToken, { status = '', limit = 10 } = {}) {
    const list = await listOrders(Math.max(1, Math.min(30, limit || 10)));
    const filtered = String(status || '').trim()
      ? list.filter((order) => String(order?.status || '').trim() === String(status || '').trim())
      : list;
    const target = filtered.slice(0, Math.max(1, Math.min(15, limit || 10)));
    if (!target.length) {
      await replyLineMessages(replyToken, [lineTextReply('ยังไม่พบรายการออเดอร์ตามเงื่อนไขที่เลือกค่ะ')]);
      return true;
    }
    await replyLineMessages(replyToken, [
      lineTextReply(
        target
          .map((o) => `${o.id} · ${statusLabel[o.status] || o.status} · ฿${o.total.toLocaleString()} · ${o.customer?.name || '-'}`)
          .join('\n')
      ),
    ]);
    return true;
  }

  async function handleLineAdminPostbackEvent(event = {}) {
    const data = String(event?.postback?.data || '').trim();
    if (!data) return false;
    if (data === 'admin_menu' || data === 'admin_menu|root') {
      await replyLineMessages(event.replyToken, [buildLineAdminMenuFlex()]);
      return true;
    }
    if (data.startsWith('update_status|')) {
      const [, orderId = '', rawAction = ''] = data.split('|');
      const action = normalizeAdminOrderAction(rawAction);
      if (!action) {
        await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่รู้จัก action นี้ในระบบใหม่ กรุณาจัดการต่อในหลังบ้านค่ะ')]);
        return true;
      }
      const updated = await applyOrderAction(orderId, action, '');
      if (!updated) {
        await replyLineMessages(event.replyToken, [lineTextReply(`ไม่พบออเดอร์ ${String(orderId || '').trim() || '(ไม่ระบุ)'}`)]);
        return true;
      }
      await replyLineMessages(event.replyToken, [
        lineTextReply(`อัปเดตออเดอร์ ${updated.id} เป็น ${statusLabel[updated.status] || updated.status} เรียบร้อยแล้ว`),
      ]);
      return true;
    }
    if (data.startsWith('admin_menu|')) {
      const key = data.split('|')[1] || '';
      if (LINE_ADMIN_MENU_SUMMARY_KEYS[key]) return replyAdminOrdersSummary(event.replyToken, LINE_ADMIN_MENU_SUMMARY_KEYS[key]);
      if (key === 'manual_review') {
        await replyLineMessages(event.replyToken, [lineTextReply(`เปิดคิวรอตรวจได้ที่นี่ค่ะ\n${secureAdminHashUrl('/admin/orders')}`)]);
        return true;
      }
      if (key === 'search_order_help') {
        await replyLineMessages(event.replyToken, [lineTextReply('ค้นหา order_id ได้ด้วยคำสั่ง\norderddd ORDER_ID\nหรือเปิดหลังบ้านที่เมนู Orders เพื่อค้นหาแบบละเอียดค่ะ')]);
        return true;
      }
      if (LINE_ADMIN_MENU_URL_KEYS[key]) {
        await replyLineMessages(event.replyToken, [lineTextReply(`เปิดจัดการต่อได้ที่นี่ค่ะ\n${secureAdminHashUrl(LINE_ADMIN_MENU_URL_KEYS[key])}`)]);
        return true;
      }
      await replyLineMessages(event.replyToken, [lineTextReply(`เมนูนี้ยังไม่มี action เฉพาะในระบบใหม่ สามารถจัดการต่อได้ที่นี่ค่ะ\n${secureAdminHashUrl('/admin')}`)]);
      return true;
    }
    return false;
  }

  function lineRoomLinkThrottleWindowMs() {
    return 15 * 60 * 1000;
  }

  function shouldSendLineWebRoomLink(meta = {}) {
    const lastSentAt = Number(meta?.lineRoomLinkSentAt || 0);
    if (!lastSentAt) return true;
    return (Date.now() - lastSentAt) >= lineRoomLinkThrottleWindowMs();
  }

  function buildLineWebRoomHandoffFlex(entryUrl = '', opts = {}) {
    const productName = String(opts.productName || '').trim().slice(0, 60);
    const productUrl = String(opts.productUrl || '').trim();
    return {
      type: 'flex',
      altText: productName ? `เปิดห้องแชตเพื่อคุยเรื่อง ${productName}` : 'เปิดห้องแชตกับทีมงาน',
      contents: {
        type: 'bubble',
        size: 'giga',
        hero: {
          type: 'box',
          layout: 'vertical',
          backgroundColor: '#F4F0FF',
          paddingAll: '20px',
          contents: [
            { type: 'text', text: 'Private Web Room', weight: 'bold', size: 'lg', color: '#2C2158' },
            { type: 'text', text: 'แตะปุ่มด้านล่างเพื่อคุยกับทีมงานต่อได้ทันทีแบบ realtime โดยไม่ต้องเริ่มใหม่', size: 'sm', color: '#6B5CA5', wrap: true, margin: 'sm' },
          ],
        },
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#F8F6FF',
              cornerRadius: '14px',
              paddingAll: '12px',
              contents: [
                { type: 'text', text: 'สถานะ', size: 'xxs', color: '#8B80B2', weight: 'bold' },
                { type: 'text', text: 'ข้อความของคุณถูกส่งเข้าทีมงานแล้ว', size: 'sm', color: '#2C2158', wrap: true, margin: 'xs' },
              ],
            },
            ...(productName ? [{
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#FFF8EE',
              cornerRadius: '14px',
              paddingAll: '12px',
              contents: [
                { type: 'text', text: 'สินค้าที่ลูกค้าสนใจ', size: 'xxs', color: '#B56B00', weight: 'bold' },
                { type: 'text', text: productName, size: 'sm', color: '#5A3E00', wrap: true, margin: 'xs' },
              ],
            }] : []),
          ],
        },
        footer: {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            {
              type: 'button',
              style: 'primary',
              color: '#7B5CFF',
              height: 'sm',
              action: lineUriAction('เปิดห้องแชตทันที', entryUrl),
            },
            {
              type: 'button',
              style: 'secondary',
              height: 'sm',
              action: lineUriAction(productUrl ? 'เปิดสินค้านี้บนเว็บ' : 'เปิดหน้าสินค้า', productUrl || lineProductsUrl()),
            },
          ],
        },
      },
    };
  }

  async function ensureLineWebRoomLink(source = {}, opts = {}) {
    const now = Number(opts.at || Date.now()) || Date.now();
    const synced = await syncLineInboxSession(source, {
      ...opts,
      at: now,
      metaPatch: {
        ...(opts.metaPatch || {}),
        replyMode: lineChatModeWebRoom,
        lineRoomEnabled: true,
        lineRoomLinkedAt: now,
        lineEntrySource: 'node_webhook',
      },
    });
    if (!synced?.sessionId) return null;
    const entryUrl = lineWebRoomEntryUrl({
      sessionId: synced.sessionId,
      lineUserId: String(source?.userId || '').trim(),
      customerName: synced.displayName,
      replyMode: lineChatModeWebRoom,
      issuedAt: now,
    });
    await patchChatInboxMeta(synced.sessionId, {
      replyMode: lineChatModeWebRoom,
      lineRoomEntryUrl: entryUrl,
      lineRoomLinkedAt: now,
      lineRoomLinkSentAt: now,
    });
    return { ...synced, entryUrl };
  }

  async function replyLineWebRoomLink(event = {}, source = {}, patch = {}) {
    const room = await ensureLineWebRoomLink(source, patch);
    if (!room?.entryUrl) return false;
    await replyLineMessages(event.replyToken, [
      buildLineWebRoomHandoffFlex(room.entryUrl, {
        productName: patch?.metaPatch?.lastProductName || '',
        productUrl: patch?.metaPatch?.lastProductUrl || '',
      }),
    ]);
    return true;
  }

  async function beginLineProductCheckout(event = {}, synced = null, product = null, qty = 1) {
    if (!product) {
      await replyLineMessages(event.replyToken, [lineTextReply(`ไม่พบสินค้าที่เลือกค่ะ\n${lineProductsUrl()}`)]);
      return true;
    }
    const currentMeta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const customer = {
      name: String(currentMeta.customerName || synced?.displayName || '').trim(),
      phone: String(currentMeta.customerPhone || '').trim(),
      address: String(currentMeta.customerAddress || '').trim(),
      email: String(currentMeta.customerEmail || '').trim(),
      note: '',
      country: '',
    };
    const draft = {
      items: [{ id: String(product.id || '').trim(), qty: Math.max(1, parseInt(qty, 10) || 1) }],
      productId: String(product.id || '').trim(),
      productName: lineProductDisplayName(product),
      productUrl: lineProductUrl(product),
      collectionKey: normalizeProductCategoryKey(product),
      customer,
    };
    const missing = lineCheckoutMissingField(customer);
    await patchChatInboxMeta(synced.sessionId, {
      ...lineProductIntentMetaPatch(product),
      ...lineCustomerMetaPatch(customer),
      lineCheckoutDraft: draft,
      lineCheckoutState: missing ? 'collect_customer' : 'ready_for_payment',
      lineCheckoutAwaitingField: missing?.key || '',
      lineAwaitingSlipOrderId: '',
    });
    if (missing) {
      await replyLineMessages(event.replyToken, [lineTextReply(lineCheckoutFieldPrompt(missing.key, draft))]);
      return true;
    }
    await replyLineMessages(event.replyToken, [buildLineCheckoutPaymentMethodFlex(draft)]);
    return true;
  }

  async function selectLineCheckoutPaymentMethod(event = {}, synced = null, selectedValue = '') {
    const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const draft = lineCheckoutDraftFromMeta(meta);
    if (!draft?.items?.length) {
      await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่มีรายการที่กำลังสั่งซื้อค่ะ ลองกดซื้อจากการ์ดสินค้าอีกครั้งได้เลย')]);
      return true;
    }
    const customer = lineCheckoutCustomerFromDraft(draft);
    const missing = lineCheckoutMissingField(customer);
    if (missing) {
      await patchChatInboxMeta(synced.sessionId, {
        lineCheckoutState: 'collect_customer',
        lineCheckoutAwaitingField: missing.key,
      });
      await replyLineMessages(event.replyToken, [lineTextReply(lineCheckoutFieldPrompt(missing.key, draft))]);
      return true;
    }
    const paymentMethod = normalizeLinePaymentMethod(selectedValue);
    if (!paymentMethod) {
      await replyLineMessages(event.replyToken, [lineTextReply('กรุณาเลือกวิธีชำระเงินจากปุ่มด้านล่างอีกครั้งค่ะ')]);
      return true;
    }
    const nextDraft = {
      ...draft,
      paymentMethod,
      paymentLabel: linePaymentMethodLabel(paymentMethod),
    };
    await patchChatInboxMeta(synced.sessionId, {
      lineCheckoutDraft: nextDraft,
      lineCheckoutState: 'waiting_for_checkout_confirm',
      lineCheckoutAwaitingField: '',
    });
    await replyLineMessages(event.replyToken, [buildLineCheckoutSummaryFlex(nextDraft)]);
    return true;
  }

  async function submitLineCheckoutOrder(event = {}, synced = null, paymentMethod = 'promptpay') {
    const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const draft = lineCheckoutDraftFromMeta(meta);
    if (!draft?.items?.length) {
      await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่มีรายการที่กำลังสั่งซื้อค่ะ ลองกดซื้อจากการ์ดสินค้าอีกครั้งได้เลย')]);
      return true;
    }
    const customer = lineCheckoutCustomerFromDraft(draft);
    const missing = lineCheckoutMissingField(customer);
    if (missing) {
      await patchChatInboxMeta(synced.sessionId, {
        lineCheckoutState: 'collect_customer',
        lineCheckoutAwaitingField: missing.key,
      });
      await replyLineMessages(event.replyToken, [lineTextReply(lineCheckoutFieldPrompt(missing.key, draft))]);
      return true;
    }
    const resolvedPaymentMethod = normalizeLinePaymentMethod(paymentMethod || draft?.paymentMethod || '') || 'promptpay';
    try {
      const result = await createCheckoutOrder({
        items: draft.items,
        customer,
        payment: resolvedPaymentMethod,
        sessionId: synced.sessionId,
        baseUrl: publicBaseUrl(),
        channel: 'line_oa',
        lineUserId: String(event?.source?.userId || '').trim(),
      });
      const orderId = String(result?.order?.id || '').trim();
      const accessToken = String(result?.accessToken || '').trim();
      await patchChatInboxMeta(synced.sessionId, {
        ...lineCustomerMetaPatch(customer),
        lineActiveOrderId: orderId,
        lineActiveOrderAccessToken: accessToken,
        lineActiveOrderTotal: Number(result?.order?.total || 0),
        lineActiveOrderPaymentMethod: resolvedPaymentMethod,
        lineCheckoutDraft: null,
        lineCheckoutState: resolvedPaymentMethod === 'promptpay' ? 'awaiting_payment' : '',
        lineCheckoutAwaitingField: '',
        lineAwaitingSlipOrderId: resolvedPaymentMethod === 'promptpay' ? orderId : '',
      });
      if (resolvedPaymentMethod === 'promptpay') {
        const qrUrl = buildPromptPayQrUrl ? buildPromptPayQrUrl(orderId, accessToken) : '';
        const messages = [lineTextReply(`สร้างออเดอร์ ${orderId} สำเร็จแล้วค่ะ ยอดชำระ ${formatLineCurrency(result?.order?.total || 0)}`)];
        if (qrUrl) {
          messages.push({ type: 'image', originalContentUrl: qrUrl, previewImageUrl: qrUrl });
        }
        messages.push(buildLinePromptPayOrderFlex(result.order, accessToken));
        await replyLineMessages(event.replyToken, messages);
        return true;
      }
      await replyLineMessages(event.replyToken, [buildLineCardOrderFlex(result.order, result.checkoutUrl || '', accessToken)]);
      return true;
    } catch (err) {
      await replyLineMessages(event.replyToken, [lineTextReply(err?.message || 'สร้างออเดอร์ไม่สำเร็จ')]);
      return true;
    }
  }

  async function promptLineSlipUpload(event = {}, synced = null, orderId = '') {
    const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const active = lineCheckoutActiveOrder(meta);
    const targetOrderId = String(orderId || active.orderId || '').trim();
    if (!targetOrderId) {
      await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่พบออเดอร์ล่าสุดสำหรับส่งสลิปค่ะ ลองกดซื้อสินค้าใหม่อีกครั้งได้เลย')]);
      return true;
    }
    await patchChatInboxMeta(synced.sessionId, {
      lineAwaitingSlipOrderId: targetOrderId,
      lineCheckoutState: 'awaiting_slip',
      lineCheckoutAwaitingField: '',
    });
    await replyLineMessages(event.replyToken, [buildLegacySlipPromptFlex({
      orderId: targetOrderId,
      orderUrl: lineOrderUrl(targetOrderId, active.accessToken || ''),
    })]);
    return true;
  }

  async function confirmLineOrderPayment(event = {}, synced = null, orderId = '') {
    const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const draft = lineCheckoutDraftFromMeta(meta);
    const active = lineCheckoutActiveOrder(meta);
    const targetOrderId = String(orderId || active.orderId || '').trim();
    if (!targetOrderId && draft?.items?.length) {
      return submitLineCheckoutOrder(event, synced, draft?.paymentMethod || '');
    }
    if (!targetOrderId) {
      await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่พบออเดอร์ล่าสุดค่ะ ลองกดซื้อสินค้าอีกครั้งได้เลย')]);
      return true;
    }
    try {
      const result = await claimOrderPayment(targetOrderId);
      await patchChatInboxMeta(synced.sessionId, {
        lineActiveOrderId: targetOrderId,
        lineAwaitingSlipOrderId: targetOrderId,
        lineCheckoutState: 'awaiting_slip',
      });
      await replyLineMessages(event.replyToken, [buildLegacySlipStatusFlex({
        orderId: targetOrderId,
        title: result?.alreadyPaid ? 'ออเดอร์นี้ชำระแล้วเรียบร้อย' : 'รับแจ้งการโอนแล้ว',
        body: result?.alreadyPaid
          ? 'ระบบพบว่าออเดอร์นี้ถูกยืนยันการชำระเงินแล้ว สามารถเปิดรายละเอียดออเดอร์เพื่อดูสถานะล่าสุดได้ทันที'
          : 'ถ้าสะดวกส่งรูปสลิปต่อในห้องนี้ได้เลย ระบบจะตรวจให้อัตโนมัติอีกชั้น และถ้าต้องตรวจมือ ทีมงานจะรับช่วงต่อทันที',
        tone: result?.alreadyPaid ? 'success' : 'warning',
        primaryAction: result?.alreadyPaid
          ? {
            label: 'เปิดรายละเอียดออเดอร์',
            action: lineUriAction('เปิดรายละเอียดออเดอร์', lineOrderUrl(targetOrderId, active.accessToken || '')),
          }
          : {
            label: 'ส่งสลิป',
            action: lineMenuPostback(`customer_slip_prompt|${targetOrderId}`, 'ส่งสลิป'),
          },
        secondaryAction: {
          label: 'กลับเมนูหลัก',
          action: lineMenuPostback('customer_home', 'กลับเมนูหลัก'),
        },
        tertiaryAction: !result?.alreadyPaid ? {
          label: 'ดูบัญชีอีกครั้ง',
          action: lineMenuPostback(`customer_back_to_bank|${targetOrderId}`, 'ดูบัญชีอีกครั้ง'),
        } : null,
      })]);
      return true;
    } catch (err) {
      await replyLineMessages(event.replyToken, [lineTextReply(err?.message || 'แจ้งชำระเงินไม่สำเร็จ')]);
      return true;
    }
  }

  async function handleLineCheckoutTextEvent(event = {}, synced = null) {
    const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
    const draft = lineCheckoutDraftFromMeta(meta);
    const awaitingField = String(meta?.lineCheckoutAwaitingField || '').trim();
    if (!draft || !awaitingField) return false;
    const text = String(event?.message?.text || '').trim();
    if (!text) return false;
    if (/^(ยกเลิก|cancel)$/i.test(text)) {
      await patchChatInboxMeta(synced.sessionId, {
        lineCheckoutDraft: null,
        lineCheckoutState: '',
        lineCheckoutAwaitingField: '',
      });
      await replyLineMessages(event.replyToken, [lineTextReply('ยกเลิกขั้นตอนสั่งซื้อใน LINE แล้วค่ะ ถ้าต้องการเริ่มใหม่สามารถกดซื้อจากการ์ดสินค้าได้ทันที')]);
      return true;
    }
    const customer = {
      ...lineCheckoutCustomerFromDraft(draft),
      [awaitingField]: text,
    };
    const nextDraft = { ...draft, customer };
    const missing = lineCheckoutMissingField(customer);
    await patchChatInboxMeta(synced.sessionId, {
      ...lineCustomerMetaPatch(customer),
      lineCheckoutDraft: nextDraft,
      lineCheckoutState: missing ? 'collect_customer' : 'ready_for_payment',
      lineCheckoutAwaitingField: missing?.key || '',
    });
    if (missing) {
      await replyLineMessages(event.replyToken, [lineTextReply(lineCheckoutFieldPrompt(missing.key, nextDraft))]);
      return true;
    }
    await replyLineMessages(event.replyToken, [buildLineCheckoutPaymentMethodFlex(nextDraft)]);
    return true;
  }

  async function handleLineSlipImageEvent(event = {}) {
    lineTraceStep(event, 'sync_slip_session_start');
    const synced = await syncLineInboxSession(event.source || {}, {
      at: Number(event.timestamp || Date.now()) || Date.now(),
      replyToken: String(event.replyToken || '').trim(),
      eventType: event.type,
      messageType: String(event.message?.type || '').trim(),
    });
    lineTraceStep(event, 'sync_slip_session_done');
    if (!synced) return false;
    const meta = chatInboxMetaMap()[synced.sessionId] || synced.metaPatch || {};
    const targetOrderId = String(meta?.lineAwaitingSlipOrderId || meta?.lineActiveOrderId || '').trim();
    if (!targetOrderId) return false;
    try {
      lineTraceStep(event, 'route_customer_message_start');
      await routeCustomerMessage({
        sessionId: synced.sessionId,
        name: synced.displayName,
        text: lineEventText(event),
        via: 'line_oa',
        at: Number(event.timestamp || Date.now()) || Date.now(),
        channel: 'line_oa',
        metaPatch: synced.metaPatch,
      });
      lineTraceStep(event, 'route_customer_message_done');
      lineTraceStep(event, 'fetch_line_content_start');
      const content = await fetchLineMessageContent(event?.message?.id || '');
      lineTraceStep(event, 'fetch_line_content_done', { contentType: content?.contentType || '' });
      lineTraceStep(event, 'verify_slip_start');
      const result = await verifyOrderSlip({
        orderId: targetOrderId,
        rawBase64: content.buffer.toString('base64'),
        slipMessageId: String(event?.message?.id || '').trim(),
        slipReceivedAt: new Date(Number(event?.timestamp || Date.now()) || Date.now()).toISOString(),
        source: 'line',
      });
      lineTraceStep(event, 'verify_slip_done', {
        verified: !!result?.verified,
        manualReview: !!result?.manualReview,
        alreadyPaid: !!result?.alreadyPaid,
      });
      if (result?.verified || result?.alreadyPaid) {
        await patchChatInboxMeta(synced.sessionId, {
          lineAwaitingSlipOrderId: '',
          lineCheckoutState: '',
        });
        await replyLineMessages(event.replyToken, [buildLegacySlipStatusFlex({
          orderId: targetOrderId,
          title: 'ชำระเงินยืนยันแล้ว',
          body: 'ระบบตรวจสลิปผ่านเรียบร้อยแล้ว ทีมงานจะเริ่มดำเนินการคำสั่งซื้อของคุณทันที สามารถเปิดรายละเอียดออเดอร์เพื่อติดตามสถานะต่อได้เลย',
          tone: 'success',
          primaryAction: {
            label: 'เปิดรายละเอียดออเดอร์',
            action: lineUriAction('เปิดรายละเอียดออเดอร์', lineOrderUrl(targetOrderId, String(meta?.lineActiveOrderAccessToken || '').trim())),
          },
          secondaryAction: {
            label: 'ดูออเดอร์ทั้งหมด',
            action: lineMenuPostback('customer_tracking', 'ดูออเดอร์ทั้งหมด'),
          },
        })]);
        return true;
      }
      if (result?.manualReview) {
        await patchChatInboxMeta(synced.sessionId, {
          lineAwaitingSlipOrderId: '',
          lineCheckoutState: 'manual_review',
        });
        await replyLineMessages(event.replyToken, [buildLegacySlipStatusFlex({
          orderId: targetOrderId,
          title: 'ได้รับสลิปแล้ว กำลังรอตรวจโดยทีมงาน',
          body: 'ระบบรับสลิปของคุณแล้ว แต่รายการนี้ต้องส่งให้ทีมงานตรวจอีกชั้นหนึ่ง เมื่ออัปเดตแล้วคุณสามารถเช็กสถานะต่อได้จากหน้าออเดอร์ทันที',
          tone: 'warning',
          primaryAction: {
            label: 'เปิดรายละเอียดออเดอร์',
            action: lineUriAction('เปิดรายละเอียดออเดอร์', lineOrderUrl(targetOrderId, String(meta?.lineActiveOrderAccessToken || '').trim())),
          },
          secondaryAction: {
            label: 'ติดต่อแอดมิน',
            action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
          },
        })]);
        return true;
      }
      await patchChatInboxMeta(synced.sessionId, {
        lineAwaitingSlipOrderId: targetOrderId,
        lineCheckoutState: 'awaiting_slip',
      });
      await replyLineMessages(event.replyToken, [buildLegacySlipStatusFlex({
        orderId: targetOrderId,
        title: 'ยังตรวจสลิปไม่ผ่านอัตโนมัติ',
        body: `สามารถส่งรูปใหม่อีกครั้งในห้องนี้ได้เลย${result?.error ? `\nสาเหตุ: ${result.error}` : ''}`,
        tone: 'error',
        primaryAction: {
          label: 'ส่งสลิปใหม่',
          action: lineMenuPostback(`customer_retry_slip|${targetOrderId}`, 'ส่งสลิปใหม่'),
        },
        secondaryAction: {
          label: 'ติดต่อแอดมิน',
          action: lineMenuPostback('customer_contact', 'ติดต่อแอดมิน'),
        },
      })]);
      return true;
    } catch (err) {
      await replyLineMessages(event.replyToken, [lineTextReply(`ตรวจสลิปไม่สำเร็จค่ะ ${err?.message || ''}`.trim())]);
      return true;
    }
  }

  async function handleLineCommandAction(event = {}, synced = null, action = '') {
    if (!action) return false;
    const messagesByAction = {
      menu: [buildLineMainMenuFlex()],
      reviews: [buildLineShortcutFlex({
        eyebrow: 'REVIEWS',
        title: 'รีวิวลูกค้า',
        body: 'รวมรีวิวลูกค้าจริงและผลลัพธ์การใช้งานไว้ให้เปิดดูต่อได้ทันที',
        primaryLabel: 'เปิดหน้ารีวิว',
        primaryAction: lineUriAction('เปิดหน้ารีวิว', lineReviewsUrl()),
        secondaryLabel: 'กลับเมนูหลัก',
        secondaryAction: lineMenuPostback('lineoa:menu', 'กลับเมนูหลัก'),
      })],
      articles: [buildLineShortcutFlex({
        eyebrow: 'ARTICLES',
        title: 'บทความ',
        body: 'รวมบทความความรู้และแนวทางใช้งานสินค้าแบบอ่านง่ายในหน้าเดียว',
        primaryLabel: 'เปิดบทความ',
        primaryAction: lineUriAction('เปิดบทความ', publicHashUrl('/articles')),
        secondaryLabel: 'กลับเมนูหลัก',
        secondaryAction: lineMenuPostback('lineoa:menu', 'กลับเมนูหลัก'),
      })],
      about: [buildLineShortcutFlex({
        eyebrow: 'ABOUT BRAND',
        title: 'เกี่ยวกับแบรนด์',
        body: 'รู้จักคุณจูนและแนวทางของแบรนด์เพิ่มเติมจากหน้าแนะนำได้เลย',
        primaryLabel: 'เปิดหน้าเกี่ยวกับแบรนด์',
        primaryAction: lineUriAction('เปิดหน้าเกี่ยวกับแบรนด์', publicHashUrl('/about')),
        secondaryLabel: 'กลับเมนูหลัก',
        secondaryAction: lineMenuPostback('lineoa:menu', 'กลับเมนูหลัก'),
      })],
      account: [buildLineShortcutFlex({
        eyebrow: 'MEMBER',
        title: 'บัญชีลูกค้า',
        body: 'เข้าสู่ระบบ ดูข้อมูลสมาชิก และติดตามรายการของคุณต่อได้จากหน้า member',
        primaryLabel: 'เปิดบัญชีลูกค้า',
        primaryAction: lineUriAction('เปิดบัญชีลูกค้า', publicHashUrl('/login')),
        secondaryLabel: 'กลับเมนูหลัก',
        secondaryAction: lineMenuPostback('lineoa:menu', 'กลับเมนูหลัก'),
      })],
    };
    const productActionCategoryMap = {
      products: 'all',
      products_sets: 'sets',
      products_small: 'small',
      products_large: 'large',
      products_promo: 'promo',
    };
    if (productActionCategoryMap[action]) {
      const categoryKey = productActionCategoryMap[action];
      if (categoryKey === 'all') {
        await replyLineMessages(event.replyToken, [await buildLegacyProductMenuFlex()]);
        return true;
      }
      const showcase = await buildLegacyPackageShowcaseFlex(categoryKey);
      if (showcase) return replyLineMessages(event.replyToken, [showcase]);
      await replyLineMessages(event.replyToken, [lineTextReply(`ดูสินค้าได้ที่นี่ค่ะ\n${publicHashUrl('/products')}`)]);
      return true;
    }
    if (action === 'track') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 5);
      await replyLineMessages(event.replyToken, [buildLegacyTrackingFlex(orders, false)]);
      return true;
    }
    if (action === 'account') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 5);
      const message = orders.length
        ? buildLegacyMemberZoneFlex({
          displayName: synced?.displayName || '',
          lineUserId: String(event?.source?.userId || '').trim(),
          orders,
        })
        : buildLegacyMemberGuestFlex();
      await replyLineMessages(event.replyToken, [message]);
      return true;
    }
    if (action === 'web_room') {
      return replyLineWebRoomLink(event, event.source || {}, {
        at: Number(event.timestamp || Date.now()) || Date.now(),
        customerName: synced?.displayName || '',
        replyToken: String(event.replyToken || '').trim(),
        eventType: event.type,
        messageType: String(event.message?.type || '').trim(),
        metaPatch: synced?.metaPatch || {},
      });
    }
    const messages = messagesByAction[action];
    if (!messages?.length) return false;
    await replyLineMessages(event.replyToken, messages);
    return true;
  }

  async function handleLinePostbackEvent(event = {}) {
    const data = String(event?.postback?.data || '').trim();
    if (!data) return false;
    const synced = await syncLineInboxSession(event.source || {}, {
      at: Number(event.timestamp || Date.now()) || Date.now(),
      replyToken: String(event.replyToken || '').trim(),
      eventType: event.type,
      messageType: 'postback',
    });
    if (data === 'lineoa:products-showcase') {
      return handleLineCommandAction(event, synced, 'products');
    }
    if (data === 'customer_tracking') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 5);
      await replyLineMessages(event.replyToken, [buildLegacyTrackingFlex(orders, false)]);
      return true;
    }
    if (data.startsWith('customer_tracking_detail|')) {
      const [, orderId = ''] = data.split('|');
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 20);
      const target = orders.find((order) => String(order?.id || '').trim() === String(orderId || '').trim());
      if (!target) {
        await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่พบออเดอร์ที่เลือกค่ะ ลองเปิดรายการล่าสุดอีกครั้งได้เลย')]);
        return true;
      }
      await replyLineMessages(event.replyToken, [buildLegacyTrackingDetailFlex(target)]);
      return true;
    }
    if (data === 'customer_tracking_latest' || data === 'customer_order_history') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 5);
      await replyLineMessages(event.replyToken, [buildLegacyTrackingFlex(orders, true)]);
      return true;
    }
    if (data === 'customer_repeat_latest') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 1);
      const latestOrder = orders[0];
      const latestProductId = String(latestOrder?.items?.[0]?.id || '').trim();
      const product = await findLineProductById(latestProductId);
      if (!product) {
        await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่พบข้อมูลสินค้าที่สั่งล่าสุดค่ะ ลองเลือกสินค้าใหม่จากเมนูสินค้าได้เลย')]);
        return true;
      }
      return beginLineProductCheckout(event, synced, product, latestOrder?.items?.[0]?.qty || 1);
    }
    if (data === 'customer_member_zone') {
      const orders = await listLineOrdersForUser(String(event?.source?.userId || '').trim(), 5);
      const message = orders.length
        ? buildLegacyMemberZoneFlex({
          displayName: synced?.displayName || '',
          lineUserId: String(event?.source?.userId || '').trim(),
          orders,
        })
        : buildLegacyMemberGuestFlex();
      await replyLineMessages(event.replyToken, [message]);
      return true;
    }
    if (data === 'customer_member_guide') {
      await replyLineMessages(event.replyToken, [buildLegacyMemberGuideFlex()]);
      return true;
    }
    if (data === 'customer_contact') {
      return replyLineWebRoomLink(event, event.source || {}, {
        at: Number(event.timestamp || Date.now()) || Date.now(),
        customerName: synced?.displayName || '',
        replyToken: String(event.replyToken || '').trim(),
        eventType: event.type,
        messageType: 'postback',
        metaPatch: synced?.metaPatch || {},
      });
    }
    if (data.startsWith('customer_detail|')) {
      const collectionKey = resolveLineCollectionKey(data.split('|')[1] || '');
      if (!collectionKey) {
        await replyLineMessages(event.replyToken, [lineTextReply('ยังไม่พบหมวดสินค้าที่เลือกค่ะ ลองเปิดเมนูสินค้าใหม่อีกครั้งได้เลย')]);
        return true;
      }
      await replyLineMessages(event.replyToken, [await buildLegacyPackageShowcaseFlex(collectionKey)]);
      return true;
    }
    if (data.startsWith('lineoa:web-room:product:')) {
      const productId = String(data.split(':').slice(3).join(':') || '').trim();
      const product = await findLineProductById(productId);
      return replyLineWebRoomLink(event, event.source || {}, {
        at: Number(event.timestamp || Date.now()) || Date.now(),
        customerName: synced?.displayName || '',
        replyToken: String(event.replyToken || '').trim(),
        eventType: event.type,
        messageType: 'postback',
        metaPatch: {
          ...(synced?.metaPatch || {}),
          ...(product ? lineProductIntentMetaPatch(product) : {}),
        },
      });
    }
    if (data.startsWith('lineoa:products-category:')) {
      const categoryKey = String(data.split(':')[2] || '').trim().toLowerCase();
      if (!categoryKey || categoryKey === 'all') return handleLineCommandAction(event, synced, 'products');
      await replyLineMessages(event.replyToken, [await buildLegacyPackageShowcaseFlex(categoryKey)]);
      return true;
    }
    if (data.startsWith('customer_buy|') || data.startsWith('customer_buy_package|')) {
      const [, productId = '', rawQty = '1'] = data.split('|');
      const product = await findLineProductById(productId);
      return beginLineProductCheckout(event, synced, product, rawQty);
    }
    if (data.startsWith('customer_payment_select|')) {
      const [, method = 'promptpay'] = data.split('|');
      return selectLineCheckoutPaymentMethod(event, synced, method);
    }
    if (data === 'customer_checkout_confirm' || data.startsWith('customer_checkout_confirm|')) {
      const [, orderId = ''] = data.split('|');
      return confirmLineOrderPayment(event, synced, orderId);
    }
    if (
      data === 'customer_slip_prompt'
      || data === 'customer_retry_slip'
      || data.startsWith('customer_slip_prompt|')
      || data.startsWith('customer_retry_slip|')
    ) {
      const [, orderId = ''] = data.split('|');
      return promptLineSlipUpload(event, synced, orderId);
    }
    if (data === 'customer_back_to_payment') {
      const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
      const draft = lineCheckoutDraftFromMeta(meta);
      if (draft) {
        await replyLineMessages(event.replyToken, [buildLineCheckoutPaymentMethodFlex(draft)]);
        return true;
      }
    }
    if (data === 'customer_back_to_bank' || data.startsWith('customer_back_to_bank|')) {
      const [, orderId = ''] = data.split('|');
      const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
      const active = lineCheckoutActiveOrder(meta);
      const targetOrderId = String(orderId || active.orderId || '').trim();
      const accessToken = String(active.accessToken || '').trim();
      if (targetOrderId) {
        await replyLineMessages(event.replyToken, [buildLinePromptPayOrderFlex({
          id: targetOrderId,
          total: active.total || 0,
          payment_method: active.paymentMethod || 'promptpay',
        }, accessToken)]);
        return true;
      }
    }
    if (data === 'customer_back_to_address') {
      const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
      const draft = lineCheckoutDraftFromMeta(meta);
      if (draft) {
        const missing = lineCheckoutMissingField(lineCheckoutCustomerFromDraft(draft)) || { key: 'address' };
        await patchChatInboxMeta(synced.sessionId, {
          lineCheckoutState: 'collect_customer',
          lineCheckoutAwaitingField: missing.key,
        });
        await replyLineMessages(event.replyToken, [lineTextReply(lineCheckoutFieldPrompt(missing.key, draft))]);
        return true;
      }
    }
    if (data === 'customer_use_saved_address') {
      const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
      const draft = lineCheckoutDraftFromMeta(meta);
      if (draft) {
        await replyLineMessages(event.replyToken, [buildLineCheckoutPaymentMethodFlex(draft)]);
        return true;
      }
    }
    if (data === 'customer_back_to_packages') {
      const meta = chatInboxMetaMap()[synced?.sessionId || ''] || synced?.metaPatch || {};
      const draft = lineCheckoutDraftFromMeta(meta);
      const collectionKey = resolveLineCollectionKey(draft?.collectionKey || '') || 'sets';
      await replyLineMessages(event.replyToken, [await buildLegacyPackageShowcaseFlex(collectionKey)]);
      return true;
    }
    if (LINE_CUSTOMER_LEGACY_POSTBACK_ACTIONS[data]) {
      return handleLineCommandAction(event, synced, LINE_CUSTOMER_LEGACY_POSTBACK_ACTIONS[data]);
    }
    if (LINE_CUSTOMER_TRACKING_PREFIXES.some((prefix) => data.startsWith(prefix))) {
      return handleLineCommandAction(event, synced, 'track');
    }
    if (
      LINE_CUSTOMER_WEB_REDIRECT_PREFIXES.some((prefix) => data.startsWith(prefix))
      || LINE_CUSTOMER_WEB_REDIRECT_EXACT.includes(data)
    ) {
      const target = lineLegacyRedirectTarget(data);
      await replyLineMessages(event.replyToken, [
        lineTextReply(`เมนูนี้ถูกย้ายขึ้นระบบใหม่แล้วค่ะ ${target.note}\n${target.url}`),
      ]);
      return true;
    }
    if (data.startsWith('customer_') || data.startsWith('lineoa:')) {
      await replyLineMessages(event.replyToken, [
        lineTextReply(`เมนูเดิมนี้ถูกพาเข้าระบบใหม่แล้ว สามารถเลือกต่อได้จากเมนูหลักหรือหน้าเว็บค่ะ\nเส้นทางหลักตอนนี้: ดูสินค้า, คุยกับทีมงาน, ติดตามออเดอร์\n${publicHashUrl('/')}`),
      ]);
      return true;
    }
    return false;
  }

  async function handleLineFollowEvent(event = {}) {
    const synced = await syncLineInboxSession(event.source || {}, {
      at: Number(event.timestamp || Date.now()) || Date.now(),
      replyToken: String(event.replyToken || '').trim(),
      eventType: event.type,
      messageType: 'follow',
    });
    if (!synced) return false;
    await replyLineMessages(event.replyToken, [
      lineTextReply('สวัสดีค่ะ ยินดีต้อนรับสู่ LINE OA ของคุณจูนนุชฟอร์ไลฟ์ เลือกดูสินค้า, คุยกับทีมงาน, หรือเช็กออเดอร์ได้ทันทีจากเมนูด้านล่างเลยค่ะ'),
      buildLineMainMenuFlex(),
    ]);
    return true;
  }

  async function processLineWebhookEvent(event = {}) {
    if (!event || typeof event !== 'object') return;
    lineTraceStep(event, 'process_event_start');
    if (event.type === 'follow') {
      lineTraceStep(event, 'handle_follow_start');
      await handleLineFollowEvent(event);
      lineTraceStep(event, 'handle_follow_done');
      return;
    }
    if (isLineAdminSource(event.source) && event.type === 'postback') {
      lineTraceStep(event, 'admin_postback_start');
      if (await handleLineAdminPostbackEvent(event)) return;
    }
    if (event.type === 'postback') {
      lineTraceStep(event, 'postback_start');
      if (await handleLinePostbackEvent(event)) return;
    }
    if (event.type === 'message' && event.message?.type === 'text' && isLineAdminSource(event.source)) {
      lineTraceStep(event, 'admin_text_start');
      await handleAdminMessage(String(event.message.text || '').trim());
      lineTraceStep(event, 'admin_text_done');
      return;
    }
    if (event.type === 'message' && event.message?.type === 'image') {
      lineTraceStep(event, 'image_handler_start');
      if (await handleLineSlipImageEvent(event)) return;
    }
    if (event.type === 'follow' || event.type === 'message') {
      const previewText = lineEventText(event);
      lineTraceStep(event, 'sync_session_start');
      const synced = await syncLineInboxSession(event.source || {}, {
        at: Number(event.timestamp || Date.now()) || Date.now(),
        replyToken: String(event.replyToken || '').trim(),
        eventType: event.type,
        messageType: String(event.message?.type || '').trim(),
      });
      lineTraceStep(event, 'sync_session_done');
      if (!synced) return;
      if (previewText) {
        lineTraceStep(event, 'route_customer_message_start');
        await routeCustomerMessage({
          sessionId: synced.sessionId,
          name: synced.displayName,
          text: previewText,
          via: 'line_oa',
          at: Number(event.timestamp || Date.now()) || Date.now(),
          channel: 'line_oa',
          metaPatch: synced.metaPatch,
        });
        lineTraceStep(event, 'route_customer_message_done');
        if (event.type === 'message' && event.message?.type === 'text') {
          const action = resolveLineCommandAction(previewText);
          if (action) {
            lineTraceStep(event, 'command_action_start', { action });
            await handleLineCommandAction(event, synced, action);
            return;
          }
          lineTraceStep(event, 'checkout_text_start');
          if (await handleLineCheckoutTextEvent(event, synced)) {
            return;
          }
          if (
            lineChatMode() === lineChatModeWebRoom
            && shouldSendLineWebRoomLink(chatInboxMetaMap()[synced.sessionId] || synced.metaPatch || {})
          ) {
            lineTraceStep(event, 'web_room_link_start');
            await replyLineWebRoomLink(event, event.source || {}, {
              at: Number(event.timestamp || Date.now()) || Date.now(),
              customerName: synced.displayName,
              replyToken: String(event.replyToken || '').trim(),
              eventType: event.type,
              messageType: String(event.message?.type || '').trim(),
              metaPatch: synced.metaPatch,
            });
            return;
          }
        }
        return;
      }
      lineTraceStep(event, 'emit_admin_inbox_update_start');
      await emitAdminInboxUpdate({ type: 'customer_message', sessionId: synced.sessionId, name: synced.displayName });
    }
  }

  function verifyLineWebhookSignature(rawBody, signature = '') {
    const secret = lineChannelSecret();
    if (!secret || !rawBody || !signature) return false;
    const computed = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
    const left = Buffer.from(String(computed || ''), 'utf8');
    const right = Buffer.from(String(signature || '').trim(), 'utf8');
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  }

  async function handleLineWebhookRequest(req, res) {
    if (!lineChannelSecret()) {
      if (recordSystemEvent) {
        await recordSystemEvent({
          level: 'error',
          source: 'line_webhook',
          type: 'missing_secret',
          message: 'LINE webhook ถูกเรียกแต่ยังไม่มี channel secret',
          alert: true,
          dedupeKey: 'line_webhook:missing_secret',
        });
      }
      return res.status(200).end();
    }
    if (!verifyLineWebhookSignature(req.body, req.headers['x-line-signature'])) {
      if (recordLineWebhookAudit) {
        await recordLineWebhookAudit({
          result: 'signature_rejected',
          note: 'invalid x-line-signature',
        });
      }
      return res.status(401).end();
    }
    let body;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch {
      if (recordLineWebhookAudit) {
        await recordLineWebhookAudit({
          result: 'parse_failed',
          note: 'invalid json body',
        });
      }
      if (recordSystemEvent) {
        await recordSystemEvent({
          level: 'error',
          source: 'line_webhook',
          type: 'parse_failed',
          message: 'LINE webhook parse body ไม่สำเร็จ',
          alert: true,
          dedupeKey: 'line_webhook:parse_failed',
        });
      }
      return;
    }
    const bodyEvents = Array.isArray(body?.events) ? body.events : [];
    const requestTraceStartedAt = Date.now();
    await ensureSettingsFresh();
    // audit แบบไม่ block เส้นทางตอบลูกค้า — เก็บ promise ไว้รอปิดงานก่อนตอบ 200
    // (บน serverless ห้ามปล่อยลอยหลังส่ง response เพราะ instance ถูก freeze)
    const pendingAudits = [];
    const auditNonBlocking = (entry) => {
      if (!recordLineWebhookAudit) return;
      pendingAudits.push(Promise.resolve().then(() => recordLineWebhookAudit(entry)).catch(() => {}));
    };
    // ขนานข้ามลูกค้า แต่เรียงลำดับภายใน source เดียวกัน (ข้อความคนเดิมต้องไม่สลับกัน)
    const eventGroups = new Map();
    for (const event of bodyEvents) {
      const groupKey = lineSourceKey(event?.source || {}) || `anon:${eventGroups.size}`;
      if (!eventGroups.has(groupKey)) eventGroups.set(groupKey, []);
      eventGroups.get(groupKey).push(event);
    }
    await Promise.all([...eventGroups.values()].map(async (groupEvents) => {
      for (const event of groupEvents) {
        await handleSingleLineWebhookEvent(event, {
          bodyEventCount: bodyEvents.length,
          requestTraceStartedAt,
          auditNonBlocking,
        });
      }
    }));
    await Promise.allSettled(pendingAudits);
    return res.status(200).end();
  }

  async function handleSingleLineWebhookEvent(event, { bodyEventCount = 1, requestTraceStartedAt = Date.now(), auditNonBlocking = () => {} } = {}) {
    const eventStartedAt = Date.now();
    const eventType = String(event?.type || '').trim();
    const messageType = String(event?.message?.type || '').trim();
    const textPreview = lineEventText(event).slice(0, 160);
    const sourceKey = lineSourceKey(event?.source || {});
    let eventKey = '';
    try {
      event.__lineTrace = createLineTrace(event);
      bindLineTrace(event, event.__lineTrace);
      lineTraceStep(event, 'request_verify_done', { bodyEventCount });
      lineTraceStep(event, 'settings_ready', { elapsedMs: Math.max(0, eventStartedAt - requestTraceStartedAt) });
      if (ensureLineWebhookEventIdempotency) {
        lineTraceStep(event, 'idempotency_start');
        const idempotency = await ensureLineWebhookEventIdempotency(event);
        lineTraceStep(event, 'idempotency_done', { duplicate: !!idempotency?.duplicate });
        eventKey = String(idempotency?.eventKey || '').trim();
        if (idempotency?.duplicate) {
          auditNonBlocking({
            eventKey,
            eventType,
            sourceKey,
            messageType,
            textPreview,
            result: 'duplicate',
            note: 'duplicate webhook event skipped',
            durationMs: Date.now() - eventStartedAt,
          });
          await flushLineTrace(event, { result: 'success', eventKey });
          releaseLineTrace(event);
          return;
        }
      }
      await processLineWebhookEvent(event);
      await flushLineTrace(event, { result: 'success', eventKey });
      auditNonBlocking({
        eventKey,
        eventType,
        sourceKey,
        messageType,
        textPreview,
        result: 'success',
        durationMs: Date.now() - eventStartedAt,
      });
    } catch (err) {
      await flushLineTrace(event, { result: 'failed', eventKey, error: err?.message || String(err || '') });
      auditNonBlocking({
        eventKey,
        eventType,
        sourceKey,
        messageType,
        textPreview,
        result: 'failed',
        error: err?.message || String(err || ''),
        durationMs: Date.now() - eventStartedAt,
      });
      if (recordSystemEvent) {
        await recordSystemEvent({
          level: 'error',
          source: 'line_webhook',
          type: 'event_failed',
          message: `LINE webhook event fail: ${err?.message || 'unknown error'}`,
          data: {
            eventKey,
            eventType,
            messageType,
            sourceKey,
            textPreview,
          },
          alert: true,
          dedupeKey: `line_webhook:${eventType}:${messageType || 'none'}`,
        });
      }
      logger.error('[line] webhook event fail:', err?.message || err);
    } finally {
      releaseLineTrace(event);
    }
  }

  return {
    handleLineWebhookRequest,
    processLineWebhookEvent,
    verifyLineWebhookSignature,
  };
}
