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

const {arrange,overlaps}=require('../web/canvas-state.js');
const rect=(x,y,w=380,h=330)=>({x,y,w,h});
const core=[rect(0,0),rect(440,0),rect(0,390),rect(440,390)];
const kids=n=>Array.from({length:n},(_,i)=>({id:'k'+i,w:280,h:136}));
function check(fixed,groups){
  const placed=arrange(fixed,groups,32),all=[...fixed];
  for(const g of groups)for(const c of g.children){const p=placed.get(c.id);assert(p,'every child is placed: '+c.id);const r={x:p[0],y:p[1],w:c.w,h:c.h};for(const o of all)assert(!overlaps(r,o,0),c.id+' overlaps an existing card');all.push(r)}
  return placed;
}
assert(overlaps(rect(0,0),rect(379,329),0));assert(!overlaps(rect(0,0),rect(380,0),0));assert(overlaps(rect(0,0),rect(400,0),32),'gap counts as overlap');
// Left-column parents grow left, right-column parents grow right, away from the other records.
let placed=check(core,[{parent:core[2],children:kids(2)}]);assert(placed.get('k0')[0]+280<=0,'left parent expands leftward');
placed=check(core,[{parent:core[1],children:kids(2)}]);assert(placed.get('k0')[0]>=820,'right parent expands rightward');
// Two neighbouring parents expanded together must not collide with each other.
check(core,[{parent:core[0],children:kids(4)},{parent:core[2],children:kids(4).map(c=>({...c,id:'b'+c.id}))}]);
// Nested branches use the position their parent just received.
const nested=arrange(core,[{parent:core[2],children:[{id:'doc',w:280,h:136}]},{parentId:'doc',children:kids(3)}],32);
const doc=nested.get('doc');for(const id of ['k0','k1','k2'])assert(!overlaps({x:nested.get(id)[0],y:nested.get(id)[1],w:280,h:136},{x:doc[0],y:doc[1],w:280,h:136},0));
// Many links wrap into columns instead of one endless stack, and a crowded canvas still resolves.
placed=check(core,[{parent:core[0],children:kids(14)}]);assert(new Set([...placed.values()].map(p=>p[0])).size>1,'long lists wrap into columns');
const crowded=[...core];for(let x=-3000;x<3000;x+=300)for(let y=-2000;y<2000;y+=300)if(x<0||x>820||y<0||y>720)crowded.push(rect(x,y,250,250));
check(crowded,[{parent:core[0],children:kids(3)}]);
assert.equal(arrange(core,[{parent:core[0],children:[]}],32).size,0);
console.log('PASS: linked cards arrange without overlap');
