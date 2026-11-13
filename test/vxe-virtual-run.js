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
    var list = T2X.scan();
    check('固定列 + 虚拟滚动识别为 1 张表', list.length === 1, '实际 ' + list.length);
    if (!list.length) throw new Error('没有识别到表格');

    var t = list[0];
    check('标记为虚拟滚动', t.virtual === true, 'virtual=' + t.virtual);
    check('行数 = 1 表头 + 500 数据', t.rows === 501, 'rows=' + t.rows);
    check('列数 = 9 - 1 勾选列', t.cols === 8, 'cols=' + t.cols);
    check('片段数 = 4（主表头 + 主表体 + 固定表头 + 固定表体）', t.fragments === 4, 'fragments=' + t.fragments);

    var d = await T2X.extractByIndex(0, {});
    check('导出总行数 = 501', d.rows.length === 501, '实际 ' + d.rows.length);
    check('导出列数 = 8', d.rows[0].length === 8, '实际 ' + d.rows[0].length);

    same('表头行', d.rows[0], ['序号', '户编号', '户口性质', '家庭人口', '户口本号', '是否有效', '备注', '户类型']);
    same('第 1 行数据', d.rows[1], ['1', 'H1000', '农业户口', '1', '', '有效', '原户主变更', '本区划户']);
    same('第 2 行数据', d.rows[2], ['2', 'H1001', '非农业户口', '2', '21027100001', '有效', '', '本区划户']);
    same('第 500 行数据', d.rows[500], ['500', 'H1499', '非农业户口', '4', '21027100499', '有效', '', '本区划户']);

    // 序号必须 1..500 连续（虚拟滚动下最容易错位的地方）
    var seqOk = true;
    var seqBad = '';
    for (var i = 1; i < d.rows.length; i++) {
      if (d.rows[i][0] !== String(i)) {
        seqOk = false;
        seqBad = '第 ' + i + ' 行序号=' + d.rows[i][0];
        break;
      }
    }
    check('序号列 1..500 连续无错位', seqOk, seqBad || 'ok');

    // 户编号唯一，确认没有因滚动重叠产生重复行
    var ids = {};
    var dup = 0;
    for (var r = 1; r < d.rows.length; r++) {
      var id = d.rows[r][1];
      if (ids[id]) dup++;
      ids[id] = true;
    }
    check('无重复行（户编号唯一）', dup === 0, '重复 ' + dup + ' 行');
    check('户编号数量 = 500', Object.keys(ids).length === 500, Object.keys(ids).length);

    // 导出后滚动位置应被还原
    var box = document.getElementById('mainBox');
    check('导出后滚动位置还原', box.scrollTop === 0, 'scrollTop=' + box.scrollTop);

    var bytes = T2X.buildWorkbook([{ name: d.title, rows: d.rows, merges: d.merges }], { detectNumbers: true });
    check('xlsx 生成', bytes.length > 1000 && bytes[0] === 0x50, bytes.length + ' bytes');
    window.__B64__ = T2X.toBase64(bytes);
  } catch (e) {
    check('运行异常', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
  }

  var passed = results.filter(function (r) {
    return r.pass;
  }).length;
  document.getElementById('out').textContent = JSON.stringify({ passed: passed, total: results.length, results: results });
})();
