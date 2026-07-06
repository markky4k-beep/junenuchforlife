(function (window) {
  'use strict';

  const loadedScripts = new Set();
  let marketingReady = false;

  function getSetting(key) {
    try {
      const getter = window.__NFLMarketingGetSetting;
      return typeof getter === 'function' ? String(getter(key) || '').trim() : '';
    } catch {
      return '';
    }
  }

  function loadScriptOnce(src) {
    const url = String(src || '').trim();
    if (!url || loadedScripts.has(url)) return;
    loadedScripts.add(url);
    const script = document.createElement('script');
    script.async = true;
    script.src = url;
    document.head.appendChild(script);
  }

  function initMarketing() {
    if (marketingReady) return;
    marketingReady = true;
    const ga4 = getSetting('GA4_ID');
    if (ga4) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      loadScriptOnce(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`);
      window.gtag('js', new Date());
      window.gtag('config', ga4, { send_page_view: false });
    }
    const meta = getSetting('META_PIXEL_ID');
    if (meta && !window.fbq) {
      window.fbq = function () { (window.fbq.q = window.fbq.q || []).push(arguments); };
      window.fbq.q = window.fbq.q || [];
      window.fbq.loaded = true;
      window.fbq.version = '2.0';
      loadScriptOnce('https://connect.facebook.net/en_US/fbevents.js');
      window.fbq('init', meta);
    }
    const tiktok = getSetting('TIKTOK_PIXEL_ID');
    if (tiktok && !window.ttq) {
      const ttq = window.ttq = window.ttq || [];
      ttq.methods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie'];
      ttq.setAndDefer = function (target, method) { target[method] = function () { target.push([method].concat([].slice.call(arguments, 0))); }; };
      for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (id) {
        const instance = ttq._i[id] || [];
        for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(instance, ttq.methods[i]);
        return instance;
      };
      ttq._i = ttq._i || {};
      ttq._i[tiktok] = [];
      ttq.load = ttq.load || function () { loadScriptOnce('https://analytics.tiktok.com/i18n/pixel/events.js'); };
      ttq.load(tiktok);
      ttq.page();
    }
  }

  function trackEvent(name, params) {
    initMarketing();
    const payload = { ...(params || {}) };
    if (window.gtag && getSetting('GA4_ID')) window.gtag('event', name, payload);
    if (window.fbq && getSetting('META_PIXEL_ID')) {
      const fbMap = { page_view: 'PageView', lead_submit: 'Lead', begin_checkout: 'InitiateCheckout', purchase: 'Purchase', line_click: 'Contact' };
      if (fbMap[name]) window.fbq('track', fbMap[name], payload);
      else window.fbq('trackCustom', name, payload);
    }
    if (window.ttq && getSetting('TIKTOK_PIXEL_ID')) {
      const ttMap = { page_view: 'PageView', lead_submit: 'SubmitForm', begin_checkout: 'InitiateCheckout', purchase: 'CompletePayment', line_click: 'Contact' };
      window.ttq.track(ttMap[name] || name, payload);
    }
  }

  window.NFLClientModules = {
    ...(window.NFLClientModules || {}),
    marketing: {
      init: initMarketing,
      trackEvent,
    },
  };

  const queue = Array.isArray(window.__NFLMarketingQueue) ? window.__NFLMarketingQueue.splice(0) : [];
  queue.forEach((entry) => {
    if (entry?.name) trackEvent(entry.name, entry.params || {});
  });
})(window);
