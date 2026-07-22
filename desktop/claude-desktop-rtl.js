// نسخهٔ دسکتاپ = همان موتور مشترک؛ کل این فایل را در کنسول DevTools اپ دسکتاپ Paste کنید.
/*
 * RTL Switch — موتور مشترک راست‌چین‌سازی برای Claude
 * ------------------------------------------------------------------
 * یک موتور واحد که هم در اکستنشن مرورگر و هم در اسنیپت DevTools اپ دسکتاپ
 * استفاده می‌شود. پیام‌های فارسی/عربی/عبری Claude را راست‌چین می‌کند و بین سه
 * حالت سوییچ می‌کند:
 *   - auto : جهت هر پاراگراف از روی «اکثریت حروف» آن تصمیم‌گیری می‌شود
 *            (بهترین حالت برای متن ترکیبی فارسی/انگلیسی — حتی وقتی جمله با یک
 *             واژهٔ انگلیسی مثل «Python» شروع می‌شود).
 *   - rtl  : متن‌های فارسی‌محور به‌زور راست‌چین می‌شوند؛ متن انگلیسیِ اکثریت
 *            دست‌نخورده می‌ماند.
 *   - off  : همه‌چیز به حالت اصلی Claude برمی‌گردد.
 *
 * طراحی «مستقل از ساختار DOM» است: به کلاس‌های داخلی Claude وابسته نیست و با
 * به‌روزرسانی رابط کاربری نمی‌شکند.
 */
(function () {
  'use strict';

  var VERSION = 4;

  // idempotent: اگر همین نسخه فعال است فقط یک اسکن دوباره بزن
  if (window.__rtlSwitch && window.__rtlSwitch.__version === VERSION) {
    window.__rtlSwitch.rescan();
    return window.__rtlSwitch;
  }
  if (window.__rtlSwitch && typeof window.__rtlSwitch.destroy === 'function') {
    try { window.__rtlSwitch.destroy(); } catch (e) {}
  }

  var STORAGE_KEY = 'claude-rtl-switch-mode';
  var POS_KEY = 'claude-rtl-switch-pos';
  var ATTR = 'data-rtl-fixed';           // مقدار = جهتِ اعمال‌شده: rtl | ltr | auto
  var STYLE_ID = 'claude-rtl-switch-style';
  var BTN_ID = 'claude-rtl-switch-btn';
  var MENU_ID = BTN_ID + '-menu';

  // ---- تشخیص جهت متن (شمارش حروف قوی) -------------------------------
  // بازهٔ کلی حروف راست‌به‌چپ (عربی/فارسی/عبری + فرم‌های نمایشی).
  // نکته: ارقام فارسی/عربی و نشانه‌های عددی «ضعیف»‌اند و پیش از این تست فیلتر می‌شوند.
  var RTL_LETTER = /[֐-߿ࢠ-ࣿﭐ-﷿ﹰ-ﻼ]/;
  var LTR_LETTER = /[A-Za-zÀ-ʯͰ-Ͽ-ӿ]/; // لاتین + یونانی + سیریلیک

  function isWeakArabicDigitOrSign(code) {
    // ارقام عربی-هندی و فارسی (بایدی: ضعیف) + نشانه‌های عددی عربی
    return (code >= 0x0660 && code <= 0x0669) ||   // ٠-٩
           (code >= 0x06F0 && code <= 0x06F9) ||   // ۰-۹
           (code >= 0x0600 && code <= 0x0605) ||   // نشانه‌های عددی عربی
           (code >= 0x066B && code <= 0x066D) ||   // جداکننده‌های عددی
           code === 0x06DD;
  }

  // 'rtl' | 'ltr' | 'neutral' بر اساس اکثریتِ حروفِ قوی
  function detectDir(text) {
    if (!text) return 'neutral';
    var rtl = 0, ltr = 0;
    for (var i = 0; i < text.length; i++) {
      var code = text.charCodeAt(i);
      if (isWeakArabicDigitOrSign(code)) continue; // ارقام را نادیده بگیر
      var ch = text[i];
      if (RTL_LETTER.test(ch)) rtl++;
      else if (LTR_LETTER.test(ch)) ltr++;
    }
    if (rtl === 0 && ltr === 0) return 'neutral';
    return rtl >= ltr ? 'rtl' : 'ltr'; // مساوی → rtl
  }

  // جهتِ نهایی که باید روی عنصر گذاشته شود، بسته به حالت جاری
  function decideDir(text, m) {
    var d = detectDir(text);
    if (m === 'rtl') return d === 'ltr' ? 'ltr' : 'rtl'; // مگر انگلیسیِ اکثریت
    // auto
    return d === 'neutral' ? 'auto' : d;
  }

  // ---- انتخاب عناصر هدف ---------------------------------------------
  var BLOCK_SELECTOR = [
    'p', 'li', 'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'td', 'th', 'dd', 'dt',
    'ul', 'ol', 'summary'
  ].join(',');

  var EXCLUDE_SELECTOR =
    'pre, code, kbd, samp, .katex, .katex-display, math, ' +
    'textarea, input, select, [contenteditable="false"], svg, [data-rtl-skip]';

  function isExcluded(el) { return !!el.closest(EXCLUDE_SELECTOR); }

  // کشِ <main> برای جلوگیری از querySelector تکراری در هر فریم
  var mainEl = null;
  function getMain() {
    if (mainEl && mainEl.isConnected) return mainEl;
    mainEl = document.querySelector('main');
    return mainEl;
  }
  function inConversation(el) {
    var m = getMain();
    if (m && !m.contains(el)) return false; // بیرون از ناحیهٔ گفتگو
    return true;
  }

  var mode = 'auto';
  var observer = null;

  // ---- اعمال جهت روی یک عنصر ----------------------------------------
  function fixElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.id === BTN_ID || el.id === MENU_ID || (el.closest && el.closest('#' + MENU_ID))) return;
    if (isExcluded(el)) return;
    if (!inConversation(el)) return;

    var txt = el.textContent || '';
    if (!txt.trim()) return;

    if (mode === 'off') { restoreElement(el); return; }

    var want = decideDir(txt, mode); // 'rtl' | 'ltr' | 'auto'
    if (el.getAttribute(ATTR) === want) return; // dirty-check: بدون تغییر رد شو

    if (!el.hasAttribute(ATTR)) {
      el.setAttribute('data-rtl-orig-dir', el.getAttribute('dir') || '');
    }
    el.setAttribute('dir', want);
    el.setAttribute(ATTR, want);
  }

  function restoreElement(el) {
    if (!el.hasAttribute(ATTR)) return;
    var orig = el.getAttribute('data-rtl-orig-dir');
    if (orig) el.setAttribute('dir', orig);
    else el.removeAttribute('dir');
    el.removeAttribute(ATTR);
    el.removeAttribute('data-rtl-orig-dir');
  }

  // ---- ورودی تایپ کاربر (ProseMirror / textarea) --------------------
  function fixInputs() {
    var m = getMain() || document;
    var inputs = m.querySelectorAll('div[contenteditable="true"], .ProseMirror');
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      if (mode === 'off') {
        var o = el.getAttribute('data-rtl-orig-dir');
        if (o !== null) { if (o) el.setAttribute('dir', o); else el.removeAttribute('dir'); el.removeAttribute('data-rtl-orig-dir'); }
        continue;
      }
      if (el.getAttribute('data-rtl-orig-dir') === null) el.setAttribute('data-rtl-orig-dir', el.getAttribute('dir') || '');
      el.setAttribute('dir', 'auto'); // ورودی همیشه auto
    }
  }

  // ---- اسکن ----------------------------------------------------------
  // اسکن کامل: فقط هنگام init/تعویض‌حالت. اسکن افزایشی: در پاسخ به تغییرات DOM.
  function scanRoot(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(BLOCK_SELECTOR)) fixElement(root);
    var nodes;
    try { nodes = root.querySelectorAll(BLOCK_SELECTOR); } catch (e) { return; }
    for (var i = 0; i < nodes.length; i++) fixElement(nodes[i]);
  }

  function fullScan() {
    var m = getMain() || document.body;
    if (!m) return;
    scanRoot(m);
    fixInputs();
  }

  function restoreAll() {
    var nodes = document.querySelectorAll('[' + ATTR + ']');
    for (var i = 0; i < nodes.length; i++) restoreElement(nodes[i]);
    fixInputs(); // با mode==='off' ورودی‌ها را هم بازمی‌گرداند
  }

  function rescan() {
    if (mode === 'off') { restoreAll(); return; }
    fullScan();
  }

  // ---- پردازش افزایشیِ تغییرات (کم‌هزینه در حین استریم) --------------
  var pending = new Set();
  var flushScheduled = false;

  function queueNode(n) {
    if (!n || n.nodeType !== 1) {
      if (n && n.nodeType === 3 && n.parentElement) n = n.parentElement; else return;
    }
    // نزدیک‌ترین جدِ بلوکی را پیدا کن تا کارِ اضافی نکنیم
    var block = n.closest ? n.closest(BLOCK_SELECTOR) : null;
    pending.add(block || n);
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(function () {
      flushScheduled = false;
      if (mode === 'off') { pending.clear(); return; }
      var items = pending; pending = new Set();
      items.forEach(function (node) {
        if (node && node.isConnected) scanRoot(node);
      });
      fixInputs();
    });
  }

  // ---- CSS تزریقی ----------------------------------------------------
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css =
      '[' + ATTR + '="rtl"]{direction:rtl !important;text-align:right !important;unicode-bidi:isolate;}' +
      '[' + ATTR + '="ltr"]{direction:ltr !important;text-align:left !important;}' +
      '[' + ATTR + '="auto"]{unicode-bidi:plaintext;text-align:start !important;}' +
      'ul[' + ATTR + '="rtl"],ol[' + ATTR + '="rtl"]{padding-right:1.5em;padding-left:0;}' +
      // کد و ریاضی حتی داخل بلوک راست‌چین، چپ‌چین بماند
      '[' + ATTR + '] pre,[' + ATTR + '] code{direction:ltr;text-align:left;unicode-bidi:isolate;}';
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  function removeStyle() { var s = document.getElementById(STYLE_ID); if (s) s.remove(); }

  // ---- مشاهده‌گر تغییرات DOM -----------------------------------------
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var mu = muts[i];
        if (mu.type === 'characterData') {
          queueNode(mu.target);
        } else if (mu.addedNodes && mu.addedNodes.length) {
          for (var j = 0; j < mu.addedNodes.length; j++) queueNode(mu.addedNodes[j]);
        }
      }
      if (pending.size) scheduleFlush();
    });
    var target = getMain() || document.body;
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    // اگر <main> هنوز نبود، تغییرات body ممکن است بعداً آن را بیاورد → fixInputs/scan
  }
  function stopObserver() { if (observer) { observer.disconnect(); observer = null; } }

  // ---- حالت‌ها --------------------------------------------------------
  var MODES = ['auto', 'rtl', 'off'];
  var LABELS = { auto: 'خودکار', rtl: 'راست‌چین', off: 'خاموش' };
  var ICONS = { auto: '☉', rtl: '←', off: '○' };

  function applyMode(m, persist) {
    if (MODES.indexOf(m) === -1) m = 'auto';
    mode = m;
    if (persist) { try { localStorage.setItem(STORAGE_KEY, m); } catch (e) {} }
    if (m === 'off') { restoreAll(); removeStyle(); }
    else { injectStyle(); fullScan(); }
    updateButton();
    return m;
  }
  function setMode(m) { return applyMode(m, true); }
  function cycleMode() {
    var idx = MODES.indexOf(mode);
    return setMode(MODES[(idx + 1) % MODES.length]);
  }

  // ---- دکمهٔ شناور (قابل‌جابه‌جایی) ----------------------------------
  var btn = null, menu = null, dragged = false;

  function loadPos() {
    try { var p = JSON.parse(localStorage.getItem(POS_KEY)); if (p && typeof p.left === 'number') return p; } catch (e) {}
    return null;
  }
  function savePos(p) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {} }

  function placeButton() {
    var p = loadPos();
    if (p) { btn.style.left = p.left + 'px'; btn.style.top = p.top + 'px'; btn.style.right = 'auto'; btn.style.bottom = 'auto'; }
    else {
      // پیش‌فرض: لبهٔ راست، عمودیْ کمی پایین‌تر از وسط — دور از نوار کناری چپ و کادرِ نوشتن پایین
      btn.style.right = '14px'; btn.style.left = 'auto';
      btn.style.top = '50%'; btn.style.bottom = 'auto';
    }
  }

  function buildButton() {
    if (document.getElementById(BTN_ID)) { btn = document.getElementById(BTN_ID); return; }
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'سوییچ راست‌چین/چپ‌چین متن Claude');
    btn.setAttribute('aria-haspopup', 'menu');
    btn.style.cssText = [
      'position:fixed', 'z-index:2147483000',
      'width:42px', 'height:42px', 'border-radius:50%', 'border:none',
      'cursor:pointer', 'font-size:17px', 'font-family:system-ui,sans-serif',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:#c96442', 'color:#fff',
      'box-shadow:0 2px 10px rgba(0,0,0,.35)', 'transition:opacity .2s',
      'opacity:.8', 'user-select:none', 'padding:0', 'touch-action:none'
    ].join(';');
    placeButton();

    btn.addEventListener('mouseenter', function () { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', function () { btn.style.opacity = '.8'; });

    // جابه‌جایی با درگ (Pointer Events)
    var down = null;
    btn.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, rect: btn.getBoundingClientRect() };
      dragged = false;
      btn.setPointerCapture(e.pointerId);
    });
    btn.addEventListener('pointermove', function (e) {
      if (!down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 5) return;
      dragged = true;
      var left = Math.max(2, Math.min(window.innerWidth - 44, down.rect.left + dx));
      var top = Math.max(2, Math.min(window.innerHeight - 44, down.rect.top + dy));
      btn.style.left = left + 'px'; btn.style.top = top + 'px';
      btn.style.right = 'auto'; btn.style.bottom = 'auto';
      positionMenu();
    });
    btn.addEventListener('pointerup', function (e) {
      if (down) { try { btn.releasePointerCapture(e.pointerId); } catch (x) {} }
      if (dragged) { savePos({ left: parseInt(btn.style.left, 10), top: parseInt(btn.style.top, 10) }); }
      down = null;
    });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (dragged) { dragged = false; return; } // درگ بود، نه کلیک
      toggleMenu();
    });
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); cycleMode(); });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    });

    document.body.appendChild(btn);
    buildMenu();
    updateButton();
  }

  function buildMenu() {
    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.setAttribute('role', 'menu');
    menu.style.cssText = [
      'position:fixed', 'z-index:2147483000',
      'background:#1f1e1d', 'color:#fff', 'border-radius:12px',
      'box-shadow:0 4px 20px rgba(0,0,0,.4)', 'padding:6px',
      'font-family:Tahoma,system-ui,sans-serif', 'font-size:13px',
      'display:none', 'min-width:150px', 'direction:rtl', 'border:1px solid #3a3937'
    ].join(';');

    var title = document.createElement('div');
    title.textContent = 'جهت متن';
    title.style.cssText = 'padding:6px 10px;opacity:.6;font-size:11px;';
    menu.appendChild(title);

    MODES.forEach(function (m) {
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('data-mode', m);
      item.setAttribute('role', 'menuitemradio');
      item.style.cssText = [
        'display:flex', 'align-items:center', 'gap:8px', 'width:100%',
        'padding:8px 10px', 'border-radius:8px', 'cursor:pointer',
        'background:transparent', 'color:#fff', 'border:none',
        'font-family:inherit', 'font-size:13px', 'text-align:right', 'white-space:nowrap'
      ].join(';');
      item.innerHTML = '<span style="width:18px;display:inline-block;text-align:center">' +
        ICONS[m] + '</span><span>' + LABELS[m] + '</span>' +
        '<span data-check style="margin-inline-start:auto;color:#c96442"></span>';
      item.addEventListener('mouseenter', function () { item.style.background = '#333130'; });
      item.addEventListener('mouseleave', function () { item.style.background = 'transparent'; });
      item.addEventListener('click', function () { setMode(m); closeMenu(); btn.focus(); });
      item.addEventListener('keydown', function (e) { if (e.key === 'Escape') { closeMenu(); btn.focus(); } });
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    onDocClick = function (e) {
      if (menu.style.display === 'block' && e.target !== btn &&
          !menu.contains(e.target) && !btn.contains(e.target)) closeMenu();
    };
    document.addEventListener('click', onDocClick, true);
  }
  var onDocClick = null;

  function positionMenu() {
    if (!menu || menu.style.display !== 'block') return;
    var r = btn.getBoundingClientRect();
    var mw = menu.offsetWidth || 160, mh = menu.offsetHeight || 140;
    var top = r.top - mh - 8;
    if (top < 8) top = Math.min(window.innerHeight - mh - 8, r.bottom + 8);
    var left = Math.min(r.left, window.innerWidth - mw - 8);
    if (left < 8) left = 8;
    menu.style.top = top + 'px'; menu.style.left = left + 'px';
  }

  function toggleMenu() {
    if (!menu) return;
    if (menu.style.display === 'block') closeMenu();
    else { menu.style.display = 'block'; positionMenu(); updateButton();
      var first = menu.querySelector('[data-mode="' + mode + '"]') || menu.querySelector('[data-mode]');
      if (first) first.focus();
    }
  }
  function closeMenu() { if (menu) menu.style.display = 'none'; }

  function updateButton() {
    if (btn) {
      btn.textContent = ICONS[mode];
      btn.title = 'جهت متن: ' + LABELS[mode] + '  (کلیک: منو | راست‌کلیک: تعویض | قابل‌جابه‌جایی)';
      btn.style.background = mode === 'off' ? '#6b6b6b' : '#c96442';
      btn.setAttribute('aria-label', 'جهت متن: ' + LABELS[mode]);
    }
    if (menu) {
      var items = menu.querySelectorAll('[data-mode]');
      for (var i = 0; i < items.length; i++) {
        var on = items[i].getAttribute('data-mode') === mode;
        items[i].querySelector('[data-check]').textContent = on ? '✓' : '';
        items[i].setAttribute('aria-checked', on ? 'true' : 'false');
      }
    }
  }

  // ---- همگام‌سازی بین تب‌ها -------------------------------------------
  var onStorage = function (e) {
    if (e.key === STORAGE_KEY && e.newValue && e.newValue !== mode) applyMode(e.newValue, false);
  };

  // ---- راه‌اندازی / تخریب --------------------------------------------
  function init() {
    var saved = 'auto';
    try { saved = localStorage.getItem(STORAGE_KEY) || 'auto'; } catch (e) {}
    mode = MODES.indexOf(saved) === -1 ? 'auto' : saved;

    if (mode !== 'off') injectStyle();
    buildButton();
    rescan();
    startObserver();
    window.addEventListener('storage', onStorage);
  }

  function destroy() {
    stopObserver();
    window.removeEventListener('storage', onStorage);
    if (onDocClick) document.removeEventListener('click', onDocClick, true);
    restoreAll();
    removeStyle();
    var b = document.getElementById(BTN_ID); if (b) b.remove();
    var m = document.getElementById(MENU_ID); if (m) m.remove();
  }

  var api = {
    __version: VERSION,
    setMode: setMode,
    cycleMode: cycleMode,
    getMode: function () { return mode; },
    rescan: rescan,
    destroy: destroy,
    detectDir: detectDir,
    isRTLText: function (t) { return detectDir(t) === 'rtl'; }
  };
  window.__rtlSwitch = api;

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init);

  return api;
})();
