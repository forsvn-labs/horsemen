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
      /* A provider table becomes its provider names, not raw table text. */
      const sources=section(/providers|destinations|sources/i),table=sources&&toolsTable(sources.body.join('\n'));
      if(table&&table.rows.length){const at=Math.max(0,table.headers.findIndex(h=>/provider|service|tool|source/i.test(h)));add('Knowledge sources',table.rows.map(r=>plain(r[at]||'')).filter(Boolean).join(' · '))}
      else from('Knowledge sources',/providers|destinations|sources/i);
      from('Access',/access|permissions/i);from('Save rules',/save|cleanup/i);
    }else if(key==='structure'){
      /* A tree becomes its top-level paths: the children of the project folder, or every path of a flat list. */
      const map=section(/^map$|tree|layout|repository|structure/i),fence=map&&map.body.join('\n').match(/```[^\n]*\n([\s\S]*?)\n\s*```/);
      if(fence){const nodes=tree(fence[1]).map(n=>({...n,path:n.path.split(/\s+/)[0]})),depth=n=>n.guide.length,rooted=nodes.length>1&&!nodes[0].guide&&nodes.slice(1).every(n=>n.guide),rest=rooted?nodes.slice(1):nodes,top=Math.min(...rest.map(depth));add('Project map',rest.filter(n=>depth(n)===top).map(n=>n.path).join(' · '))}
      else from('Project map',/^map$|tree|layout|repository|structure/i);
      from('Start here',/read before|entry|start/i);from('Commands',/commands/i);
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
    }else if(key==='design-doc'){
      from('Overview',/^overview$/i);
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
  const views=artifactViews();
  const api={preview,matchesProject,detail,toolsTable,facts,lede,tidy,split,shape,tree,plain,lines,views};if(typeof module!=='undefined')module.exports=api;else{root.HorsemenPreview=api;root.HorsemenViews=views}

  /* Artifact views. Each record type has a model read from its source and a view built from that model.
     Views show source excerpts only. Every item keeps its source line, so a reader can check the original.
     The interface labels are plain words; record text is never rewritten or summarized. */
  function artifactViews(){
    const md=typeof module!=='undefined'?require('./markdown.js'):root.HorsemenMarkdown;
    const esc=md.escapeHTML,inline=(text,base)=>md.inline(text||'',base),block=(text,base)=>md.render(text||'',base);
    const RICH_LIMIT=300,LIST_LIMIT=500;

    /* ---- Dates ---- */
    function isoDate(value){
      const m=String(value??'').match(/(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/);if(!m)return null;
      const [y,mo,d]=[+m[1],+m[2],+m[3]],t=new Date(Date.UTC(y,mo-1,d));
      return t.getUTCFullYear()===y&&t.getUTCMonth()===mo-1&&t.getUTCDate()===d?m[0]:null;
    }
    function relative(value,now=Date.now()){
      const iso=isoDate(value);if(!iso)return null;
      const [y,m,d]=iso.split('-').map(Number),today=new Date(now);
      const days=Math.round((Date.UTC(y,m-1,d)-Date.UTC(today.getFullYear(),today.getMonth(),today.getDate()))/864e5),n=Math.abs(days);
      if(days===0)return {iso,text:'Today'};if(days===-1)return {iso,text:'Yesterday'};if(days===1)return {iso,text:'Tomorrow'};
      const [count,unit]=n<7?[n,'day']:n<30?[Math.round(n/7),'week']:n<365?[Math.max(1,Math.round(n/30.44)),'month']:[Math.round(n/365.25),'year'];
      const phrase=count+' '+unit+(count===1?'':'s');
      return {iso,text:days<0?phrase+' ago':'In '+phrase};
    }

    /* ---- Links ---- */
    function proofKind(href,base,text){
      const url=md.safeURL(String(href||''),base);if(!url)return null;
      const u=new URL(url),gh=u.hostname==='github.com'&&u.pathname.match(/^\/[^/]+\/[^/]+\/(pull|commit|releases|actions|issues|blob|tree)(?:\/([^/?#]+))?/);
      const label=String(text||'').replace(/[*`_]/g,'').trim();
      if(gh){
        const [,type,id='']=gh;
        if(type==='pull'&&/^\d+$/.test(id))return {kind:'pr',label:'PR #'+id,href:url};
        if(type==='commit'&&/^[0-9a-f]{7,40}$/i.test(id))return {kind:'commit',label:'Commit '+id.slice(0,7),href:url};
        if(type==='releases')return {kind:'release',label:label||'Release',href:url};
        if(type==='actions')return {kind:'checks',label:label||'Checks',href:url};
        if(type==='issues'&&/^\d+$/.test(id))return {kind:'issue',label:'Issue #'+id,href:url};
        if(type==='blob'||type==='tree')return {kind:'doc',label:label||decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1)),href:url};
      }
      if(!/^[a-z][a-z0-9+.-]*:|^\/\//i.test(String(href)))return {kind:'doc',label:label||decodeURIComponent(u.pathname.split('/').filter(Boolean).at(-1)||u.pathname),href:url};
      return {kind:'link',label:u.hostname.replace(/^www\./,''),href:url};
    }
    function linksIn(text,base){
      const out=[],seen=new Set(),body=String(text||'').replace(/`[^`]*`/g,'');
      for(const m of body.matchAll(/!?\[([^\]]*)\]\(((?:[^\s()]|\([^\s()]*\))+)\)|<?(https?:\/\/[^\s<>\]|)]+)>?/g)){
        const href=m[2]||m[3].replace(/[.,;:!?'"]+$/,''),proof=proofKind(href,base,m[1]);
        if(proof&&!seen.has(proof.href)){seen.add(proof.href);out.push(proof)}
      }
      return out;
    }
    const merge=(a,b)=>{const seen=new Set(a.map(p=>p.href));return a.concat(b.filter(p=>!seen.has(p.href)&&seen.add(p.href)))};
    function sourceLink(url,line){
      const safe=url&&md.safeURL(String(url));if(!safe||!line)return null;
      const plain=safe.split('#')[0];return plain+(plain.includes('?')?'&':'?')+'plain=1#L'+line;
    }
    function prRef(href){const m=String(href||'').match(/^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]|$)/);return m?{repo:m[1],number:m[2]}:null}

    /* ---- Source scan: lines, code fences, headings ---- */
    const strip=s=>String(s||'').replace(/<[^>]*>/g,'').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/\*\*|__|`/g,'').trim();
    const norm=s=>strip(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
    const FENCE=/^\s*(`{3,}|~{3,})\s*([\w+-]*)/,ITEM=/^(\s*)([-*+]|\d+[.)])\s+(.*)$/,LABEL=/^([A-Z][A-Za-z ]{1,24}):\s+(\S.*)$/;
    const indentOf=line=>line.match(/^\s*/)[0].replaceAll('\t','    ').length;
    const tableCells=line=>{const cells=line.trim().replace(/^\|/,'').replace(/(?<!\\)\|$/,'').split(/(?<!\\)\|/).map(c=>c.trim().replaceAll('\\|','|'));return cells};
    const divider=line=>line!==undefined&&line.includes('-')&&tableCells(line).every(c=>/^:?-{3,}:?$/.test(c));
    const closes=(line,open)=>{const t=line.trim();return t.length>=open.length&&t[0]===open[0]&&/^(`+|~+)$/.test(t)};
    function scan(text){
      const clean=String(text||'').replace(/\r\n?/g,'\n').replace(/<!--[^]*?-->/g,m=>m.replace(/[^\n]/g,''));
      const lines=clean.split('\n'),fenced=new Array(lines.length).fill(false),heads=[];let open=null;
      lines.forEach((line,i)=>{
        if(open){fenced[i]=true;if(closes(line,open))open=null;return}
        const f=line.match(FENCE);if(f){open=f[1];fenced[i]=true;return}
        const h=line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);if(h)heads.push({level:h[1].length,title:strip(h[2]),line:i});
      });
      const title=heads.find(h=>h.level===1)?.title||'';
      return {lines,fenced,heads,title,text:clean};
    }
    /* Blocks between two line indexes: items, paragraphs, label lines, tables, and code. Lines are 1-based in the output. */
    function blocks(doc,s,e){
      const {lines,fenced}=doc,out=[];
      for(let i=s;i<e;i++){
        const line=lines[i];
        if(fenced[i]){
          const f=line.match(FENCE),code=[];let j=i+1;
          while(j<e&&!(fenced[j]&&closes(lines[j],f?f[1]:'```')))code.push(lines[j++]);
          out.push({type:'code',lang:f?.[2]||'',text:code.join('\n'),line:i+1,raw:lines.slice(i,j+1).join('\n')});i=j;continue;
        }
        if(!line.trim()||/^\s*<\/?(details|summary)\b/i.test(line)||/^#{1,6}\s/.test(line))continue;
        if(line.includes('|')&&divider(lines[i+1])){
          const headers=tableCells(line),rows=[];let j=i+2;
          while(j<e&&!fenced[j]&&lines[j].includes('|')&&lines[j].trim()&&!divider(lines[j+1])){rows.push({cells:tableCells(lines[j]),line:j+1});j++}
          out.push({type:'table',headers:headers.map(strip),rows,line:i+1,raw:lines.slice(i,j).join('\n')});i=j-1;continue;
        }
        const item=line.match(ITEM);
        if(item&&!/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)){
          const base=indentOf(line),text=[item[3].trim()],body=[];let j=i+1,gap=false;
          for(;j<e;j++){
            const next=lines[j];
            if(fenced[j]&&!body.length&&indentOf(next)<=base)break;
            if(!next.trim()){gap=true;continue}
            const ind=indentOf(next);
            if(ind<=base&&(ITEM.test(next)||gap||/^#{1,6}\s|^\s*<\/?(details|summary)/.test(next)||next.includes('|')&&divider(lines[j+1])||LABEL.test(next.trim())))break;
            if(ind>base&&(ITEM.test(next)||body.length||gap||fenced[j]))body.push(next.slice(Math.min(ind,base+2)));else text.push(next.trim());
            gap=false;
          }
          while(j>i+1&&!lines[j-1].trim())j--;
          out.push({type:'item',ordered:/\d/.test(item[2]),text:text.join(' '),body:body.join('\n'),line:i+1,raw:lines.slice(i,j).join('\n')});i=j-1;continue;
        }
        const flat=line.trim().replace(/^\*\*([^*]+?):\*\*/,'$1:'),label=flat.match(LABEL);
        if(label&&!/^https?$/i.test(label[1])){out.push({type:'label',label:label[1].trim(),value:label[2].trim(),line:i+1,raw:line});continue}
        const para=[line.trim()];let j=i+1;
        while(j<e&&lines[j].trim()&&!fenced[j]&&!ITEM.test(lines[j])&&!/^#{1,6}\s|^\s*<\/?(details|summary)/.test(lines[j])&&!LABEL.test(lines[j].trim().replace(/^\*\*([^*]+?):\*\*/,'$1:'))&&!(lines[j].includes('|')&&divider(lines[j+1])))para.push(lines[j++].trim());
        out.push({type:'para',text:para.join('\n'),line:i+1,raw:lines.slice(i,j).join('\n')});i=j-1;
      }
      return out;
    }
    /* Each heading with its direct body (up to the next heading of any level) and its whole body (up to a heading at its level or higher). */
    function sections(doc,from=0,to=doc.lines.length){
      const heads=doc.heads.filter(h=>h.line>=from&&h.line<to);
      return heads.map((h,k)=>{
        const end=heads.slice(k+1).find(n=>n.level<=h.level)?.line??to;
        return {...h,s:h.line+1,direct:heads[k+1]?.line??to,e:end,raw:tidy(doc.lines.slice(h.line+1,end).join('\n'))};
      });
    }
    const introEnd=doc=>doc.heads.find(h=>h.level>1)?.line??doc.lines.length;
    function intro(doc){
      const parts=blocks(doc,0,introEnd(doc)).filter(b=>b.type==='para'||b.type==='item');
      return parts.length?{text:parts.map(b=>b.raw.trim()).join('\n\n'),line:parts[0].line}:null;
    }
    /* "**Name** (date): text", "**Name:** text", or plain text. A date that is not ISO stays as written. */
    function entry(b,base){
      let text=b.text,name=null,when=null,done=null;
      const task=text.match(/^\[([ xX])\]\s+(.*)$/s);if(task){done=task[1]!==' ';text=task[2]}
      const colon=text.match(/^\*\*([^*]+?):\*\*\s*(.*)$/s),named=!colon&&text.match(/^\*\*(.+?)\*\*\s*(?:\(([^)]*)\))?\s*([:—–]|-(?=\s))?\s*(.*)$/s);
      if(colon){name=colon[1].trim();text=colon[2]}
      else if(named&&(named[2]!==undefined||named[3]||!named[4])){name=named[1].trim();when=named[2]??null;text=named[4]}
      const date=isoDate(when),lead=when&&when.match(/^\s*(started|target|since|due|from|until|by|planned|updated)\b/i);
      return {name,text:text.trim(),body:b.body||'',date,dateLabel:date&&lead?lead[1][0].toUpperCase()+lead[1].slice(1).toLowerCase():null,when:date?null:(when?.trim()||null),line:b.line,done,proof:linksIn(b.text+'\n'+(b.body||''),base),evidence:null};
    }
    const itemsOf=(bs,base)=>bs.filter(b=>b.type==='item').map(b=>entry(b,base));
    const textOf=(bs,base)=>bs.filter(b=>b.type==='item'||b.type==='para').map(b=>b.type==='item'?entry(b,base):{name:null,text:b.text,body:'',date:null,dateLabel:null,when:null,line:b.line,done:null,proof:linksIn(b.text,base),evidence:null});
    const col=(headers,re)=>headers.findIndex(h=>re.test(h));

    /* ---- PROGRESS ---- */
    const LANES=[['shipped',/^(shipped|delivered|done|completed?|released|what shipped)\b/i],['progress',/^(in progress|doing|ongoing|current work|ready to ship|ready|active|building)\b/i],['next',/^(up next|next( steps| up)?|planned|to ?do|queued|coming up)\b/i],['attention',/^(blocked|blockers?|needs? (a )?decisions?|decisions? needed|gates?|risks?|waiting|open issues)\b/i]];
    const laneOf=title=>LANES.find(([,re])=>re.test(title))?.[0]||null;
    const startsWithDate=title=>/^\W*\d{4}-\d{2}-\d{2}/.test(title)&&isoDate(title);
    function newDay(date,latest,line){return {date,latest,line,lanes:{shipped:[],progress:[],next:[],attention:[]},decisions:[],notes:[],orphanProof:[],tracking:null,evidence:[],ships:[]}}
    function readDay(doc,day,s,e,direct,base,model){
      const heads=doc.heads.filter(h=>h.line>=s&&h.line<e);
      const segs=[{kind:direct,title:'',s,e:heads[0]?.line??e}].concat(heads.map((h,k)=>{
        const lane=laneOf(h.title);
        return {kind:lane||(/^decisions?\b/i.test(h.title)?'decisions':/^(technical details|evidence|proof|verification)\b|evidence$/i.test(h.title)?'evidence':'note'),title:h.title,s:h.line+1,e:heads[k+1]?.line??e,line:h.line+1};
      }));
      for(const seg of segs){
        const note=[];
        for(const b of blocks(doc,seg.s,seg.e)){
          if(b.type==='label'){
            if(/^next action$/i.test(b.label)){if(!model.next)model.next={text:b.value,line:b.line};continue}
            if(/^(gates?|blocked|blockers?|risks?)$/i.test(b.label)){day.lanes.attention.push({name:b.label,text:b.value,body:'',date:null,dateLabel:null,when:null,line:b.line,done:null,proof:linksIn(b.value,base),evidence:null});continue}
            if(/^task tracking$/i.test(b.label)){day.tracking=b.value;continue}
          }
          if(b.type==='table'){
            const h=b.headers,proofCol=col(h,/evidence|proof/i),dateCol=col(h,/^date$/i);
            if(proofCol>=0&&dateCol>=0){const nameCol=h.findIndex((x,k)=>k!==proofCol&&k!==dateCol);for(const r of b.rows){const date=isoDate(r.cells[dateCol]);if(!date&&!r.cells[nameCol])continue;day.ships.push({date,item:{name:strip(r.cells[nameCol]||''),text:'',body:'',date,dateLabel:null,when:null,line:r.line,done:null,proof:linksIn(r.cells[proofCol],base),evidence:null}})}continue}
            if(proofCol>=0){const nameCol=proofCol===0?1:0;for(const r of b.rows){const text=r.cells[proofCol]||'';day.evidence.push({name:strip(r.cells[nameCol]||''),key:norm(r.cells[nameCol]||''),text,proof:linksIn(text,base),line:r.line,used:false})}continue}
          }
          const lane=seg.kind in day.lanes?seg.kind:null;
          if(lane&&(b.type==='item'||b.type==='para'||b.type==='label'))day.lanes[lane].push(...textOf([b.type==='label'?{...b,type:'para',text:b.raw.trim()}:b],base));
          else if(seg.kind==='decisions'&&b.type!=='code'&&b.type!=='table')day.decisions.push(...textOf([b.type==='label'?{...b,type:'para',text:b.raw.trim()}:b],base));
          else note.push(b.raw);
        }
        if(note.length)day.notes.push({title:seg.title,text:note.join('\n\n'),line:seg.line||(seg.s+1)});
      }
    }
    function attachEvidence(day){
      const find=key=>day.evidence.find(ev=>ev.key===key)||(key.length>=4&&day.evidence.find(ev=>ev.key.length>=4&&(ev.key.startsWith(key)||key.startsWith(ev.key))));
      for(const lane of Object.values(day.lanes))for(const item of lane){
        if(!item.name)continue;const ev=find(norm(item.name));if(!ev)continue;
        ev.used=true;item.evidence={text:ev.text,line:ev.line};item.proof=merge(item.proof,ev.proof);
      }
      day.orphanProof=day.evidence.filter(ev=>!ev.used&&(ev.proof.length||ev.text.trim())).map(ev=>({name:ev.name,text:ev.text,proof:ev.proof,line:ev.line}));
    }
    const count=day=>Object.values(day.lanes).reduce((n,l)=>n+l.length,0);
    function progress(text,base){
      const doc=scan(text),{heads,lines}=doc,model={title:doc.title,next:null,days:[],roadmap:[],empty:true};
      const marker=re=>heads.find(h=>h.level<=2&&re.test(h.title));
      const hist=marker(/^(historical|history|past|archive|earlier|log)\b/i),road=marker(/^(upcoming|roadmap|future)\b/i),latest=marker(/^latest\b/i);
      const bounds=[hist,road].filter(Boolean).map(h=>h.line).sort((a,b)=>a-b),endOf=start=>bounds.find(b=>b>=start)??lines.length;
      const stated=facts(doc.text),updated=isoDate(stated.find(f=>/^updated$/i.test(f.label))?.value);
      const first=introEnd(doc);
      for(const b of blocks(doc,0,first))if(b.type==='label'&&/^next action$/i.test(b.label)&&!model.next)model.next={text:b.value,line:b.line};
      const days=[];
      const split=(s,e,direct,latestRegion)=>{
        const dated=heads.filter(h=>h.line>=s&&h.line<e&&startsWithDate(h.title)),level=Math.min(...dated.map(h=>h.level));
        const marks=dated.filter(h=>h.level===level);
        if(latestRegion||marks.length){
          const lead=marks[0]?.line??e;
          if(latestRegion){
            const summary=lines.slice(s,lead).find(l=>/<summary>/i.test(l)),date=isoDate(summary)||isoDate(latest?.title)||(marks.length?null:updated);
            const day=newDay(date,true,s+1);readDay(doc,day,s,lead,null,base,model);if(count(day)||day.ships.length||!marks.length)days.push(day);
          }else{const day=newDay(null,false,s+1);readDay(doc,day,s,lead,'note',base,model);if(day.ships.length||count(day))days.push(day)}
        }
        marks.forEach((h,k)=>{const day=newDay(isoDate(h.title),false,h.line+1);readDay(doc,day,h.line+1,marks[k+1]?.line??e,'shipped',base,model);days.push(day)});
      };
      const latestStart=latest?latest.line+1:first;
      split(latestStart,endOf(latestStart),null,true);
      if(hist)split(hist.line+1,endOf(hist.line+1),null,false);
      if(road)for(const b of blocks(doc,road.line+1,endOf(road.line+1)))if(b.type==='item'){
        const m=b.text.match(/^(?:\*\*)?(Now|Next|Soon|Later|Idea|Maybe)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/is);
        model.roadmap.push({tier:m?m[1][0].toUpperCase()+m[1].slice(1).toLowerCase():'Planned',text:m?m[2].trim():b.text,line:b.line,proof:linksIn(b.text,base)});
      }
      /* History tables add dated ships. A day with that date takes them; other dates become their own day. */
      for(const day of days.slice())for(const ship of day.ships){
        const home=days.find(d=>d.date&&d.date===ship.date)||(()=>{const d=newDay(ship.date,false,ship.item.line);days.push(d);return d})();
        home.lanes.shipped.push(ship.item);
      }
      for(const day of days)attachEvidence(day);
      const kept=days.filter(d=>count(d)||d.notes.length||d.decisions.length||d.orphanProof.length);
      const [now,...rest]=kept;
      rest.sort((a,b)=>(b.date||'').localeCompare(a.date||''));
      model.days=now?(now.latest?[now,...rest]:[now,...rest].sort((a,b)=>(b.date||'').localeCompare(a.date||''))):[];
      if(model.days.length&&!model.days.some(d=>d.latest))model.days[0].latest=true;
      for(const d of model.days){delete d.evidence;delete d.ships}
      model.empty=!model.days.some(count)&&!model.roadmap.length;
      return model;
    }

    /* ---- CHANGELOG ---- */
    function changelog(text,base){
      const doc=scan(text),levels=doc.heads.filter(h=>h.level>1).map(h=>h.level),level=Math.min(...levels);
      const releases=doc.heads.filter(h=>h.level===level).map((h,k,all)=>{
        const e=all[k+1]?.line??doc.lines.length,subs=doc.heads.filter(x=>x.line>h.line&&x.line<e),entries=[];
        [{title:'',s:h.line+1,e:subs[0]?.line??e},...subs.map((x,j)=>({title:x.title,s:x.line+1,e:subs[j+1]?.line??e}))].forEach(seg=>{
          for(const b of blocks(doc,seg.s,seg.e)){
            if(b.type==='table'){for(const r of b.rows)entries.push({group:seg.title,text:r.cells.filter(Boolean).join(' · '),proof:linksIn(r.cells.join(' '),base),line:r.line});continue}
            if(b.type==='code')continue;
            const text=b.type==='item'?b.text:b.type==='label'?b.raw.trim():b.text;
            entries.push({group:seg.title,text,body:b.body||'',proof:linksIn(text+'\n'+(b.body||''),base),line:b.line});
          }
        });
        return {title:h.title,version:h.title.match(/(?<![\w.-])v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?(?![\w.])/)?.[0]||null,date:isoDate(h.title),line:h.line+1,entries};
      });
      return {title:doc.title,lede:intro(doc),releases,empty:!releases.length};
    }

    /* ---- VISION ---- */
    const ROLES=[['why',/why|purpose|mission|problem/i],['world',/world|future|picture|vision/i],['who',/^who|audience|for whom|customers|users/i],['beliefs',/believe|principles|values|convictions/i],['path',/how we get there|path|stages|milestones|plan/i],['never',/never|will not|won.t|refuse|non-goals|boundar/i],['sustain',/sustain|business model|funding|economics/i],['bets',/^bets?\b|assumptions|hypothes/i],['questions',/questions|unknowns/i],['changes',/direction changes|changes|decisions/i]];
    function vision(text,base){
      const doc=scan(text),model={title:doc.title,declaration:intro(doc),sections:{},beliefs:[],path:[],never:[],bets:[],questions:[],changes:[],other:[],empty:true};
      for(const s of sections(doc).filter(s=>s.level===2)){
        const role=ROLES.find(([key,re])=>!model.sections[key]&&re.test(s.title))?.[0],bs=blocks(doc,s.s,s.e);
        if(!role){model.other.push({title:s.title,raw:s.raw,line:s.line+1});continue}
        model.sections[role]={title:s.title,raw:s.raw,line:s.line+1};model.empty=false;
        if(['beliefs','never','bets','questions'].includes(role))model[role]=textOf(bs,base);
        if(role==='path')model.path=textOf(bs,base).map(item=>{const m=item.text.match(/^(?:\*\*)?(Now|Next|Then|Later|Soon|First|Today)(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*)$/is);return {...item,stage:m?m[1][0].toUpperCase()+m[1].slice(1).toLowerCase():null,text:m?m[2]:item.text}});
        if(role==='changes')model.changes=textOf(bs,base).map(item=>({...item,date:item.date||isoDate(item.text)}));
      }
      return model;
    }

    /* ---- BRAIN ---- */
    function brain(text,base){
      const doc=scan(text),model={title:doc.title,lede:intro(doc),sourcesNote:null,providers:[],shelves:[],steps:[],saves:[],rules:[],questions:[],other:[],empty:true};
      const cards=(table)=>{
        const h=table.headers,role=col(h,/^role$/i),prov=col(h,/provider|service|tool|source/i),ver=col(h,/verified/i),title=prov>=0?prov:0;
        return table.rows.map(r=>({title:strip(r.cells[title]||''),role:role>=0?strip(r.cells[role]||''):null,verified:ver>=0?isoDate(r.cells[ver]):null,hasVerified:ver>=0,fields:h.map((label,k)=>({label,value:r.cells[k]||''})).filter((f,k)=>k!==title&&k!==role&&k!==ver&&f.value),line:r.line}));
      };
      for(const s of sections(doc).filter(s=>s.level===2)){
        const bs=blocks(doc,s.s,s.e),tables=bs.filter(b=>b.type==='table'),t=s.title;
        if(/provider|destination|source|where it lives|tools/i.test(t)&&!model.providers.length){
          const prose=bs.filter(b=>b.type==='para'||b.type==='label');if(prose.length)model.sourcesNote={text:prose.map(b=>b.raw).join('\n\n'),line:prose[0].line};
          model.providers=tables.length?tables.flatMap(cards):itemsOf(bs,base).map(item=>({title:strip(item.name||item.text.match(/\[([^\]]+)\]\(/)?.[1]||item.text.split(/[:.]/)[0]),role:null,verified:null,hasVerified:false,fields:[],text:item.text,line:item.line,proof:[]}));
        }else if(/what lives|knowledge/i.test(t)&&tables.length)model.shelves=tables.flatMap(cards);
        else if(/retrieve|find|look/i.test(t))model.steps=textOf(bs,base);
        else if(/^save/i.test(t)&&tables.length)model.saves={title:t,line:s.line+1,cards:tables.flatMap(cards),notes:textOf(bs,base)};
        else if(/access|cleanup|permission|rules|never/i.test(t))model.rules.push({title:t,items:textOf(bs,base),raw:s.raw,line:s.line+1});
        else if(/questions/i.test(t))model.questions=textOf(bs,base);
        else{model.other.push({title:t,raw:s.raw,line:s.line+1});continue}
      }
      model.empty=!model.providers.length&&!model.sourcesNote&&!model.shelves.length&&!model.steps.length&&!model.rules.length;
      return model;
    }

    /* ---- STRUCTURE ---- */
    const TAG=/\(([^()]*(?:start here|edit|generated|do not|history|entry)[^()]*)\)\s*$/i;
    function treeNodes(code,line,repoBase){
      const rows=tree(code),root=rows.length>1&&!rows[0].guide&&rows.slice(1).every(r=>r.guide);const stack=[];
      return rows.map((r,k)=>{
        const depth=root&&k===0?0:Math.round(r.guide.replace(/\t/g,'    ').length/4),tag=r.note.match(TAG);
        const parent=depth>0?stack[depth-1]:null,full=root&&k===0?'':(parent?parent.full:'')+r.path;
        const node={guide:r.guide,path:r.path,note:tag?r.note.slice(0,tag.index).trim():r.note,tags:tag?[tag[1].trim()]:[],depth,full,dir:r.path.endsWith('/'),line:line+1+k,href:null};
        stack[depth]=node;stack.length=depth+1;
        if(repoBase&&full&&!/[<>*{}\s]|\.\.\./.test(full)){const u=md.safeURL(full,repoBase);if(u&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(u))node.href=node.dir?u.replace('/blob/','/tree/'):u}
        return node;
      });
    }
    function flow(code){
      const labels={},edges=[];const label=(id,text)=>{if(text)labels[id]=strip(text.replace(/<br\s*\/?>/gi,' · ').replace(/^["(\[{]+|["\])}]+$/g,''))};
      for(const line of code.split('\n')){
        const parts=line.trim().split(/\s*-{2,}>(?:\|[^|]*\|)?\s*|\s*-\.->\s*|\s*==>\s*/);if(parts.length<2)continue;
        const ids=parts.map(p=>{const m=p.match(/^([\w-]+)\s*(?:\[\(?|\(\[?|\{)?(.*?)(?:\)?\]|\]?\)|\})?$/);if(!m)return null;label(m[1],m[2]);return m[1]});
        for(let k=0;k<ids.length-1;k++)if(ids[k]&&ids[k+1])edges.push([ids[k],ids[k+1]]);
      }
      return edges.map(([a,b])=>[labels[a]||a,labels[b]||b]);
    }
    function structure(text,base){
      const doc=scan(text),model={title:doc.title,lede:intro(doc),trees:[],flows:[],commands:[],tables:[],readFirst:[],other:[],empty:true};
      const add=(cmd,line)=>{cmd=cmd.replace(/^\$\s+/,'').trim();if(cmd&&!cmd.startsWith('#')&&!model.commands.some(c=>c.text===cmd))model.commands.push({text:cmd,line})};
      const repoBase=base&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(base)?base:null;
      let brainZone=null;
      for(const s of sections(doc)){
        if(s.level===2)brainZone=/^brain\b/i.test(s.title)?s:null;
        const bs=blocks(doc,s.s,s.direct),inBrain=!!brainZone&&s!==brainZone;
        for(const b of bs){
          if(b.type==='code'&&/^mermaid$/i.test(b.lang)){const edges=flow(b.text);if(edges.length)model.flows.push({title:s.title,edges,line:b.line})}
          else if(b.type==='code'&&/^(text|tree|)$/i.test(b.lang)&&(/[├└│]/.test(b.text)||/^map$|tree|layout|structure/i.test(s.title)||inBrain)&&!/commands/i.test(s.title)){model.trees.push({title:s.title,nodes:treeNodes(b.text,b.line,inBrain?null:repoBase),line:b.line,brain:inBrain})}
          else if(/commands/i.test(s.title)&&b.type==='code'){b.text.split('\n').forEach((l,k)=>add(l,b.line+1+k))}
          else if(/commands/i.test(s.title)&&b.type==='para'){const spans=[...b.text.matchAll(/`([^`]+)`/g)];if(spans.length)spans.forEach(m=>add(m[1],b.line));else b.text.split('\n').forEach((l,k)=>add(l,b.line+k))}
          else if(/commands/i.test(s.title)&&b.type==='item'){const spans=[...b.text.matchAll(/`([^`]+)`/g)];if(spans.length)spans.forEach(m=>add(m[1],b.line));else add(b.text,b.line)}
          else if(b.type==='label'&&/^commands$/i.test(b.label)){for(const m of b.value.matchAll(/`([^`]+)`/g))add(m[1],b.line)}
          else if(b.type==='table'){model.tables.push({title:s.title,headers:b.headers,rows:b.rows,line:b.line})}
        }
        if(/read before|start here|entry|first/i.test(s.title)){model.readFirst=textOf(bs,base);continue}
        const rest=bs.filter(b=>!(b.type==='code'&&(/^mermaid$/i.test(b.lang)||model.trees.some(t=>t.line===b.line)))&&b.type!=='table'&&!(b.type==='label'&&/^commands$/i.test(b.label))&&!/commands/i.test(s.title));
        if(rest.length&&!(s===brainZone&&!rest.some(b=>b.type!=='para'||!/BRAIN\.md/.test(b.text))))model.other.push({title:s.title,raw:rest.map(b=>b.raw).join('\n\n'),line:s.line+1,level:s.level});
      }
      model.empty=!model.trees.length&&!model.commands.length&&!model.flows.length;
      return model;
    }

    /* ---- TECHSTACK ---- */
    function techstack(text,base){
      const doc=scan(text),stated=facts(doc.text),model={title:doc.title,lede:intro(doc),checked:isoDate(stated.find(f=>/^checked$/i.test(f.label))?.value),groups:[],gaps:[],evidence:[],other:[],empty:true};
      for(const s of sections(doc).filter(s=>s.level===2)){
        const bs=blocks(doc,s.s,s.e),tables=bs.filter(b=>b.type==='table');
        if(tables.length){
          const cards=tables.flatMap(t=>t.rows.map(r=>{
            const first=strip(r.cells[0]||''),v=first.match(/(?:^|\s)v?(\d+(?:\.[\dx]+)*\+?)(?=\s|$|\))/);
            const fields=t.headers.slice(1).map((label,k)=>({label,value:r.cells[k+1]||''})).filter(f=>f.value);
            return {name:v?first.replace(v[0],' ').replace(/\s+/g,' ').trim():first,version:v?v[1]:null,unknown:fields.some(f=>/^(unknown|not used)\b/i.test(strip(f.value))),fields,line:r.line};
          })).filter(c=>c.name);
          const notes=bs.filter(b=>b.type!=='table').map(b=>b.raw).join('\n\n');
          model.groups.push({title:s.title,cards,notes,line:s.line+1});
        }else if(/gaps|to verify|unknown/i.test(s.title))model.gaps=textOf(bs,base);
        else if(/^evidence/i.test(s.title))model.evidence=textOf(bs,base);
        else model.other.push({title:s.title,raw:s.raw,line:s.line+1});
      }
      model.empty=!model.groups.some(g=>g.cards.length);
      return model;
    }

    /* ---- README ---- */
    function readme(text,base){
      const doc=scan(text),model={title:doc.title,pitch:intro(doc),gets:[],steps:[],commands:[],records:[],other:[],empty:true};
      const add=(cmd,line)=>{cmd=cmd.replace(/^\$\s+/,'').trim();if(cmd&&!cmd.startsWith('#')&&!model.commands.some(c=>c.text===cmd))model.commands.push({text:cmd,line})};
      for(const s of sections(doc).filter(s=>s.level===2)){
        const bs=blocks(doc,s.s,s.e);
        if(/what you get|features|capabilit/i.test(s.title))model.gets=textOf(bs,base);
        else if(/install|^use\b|usage|get(ting)? started|quick ?start|setup|access|run/i.test(s.title)){
          const step={title:s.title,raw:s.raw,line:s.line+1,commands:[]};
          for(const b of bs){if(b.type==='code'&&!/^(json|ya?ml|toml|text|markdown|md)$/i.test(b.lang))b.text.split('\n').forEach((l,k)=>add(l,b.line+1+k));else if(b.type!=='code')for(const m of (b.text||b.raw).matchAll(/`([^`]+)`/g))if(/\s/.test(m[1]))add(m[1],b.line)}
          model.steps.push(step);
        }else if(/project records|^records|documents/i.test(s.title))model.records=textOf(bs,base);
        else model.other.push({title:s.title,raw:s.raw,line:s.line+1});
      }
      model.empty=!model.gets.length&&!model.steps.length;
      return model;
    }

    /* ---- Compact rows for every type ---- */
    const excerpt=t=>strip(String(t||'').split('\n').find(l=>l.trim()&&!/^\s*(```|\||<)/.test(l))||'').replace(/^[-*+]\s+|^\d+[.)]\s+/,'').slice(0,240);
    function sectionRows(doc){
      const list=sections(doc).filter(s=>s.level>1).map(s=>({group:'',label:s.title,text:excerpt(s.raw),line:s.line+1,proof:[]}));
      return list.length?list:blocks(doc,0,doc.lines.length).filter(b=>b.type==='para'||b.type==='item').map(b=>({group:'',label:excerpt(b.text),text:'',line:b.line,proof:[]}));
    }
    const LANE_LABEL={shipped:'Shipped',progress:'In progress',next:'Up next',attention:'Needs attention'};
    function rows(key,text,base){
      let out=[];
      if(key==='progress'){
        const m=progress(text,base);
        for(const d of m.days)for(const [lane,items] of Object.entries(d.lanes))for(const i of items)out.push({group:dayLabel(d),date:i.date||null,groupDate:d.date,status:lane,label:strip(i.name||excerpt(i.text)),text:i.name?excerpt(i.text):'',line:i.line,proof:i.proof,when:i.when});
        for(const r of m.roadmap)out.push({group:'Coming up',status:'plan',tag:r.tier,label:excerpt(r.text),text:'',line:r.line,proof:r.proof});
      }else if(key==='changelog'){
        for(const r of changelog(text,base).releases)for(const e of r.entries)out.push({group:r.title,groupDate:r.date,label:excerpt(e.text),text:e.group||'',line:e.line,proof:e.proof});
      }else if(key==='brain'){
        const m=brain(text,base);
        for(const p of m.providers)out.push({group:'Sources',label:p.title,text:p.fields.map(f=>strip(f.value)).join(' · ')||excerpt(p.text),date:p.verified,line:p.line,proof:p.proof||[]});
        for(const p of m.shelves)out.push({group:'What lives where',label:p.title,text:p.fields.map(f=>strip(f.value)).join(' · '),line:p.line,proof:[]});
      }else if(key==='structure'){
        const m=structure(text,base);
        for(const t of m.trees)for(const n of t.nodes)if(n.path)out.push({group:t.brain?t.title:'Paths',label:n.full||n.path,text:[n.note,...n.tags].filter(Boolean).join(' · '),line:n.line,proof:n.href?[{kind:'doc',label:'Open',href:n.href}]:[]});
        for(const c of m.commands)out.push({group:'Commands',label:c.text,text:'',line:c.line,proof:[],copy:c.text});
      }else if(key==='techstack'){
        for(const g of techstack(text,base).groups)for(const c of g.cards)out.push({group:g.title,label:c.name+(c.version?' '+c.version:''),text:c.fields.map(f=>strip(f.value)).slice(0,1).join(''),line:c.line,proof:[],tag:c.unknown?'Unknown':null});
      }
      return out.length?out:sectionRows(scan(text));
    }
    const dayLabel=d=>d.latest?'Latest day':d.date||'Undated';

    /* ---- HTML pieces ----
       Calm reading surface: one column, plain section titles, small proof chips, quiet source links.
       The record name and its stated facts sit in the peek header, so views start with content. */
    const A=(href,cls,label,title)=>'<a class="'+cls+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer"'+(title?' title="'+esc(title)+'"':'')+'>'+label+'</a>';
    const time=(iso,now)=>{const r=relative(iso,now);return r?'<time datetime="'+r.iso+'" title="'+r.iso+'">'+esc(r.text)+'</time>':''};
    const chips=proof=>proof&&proof.length?'<span class="proof">'+proof.map(p=>A(p.href,'chip '+p.kind,esc(p.label),p.href)).join('')+'</span>':'';
    const src=(ctx,line)=>{const u=sourceLink(ctx.url,line);return u?A(u,'src','L'+line,'Open line '+line+' in the source'):''};
    const when=(i,now)=>i.date?'<span class="when">'+(i.dateLabel?esc(i.dateLabel)+' ':'')+time(i.date,now)+'</span>':i.when?'<span class="when">'+esc(i.when)+'</span>':'';
    /* Two layouts for each type: the first is the default. Progress reads best as a list; the board is the option. */
    const LAYOUTS={progress:{list:'List',rich:'Board',first:'list'},vision:{rich:'Brief',list:'List',first:'rich'},brain:{rich:'Sources',list:'List',first:'rich'},structure:{rich:'Map',list:'List',first:'rich'},changelog:{rich:'Daily changes',list:'List',first:'rich'},techstack:{rich:'Table',list:'List',first:'rich'},readme:{rich:'Document',list:'List',first:'rich'}};
    const LAYOUT={vision:'brief',progress:'board',brain:'library',structure:'map',changelog:'timeline',techstack:'tools',readme:'guide'};
    const layouts=key=>LAYOUTS[key]||{rich:'Sections',list:'List',first:'rich'};
    const open=(key,mode,layout)=>{const l=layout||LAYOUT[key]||'document';return '<div class="view view-'+l+'" data-layout="'+l+'" data-density="'+mode+'">'};
    const part=(title,body,ctx,line,cls='')=>'<section class="part'+(cls?' '+cls:'')+'" data-outline="'+esc(title)+'"><h3 class="part-title">'+esc(title)+(line?src(ctx,line):'')+'</h3>'+body+'</section>';
    const generic=(list,ctx)=>list.map(s=>part(s.title,'<div class="prose">'+block(s.raw,ctx.url)+'</div>',ctx,s.line)).join('');
    const meta=(...bits)=>{const html=bits.filter(Boolean).join('');return html?'<span class="item-meta">'+html+'</span>':''};
    const textItem=(i,ctx,tag='')=>'<li class="item">'+tag+'<span class="item-line">'+(i.name?'<strong class="item-name">'+inline(i.name,ctx.url)+'</strong> ':'')+'<span class="item-text">'+inline(i.text,ctx.url)+'</span></span>'+(i.body?'<div class="item-body">'+block(i.body,ctx.url)+'</div>':'')+meta(when(i,ctx.now),chips(i.proof),src(ctx,i.line))+'</li>';
    const items=(list,ctx,tag='ul',cls='items')=>list.length?'<'+tag+' class="'+cls+'">'+list.map(i=>textItem(i,ctx)).join('')+'</'+tag+'>':'';
    const capNote=ctx=>ctx.skipped?'<p class="cap-note">'+ctx.skipped+' more items are in the full document.</p>':'';
    const take=ctx=>{if(ctx.budget>0){ctx.budget--;return true}ctx.skipped++;return false};
    const lead=(label,html,ctx,line,outline)=>'<div class="lead" data-outline="'+esc(outline||label||'In short')+'">'+(label?'<p class="lead-label">'+esc(label)+'</p>':'')+'<div class="lead-text">'+html+'</div>'+src(ctx,line)+'</div>';
    const STATUS={shipped:'Shipped',progress:'In progress',next:'Up next',attention:'Needs attention'};
    const tag=(status,text)=>'<span class="tag" data-status="'+status+'">'+esc(text||STATUS[status]||status)+'</span>';

    /* ---- Progress ---- */
    function itemCard(i,ctx,lane){
      if(!take(ctx))return '';
      const ev=i.evidence?'<details class="evidence"><summary>Evidence</summary><div>'+inline(i.evidence.text,ctx.url)+' '+src(ctx,i.evidence.line)+'</div></details>':'';
      return '<li class="item" data-status="'+lane+'">'+(i.name||when(i,ctx.now)?'<span class="item-line">'+(i.name?'<strong class="item-name">'+inline(i.name,ctx.url)+'</strong>':'')+'</span>':'')+(i.text?'<div class="item-text">'+inline(i.text,ctx.url)+'</div>':'')+(i.body?'<div class="item-body">'+block(i.body,ctx.url)+'</div>':'')+meta(when(i,ctx.now),chips(i.proof),ev,src(ctx,i.line))+'</li>';
    }
    /* One row in the reading list. Attention items say why in a small tag. */
    function progressItem(i,ctx,lane,showTag){
      if(!take(ctx))return '';
      const label=lane==='attention'&&i.name&&/^(gates?|blocked|blockers?|risks?)$/i.test(i.name)?i.name:null;
      return '<li class="item" data-status="'+lane+'">'+(showTag?tag(lane,label):'')+'<span class="item-line">'+(i.name&&!label?'<strong class="item-name">'+inline(i.name,ctx.url)+'</strong> ':'')+(i.text?'<span class="item-text">'+inline(i.text,ctx.url)+'</span>':'')+'</span>'+(i.body?'<div class="item-body">'+block(i.body,ctx.url)+'</div>':'')+meta(lane==='shipped'?'':when(i,ctx.now),chips(i.proof),src(ctx,i.line))+'</li>';
    }
    function dayExtras(d,ctx){
      let html='';
      if(d.decisions.length)html+='<div class="day-extra"><h5 class="extra-title">Decisions</h5>'+items(d.decisions,ctx)+'</div>';
      if(d.orphanProof.length)html+='<div class="day-extra"><h5 class="extra-title">Other proof</h5><ul class="items">'+d.orphanProof.map(o=>'<li class="item"><span class="item-line"><strong class="item-name">'+esc(o.name)+'</strong> <span class="item-text">'+inline(o.text,ctx.url)+'</span></span>'+meta(chips(o.proof),src(ctx,o.line))+'</li>').join('')+'</ul></div>';
      for(const n of d.notes)html+='<div class="day-extra note"><h5 class="extra-title">'+esc(n.title||'Notes')+src(ctx,n.line)+'</h5><div class="prose">'+block(n.text,ctx.url)+'</div></div>';
      if(d.tracking)html+='<p class="day-tracking">Task tracking: '+inline(d.tracking,ctx.url)+'</p>';
      return html;
    }
    const dayHead=(d,ctx,tagName='h4')=>'<'+tagName+' class="day-title">'+(d.date?time(d.date,ctx.now)+' <small>'+d.date+'</small>':d.latest?'Latest day':'Undated')+'</'+tagName+'>';
    /* Default Progress layout: next action, then what is happening now, then shipped work by day. */
    function progressList(record,ctx){
      const m=progress(record.content,ctx.url);if(m.empty&&!m.next)return null;
      const [latest,...earlier]=m.days;
      let html=open('progress','list','progress-list');
      if(m.next)html+=lead('Next action',inline(m.next.text,ctx.url),ctx,m.next.line);
      if(latest){
        const now=[...latest.lanes.progress.map(i=>[i,'progress']),...latest.lanes.attention.map(i=>[i,'attention'])];
        if(now.length)html+=part('Now','<ul class="items">'+now.map(([i,l])=>progressItem(i,ctx,l,true)).join('')+'</ul>',ctx);
        if(latest.lanes.next.length)html+=part('Up next','<ul class="items">'+latest.lanes.next.map(i=>progressItem(i,ctx,'next',false)).join('')+'</ul>',ctx);
      }
      const days=m.days.map(d=>({d,list:d===latest?d.lanes.shipped.map(i=>[i,'shipped']):Object.entries(d.lanes).flatMap(([l,is])=>is.map(i=>[i,l]))})).filter(x=>x.list.length||(x.d!==latest&&(x.d.decisions.length||x.d.notes.length)));
      const dayHTML=({d,list})=>'<section class="day'+(d===latest?' latest':'')+'"'+(d.date?' data-day="'+d.date+'"':'')+'>'+dayHead(d,ctx)+(list.length?'<ul class="items">'+list.map(([i,l])=>progressItem(i,ctx,l,l!=='shipped')).join('')+'</ul>':'')+(d===latest?'':dayExtras(d,ctx))+'</section>';
      if(days.length){
        const shown=days.slice(0,4),rest=days.slice(4);
        html+='<section class="part shipped" data-outline="Shipped"><h3 class="part-title">Shipped</h3>'+shown.map(dayHTML).join('')+(rest.length?'<details class="fold earlier"><summary>'+rest.length+(rest.length===1?' earlier day':' earlier days')+'</summary>'+rest.map(dayHTML).join('')+'</details>':'')+'</section>';
      }
      if(latest){const extra=dayExtras(latest,ctx);if(extra)html+='<section class="part" data-outline="Notes"><h3 class="part-title">Notes</h3>'+extra+'</section>'}
      if(m.roadmap.length)html+=part('Coming up','<ul class="items">'+m.roadmap.map(r=>'<li class="item">'+tag('plan',r.tier)+'<span class="item-line"><span class="item-text">'+inline(r.text,ctx.url)+'</span></span>'+meta(chips(r.proof),src(ctx,r.line))+'</li>').join('')+'</ul>',ctx);
      return html+capNote(ctx)+'</div>';
    }
    function board(d,ctx,compactEmpty){
      const lanes=Object.keys(STATUS).filter(l=>!compactEmpty||d.lanes[l].length);
      return '<div class="board4">'+lanes.map(l=>'<section class="lane" data-status="'+l+'"><h4 class="lane-title"><span>'+STATUS[l]+'</span> <span class="lane-count">'+d.lanes[l].length+'</span></h4>'+(d.lanes[l].length?'<ul class="lane-items">'+d.lanes[l].map(i=>itemCard(i,ctx,l)).join('')+'</ul>':'<p class="lane-empty">Nothing listed.</p>')+'</section>').join('')+'</div>'+dayExtras(d,ctx);
    }
    function progressBoard(record,ctx){
      const m=progress(record.content,ctx.url);if(m.empty)return null;
      const [latest,...earlier]=m.days;
      let html=open('progress','rich');
      if(m.next)html+=lead('Next action',inline(m.next.text,ctx.url),ctx,m.next.line);
      if(latest)html+='<section class="part day latest" data-outline="Latest day"><h3 class="part-title">Latest day'+(latest.date?' <small>'+time(latest.date,ctx.now)+'</small>':'')+'</h3>'+board(latest,ctx,false)+'</section>';
      if(earlier.length)html+='<section class="part days" data-outline="Earlier days"><h3 class="part-title">Earlier days</h3>'+earlier.map(d=>{
        const n=count(d),shipped=d.lanes.shipped.length;
        return '<details class="day fold"><summary>'+dayHead(d,ctx,'span')+'<span class="fold-count">'+(shipped?shipped+' shipped':n+(n===1?' item':' items'))+'</span></summary><div class="day-body">'+board(d,ctx,true)+'</div></details>';
      }).join('')+'</section>';
      if(m.roadmap.length){
        const tiers=[...new Set(m.roadmap.map(r=>r.tier))];
        html+='<section class="part roadmap" data-outline="Coming up"><h3 class="part-title">Coming up</h3><div class="board4">'+tiers.map(t=>'<section class="lane"><h4 class="lane-title">'+esc(t)+'</h4><ul class="lane-items">'+m.roadmap.filter(r=>r.tier===t).map(r=>'<li class="item"><div class="item-text">'+inline(r.text,ctx.url)+'</div>'+meta(chips(r.proof),src(ctx,r.line))+'</li>').join('')+'</ul></section>').join('')+'</div></section>';
      }
      return html+capNote(ctx)+'</div>';
    }

    /* ---- Other records ---- */
    function changelogView(record,ctx){
      const m=changelog(record.content,ctx.url);if(m.empty)return null;
      let html=open('changelog','rich')+(m.lede?'<div class="intro prose">'+block(m.lede.text,ctx.url)+'</div>':'');
      const days=new Map(),undated=[];
      for(const release of m.releases){
        if(!release.entries.length)continue;
        if(!release.date){undated.push(release);continue}
        if(!days.has(release.date))days.set(release.date,[]);
        days.get(release.date).push(release);
      }
      function entries(releases,date){
        const rows=[];
        for(const release of releases)for(const entry of release.entries){
          if(!take(ctx))continue;
          const label=[release.version,entry.group].filter(Boolean).join(' · ');
          rows.push('<li data-change-day="'+esc(date)+'">'+(label?'<small>'+esc(label)+'</small> ':'')+
            inline(entry.text,ctx.url)+(entry.body?block(entry.body,ctx.url):'')+meta(src(ctx,entry.line))+'</li>');
        }
        return '<ul class="daily-bullets">'+rows.join('')+'</ul>';
      }
      const dates=[...days.keys()].sort().reverse();
      const latest=dates.shift();
      const progressRecord=ctx.progressRecord;
      if(progressRecord?.content&&!progressRecord.error){
        const snapshot=progress(progressRecord.content,progressRecord.url);
        const source={...ctx,url:progressRecord.url};
        if(snapshot.next)html+=lead('Next action',inline(snapshot.next.text,source.url),source,snapshot.next.line);
        const attention=snapshot.days.find(day=>day.latest)?.lanes.attention||[];
        if(attention.length)html+='<details class="daily-attention"><summary>Needs attention ('+attention.length+')</summary>'+items(attention,source)+'</details>';
      }
      if(latest)html+='<section class="part release" data-outline="Daily changes"><h3 class="part-title">Daily changes</h3><p class="daily-date">'+time(latest,ctx.now)+' · '+esc(latest)+'</p>'+entries(days.get(latest),latest)+'</section>';
      if(dates.length){
        const rows=dates.map(date=>{
          const releases=days.get(date);
          const first=releases[0].entries[0];
          const count=releases.reduce((sum,r)=>sum+r.entries.length,0);
          const summary=esc(excerpt(first.text))+(count>1?' (+'+(count-1)+')':'');
          return '<tr><th scope="row">'+esc(date)+'</th><td><details><summary>'+summary+'</summary>'+entries(releases,date)+'</details></td></tr>';
        });
        html+=part('History','<table class="daily-history"><thead><tr><th scope="col">Date</th><th scope="col">What changed</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>',ctx);
      }
      for(const release of undated)html+=part(release.title,entries([release],''),ctx,release.line);
      if(!latest&&!undated.length)html+='<p>No changes recorded yet.</p>';
      return html+capNote(ctx)+'</div>';
    }
    function visionView(record,ctx){
      const m=vision(record.content,ctx.url);if(m.empty)return null;
      const S=m.sections,used=new Set();
      const prose=role=>{if(!S[role]||used.has(role))return '';used.add(role);return part(S[role].title,'<div class="prose">'+block(S[role].raw,ctx.url)+'</div>',ctx,S[role].line)};
      const list=(role,list,tagName='ul')=>{if(!S[role]||used.has(role))return '';if(!list.length)return prose(role);used.add(role);return part(S[role].title,items(list,ctx,tagName),ctx,S[role].line)};
      let html=open('vision','rich');
      /* The purpose sentence leads: the declaration, or a short Why section. */
      if(m.declaration)html+=lead('',block(m.declaration.text,ctx.url),ctx,m.declaration.line,'Purpose');
      else if(S.why&&S.why.raw.trim().length<360){html+=lead('',block(S.why.raw,ctx.url),ctx,S.why.line,S.why.title);used.add('why')}
      html+=prose('who')+prose('why')+prose('world')+list('beliefs',m.beliefs,'ol');
      if(S.path&&m.path.length){used.add('path');html+=part(S.path.title,'<ol class="items path">'+m.path.map(p=>'<li class="item">'+tag('plan',p.stage||'Step')+'<span class="item-line"><span class="item-text">'+inline(p.text,ctx.url)+'</span></span>'+meta(src(ctx,p.line))+'</li>').join('')+'</ol>',ctx,S.path.line)}else html+=prose('path');
      html+=list('never',m.never)+prose('sustain')+list('bets',m.bets)+list('questions',m.questions);
      if(S.changes){used.add('changes');html+=part(S.changes.title,m.changes.length?'<ul class="items">'+m.changes.map(c=>'<li class="item"><span class="item-line"><span class="item-text">'+inline(c.text,ctx.url)+'</span></span>'+meta(c.date?'<span class="when">'+time(c.date,ctx.now)+'</span>':'',src(ctx,c.line))+'</li>').join('')+'</ul>':'<div class="prose">'+block(S.changes.raw,ctx.url)+'</div>',ctx,S.changes.line)}
      return html+generic(m.other,ctx)+'</div>';
    }
    /* One source with its access line: route, account, scope, and location, then when access was checked. */
    function sourceItem(p,ctx){
      const access=p.fields.map(f=>'<span><span class="sr">'+esc(f.label)+': </span>'+inline(f.value,ctx.url)+'</span>').join('<span aria-hidden="true"> · </span>');
      return '<li class="item source"><span class="item-line"><strong class="item-name">'+esc(p.title)+'</strong>'+(p.role?' <span class="tag">'+esc(p.role)+'</span>':'')+'</span>'+(access?'<p class="access">'+access+'</p>':p.text?'<p class="access">'+inline(p.text,ctx.url)+'</p>':'')+meta(p.hasVerified?(p.verified?'<span class="badge ok">Verified '+time(p.verified,ctx.now)+'</span>':'<span class="badge warn">Not verified</span>'):'',chips(p.proof),src(ctx,p.line))+'</li>';
    }
    function brainView(record,ctx){
      const m=brain(record.content,ctx.url);if(m.empty)return null;
      const sources=list=>'<ul class="items sources">'+list.map(p=>sourceItem(p,ctx)).join('')+'</ul>';
      let html=open('brain','rich')+(m.lede?'<div class="intro prose">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.providers.length||m.sourcesNote)html+=part('Sources',(m.sourcesNote?'<div class="prose">'+block(m.sourcesNote.text,ctx.url)+'</div>':'')+(m.providers.length?sources(m.providers):''),ctx);
      html+='<div data-connections-slot></div>';
      if(m.shelves.length)html+=part('What lives where',sources(m.shelves),ctx);
      if(m.steps.length)html+=part('How to find things',items(m.steps,ctx,'ol'),ctx);
      if(m.saves.cards)html+=part('Where to save',sources(m.saves.cards)+items(m.saves.notes,ctx),ctx,m.saves.line);
      for(const r of m.rules)html+=part(r.title,r.items.length?items(r.items,ctx):'<div class="prose">'+block(r.raw,ctx.url)+'</div>',ctx,r.line);
      if(m.questions.length)html+=part('Open questions',items(m.questions,ctx),ctx);
      return html+generic(m.other,ctx)+'</div>';
    }
    function commandsHTML(list,ctx){return list.length?'<ul class="commands">'+list.map(c=>'<li><code>'+esc(c.text)+'</code><button type="button" class="copy" data-copy="'+esc(c.text)+'" aria-label="Copy '+esc(c.text)+'">Copy</button>'+src(ctx,c.line)+'</li>').join('')+'</ul>':''}
    function treeHTML(t){
      return '<div class="tree">'+t.nodes.map(n=>'<div class="tree-line'+(n.dir?' dir':'')+'"><span class="tree-path"><span class="tree-guide">'+esc(n.guide)+'</span>'+(n.href?'<a href="'+esc(n.href)+'" target="_blank" rel="noopener noreferrer" title="Open '+esc(n.full)+' on GitHub">'+esc(n.path)+'</a>':esc(n.path))+'</span><span class="tree-side"><span class="tree-note">'+esc(n.note)+'</span>'+n.tags.map(tag=>'<span class="tag'+(/start|entry/i.test(tag)?' start':/do not|generated|history/i.test(tag)?' hold':'')+'">'+esc(tag)+'</span>').join('')+'</span></div>').join('')+'</div>';
    }
    function structureView(record,ctx){
      const m=structure(record.content,ctx.url);if(m.empty)return null;
      let html=open('structure','rich')+(m.lede?'<div class="intro prose">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.readFirst.length)html+=part('Read first',items(m.readFirst,ctx),ctx);
      html+=m.trees.map(t=>part(t.title,treeHTML(t),ctx,t.line,'directory')).join('');
      if(m.commands.length)html+=part('Commands',commandsHTML(m.commands,ctx),ctx);
      for(const f of m.flows)html+=part(f.title,'<ol class="flow">'+f.edges.map(([a,b])=>'<li><span>'+esc(a)+'</span><i aria-hidden="true">→</i><span>'+esc(b)+'</span></li>').join('')+'</ol>',ctx,f.line);
      for(const t of m.tables)html+=part(t.title,'<dl class="pairs">'+t.rows.map(r=>'<div><dt>'+inline(r.cells[0]||'',ctx.url)+'</dt><dd>'+inline(r.cells.slice(1).join(' · '),ctx.url)+'</dd></div>').join('')+'</dl>',ctx,t.line);
      return html+generic(m.other,ctx)+'</div>';
    }
    /* A compact table: one row for each tool, one column for each field the source names. */
    function techstackView(record,ctx){
      const m=techstack(record.content,ctx.url);if(m.empty)return null;
      let html=open('techstack','rich')+(m.lede?'<div class="intro prose">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.gaps.length)html+=part('To verify',items(m.gaps,ctx),ctx);
      for(const g of m.groups){
        const cols=[...new Set(g.cards.flatMap(c=>c.fields.map(f=>f.label)))],version=g.cards.some(c=>c.version);
        const rows=g.cards.filter(()=>take(ctx)).map(c=>'<tr class="tool-row'+(c.unknown?' unknown':'')+'"><th scope="row">'+esc(c.name)+(c.unknown?' <span class="badge warn">Not confirmed</span>':'')+'</th>'+(version?'<td class="num">'+esc(c.version||'')+'</td>':'')+cols.map(label=>'<td>'+inline(c.fields.find(f=>f.label===label)?.value||'',ctx.url)+'</td>').join('')+'<td class="src-cell">'+src(ctx,c.line)+'</td></tr>').join('');
        html+=part(g.title,'<div class="table-wrap"><table class="stack"><thead><tr><th scope="col">Tool</th>'+(version?'<th scope="col">Version</th>':'')+cols.map(c=>'<th scope="col">'+esc(c)+'</th>').join('')+'<th scope="col"><span class="sr">Source line</span></th></tr></thead><tbody>'+rows+'</tbody></table></div>'+(g.notes.trim()?'<div class="prose">'+block(g.notes,ctx.url)+'</div>':''),ctx,g.line);
      }
      if(m.evidence.length)html+=part('Evidence',items(m.evidence,ctx),ctx);
      return html+generic(m.other,ctx)+capNote(ctx)+'</div>';
    }
    /* README reads best as the document itself. The title is in the header, so it is not repeated. */
    function readmeView(record,ctx){
      const text=withoutTitle(record.content);if(!text.trim())return null;
      return open('readme','rich')+'<div class="prose document">'+block(text,ctx.url)+'</div></div>';
    }
    /* The first H1 is the page title. The peek header shows the name, so the body leaves it out. */
    function withoutTitle(text){const lines=String(text||'').split('\n'),at=lines.findIndex(l=>l.trim());return at>=0&&/^#\s/.test(lines[at])?lines.slice(at+1).join('\n'):String(text||'')}
    function listView(key,record,ctx){
      const list=rows(key,record.content,ctx.url);
      let html=open(key,'list','rows')+'<div class="rows-list">',group=null,shown=0;
      for(const r of list){
        if(shown>=LIST_LIMIT){ctx.skipped++;continue}shown++;
        if(r.group!==group){if(group!==null)html+='</ol></section>';group=r.group;html+='<section class="rows-group"'+(group?' data-outline="'+esc(group)+'"':'')+'>'+(group?'<h3 class="part-title">'+esc(group)+(r.groupDate&&r.groupDate!==group?' <small>'+time(r.groupDate,ctx.now)+'</small>':r.groupDate?' <small>'+time(r.groupDate,ctx.now)+'</small>':'')+'</h3>':'')+'<ol class="rows">'}
        const label=r.status?tag(r.status,r.tag):r.tag?'<span class="tag">'+esc(r.tag)+'</span>':'';
        html+='<li class="row"'+(r.status?' data-status="'+r.status+'"':'')+'>'+label+'<span class="row-main"><strong>'+esc(r.label)+'</strong>'+(r.text?' <span class="row-text">'+esc(r.text)+'</span>':'')+'</span><span class="row-meta">'+(r.date?time(r.date,ctx.now):r.when?'<span class="when">'+esc(r.when)+'</span>':'')+chips(r.proof)+(r.copy?'<button type="button" class="copy" data-copy="'+esc(r.copy)+'" aria-label="Copy '+esc(r.copy)+'">Copy</button>':'')+src(ctx,r.line)+'</span></li>';
      }
      if(group!==null)html+='</ol></section>';
      return html+'</div>'+capNote(ctx)+'</div>';
    }
    const VIEWS={progress:progressBoard,changelog:changelogView,vision:visionView,brain:brainView,structure:structureView,techstack:techstackView,readme:readmeView};
    const defaultMode=key=>layouts(key).first;
    /* HTML for a record, or null when the record does not follow its template and the plain document reads better.
       Progress: "list" is the reading list (default) and "rich" is the board. Other types: "rich" is their own layout. */
    function render(key,record,opts={}){
      if(!record||record.error||typeof record.content!=='string')return null;
      const mode=opts.mode==='list'||opts.mode==='rich'?opts.mode:defaultMode(key),ctx={progressRecord:opts.progressRecord,url:record.url,now:opts.now??Date.now(),mode,links:opts.links||0,budget:RICH_LIMIT,skipped:0};
      if(key==='progress'&&mode==='list')return progressList(record,ctx);
      if(mode==='list')return listView(key,record,ctx);
      return VIEWS[key]?VIEWS[key](record,ctx):null;
    }
    return {isoDate,relative,proofKind,linksIn,sourceLink,prRef,progress,changelog,vision,brain,structure,techstack,readme,rows,render,layouts,defaultMode,withoutTitle};
  }
})(globalThis);
