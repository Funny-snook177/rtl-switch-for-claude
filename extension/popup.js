/* popup.js — کنترل حالت از داخل پاپ‌آپ اکستنشن */
(function () {
  'use strict';

  var foot = document.getElementById('foot');
  var DEFAULT_FOOT = foot.innerHTML;

  function withTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || !tabs[0]) return;
      cb(tabs[0]);
    });
  }

  function isClaude(url) { return /^https:\/\/([a-z0-9-]+\.)?claude\.ai\//i.test(url || ''); }

  function highlight(mode) {
    var btns = document.querySelectorAll('.mode');
    for (var i = 0; i < btns.length; i++) {
      var m = btns[i].getAttribute('data-mode');
      var active = m === mode;
      btns[i].classList.toggle('active', active);
      btns[i].querySelector('.check').textContent = active ? '✓' : '';
    }
  }

  // پیام را می‌فرستد؛ اگر content script هنوز تزریق نشده باشد، یک‌بار تزریق و دوباره تلاش می‌کند.
  function send(tab, msg, cb, triedInject) {
    chrome.tabs.sendMessage(tab.id, msg, function (resp) {
      if (chrome.runtime.lastError) {
        if (!triedInject && isClaude(tab.url) && chrome.scripting) {
          // صفحهٔ Claude از قبل باز بوده و اسکریپت تزریق نشده — همین حالا تزریق کن
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['rtl-engine.js', 'content.js'] },
            function () {
              if (chrome.runtime.lastError) { fail(tab); return; }
              setTimeout(function () { send(tab, msg, cb, true); }, 150);
            }
          );
        } else {
          fail(tab);
        }
        return;
      }
      if (cb) cb(resp);
    });
  }

  function fail(tab) {
    if (isClaude(tab.url)) {
      foot.innerHTML = '<span class="warn">تبِ Claude را یک‌بار رفرش کنید تا فعال شود.</span>';
    } else {
      foot.innerHTML = '<span class="warn">این صفحه Claude نیست. در claude.ai بازش کنید.</span>';
    }
  }

  withTab(function (tab) {
    if (!isClaude(tab.url)) { fail(tab); return; }
    foot.innerHTML = DEFAULT_FOOT;
    send(tab, { type: 'get-mode' }, function (resp) {
      if (resp && resp.ok) highlight(resp.mode);
    });
  });

  document.getElementById('modes').addEventListener('click', function (e) {
    var b = e.target.closest('.mode');
    if (!b) return;
    var mode = b.getAttribute('data-mode');
    withTab(function (tab) {
      send(tab, { type: 'set-mode', mode: mode }, function (resp) {
        if (resp && resp.ok) highlight(resp.mode);
      });
    });
  });
})();
