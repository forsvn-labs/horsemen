'use strict';
/* CSV and TSV tables on a canvas (slice 2b): text to rows, and rows to escaped markup.

   Failure modes these tests cover:
   - quoting: a comma, a tab, a line break, or a doubled quote inside a quoted field splits the field
   - line ends: CR LF, LF, and CR give different rows; a final line end adds an empty row
   - a byte order mark becomes part of the first header
   - TSV is split on commas, or CSV on tabs; another extension gives a table
   - limits: more than 200 rows or 30 columns reach the page; the count of the rows and columns that do not
     show is wrong; a very long cell fills the page
   - ragged rows: a short row loses its cells or a long row shifts the columns
   - an empty file or a file of blank lines gives a table with no columns
   - an unclosed quote takes the rest of the file and throws
   - hostile cells: markup, quotes, and script text reach the page as markup; a formula or an address becomes a link */
const assert = require('node:assert/strict');
const T = require('../web/canvas-table.js');

/* Which files are tables. XLSX stays a file card. */
assert.deepEqual(['a.csv', 'b/c.CSV', 'x.tsv', 'x.TSV', 'x.xlsx', 'x.csv.md', 'csv', '.csv', 'x.txt', '', null].map(T.format), ['csv', 'csv', 'tsv', 'tsv', null, null, null, null, null, null, null]);
assert.deepEqual(T.LIMITS, { rows: 200, columns: 30, cell: 300 });

/* Quoting and line ends. */
const quoted = T.parse('name,note,count\r\n"Harbour, east","He said ""go""\nthen left",12\r\nGate,,7\n', 'csv');
assert.deepEqual([quoted.header, quoted.rows], [['name', 'note', 'count'], [['Harbour, east', 'He said "go"\nthen left', '12'], ['Gate', '', '7']]]);
assert.deepEqual([quoted.totalRows, quoted.totalColumns, quoted.shownRows, quoted.shownColumns, quoted.truncated], [2, 3, 2, 3, false]);
assert.deepEqual(T.parse('a,b\rc,d\r', 'csv').rows, [['c', 'd']], 'CR alone ends a line');
assert.deepEqual(T.parse('﻿week,guests\n1,12\n2,19\n', 'csv').header, ['week', 'guests'], 'a byte order mark is not text');
assert.deepEqual(T.parse('a,b\n\n1,2\n\n', 'csv').rows, [['1', '2']], 'blank lines are not rows');
assert.deepEqual(T.parse('a,b\n1,"unclosed\n2,3', 'csv').rows, [['1', 'unclosed\n2,3']], 'an unclosed quote takes the rest of the text');
assert.deepEqual(T.parse('a,b\n1,x"y"z\n', 'csv').rows, [['1', 'x"y"z']], 'a quote inside an unquoted field is text');
assert.deepEqual(T.parse('a,b\n"1"x,2\n', 'csv').rows, [['1x', '2']], 'text after a closing quote stays in the field');

/* TSV splits on tabs only. */
const tsv = T.parse('stop\tminutes, walking\nHarbour, east\t12\n"Old\tgate"\t4\n', 'tsv');
assert.deepEqual([tsv.header, tsv.rows], [['stop', 'minutes, walking'], [['Harbour, east', '12'], ['Old\tgate', '4']]]);

/* Ragged rows are padded to the widest row. */
const ragged = T.parse('a\n1,2,3\n4\n', 'csv');
assert.deepEqual([ragged.header, ragged.rows, ragged.totalColumns], [['a', '', ''], [['1', '2', '3'], ['4', '', '']], 3]);

/* Empty input. */
for (const text of ['', '\n\n', '﻿', null, undefined]) {
  const empty = T.parse(text, 'csv');
  assert.deepEqual([empty.header, empty.rows, empty.totalRows, empty.totalColumns], [[], [], 0, 0], String(text));
  assert.match(T.html(empty), /The table is empty\./);
}
const headerOnly = T.parse('a,b\n', 'csv');
assert.deepEqual([headerOnly.header, headerOnly.rows, headerOnly.totalRows], [['a', 'b'], [], 0]);

/* Limits: 200 rows and 30 columns show; the counts give the full table. */
const wide = Array.from({ length: 45 }, (_, i) => 'c' + i).join(',');
const big = T.parse([wide, ...Array.from({ length: 1234 }, (_, r) => Array.from({ length: 45 }, (_, c) => r * 100 + c).join(','))].join('\n'), 'csv');
assert.deepEqual([big.header.length, big.rows.length, big.rows.every(r => r.length === 30), big.totalRows, big.totalColumns, big.shownRows, big.shownColumns, big.truncated], [30, 200, true, 1234, 45, 200, 30, true]);
assert.deepEqual([big.rows[199][0], big.rows[199][29]], ['19900', '19929']);
assert.equal(T.summary(big), 'Shows 200 of 1,234 rows and 30 of 45 columns.');
assert.equal(T.summary(T.parse('a\n' + '1\n'.repeat(250), 'csv')), 'Shows 200 of 250 rows.');
assert.equal(T.summary(T.parse(wide + '\n1', 'csv')), 'Shows 30 of 45 columns.');
assert.equal(T.summary(quoted), '2 rows, 3 columns.');
assert.equal(T.summary(T.parse('a\n1', 'csv')), '1 row, 1 column.');
const long = T.parse('a\n' + 'x'.repeat(5000), 'csv');
assert.equal(long.rows[0][0].length, 300, 'a long cell is clipped');
assert.ok(long.rows[0][0].endsWith('…'));
/* A file of 1 MiB with one column on each line is parsed in one pass. */
const started = Date.now(); const lines = T.parse('n\n' + '1234567\n'.repeat(131072), 'csv');
assert.deepEqual([lines.totalRows, lines.rows.length], [131072, 200]); assert.ok(Date.now() - started < 2000, 'a large file parses fast');

/* Markup: header cells are column headers, numbers align right, and each value is escaped text. */
const html = T.html(quoted, 'Signups');
assert.match(html, /^<table class="sheet-table"><caption class="sr">Signups<\/caption><thead><tr><th scope="col">name<\/th><th scope="col">note<\/th><th scope="col">count<\/th><\/tr><\/thead><tbody>/);
assert.match(html, /<td>Harbour, east<\/td><td>He said &quot;go&quot;\nthen left<\/td><td class="num">12<\/td>/);
for (const [value, numeric] of [['12', true], ['-3.5', true], ['1,234', true], ['12%', true], ['$4.50', true], ['€4', true], ['1e3', true], ['', false], ['12 guests', false], ['0x1F', false], ['week 1', false], ['--', false]])
  assert.equal(T.numeric(value), numeric, value);

const SCRIPT = '<script>window.pwned=1</script>';
const hostile = T.parse([`"${SCRIPT}","<img src=x onerror=""window.pwned=1"">",=HYPERLINK("https://example.com"),javascript:alert(1)`, `"a""><b>",'single',https://example.com/x,&amp;`].join('\n'), 'csv');
const markup = T.html(hostile, '<i>label</i>');
assert.doesNotMatch(markup, /<script|<img|<b>|<i>|<a\b|href=|onerror="/i, 'no cell becomes markup or a link');
assert.match(markup, /&lt;script&gt;window\.pwned=1&lt;\/script&gt;/);
assert.match(markup, /&lt;img src=x onerror=&quot;window\.pwned=1&quot;&gt;/);
assert.match(markup, /<th scope="col">=HYPERLINK\(&quot;https:\/\/example\.com&quot;\)<\/th>/);
assert.match(markup, /<td>&amp;amp;<\/td>/, 'an entity is shown as written');
assert.match(markup, /<td>&#39;single&#39;<\/td>/);
assert.match(markup, /<caption class="sr">&lt;i&gt;label&lt;\/i&gt;<\/caption>/);

console.log('canvas tables: ok');
