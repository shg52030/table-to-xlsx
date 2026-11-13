/*
 * 通用探针：在无头 Chrome 里打开一个本地页面，执行一段 JS 并打印结果。
 * 用法：node test/eval.mjs <相对路径> "<js 表达式>"
 */
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();
// Git Bash 会把 /test/x.html 这类参数转成 Windows 路径，这里统一还原成站内路径
const target = '/' + String(process.argv[2] || 'test/vxe.html').replace(/\\/g, '/').split('/').filter(Boolean).slice(-2).join('/');
const expr = process.argv[3] || 'document.title';
const PORT_WEB = 8890 + Math.floor(Math.random() * 8);
const PORT_CDP = 9350 + Math.floor(Math.random() * 8);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT_WEB, '127.0.0.1', r));

const profile = path.join(os.tmpdir(), 't2x-eval-' + Date.now());
const child = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT_CDP, '--user-data-dir=' + profile, '--window-size=1600,1000', 'about:blank'],
  { stdio: 'ignore' }
);

function killTree(pid) {
  try {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch (e) {
    /* ignore */
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
try {
  let list = null;
  for (let i = 0; i < 40; i++) {
    try {
      list = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
      if (list.some((t) => t.type === 'page')) break;
    } catch (e) {
      /* wait */
    }
    await sleep(300);
  }
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params: params || {} }));
    });

  await send('Page.enable');
  const nav = await send('Page.navigate', { url: `http://127.0.0.1:${PORT_WEB}${target}` });
  if (nav.error) console.error('导航失败:', JSON.stringify(nav.error));

  let href = '';
  for (let i = 0; i < 40; i++) {
    await sleep(200);
    const r = await send('Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    href = (r.result && r.result.result && r.result.result.value) || '';
    if (href.indexOf(target) >= 0) break;
  }
  if (href.indexOf(target) < 0) console.error('页面未加载，当前地址:', href);

  // 测试脚本可能是异步的（虚拟滚动采集），等 #out 写出内容再取值
  for (let i = 0; i < 120; i++) {
    const r0 = await send('Runtime.evaluate', {
      expression: "(() => { const o = document.getElementById('out'); return o && o.textContent ? o.textContent.length : 0; })()",
      returnByValue: true
    });
    if (((r0.result && r0.result.result && r0.result.result.value) || 0) > 0) break;
    await sleep(150);
  }
  await sleep(200);

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  const out = r.result && r.result.result;
  if (r.result && r.result.exceptionDetails) {
    console.error('表达式异常:', JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  }
  const val = out ? out.value : null;
  console.log(JSON.stringify(val, null, 2));

  // 若返回值是 { passed, total }，按断言结果决定退出码
  if (val && typeof val === 'object' && typeof val.passed === 'number' && typeof val.total === 'number') {
    globalThis.__FAIL__ = val.passed !== val.total;
  }
} finally {
  try {
    ws && ws.close();
  } catch (e) {
    /* ignore */
  }
  killTree(child.pid);
  server.close();
  await sleep(200);
  process.exit(globalThis.__FAIL__ ? 1 : 0);
}
