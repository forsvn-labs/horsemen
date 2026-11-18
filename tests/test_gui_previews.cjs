const assert = require('node:assert/strict');
const {preview, matchesProject} = require('../web/previews.js');
assert(matchesProject({name:'Atlas',repo:'team/space',root:'products/travel'},' TEAM travel '));
assert(!matchesProject({name:'Atlas',repo:'team/space',root:''},'other'));
assert(matchesProject({name:'Atlas',repo:'team/space',root:''},''));
const progress=preview('progress','# Progress\nUpdated: yesterday\nNext action: Invite pilot users\n## Shipped\n- Search reached the pilot\n## Gates\n- Owner review\n## Historical ships\n## Shipped\n- Old release');
assert(progress.items.some(i=>i.text.includes('Invite pilot users')));
assert(progress.items.some(i=>i.text.includes('Owner review')));
assert(!JSON.stringify(progress).includes('Old release'));
assert(preview('vision','# Vision\nOwner: Someone\n## Why we exist\nHelp people find a home\n## Who we build for\nRenters').items.some(i=>i.text==='Help people find a home'));
assert(preview('brain','# Brain\n## Providers\n- Research notebook\n## Access\nRead only').items.some(i=>i.text.includes('Research notebook')));
assert(preview('structure','# Structure\n## Map\n```text\napp/\n└── screens/\n```').items.some(i=>i.text.includes('app/')));
assert(preview('techstack','# Tech stack\n## Tools\n| Tool | Purpose |\n| --- | --- |\n| Python | Local reader |').items.some(i=>i.text.includes('Python')));
assert(preview('changelog','# Changelog\n## 2026-11-18\n- Delivered search\n[PR](https://github.com/example/app/pull/1)\n## 2025-01-01\n- Older').items.some(i=>i.text.includes('Delivered search')));
assert(!JSON.stringify(preview('changelog','# Changelog\n## New\n- Current\n## Old\n- Older')).includes('Older'));
assert(preview('readme','# App\n<!-- hidden -->\nAn easier start.').items.some(i=>i.text==='An easier start.'));
assert.equal(preview('vision','').items.length,0);

assert(!JSON.stringify(preview('progress','# Progress\nNext action: Review\n## Historical ships\n## Shipped\n- Old deployment')).includes('Old deployment'));
assert(preview('structure','# Structure\n## Map\napp/\n## Commands\nbun test').items.some(i=>i.label==='Project map'&&i.text==='app/'));
assert(preview('vision','# Vision\n## The world we are building\nA shared view.').items.some(i=>i.label==='Direction'));

assert(preview('structure','# Structure\nA project map.\n## Map\napp/\n## Commands\nbun test').items.some(i=>i.label==='Project map'&&i.text==='app/'));

assert.equal(typeof require('../web/previews.js').detail,'function');
const detail=require('../web/previews.js').detail;
const board=detail('progress','# Progress\nNext action: Review\n## In progress\n- Search\n## Gates\n- Approval');
assert.equal(board.layout,'board');assert.equal(board.sections[0].title,'In progress');assert(board.sections[0].body.includes('Search'));
assert.equal(detail('brain','# Brain').layout,'library');
assert.equal(detail('vision','# Vision').layout,'brief');
assert.equal(detail('structure','# Structure').layout,'map');
assert.equal(detail('changelog','# Changelog').layout,'timeline');
assert.equal(detail('techstack','# Tech stack').layout,'tools');
assert.equal(detail('readme','# Welcome').layout,'guide');
assert.equal(detail('document','# Research').layout,'document');
const tools=require('../web/previews.js').toolsTable;
assert.equal(typeof tools,'function');
assert.deepEqual(tools('| Tool | Purpose |\n| --- | --- |\n| Python | Reader |\n| Git | Source |'),{headers:['Tool','Purpose'],rows:[['Python','Reader'],['Git','Source']]});

console.log('PASS: project search, source previews, artifact layouts, and tool tables');
