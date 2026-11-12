/*
 * 用 CDP 驱动无头 Chrome 打开测试页，取回断言结果与生成的 xlsx（base64）。
 * 用法：node test/run-tests.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const pageUrl = 'file:///' + path.join(root, 'test', 'run.html').replace(/\\/g, '/');
const PORT = 9333;

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const chromePath = CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('未找到 Chrome/Edge 可执行文件');
  process.exit(2);
}

const profile = path.join(os.tmpdir(), 't2x-profile-' + Date.now());
const args = [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions-except=' + path.join(root),
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=1280,900',
  pageUrl
];

const child = spawn(chromePath, args, { stdio: 'ignore' });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (e) {
      /* not ready */
    }
    await sleep(300);
  }
  throw new Error('无法连接调试端口');
}

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
        close() {
          ws.close();
        }
      });
    ws.onerror = (e) => reject(new Error('WebSocket 失败'));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
  });
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r && r.result ? r.result.value : undefined;
}

try {
  const target = await getTarget();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  let title = '';
  for (let i = 0; i < 80; i++) {
    title = (await evaluate(cdp, 'document.title')) || '';
    if (/^(ALL PASS|FAIL)/.test(title)) break;
    await sleep(250);
  }

  const raw = await evaluate(cdp, "document.getElementById('out') ? document.getElementById('out').textContent : ''");
  const b64 = await evaluate(cdp, "document.getElementById('b64') ? document.getElementById('b64').textContent : ''");

  let report = null;
  try {
    report = JSON.parse(raw);
  } catch (e) {
    console.error('无法解析测试输出：', String(raw).slice(0, 500));
    process.exit(1);
  }

  console.log(`\n${title}\n`);
  for (const r of report.results) {
    console.log(`${r.pass ? '  PASS' : '  FAIL'}  ${r.name}${r.pass ? '' : '  ->  ' + r.detail}`);
  }
  console.log(`\n合计 ${report.passed}/${report.total}，页面内耗时 ${report.cost}ms`);

  if (b64) {
    const outFile = path.join(root, 'test', 'out.xlsx');
    fs.writeFileSync(outFile, Buffer.from(b64, 'base64'));
    console.log('已写出 ' + outFile + ' (' + fs.statSync(outFile).size + ' bytes)');
  }

  cdp.close();
  process.exit(report.passed === report.total ? 0 : 1);
} catch (e) {
  console.error('测试执行失败：', e);
  process.exit(3);
} finally {
  setTimeout(() => {
    try {
      child.kill();
    } catch (e) {
      /* ignore */
    }
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  }, 300);
}
