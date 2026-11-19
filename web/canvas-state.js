/* Pure interaction rules shared by the canvas and its regression checks. */
(function(root){
  function visibleGraph(roots,expanded){
    const visible=new Set(roots),queue=[...roots];
    for(let i=0;i<queue.length;i++)for(const child of expanded.get(queue[i])||[]){if(!visible.has(child)){visible.add(child);queue.push(child)}}
    return visible;
  }
  function pathToRoot(id,nodes,roots){
    const path=[],seen=new Set();
    while(!seen.has(id)){seen.add(id);path.push(id);if(roots.includes(id))return path.reverse();const node=nodes.get(id);if(!node)return [];id=node.parentId}
    return [];
  }
  function hitSelection(selected,id,additive){
    if(additive){const next=new Set(selected);if(next.has(id))next.delete(id);else next.add(id);return next}
    return selected.has(id)?new Set(selected):new Set([id]);
  }
  function insideRect(node,rect){return node.x>=rect.x&&node.y>=rect.y&&node.x+node.w<=rect.x+rect.w&&node.y+node.h<=rect.y+rect.h}
  function branchControl({count=0,canLoad=false,expanded=false,loading=false}){
    return {visible:Boolean(count||canLoad||expanded||loading),disabled:Boolean(loading),expanded:Boolean(expanded),label:loading?'Loading…':count?count+(count===1?' link':' links'):'Links'};
  }
  function overlaps(a,b,gap=0){return a.x<b.x+b.w+gap&&a.x+a.w+gap>b.x&&a.y<b.y+b.h+gap&&a.y+a.h+gap>b.y}
  /* Places newly shown linked cards in blocks beside their parent. Cards in `fixed` never move.
     groups: [{parent:rect | parentId, children:[{id,w,h}]}], parents before their descendants. */
  function arrange(fixed,groups,gap=32){
    const placed=new Map(),taken=fixed.map(r=>({...r})),rects=new Map();
    const centre=fixed.length?fixed.reduce((sum,r)=>sum+r.x+r.w/2,0)/fixed.length:0;
    for(const group of groups){
      const parent=group.parent||rects.get(group.parentId),n=group.children.length;if(!parent||!n)continue;
      const cols=Math.ceil(n/5),rows=Math.ceil(n/cols),cw=Math.max(...group.children.map(c=>c.w)),ch=Math.max(...group.children.map(c=>c.h));
      const bw=cols*cw+(cols-1)*gap,bh=rows*ch+(rows-1)*gap,cx=parent.x+parent.w/2,cy=parent.y+parent.h/2,reach=gap*2;
      const sides=cx<=centre?['left','right','down','up']:['right','left','down','up'];
      const at=(side,ring,shift)=>side==='left'?{x:parent.x-reach-bw-ring*(cw+gap),y:cy-bh/2+shift*(ch+gap)}
        :side==='right'?{x:parent.x+parent.w+reach+ring*(cw+gap),y:cy-bh/2+shift*(ch+gap)}
        :side==='down'?{x:cx-bw/2+shift*(cw+gap),y:parent.y+parent.h+reach+ring*(ch+gap)}
        :{x:cx-bw/2+shift*(cw+gap),y:parent.y-reach-bh-ring*(ch+gap)};
      let spot=null,side=sides[0];
      search:for(let ring=0;ring<200;ring++)for(const candidate of sides)for(const shift of [0,1,-1,2,-2]){
        const origin=at(candidate,ring,shift),block={...origin,w:bw,h:bh};
        if(!taken.some(r=>overlaps(block,r,gap))){spot=origin;side=candidate;break search}
      }
      if(!spot)spot={x:Math.min(...taken.map(r=>r.x))-reach-bw,y:cy-bh/2}; // Beyond every card there is always room.
      group.children.forEach((child,i)=>{
        const col=Math.floor(i/rows),row=i%rows,rect={x:spot.x+(side==='left'?cols-1-col:col)*(cw+gap),y:spot.y+row*(ch+gap),w:child.w,h:child.h};
        placed.set(child.id,[rect.x,rect.y]);rects.set(child.id,rect);taken.push(rect);
      });
    }
    return placed;
  }
  const api={visibleGraph,hitSelection,insideRect,pathToRoot,branchControl,overlaps,arrange};if(typeof module!=='undefined')module.exports=api;else root.HorsemenCanvas=api;
})(globalThis);
