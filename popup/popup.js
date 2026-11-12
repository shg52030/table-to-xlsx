function notify(text) {
  document.getElementById('msg').textContent = text || '';
}

function getActiveTab() {
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      resolve(tabs && tabs[0]);
    });
  });
}

function sendToTab(tabId, msg) {
  return new Promise(function (resolve) {
    try {
      chrome.tabs.sendMessage(tabId, msg, function (res) {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function run(type) {
  notify('');
  return getActiveTab().then(function (tab) {
    if (!tab || tab.id === undefined) {
      notify('没有可用的标签页');
      return;
    }
    if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab.url || '')) {
      notify('浏览器内部页面无法注入脚本，请在普通网页上使用');
      return;
    }
    return sendToTab(tab.id, { type: type }).then(function (res) {
      if (!res) {
        notify('当前页面还没注入脚本，请按 F5 刷新后重试');
      } else {
        window.close();
      }
    });
  });
}

document.getElementById('open').addEventListener('click', function () {
  run('T2X_OPEN_PANEL');
});

document.getElementById('all').addEventListener('click', function () {
  run('T2X_EXPORT_ALL');
});
