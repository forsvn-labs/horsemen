const assert = require('node:assert/strict');
const {render, inline, safeURL} = require('../web/markdown.js');
const base = 'https://github.com/example/app/blob/abc/VISION.md';

// Unsafe input never becomes markup or a script link.
const unsafe = render('<script>window.pwned=1</script>\n[bad](javascript:alert(1))\n<img src=x onerror=alert(1)>', base);
assert(!unsafe.includes('<script>') && !unsafe.includes('<img') && !unsafe.includes('href="javascript:'));
assert.equal(safeURL('javascript:alert(1)', base), null);
assert.equal(safeURL('docs/a.md', base), 'https://github.com/example/app/blob/abc/docs/a.md');
assert(!render('[x](https://example.com/"onmouseover="alert(1))', base).includes('"onmouseover'));

// Hard-wrapped prose is one paragraph, not one paragraph for each line.
assert.equal(render('A sentence that\nwraps at the margin.\n\nA second paragraph.', base), '<p>A sentence that wraps at the margin.</p><p>A second paragraph.</p>');
// Stacked "Label: value" lines stay on separate lines.
assert.equal(render('Owner: A fictional team\nStage: pilot', base), '<p>Owner: A fictional team<br>Stage: pilot</p>');

// Headings keep plain tags, so the outline can find them.
assert.equal(render('# One\n## Two\n###### Six', base), '<h1>One</h1><h2>Two</h2><h6>Six</h6>');

// Lists: wrapped items, nesting, ordered lists, and tasks.
assert.equal(render('- First item that\n  wraps\n- Second', base), '<ul><li>First item that wraps</li><li>Second</li></ul>');
assert.equal(render('- Parent\n  - Child\n  - Child two\n- Next', base), '<ul><li>Parent<ul><li>Child</li><li>Child two</li></ul></li><li>Next</li></ul>');
assert.equal(render('1. One\n2. Two', base), '<ol><li>One</li><li>Two</li></ol>');
assert.equal(render('- [x] Done\n- [ ] Open', base), '<ul class="tasks"><li class="task done">Done</li><li class="task">Open</li></ul>');
assert.equal(render('- Item\n\nAfter the list.', base), '<ul><li>Item</li></ul><p>After the list.</p>');
// A bold lead becomes a titled entry.
assert.equal(render('- **Search**: Reached the pilot.', base), '<ul><li class="entry"><strong>Search</strong><span>Reached the pilot.</span></li></ul>');
assert.equal(render('- [Notebook](docs/n.md): interviews.', base), '<ul><li class="entry"><strong><a target="_blank" rel="noopener noreferrer" href="https://github.com/example/app/blob/abc/docs/n.md">Notebook</a></strong><span>interviews.</span></li></ul>');

// Inline marks.
assert.equal(inline('**bold** and *soft* and `code` and ~~gone~~', base), '<strong>bold</strong> and <em>soft</em> and <code>code</code> and <del>gone</del>');
assert.equal(inline('snake_case_name stays', base), 'snake_case_name stays');
assert.equal(inline('2 * 3 * 4', base), '2 * 3 * 4');
assert.equal(inline('**[Doc](https://example.com/a)** here', base), '<strong><a target="_blank" rel="noopener noreferrer" href="https://example.com/a">Doc</a></strong> here');
assert.equal(inline('See https://example.com/a. Then <https://example.com/b>', base), 'See <a target="_blank" rel="noopener noreferrer" href="https://example.com/a">https://example.com/a</a>. Then <a target="_blank" rel="noopener noreferrer" href="https://example.com/b">https://example.com/b</a>');
assert.equal(inline('`<b>` & "q"', base), '<code>&lt;b&gt;</code> &amp; &quot;q&quot;');
assert(inline('![shot](https://example.com/a.png)', base).includes('>Attachment: shot</a>'));

// Blocks: quotes, rules, code, tables, disclosures, comments.
assert.equal(render('> Quoted\n> words', base), '<blockquote><p>Quoted words</p></blockquote>');
assert.equal(render('Above\n\n---\n\nBelow', base), '<p>Above</p><hr><p>Below</p>');
assert.equal(render('```text\n<a>\n- not a list\n```', base), '<pre><code>&lt;a&gt;\n- not a list</code></pre>');
assert.equal(render('```\nopen', base), '<pre><code>open</code></pre>');
const table = render('| Tool | Purpose |\n| --- | :-: |\n| Python | Reader |\nAfter', base);
assert.equal(table, '<div class="table-wrap"><table><thead><tr><th>Tool</th><th>Purpose</th></tr></thead><tbody><tr><td>Python</td><td>Reader</td></tr></tbody></table></div><p>After</p>');
assert.equal(render('<details>\n<summary>Evidence</summary>\nProof\n</details>', base), '<details><summary>Evidence</summary><p>Proof</p></details>');
assert.equal(render('<details open>\n<summary>Open</summary>\nText', base), '<details open><summary>Open</summary><p>Text</p></details>');
assert.equal(render('</details>\nText', base), '<p>&lt;/details&gt; Text</p>');
assert.equal(render('Shown\n<!-- hidden\nnote -->\nAlso shown', base), '<p>Shown</p><p>Also shown</p>');
assert.equal(render('', base), '');
console.log('PASS: Markdown rendering is safe and keeps document structure');
