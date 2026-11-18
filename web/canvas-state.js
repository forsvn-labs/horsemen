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
    return {visible:Boolean(count||canLoad||expanded||loading),disabled:Boolean(loading),expanded:Boolean(expanded),label:loading?'Loading…':count?count+' links':'Links'};
  }
  const api={visibleGraph,hitSelection,insideRect,pathToRoot,branchControl};if(typeof module!=='undefined')module.exports=api;else root.HorsemenCanvas=api;
})(globalThis);
