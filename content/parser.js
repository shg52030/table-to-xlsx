/*
 * HTML 表格解析
 *
 * 核心思路：不再「一个 table = 一张表」，而是「一组结构兼容的 table = 一张表」。
 * 组件化表格（vxe / el-table / ant-design 等）会把表头、表体、固定列拆成多个 <table>，
 * 这里用与框架无关的结构不变量把它们重新聚合：
 *   1. 列边界重合（getBoundingClientRect，与渲染方式无关）
 *   2. 垂直邻接 + 水平齐平
 *   3. 角色互补（纯表头 + 纯表体）
 *
 * 另外处理：rowspan/colspan、隐藏行、CSS counter 生成的序号、勾选列剔除、
 *          Shadow DOM 穿透、布局表格过滤。
 */
(function (root) {
  var T2X = (root.T2X = root.T2X || {});

  var MAX_COLS = 2000;
  var EDGE_TOL = 3; // 列边界容差（px）
  var MERGE_THRESHOLD = 60; // 片段合并分数阈值

  var BLOCK_TAGS = {
    DIV: 1, P: 1, LI: 1, UL: 1, OL: 1, SECTION: 1, ARTICLE: 1, HEADER: 1, FOOTER: 1,
    H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, TR: 1, TABLE: 1, DL: 1, DT: 1, DD: 1,
    BLOCKQUOTE: 1, PRE: 1, FIGURE: 1, FORM: 1
  };
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1, SVG: 1, CANVAS: 1, IFRAME: 1 };

  var hiddenCache = null;

  /* ================= 可见性 ================= */

  function isHidden(el) {
    if (!el || el.nodeType !== 1) return false;
    if (hiddenCache && hiddenCache.has(el)) return hiddenCache.get(el);
    var result = false;
    if (el.hasAttribute('hidden')) {
      result = true;
    } else {
      var cs = null;
      try {
        cs = root.getComputedStyle(el);
      } catch (e) {
        cs = null;
      }
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse')) result = true;
    }
    if (hiddenCache) hiddenCache.set(el, result);
    return result;
  }

  /* ================= 文本 ================= */

  function collectText(node, out) {
    var kids = node.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) {
        out.push(n.nodeValue);
        continue;
      }
      if (n.nodeType !== 1) continue;
      var tag = n.tagName;
      if (SKIP_TAGS[tag]) continue;
      if (tag === 'BR') {
        out.push('\n');
        continue;
      }
      if (n.hasAttribute && n.hasAttribute('hidden')) continue;
      var block = !!BLOCK_TAGS[tag];
      if (block) out.push('\n');
      collectText(n, out);
      if (block) out.push('\n');
      else if (tag === 'TD' || tag === 'TH') out.push(' ');
    }
  }

  function normalize(s) {
    return String(s)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .split('\n')
      .map(function (line) {
        return line.trim();
      })
      .join('\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function cellText(cell) {
    var out = [];
    collectText(cell, out);
    return normalize(out.join(''));
  }

  /* ================= CSS 生成内容（序号等） ================= */

  function pseudoRaw(el) {
    try {
      var b = root.getComputedStyle(el, '::before').content;
      if (b && b !== 'none' && b !== 'normal') return b;
    } catch (e) {
      /* ignore */
    }
    try {
      var a = root.getComputedStyle(el, '::after').content;
      if (a && a !== 'none' && a !== 'normal') return a;
    } catch (e) {
      /* ignore */
    }
    return null;
  }

  function parsePseudo(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s || s === 'none' || s === 'normal' || s === '""' || s === "''") return null;

    var m = /^counter\(\s*([\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(s);
    if (m) return { kind: 'counter', name: m[1] };

    var lit = /^"((?:[^"\\]|\\.)*)"$/.exec(s) || /^'((?:[^'\\]|\\.)*)'$/.exec(s);
    if (lit) {
      var txt = lit[1]
        .replace(/\\A\s?/gi, '\n')
        .replace(/\\([0-9a-f]{1,6})\s?/gi, function (_, h) {
          return String.fromCharCode(parseInt(h, 16));
        })
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      // 过滤图标字体（私有区字符）
      if (/[\uE000-\uF8FF]/.test(txt)) return null;
      if (!txt.trim()) return null;
      return { kind: 'literal', text: txt };
    }
    return null;
  }

  /* 在单元格自身及浅层后代里找 CSS 生成的内容 */
  function findPseudo(cell) {
    var direct = parsePseudo(pseudoRaw(cell));
    if (direct) return direct;
    var kids = cell.querySelectorAll('*');
    var limit = Math.min(kids.length, 4);
    for (var i = 0; i < limit; i++) {
      var p = parsePseudo(pseudoRaw(kids[i]));
      if (p) return p;
    }
    return null;
  }

  /* 读 counter-reset 的起始值与 counter-increment 的步长 */
  function counterInfo(el, name) {
    var info = { start: 0, step: 1 };
    try {
      var inc = root.getComputedStyle(el).counterIncrement || '';
      var mi = new RegExp('(?:^|,)\\s*' + name + '\\s+(-?\\d+)').exec(inc);
      if (mi) info.step = parseInt(mi[1], 10);
    } catch (e) {
      /* ignore */
    }
    var node = el.parentElement;
    var guard = 0;
    while (node && guard++ < 40) {
      var cr = '';
      try {
        cr = root.getComputedStyle(node).counterReset || '';
      } catch (e) {
        cr = '';
      }
      var mr = new RegExp('(?:^|,)\\s*' + name + '\\s+(-?\\d+)').exec(cr);
      if (mr) {
        info.start = parseInt(mr[1], 10);
        return info;
      }
      node = node.parentElement;
    }
    return info;
  }

  /* ================= 单元格属性 ================= */

  var CHECKBOX_CLASS = /col--checkbox|col-checkbox|col--selection|selection-column|checkbox-column|el-table-column--selection|ant-table-selection/i;

  function looksCheckbox(cell) {
    if (!cell) return false;
    var cls = typeof cell.className === 'string' ? cell.className : '';
    if (cls && CHECKBOX_CLASS.test(cls)) return true;
    if (cell.querySelector && cell.querySelector('input[type=checkbox],input[type=radio],[role=checkbox]')) return true;
    return false;
  }

  function spanOf(td, attr) {
    var raw = td.getAttribute(attr);
    if (raw === null || raw === '') return 1;
    var n = parseInt(raw, 10);
    if (!isFinite(n) || n < 1) return 1;
    return n;
  }

  /* ================= 单表解析 ================= */

  function extract(table, opts) {
    opts = opts || {};
    var includeHidden = !!opts.includeHidden;
    var readCss = opts.readCssContent !== false;
    var keepEmpty = opts.keepEmptyCols !== false;
    var dropCheckbox = opts.dropCheckboxCols !== false;

    hiddenCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

    try {
      var rowsColl = table.rows || [];
      var srcRows = [];
      for (var i = 0; i < rowsColl.length; i++) {
        if (!includeHidden && isHidden(rowsColl[i])) continue;
        srcRows.push(rowsColl[i]);
      }

      var grid = [];
      var cellGrid = [];
      var merges = [];
      var occupied = {};

      for (var r = 0; r < srcRows.length; r++) {
        var row = srcRows[r];
        if (!grid[r]) grid[r] = [];
        if (!cellGrid[r]) cellGrid[r] = [];
        var c = 0;
        var cells = row.cells || [];
        for (var k = 0; k < cells.length; k++) {
          var td = cells[k];
          while (occupied[r + ':' + c]) c++;
          if (c >= MAX_COLS) break;

          var rs = Math.min(spanOf(td, 'rowspan'), srcRows.length - r);
          var cs = Math.min(spanOf(td, 'colspan'), MAX_COLS - c);
          var text = !includeHidden && isHidden(td) ? '' : cellText(td);

          for (var y = 0; y < rs; y++) {
            var rr = r + y;
            if (!grid[rr]) grid[rr] = [];
            if (!cellGrid[rr]) cellGrid[rr] = [];
            for (var x = 0; x < cs; x++) {
              occupied[rr + ':' + (c + x)] = true;
              grid[rr][c + x] = y === 0 && x === 0 ? text : '';
              cellGrid[rr][c + x] = td;
            }
          }
          if (rs > 1 || cs > 1) merges.push({ r: r, c: c, rs: rs, cs: cs });
          c += cs;
        }
      }

      var width = 0;
      for (var w = 0; w < grid.length; w++) if (grid[w].length > width) width = grid[w].length;

      /* 全空列：先尝试读 CSS 生成内容（如 vxe 的序号列） */
      if (readCss && grid.length && width) {
        for (var col = 0; col < width; col++) {
          var empty = true;
          for (var q = 0; q < grid.length; q++) {
            if (grid[q][col] !== '' && grid[q][col] != null) {
              empty = false;
              break;
            }
          }
          if (!empty) continue;

          var probe = null;
          for (var pr = 0; pr < cellGrid.length && !probe; pr++) {
            if (cellGrid[pr][col]) probe = cellGrid[pr][col];
          }
          if (!probe) continue;

          var pseudo = findPseudo(probe);
          if (!pseudo) continue;

          if (pseudo.kind === 'literal') {
            for (var lr = 0; lr < grid.length; lr++) grid[lr][col] = pseudo.text;
          } else if (pseudo.kind === 'counter') {
            var info = counterInfo(probe, pseudo.name);
            for (var cr = 0; cr < grid.length; cr++) {
              grid[cr][col] = String(info.start + info.step * (cr + 1));
            }
          }
        }
      }

      /* 勾选列：表头是勾选框 + 整列为空 */
      var checkboxCols = [];
      if (dropCheckbox && grid.length) {
        for (var cc = 0; cc < width; cc++) {
          var headCell = cellGrid[0] && cellGrid[0][cc];
          if (!looksCheckbox(headCell)) continue;
          var allEmpty = true;
          for (var er = 0; er < grid.length; er++) {
            if (grid[er][cc] !== '' && grid[er][cc] != null) {
              allEmpty = false;
              break;
            }
          }
          if (allEmpty) checkboxCols.push(cc);
        }
      }

      var trimmed = trim(grid, merges, keepEmpty);
      trimmed.checkboxCols = checkboxCols;
      return trimmed;
    } finally {
      hiddenCache = null;
    }
  }

  function isBlankRow(row) {
    if (!row) return true;
    for (var i = 0; i < row.length; i++) {
      if (row[i] !== '' && row[i] !== undefined && row[i] !== null) return false;
    }
    return true;
  }

  function trim(grid, merges, keepEmpty) {
    var width = 0;
    for (var i = 0; i < grid.length; i++) {
      if (grid[i] && grid[i].length > width) width = grid[i].length;
    }

    while (grid.length && isBlankRow(grid[grid.length - 1])) grid.pop();

    var w = width;
    if (keepEmpty === false) {
      while (w > 0) {
        var empty = true;
        for (var r = 0; r < grid.length; r++) {
          var v = grid[r] ? grid[r][w - 1] : '';
          if (v !== '' && v !== undefined && v !== null) {
            empty = false;
            break;
          }
        }
        if (!empty) break;
        w--;
      }
    }

    var rows = [];
    for (var r2 = 0; r2 < grid.length; r2++) {
      var line = [];
      for (var c2 = 0; c2 < w; c2++) {
        var val = grid[r2] && grid[r2][c2];
        line.push(val === undefined || val === null ? '' : String(val));
      }
      rows.push(line);
    }

    var keptMerges = [];
    for (var m = 0; m < merges.length; m++) {
      var g = merges[m];
      if (g.r >= rows.length || g.c >= w) continue;
      var rs = Math.min(g.rs, rows.length - g.r);
      var cs = Math.min(g.cs, w - g.c);
      if (rs > 1 || cs > 1) keptMerges.push({ r: g.r, c: g.c, rs: rs, cs: cs });
    }

    return { rows: rows, merges: keptMerges, cols: w };
  }

  /* ================= 片段收集与分析 ================= */

  function collectTables() {
    var out = [];
    var seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    function pushAll(list) {
      for (var i = 0; i < list.length; i++) {
        var t = list[i];
        if (seen) {
          if (seen.has(t)) continue;
          seen.add(t);
        }
        out.push(t);
      }
    }

    function walk(node) {
      pushAll(node.querySelectorAll('table'));
      var all = node.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    }

    walk(document);

    var visible = [];
    for (var i = 0; i < out.length; i++) {
      var t = out[i];
      if (!t.rows || t.rows.length === 0) continue;
      if (!tableVisible(t)) continue;
      visible.push(t);
    }
    return visible;
  }

  function tableVisible(table) {
    try {
      var rect = table.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    } catch (e) {
      /* ignore */
    }
    return table.offsetParent !== null && table.offsetWidth > 0;
  }

  /* 老式布局表格：自身几乎没有文本，内容都在内层表格里 */
  function isLayoutTable(table, candidates) {
    var inner = table.querySelectorAll('table');
    var innerText = 0;
    var hasInner = false;
    for (var i = 0; i < inner.length; i++) {
      if (candidates.indexOf(inner[i]) < 0) continue;
      hasInner = true;
      innerText += (inner[i].textContent || '').length;
    }
    if (!hasInner) return false;
    var total = (table.textContent || '').length;
    if (!total) return false;
    return innerText / total > 0.8;
  }

  function analyze(el) {
    var rect = el.getBoundingClientRect();
    var edges = [];
    var rowCount = 0;
    var firstRow = null;
    for (var i = 0; i < el.rows.length; i++) {
      if (!el.rows[i].cells.length) continue;
      if (isHidden(el.rows[i])) continue;
      rowCount++;
      if (!firstRow) firstRow = el.rows[i];
    }
    if (firstRow) {
      for (var k = 0; k < firstRow.cells.length; k++) {
        var cell = firstRow.cells[k];
        var rc = cell.getBoundingClientRect();
        var left = Math.round(rc.left);
        var right = Math.round(rc.right);
        var span = Math.max(1, parseInt(cell.getAttribute('colspan'), 10) || 1);
        if (span === 1) {
          edges.push([left, right]);
        } else {
          // 跨列的单元格内部边界不可见，按等宽均分，保证 edges 是「每列一条」
          var wUnit = (right - left) / span;
          for (var s = 0; s < span; s++) {
            edges.push([Math.round(left + wUnit * s), Math.round(left + wUnit * (s + 1))]);
          }
        }
      }
    }
    return {
      el: el,
      role: roleOf(el),
      edges: edges,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      cols: edges.length,
      rowCount: rowCount,
      colNames: colNamesOf(el),
      hint: classHint(el)
    };
  }

  function roleOf(table) {
    var hasHeader = false;
    var hasBody = false;
    for (var i = 0; i < table.rows.length; i++) {
      var tr = table.rows[i];
      if (!tr.cells.length) continue;
      var inThead = false;
      try {
        inThead = !!(tr.closest && tr.closest('thead'));
      } catch (e) {
        inThead = false;
      }
      var allTh = true;
      for (var k = 0; k < tr.cells.length; k++) {
        if (tr.cells[k].tagName !== 'TH') {
          allTh = false;
          break;
        }
      }
      if (inThead || allTh) hasHeader = true;
      else hasBody = true;
    }
    if (hasHeader && hasBody) return 'full';
    if (hasHeader) return 'header';
    if (hasBody) return 'body';
    return 'full';
  }

  function colNamesOf(table) {
    var cols = table.querySelectorAll('colgroup > col');
    var names = [];
    for (var i = 0; i < cols.length; i++) {
      var n = cols[i].getAttribute('name') || cols[i].getAttribute('data-col') || '';
      if (n) names.push(n);
    }
    return names;
  }

  var HINT_CLASS = /vxe-table|el-table|ant-table|ivu-table|layui-table|ag-root|kendo-grid|datagrid|data-table|table-wrapper/i;

  function classHint(el) {
    var node = el.parentElement;
    var guard = 0;
    while (node && guard++ < 4) {
      var cls = typeof node.className === 'string' ? node.className : '';
      if (cls && HINT_CLASS.test(cls)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /* ================= 配对打分 ================= */

  function edgeList(edges) {
    var arr = [];
    for (var i = 0; i < edges.length; i++) {
      arr.push(edges[i][0]);
      arr.push(edges[i][1]);
    }
    arr.sort(function (a, b) {
      return a - b;
    });
    var out = [];
    for (var j = 0; j < arr.length; j++) {
      if (!out.length || arr[j] - out[out.length - 1] > 2) out.push(arr[j]);
    }
    return out;
  }

  function edgeSim(a, b) {
    if (!a.length || !b.length) return 0;
    var ua = edgeList(a);
    var ub = edgeList(b);
    var hit = 0;
    for (var i = 0; i < ua.length; i++) {
      for (var j = 0; j < ub.length; j++) {
        if (Math.abs(ua[i] - ub[j]) <= EDGE_TOL) {
          hit++;
          break;
        }
      }
    }
    return (2 * hit) / (ua.length + ub.length);
  }

  function sameColNames(a, b) {
    if (!a.length || !b.length || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function scorePair(a, b) {
    var score = 0;
    score += edgeSim(a.edges, b.edges) * 55;

    var vgap = Math.abs(a.bottom - b.top);
    if (vgap <= 6) score += 15;
    else if (vgap <= 20) score += 8;

    if (Math.abs(a.left - b.left) <= 2 && Math.abs(a.right - b.right) <= 2) score += 15;
    if (sameColNames(a.colNames, b.colNames)) score += 10;
    if (a.hint || b.hint) score += 5;
    return score;
  }

  function containsEdges(sub, main) {
    if (!sub.length || !main.length) return false;
    for (var i = 0; i < sub.length; i++) {
      var ok = false;
      for (var j = 0; j < main.length; j++) {
        if (Math.abs(sub[i][0] - main[j][0]) <= EDGE_TOL && Math.abs(sub[i][1] - main[j][1]) <= EDGE_TOL) {
          ok = true;
          break;
        }
      }
      if (!ok) return false;
    }
    return true;
  }

  /* 把片段的第一列对齐到主表的第几列 */
  function offsetOf(frag, main) {
    if (!frag.edges.length || !main.edges.length) return null;
    var target = frag.edges[0][0];
    var best = -1;
    var bestDiff = Infinity;
    for (var i = 0; i < main.edges.length; i++) {
      var d = Math.abs(main.edges[i][0] - target);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    }
    if (bestDiff > EDGE_TOL) return null;
    for (var k = 0; k < frag.edges.length; k++) {
      var p = main.edges[best + k];
      if (!p) return null;
      if (Math.abs(p[0] - frag.edges[k][0]) > EDGE_TOL || Math.abs(p[1] - frag.edges[k][1]) > EDGE_TOL) return null;
    }
    return best;
  }

  /* ================= 分组 ================= */

  function buildGroups(items) {
    var groups = [];
    var used = [];

    function take(i) {
      used[i] = true;
      return items[i];
    }

    // 1. 表头找表体
    for (var i = 0; i < items.length; i++) {
      if (used[i] || items[i].role !== 'header') continue;
      var head = take(i);
      var group = { head: head, bodies: [] };

      var bestJ = -1;
      var bestScore = 0;
      for (var j = 0; j < items.length; j++) {
        if (used[j] || items[j].role !== 'body') continue;
        var sc = scorePair(head, items[j]);
        if (sc > bestScore) {
          bestScore = sc;
          bestJ = j;
        }
      }
      if (bestJ >= 0 && bestScore >= MERGE_THRESHOLD) group.bodies.push(take(bestJ));
      groups.push(group);
    }

    // 2. 剩下的表体：能作为固定列补充就并入已有分组
    for (var m = 0; m < items.length; m++) {
      if (used[m] || items[m].role !== 'body') continue;
      var frag = items[m];
      var attached = false;
      for (var g = 0; g < groups.length; g++) {
        var main = groups[g].bodies[0];
        if (!main) continue;
        if (main.rowCount !== frag.rowCount) continue;
        if (Math.abs(main.top - frag.top) > 12) continue;
        if (!containsEdges(frag.edges, main.edges)) continue;
        if (frag.cols >= main.cols) continue;
        groups[g].bodies.push(take(m));
        attached = true;
        break;
      }
      if (!attached) groups.push({ head: null, bodies: [take(m)] });
    }

    // 3. 没有配对表头的表头片段、以及 full 表格，各自独立
    for (var n = 0; n < items.length; n++) {
      if (used[n]) continue;
      var it = take(n);
      if (it.role === 'header') groups.push({ head: it, bodies: [] });
      else groups.push({ head: null, bodies: [it] });
    }

    // 4. 按 DOM 顺序还原，避免分组过程打乱页面原有顺序
    var FOLLOWING = 4;
    groups.sort(function (a, b) {
      var ea = groupElement(a);
      var eb = groupElement(b);
      if (!ea || !eb || ea === eb) return 0;
      try {
        return ea.compareDocumentPosition(eb) & FOLLOWING ? -1 : 1;
      } catch (e) {
        return 0;
      }
    });

    return groups;
  }

  function groupPrimary(group) {
    var primary = group.bodies[0] || null;
    if (primary) return primary;
    return group.head;
  }

  function groupElement(group) {
    if (group.head) return group.head.el;
    return group.bodies[0] ? group.bodies[0].el : null;
  }

  /* ================= 合并 ================= */

  function mergeGroup(group, opts) {
    var primary = groupPrimary(group);
    if (!primary) return null;

    var mainEdges = primary.edges;
    var totalCols = primary.cols;
    var fragments = [];

    if (group.head) {
      var headOff = offsetOf(group.head, primary);
      if (headOff === null) headOff = 0;
      fragments.push({ item: group.head, offset: headOff, kind: 'head' });
      totalCols = Math.max(totalCols, headOff + group.head.cols);
    }
    for (var b = 0; b < group.bodies.length; b++) {
      var bodyItem = group.bodies[b];
      var off = b === 0 ? 0 : offsetOf(bodyItem, primary);
      if (off === null) continue;
      fragments.push({ item: bodyItem, offset: off, kind: 'body' });
      totalCols = Math.max(totalCols, off + bodyItem.cols);
    }

    var headRows = [];
    var bodyRows = [];
    var headMerges = [];
    var bodyMerges = [];
    var checkboxCols = {};

    for (var f = 0; f < fragments.length; f++) {
      var frag = fragments[f];
      var data = extract(frag.item.el, opts);
      var off2 = frag.offset;

      for (var cbi = 0; cbi < (data.checkboxCols || []).length; cbi++) {
        checkboxCols[data.checkboxCols[cbi] + off2] = true;
      }

      if (frag.kind === 'head') {
        var rowBase = headRows.length;
        for (var hr = 0; hr < data.rows.length; hr++) {
          var line = new Array(totalCols).fill('');
          for (var hc = 0; hc < data.rows[hr].length; hc++) line[hc + off2] = data.rows[hr][hc];
          headRows.push(line);
        }
        for (var hm = 0; hm < data.merges.length; hm++) {
          var mg = data.merges[hm];
          headMerges.push({ r: mg.r + rowBase, c: mg.c + off2, rs: mg.rs, cs: mg.cs });
        }
      } else {
        var isPrimaryBody = frag === fragments.filter(function (x) {
          return x.kind === 'body';
        })[0];

        if (isPrimaryBody) {
          for (var br = 0; br < data.rows.length; br++) {
            var bl = new Array(totalCols).fill('');
            for (var bc = 0; bc < data.rows[br].length; bc++) bl[bc + off2] = data.rows[br][bc];
            bodyRows.push(bl);
          }
          for (var bm = 0; bm < data.merges.length; bm++) {
            var bg = data.merges[bm];
            bodyMerges.push({ r: bg.r, c: bg.c + off2, rs: bg.rs, cs: bg.cs });
          }
        } else {
          // 固定列片段：按行号补齐空位，主表优先
          if (bodyRows.length !== data.rows.length) continue;
          for (var fr = 0; fr < data.rows.length; fr++) {
            for (var fc = 0; fc < data.rows[fr].length; fc++) {
              var v = data.rows[fr][fc];
              if (v === '') continue;
              if (!bodyRows[fr][fc + off2]) bodyRows[fr][fc + off2] = v;
            }
          }
        }
      }
    }

    var allRows = headRows.concat(bodyRows);
    var allMerges = headMerges.concat(
      bodyMerges.map(function (m) {
        return { r: m.r + headRows.length, c: m.c, rs: m.rs, cs: m.cs };
      })
    );

    var dropped = Object.keys(checkboxCols)
      .map(function (k) {
        return parseInt(k, 10);
      })
      .sort(function (a, b) {
        return a - b;
      });

    if (dropped.length) {
      var remap = [];
      var shift = 0;
      for (var col = 0; col < totalCols; col++) {
        if (dropped.indexOf(col) >= 0) {
          remap[col] = -1;
          shift++;
        } else {
          remap[col] = col - shift;
        }
      }
      var keptCols = totalCols - dropped.length;
      allRows = allRows.map(function (row) {
        var out = [];
        for (var c = 0; c < totalCols; c++) {
          if (remap[c] >= 0) out.push(row[c]);
        }
        return out;
      });
      allMerges = allMerges
        .map(function (m) {
          if (remap[m.c] < 0) return null;
          var cs = 0;
          for (var c2 = m.c; c2 < m.c + m.cs; c2++) if (remap[c2] >= 0) cs++;
          if (cs < 1) return null;
          return { r: m.r, c: remap[m.c], rs: m.rs, cs: cs };
        })
        .filter(Boolean);
      totalCols = keptCols;
    }

    return { rows: allRows, merges: allMerges, cols: totalCols };
  }

  /* ================= 标题 ================= */

  function guessTitle(table, index) {
    var cap = table.querySelector('caption');
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
    var aria = table.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();

    var node = table;
    var guard = 0;
    while (node && guard++ < 60) {
      var prev = node.previousElementSibling;
      while (prev) {
        if (/^H[1-6]$/.test(prev.tagName)) {
          var htxt = prev.textContent.trim();
          if (htxt) return htxt;
        }
        if (/^(H[1-6]|P|DIV)$/.test(prev.tagName)) {
          var ptxt = prev.textContent.trim();
          if (ptxt && ptxt.length <= 30) return ptxt;
        }
        prev = prev.previousElementSibling;
      }
      node = node.parentElement;
    }
    return '表格' + (index + 1);
  }

  /* ================= 对外接口 ================= */

  var lastScan = [];

  function summarize(group, index) {
    var el = groupElement(group);
    var head = group.head;
    var body = group.bodies[0];
    var rows = (head ? head.rowCount : 0) + (body ? body.rowCount : 0);
    var cols = 0;
    if (body) cols = body.cols;
    if (head) cols = Math.max(cols, head.cols);

    var preview = [];
    var probeRow = (head && head.el.rows.length ? head.el.rows[0] : body && body.el.rows[0]) || null;
    var checkboxCount = 0;
    if (probeRow) {
      for (var i = 0; i < probeRow.cells.length; i++) {
        var cell = probeRow.cells[i];
        var txt = cellText(cell).replace(/\n/g, ' ');
        if (!txt) {
          var ps = findPseudo(cell);
          if (ps && ps.kind === 'literal') txt = ps.text;
          else if (ps && ps.kind === 'counter') txt = '序号';
          else if (looksCheckbox(cell)) checkboxCount++;
        }
        if (txt && preview.length < 5) preview.push(txt.length > 14 ? txt.slice(0, 14) + '…' : txt);
      }
    }
    cols = Math.max(cols - checkboxCount, 0);

    var fragCount = (head ? 1 : 0) + group.bodies.length;
    return {
      index: index,
      rows: rows,
      cols: cols,
      preview: preview.join(' / '),
      title: el ? guessTitle(el, index) : '表格' + (index + 1),
      nested: !!(el && el.parentElement && el.parentElement.closest && el.parentElement.closest('table')),
      fragments: fragCount,
      merged: fragCount > 1
    };
  }

  function scan() {
    var candidates = collectTables();
    var usable = [];
    for (var i = 0; i < candidates.length; i++) {
      if (!isLayoutTable(candidates[i], candidates)) usable.push(candidates[i]);
    }

    var items = [];
    for (var j = 0; j < usable.length; j++) items.push(analyze(usable[j]));

    var groups = buildGroups(items);
    var list = [];
    for (var g = 0; g < groups.length; g++) {
      var s = summarize(groups[g], list.length);
      s.group = groups[g];
      list.push(s);
    }
    lastScan = list;
    return list;
  }

  function extractByIndex(index, opts) {
    var item = lastScan[index];
    if (!item || !item.group) {
      scan();
      item = lastScan[index];
    }
    if (!item || !item.group) throw new Error('表格已不存在，请重新扫描页面');

    var data = mergeGroup(item.group, opts || {});
    if (!data || !data.rows.length) throw new Error('表格没有可导出的内容');
    data.title = item.title;
    return data;
  }

  T2X.scan = scan;
  T2X.extract = extract;
  T2X.extractByIndex = extractByIndex;
  T2X.cellText = cellText;
  T2X._analyze = analyze;
  T2X._scorePair = scorePair;
})(typeof globalThis !== 'undefined' ? globalThis : this);
