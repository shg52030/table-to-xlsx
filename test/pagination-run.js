(async function () {
  var results = [];
  function check(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: detail === undefined ? '' : String(detail).slice(0, 400) });
  }
  function same(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    check(name, a === b, a === b ? 'ok' : '期望 ' + b + ' 实际 ' + a);
  }

  try {
    var p = T2X.detectPager();
    check('检测到 Element Plus 分页控件', !!p && p.framework === 'element', p && p.framework);
    if (!p) throw new Error('未检测到分页控件');

    var before = T2X.pageInfo(p);
    check('初始每页 10 条', before.size === 10, 'size=' + before.size);
    check('初始总数 3015', before.total === 3015, 'total=' + before.total);
    check('初始总页数 302', before.totalPages === 302, 'pages=' + before.totalPages);

    var list = T2X.scan();
    check('识别为 1 张表', list.length === 1, '实际 ' + list.length);
    if (!list.length) throw new Error('没有识别到表格');
    check('勾选列被丢弃后为 17 列', list[0].cols === 17, 'cols=' + list[0].cols);

    var d = await T2X.autoHarvestPages(list[0], {
      pageSizeCap: 1000,
      maxPages: 600,
      seqMode: 'renumber',
      pageTimeout: 6000
    });

    check('每页条数自动调到 100', T2X.pageInfo(p).size === 100, 'size=' + T2X.pageInfo(p).size);
    check('翻页 31 次', d.pages === 31, 'pages=' + d.pages);
    check('总行数 = 1 表头 + 3015 数据', d.rows.length === 3016, '实际 ' + d.rows.length);
    check('列数 = 17 + 新增序号列', d.cols === 18 && d.rows[0].length === 18, 'cols=' + d.cols + ' / ' + d.rows[0].length);
    check('无警告', !d.warnings.length, d.warnings.join('; '));

    same('表头含新增序号列', d.rows[0].slice(0, 4), ['序号', '预警', '工单号', '工单标题']);

    var seqOk = true;
    var seqBad = '';
    for (var i = 1; i < d.rows.length; i++) {
      if (d.rows[i][0] !== String(i)) {
        seqOk = false;
        seqBad = '第 ' + i + ' 行序号=' + d.rows[i][0];
        break;
      }
    }
    check('序号 1..3015 连续', seqOk, seqBad || 'ok');

    var ids = {};
    var dup = 0;
    for (var r = 1; r < d.rows.length; r++) {
      var id = d.rows[r][2];
      if (ids[id]) dup++;
      ids[id] = true;
    }
    check('工单号无重复', dup === 0, '重复 ' + dup + ' 行');
    check('工单号数量 = 3015', Object.keys(ids).length === 3015, Object.keys(ids).length);
    check('首行工单号', d.rows[1][2] === 'GD-000001', d.rows[1][2]);
    check('末行工单号', d.rows[3015][2] === 'GD-003015', d.rows[3015][2]);

    var headCount = 0;
    for (var h = 0; h < d.rows.length; h++) {
      if (d.rows[h][0] === '序号' && d.rows[h][2] === '工单号') headCount++;
    }
    check('表头只出现 1 次', headCount === 1, '出现 ' + headCount + ' 次');

    check('到达末页后下一页按钮禁用', document.getElementById('nextBtn').disabled === true, '');

    var bytes = T2X.buildWorkbook([{ name: d.title, rows: d.rows, merges: d.merges }], { detectNumbers: true });
    check('xlsx 生成', bytes.length > 5000 && bytes[0] === 0x50, bytes.length + ' bytes');
    window.__B64__ = T2X.toBase64(bytes);
  } catch (e) {
    check('运行异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  }

  var passed = results.filter(function (r) {
    return r.pass;
  }).length;
  document.getElementById('out').textContent = JSON.stringify({ passed: passed, total: results.length, results: results });
})();
