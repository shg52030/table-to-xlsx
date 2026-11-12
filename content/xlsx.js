/*
 * 极简 xlsx 写入器（无第三方依赖，纯本地）
 * 生成 STORE 方式的 zip + OOXML，支持：多 Sheet、合并单元格、列宽、数字识别。
 * 不使用任何远程代码，符合 MV3 的 CSP 要求。
 */
(function (root) {
  var T2X = (root.T2X = root.T2X || {});

  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function strToU8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }

  function dosTime(d) {
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  }

  function zip(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var dt = dosTime(new Date());

    for (var i = 0; i < files.length; i++) {
      var nameBytes = strToU8(files[i].name);
      var data = files[i].data;
      var crc = crc32(data);

      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, 0, true);
      dv.setUint16(10, dt.time, true);
      dv.setUint16(12, dt.date, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, data.length, true);
      dv.setUint32(22, data.length, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      chunks.push(lh, data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var dv2 = new DataView(cd.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true);
      dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true);
      dv2.setUint16(10, 0, true);
      dv2.setUint16(12, dt.time, true);
      dv2.setUint16(14, dt.date, true);
      dv2.setUint32(16, crc, true);
      dv2.setUint32(20, data.length, true);
      dv2.setUint32(24, data.length, true);
      dv2.setUint16(28, nameBytes.length, true);
      dv2.setUint16(30, 0, true);
      dv2.setUint16(32, 0, true);
      dv2.setUint16(34, 0, true);
      dv2.setUint16(36, 0, true);
      dv2.setUint32(38, 0, true);
      dv2.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += lh.length + data.length;
    }

    var cdSize = 0;
    for (var j = 0; j < central.length; j++) cdSize += central[j].length;

    var eocd = new Uint8Array(22);
    var dv3 = new DataView(eocd.buffer);
    dv3.setUint32(0, 0x06054b50, true);
    dv3.setUint16(4, 0, true);
    dv3.setUint16(6, 0, true);
    dv3.setUint16(8, files.length, true);
    dv3.setUint16(10, files.length, true);
    dv3.setUint32(12, cdSize, true);
    dv3.setUint32(16, offset, true);
    dv3.setUint16(20, 0, true);

    var total = offset + cdSize + 22;
    var out = new Uint8Array(total);
    var pos = 0;
    for (var a = 0; a < chunks.length; a++) {
      out.set(chunks[a], pos);
      pos += chunks[a].length;
    }
    for (var b = 0; b < central.length; b++) {
      out.set(central[b], pos);
      pos += central[b].length;
    }
    out.set(eocd, pos);
    return out;
  }

  function esc(s) {
    return String(s)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function colName(i) {
    var s = '';
    i = i + 1;
    while (i > 0) {
      var m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  /* 只认「纯数字」：拒绝 00123、1,234、12%、1e5、超过 15 位整数 */
  function asNumber(s) {
    if (!s || s.length > 17) return null;
    if (!/^-?(0|[1-9]\d{0,14})(\.\d{1,10})?$/.test(s)) return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function textWidth(s) {
    var w = 0;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      w += c > 0x2e80 && c < 0xa4d0 ? 2 : 1;
    }
    return w;
  }

  function sheetName(name, used) {
    var s = String(name || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s) s = 'Sheet';
    if (s.length > 31) s = s.slice(0, 31);
    var base = s;
    var n = 2;
    while (used[s.toLowerCase()]) {
      var suffix = '(' + n + ')';
      s = base.slice(0, 31 - suffix.length) + suffix;
      n++;
    }
    used[s.toLowerCase()] = true;
    return s;
  }

  function buildSheetXml(sheet, opts) {
    var rows = sheet.rows || [];
    var merges = sheet.merges || [];
    var detectNumbers = opts.detectNumbers !== false;

    var width = 0;
    for (var i = 0; i < rows.length; i++) if (rows[i].length > width) width = rows[i].length;

    var widths = new Array(width).fill(8);
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < width; c++) {
        var v = rows[r][c];
        if (!v) continue;
        var parts = String(v).split('\n');
        for (var p = 0; p < parts.length; p++) {
          var w = textWidth(parts[p]) + 2;
          if (w > widths[c]) widths[c] = w;
        }
      }
    }

    var mergeAnchor = {};
    for (var m = 0; m < merges.length; m++) {
      mergeAnchor[merges[m].r + ':' + merges[m].c] = true;
    }

    var out = [];
    out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');
    out.push('<dimension ref="A1:' + colName(Math.max(width - 1, 0)) + Math.max(rows.length, 1) + '"/>');
    out.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    out.push('<sheetFormatPr defaultRowHeight="15"/>');

    if (width > 0) {
      out.push('<cols>');
      for (var w2 = 0; w2 < width; w2++) {
        var cw = Math.min(Math.max(widths[w2], 8), 60);
        out.push('<col min="' + (w2 + 1) + '" max="' + (w2 + 1) + '" width="' + cw + '" customWidth="1"/>');
      }
      out.push('</cols>');
    }

    out.push('<sheetData>');
    for (var rr = 0; rr < rows.length; rr++) {
      var cells = rows[rr];
      var rowXml = [];
      for (var cc = 0; cc < width; cc++) {
        var val = cells[cc];
        var isAnchor = mergeAnchor[rr + ':' + cc];
        if (val === undefined || val === null || val === '') {
          if (isAnchor) rowXml.push('<c r="' + colName(cc) + (rr + 1) + '"/>');
          continue;
        }
        var ref = colName(cc) + (rr + 1);
        var num = detectNumbers ? asNumber(String(val)) : null;
        if (num !== null) {
          rowXml.push('<c r="' + ref + '"><v>' + num + '</v></c>');
        } else {
          rowXml.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>');
        }
      }
      if (rowXml.length === 0) continue;
      out.push('<row r="' + (rr + 1) + '">' + rowXml.join('') + '</row>');
    }
    out.push('</sheetData>');

    if (merges.length) {
      out.push('<mergeCells count="' + merges.length + '">');
      for (var k = 0; k < merges.length; k++) {
        var g = merges[k];
        var ref2 = colName(g.c) + (g.r + 1) + ':' + colName(g.c + g.cs - 1) + (g.r + g.rs);
        out.push('<mergeCell ref="' + ref2 + '"/>');
      }
      out.push('</mergeCells>');
    }

    out.push('</worksheet>');
    return out.join('');
  }

  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><charset val="134"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildWorkbook(sheets, opts) {
    opts = opts || {};
    var used = {};
    var clean = [];
    for (var i = 0; i < sheets.length; i++) {
      clean.push({
        name: sheetName(sheets[i].name, used),
        rows: sheets[i].rows || [],
        merges: sheets[i].merges || []
      });
    }
    if (!clean.length) clean.push({ name: 'Sheet1', rows: [], merges: [] });

    var files = [];
    var ct = [];
    ct.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    ct.push('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">');
    ct.push('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    ct.push('<Default Extension="xml" ContentType="application/xml"/>');
    ct.push('<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>');
    ct.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
    for (var s = 0; s < clean.length; s++) {
      ct.push('<Override PartName="/xl/worksheets/sheet' + (s + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
    }
    ct.push('</Types>');
    files.push({ name: '[Content_Types].xml', data: strToU8(ct.join('')) });

    files.push({
      name: '_rels/.rels',
      data: strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>'
      )
    });

    var wb = [];
    wb.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    wb.push('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    wb.push('<sheets>');
    for (var t = 0; t < clean.length; t++) {
      wb.push('<sheet name="' + esc(clean[t].name) + '" sheetId="' + (t + 1) + '" r:id="rId' + (t + 1) + '"/>');
    }
    wb.push('</sheets></workbook>');
    files.push({ name: 'xl/workbook.xml', data: strToU8(wb.join('')) });

    var rels = [];
    rels.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    rels.push('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">');
    for (var u = 0; u < clean.length; u++) {
      rels.push('<Relationship Id="rId' + (u + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (u + 1) + '.xml"/>');
    }
    rels.push('<Relationship Id="rId' + (clean.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    rels.push('</Relationships>');
    files.push({ name: 'xl/_rels/workbook.xml.rels', data: strToU8(rels.join('')) });

    files.push({ name: 'xl/styles.xml', data: strToU8(STYLES_XML) });

    for (var x = 0; x < clean.length; x++) {
      files.push({
        name: 'xl/worksheets/sheet' + (x + 1) + '.xml',
        data: strToU8(buildSheetXml(clean[x], opts))
      });
    }

    return zip(files);
  }

  function toBase64(bytes) {
    var s = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(s);
  }

  T2X.buildWorkbook = buildWorkbook;
  T2X.toBase64 = toBase64;
  T2X.colName = colName;
})(typeof globalThis !== 'undefined' ? globalThis : this);
