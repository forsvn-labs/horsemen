// Every theme defines every colour and keeps readable contrast.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {themes, resolve} = require('../web/theme.js');
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
console.log('PASS: ' + themes.length + ' themes define every colour with readable contrast');
