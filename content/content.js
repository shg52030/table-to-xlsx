/*
 * 内容脚本：悬浮按钮 + 表格选择面板 + 导出编排
 * 只在顶层 frame 渲染界面；所有 frame 都负责响应扫描/取数请求。
 */
(function () {
  if (window.__T2X_CONTENT_LOADED__) return;
  window.__T2X_CONTENT_LOADED__ = true;

  var T2X = window.T2X;
  if (!T2X) return;

  var isTop = false;
  try {
    isTop = window.top === window;
  } catch (e) {
    isTop = false;
  }

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function tableSummaries() {
    var list = T2X.scan();
    return list.map(function (t) {
      return {
        index: t.index,
        rows: t.rows,
        cols: t.cols,
        preview: t.preview,
        title: t.title,
        nested: t.nested,
        merged: !!t.merged,
        fragments: t.fragments || 1,
        virtual: !!t.virtual,
        totalRows: t.totalRows || 0
      };
    });
  }

  /* ---------- 与后台通信 ---------- */
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg || !msg.type) return;

    if (msg.type === 'T2X_SCAN') {
      try {
        send({ type: 'T2X_TABLES', tables: tableSummaries() });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false });
      }
      return;
    }

    if (msg.type === 'T2X_DO_EXTRACT') {
      T2X.extractByIndex(msg.index, msg.options || {})
        .then(function (data) {
          sendResponse({ ok: true, rows: data.rows, merges: data.merges, title: data.title });
        })
        .catch(function (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
        });
      return true; // 异步响应
    }

    if (msg.type === 'T2X_OPEN_PANEL') {
      if (isTop) openPanel();
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'T2X_EXPORT_ALL') {
      if (isTop) {
        openPanel().then(function () {
          if (state.tables.length) doExport();
        });
      }
      sendResponse({ ok: true });
      return;
    }
  });

  /* ---------- 样式（用 CSSOM 设置，绕开页面 CSP） ---------- */
  var STYLES = {
    '.wrap': {
      'font-family': '-apple-system, "Segoe UI", "Microsoft YaHei", sans-serif',
      'font-size': '13px',
      'line-height': '1.5',
      color: '#1f2937',
      'text-align': 'left'
    },
    '.fab': {
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      width: '48px',
      height: '48px',
      'border-radius': '24px',
      background: '#185FA5',
      color: '#ffffff',
      border: 'none',
      cursor: 'pointer',
      'box-shadow': '0 4px 14px rgba(15,23,42,.22)',
      'font-size': '11px',
      'font-weight': '600',
      'letter-spacing': '.3px',
      'font-family': 'inherit'
    },
    '.panel': {
      position: 'fixed',
      right: '20px',
      bottom: '170px',
      width: '380px',
      'max-width': 'calc(100vw - 40px)',
      'max-height': 'calc(100vh - 200px)',
      background: '#ffffff',
      'border-radius': '12px',
      'box-shadow': '0 12px 40px rgba(15,23,42,.18)',
      border: '1px solid #e5e7eb',
      overflow: 'hidden',
      'flex-direction': 'column'
    },
    '.head': {
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '11px 14px',
      'border-bottom': '1px solid #eef0f3',
      'font-weight': '600',
      'font-size': '14px',
      color: '#0f172a'
    },
    '.close': {
      border: 'none',
      background: 'transparent',
      'font-size': '20px',
      'line-height': '1',
      color: '#94a3b8',
      cursor: 'pointer',
      padding: '0 2px',
      'font-family': 'inherit'
    },
    '.toolbar': {
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'space-between',
      padding: '7px 14px',
      background: '#f8fafc',
      'font-size': '12px',
      color: '#64748b'
    },
    '.list': {
      'max-height': '300px',
      'overflow-y': 'auto',
      'overflow-x': 'hidden',
      padding: '4px 8px',
      'flex-grow': '1'
    },
    '.item': {
      display: 'flex',
      gap: '8px',
      'align-items': 'flex-start',
      padding: '7px 8px',
      'border-radius': '8px',
      cursor: 'pointer'
    },
    '.item input': { 'margin-top': '3px', 'flex-shrink': '0' },
    '.meta': { display: 'flex', 'flex-direction': 'column', gap: '1px', 'min-width': '0', flex: '1' },
    '.meta b': {
      'font-weight': '600',
      'font-size': '12px',
      color: '#0f172a',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis'
    },
    '.meta em': {
      'font-style': 'normal',
      'font-size': '11px',
      color: '#64748b',
      'white-space': 'nowrap',
      overflow: 'hidden',
      'text-overflow': 'ellipsis'
    },
    '.badge': {
      'font-size': '10px',
      padding: '1px 6px',
      'border-radius': '999px',
      background: '#eef2ff',
      color: '#4338ca',
      'white-space': 'nowrap',
      'flex-shrink': '0'
    },
    '.opts': {
      display: 'flex',
      'flex-wrap': 'wrap',
      gap: '10px 14px',
      padding: '9px 14px',
      'border-top': '1px solid #eef0f3',
      'font-size': '12px',
      color: '#475569'
    },
    '.chk': { display: 'flex', 'align-items': 'center', gap: '5px', cursor: 'pointer', 'user-select': 'none' },
    '.foot': {
      display: 'flex',
      gap: '8px',
      padding: '10px 14px',
      'border-top': '1px solid #eef0f3',
      'justify-content': 'flex-end'
    },
    '.btn': {
      'border-radius': '8px',
      padding: '7px 16px',
      'font-size': '13px',
      cursor: 'pointer',
      border: '1px solid transparent',
      'font-family': 'inherit'
    },
    '.btn.primary': { background: '#185FA5', color: '#ffffff' },
    '.btn.ghost': { background: '#ffffff', 'border-color': '#d8dee6', color: '#334155' },
    '.status': {
      padding: '0 14px 9px',
      'font-size': '11px',
      color: '#64748b',
      'min-height': '15px',
      'word-break': 'break-all'
    }
  };

  function applyStyles(root) {
    Object.keys(STYLES).forEach(function (sel) {
      var els = root.querySelectorAll(sel);
      var decl = STYLES[sel];
      for (var i = 0; i < els.length; i++) {
        for (var k in decl) {
          try {
            els[i].style.setProperty(k, decl[k]);
          } catch (e) {
            /* ignore */
          }
        }
      }
    });
  }

  var TEMPLATE =
    '<div class="wrap">' +
    '<button class="fab" id="fab" title="导出网页表格">XLS</button>' +
    '<div class="panel" id="panel">' +
    '<div class="head"><span>导出表格为 Excel</span><button class="close" id="close" title="关闭">×</button></div>' +
    '<div class="toolbar"><label class="chk"><input type="checkbox" id="selAll"><span>全选</span></label><span id="count">正在扫描…</span></div>' +
    '<div class="list" id="list"></div>' +
    '<div class="opts">' +
    '<label class="chk"><input type="checkbox" id="optHidden"><span>包含隐藏行</span></label>' +
    '<label class="chk"><input type="checkbox" id="optNum" checked><span>数字转数值</span></label>' +
    '<label class="chk"><input type="checkbox" id="optAsk"><span>询问保存位置</span></label>' +
    '</div>' +
    '<div class="foot"><button class="btn ghost" id="cancel">取消</button><button class="btn primary" id="go" disabled>导出</button></div>' +
    '<div class="status" id="status"></div>' +
    '</div>' +
    '</div>';

  var ui = null;
  var state = { tables: [], checked: {}, busy: false };

  function ensureUI() {
    if (ui) return ui;

    var host = document.createElement('div');
    host.id = '__t2x_host';
    host.style.setProperty('all', 'initial');
    host.style.setProperty('position', 'fixed');
    host.style.setProperty('right', '20px');
    host.style.setProperty('bottom', '110px');
    host.style.setProperty('z-index', '2147483647');

    var shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = TEMPLATE;
    applyStyles(shadow);
    shadow.getElementById('panel').style.setProperty('display', 'none');

    var $ = function (id) {
      return shadow.getElementById(id);
    };

    ui = {
      host: host,
      shadow: shadow,
      fab: $('fab'),
      panel: $('panel'),
      list: $('list'),
      count: $('count'),
      status: $('status'),
      go: $('go'),
      selAll: $('selAll'),
      optHidden: $('optHidden'),
      optNum: $('optNum'),
      optAsk: $('optAsk')
    };

    ui.fab.addEventListener('click', function () {
      if (ui.panel.style.display === 'flex') closePanel();
      else openPanel();
    });
    $('close').addEventListener('click', closePanel);
    $('cancel').addEventListener('click', closePanel);
    ui.go.addEventListener('click', doExport);
    ui.selAll.addEventListener('change', function () {
      state.tables.forEach(function (t, i) {
        state.checked[i] = ui.selAll.checked;
      });
      syncCheckboxes();
    });
    ui.optHidden.addEventListener('change', saveOptions);
    ui.optNum.addEventListener('change', saveOptions);
    ui.optAsk.addEventListener('change', saveOptions);

    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    (document.body || document.documentElement).appendChild(host);

    chrome.storage.local.get(['t2x_hidden', 't2x_num', 't2x_ask'], function (r) {
      ui.optHidden.checked = !!r.t2x_hidden;
      ui.optNum.checked = r.t2x_num !== false;
      ui.optAsk.checked = !!r.t2x_ask;
    });

    return ui;
  }

  function saveOptions() {
    if (!ui) return;
    chrome.storage.local.set({
      t2x_hidden: ui.optHidden.checked,
      t2x_num: ui.optNum.checked,
      t2x_ask: ui.optAsk.checked
    });
  }

  function setStatus(text) {
    if (ui) ui.status.textContent = text || '';
  }

  function syncCheckboxes() {
    if (!ui) return;
    var boxes = ui.list.querySelectorAll('input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = !!state.checked[i];
    }
    var n = Object.keys(state.checked).filter(function (k) {
      return state.checked[k];
    }).length;
    ui.go.textContent = n ? '导出 ' + n + ' 个表格' : '导出';
    ui.go.disabled = n === 0 || state.busy;
    ui.go.style.background = ui.go.disabled ? '#cbd5e1' : '#185FA5';
    ui.go.style.cursor = ui.go.disabled ? 'not-allowed' : 'pointer';
  }

  function renderList() {
    if (!ui) return;
    ui.list.textContent = '';

    if (!state.tables.length) {
      var empty = document.createElement('div');
      empty.style.setProperty('padding', '18px 10px');
      empty.style.setProperty('text-align', 'center');
      empty.style.setProperty('color', '#94a3b8');
      empty.style.setProperty('font-size', '12px');
      empty.textContent = '本页没有检测到可导出的表格';
      ui.list.appendChild(empty);
      ui.count.textContent = '共 0 个表格';
      syncCheckboxes();
      return;
    }

    state.tables.forEach(function (t, i) {
      var item = document.createElement('label');
      item.className = 'item';

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!state.checked[i];
      box.addEventListener('change', function () {
        state.checked[i] = box.checked;
        syncCheckboxes();
      });

      var meta = document.createElement('span');
      meta.className = 'meta';

      var b = document.createElement('b');
      b.textContent = t.title || '表格' + (i + 1);

      var em = document.createElement('em');
      var metaText = t.rows + ' 行 × ' + t.cols + ' 列';
      if (t.virtual) metaText += ' · 虚拟滚动';
      if (t.merged) metaText += ' · 由 ' + t.fragments + ' 个片段合并';
      em.textContent = metaText + (t.preview ? ' · ' + t.preview : '');

      meta.appendChild(b);
      meta.appendChild(em);
      item.appendChild(box);
      item.appendChild(meta);

      if (t.inFrame) {
        var badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = 'iframe';
        item.appendChild(badge);
      }

      ui.list.appendChild(item);
    });

    ui.count.textContent = '共 ' + state.tables.length + ' 个表格';
    ui.selAll.checked = state.tables.every(function (t, i) {
      return state.checked[i];
    });
    // 列表项是动态创建的，需要重新套一遍样式
    applyStyles(ui.shadow);
    syncCheckboxes();
  }

  function openPanel() {
    ensureUI();
    ui.panel.style.display = 'flex';
    ui.panel.style.flexDirection = 'column';
    state.checked = {};
    state.tables = [];
    ui.list.textContent = '';
    ui.count.textContent = '正在扫描…';
    setStatus('');
    syncCheckboxes();

    return send({ type: 'T2X_GET_TABLES' })
      .then(function (res) {
        var list = (res && res.ok && res.tables) || [];
        state.tables = list;
        list.forEach(function (t, i) {
          state.checked[i] = true;
        });
        renderList();
      })
      .catch(function (e) {
        ui.count.textContent = '扫描失败';
        setStatus('扫描失败：' + String((e && e.message) || e));
      });
  }

  function closePanel() {
    if (!ui) return;
    ui.panel.style.display = 'none';
    state.busy = false;
    syncCheckboxes();
  }

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function stamp() {
    var d = new Date();
    return (
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes())
    );
  }

  function safeName(s) {
    return String(s || '')
      .replace(/[\\\/:*?"<>|\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
  }

  function downloadBytes(bytes, filename) {
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);

    return send({
      type: 'T2X_DOWNLOAD',
      url: url,
      filename: filename,
      saveAs: !!(ui && ui.optAsk.checked)
    }).then(function (res) {
      if (!res || !res.ok) {
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        setTimeout(function () {
          a.remove();
        }, 1000);
      }
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 120000);
      return true;
    });
  }

  function doExport() {
    if (!ui || state.busy) return;
    var picked = [];
    state.tables.forEach(function (t, i) {
      if (state.checked[i]) picked.push(t);
    });
    if (!picked.length) return;

    state.busy = true;
    syncCheckboxes();

    // 虚拟滚动表格需要滚动采集，把进度回显到状态栏
    T2X.onHarvestProgress = function (got, estimate) {
      setStatus('正在采集全部行… ' + got + ' / 约 ' + estimate);
    };

    var options = {
      includeHidden: ui.optHidden.checked
    };
    var detectNumbers = ui.optNum.checked;
    var sheets = [];
    var failed = [];

    var chain = Promise.resolve();
    picked.forEach(function (t) {
      chain = chain.then(function () {
        setStatus(t.virtual ? '正在采集全部行：' + (t.title || '表格') : '正在读取：' + (t.title || '表格'));
        return send({
          type: 'T2X_EXTRACT',
          frameId: t.frameId,
          index: t.index,
          options: options
        }).then(function (res) {
          if (res && res.ok && res.rows && res.rows.length) {
            sheets.push({ name: res.title || t.title, rows: res.rows, merges: res.merges || [] });
          } else {
            failed.push((t.title || '表格') + '：' + ((res && res.error) || '无数据'));
          }
        });
      });
    });

    chain
      .then(function () {
        if (!sheets.length) throw new Error(failed[0] || '没有读到任何数据');
        setStatus('正在生成 xlsx…');
        var bytes = T2X.buildWorkbook(sheets, { detectNumbers: detectNumbers });
        var name = safeName(document.title) || '网页表格';
        return downloadBytes(bytes, name + '_' + stamp() + '.xlsx').then(function () {
          var msg = '已导出 ' + sheets.length + ' 个表格（' + Math.round(bytes.length / 1024) + ' KB）';
          if (failed.length) msg += '，' + failed.length + ' 个失败';
          setStatus(msg);
          setTimeout(closePanel, 1200);
        });
      })
      .catch(function (e) {
        setStatus('导出失败：' + String((e && e.message) || e));
      })
      .then(function () {
        T2X.onHarvestProgress = null;
        state.busy = false;
        syncCheckboxes();
      });
  }

  /* ---------- 悬浮按钮出现时机 ---------- */
  function hasTables() {
    var tables = document.querySelectorAll('table');
    for (var i = 0; i < tables.length; i++) {
      if (tables[i].rows && tables[i].rows.length > 0) return true;
    }
    return false;
  }

  var observer = null;
  var observerTimer = null;

  function watchTables() {
    if (!isTop || !document.body) return;
    if (hasTables()) {
      ensureUI();
      return;
    }
    var deadline = Date.now() + 20000;
    observer = new MutationObserver(function () {
      if (Date.now() > deadline) {
        observer.disconnect();
        observer = null;
        return;
      }
      if (observerTimer) return;
      observerTimer = setTimeout(function () {
        observerTimer = null;
        if (hasTables()) {
          ensureUI();
          if (observer) {
            observer.disconnect();
            observer = null;
          }
        }
      }, 600);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (isTop) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', watchTables);
    } else {
      watchTables();
    }
  }

  /* ---------- 自动化测试钩子（仅带 ?t2x_test=1 时启用） ---------- */
  try {
    if (new URLSearchParams(location.search).has('t2x_test')) {
      document.addEventListener('t2x:extract', function () {
        var out = document.getElementById('__t2x_test_out');
        if (!out) {
          out = document.createElement('pre');
          out.id = '__t2x_test_out';
          out.style.display = 'none';
          (document.body || document.documentElement).appendChild(out);
        }
        (async function () {
          try {
            var idx = parseInt(document.documentElement.getAttribute('data-t2x-index') || '0', 10);
            T2X.scan();
            var data = await T2X.extractByIndex(idx, {});
            var bytes = T2X.buildWorkbook([{ name: data.title || 'T', rows: data.rows, merges: data.merges }], {
              detectNumbers: true
            });
            out.textContent = JSON.stringify({
              ok: true,
              rows: data.rows,
              merges: data.merges,
              size: bytes.length,
              b64: T2X.toBase64(bytes)
            });
          } catch (e) {
            out.textContent = JSON.stringify({ ok: false, error: String((e && e.message) || e) });
          }
        })();
      });
    }
  } catch (e) {
    /* ignore */
  }
})();
