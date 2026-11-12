/*
 * 端到端测试：真实加载扩展 → 打开面板 → 点击导出 → 校验下载的 xlsx
 * 用法：node test/e2e.mjs
 * 说明：Chrome 137+ 已禁用 --load-extension，这里改用 CDP 的 Extensions.loadUnpacked。
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const PORT_WEB = 8899;
const PORT_CDP = 9334;

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];
const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('未找到 Chrome');
  process.exit(2);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.png': 'image/png',
  '.json': 'application/json'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(root, urlPath === '/' ? '/test/page.html' : urlPath);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT_WEB, '127.0.0.1', r));

const dlDir = path.join(os.tmpdir(), 't2x-dl-' + Date.now());
fs.mkdirSync(dlDir, { recursive: true });
const profile = path.join(os.tmpdir(), 't2x-e2e-' + Date.now());
fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
fs.writeFileSync(
  path.join(profile, 'Default', 'Preferences'),
  JSON.stringify({
    download: { default_directory: dlDir, prompt_for_download: false, directory_upgrade: true },
    savefile: { default_directory: dlDir }
  })
);

const child = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-extension-debugging',
    '--remote-debugging-port=' + PORT_CDP,
    '--user-data-dir=' + profile,
    '--window-size=1400,1000',
    'about:blank'
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
            ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
          });
        },
        close: () => ws.close()
      });
    ws.onerror = () => reject(new Error('WebSocket 失败'));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
  });
}

async function waitVersion() {
  for (let i = 0; i < 60; i++) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`)).json();
      if (v.webSocketDebuggerUrl) return v;
    } catch (e) {
      /* wait */
    }
    await sleep(300);
  }
  throw new Error('无法连接 CDP');
}

const steps = [];
function ok(name, pass, detail) {
  steps.push({ name, pass, detail: detail === undefined ? '' : String(detail) });
}

let browserCdp;
let cdp;
try {
  const ver = await waitVersion();
  browserCdp = await connect(ver.webSocketDebuggerUrl);
  const loaded = await browserCdp.send('Extensions.loadUnpacked', { path: root });
  ok('扩展加载成功', !!(loaded && loaded.id), loaded && loaded.id);

  let pageTarget = null;
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
    pageTarget = list.find((t) => t.type === 'page' && /about:blank/.test(t.url || ''));
    if (pageTarget) break;
    await sleep(250);
  }
  if (!pageTarget) throw new Error('找不到页面 target');

  cdp = await connect(pageTarget.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT_WEB}/test/page.html` });
  await sleep(2000);

  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r && r.result ? r.result.value : undefined;
  };

  let injected = false;
  for (let i = 0; i < 40; i++) {
    injected = await ev("!!document.getElementById('__t2x_host')");
    if (injected) break;
    await sleep(250);
  }
  ok('content script 注入并渲染悬浮按钮', injected);
  if (!injected) throw new Error('content script 未注入');

  await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('fab').click()");
  await sleep(1500);

  const titles = await ev(`(() => {
    const sr = document.getElementById('__t2x_host').shadowRoot;
    return Array.from(sr.querySelectorAll('.item')).map(i => i.querySelector('b').textContent + '|' + i.querySelector('em').textContent);
  })()`);
  ok('面板列出 3 个表格', Array.isArray(titles) && titles.length === 3, JSON.stringify(titles));
  ok(
    '表格标题识别正确',
    Array.isArray(titles) && /^区域汇总/.test(titles[0]) && /^产品结构/.test(titles[1]),
    JSON.stringify(titles && titles[0])
  );
  ok('表格尺寸正确', Array.isArray(titles) && /4 行 × 4 列/.test(titles[1]), titles && titles[1]);

  const btnText = await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('go').textContent");
  ok('导出按钮就绪', /导出 3 个表格/.test(btnText || ''), btnText);
  await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('go').click()");

  let files = [];
  for (let i = 0; i < 60; i++) {
    files = fs.readdirSync(dlDir).filter((f) => f.endsWith('.xlsx'));
    if (files.length) break;
    await sleep(300);
  }
  ok('xlsx 已下载到磁盘', files.length > 0, files.join(',') || '目录为空');

  if (files.length) {
    const src = path.join(dlDir, files[0]);
    fs.copyFileSync(src, path.join(root, 'test', 'e2e-out.xlsx'));
    ok('文件名带页面标题与时间戳', /季度销售明细/.test(files[0]), files[0]);
    ok('文件大小合理', fs.statSync(src).size > 1500, fs.statSync(src).size + ' bytes');
  }

  const status = await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('status').textContent");
  ok('状态栏提示成功', /已导出/.test(status || ''), status);

  /* ---------- 第二阶段：iframe 内表格 ---------- */
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT_WEB}/test/page-frame.html` });
  await sleep(2500);

  let injected2 = false;
  for (let i = 0; i < 40; i++) {
    injected2 = await ev("!!document.getElementById('__t2x_host')");
    if (injected2) break;
    await sleep(250);
  }
  ok('iframe 页面：主框架注入正常', injected2);

  if (injected2) {
    await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('fab').click()");
    await sleep(1800);
    const items = await ev(`(() => {
      const sr = document.getElementById('__t2x_host').shadowRoot;
      return Array.from(sr.querySelectorAll('.item')).map(i => ({
        title: i.querySelector('b').textContent,
        badge: i.querySelector('.badge') ? i.querySelector('.badge').textContent : ''
      }));
    })()`);
    ok('跨 frame 汇总到 4 个表格', Array.isArray(items) && items.length === 4, JSON.stringify(items));
    ok(
      'iframe 内表格带标记',
      Array.isArray(items) && items.filter((i) => i.badge === 'iframe').length === 3,
      JSON.stringify(items && items.map((i) => i.badge))
    );

    // 跨 frame 取数 + 导出
    await ev("document.getElementById('__t2x_host').shadowRoot.getElementById('go').click()");
    let files2 = [];
    for (let i = 0; i < 60; i++) {
      files2 = fs.readdirSync(dlDir).filter((f) => f.endsWith('.xlsx'));
      if (files2.length >= 2) break;
      await sleep(300);
    }
    ok('跨 frame 导出产出新文件', files2.length >= 2, files2.join(','));
    if (files2.length >= 2) {
      const newest = files2
        .map((f) => path.join(dlDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      fs.copyFileSync(newest, path.join(root, 'test', 'e2e-frame.xlsx'));
      ok('跨 frame 文件大小合理', fs.statSync(newest).size > 2000, fs.statSync(newest).size + ' bytes');
    }
  }
} catch (e) {
  ok('执行异常', false, (e && e.message) || String(e));
} finally {
  const passed = steps.filter((s) => s.pass).length;
  console.log('');
  for (const s of steps) console.log(`${s.pass ? '  PASS' : '  FAIL'}  ${s.name}${s.pass ? '' : '  ->  ' + s.detail}`);
  console.log(`\n合计 ${passed}/${steps.length}`);
  try {
    cdp && cdp.close();
    browserCdp && browserCdp.close();
  } catch (e) {
    /* ignore */
  }
  child.kill();
  server.close();
  await sleep(300);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch (e) {
    /* ignore */
  }
  process.exit(passed === steps.length ? 0 : 1);
}
