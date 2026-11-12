/* 截图：打开面板后截一张，用于交付预览 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.cwd();
const pagePath = process.argv[2] || 'test/page.html';
const outPath = process.argv[3] || 'test/preview.png';
const PORT_WEB = 8897;
const PORT_CDP = 9339;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = path.join(root, req.url.split('?')[0]);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'text/plain' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(PORT_WEB, '127.0.0.1', r));

const profile = path.join(os.tmpdir(), 't2x-shot-' + Date.now());
const child = spawn(
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--enable-unsafe-extension-debugging', '--remote-debugging-port=' + PORT_CDP, '--user-data-dir=' + profile, '--window-size=1100,760', 'about:blank'],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2500);

const ver = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
let bid = 0;
const bp = new Map();
bws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && bp.has(m.id)) {
    bp.get(m.id)(m);
    bp.delete(m.id);
  }
};
await new Promise((r) => (bws.onopen = r));
const bsend = (method, params) =>
  new Promise((r) => {
    const i = ++bid;
    bp.set(i, r);
    bws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
await bsend('Extensions.loadUnpacked', { path: root });
await sleep(800);

const list = await (await fetch(`http://127.0.0.1:${PORT_CDP}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const p = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && p.has(m.id)) {
    p.get(m.id)(m);
    p.delete(m.id);
  }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params) =>
  new Promise((r) => {
    const i = ++id;
    p.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT_WEB}/${pagePath.replace(/^\/+/,'')}` });
await sleep(2200);

await send('Runtime.evaluate', { expression: "document.getElementById('__t2x_host').shadowRoot.getElementById('fab').click()" });
await sleep(1600);

const diag = await send('Runtime.evaluate', {
  expression: "(() => { const sr = document.getElementById('__t2x_host').shadowRoot; const pn = sr.getElementById('panel'); return JSON.stringify({display: pn.style.display, items: sr.querySelectorAll('.item').length, count: sr.getElementById('count').textContent, status: sr.getElementById('status').textContent}); })()",
  returnByValue: true
});
console.log('diag:', diag.result.result.value);

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(path.join(root, outPath), Buffer.from(shot.result.data, 'base64'));
console.log('saved ' + outPath);

child.kill();
server.close();
process.exit(0);
