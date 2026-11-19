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
assert(preview('structure','# Structure\n## Map\n```text\napp/\n└── screens/\n```').items.some(i=>i.text==='screens/'));
// Cards show names, not raw table or tree text.
const brainCard=preview('brain','# Brain\n## Providers\n| Role | Provider | Access route |\n| --- | --- | --- |\n| Brain | Shared drive | connector |\n| Tracking | Issue board | CLI |');
assert.equal(brainCard.items.find(i=>i.label==='Knowledge sources').text,'Shared drive · Issue board','A provider table shows provider names');
const mapCard=preview('structure','# Structure\n## Map\n```text\nnorthwind/\n├── app/        workspace (start here)\n│   └── views/  views\n├── docs/       decisions\n└── tests/      checks\n```');
assert.equal(mapCard.items.find(i=>i.label==='Project map').text,'app/ · docs/ · tests/','A tree shows the top-level paths under the project folder');
assert.equal(preview('structure','# Structure\n## Map\n```text\napp/ — workspace\ndocs/ — decisions\n```').items[0].text,'app/ · docs/','A flat list shows its paths');
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

const toolNames=preview('techstack','# Tech stack\n## Tools\n| Tool | Purpose |\n| --- | --- |\n| Python | Local reader |\n| GitHub CLI | Reads records |');
assert.deepEqual(toolNames.items[0],{label:'Tools',text:'Python · GitHub CLI'},'Tool tables preview as names, not raw table rows');
console.log('PASS: project search, source previews, artifact layouts, and tool tables');

// Structured overviews: stated facts, tidy sections, and subsections.
const {facts, tidy, split, tree} = require('../web/previews.js');
assert.deepEqual(facts('# Progress\n\nUpdated: 2026-11-18 · Stage: pilot · Health: On track\n\n## Shipped\nOwner: Not a fact here'),[{label:'Updated',value:'2026-11-18'},{label:'Stage',value:'pilot'},{label:'Health',value:'On track'}]);
assert.deepEqual(facts('# Vision\nOwner: A fictional team\nA sentence: with a colon, but long enough that it is prose and not a label at all.\n## Why'),[{label:'Owner',value:'A fictional team'}]);
assert.deepEqual(facts('# Vision\nJust prose.'),[]);
assert.equal(tidy('<details open>\n<summary>Latest day</summary>\n\nNext action: Review'),'Next action: Review');
assert.equal(tidy('- Item\n\n</details>'),'- Item');
assert.equal(tidy('<details>\n<summary>History</summary>\n### 2026-11-13\n- Old\n</details>\n'),'### 2026-11-13\n- Old');
assert.equal(tidy('Intro\n<details>\n<summary>More</summary>\nHidden\n</details>\nOutro'),'Intro\n<details>\n<summary>More</summary>\nHidden\n</details>\nOutro','A disclosure inside a section stays');
assert.deepEqual(split('Lead text\n### Technical details\n| A | B |\n| --- | --- |\n| 1 | 2 |\n### Gates\n- Owner review\n#### Note\nDeeper'),{lead:'Lead text',subs:[{title:'Technical details',body:'| A | B |\n| --- | --- |\n| 1 | 2 |'},{title:'Gates',body:'- Owner review\n#### Note\nDeeper'}]});
assert.deepEqual(split('```\n### not a heading\n```'),{lead:'```\n### not a heading\n```',subs:[]});
const withCount=detail('progress','# Progress\n## Shipped\n- One\n- Two\n  - Nested\n## Notes\nProse only\n## Tools\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |');
assert.deepEqual(withCount.sections.map(s=>[s.kind,s.count]),[['list',2],['prose',0],['table',2]]);
assert.deepEqual(tree('app/ — operator workspace\n├── docs/   decisions\n│   └── notes.md # research\n\ntests/'),[{guide:'',path:'app/',note:'operator workspace'},{guide:'├── ',path:'docs/',note:'decisions'},{guide:'│   └── ',path:'notes.md',note:'research'},{guide:'',path:'tests/',note:''}]);
const {lede} = require('../web/previews.js');
assert.equal(lede('# Progress\n\nUpdated: 2026-11-18 · Stage: pilot\n\nA short note\nabout the record.\n## Shipped\n- One'),'A short note\nabout the record.');
assert.equal(lede('# Progress\nNext action: Review\n## Shipped'),'Next action: Review');
assert.equal(lede('## Only sections'),'');
console.log('PASS: stated facts, tidy sections, subsections, and directory trees');
