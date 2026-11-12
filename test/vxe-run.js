(function () {
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
    check('表头与表体被识别为 1 张表', list.length === 1, '实际 ' + list.length);
    if (!list.length) throw new Error('没有识别到表格');

    var t = list[0];
    check('标记为多片段合并', t.merged === true && t.fragments === 2, 'fragments=' + t.fragments);
    check('行数 = 1 表头 + 3 数据', t.rows === 4, 'rows=' + t.rows);
    check('列数 = 9 - 1 勾选列', t.cols === 8, 'cols=' + t.cols);

    var d = T2X.extractByIndex(0, {});
    same('合并后表头行', d.rows[0], ['序号', '户编号', '户主姓名', '户主身份证号', '家庭人口数', '户口性质', '户口本号', '住址']);
    same('第 1 行数据', d.rows[1], ['1', '1575', '许**', '150526196603050017', '1', '农业户口', '', '鲁xx山村']);
    same('第 2 行数据', d.rows[2], ['2', '1576', '王**', '320102199001011234', '3', '非农业户口', 'NO.0012', '和平路 12 号']);
    same('第 3 行数据', d.rows[3], ['3', '1577', '李**', '110101198505050011', '2', '农业户口', '', '建设大道 88 号']);
    check('勾选列已剔除（无空表头列）', d.rows[0][0] === '序号', d.rows[0][0]);
    check('空的户口本号列保留', d.rows[1][6] === '' && d.rows[0][6] === '户口本号', d.rows[1][6]);

    var bytes = T2X.buildWorkbook([{ name: d.title, rows: d.rows, merges: d.merges }], { detectNumbers: true });
    check('xlsx 生成', bytes.length > 1000 && bytes[0] === 0x50, bytes.length + ' bytes');
    window.__B64__ = T2X.toBase64(bytes);
  } catch (e) {
    check('运行异常', false, (e && e.message) || String(e));
  }

  var passed = results.filter(function (r) {
    return r.pass;
  }).length;
  document.getElementById('out').textContent = JSON.stringify({ passed: passed, total: results.length, results: results });
})();
