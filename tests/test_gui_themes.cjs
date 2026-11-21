// Every theme defines every token, looks different from the others, and keeps readable contrast in every mode.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {styles, themes, resolve, resolveStyle, resolveMode, preloads, attributes} = require('../web/theme.js');
const css = fs.readFileSync(path.join(__dirname, '../web/style.css'), 'utf8');
const esc = s => s.replace(/[[\]().*+?^$|]/g, '\\$&');
const parse = body => Object.fromEntries([...body.matchAll(/(?:--)?([\w-]+):\s*([^;]+)/g)].map(m => [m[1], m[2].trim()]));
// A block whose whole selector list is exactly `selector`.
const block = (selector, required = true) => {
  const m = css.match(new RegExp('(?:^|[}\\n])\\s*' + esc(selector) + '\\{([^}]*)\\}'));
  if (required) assert(m, 'style.css has a block for ' + selector);
  return m ? parse(m[1]) : {};
};
const base = block(':root,[data-style]');
const palette = id => block(id === themes[0].id ? ':root,[data-swatch=bone]' : ':root[data-theme=' + id + '],[data-swatch=' + id + ']');
const structure = id => id === styles[0].id ? {} : block('[data-style=' + id + ']');
const colours = (id, mode) => block('[data-style=' + id + '][data-mode=' + mode + ']');
const lum = hex => { const v = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2] };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + .05) / (y + .05) };
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message) };
const colourNames = ['ground', 'ground-dot', 'surface', 'surface-2', 'ink', 'ink-2', 'ink-3', 'line', 'line-strong', 'gilt', 'vermilion', 'indigo', 'verdigris', 'focus', 'signal'];
const roles = ['display', 'label', 'ui', 'prose', 'mono'];
const shape = ['radius', 'radius-card', 'radius-sheet', 'radius-chip', 'bw', 'bs', 'shadow-card', 'shadow-lift', 'shadow-pop', 'canvas-image', 'focus-w', 'focus-style', 'd', 'text', 'display-weight'];

// Each theme × mode: the full token set that applies.
const variants = [];
for (const style of styles) {
  if (style.palettes) for (const t of themes) variants.push({style: style.id, mode: t.scheme, name: style.id + '/' + t.id, tokens: {...base, ...palette(t.id)}});
  else for (const mode of style.modes) variants.push({style: style.id, mode, name: style.id + '/' + mode, tokens: {...base, ...structure(style.id), ...colours(style.id, mode)}});
}

assert(styles.length >= 7, 'At least seven themes');
assert.equal(styles[0].id, 'engraved', 'Engraved stays the default');
assert.equal(new Set(styles.map(s => s.id)).size, styles.length, 'Theme ids are unique');
assert.equal(styles.filter(s => s.palettes).length, 1, 'Only Engraved has palettes');
for (const style of styles) {
  assert(style.label && style.note, style.id + ' has a name and a note');
  assert(style.modes.length >= 1 && style.modes.every(m => ['light', 'dark'].includes(m)), style.id + ' supports light, dark, or both');
}
assert(styles.some(s => s.modes.includes('dark')) && styles.some(s => s.modes.length === 2 && !s.palettes), 'Some themes have both modes');

for (const v of variants) {
  const t = v.tokens;
  for (const name of colourNames) assert.match(t[name] || '', /^#[0-9a-f]{6}$/, v.name + ' defines --' + name);
  assert.match(t.shadow || '', /^\d+ \d+ \d+$/, v.name + ' defines --shadow as an RGB triple');
  assert.equal(t['color-scheme'], v.mode, v.name + ' declares its colour scheme');
  for (const role of roles) assert(t[role], v.name + ' defines --' + role);
  for (const name of shape) assert(t[name], v.name + ' defines --' + name);
  const strong = v.style === 'contrast' ? 7 : 4.5;
  for (const paper of ['surface', 'surface-2', 'ground']) {
    for (const text of ['ink', 'ink-2']) check(contrast(t[text], t[paper]) >= strong, `${v.name}: --${text} on --${paper} is ${contrast(t[text], t[paper]).toFixed(2)}`);
    for (const text of ['gilt', 'vermilion', 'indigo', 'verdigris', 'signal']) check(contrast(t[text], t[paper]) >= 4.5, `${v.name}: --${text} on --${paper} is ${contrast(t[text], t[paper]).toFixed(2)}`);
    check(contrast(t['ink-3'], t[paper]) >= 3, `${v.name}: --ink-3 on --${paper} is ${contrast(t['ink-3'], t[paper]).toFixed(2)}`);
    check(contrast(t.focus, t[paper]) >= 3, `${v.name}: the focus ring on --${paper} is ${contrast(t.focus, t[paper]).toFixed(2)}`);
  }
  // Text on the toast and on filled controls: surface on ink, and surface on signal.
  check(contrast(t.surface, t.ink) >= 4.5, v.name + ': the toast is readable');
}
assert.deepEqual(failures, [], 'Readable contrast in every theme and mode');

// The rules use each token, so a theme changes the real interface and not only its preview.
const rules = css.replace(/(?:^|[}\n])\s*(?::root|\[data-s)[^{]*\{[^}]*--ground:[^}]*\}/g, '');
for (const name of [...shape.filter(n => n !== 'text'), 'signal', 'focus', 'ground-dot', 'shadow']) assert.match(rules, new RegExp('var\\(--' + name + '[),]'), 'A rule uses --' + name);
for (const [selector, token] of [['.artifact', 'radius-card'], ['.artifact', 'shadow-card'], ['.canvas', 'canvas-image'], ['#peek', 'radius-sheet'], ['#peek', 'shadow-pop'], ['.menu', 'shadow-pop'], ['.rail', 'rail-bg'], ['.tag', 'radius-chip'], ['.btn', 'radius']]) {
  const m = css.match(new RegExp('(?:^|[}\\n])' + esc(selector) + '\\{([^}]*)\\}'));
  assert(m && m[1].includes('var(--' + token + ')'), selector + ' uses --' + token);
}
assert.match(css, /html\{font-size:var\(--text\)\}/, 'The root font size follows the theme, so High contrast scales all text');

// Themes look different: each pair differs in at least three of these six traits.
const first = value => value.split(',')[0].trim().replace(/"/g, '');
const traits = v => {
  const t = v.tokens;
  return [first(t.display), first(t.ui), t['radius-card'], t.bw + ' ' + t.bs, t['shadow-card'] === 'none' ? 'flat' : t['shadow-card'], t['canvas-image']];
};
const representative = styles.map(s => variants.find(v => v.style === s.id));
for (let i = 0; i < representative.length; i++) for (let j = i + 1; j < representative.length; j++) {
  const a = traits(representative[i]), b = traits(representative[j]);
  const differ = a.filter((x, k) => x !== b[k]).length;
  check(differ >= 3, `${representative[i].style} and ${representative[j].style} differ in only ${differ} traits`);
}
assert.deepEqual(failures, [], 'Every theme has its own style, not only its own colours');

// Fonts: each family is declared once, credited, licensed, and only the active theme preloads.
const fontsDir = path.join(__dirname, '../web/assets/fonts');
const notice = fs.readFileSync(path.join(fontsDir, 'NOTICE.txt'), 'utf8');
const ofl = fs.readFileSync(path.join(fontsDir, 'OFL.txt'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const faces = Object.fromEntries([...css.matchAll(/@font-face\{([^}]*)\}/g)].map(m => {
  const family = m[1].match(/font-family:([\w-]+)/)[1], file = m[1].match(/url\(\/assets\/fonts\/([\w-]+\.woff2)\)/)[1];
  assert.match(m[1], /font-weight:100 900/, family + ' declares its variable weight range, so bold is not synthesized');
  assert.match(m[1], /font-display:swap/, family + ' shows text while it loads');
  return [family, file];
}));
const familiesOf = value => value.split(',').map(f => f.trim().replace(/"/g, ''));
for (const style of styles) {
  const v = variants.find(x => x.style === style.id), used = new Set(roles.flatMap(role => familiesOf(v.tokens[role])).filter(f => f in faces));
  for (const role of roles) assert.match(familiesOf(v.tokens[role]).at(-1), /^(serif|sans-serif|monospace|system-ui)$/, style.id + ' --' + role + ' ends with a generic family');
  assert(preloads(style.id).length >= 1, style.id + ' preloads its main font');
  for (const href of preloads(style.id)) {
    const file = href.split('/').pop();
    assert(Object.entries(faces).some(([family, f]) => f === file && used.has(family)), style.id + ' preloads ' + file + ', which it uses');
  }
}
assert.doesNotMatch(html, /rel="preload"[^>]*woff2/, 'index.html preloads no fixed fonts; theme.js preloads the active theme');
const files = fs.readdirSync(fontsDir).filter(f => f.endsWith('.woff2')).sort();
assert.deepEqual(Object.values(faces).sort(), files, 'Each font file has one @font-face');
for (const [family, file] of Object.entries(faces)) {
  assert(notice.includes(family), 'NOTICE.txt names ' + family);
  assert(ofl.includes('Copyright 2026 The ' + family + ' Project Authors'), 'OFL.txt keeps the copyright line for ' + family);
  const data = fs.readFileSync(path.join(fontsDir, file));
  assert(data.subarray(0, 4).toString() === 'wOF2', file + ' is WOFF2');
  assert(data.length < 40 * 1024, file + ' is a small subset (under 40 KiB)');
}

// Saved choices: known ids win, old values map forward, anything else follows the device.
assert.equal(resolve('ember', false), 'ember');
assert.equal(resolve('dark', false), 'ink');
assert.equal(resolve('light', true), 'bone');
assert.equal(resolve(null, true), 'ink');
assert.equal(resolve('nonsense', false), 'bone');
assert.equal(resolveStyle(null), 'engraved');
assert.equal(resolveStyle('nonsense'), 'engraved');
assert.equal(resolveStyle('editorial', 'modern'), 'editorial', 'A saved theme wins over an old type set');
assert.equal(resolveStyle(null, 'modern'), 'modern', 'The old Modern type set keeps readable type');
assert.equal(resolveStyle(null, 'system'), 'modern', 'The old System type set keeps readable type');
assert.equal(resolveStyle(null, 'engraved'), 'engraved');
assert.equal(resolveMode('terminal', 'light', false), 'dark', 'A dark-only theme stays dark');
assert.equal(resolveMode('editorial', 'dark', true), 'light', 'A light-only theme stays light');
assert.equal(resolveMode('modern', null, true), 'dark', 'System follows the device');
assert.equal(resolveMode('modern', null, false), 'light');
assert.equal(resolveMode('modern', 'light', true), 'light', 'A chosen mode wins');
assert.equal(resolveMode('modern', 'nonsense', true), 'dark');
assert.deepEqual(attributes({style: null, theme: 'ember', mode: 'light', prefersDark: false}), {style: 'engraved', theme: 'ember', mode: 'dark'}, 'Engraved takes its mode from the palette');
assert.deepEqual(attributes({style: 'soft', theme: 'ember', mode: null, prefersDark: true}), {style: 'soft', theme: null, mode: 'dark'}, 'Other themes ignore the Engraved palette');

// Readable text everywhere: no text under 12px in any theme, including the larger High contrast text.
assert.doesNotMatch(css, /[^-]color:var\(--ink-3\)/, '--ink-3 is for lines and marks only; it does not reach 4.5:1 for text');
const scales = variants.map(v => parseFloat(v.tokens.text) / 100);
assert(scales.every(s => s >= 1), 'No theme makes text smaller than the browser default');
assert(Math.max(...variants.filter(v => v.style === 'contrast').map(v => parseFloat(v.tokens.text))) > 100, 'High contrast has larger text');
const small = [];
for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) for (const size of m[2].matchAll(/(?:font:[^;]*?|font-size:)\s*([0-9.]+)(px|rem)/g)) {
  const px = Number(size[1]) * (size[2] === 'rem' ? 16 * Math.min(...scales) : 1);
  if (px < 12) small.push(m[1].trim() + ' ' + size[0]);
}
for (const m of css.matchAll(/--fs-[\w-]+:\s*([0-9.]+)(px|rem)/g)) if (Number(m[1]) * (m[2] === 'rem' ? 16 : 1) < 12) small.push(m[0]);
assert.deepEqual(small, [], 'Text meets the 12px floor, including the type scale tokens');
// The hosted CSP allows images from 'self' and blob: only, so CSS must load no data: URL, and each url() is a file in web/.
for (const file of ['style.css', 'canvas-editor.css']) {
  const text = fs.readFileSync(path.join(__dirname, '../web', file), 'utf8');
  for (const m of text.matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    const ref = m[1].trim();
    assert(!/^data:/i.test(ref), file + ' loads a data: URL, which the hosted CSP blocks: ' + ref.slice(0, 40));
    if (ref.startsWith('#')) continue;
    assert(ref.startsWith('/'), file + ' uses a root path for ' + ref);
    assert(fs.existsSync(path.join(__dirname, '../web', ref)), file + ' refers to a missing file: ' + ref);
  }
}
// Motion stops when the device asks for reduced motion.
assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\*,\*:before,\*:after\{animation:none!important;transition:none!important/);
console.log('PASS: ' + styles.length + ' themes, ' + variants.length + ' theme and mode variants: every token, a distinct style, readable contrast, and licensed fonts');
