'use strict';
/* Diagram and image helpers (web/media.js). Failure modes covered:
   - a diagram has no accessible name, or a wrong one for its type
   - front matter, comments, and accessible titles hide the diagram type
   - a long or multi-line parse error floods the page
   - theme colours that Mermaid cannot read, or a light diagram in a dark theme
   - pie and chart colours that repeat or vanish into the background
   - an image link matches a different registered link, or a non-image link */
const assert = require('node:assert/strict');
const M = require('../web/media.js');

// Names for each diagram type.
const cases = {
  'flowchart LR\n A-->B': 'Flowchart', 'graph TD\nA': 'Flowchart', 'sequenceDiagram\n A->>B: hi': 'Sequence diagram',
  'classDiagram\n A <|-- B': 'Class diagram', 'stateDiagram-v2\n [*] --> A': 'State diagram', 'erDiagram\n A ||--o{ B : has': 'Entity relationship diagram',
  'pie title Pets\n "Dogs" : 3': 'Pie chart: Pets', 'pie\n "Dogs" : 3': 'Pie chart', 'xychart-beta\n bar [1,2]': 'XY chart', 'xychart\n line [1]': 'XY chart', 'gantt\n title Plan': 'Gantt chart',
  'mindmap\n root': 'Mind map', 'timeline\n 2026 : A': 'Timeline', 'journey\n title J': 'User journey', 'gitGraph\n commit': 'Git graph',
  'quadrantChart\n x-axis A': 'Quadrant chart', 'sankey-beta\n A,B,1': 'Sankey diagram', 'unknownThing\n x': 'Diagram', '': 'Diagram',
};
for (const [source, label] of Object.entries(cases)) assert.equal(M.diagramLabel(source), label, source);
assert.equal(M.diagramLabel('---\ntitle: Release flow\n---\nflowchart LR\n A-->B'), 'Flowchart: Release flow', 'front matter title');
assert.equal(M.diagramLabel('%% a comment\n\n  flowchart LR\n  accTitle: Sign-in steps\n A-->B'), 'Flowchart: Sign-in steps', 'comment, indent, and accTitle');
assert.equal(M.diagramLabel('pie title Pets adopted\n "Dogs" : 3'), 'Pie chart: Pets adopted', 'inline pie title');
assert.equal(M.diagramLabel('%%{init: {"theme":"dark"}}%%\nsequenceDiagram\n A->>B: x'), 'Sequence diagram', 'directive line');
assert.equal(M.diagramLabel('flowchart LR\n accTitle: ' + 'x'.repeat(300)).length <= 140, true, 'labels stay short');

// Errors: one short line.
assert.equal(M.shortError(new Error('Parse error on line 2:\n...A-- > B\n----^\nExpecting \'SEMI\'')), 'Parse error on line 2.');
assert.equal(M.shortError({ str: 'Lexical error on line 1. Unrecognized text.\n...' }), 'Lexical error on line 1. Unrecognized text.');
assert.equal(M.shortError(null), 'The diagram has a syntax error.');
assert.equal(M.shortError(new Error('x'.repeat(400))).length <= 160, true);

// Theme variables: Mermaid's base theme reads hex colours. Dark themes set darkMode.
const light = { ground: '#f1ebdf', surface: '#fbf8f2', surface2: '#f4efe4', ink: '#16130f', ink2: '#574f43', ink3: '#7d7262', line: '#ddd3bf', lineStrong: '#c4b69b',
  gilt: '#7a5808', vermilion: '#a8301d', indigo: '#33407a', verdigris: '#22604f', accent: '#33407a', font: 'Halden, system-ui, sans-serif', mono: 'Signal, monospace' };
const dark = { ...light, ground: '#100e0b', surface: '#1a1713', surface2: '#221e18', ink: '#f0e9db', ink2: '#b5ab98', line: '#322c24', lineStrong: '#4a4136', gilt: '#ddb55c', vermilion: '#ee6e56', indigo: '#9aa6ea', verdigris: '#7fcab3', accent: '#9aa6ea' };
const L = M.themeVariables(light, false), D = M.themeVariables(dark, true);
assert.equal(L.darkMode, false); assert.equal(D.darkMode, true);
assert.equal(L.background, light.surface); assert.equal(L.primaryTextColor, light.ink); assert.equal(D.primaryTextColor, dark.ink); assert.equal(L.lineColor, light.ink2);
assert.equal(L.fontFamily, light.font);
for (const v of [L, D]) for (const [k, x] of Object.entries(v)) if (!['darkMode', 'fontFamily', 'fontSize', 'xyChart', 'pieOpacity'].includes(k)) assert.match(x, /^#[0-9a-f]{6}$/i, k);
const pies = Array.from({ length: 8 }, (_, i) => L['pie' + (i + 1)]);
assert.equal(new Set(pies).size, 8, 'eight distinct pie colours'); assert.ok(!pies.includes(L.background), 'no slice has the background colour');
assert.equal(L.pieSectionTextColor, light.surface, 'light text on dark pigments'); assert.equal(D.pieSectionTextColor, dark.ground, 'dark text on light pigments');
assert.equal(L.xyChart.plotColorPalette.split(',').length, 8);
assert.equal(L.pieOpacity, '1', 'slices match the legend');
// Colour parsing: hex, short hex, rgb(), and unreadable values.
assert.equal(M.hex('#abc'), '#aabbcc'); assert.equal(M.hex('rgb(1, 2, 255)'), '#0102ff'); assert.equal(M.hex('rgba(16,19,15,0.5)'), '#10130f');
assert.equal(M.hex(' #A8301D '), '#a8301d'); assert.equal(M.hex('oklch(0.5 0.1 20)'), null); assert.equal(M.hex(''), null);
assert.equal(M.mix('#000000', '#ffffff', 0.5), '#808080');

// Image links: match only a registered image attachment with the same address.
const links = [
  { id: 'a', kind: 'attachment', path: 'img/flow.png', href: 'https://github.com/example/app/blob/abc/img/flow.png' },
  { id: 'b', kind: 'attachment', path: 'docs/report.pdf', href: 'https://github.com/example/app/blob/abc/docs/report.pdf' },
  { id: 'c', kind: 'document', path: 'docs/a.md', href: 'https://github.com/example/app/blob/abc/docs/a.md' },
  { id: 'd', kind: 'external', path: null, href: 'https://example.com/x.png' },
  { id: 'e', kind: 'attachment', path: 'img/My Chart.svg', href: 'https://github.com/example/app/blob/abc/img/My%20Chart.svg' },
];
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/img/flow.png').id, 'a');
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/img/flow.png?raw=1').id, 'a', 'query strings do not matter');
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/img/My%20Chart.svg').id, 'e');
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/docs/report.pdf'), null, 'not an image type');
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/docs/a.md'), null, 'documents are not images');
assert.equal(M.imageLink(links, 'https://example.com/x.png'), null, 'external images are never loaded');
assert.equal(M.imageLink(links, 'https://github.com/example/app/blob/abc/img/other.png'), null, 'unregistered paths are not loaded');
assert.equal(M.imageLink(undefined, 'x'), null);
assert.equal(M.isImagePath('a/b.JPEG'), true); assert.equal(M.isImagePath('a/b.svgz'), false); assert.equal(M.isImagePath(null), false);
console.log('PASS: diagram names, short errors, theme colours, and image link matching');
