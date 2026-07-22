/*
 * content.js — پل ارتباطی بین پاپ‌آپ اکستنشن و موتور RTL
 * موتور (rtl-engine.js) پیش از این فایل بارگذاری و خودش را راه‌اندازی کرده است.
 * اینجا فقط به پیام‌های پاپ‌آپ گوش می‌دهیم تا حالت را عوض کنیم/بخوانیم.
 */
(function () {
  'use strict';

  function engine() { return window.__rtlSwitch; }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    var e = engine();
    if (!e) { sendResponse({ ok: false, error: 'engine-not-ready' }); return true; }

    if (msg && msg.type === 'get-mode') {
      sendResponse({ ok: true, mode: e.getMode() });
    } else if (msg && msg.type === 'set-mode') {
      sendResponse({ ok: true, mode: e.setMode(msg.mode) });
    } else if (msg && msg.type === 'cycle-mode') {
      sendResponse({ ok: true, mode: e.cycleMode() });
    } else {
      sendResponse({ ok: false, error: 'unknown-message' });
    }
    return true;
  });
})();
