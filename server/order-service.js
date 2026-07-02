export function createOrderService(deps = {}) {
  const {
    cfg,
    stripeClient,
    createCardCheckoutSession,
    buildPromptPay,
    reservationExpiresAt,
    listProductsByIds,
    effPrice,
    evalCoupon,
    shippingFor,
    reserveOrderResources,
    releaseOrderResources,
    createOrder,
    getOrder,
    updateOrder,
    getPaymentLog,
    upsertPaymentLog,
    markOrderPaid,
    pushToAdmin,
    sendMail,
    orderEmailHTML,
    siteValue,
    patchChatInboxMeta,
    emitAdminInboxUpdate,
    normalizeChatSessionId,
    newOrderAccessToken,
    verifySlipWithSlipok,
    normalizeSlipokResult,
    isSlipokManualReviewCode,
    isSlipokVerificationFailureCode,
    clientOrder,
    statusLabel,
  } = deps;

  function assertCustomer(customer = {}) {
    if (!customer?.name?.trim() || !customer?.phone?.trim() || !customer?.address?.trim()) {
      throw new Error('กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบ');
    }
  }

  function normalizeCustomer(customer = {}) {
    const country = String(customer.country || '').trim().slice(0, 60);
    return {
      name: String(customer.name || '').trim().slice(0, 80),
      phone: String(customer.phone || '').trim().slice(0, 30),
      address: String(customer.address || '').trim().slice(0, 400),
      note: String(customer.note || '').trim().slice(0, 300),
      email: String(customer.email || '').trim().slice(0, 120),
      country,
    };
  }

  function newOrderId() {
    return 'VYU-' + (Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).toUpperCase().slice(-7);
  }

  async function buildDetailedOrderItems(items = []) {
    if (!Array.isArray(items) || !items.length) throw new Error('ไม่มีสินค้าในคำสั่งซื้อ');
    let subtotal = 0;
    const detailed = [];
    const lines = [];
    const productMap = new Map((await listProductsByIds(items.map((it) => it?.id), false)).map((product) => [product.id, product]));
    for (const it of items) {
      const product = productMap.get(String(it?.id || ''));
      if (!product || !product.active) continue;
      const qty = Math.max(1, Math.min(99, parseInt(it?.qty, 10) || 1));
      if (product.stock <= 0) throw new Error(`"${product.name}" สินค้าหมดแล้ว`);
      if (product.stock < qty) throw new Error(`"${product.name}" เหลือเพียง ${product.stock} ชิ้น`);
      const unit = effPrice(product);
      subtotal += unit * qty;
      detailed.push({ id: product.id, name: product.name, price: unit, qty });
      lines.push(`• ${product.name} x${qty} = ฿${(unit * qty).toLocaleString()}`);
    }
    if (!detailed.length) throw new Error('รายการสินค้าไม่ถูกต้อง');
    return { subtotal, detailed, lines };
  }

  async function createCheckoutOrder({
    items,
    customer,
    payment,
    sessionId = '',
    coupon = '',
    userId = '',
    baseUrl = '',
    channel = 'web',
    lineUserId = '',
  } = {}) {
    assertCustomer(customer);
    const method = payment === 'card' ? 'card' : 'promptpay';
    const stripe = stripeClient();
    if (method === 'card' && !stripe) throw new Error('ระบบบัตรยังไม่พร้อม (ยังไม่ได้ตั้งค่า Stripe)');
    if (method === 'promptpay' && !cfg('PROMPTPAY_ID')) throw new Error('ระบบ PromptPay ยังไม่พร้อม (ยังไม่ได้ตั้งค่า PromptPay ID)');

    const { subtotal, detailed, lines } = await buildDetailedOrderItems(items);
    const normalizedCustomer = normalizeCustomer(customer);
    const couponResult = await evalCoupon(coupon, subtotal);
    if (!couponResult.ok) throw new Error(couponResult.error || 'คูปองไม่ถูกต้อง');
    const discount = couponResult.discount || 0;
    const shipping = shippingFor(normalizedCustomer.country, subtotal - discount);
    const total = subtotal - discount + shipping;
    const id = newOrderId();
    const accessToken = newOrderAccessToken();
    const normalizedSessionId = normalizeChatSessionId(typeof sessionId === 'string' ? sessionId : '');
    const reservedCoupon = couponResult.coupon || '';

    let stripeSession = null;
    let reserved = false;
    try {
      if (method === 'card') {
        stripeSession = await createCardCheckoutSession({
          id,
          stripe,
          base: String(baseUrl || '').trim(),
          subtotal,
          discount,
          shipping,
        });
      }
      await reserveOrderResources({ items: detailed, coupon: reservedCoupon });
      reserved = true;

      const order = await createOrder({
        id,
        items: detailed,
        total,
        subtotal,
        discount,
        shipping,
        coupon: reservedCoupon,
        customer: normalizedCustomer,
        payment_method: method,
        status: 'awaiting_payment',
        paid: false,
        session_id: normalizedSessionId,
        user_id: String(userId || '').trim(),
        stripe_session: stripeSession?.id || '',
        access_token: accessToken,
        resources_reserved: true,
        channel: String(channel || 'web').trim() || 'web',
        line_user_id: String(lineUserId || '').trim(),
      });

      if (normalizedSessionId) {
        await patchChatInboxMeta(normalizedSessionId, {
          customerName: normalizedCustomer.name,
          customerPhone: normalizedCustomer.phone,
          customerEmail: normalizedCustomer.email || '',
          orderId: order.id,
          lineActiveOrderId: order.id,
          lineActiveOrderAccessToken: accessToken,
          lineCheckoutState: '',
          lineCheckoutAwaitingField: '',
        });
        await emitAdminInboxUpdate({ type: 'order_linked', sessionId: normalizedSessionId, orderId: order.id });
      }

      await pushToAdmin(
        `🛒 ออเดอร์ใหม่  ${id}\n${lines.join('\n')}${discount ? `\nส่วนลด (${couponResult.coupon}): -฿${discount.toLocaleString()}` : ''}\nค่าส่ง: ฿${shipping.toLocaleString()}\nรวม: ฿${total.toLocaleString()}\n\n👤 ${normalizedCustomer.name}\n📞 ${normalizedCustomer.phone}${normalizedCustomer.email ? `\n✉️ ${normalizedCustomer.email}` : ''}\n📦 ${normalizedCustomer.address}${normalizedCustomer.country ? ` (${normalizedCustomer.country})` : ''}\n💳 ${method === 'card' ? 'บัตร' : 'PromptPay'}${normalizedCustomer.note ? `\n📝 ${normalizedCustomer.note}` : ''}\nช่องทาง: ${channel === 'line_oa' ? 'LINE OA' : 'เว็บไซต์'}\n\nสถานะ: รอชำระเงิน`
      );
      if (normalizedCustomer.email) {
        await sendMail(
          normalizedCustomer.email,
          `ยืนยันคำสั่งซื้อ ${id} · ${siteValue('SITE_NAME')}`,
          orderEmailHTML(order, 'ได้รับคำสั่งซื้อของคุณแล้ว 🎉')
        );
      }

      const extra = method === 'card'
        ? { checkoutUrl: stripeSession?.url || '' }
        : { promptpay: await buildPromptPay(total) };

      return { ok: true, order, accessToken, ...extra };
    } catch (err) {
      if (reserved) {
        try {
          await releaseOrderResources({ items: detailed, coupon: reservedCoupon });
        } catch {}
      }
      throw err;
    }
  }

  async function getClientOrderDetails(orderId) {
    const order = await getOrder(orderId);
    if (!order) return null;
    const out = { ...clientOrder(order), statusLabel: statusLabel[order.status] || order.status, expiresAt: reservationExpiresAt(order) };
    if (order.payment_method === 'promptpay' && !order.paid && order.status === 'awaiting_payment') {
      out.promptpay = await buildPromptPay(order.total);
    }
    const paymentLog = await getPaymentLog(order.id);
    if (paymentLog) out.paymentLog = paymentLog;
    return out;
  }

  async function claimPayment(orderId) {
    const order = await getOrder(orderId);
    if (!order) throw new Error('ไม่พบคำสั่งซื้อ');
    if (order.paid) return { order, alreadyPaid: true };
    const updated = await updateOrder(order.id, { payment_claimed: true });
    await pushToAdmin(`💰 ลูกค้าแจ้งชำระเงินแล้ว: ${order.id} ฿${order.total.toLocaleString()} (${order.customer.name})\nตรวจสอบแล้วยืนยัน: paidddd ${order.id}`);
    return { order: updated, alreadyPaid: false };
  }

  async function confirmStripePayment(orderId) {
    const order = await getOrder(orderId);
    if (!order) throw new Error('ไม่พบคำสั่งซื้อ');
    if (order.paid) return { order, alreadyPaid: true };
    const stripe = stripeClient();
    if (stripe && order.stripe_session) {
      try {
        const session = await stripe.checkout.sessions.retrieve(order.stripe_session);
        if (session?.payment_status === 'paid') await markOrderPaid(order.id);
      } catch {}
    }
    return { order: await getOrder(order.id), alreadyPaid: false };
  }

  async function verifyPromptpaySlip({
    orderId,
    imageBase64 = '',
    rawBase64 = '',
    slipMessageId = '',
    slipReceivedAt = new Date().toISOString(),
    userId = '',
    source = 'web',
  } = {}) {
    const order = await getOrder(orderId);
    if (!order) throw new Error('ไม่พบคำสั่งซื้อ');
    if (order.paid) {
      return { ok: true, verified: true, alreadyPaid: true, order, paymentLog: await getPaymentLog(order.id) };
    }
    if (order.payment_method !== 'promptpay') throw new Error('ออเดอร์นี้ไม่ได้ใช้ PromptPay');
    const base64 = String(rawBase64 || imageBase64 || '').trim();
    if (!base64) throw new Error('กรุณาแนบรูปสลิป');

    const verified = normalizeSlipokResult(await verifySlipWithSlipok({ imageBase64: base64, amount: order.total }));
    const paymentLog = await upsertPaymentLog(order.id, {
      user_id: String(userId || order.user_id || '').trim(),
      product: order.items.map((item) => `${item.name} x${item.qty}`).join(', ').slice(0, 250),
      amount: order.total,
      status: verified.verified ? 'verified' : (verified.ok ? 'rejected' : 'manual_review'),
      slip_message_id: String(slipMessageId || `${source}-${Date.now()}`).trim(),
      slip_received_at: String(slipReceivedAt || new Date().toISOString()).trim(),
      verification_message: verified.message || '',
      verification_payload: JSON.stringify(verified.raw || {}),
      account_number: verified.accountNumber || '',
      account_name: verified.receiverName || '',
      bank_name: verified.senderName || '',
    });

    if (verified.verified) {
      await markOrderPaid(order.id);
      return {
        ok: true,
        verified: true,
        order: await getOrder(order.id),
        paymentLog,
        result: verified,
      };
    }

    const needsManualReview = isSlipokManualReviewCode(verified.code) || (!verified.ok && !isSlipokVerificationFailureCode(verified.code));
    const updated = await updateOrder(order.id, { payment_claimed: true });
    await pushToAdmin([
      `💳 มีการอัปโหลดสลิปสำหรับออเดอร์ ${order.id}`,
      `สถานะ: ${needsManualReview ? 'รอตรวจสอบเอง' : 'สลิปไม่ผ่านอัตโนมัติ'}`,
      verified.message ? `ผลตรวจ: ${verified.message}` : '',
      verified.amount ? `ยอดในสลิป: ฿${Number(verified.amount).toLocaleString()}` : '',
      verified.transRef ? `เลขอ้างอิง: ${verified.transRef}` : '',
      source === 'line' ? 'แหล่งที่มา: LINE OA' : '',
    ].filter(Boolean).join('\n'));
    return {
      ok: needsManualReview,
      verified: false,
      manualReview: needsManualReview,
      error: needsManualReview ? '' : (verified.message || 'สลิปไม่ผ่านการตรวจสอบ'),
      order: updated,
      paymentLog,
      result: verified,
    };
  }

  async function buildPromptPayQrBuffer(orderId) {
    const order = await getOrder(orderId);
    if (!order || order.payment_method !== 'promptpay') return null;
    const promptpay = await buildPromptPay(order.total);
    const qr = String(promptpay?.qr || '').trim();
    const match = /^data:image\/png;base64,(.+)$/i.exec(qr);
    if (!match) return null;
    return Buffer.from(match[1], 'base64');
  }

  return {
    createCheckoutOrder,
    getClientOrderDetails,
    claimPayment,
    confirmStripePayment,
    verifyPromptpaySlip,
    buildPromptPayQrBuffer,
  };
}
