/* Source excerpts only: no inferred health, delivery claims, or generated summaries. */
(function(root){
  function plain(value){return value.replace(/<!--[^]*?-->/g,'').replace(/<[^>]*>/g,'').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[*`]/g,'').replace(/^\s*[-+]\s+/gm,'').trim()}
  function lines(text){return text.split('\n').filter(l=>l.trim()&&!/^\s*(```|#{1,6}\s|<\/?(?:details|summary)|<!--|\|?[\s:|-]+\|\s*$)/.test(l)).map(plain).filter(Boolean)}
  function preview(key,text){
    text=(text||'').replace(/<!--[^]*?-->/g,'');
    if(key==='progress')text=text.split(/^#{1,6}\s+(?:Historical|History|Upcoming roadmap)/mi)[0];
    const blocks=[];let block={heading:'',body:[]},fence=false;
    for(const line of text.split('\n')){
      if(/^\s*```/.test(line))fence=!fence;
      const heading=!fence&&line.match(/^#{1,6}\s+(.+)/);
      if(heading){blocks.push(block);block={heading:plain(heading[1]),level:line.match(/^#+/)[0].length,body:[]}}else block.body.push(line);
    }
    blocks.push(block);
    const title=plain(text.match(/^#\s+(.+)/m)?.[1]||'');
    const items=[];
    const add=(label,value)=>{const clean=plain(value||'');if(clean)items.push({label,text:clean.slice(0,260)})};
    const section=pattern=>blocks.find(b=>b.level>1&&pattern.test(b.heading)&&excerpt(b));
    const excerpt=b=>b?lines(b.body.join('\n')).slice(0,3).join('\n'):'';
    const from=(label,pattern)=>add(label,excerpt(section(pattern)));
    if(key==='vision'){
      from('Purpose',/why|purpose|mission/i);from('For whom',/who|audience/i);from('Direction',/world|building|vision/i);
    }else if(key==='progress'){
      const latest=text.split(/^#{1,6}\s+(?:Historical|History|Upcoming roadmap)/mi)[0];
      add('Next action',latest.match(/^\s*(?:\*\*)?Next action:(?:\*\*)?\s*(.+)/mi)?.[1]);
      from('Shipped',/^shipped$|^delivered$/i);from('Gates / blockers',/gates|blockers|blocked/i);
      if(items.length<3)from('In progress',/in progress|up next|ready to/i);
    }else if(key==='brain'){
      from('Knowledge sources',/providers|destinations|sources/i);from('Access',/access|permissions/i);from('Save rules',/save|cleanup/i);
    }else if(key==='structure'){
      from('Project map',/^map$|tree|layout|repository|structure/i);from('Start here',/read before|entry|start/i);from('Commands',/commands/i);
    }else if(key==='changelog'){
      const release=blocks.find(b=>b.heading&&b.heading!==title&&b.body.some(l=>l.trim()));
      if(release)add(release.heading,excerpt(release));
      const body=release?.body.join('\n')||text;
      const links=[...body.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g)];
      if(links.length)add('Evidence links',links.map(m=>m[1]).slice(0,3).join(' · '));
    }else if(key==='techstack'){
      from('Tools & purpose',/tools|stack|dependencies|technologies/i);from('Connections',/runtime|integration|connections/i);
    }else if(key==='readme'){
      const intro=blocks.find(b=>b.heading===title);add('About',excerpt(intro));from('Get started',/get started|quick.?start|install|setup/i);
    }
    if(!items.length){const content=blocks.map(b=>excerpt(b)).find(Boolean);add('From the source',content)}
    return {title,items:items.slice(0,3)};
  }
  function matchesProject(project,query){const hay=[project.name,project.repo,project.root].join(' ').toLocaleLowerCase();return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>hay.includes(word))}
  const api={preview,matchesProject};if(typeof module!=='undefined')module.exports=api;else root.HorsemenPreview=api;
})(globalThis);
