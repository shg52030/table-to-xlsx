/* 分页框架兼容性回归：?case=antd 与 ?case=generic 两种样本 */
(async function () {
  var results = [];
  function check(name, pass, detail) {
    results.push({
      name: name,
      pass: !!pass,
      detail: detail === undefined ? '' : String(detail).slice(0, 300)
    });
  }

  var CASE = window.__CASE__;
  var label = CASE === 'antd' ? 'Ant Design' : '通用分页';
  var expected = CASE === 'antd' ? 'antd' : 'generic';

  try {
    var p = T2X.detectPager();
    check(label + '：检测到分页控件', !!p, p && p.framework);
    if (!p) throw new Error('未检测到分页控件');
    check(label + '：框架识别正确', p.framework === expected, '实际 ' + p.framework);

    var info = T2X.pageInfo(p);
    check(label + '：读取总数 46', info.total === 46, 'total=' + info.total);
    check(label + '：读取总页数 5', info.totalPages === 5, 'pages=' + info.totalPages);

    var sizes = await T2X.readPageSizeOptions();
    check(label + '：读到每页条数 [50,20,10]', JSON.stringify(sizes) === '[50,20,10]', JSON.stringify(sizes));

    var set = await T2X.setPageSize(p, 50);
    check(label + '：设为 50 条/页生效', set.ok && set.size === 50, JSON.stringify(set));

    var list = T2X.scan();
    check(label + '：识别为 1 张表', list.length === 1, '实际 ' + list.length);
    if (!list.length) throw new Error('没有识别到表格');

    var all = await T2X.autoHarvestPages(list[0], {
      pageSize: 0,
      seqMode: 'renumber',
      pageTimeout: 6000
    });
    check(label + '：全量采集 46 行 / 1 页', all.rows.length === 47 && all.pages === 1, all.rows.length + ' 行 / ' + all.pages + ' 页');
    check(label + '：自动新增序号列', all.rows[0][0] === '序号' && all.rows[1][0] === '1', all.rows[0].slice(0, 3).join(','));
    check(label + '：首尾数据完整', all.rows[1][1] === 'GD-000001' && all.rows[46][1] === 'GD-000046', all.rows[46][1]);

    var ranged = await T2X.autoHarvestPages(list[0], {
      pageSize: 20,
      range: { from: 2, to: 2 },
      seqMode: 'renumber',
      pageTimeout: 6000
    });
    check(label + '：跳到第 2 页只采 1 页', ranged.pages === 1 && ranged.lastPage === 2, 'pages=' + ranged.pages + ' last=' + ranged.lastPage);
    check(label + '：第 2 页 20 行', ranged.rows.length === 21, '实际 ' + ranged.rows.length);
    check(label + '：第 2 页首行 GD-000021', ranged.rows[1][1] === 'GD-000021', ranged.rows[1][1]);
  } catch (e) {
    check(label + '：运行异常', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }

  var passed = results.filter(function (r) { return r.pass; }).length;
  document.getElementById('out').textContent = JSON.stringify({
    passed: passed,
    total: results.length,
    results: results
  });
})();
