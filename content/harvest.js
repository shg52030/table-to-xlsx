/*
 * 虚拟滚动表格的全量采集
 *
 * 虚拟滚动只把可视区附近的行渲染进 DOM，直接读 <table> 只能拿到十几行。
 * 这里用「滚动 → 等渲染 → 快照」的循环把所有行抓下来。
 *
 * 与框架无关：不依赖 vxe / ag-grid 的内部结构，只依赖两点
 *   1. 表格所在的可滚动祖先
 *   2. 行元素上稳定的标识（data-rowid / aria-rowindex 等），没有则按内容重叠对齐
 */
(function (root) {
  var T2X = (root.T2X = root.T2X || {});

  var MAX_STEPS = 800; // 滚动次数上限，防止死循环
  var FRAME_MS = 16; // 每步等待渲染的时间

  /* 等一帧，让框架完成一次重渲染 */
  function frame() {
    return new Promise(function (resolve) {
      var done = false;
      function finish() {
        if (done) return;
        done = true;
        setTimeout(resolve, FRAME_MS);
      }
      if (typeof root.requestAnimationFrame === 'function') {
        root.requestAnimationFrame(finish);
        setTimeout(finish, FRAME_MS * 4); // 兜底：后台标签页里 rAF 会被节流
      } else {
        setTimeout(finish, FRAME_MS);
      }
    });
  }

  /* 当前渲染块的指纹：行数 + 首行 + 末行。用于判断「滚动后是否真的重渲染了」 */
  function batchSig(table) {
    var n = 0;
    var first = '';
    var last = '';
    for (var i = 0; i < table.rows.length; i++) {
      var tr = table.rows[i];
      if (!tr.cells.length || !tr.getBoundingClientRect().height) continue;
      var k = rowKey(tr) || (tr.cells[0] ? tr.cells[0].textContent : '');
      if (!n) first = k;
      last = k;
      n++;
    }
    return n + '|' + first + '|' + last;
  }

  /* 等到渲染块变化为止，最多重试 frames 次 */
  async function waitChange(table, prevSig, frames) {
    for (var i = 0; i < frames; i++) {
      await frame();
      if (batchSig(table) !== prevSig) return true;
    }
    return false;
  }

  function findScroller(el) {
    var node = el.parentElement;
    var guard = 0;
    while (node && guard++ < 15) {
      var cs = null;
      try {
        cs = root.getComputedStyle(node);
      } catch (e) {
        cs = null;
      }
      if (cs && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')) {
        if (node.scrollHeight - node.clientHeight > 8) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function visibleRowCount(table) {
    var n = 0;
    for (var i = 0; i < table.rows.length; i++) {
      var tr = table.rows[i];
      if (tr.cells.length && tr.getBoundingClientRect().height > 0) n++;
    }
    return n;
  }

  function rowHeightOf(table) {
    for (var i = 0; i < table.rows.length; i++) {
      var h = table.rows[i].getBoundingClientRect().height;
      if (h > 1) return h;
    }
    return 0;
  }

  /* 是不是虚拟滚动？不是则返回 null */
  T2X.virtualPlan = function (table) {
    if (!table || !table.rows || !table.rows.length) return null;

    var box = findScroller(table);
    if (!box) return null;

    var rh = rowHeightOf(table);
    if (!rh) return null;

    var rendered = visibleRowCount(table);
    if (!rendered) return null;

    var tableH = table.getBoundingClientRect().height || 0;
    // 关键判据：滚动内容远高于表格自身高度，说明有占位元素撑高、只渲染了可视区
    if (!tableH || box.scrollHeight < tableH * 2) return null;

    var estimate = Math.round((box.scrollHeight - tableH) / rh) + rendered;
    if (estimate <= rendered + 2) return null;

    return { box: box, rowHeight: rh, rendered: rendered, estimate: estimate };
  };

  /* 行元素的稳定标识；拿不到返回空串 */
  function rowKey(tr) {
    var k =
      tr.getAttribute('data-rowid') ||
      tr.getAttribute('data-row-key') ||
      tr.getAttribute('data-rowkey') ||
      tr.getAttribute('data-index') ||
      tr.getAttribute('data-row-index') ||
      tr.getAttribute('aria-rowindex') ||
      tr.id;
    return k ? String(k) : '';
  }

  function snapshotRow(tr, includeHidden) {
    var cells = [];
    for (var k = 0; k < tr.cells.length; k++) {
      var td = tr.cells[k];
      var hidden = !includeHidden && T2X._isHidden && T2X._isHidden(td);
      cells.push({
        text: hidden ? '' : T2X.cellText(td),
        rs: Math.max(1, parseInt(td.getAttribute('rowspan'), 10) || 1),
        cs: Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1),
        checkbox: T2X._looksCheckbox ? T2X._looksCheckbox(td) : false
      });
    }
    return { cells: cells };
  }

  function captureBatch(table, includeHidden) {
    var out = [];
    for (var i = 0; i < table.rows.length; i++) {
      var tr = table.rows[i];
      if (!tr.cells.length) continue;
      if (!includeHidden && T2X._isHidden && T2X._isHidden(tr)) continue;
      if (!tr.getBoundingClientRect().height) continue;
      out.push({ key: rowKey(tr), row: snapshotRow(tr, includeHidden) });
    }
    return out;
  }

  function sigOf(row) {
    if (row.__sig === undefined) {
      var parts = [];
      for (var i = 0; i < row.cells.length; i++) parts.push(row.cells[i].text);
      row.__sig = parts.join('\u0001');
    }
    return row.__sig;
  }

  /* 把一批新抓到的行并进累积结果：有稳定行号按行号去重，否则按内容重叠对齐 */
  function mergeBatch(acc, seen, batch, useKeys) {
    if (!batch.length) return;

    if (useKeys) {
      for (var i = 0; i < batch.length; i++) {
        var key = batch[i].key;
        if (seen.has(key)) continue;
        seen.set(key, true);
        acc.push(batch[i].row);
      }
      return;
    }

    var max = Math.min(acc.length, batch.length);
    for (var k = max; k > 0; k--) {
      var same = true;
      for (var t = 0; t < k; t++) {
        if (sigOf(acc[acc.length - k + t]) !== sigOf(batch[t].row)) {
          same = false;
          break;
        }
      }
      if (same) {
        for (var a = k; a < batch.length; a++) acc.push(batch[a].row);
        return;
      }
    }
    for (var b = 0; b < batch.length; b++) acc.push(batch[b].row);
  }

  T2X.harvest = async function (table, plan, opts) {
    var box = plan.box;
    var includeHidden = !!(opts && opts.includeHidden);
    var saved = box.scrollTop;

    var acc = [];
    var seen = new Map();
    var probes = {};
    var useKeys = false;
    var keysChecked = false;
    var savedAnchor = box.style.overflowAnchor;

    var pageRows = Math.max(1, Math.floor(box.clientHeight / plan.rowHeight));
    var step = Math.max(plan.rowHeight, Math.floor(pageRows * plan.rowHeight * 0.75));
    var maxTop = Math.max(0, box.scrollHeight - box.clientHeight);
    var maxSteps = Math.min(MAX_STEPS, Math.ceil(maxTop / step) + 8);

    try {
      // 关掉滚动锚定：虚拟列表靠改变占位高度实现滚动，锚定会把 scrollTop 改写掉，
      // 导致采集窗口直接跳过一大段（实测 500 行只能采到 240 行）。
      box.style.overflowAnchor = 'none';

      box.scrollTop = 0;
      await frame();
      var sig = batchSig(table);

      var guard = 0;
      while (guard++ < maxSteps) {
        var batch = captureBatch(table, includeHidden);

        if (!keysChecked) {
          keysChecked = true;
          useKeys = batch.length > 0;
          var uniq = new Map();
          for (var i = 0; i < batch.length; i++) {
            if (!batch[i].key || uniq.has(batch[i].key)) {
              useKeys = false;
              break;
            }
            uniq.set(batch[i].key, true);
          }
          probes = probeFromFirstBatch(table, includeHidden) || {};
        }

        mergeBatch(acc, seen, batch, useKeys);

        if (T2X.onHarvestProgress) {
          try {
            T2X.onHarvestProgress(acc.length, plan.estimate);
          } catch (e) {
            /* ignore */
          }
        }

        var before = box.scrollTop;
        var next = Math.min(before + step, maxTop);
        if (next === before) {
          mergeBatch(acc, seen, captureBatch(table, includeHidden), useKeys);
          break;
        }
        box.scrollTop = next;
        // 必须等到这一屏真的重渲染，否则会拿到上一屏的内容，导致整段行被漏掉
        await waitChange(table, sig, 6);
        sig = batchSig(table);
      }
    } finally {
      box.scrollTop = saved;
      box.style.overflowAnchor = savedAnchor;
    }

    return { rows: acc, probes: probes };
  };

  /* 从首屏可见行里取一列一条的 CSS 生成内容信息（如 vxe 的序号列） */
  function probeFromFirstBatch(table, includeHidden) {
    var probes = {};
    var tr = null;
    for (var i = 0; i < table.rows.length; i++) {
      if (table.rows[i].cells.length && table.rows[i].getBoundingClientRect().height > 0) {
        tr = table.rows[i];
        break;
      }
    }
    if (!tr || !T2X._pseudoOf) return probes;
    var col = 0;
    for (var k = 0; k < tr.cells.length; k++) {
      var td = tr.cells[k];
      var hidden = !includeHidden && T2X._isHidden && T2X._isHidden(td);
      if (!hidden && !probes[col]) {
        var ps = T2X._pseudoOf(td);
        if (ps) probes[col] = ps;
      }
      col += Math.max(1, parseInt(td.getAttribute('colspan'), 10) || 1);
    }
    return probes;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
