/*
 * 分页表格的全量采集
 *
 * 与虚拟滚动不同：分页表格的数据在服务端，DOM 里永远只有当前页。
 * 所以这里做的是「替用户点翻页按钮」：
 *   调大每页条数 → 抓当前页 → 点下一页 → 等数据真的变了 → 继续
 *
 * 只依赖 DOM 语义（el-pagination / aria-label / 文本），不依赖框架内部状态。
 */
(function (root) {
  var T2X = (root.T2X = root.T2X || {});
  var doc = root.document || document;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function txt(el) {
    return el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function num(s) {
    var m = String(s || '').match(/(\d[\d,]*)/);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
  }

  function visible(el) {
    if (!el) return false;
    var cs = null;
    try {
      cs = root.getComputedStyle(el);
    } catch (e) {
      return false;
    }
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function q(scope, selectors) {
    var list = String(selectors).split(',');
    for (var i = 0; i < list.length; i++) {
      var el = scope.querySelector(list[i].trim());
      if (el) return el;
    }
    return null;
  }

  function fireClick(el) {
    if (!el) return false;
    try {
      if (typeof el.click === 'function') el.click();
      else
        el.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true, view: root })
        );
      return true;
    } catch (e) {
      return false;
    }
  }

  function isDisabled(el) {
    if (!el) return true;
    var node = el;
    for (var i = 0; i < 4 && node; i++) {
      if (node.disabled === true) return true;
      if (node.getAttribute && node.getAttribute('disabled') !== null) return true;
      if (node.getAttribute && node.getAttribute('aria-disabled') === 'true') return true;
      if (/(^|\s)(disabled|is-disabled|is--disabled)(\s|$)/.test(String(node.className || ''))) return true;
      node = node.parentElement;
    }
    return false;
  }

  function looksPrev(el) {
    var s = txt(el) + ' ' + String(el.getAttribute('aria-label') || '') + ' ' + String(el.className || '');
    return /上一页|上一頁|prev|previous/i.test(s);
  }

  /* 找「下一页」按钮 */
  function findNext(scope) {
    var rootEl = scope || doc;
    var sels = [
      '.btn-next',
      '[aria-label="下一页"]',
      '[aria-label="下一頁"]',
      '[title="下一页"]',
      '.ant-pagination-next',
      '.vxe-pager--next-btn',
      '.pagination-next',
      'button.next',
      'a.next',
      'li.next'
    ];
    for (var i = 0; i < sels.length; i++) {
      var found = rootEl.querySelectorAll(sels[i]);
      for (var j = 0; j < found.length; j++) {
        if (visible(found[j]) && !looksPrev(found[j])) return found[j];
      }
    }
    var all = rootEl.querySelectorAll('button, a, li, span[role="button"]');
    for (var k = 0; k < all.length; k++) {
      var e = all[k];
      var s = txt(e) + ' ' + String(e.getAttribute('aria-label') || '') + ' ' + String(e.title || '');
      if (/下一页|下一頁|next|›|»/i.test(s) && visible(e) && !looksPrev(e)) return e;
    }
    return null;
  }

  function guessFramework(el) {
    var c = String(el.className || '');
    if (/el-pagination/.test(c)) return 'element';
    if (/ant-pagination/.test(c)) return 'antd';
    if (/vxe-pager/.test(c)) return 'vxe';
    if (/layui/.test(c)) return 'layui';
    return 'generic';
  }

  /* 探测分页控件；优先常见组件库，再退化到通用 class / 下一页按钮 */
  function detectPager() {
    var selectors = [
      '.el-pagination',
      '.ant-pagination',
      '.vxe-pager',
      '.layui-laypage',
      '[class*="pagination"]',
      '[class*="pager"]'
    ];
    var seen = [];
    for (var s = 0; s < selectors.length; s++) {
      var els = doc.querySelectorAll(selectors[s]);
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (seen.indexOf(el) >= 0) continue;
        seen.push(el);
        var next = findNext(el);
        if (next) return { root: el, next: next, framework: guessFramework(el) };
      }
    }
    var btn = findNext(doc);
    if (btn) {
      var host = btn.closest('[class*="pagination"]') || btn.closest('[class*="pager"]') || btn.parentElement || doc.body;
      return { root: host, next: btn, framework: 'generic' };
    }
    return null;
  }

  /* 读取当前分页状态 */
  function pageInfo(p) {
    var totalEl = q(p.root, '.el-pagination__total, .vxe-pager--total, .vxe-pager--left-wrapper, [class*="total"]');
    var total = num(txt(totalEl));

    var sizeEl = q(
      p.root,
      '.el-pagination__sizes .el-select__placeholder, .el-pagination__sizes .el-select__selected-item, .vxe-pager--sizes, .vxe-pager--right-wrapper, [class*="sizes"]'
    );
    var size = num(txt(sizeEl));
    if (!size) {
      var sel = q(p.root, 'select');
      if (sel) size = num(txt(sel.options && sel.options[sel.selectedIndex]));
    }

    var active = q(
      p.root,
      '.el-pager li.is-active, .el-pager li.active, .ant-pagination-item-active, .vxe-pager--num-btn.is-active, .vxe-pager--current, [aria-current="true"]'
    );
    var page = num(txt(active)) || 1;

    var jump = q(p.root, '.el-pagination__jump input, input[aria-label="页"], input[type="number"]');
    var max = jump ? parseInt(jump.getAttribute('max'), 10) : 0;
    if (!max && jump && jump.max) max = parseInt(jump.max, 10);
    var totalPages = max || (size && total ? Math.ceil(total / size) : 0);

    return { total: total, size: size, page: page, totalPages: totalPages };
  }

  var SIZE_CAP = 1000;

  function sizeBox(p) {
    return q(p.root, '.el-pagination__sizes, [class*="sizes"]');
  }

  function uniqDesc(list) {
    var seen = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var v = parseInt(list[i], 10);
      if (v > 0 && v <= SIZE_CAP && !seen[v]) {
        seen[v] = true;
        out.push(v);
      }
    }
    return out.sort(function (a, b) {
      return b - a;
    });
  }

  function nativeSizeOptions(box) {
    var native = box.querySelector('select');
    if (!native) return null;
    var vals = [];
    for (var i = 0; i < native.options.length; i++) {
      vals.push(num(native.options[i].textContent) || num(native.options[i].value));
    }
    return uniqDesc(vals);
  }

  function visibleOptionEls() {
    var poppers = doc.querySelectorAll(
      '.el-select-dropdown, .el-popper, .vxe-select-dropdown, .vxe-select--panel, [role="listbox"], .el-select-dropdown__list'
    );
    var out = [];
    var seen = {};
    for (var pi = 0; pi < poppers.length; pi++) {
      if (!visible(poppers[pi])) continue;
      var items = poppers[pi].querySelectorAll(
        '.el-select-dropdown__item, .vxe-select-option, .vxe-select-dropdown__item, .vxe-select--option, [role="option"], li'
      );
      for (var oi = 0; oi < items.length; oi++) {
        var el = items[oi];
        if (!visible(el)) continue;
        var v = num(txt(el));
        if (v && v <= SIZE_CAP && !seen[v]) {
          seen[v] = true;
          out.push({ v: v, el: el });
        }
      }
    }
    out.sort(function (a, b) {
      return b.v - a.v;
    });
    return out;
  }

  function closeSizeMenu() {
    try {
      doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } catch (e) {
      /* ignore */
    }
  }

  /* 读出当前页面实际支持的每页条数，降序返回；不改页面状态 */
  async function readPageSizeOptions(p) {
    p = p || detectPager();
    if (!p) return [];
    var box = sizeBox(p);
    if (!box) return [];
    var native = nativeSizeOptions(box);
    if (native) return native;

    var trigger = q(box, '.el-select__wrapper, .el-select, .el-input__inner, .vxe-select--wrapper, .vxe-input--inner');
    if (!trigger) return [];
    fireClick(trigger);
    await sleep(150);
    var entries = visibleOptionEls();
    closeSizeMenu();
    return entries.map(function (e) {
      return e.v;
    });
  }

  function chooseSize(options, want) {
    if (!options.length) return 0;
    want = parseInt(want, 10) || 0;
    if (!want) return options[0];
    if (options.indexOf(want) >= 0) return want;
    for (var i = 0; i < options.length; i++) if (options[i] <= want) return options[i];
    return options[options.length - 1];
  }

  /* want=0 表示自动选最大；指定值不可用时回退到最接近的较小值并给出提示 */
  async function setPageSize(p, want) {
    var box = sizeBox(p);
    if (!box) return { ok: false, reason: '未找到每页条数选择器' };

    var nativeVals = nativeSizeOptions(box);
    if (nativeVals) {
      var chosenNative = chooseSize(nativeVals, want);
      if (!chosenNative) return { ok: false, reason: '下拉框没有可用的条数选项' };
      var native = box.querySelector('select');
      native.value = String(chosenNative);
      native.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(250);
      return {
        ok: true,
        size: chosenNative,
        options: nativeVals,
        warn: chosenNative !== parseInt(want, 10) && want ? '页面不支持 ' + want + ' 条/页，已改用 ' + chosenNative : ''
      };
    }

    var trigger = q(box, '.el-select__wrapper, .el-select, .el-input__inner, .vxe-select--wrapper, .vxe-input--inner');
    if (!trigger) return { ok: false, reason: '无法打开每页条数下拉框' };
    fireClick(trigger);
    await sleep(150);

    var entries = visibleOptionEls();
    if (!entries.length) {
      closeSizeMenu();
      return { ok: false, reason: '没有读到下拉选项（可能是自定义组件）' };
    }

    var values = entries.map(function (e) {
      return e.v;
    });
    var chosen = chooseSize(values, want);
    var picked = null;
    for (var i = 0; i < entries.length; i++) if (entries[i].v === chosen) picked = entries[i].el;
    if (!picked) {
      closeSizeMenu();
      return { ok: false, reason: '无法选中 ' + chosen + ' 条/页' };
    }

    fireClick(picked);
    closeSizeMenu();
    for (var w = 0; w < 40; w++) {
      await sleep(100);
      if (pageInfo(p).size === chosen) {
        return {
          ok: true,
          size: chosen,
          options: values,
          warn: chosen !== parseInt(want, 10) && want ? '页面不支持 ' + want + ' 条/页，已改用 ' + chosen : ''
        };
      }
    }
    return { ok: false, reason: '选择 ' + chosen + ' 条/页后页面未更新', options: values };
  }

  function hasLoading() {
    var masks = doc.querySelectorAll('.el-loading-mask, [class*="loading-mask"]');
    for (var i = 0; i < masks.length; i++) if (visible(masks[i])) return true;
    return false;
  }

  /* 当前表格的正文指纹：取前几行和最后几行，判断翻页是否真的换了数据 */
  function sigOfList(list, index) {
    var item = list && list[index];
    var group = item && item.group;
    var table = group && group.bodies && group.bodies[0] && group.bodies[0].el;
    if (!table || !table.rows) return '';
    var parts = [];
    var rows = table.rows;
    var picks = [];
    for (var a = 0; a < Math.min(3, rows.length); a++) picks.push(rows[a]);
    for (var b = Math.max(3, rows.length - 2); b < rows.length; b++) picks.push(rows[b]);
    for (var i = 0; i < picks.length; i++) {
      var cells = [];
      for (var c = 0; c < picks[i].cells.length && c < 8; c++) cells.push(txt(picks[i].cells[c]));
      parts.push(cells.join('~'));
    }
    return parts.join('|');
  }

  async function waitChange(beforeSig, getSig, shouldStop, timeout) {
    var end = Date.now() + (timeout || 8000);
    while (Date.now() < end) {
      if (shouldStop && shouldStop()) return { ok: false, stopped: true, reason: '用户取消' };
      await sleep(120);
      if (hasLoading()) continue;
      var sig = getSig();
      if (sig && sig !== beforeSig) return { ok: true, sig: sig };
    }
    return { ok: false, reason: '等待翻页数据更新超时' };
  }

  /* 翻页后 DOM 节点会被替换，按表格特征重新定位，不能沿用旧引用 */
  function resolveIndex(list, desc) {
    if (!list || !list.length) return -1;
    function same(t) {
      if (!t) return false;
      var titleOk = !desc.title || !t.title || t.title === desc.title || t.title.indexOf(desc.title) >= 0 || desc.title.indexOf(t.title) >= 0;
      var colsOk = !desc.cols || t.cols === desc.cols;
      return titleOk && colsOk;
    }
    if (desc && desc.index < list.length && same(list[desc.index])) return desc.index;
    for (var i = 0; i < list.length; i++) if (same(list[i])) return i;
    for (var j = 0; j < list.length; j++) if (desc && list[j].cols === desc.cols) return j;
    if (desc && desc.index < list.length) return desc.index;
    return 0;
  }

  /* 序号列：连续重排；页面没有序号列时新增一列；也可保留或删除 */
  function applySeq(rows, merges, headerCount, mode) {
    var outRows = rows;
    var outMerges = (merges || []).slice();

    if (mode === 'keep') return { rows: outRows, merges: outMerges, colDelta: 0 };

    var col = -1;
    var limit = Math.min(headerCount, outRows.length);
    for (var r = 0; r < limit && col < 0; r++) {
      for (var c = 0; c < outRows[r].length; c++) {
        if (/^(序号|序\s*号|no\.?|#|index)$/i.test(String(outRows[r][c] || '').trim())) {
          col = c;
          break;
        }
      }
    }

    if (mode === 'drop' && col >= 0) {
      outRows = outRows.map(function (row) {
        var a = row.slice();
        a.splice(col, 1);
        return a;
      });
      outMerges = outMerges
        .map(function (m) {
          if (m.c > col) return { r: m.r, c: m.c - 1, rs: m.rs, cs: m.cs };
          if (m.c + m.cs - 1 < col) return m;
          var cs = m.cs - 1;
          return cs > 0 ? { r: m.r, c: m.c, rs: m.rs, cs: cs } : null;
        })
        .filter(Boolean);
      return { rows: outRows, merges: outMerges, colDelta: -1 };
    }

    if (col >= 0) {
      for (var i = headerCount; i < outRows.length; i++) {
        if (!outRows[i]) continue;
        outRows[i][col] = String(i - headerCount + 1);
      }
      return { rows: outRows, merges: outMerges, colDelta: 0 };
    }

    outRows = outRows.map(function (row, idx) {
      var a = row.slice();
      a.unshift(idx < headerCount ? '序号' : String(idx - headerCount + 1));
      return a;
    });
    outMerges = outMerges.map(function (m) {
      return { r: m.r, c: m.c + 1, rs: m.rs, cs: m.cs };
    });
    return { rows: outRows, merges: outMerges, colDelta: 1 };
  }

  function report(opts, got, total, label) {
    var fn = (opts && opts.onProgress) || T2X.onHarvestProgress;
    if (typeof fn === 'function') {
      try {
        fn(got, total, label);
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* 主入口：逐页采集并合并成一个 sheet */
  T2X.autoHarvestPages = async function (desc, opts) {
    opts = opts || {};
    var p = detectPager();
    if (!p) throw new Error('没有检测到分页控件，无法自动翻页');

    var warnings = [];
    var info = pageInfo(p);
    var want = parseInt(opts.pageSize, 10) || 0; // 0 = 自动选最大
    var sizeRes = await setPageSize(p, want);
    if (!sizeRes.ok) warnings.push('每页条数调整失败：' + sizeRes.reason);
    else if (sizeRes.warn) warnings.push(sizeRes.warn);
    info = pageInfo(p);

    var totalRows = info.total || 0;
    var maxPages = opts.maxPages || 600;
    var shouldStop = opts.shouldStop || null;
    var localDesc = desc || { index: 0, title: '', cols: 0 };

    var acc = [];
    var merges = [];
    var cols = 0;
    var headerCount = 0;
    var title = localDesc.title || '';
    var pages = 0;
    var stopped = false;

    while (pages < maxPages) {
      if (shouldStop && shouldStop()) {
        stopped = true;
        break;
      }

      var list = T2X.scan();
      var idx = resolveIndex(list, localDesc);
      if (idx < 0) throw new Error('翻页后找不到目标表格');
      localDesc = {
        index: idx,
        title: list[idx].title,
        cols: list[idx].cols,
        preview: list[idx].preview
      };

      var beforeSig = sigOfList(list, idx);
      var data = await T2X.extractByIndex(idx, opts);
      if (!data || !data.rows || !data.rows.length) throw new Error('第 ' + (pages + 1) + ' 页没有读到数据');

      if (!headerCount) {
        headerCount = data.headerCount || 1;
        cols = data.cols || data.rows[0].length || 0;
        title = data.title || title;
        acc = data.rows.map(function (row) {
          return row.slice(0, cols);
        });
        merges = (data.merges || []).slice();
      } else {
        var bodyRows = data.rows.slice(headerCount);
        var base = acc.length;
        for (var r = 0; r < bodyRows.length; r++) {
          var row = bodyRows[r].slice(0, cols);
          while (row.length < cols) row.push('');
          acc.push(row);
        }
        for (var m = 0; m < (data.merges || []).length; m++) {
          var mg = data.merges[m];
          if (mg.r < headerCount) continue; // 后续页重复的表头不要
          merges.push({
            r: base + (mg.r - headerCount),
            c: mg.c,
            rs: mg.rs,
            cs: Math.max(1, Math.min(mg.cs, cols - mg.c))
          });
        }
        if (data.cols && data.cols !== cols && warnings.length < 5) {
          warnings.push('第 ' + (pages + 1) + ' 页列数为 ' + data.cols + '，已按首页 ' + cols + ' 列对齐');
        }
      }

      pages++;
      report(opts, acc.length - headerCount, totalRows || pages * (info.size || 10), '正在翻页采集（第 ' + pages + ' 页）');

      if (totalRows && acc.length - headerCount >= totalRows) break;

      var next = findNext(p.root) || findNext(doc);
      if (!next || isDisabled(next)) break;

      fireClick(next);
      var changed = await waitChange(
        beforeSig,
        function () {
          var l = T2X.scan();
          return sigOfList(l, resolveIndex(l, localDesc));
        },
        shouldStop,
        opts.pageTimeout || 8000
      );
      if (changed.stopped) {
        stopped = true;
        break;
      }
      if (!changed.ok) {
        warnings.push('第 ' + pages + ' 页后' + changed.reason);
        break;
      }
    }

    if (pages >= maxPages && totalRows && acc.length - headerCount < totalRows) {
      warnings.push('达到最大页数 ' + maxPages + '，仅采集到 ' + (acc.length - headerCount) + ' 行');
    }

    var seq = applySeq(acc, merges, headerCount, opts.seqMode || 'renumber');
    return {
      rows: seq.rows,
      merges: seq.merges,
      cols: cols + seq.colDelta,
      headerCount: headerCount,
      pages: pages,
      title: title,
      totalRows: totalRows,
      warnings: warnings,
      stopped: stopped
    };
  };

  T2X.detectPager = detectPager;
  T2X.pageInfo = pageInfo;
  T2X.readPageSizeOptions = readPageSizeOptions;
  T2X.setPageSize = setPageSize;
})(typeof globalThis !== 'undefined' ? globalThis : this);
