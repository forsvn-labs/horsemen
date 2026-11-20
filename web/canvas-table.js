'use strict';
/* CSV and TSV tables on a canvas (canvas slice 2b).
   The reader gives the text of a file that a canvas names (1 MiB at most). These rules split it into rows and
   write a table: the first row is the header, then the first 200 rows and the first 30 columns. Each cell is
   escaped text; no cell becomes a link or markup. XLSX is not a table here: it stays a file card.
   Pure rules, shared by the app and tests/test_canvas_table.cjs: no DOM, no network. */
(function (root) {
  const LIMITS = { rows: 200, columns: 30, cell: 300 };
  const FORMATS = { '.csv': 'csv', '.tsv': 'tsv' };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clip = text => text.length > LIMITS.cell ? text.slice(0, LIMITS.cell - 1) + '…' : text;
  const number = n => n.toLocaleString('en-US');

  /* 'csv', 'tsv', or null, from the extension of a path. */
  function format(path) {
    if (typeof path !== 'string') return null;
    const name = path.split('/').pop(), dot = name.lastIndexOf('.');
    return dot > 0 ? FORMATS[name.slice(dot).toLowerCase()] || null : null;
  }

  /* Rows of a CSV or TSV text. A field in double quotes can hold the separator, a line end, and a doubled quote.
     A quote inside a field without quotes is text. A blank line is not a row. Only the rows and columns that show
     are kept; the others are counted. */
  function parse(input, kind = 'csv') {
    let text = typeof input === 'string' ? input : '';
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const sep = kind === 'tsv' ? '\t' : ',', kept = [];
    let row = [], field = '', quoted = false, started = false, total = 0, widest = 0, i = 0;
    const endField = () => { if (row.length < LIMITS.columns) row.push(clip(field)); else row.length++; field = ''; };
    const endRow = () => {
      endField();
      const width = row.length;
      if (!(width === 1 && row[0] === '')) {
        widest = Math.max(widest, width);
        if (kept.length <= LIMITS.rows) kept.push(Array.from({ length: Math.min(width, LIMITS.columns) }, (_, c) => row[c] ?? ''));
        total++;
      }
      row = []; started = false;
    };
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
        /* Keep only the text that can show: a long cell is clipped, so the rest is skipped. */
        if (field.length <= LIMITS.cell) field += c;
        i++; continue;
      }
      if (c === '"' && field === '' && !started) { quoted = true; started = true; i++; continue; }
      if (c === sep) { endField(); started = false; i++; continue; }
      if (c === '\n' || c === '\r') { endRow(); i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
      if (field.length <= LIMITS.cell) field += c;
      started = true; i++;
    }
    if (quoted || started || field !== '' || row.length) endRow();
    const columns = Math.min(widest, LIMITS.columns), pad = r => [...r, ...Array(columns - r.length).fill('')];
    const header = kept.length ? pad(kept[0]) : [], rows = kept.slice(1, LIMITS.rows + 1).map(pad);
    const totalRows = Math.max(0, total - 1);
    return { header, rows, totalRows, totalColumns: widest, shownRows: rows.length, shownColumns: columns, truncated: totalRows > rows.length || widest > columns };
  }

  /* One line about the size: what shows of a large table, or the size of a small one. */
  function summary(table) {
    const parts = [];
    if (table.totalRows > table.shownRows) parts.push(`${number(table.shownRows)} of ${number(table.totalRows)} rows`);
    if (table.totalColumns > table.shownColumns) parts.push(`${number(table.shownColumns)} of ${number(table.totalColumns)} columns`);
    if (parts.length) return 'Shows ' + parts.join(' and ') + '.';
    const plural = (n, word) => number(n) + ' ' + word + (n === 1 ? '' : 's');
    return plural(table.totalRows, 'row') + ', ' + plural(table.totalColumns, 'column') + '.';
  }

  /* A number, an amount, or a percentage: such a cell aligns right. */
  const NUMBER = /^[-+]?[$€£¥]?\s?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?%?$/i;
  const numeric = value => typeof value === 'string' && /\d/.test(value) && NUMBER.test(value.trim()) && !/^[-+]?[$€£¥]?\s?\.?e/i.test(value.trim());

  /* The table as markup. Each value is escaped text. A column whose values that show are all numbers aligns right. */
  function html(table, label = '') {
    if (!table.header.length) return '<p class="card-note">The table is empty.</p>';
    const cell = (tag, value, attrs = '') => '<' + tag + attrs + '>' + esc(value) + '</' + tag + '>';
    const num = table.header.map((_, c) => table.rows.some(r => r[c] !== '') && table.rows.every(r => r[c] === '' || numeric(r[c])) ? ' class="num"' : '');
    return '<table class="sheet-table">' + (label ? '<caption class="sr">' + esc(label) + '</caption>' : '') +
      '<thead><tr>' + table.header.map((h, c) => cell('th', h, ' scope="col"' + num[c])).join('') + '</tr></thead>' +
      '<tbody>' + table.rows.map(r => '<tr>' + r.map((v, c) => cell('td', v, num[c])).join('') + '</tr>').join('') + '</tbody></table>';
  }

  const api = { LIMITS, format, parse, summary, numeric, html };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HorsemenTable = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
