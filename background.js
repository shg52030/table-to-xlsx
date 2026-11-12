/*
 * Service worker：跨 frame 汇总表格清单、路由取数请求、执行下载。
 */
var store = new Map(); // tabId -> Map(frameId -> tables[])

function getTabMap(tabId) {
  if (!store.has(tabId)) store.set(tabId, new Map());
  return store.get(tabId);
}

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

async function broadcastScan(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'T2X_SCAN' });
  } catch (e) {
    /* 该 tab 里可能没有 content script（如 chrome:// 页面），忽略 */
  }
}

function aggregate(tabId) {
  var map = store.get(tabId);
  if (!map) return [];
  var frames = Array.from(map.keys()).sort(function (a, b) {
    return a - b;
  });
  var out = [];
  for (var i = 0; i < frames.length; i++) {
    var fid = frames[i];
    var list = map.get(fid) || [];
    for (var j = 0; j < list.length; j++) {
      var item = Object.assign({}, list[j]);
      item.frameId = fid;
      item.inFrame = fid !== 0;
      out.push(item);
    }
  }
  return out;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'T2X_TABLES') {
    var tabId = sender.tab && sender.tab.id;
    if (tabId === undefined || tabId < 0) return;
    getTabMap(tabId).set(sender.frameId || 0, msg.tables || []);
    return;
  }

  if (msg.type === 'T2X_GET_TABLES') {
    (async function () {
      var tid = msg.tabId;
      if (tid === undefined && sender.tab) tid = sender.tab.id;
      if (tid === undefined) {
        sendResponse({ ok: false, error: '找不到标签页' });
        return;
      }
      await broadcastScan(tid);
      await sleep(400);
      sendResponse({ ok: true, tables: aggregate(tid) });
    })();
    return true;
  }

  if (msg.type === 'T2X_EXTRACT') {
    (async function () {
      var tid = msg.tabId;
      if (tid === undefined && sender.tab) tid = sender.tab.id;
      try {
        var res = await chrome.tabs.sendMessage(
          tid,
          { type: 'T2X_DO_EXTRACT', index: msg.index, options: msg.options || {} },
          { frameId: msg.frameId || 0 }
        );
        sendResponse(res || { ok: false, error: '无响应' });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
    })();
    return true;
  }

  if (msg.type === 'T2X_DOWNLOAD') {
    chrome.downloads.download(
      {
        url: msg.url,
        filename: msg.filename || 'table.xlsx',
        saveAs: !!msg.saveAs,
        conflictAction: 'uniquify'
      },
      function (id) {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id: id });
        }
      }
    );
    return true;
  }

  if (msg.type === 'T2X_OPEN_PANEL') {
    var t2 = sender.tab && sender.tab.id;
    if (t2 === undefined) return;
    chrome.tabs.sendMessage(t2, { type: 'T2X_OPEN_PANEL' }, { frameId: 0 }).catch(function () {});
    sendResponse({ ok: true });
    return;
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  store.delete(tabId);
});

chrome.tabs.onUpdated.addListener(function (tabId, info) {
  if (info.status === 'loading') store.delete(tabId);
});
