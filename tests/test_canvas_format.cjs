'use strict';
/* Canvas file format: the browser reader of .horsemen/canvas/<name>.canvas.
   The rules are in docs/product/canvas-workspace.md and docs/product/canvas.schema.json.
   The Python reader in horsemen_core has the same rules; the shared fixtures keep the two the same.

   Failure modes these tests cover:
   - input: text that is not JSON, a conflict marker, an array or a number at the top, a file over 512 KiB
     (the 2 MiB case), 5,000 nodes, 1,001 edges, very deep nesting; none of them throws
   - elements: a bad ID, a missing size, a fraction, a number out of range, a note over 20,000 characters,
     a `javascript:` address, CSS in a colour, a path with `..`, an absolute path, a backslash, a control character
   - references in one file: the same ID twice (also a node and an edge), an edge to a node that is not there
   - one bad element hides the others, or a bad element reaches the drawing code
   - unknown keys and unknown node types are refused or lost
   - names: a canvas name with a path, an upper-case letter, or more than 64 characters is accepted
   - canonical text differs from the reference writer (check.py), or changes when it is written again
   - headings: a heading in a code block matches; `#Parent#Child` matches a child of another parent
   - shared fixtures (tests/fixtures/canvas): the browser accepts a case that Python refuses, or gives
     another error code, another message, another order, or another canonical text
   - bytes: a file that is not UTF-8, a byte order mark, nesting deeper than 32 levels, a number that is
     too large, half of a surrogate pair */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../web/canvas-format.js');

const root = path.resolve(__dirname, '..');
const design = path.join(root, 'docs/show-me/canvas-workspace/fixture');
const node = (extra = {}) => ({ id: 'a', type: 'text', x: 0, y: 0, width: 320, height: 160, text: 'Note.', ...extra });
const file = doc => JSON.stringify(doc);
const codes = result => result.errors.map(e => e.code);
const rules = result => result.errors.map(e => e.rule);

/* A valid file. */
const good = F.parse(fs.readFileSync(path.join(design, '.horsemen/canvas/progress.canvas'), 'utf8'));
assert.deepEqual([good.valid, good.fatal, good.errors.length, good.nodes.length, good.edges.length, good.version], [true, null, 0, 11, 7, 1], 'the design fixture is valid');
assert.equal(F.parse(fs.readFileSync(path.join(design, '.horsemen/canvas/launch-plan.canvas'), 'utf8')).valid, true);
assert.deepEqual([F.parse('{}').valid, F.parse('{}').nodes.length, F.parse('{}').version], [true, 0, 1], 'an empty object is an empty canvas of version 1');
assert.equal(F.parse(file({ horsemen: { version: 3 }, nodes: [node()] })).version, 3, 'a higher version is read; the app shows it read-only');

/* Input that is not a canvas: one fatal error, no elements, no exception. */
for (const [text, rule] of [
  ['', 'json'], ['not json', 'json'], ['{"nodes":[', 'json'],
  ['{\n"nodes":[\n<<<<<<< HEAD\n{"id":"a"}\n=======\n{"id":"b"}\n>>>>>>> theirs\n]\n}', 'conflict'],
  ['[]', 'shape'], ['null', 'shape'], ['7', 'shape'], ['"text"', 'shape'],
  [file({ nodes: {} }), 'list'], [file({ edges: 'none' }), 'list'], [file({ nodes: null }), 'list'],
  [file({ horsemen: 1 }), 'version'], [file({ horsemen: {} }), 'version'], [file({ horsemen: { version: 0 } }), 'version'], [file({ horsemen: { version: 1.5 } }), 'version'], [file({ horsemen: { version: '1' } }), 'version'],
  [file({ nodes: Array.from({ length: 5000 }, (_, i) => node({ id: 'n' + i })) }), 'too-many-nodes'],
  [file({ nodes: Array.from({ length: 501 }, (_, i) => node({ id: 'n' + i })) }), 'too-many-nodes'],
  [file({ nodes: [node()], edges: Array.from({ length: 1001 }, (_, i) => ({ id: 'e' + i, fromNode: 'a', toNode: 'a' })) }), 'too-many-edges'],
  [file({ nodes: [node({ text: 'x'.repeat(2 * 1024 * 1024) })] }), 'too-large'],
  ['{"nodes":[],"pad":"' + 'é'.repeat(300 * 1024) + '"}', 'too-large'],
  ['['.repeat(200000) + ']'.repeat(200000), 'deep'],
  ['{"nodes":' + '['.repeat(200000) + ']'.repeat(200000) + '}', 'deep'],
  ['{"x":' + '['.repeat(32) + ']'.repeat(32) + '}', 'deep'],
  ['{"nodes":[],"zoom":1e400}', 'number'], ['{"n":1' + '0'.repeat(5000) + '}', 'number'],
  ['{"nodes":[],"note":"\\ud800"}', 'unicode'], ['{"nodes":[],"\\udfff":1}', 'unicode'],
  [Buffer.from('fffe7b7d', 'hex'), 'utf8'], [new Uint8Array(512 * 1024 + 1).fill(32), 'too-large'],
]) {
  const result = F.parse(text);
  assert.deepEqual([result.valid, result.fatal?.code, result.fatal?.rule, result.nodes.length, result.edges.length], [false, 'canvas-invalid', rule, 0, 0], `fatal ${rule}: ${String(text).slice(0, 40)}`);
  assert.deepEqual(result.errors, [result.fatal], 'a fatal error is the only error');
  assert.match(result.fatal.message, /^[a-z]/, 'a message is the text of the shared rule');
}
assert.deepEqual(F.parse(file({ nodes: {}, edges: 'x' })).errors.map(e => e.message), ['nodes must be a list', 'edges must be a list'], 'both lists are checked');
assert.deepEqual(F.parse(file({ nodes: Array.from({ length: 501 }, () => 1), edges: Array.from({ length: 1001 }, () => 1) })).errors.map(e => e.message), ['more than 500 nodes', 'more than 1,000 edges'], 'both counts are checked, and no element is checked');
assert.equal(F.parse('{"x":' + '['.repeat(31) + ']'.repeat(31) + '}').valid, true, 'unknown data can nest to 32 levels');
/* Bytes and text give the same result. One byte order mark is removed from bytes. */
assert.deepEqual([F.parse(Buffer.from('efbbbf7b7d', 'hex')).valid, F.parse(new Uint8Array(Buffer.from('{"nodes":[]}'))).valid, F.parse(Buffer.from('efbbbfefbbbf7b7d', 'hex')).fatal?.rule], [true, true, 'json']);
assert.equal(F.parse(file({ nodes: Array.from({ length: 500 }, (_, i) => node({ id: 'n' + i })) })).valid, true, '500 nodes is the limit, not over it');
/* Very deep nesting does not stop the reader, also in an unknown key that the app never reads. */
const deep = '['.repeat(200000) + ']'.repeat(200000);
const deepKey = '{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":320,"height":160,"text":"x","tool":' + deep + '}]}';
assert.deepEqual([F.parse(deepKey).fatal.rule, F.parse(deepKey).nodes.length, F.isCanonical(deepKey)], ['deep', 0, false]);
assert.equal(F.parse(undefined).fatal.rule, 'json', 'no text is not a canvas');
assert.equal(F.parse({ nodes: [] }).fatal.rule, 'json', 'parse reads text or bytes only');

/* One bad element: an error names it; the other elements stay. */
const bad = (extra, rule, type = 'node') => {
  const doc = type === 'node' ? { nodes: [node({ id: 'ok' }), { ...node(), ...extra }] } : { nodes: [node({ id: 'ok' })], edges: [{ id: 'e', fromNode: 'ok', toNode: 'ok', ...extra }] };
  for (const key of Object.keys(extra)) if (extra[key] === undefined) delete (type === 'node' ? doc.nodes[1] : doc.edges[0])[key];
  const result = F.parse(file(doc));
  assert.deepEqual([result.valid, result.fatal, codes(result), rules(result)], [false, null, ['canvas-invalid'], [rule]], `${rule}: ${JSON.stringify(extra).slice(0, 80)}`);
  assert.deepEqual(result.nodes.map(n => n.id), ['ok'], 'the valid node stays');
  assert.equal(result.edges.length, 0);
  return result.errors[0];
};
for (const id of ['bad id!', '', '-a', '_a', 'a'.repeat(65), 'a.b', 'a/b', '__proto__', 7, null, undefined]) bad({ id }, 'id');
for (const type of ['', 'x'.repeat(33), 7, null, undefined]) bad({ type }, 'type');
for (const key of ['x', 'y']) for (const value of [0.5, 1000001, -1000001, '0', null, undefined, 1e400, true]) bad({ [key]: value }, key);
for (const key of ['width', 'height']) for (const value of [15, 8193, 100.5, 0, -320, '320', undefined]) bad({ [key]: value }, key);
for (const color of ['red;background:url(https://example.com/x)', 'red', '7', '0', '#fff', '#12345g', '#1234567', 'var(--ink)', '1;', ' 1', 1, null]) bad({ color }, 'color');
for (const text of [undefined, 7, null, ['a'], 'x'.repeat(20001)]) bad({ text }, 'text');
for (const target of ['/etc/passwd', '../../../secrets.md', 'docs/../../x.md', './a.md', 'a/./b.md', 'a/..', '..', '.', 'a\\b.md', 'a\nb.md', 'a\u0000.md', '', 'x'.repeat(1025), 7, undefined]) bad({ type: 'file', file: target }, 'file');
for (const subpath of ['Shipped', '#', '#a\nb', '#' + 'x'.repeat(301), 7]) bad({ type: 'file', file: 'PROGRESS.md', subpath }, 'subpath');
bad({ type: 'file', file: 'a.png', alt: 'x'.repeat(501) }, 'alt'); bad({ type: 'file', file: 'a.png', alt: 7 }, 'alt');
for (const url of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' https://example.com', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '//example.com/x', 'https://exa mple.com', 'https://example.com/\n', 'http://', 'ftp://example.com', 'HTTPS://example.com', 'https://' + 'x'.repeat(2048), 7, undefined]) bad({ type: 'link', url }, 'url');
bad({ type: 'link', url: 'https://example.com', title: 'x'.repeat(201) }, 'title');
bad({ type: 'group', label: 'x'.repeat(201) }, 'label'); bad({ type: 'group', label: 7 }, 'label');
bad({ type: 'group', background: '../x.png' }, 'background'); bad({ type: 'group', backgroundStyle: 'stretch' }, 'backgroundStyle');
for (const end of ['fromNode', 'toNode']) for (const value of ['bad id!', 7, undefined]) bad({ [end]: value }, end, 'edge');
bad({ id: 'bad id!' }, 'id', 'edge');
for (const side of ['fromSide', 'toSide']) bad({ [side]: 'middle' }, side, 'edge');
for (const end of ['fromEnd', 'toEnd']) bad({ [end]: 'circle' }, end, 'edge');
bad({ color: 'red' }, 'color', 'edge'); bad({ label: 'x'.repeat(201) }, 'label', 'edge'); bad({ label: 7 }, 'label', 'edge');
const named = bad({ type: 'link', url: 'javascript:alert(1)' }, 'url');
assert.deepEqual([named.id, named.kind], ['a', 'node'], 'the error names the element');
assert.ok(named.message.includes('a') && !named.message.includes('javascript:'), 'the message names the element and does not repeat a hostile value');
for (const element of [null, 7, 'node', [node()]]) {
  const result = F.parse(file({ nodes: [node({ id: 'ok' }), element] }));
  assert.deepEqual([rules(result), result.nodes.length], [['element'], 1], 'an element that is not an object is one error');
}
/* An element can have more than one fault; each one is reported, and the element is counted once. */
const two = F.parse(file({ nodes: [node({ x: 0.5, color: 'red' })] }));
assert.deepEqual([rules(two), two.nodes.length, two.skipped], [['x', 'color'], 0, 1]);

/* The length limits count characters (code points), as the schema and Python do. */
assert.equal(F.parse(file({ nodes: [node({ text: '😀'.repeat(20000) })] })).valid, true, '20,000 characters outside the basic plane are in the limit');
assert.equal(F.parse(file({ nodes: [node({ text: '😀'.repeat(20001) })] })).valid, false);
assert.equal(F.parse(file({ nodes: [node({ id: 'g', type: 'group', label: '😀'.repeat(200) })] })).valid, true);

/* References inside one file. */
const twice = F.parse(file({ nodes: [node({ text: 'First.' }), node({ text: 'Same id.' })] }));
assert.deepEqual([codes(twice), rules(twice), twice.nodes.map(n => n.text), twice.errors[0].message], [['canvas-invalid'], ['duplicate-id'], ['First.'], 'duplicate id a'], 'the first element keeps a repeated ID');
const shared = F.parse(file({ nodes: [node(), node({ id: 'b' })], edges: [{ id: 'a', fromNode: 'a', toNode: 'b' }, { id: 'e', fromNode: 'a', toNode: 'b' }, { id: 'e', fromNode: 'b', toNode: 'a' }] }));
assert.deepEqual([rules(shared), shared.edges.map(e => e.id + e.fromNode)], [['duplicate-id', 'duplicate-id'], ['ea']], 'node and edge IDs share one space');
const dangling = F.parse(file({ nodes: [node()], edges: [{ id: 'e', fromNode: 'a', toNode: 'ghost' }, { id: 'f', fromNode: 'ghost', toNode: 'a' }, { id: 'g', fromNode: 'a', toNode: 'a' }] }));
assert.deepEqual([codes(dangling), rules(dangling), dangling.edges.map(e => e.id), dangling.valid], [['canvas-dangling-ref', 'canvas-dangling-ref'], ['dangling-edge', 'dangling-edge'], ['g'], false], 'an edge needs both of its nodes');
assert.deepEqual(dangling.errors.map(e => e.message), ['edge e: toNode ghost is not a node', 'edge f: fromNode ghost is not a node']);
const orphan = F.parse(file({ nodes: [node(), node({ id: 'b', x: 0.5 })], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] }));
assert.deepEqual([rules(orphan), orphan.edges.length, orphan.skipped], [['x'], 0, 2], 'an edge to a refused node goes with it; the fault of the node is the one error');
/* A report holds 20 errors at most; the count of elements that do not show stays exact. */
const many = F.parse(file({ nodes: Array.from({ length: 30 }, (_, i) => node({ id: 'b' + i, color: 'red' })) }));
assert.deepEqual([many.errors.length, many.skipped, many.nodes.length], [20, 30, 0]);

/* Unknown keys and types stay. Known types keep their values. */
const kept = F.parse(file({ nodes: [{ ...node(), tool: { z: 1 }, styleAttributes: {} }, { id: 'u', type: 'sticker', x: 0, y: 0, width: 20, height: 20, anything: [1, 2] }], edges: [], other: { keep: true } }));
assert.equal(kept.valid, true, 'unknown keys and unknown node types are valid');
assert.deepEqual([kept.nodes[0].tool, kept.nodes[1].type, kept.nodes[1].anything, kept.extra], [{ z: 1 }, 'sticker', [1, 2], { other: { keep: true } }]);
assert.equal(F.parse(file({ nodes: [{ id: 'u', type: 'sticker', x: 0, y: 0, width: 20, height: 20, url: 'javascript:alert(1)', file: '../x' }] })).valid, true, 'keys of an unknown type are not checked; the app never reads them');
assert.equal(F.parse(file({ nodes: [node({ x: 1.0, y: -0, width: 16, height: 8192 })] })).valid, true, 'a number without a fraction is an integer; the limits are inclusive');
assert.equal(F.parse(file({ nodes: [node({ x: 1000000, y: -1000000, color: '#A1b2C3' })] })).valid, true);
assert.equal(F.parse('{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":320,"height":160,"text":"x","__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":1}}}]}').valid, true);
assert.equal({}.polluted, undefined, 'a file cannot change shared objects');

/* Names of canvas files. */
for (const name of ['progress', 'launch-plan', 'a', '0', 'a'.repeat(64), 'q3-2026']) assert.equal(F.validName(name), true, name);
for (const name of ['', 'Progress', '-a', 'a_b', 'a.b', 'a/b', '../a', 'a'.repeat(65), 'launch plan', null, undefined, 7]) assert.equal(F.validName(name), false, String(name));
assert.deepEqual(['home', 'vision', 'progress', 'brain', 'structure', 'readme', 'changelog', 'techstack'].map(F.reserved), Array(8).fill(true));
assert.deepEqual(['launch-plan', 'constructor', 'toString', 'homes'].map(F.reserved), Array(4).fill(false));
assert.deepEqual([F.canvasName('.horsemen/canvas/launch-plan.canvas', ''), F.canvasName('apps/web/.horsemen/canvas/progress.canvas', 'apps/web'), F.canvasName('apps/web/.horsemen/canvas/progress.canvas', ''),
  F.canvasName('.horsemen/canvas/sub/x.canvas', ''), F.canvasName('.horsemen/canvas/Bad.canvas', ''), F.canvasName('.horsemen/canvas/x.json', ''), F.canvasName('.horsemen/media/x.canvas', '')],
  ['launch-plan', 'progress', null, null, null, null, null]);

/* The kind of an element comes from its type and its file extension. */
const kindOf = extra => F.kind({ ...node(), ...extra });
assert.deepEqual([kindOf({}), kindOf({ type: 'group' }), kindOf({ type: 'link', url: 'https://example.com' }), kindOf({ type: 'sticker' })], ['note', 'group', 'link', 'unknown']);
assert.deepEqual(['PROGRESS.md', 'docs/a.MD', 'notes/x.markdown'].map(f => kindOf({ type: 'file', file: f, subpath: '#A' })), ['section', 'section', 'section']);
assert.deepEqual(['PROGRESS.md', '.horsemen/canvas/launch-plan.canvas', 'a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg', 'a.csv', 'a.tsv', 'a.xlsx', 'a.pdf', 'Makefile', '.env', 'a.svg.txt']
  .map(f => kindOf({ type: 'file', file: f })), ['document', 'portal', 'image', 'image', 'image', 'image', 'image', 'image', 'sheet', 'sheet', 'sheet', 'file', 'file', 'file', 'file']);
assert.equal(F.portalTarget({ type: 'file', file: '.horsemen/canvas/launch-plan.canvas' }), 'launch-plan');
assert.deepEqual(['x/launch-plan.canvas', '.horsemen/canvas/Bad Name.canvas', 'apps/web/.horsemen/canvas/a.canvas'].map(f => F.portalTarget({ type: 'file', file: f })), [null, null, null], 'a portal names a canvas of this project root');

/* Canonical text: the same as the reference writer in the design check, and stable. */
const docs = [
  JSON.parse(fs.readFileSync(path.join(design, '.horsemen/canvas/progress.canvas'), 'utf8')),
  JSON.parse(fs.readFileSync(path.join(design, '.horsemen/canvas/launch-plan.canvas'), 'utf8')),
  {}, { nodes: [], edges: [] }, { horsemen: { version: 2, tool: 'x' }, zeta: 1, alpha: { b: [1, { d: 1, c: 2 }], a: null } },
  { nodes: [node({ id: 'z', text: 'Quote " slash \\ tab\t line\n é 😀   \u007f <script>' }), node({ id: 'B' }), node({ id: 'a2', color: '1', zebra: true, Apple: false }), { id: 'g2', type: 'group', x: -5, y: 0, width: 100, height: 100 }, { id: 'g1', type: 'group', x: 0, y: 0, width: 100, height: 100, label: 'L' }],
    edges: [{ toNode: 'z', id: 'e2', fromNode: 'B', label: 'b' }, { id: 'e1', fromNode: 'z', toNode: 'B', toSide: 'top', fromSide: 'bottom', color: '#aabbcc' }] },
];
const reference = JSON.parse(execFileSync('python3', ['-B', '-c', 'import json,sys\nsys.path.insert(0,sys.argv[1])\nimport check\nprint(json.dumps([check.canonical(d) for d in json.load(sys.stdin)]))', path.dirname(design)], { input: JSON.stringify(docs) }));
docs.forEach((doc, i) => {
  assert.equal(F.canonical(doc), reference[i], `canonical text of document ${i} matches the reference writer`);
  assert.equal(F.canonical(JSON.parse(F.canonical(doc))), F.canonical(doc), 'canonical text does not change when it is written again');
  assert.equal(F.isCanonical(F.canonical(doc)), true);
});
for (const name of ['progress', 'launch-plan']) assert.equal(F.isCanonical(fs.readFileSync(path.join(design, `.horsemen/canvas/${name}.canvas`), 'utf8')), true, name + ' is canonical');
assert.equal(F.isCanonical(JSON.stringify(docs[0])), false, 'one line is valid but not canonical');
assert.equal(F.isCanonical(JSON.stringify(docs[0], null, 2)), false);
assert.equal(F.isCanonical(F.canonical(docs[0]).replace(/\n/g, '\r\n')), false, 'line feeds only');
assert.equal(F.isCanonical(F.canonical(docs[0]).slice(0, -1)), false, 'a final newline');
assert.equal(F.isCanonical('not json'), false);
assert.equal(F.canonical(docs[5]).split('\n').filter(line => line.startsWith('{"id":')).length, 7, 'one element on each line');
assert.deepEqual(JSON.parse(F.canonical(docs[5])).nodes.map(n => n.id), ['g1', 'g2', 'B', 'a2', 'z'], 'groups first, then nodes by ID');

/* Headings: the anchor of a section card. */
const RECORD = '# Progress\n\n## Shipped\n\n- One\n\n### Technical details\n\nA table.\n\n## In progress\n\n```md\n## In a code block\n```\n\n~~~\n## Tilde\n~~~\n\n### Technical details\n\nSecond.\n\n## Up next ##\n\nText.\n\n##NoSpace\n';
assert.deepEqual(F.headings(RECORD).map(h => [h.level, h.text, h.line]), [[1, 'Progress', 1], [2, 'Shipped', 3], [3, 'Technical details', 7], [2, 'In progress', 11], [3, 'Technical details', 21], [2, 'Up next', 25]]);
for (const subpath of ['#Shipped', '#shipped', '# Shipped ', '#Progress', '#Progress#Shipped', '#Shipped#Technical details', '#In progress#Technical details', '#Technical details', '#Up next', '#Progress#In progress#Technical details']) assert.ok(F.findHeading(RECORD, subpath), subpath);
for (const subpath of ['#Renamed heading', '#In a code block', '#Tilde', '#NoSpace', '#Shipped#In progress', '#Up next#Technical details', '#Shipped#Shipped', '', '#', 'Shipped', '#Shipped#', null]) assert.equal(F.findHeading(RECORD, subpath), null, String(subpath));
assert.deepEqual([F.findHeading(RECORD, '#In progress#Technical details').line, F.findHeading(RECORD, '#Technical details').line], [21, 7], 'a child is found below its parent; a lone name is the first match');
const part = F.findHeading(RECORD, '#Shipped');
assert.deepEqual([part.level, part.text, part.body.includes('- One'), part.body.includes('A table.'), part.body.includes('In progress')], [2, 'Shipped', true, true, false], 'a section runs to the next heading of the same or a higher level');
assert.equal(F.findHeading(RECORD.replace(/\n/g, '\r\n'), '#Shipped').text, 'Shipped', 'CRLF records match');

/* References to other files: the app and `horsemen check` name the same faults. */
const lookup = { files: { 'PROGRESS.md': RECORD, 'README.md': '# Readme\n## Get started\n', '.horsemen/media/route-map.svg': null, '.horsemen/canvas/launch-plan.canvas': null } };
const refs = doc => F.references(F.parse(file(doc)), p => Object.hasOwn(lookup.files, p) ? { size: 100, text: lookup.files[p] } : null);
assert.deepEqual(refs({ nodes: [{ ...node(), type: 'file', file: 'PROGRESS.md', subpath: '#Shipped' }, { ...node({ id: 'b' }), type: 'file', file: '.horsemen/media/route-map.svg' }, { ...node({ id: 'c' }), type: 'file', file: 'README.md' }] }), []);
assert.deepEqual(refs({ nodes: [{ ...node(), type: 'file', file: '.horsemen/media/not-there.png' }] }).map(e => [e.code, e.rule, e.id]), [['canvas-dangling-ref', 'missing-file', 'a']]);
assert.deepEqual(refs({ nodes: [{ ...node(), type: 'file', file: 'PROGRESS.md', subpath: '#Renamed heading' }] }).map(e => [e.code, e.rule, e.id]), [['canvas-dangling-ref', 'missing-heading', 'a']]);
assert.deepEqual(refs({ nodes: [{ ...node(), type: 'file', file: '.horsemen/media/route-map.svg', subpath: '#Any' }] }), [], 'a subpath is a heading only in a Markdown file');

/* The design fixture: each invalid case is refused with the code of its `check` rule. */
const EXPECTED = { 'schema-absolute-path': 'file', 'schema-bad-colour': 'color', 'schema-bad-id': 'id', 'schema-fraction': 'x', 'schema-missing-size': 'width', 'schema-path-escape': 'file', 'schema-script-url': 'url',
  'semantic-dangling-edge': 'dangling-edge', 'semantic-duplicate-id': 'duplicate-id', 'semantic-missing-file': 'missing-file', 'semantic-missing-heading': 'missing-heading' };
const designFile = p => { const full = path.join(design, p); return fs.existsSync(full) && fs.statSync(full).isFile() ? { size: fs.statSync(full).size, text: /\.md$/.test(p) ? fs.readFileSync(full, 'utf8') : null } : null; };
const invalid = fs.readdirSync(path.join(design, 'invalid')).filter(n => n.endsWith('.json')).sort();
assert.deepEqual(invalid.map(n => n.replace('.json', '')), Object.keys(EXPECTED).sort(), 'each invalid design case has an expected error');
for (const name of invalid) {
  const result = F.parse(fs.readFileSync(path.join(design, 'invalid', name), 'utf8')), found = [...result.errors, ...F.references(result, designFile)];
  const reference = /missing-(file|heading)/.test(name);
  assert.deepEqual([found[0]?.code, found[0]?.rule], [reference || /dangling/.test(name) ? 'canvas-dangling-ref' : 'canvas-invalid', EXPECTED[name.replace('.json', '')]], name);
  assert.equal(result.valid, reference, name + (reference ? ' is a valid file with a broken reference' : ' is not a valid file'));
}
for (const name of ['progress', 'launch-plan']) assert.deepEqual(F.references(F.parse(fs.readFileSync(path.join(design, `.horsemen/canvas/${name}.canvas`), 'utf8')), designFile), [], name + ' has no broken reference');

/* ---------------------------------------------------------------- shared fixtures
   tests/fixtures/canvas holds the cases that the Python reader (horsemen_core.canvas) and this reader must
   read in the same way: the same errors, in the same order, with the same codes and messages, and the same
   canonical text. The folder comes with the Python half of this slice. Until that half is in this checkout,
   the cases are read from its branch when Git has it. With neither, this part does not run and says so. */
const os = require('node:os');
const S = require('../web/canvas-sections.js');
function sharedFixtures() {
  const local = path.join(root, 'tests/fixtures/canvas');
  if (fs.existsSync(path.join(local, 'cases.json'))) return { dir: local, from: 'tests/fixtures/canvas' };
  for (const ref of [process.env.HORSEMEN_CANVAS_FIXTURES_REF, 'origin/canvas/agent-tools'].filter(Boolean)) {
    try {
      const tar = execFileSync('git', ['archive', '--format=tar', ref, 'tests/fixtures/canvas'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });
      const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'horsemen-canvas-fixtures-'));
      execFileSync('tar', ['-x', '-C', temp], { input: tar });
      process.on('exit', () => fs.rmSync(temp, { recursive: true, force: true }));
      return { dir: path.join(temp, 'tests/fixtures/canvas'), from: `the Git ref ${ref}` };
    } catch { /* The ref is not in this clone. */ }
  }
  return null;
}
const fixtures = sharedFixtures();
if (!fixtures) console.log('canvas format: SKIPPED the shared fixtures. tests/fixtures/canvas is not in this checkout, and the branch origin/canvas/agent-tools is not fetched.');
else {
  const suite = JSON.parse(fs.readFileSync(path.join(fixtures.dir, 'cases.json'), 'utf8'));
  const bytesOf = input => {
    if (input.file) return fs.readFileSync(path.join(fixtures.dir, input.file));
    return Buffer.concat(input.build.map(part => 'hex' in part ? Buffer.from(part.hex, 'hex') : 'text' in part ? Buffer.from(part.text, 'utf8')
      : Buffer.from(Array.from({ length: part.count }, (_, i) => part.repeat.replaceAll('{i}', String(i))).join(part.join ?? ''), 'utf8')));
  };
  /* A project path to a regular file inside the workspace: its size, and its text when it is Markdown. */
  const lookupIn = (folder, virtual = {}) => target => {
    if (Object.hasOwn(virtual, target)) return { size: virtual[target].size, text: null };
    if (target.split('/').some(part => part === '')) return null;
    const full = path.join(fixtures.dir, folder, target);
    let stat; try { stat = fs.lstatSync(full); } catch { return null; }
    return stat.isFile() ? { size: stat.size, text: /\.md$/i.test(target) ? fs.readFileSync(full, 'utf8') : null } : null;
  };
  const plain = errors => errors.map(e => ({ code: e.code, message: e.message }));
  const isText = bytes => { try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).charCodeAt(0) !== 0xfeff; } catch { return false; } };
  assert.ok(suite.cases.length >= 60, 'the shared cases are present');
  for (const item of suite.cases) {
    const bytes = bytesOf(item.input), lookup = item.workspace ? lookupIn(item.workspace, item.virtual) : null;
    const report = F.check(bytes, lookup);
    assert.deepEqual(plain(report.errors), item.expect.errors, `${item.name}: the same errors as the shared case`);
    assert.ok(report.errors.every(e => ['canvas-invalid', 'canvas-dangling-ref', 'canvas-media-too-large'].includes(e.code)));
    /* The browser gets text from its readers, not bytes: the result is the same. */
    if (isText(bytes)) assert.deepEqual(plain(F.check(bytes.toString('utf8'), lookup).errors), item.expect.errors, `${item.name}: text gives the same errors as bytes`);
    if (!item.workspace) assert.equal(F.parse(bytes).valid, item.expect.errors.length === 0, `${item.name}: valid as a file`);
    if (item.expect.errors.length) continue;
    if ('canonical' in item.expect) assert.equal(report.canonical, item.expect.canonical, `${item.name}: canonical`);
    if ('text' in item.expect) assert.equal(report.text, typeof item.expect.text === 'string' ? item.expect.text : fs.readFileSync(path.join(fixtures.dir, item.expect.text.file), 'utf8'), `${item.name}: canonical text`);
    if (item.expect.canonical) assert.equal(report.text, bytes.toString('utf8'), `${item.name}: the input is its own canonical text`);
    assert.equal(report.readOnly, item.expect.read_only === true, `${item.name}: read-only`);
    const again = F.check(Buffer.from(report.text, 'utf8'), lookup);
    assert.deepEqual([again.errors.length, again.text === report.text, again.canonical], [0, true, true], `${item.name}: canonical text does not change when it is read and written again`);
  }
  for (const item of suite.headings) assert.equal(!!F.findHeading(item.markdown, item.subpath), item.found, `heading ${JSON.stringify(item.subpath)} in ${JSON.stringify(item.markdown.slice(0, 40))}`);
  /* Section card IDs. The shared cases state the live rule of slice 1 (web/canvas-sections.js), and the Python
     agent tools follow it, so a card that an agent saves has the same ID as the card that the browser draws. */
  for (const item of suite.slugs) assert.equal(S.slug(item.heading), item.slug, `section slug of ${JSON.stringify(item.heading)}`);
  for (const item of suite.sections) assert.deepEqual(S.parse(item.markdown).map(s => ({ title: s.title, id: s.id })), item.sections, `section cards: ${item.note}`);
  console.log(`canvas format: ${suite.cases.length} shared cases, ${suite.headings.length} heading cases from ${fixtures.from}`);
}

console.log('canvas format: ok');
