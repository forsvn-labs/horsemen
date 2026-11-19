// Every theme defines every colour and keeps readable contrast.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {themes, resolve, types, resolveType, preloads} = require('../web/theme.js');
const css = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
const tokens = id => {
  const block = css.match(new RegExp((id === themes[0].id ? ':root' : ':root\\[data-theme=' + id + '\\]') + ',\\[data-swatch=' + id + '\\]\\{([^}]*)\\}'));
  assert(block, 'style.css has a block for theme ' + id);
  return Object.fromEntries([...block[1].matchAll(/(?:--)?([\w-]+):\s*([^;]+)/g)].map(m => [m[1], m[2].trim()]));
};
const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2] };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05) };
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message) };
const colours = ['ground', 'ground-dot', 'surface', 'surface-2', 'ink', 'ink-2', 'ink-3', 'line', 'line-strong', 'gilt', 'vermilion', 'indigo', 'verdigris', 'rail', 'rail-2', 'rail-3', 'rail-ink', 'rail-muted', 'rail-line', 'rail-gilt', 'focus'];
assert(themes.length >= 4, 'More than light and dark');
assert.equal(new Set(themes.map(t => t.id)).size, themes.length);
for (const theme of themes) {
  const t = tokens(theme.id);
  for (const name of colours) assert.match(t[name] || '', /^#[0-9a-f]{6}$/, theme.id + ' defines --' + name);
  assert.equal(t['color-scheme'], theme.scheme, theme.id + ' declares its colour scheme');
  for (const paper of ['surface', 'surface-2', 'ground']) {
    for (const text of ['ink', 'ink-2', 'gilt', 'vermilion', 'indigo', 'verdigris']) check(contrast(t[text], t[paper]) >= 4.5, `${theme.id}: --${text} on --${paper} is ${contrast(t[text], t[paper]).toFixed(2)}`);
    check(contrast(t['ink-3'], t[paper]) >= 3, `${theme.id}: --ink-3 on --${paper} is ${contrast(t['ink-3'], t[paper]).toFixed(2)}`);
  }
  for (const paper of ['rail', 'rail-2', 'rail-3']) for (const text of ['rail-ink', 'rail-muted', 'rail-gilt']) check(contrast(t[text], t[paper]) >= 4.5, `${theme.id}: --${text} on --${paper} is ${contrast(t[text], t[paper]).toFixed(2)}`);
  assert(contrast(t.focus, t.surface) >= 3, theme.id + ': focus ring is visible');
}
assert.deepEqual(failures, [], 'Readable contrast in every theme');
// Saved choices: known ids win, old values map forward, anything else follows the system.
assert.equal(resolve('ember', false), 'ember');
assert.equal(resolve('dark', false), 'ink');
assert.equal(resolve('light', true), 'bone');
assert.equal(resolve(null, true), 'ink');
assert.equal(resolve('nonsense', false), 'bone');
assert.equal(resolve('system', true), 'ink');

// Type sets: every set works with every colour theme.
const fontsDir = path.join(__dirname, '../web/assets/fonts');
const notice = fs.readFileSync(path.join(fontsDir, 'NOTICE.txt'), 'utf8');
const ofl = fs.readFileSync(path.join(fontsDir, 'OFL.txt'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const roles = ['display', 'label', 'ui', 'prose', 'mono'];
const typeTokens = id => {
  if (id === types[0].id) return tokens(themes[0].id);
  const block = css.match(new RegExp(':root\\[data-type=' + id + '\\]\\{([^}]*)\\}'));
  assert(block, 'style.css has a block for type set ' + id);
  return Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*([^;]+)/g)].map(m => [m[1], m[2].trim()]));
};
const faces = Object.fromEntries([...css.matchAll(/@font-face\{([^}]*)\}/g)].map(m => {
  const family = m[1].match(/font-family:([\w-]+)/)[1], file = m[1].match(/url\(\/assets\/fonts\/([\w-]+\.woff2)\)/)[1];
  assert.match(m[1], /font-weight:100 900/, family + ' declares its variable weight range, so bold is not synthesized');
  assert.match(m[1], /font-display:swap/, family + ' shows text while it loads');
  return [family, file];
}));
const familiesOf = value => value.split(',').map(f => f.trim().replace(/"/g, ''));
assert.equal(types[0].id, 'engraved', 'Engraved stays the default');
assert.deepEqual(types.map(t => t.id).sort(), ['engraved', 'modern', 'system']);
for (const type of types) {
  assert(type.label && type.note, type.id + ' has a label and a note');
  const t = typeTokens(type.id);
  for (const role of roles) {
    assert(t[role], type.id + ' defines --' + role);
    assert.match(familiesOf(t[role]).at(-1), /^(serif|sans-serif|monospace|system-ui)$/, type.id + ' --' + role + ' ends with a generic family');
  }
  if (type.id !== types[0].id) for (const name of colours) assert(!(name in t), type.id + ' changes no colour, so every theme keeps its contrast');
  const used = new Set(roles.flatMap(role => familiesOf(t[role])).filter(f => f in faces));
  if (type.id === 'system') assert.equal(used.size, 0, 'System uses only device fonts and downloads nothing');
  // Preload only fonts the active set uses.
  for (const href of preloads(type.id)) {
    const file = href.split('/').pop();
    assert(Object.entries(faces).some(([family, f]) => f === file && used.has(family)), type.id + ' preloads ' + file + ', which it uses');
  }
  if (type.id === 'system') assert.deepEqual(preloads(type.id), []);
  else assert(preloads(type.id).length >= 1, type.id + ' preloads its main font');
  // Colour and type are independent: check the full matrix.
  for (const theme of themes) {
    const merged = {...tokens(theme.id), ...(type.id === types[0].id ? {} : t)};
    for (const text of ['ink', 'ink-2']) check(contrast(merged[text], merged.surface) >= 4.5, `${theme.id} × ${type.id}: --${text} on --surface`);
  }
}
assert.doesNotMatch(html, /rel="preload"[^>]*woff2/, 'index.html preloads no fixed fonts; theme.js preloads the active set');
// Every bundled font is declared, credited, and licensed.
const files = fs.readdirSync(fontsDir).filter(f => f.endsWith('.woff2')).sort();
assert.deepEqual(Object.values(faces).sort(), files, 'Each font file has one @font-face');
for (const [family, file] of Object.entries(faces)) {
  assert(notice.includes(family), 'NOTICE.txt names ' + family);
  assert(ofl.includes('Copyright 2026 The ' + family + ' Project Authors'), 'OFL.txt keeps the copyright line for ' + family);
  assert(fs.readFileSync(path.join(fontsDir, file)).subarray(0, 4).toString() === 'wOF2', file + ' is WOFF2');
}
assert.equal(resolveType(null), 'engraved');
assert.equal(resolveType('modern'), 'modern');
assert.equal(resolveType('nonsense'), 'engraved');
// Readable text everywhere: placeholders use body-text tokens, and no text is under 12px.
assert.doesNotMatch(css, /[^-]color:var\(--ink-3\)/, '--ink-3 is for lines and marks only; it does not reach 4.5:1 for text');
const small = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const size of m[2].matchAll(/(?:font:[^;]*?|font-size:)\s*([0-9.]+)px/g)) {
  const selector = m[1].trim(), px = Number(size[1]);
  if (px < 12) small.push(selector + ' ' + px + 'px');
}
for (const m of css.matchAll(/--fs-[\w-]+:\s*([0-9.]+)px/g)) if (Number(m[1]) < 12) small.push(m[0]);
assert.deepEqual(small, [], 'Text meets the 12px floor, including the type scale tokens');
assert.deepEqual(failures, [], 'Readable contrast in every theme and type set');
console.log('PASS: ' + themes.length + ' themes × ' + types.length + ' type sets define every colour and font with readable contrast');
