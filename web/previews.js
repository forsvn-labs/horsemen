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
      const tools=toolsTable(text).rows.map(row=>row[0]).filter(Boolean);
      if(tools.length)add('Tools',tools.join(' · '));else from('Tools & purpose',/tools|stack|dependencies|technologies/i);
      from('Connections',/runtime|integration|connections/i);
    }else if(key==='readme'){
      const intro=blocks.find(b=>b.heading===title);add('About',excerpt(intro));from('Get started',/get started|quick.?start|install|setup/i);
    }
    if(!items.length){const content=blocks.map(b=>excerpt(b)).find(Boolean);add('From the source',content)}
    return {title,items:items.slice(0,3)};
  }
  /* Facts the source states as "Label: value" above the first section. Nothing is inferred. */
  function facts(text){
    const out=[],intro=(text||'').replace(/<!--[^]*?-->/g,'').split(/^##\s/m)[0];
    for(const line of intro.split('\n')){
      const parts=line.trim().split(/\s+·\s+/).map(part=>plain(part).match(/^([A-Z][A-Za-z ]{1,22}):\s+(\S.*)$/));
      if(parts.every(m=>m&&m[2].length<=60&&!/^next action$/i.test(m[1])))for(const m of parts)out.push({label:m[1],value:m[2]});
    }
    return out.slice(0,6);
  }
  /* The opening text of a record, without its title and without the lines shown as facts. */
  function lede(text){
    const stated=new Set(facts(text).map(f=>f.label+': '));
    return (text||'').replace(/<!--[^]*?-->/g,'').split(/^##\s/m)[0].split('\n').filter(line=>!/^#\s/.test(line)&&!(stated.size&&line.trim().split(/\s+·\s+/).every(part=>[...stated].some(label=>plain(part).startsWith(label))))).join('\n').trim();
  }
  /* A section can hold half of a disclosure that wraps several sections, or be wrapped whole. Both hide content for no reason. */
  function tidy(body){
    const lines=(body||'').split('\n'),isOpen=l=>/^<details(?: open)?>\s*$/.test(l),isClose=l=>/^<\/details>\s*$/.test(l),isSummary=l=>/^<summary>.*<\/summary>\s*$/.test(l);
    let fence=false,depth=0,opens=0,closes=0,first=-1,last=-1,wraps=true;
    lines.forEach((line,i)=>{
      if(/^\s*```/.test(line))fence=!fence;
      if(!line.trim())return;
      if(first<0){first=i;if(fence||!isOpen(line))wraps=false}
      if(!fence&&isOpen(line)){opens++;depth++}
      else if(!fence&&isClose(line)){closes++;depth--;last=i}
      else last=-1;
      if(depth===0&&lines.slice(i+1).some(l=>l.trim()))wraps=false;
    });
    if(opens!==closes){fence=false;return lines.filter(line=>{if(/^\s*```/.test(line))fence=!fence;return fence||!(isOpen(line)||isClose(line)||isSummary(line))}).join('\n').trim()}
    if(wraps&&opens&&last>first){const inner=lines.slice(first+1,last);const at=inner.findIndex(l=>l.trim());if(at>=0&&isSummary(inner[at]))inner.splice(at,1);return inner.join('\n').trim()}
    return lines.join('\n').trim();
  }
  /* One level of subsections below a section. */
  function split(body){
    const lines=(body||'').split('\n');let fence=false,level=7;
    for(const line of lines){if(/^\s*```/.test(line))fence=!fence;const m=!fence&&line.match(/^(#{3,6})\s+\S/);if(m)level=Math.min(level,m[1].length)}
    const lead=[],subs=[];let current=null;fence=false;
    for(const line of lines){
      if(/^\s*```/.test(line))fence=!fence;
      const m=!fence&&line.match(/^(#{3,6})\s+(.+)/);
      if(m&&m[1].length===level){current={title:plain(m[2]),body:[]};subs.push(current)}else(current?current.body:lead).push(line);
    }
    return {lead:lead.join('\n').trim(),subs:subs.map(s=>({title:s.title,body:s.body.join('\n').trim()}))};
  }
  function shape(body){
    let fence=false,count=0;
    for(const line of body.split('\n')){if(/^\s*```/.test(line))fence=!fence;else if(!fence&&/^(?:[-*+]|\d+[.)])\s+\S/.test(line))count++}
    if(count)return {kind:'list',count};
    const rows=toolsTable(body).rows.length;
    return rows?{kind:'table',count:rows}:{kind:'prose',count:0};
  }
  /* Directory listings: the drawn guide, the path, and the note beside it. */
  function tree(text){
    return (text||'').split('\n').filter(line=>line.trim()).map(line=>{
      const guide=line.match(/^(?:[\s│├└─┬┼]|[|+`\\]-{2,}\s?|\|(?=\s))*/)[0],m=line.slice(guide.length).match(/^(.*?)(?:\s+(?:—|–|-|#|\/\/)\s+(.*)|\s{2,}(\S.*))?$/);
      return {guide,path:m[1].trim(),note:(m[2]||m[3]||'').trim()};
    });
  }
  function detail(key,text){
    const layouts={vision:'brief',progress:'board',brain:'library',structure:'map',changelog:'timeline',techstack:'tools',readme:'guide'};
    const sections=[];let current={title:'',body:''},fence=false;text=(text||'').replace(/<!--[^]*?-->/g,'');
    for(const line of text.split('\n')){
      if(/^\s*```/.test(line))fence=!fence;
      const heading=!fence&&line.match(/^##\s+(.+)/);
      if(heading){sections.push(current);current={title:plain(heading[1]),body:''}}else current.body+=line+'\n';
    }
    sections.push(current);
    const intro=sections.shift()?.body||'';
    return {layout:layouts[key]||'document',intro,sections:sections.map(s=>({title:s.title,body:tidy(s.body)})).filter(s=>s.body).map(s=>({...s,...shape(s.body)})),title:plain(text.match(/^#\s+(.+)/m)?.[1]||'')};
  }
  function toolsTable(body){
    const lines=body.split('\n'),cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(plain);
    for(let i=0;i<lines.length-1;i++){
      if(!lines[i].includes('|')||!cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c)))continue;
      const headers=cells(lines[i]),rows=[];i+=2;
      while(i<lines.length&&lines[i].includes('|')){rows.push(cells(lines[i]));i++}
      return {headers,rows};
    }
    return {headers:[],rows:[]};
  }
  function matchesProject(project,query){const hay=[project.name,project.repo,project.root].join(' ').toLocaleLowerCase();return query.trim().toLocaleLowerCase().split(/\s+/).every(word=>hay.includes(word))}
  const api={preview,matchesProject,detail,toolsTable,facts,lede,tidy,split,shape,tree};if(typeof module!=='undefined')module.exports=api;else root.HorsemenPreview=api;
})(globalThis);
