const assert=require('node:assert/strict');
const {visibleGraph,hitSelection,insideRect}=require('../web/canvas-state.js');
const roots=['brain','vision'];
const expanded=new Map([['brain',['shared','research']],['research',['decision']],['vision',['shared']],['shared',['shared-child']]]);
assert.deepEqual([...visibleGraph(roots,expanded)].sort(),['brain','decision','research','shared','shared-child','vision']);
expanded.delete('brain');
assert.deepEqual([...visibleGraph(roots,expanded)].sort(),['brain','shared','shared-child','vision']);
expanded.delete('vision');
assert.deepEqual([...visibleGraph(roots,expanded)].sort(),['brain','vision']);
expanded.set('brain',['research']);expanded.set('decision',['research']);
assert(visibleGraph(roots,expanded).has('decision')); // cycles terminate
assert.deepEqual([...hitSelection(new Set(['a','b']),'a',false)],['a','b']);
assert.deepEqual([...hitSelection(new Set(['a']),'b',true)],['a','b']);
assert.deepEqual([...hitSelection(new Set(['a','b']),'a',true)],['b']);
assert.deepEqual([...hitSelection(new Set(['a']),'c',false)],['c']);
assert(insideRect({x:10,y:10,w:20,h:20},{x:0,y:0,w:40,h:40}));
assert(!insideRect({x:10,y:10,w:20,h:20},{x:0,y:0,w:15,h:15}));
const {pathToRoot}=require('../web/canvas-state.js');
const nodes=new Map([['research',{parentId:'brain'}],['decision',{parentId:'research'}]]);
assert.deepEqual(pathToRoot('decision',nodes,['brain']),['brain','research','decision']);
nodes.set('research',{parentId:'decision'});assert.deepEqual(pathToRoot('decision',nodes,['brain']),[]);

const {branchControl}=require('../web/canvas-state.js');
assert.equal(branchControl({count:0,canLoad:false}).visible,false);
assert.deepEqual(branchControl({count:2,expanded:true}),{visible:true,disabled:false,expanded:true,label:'2 links'});
assert.equal(branchControl({canLoad:true}).label,'Links');
assert.equal(branchControl({canLoad:true,loading:true}).disabled,true);

console.log('PASS: branch visibility, selection, marquee bounds, and inline control states');
