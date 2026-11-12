(function () {
  var results = [];
  var t0 = performance.now();

  function check(name, pass, detail) {
    results.push({ name: name, pass: !!pass, detail: detail === undefined ? '' : String(detail).slice(0, 400) });
  }

  function same(name, actual, expected) {
    var a = JSON.stringify(actual);
    var b = JSON.stringify(expected);
    check(name, a === b, a === b ? 'ok' : '期望 ' + b + ' 实际 ' + a);
  }

  var big = document.getElementById('big');
  var html = [];
  for (var r = 0; r < 300; r++) {
    html.push('<tr>');
    for (var c = 0; c < 8; c++) html.push('<td>R' + r + 'C' + c + '</td>');
    html.push('</tr>');
  }
  big.innerHTML = html.join('');

  function byTitle(title) {
    var list = T2X.scan();
    for (var i = 0; i < list.length; i++) if (list[i].title === title) return list[i];
    return null;
  }

  function data(title, opts) {
    var t = byTitle(title);
    if (!t) throw new Error('未找到表格: ' + title);
    return T2X.extractByIndex(t.index, opts || {});
  }

  try {
    var list = T2X.scan();
    check('扫描到 8 个表格（含嵌套内表，排除 div 假表格）', list.length === 8, '实际 ' + list.length);
    check(
      'div 假表格未被识别',
      list.every(function (t) {
        return t.title.indexOf('假') === -1;
      }),
      list.map(function (t) {
        return t.title;
      }).join(',')
    );
    check(
      '标题猜测正确',
      !!byTitle('合并表格') && !!byTitle('数字表格'),
      list.map(function (t) {
        return t.title;
      }).join(',')
    );

    var d1 = data('普通表格');
    same('普通表格数据', d1.rows, [
      ['姓名', '部门', '工号'],
      ['张三', '研发部', '1001'],
      ['李四', '市场部', '1002']
    ]);
    same('普通表格无合并区', d1.merges, []);

    var d2 = data('合并表格');
    same('合并单元格展开', d2.rows, [
      ['序号', '基本信息', '', '', '备注'],
      ['', '姓名', '性别', '年龄', ''],
      ['1', '王五', '男', '28', '']
    ]);
    same('合并区域坐标', d2.merges, [
      { r: 0, c: 0, rs: 2, cs: 1 },
      { r: 0, c: 1, rs: 1, cs: 3 },
      { r: 0, c: 4, rs: 2, cs: 1 }
    ]);

    var d3 = data('隐藏行表格');
    same('默认过滤隐藏行', d3.rows, [
      ['A', '1'],
      ['C', '3'],
      ['', '4']
    ]);
    var d3b = data('隐藏行表格', { includeHidden: true });
    same('可选包含隐藏行', d3b.rows, [
      ['A', '1'],
      ['B', '2'],
      ['C', '3'],
      ['D', '4']
    ]);

    var d4 = data('数字表格');
    same('数字/日期原样保留', d4.rows, [
      ['0012', '1,234', '-5.5', '3.14'],
      ['1e5', '0.5', '2024-01-05', '12%'],
      ['1234567890123456789', '0', '-0.001', '7']
    ]);

    var d5 = data('嵌套表格');
    same('嵌套表格文本合并', d5.rows, [
      ['外1', '外2'],
      ['外3', '内A 内B\n内C 内D']
    ]);

    var d6 = data('多行表格');
    same('br 与块级元素换行', d6.rows, [
      ['第一行\n第二行', '甲\n乙'],
      ['带 空格', '首尾空格']
    ]);

    var t1 = performance.now();
    var d8 = data('大表格');
    var cost = performance.now() - t1;
    check('大表格 300x8 解析', d8.rows.length === 300 && d8.cols === 8, d8.rows.length + 'x' + d8.cols);
    check('大表格解析耗时 < 500ms', cost < 500, Math.round(cost) + 'ms');

    var bytes = T2X.buildWorkbook(
      [
        { name: '普通表格', rows: d1.rows, merges: d1.merges },
        { name: '合并表格', rows: d2.rows, merges: d2.merges },
        { name: '数字表格', rows: d4.rows, merges: [] }
      ],
      { detectNumbers: true }
    );
    check('xlsx 生成', bytes.length > 1000 && bytes[0] === 0x50 && bytes[1] === 0x4b, bytes.length + ' bytes');

    var b64 = T2X.toBase64(bytes);
    var pre = document.createElement('pre');
    pre.id = 'b64';
    pre.style.display = 'none';
    pre.textContent = b64;
    document.body.appendChild(pre);
  } catch (e) {
    check('运行异常', false, (e && e.stack) || String(e));
  }

  var passed = results.filter(function (r) {
    return r.pass;
  }).length;
  var out = document.getElementById('out');
  out.textContent = JSON.stringify(
    { passed: passed, total: results.length, cost: Math.round(performance.now() - t0), results: results },
    null,
    2
  );
  document.title = passed === results.length ? 'ALL PASS ' + passed + '/' + results.length : 'FAIL ' + passed + '/' + results.length;
})();
