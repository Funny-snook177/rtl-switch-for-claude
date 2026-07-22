/*
 * cdp-test.js — راستی‌آزمایی موتور RTL در Chrome واقعی از طریق CDP.
 * بدون هیچ وابستگی npm: از WebSocket داخلی Node و پروتکل DevTools استفاده می‌کند.
 * سه حالت (auto/rtl/off) را اعمال می‌کند، جهت محاسبه‌شده را می‌خواند، اسکرین‌شات می‌گیرد.
 */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 9337;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(p => fs.existsSync(p));

const mockPath = path.join(__dirname, 'mock-claude.html').replace(/\\/g, '/');
const fileURL = 'file:///' + mockPath;
const shotDir = path.join(__dirname, 'shots');
fs.mkdirSync(shotDir, { recursive: true });

function httpJSON(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch (e) { resolve(d); }
      });
    }).on('error', reject);
  });
}

async function waitPort(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const v = await httpJSON('/json/version'); if (v && v.webSocketDebuggerUrl) return v; } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Chrome CDP did not come up');
}

// کلاینت CDP بسیار سبک روی WebSocket داخلی
class CDP {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl); this.id = 0; this.waiting = new Map(); this.sessionId = null; }
  open() {
    return new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', e => rej(e.message || 'ws error'));
      this.ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.id && this.waiting.has(m.id)) {
          const { resolve, reject } = this.waiting.get(m.id);
          this.waiting.delete(m.id);
          if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
        }
      });
    });
  }
  send(method, params, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.waiting.set(id, { resolve, reject }));
  }
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? '  [' + detail + ']' : ''));
}

async function main() {
  if (!CHROME) throw new Error('No Chrome/Edge found');
  console.log('Chrome:', CHROME);
  const udd = path.join(os.tmpdir(), 'rtl-cdp-profile-' + PORT);
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + udd,
    '--allow-file-access-from-files', '--window-size=760,1100', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    await waitPort(15000);
    const browser = await httpJSON('/json/version');
    const cdp = new CDP(browser.webSocketDebuggerUrl);
    await cdp.open();

    // ساخت تارگت و اتصال flatten
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const S = sessionId;

    await cdp.send('Page.enable', {}, S);
    await cdp.send('Runtime.enable', {}, S);

    // ناوبری و انتظار برای load
    const loaded = new Promise(res => {
      const h = ev => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Page.loadEventFired' && m.sessionId === S) { cdp.ws.removeEventListener('message', h); res(); }
      };
      cdp.ws.addEventListener('message', h);
    });
    await cdp.send('Page.navigate', { url: fileURL }, S);
    await loaded;
    await new Promise(r => setTimeout(r, 800)); // مهلت برای init موتور

    async function evaluate(expr) {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }, S);
      if (r.exceptionDetails) throw new Error(expr + ' => ' + JSON.stringify(r.exceptionDetails));
      return r.result.value;
    }
    async function shot(name) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, S);
      fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(r.data, 'base64'));
    }
    const dirOf = id => evaluate(`getComputedStyle(document.getElementById('${id}')).direction`);
    const alignOf = id => evaluate(`getComputedStyle(document.getElementById('${id}')).textAlign`);
    const attrOf = (id, a) => evaluate(`(document.getElementById('${id}')||{}).getAttribute? document.getElementById('${id}').getAttribute('${a}') : null`);

    // 0) موتور و دکمه راه‌اندازی شده‌اند؟
    const hasEngine = await evaluate(`!!window.__rtlSwitch`);
    check('engine loaded (window.__rtlSwitch)', hasEngine);
    const hasBtn = await evaluate(`!!document.getElementById('claude-rtl-switch-btn')`);
    check('floating button injected', hasBtn);

    // ===== حالت AUTO =====
    await evaluate(`window.__rtlSwitch.setMode('auto')`);
    await new Promise(r => setTimeout(r, 300));
    await shot('1-auto');
    check('AUTO: Persian paragraph is RTL', (await dirOf('a-p1')) === 'rtl', 'dir=' + await dirOf('a-p1'));
    check('AUTO: Persian heading is RTL', (await dirOf('a-h2')) === 'rtl');
    check('AUTO: Persian list item is RTL', (await dirOf('a-li1')) === 'rtl');
    check('AUTO: English paragraph stays LTR', (await dirOf('a-en1')) === 'ltr', 'dir=' + await dirOf('a-en1'));
    check('AUTO: code block stays LTR', (await dirOf('a-code')) === 'ltr', 'dir=' + await dirOf('a-code'));
    check('AUTO: mixed(Persian-first) user msg is RTL', (await dirOf('u2')) === 'rtl');
    check('AUTO: English user msg stays LTR', (await dirOf('u1')) === 'ltr');
    check('AUTO: Persian p text-align not forced-left', (await alignOf('a-p1')) !== 'left', 'align=' + await alignOf('a-p1'));
    // یافته‌های بازبینی: پاراگراف فارسیِ آغازشده با واژهٔ انگلیسی باید RTL شود
    check('AUTO: Persian para starting with "Python" is RTL', (await dirOf('a-latinfirst')) === 'rtl', 'dir=' + await dirOf('a-latinfirst'));
    check('AUTO: Persian-first para right-aligned', (await alignOf('a-latinfirst')) === 'right', 'align=' + await alignOf('a-latinfirst'));
    // انگلیسیِ اکثریت با یک واژهٔ فارسی باید LTR بماند
    check('AUTO: English-majority (one Persian word) stays LTR', (await dirOf('a-enmix')) === 'ltr', 'dir=' + await dirOf('a-enmix'));
    // ارقام فارسی در جملهٔ انگلیسی نباید باعث RTL شوند
    check('AUTO: Persian digits in English sentence stays LTR', (await dirOf('a-digits')) === 'ltr', 'dir=' + await dirOf('a-digits'));

    // ===== حالت RTL (اجباری) =====
    await evaluate(`window.__rtlSwitch.setMode('rtl')`);
    await new Promise(r => setTimeout(r, 300));
    await shot('2-rtl');
    check('RTL: Persian paragraph dir attr = rtl', (await attrOf('a-p1', 'dir')) === 'rtl', 'attr=' + await attrOf('a-p1', 'dir'));
    check('RTL: Persian paragraph computed RTL', (await dirOf('a-p1')) === 'rtl');
    check('RTL: code block stays LTR', (await dirOf('a-code')) === 'ltr');
    check('RTL: pure-English paragraph not forced RTL', (await dirOf('a-en1')) === 'ltr', 'dir=' + await dirOf('a-en1'));
    // یافتهٔ بازبینی: انگلیسیِ اکثریت با یک واژهٔ فارسی در حالت RTL هم نباید بچرخد
    check('RTL: English-majority (one Persian word) stays LTR', (await dirOf('a-enmix')) === 'ltr', 'dir=' + await dirOf('a-enmix'));
    // یافتهٔ بازبینی: جدول فارسی در حالت RTL باید جهت rtl بگیرد (چرخش ستون‌ها)
    check('RTL: Persian table element gets dir=rtl', (await attrOf('a-table', 'dir')) === 'rtl', 'attr=' + await attrOf('a-table', 'dir'));
    check('RTL: table computed direction rtl', (await dirOf('a-table')) === 'rtl');

    // ===== حالت OFF =====
    await evaluate(`window.__rtlSwitch.setMode('off')`);
    await new Promise(r => setTimeout(r, 300));
    await shot('3-off');
    check('OFF: Persian paragraph restored to LTR', (await dirOf('a-p1')) === 'ltr', 'dir=' + await dirOf('a-p1'));
    check('OFF: no data-rtl-fixed attributes remain', (await evaluate(`document.querySelectorAll('[data-rtl-fixed]').length`)) === 0);
    check('OFF: injected style removed', (await evaluate(`!document.getElementById('claude-rtl-switch-style')`)));
    check('OFF: button still present (to switch back)', (await evaluate(`!!document.getElementById('claude-rtl-switch-btn')`)));

    // ===== بازگشت به AUTO و تست idempotency (اجرای دوباره) =====
    await evaluate(`window.__rtlSwitch.setMode('auto')`);
    // شبیه‌سازی paste دوباره‌ی موتور: نباید دکمه دوم بسازد
    const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'shared', 'rtl-engine.js'), 'utf8');
    await cdp.send('Runtime.evaluate', { expression: scriptSrc, returnByValue: false }, S);
    await new Promise(r => setTimeout(r, 200));
    check('idempotent: exactly one button after re-run', (await evaluate(`document.querySelectorAll('#claude-rtl-switch-btn').length`)) === 1);

    // ===== تست تشخیص متن (واحد) =====
    check('isRTLText("سلام دنیا") === true', (await evaluate(`window.__rtlSwitch.isRTLText('سلام دنیا')`)) === true);
    check('isRTLText("Hello world") === false', (await evaluate(`window.__rtlSwitch.isRTLText('Hello world')`)) === false);
    check('isRTLText("۱۲۳ عدد") RTL (num+persian)', (await evaluate(`window.__rtlSwitch.isRTLText('۱۲۳ عدد')`)) === true);
    check('isRTLText("123 abc") === false', (await evaluate(`window.__rtlSwitch.isRTLText('123 abc')`)) === false);
    check('isRTLText("Python یک زبان است") === true (majority)', (await evaluate(`window.__rtlSwitch.isRTLText('Python یک زبان است')`)) === true);
    check('isRTLText("The word سلام means hi") === false (majority)', (await evaluate(`window.__rtlSwitch.isRTLText('The word سلام means hi')`)) === false);
    check('detectDir("۲۰۲۶ budget report") === ltr (weak digits)', (await evaluate(`window.__rtlSwitch.detectDir('۲۰۲۶ budget report')`)) === 'ltr');

    await shot('4-auto-final');

    // خلاصه
    const passed = results.filter(r => r.pass).length;
    console.log('\\n==== RESULT: ' + passed + '/' + results.length + ' passed ====');
    console.log('screenshots -> ' + shotDir);
    process.exitCode = passed === results.length ? 0 : 1;
  } finally {
    chrome.kill();
  }
}

main().catch(e => { console.error('FATAL', e); process.exitCode = 2; });
