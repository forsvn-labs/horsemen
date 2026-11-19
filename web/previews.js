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
  const views=artifactViews();
  const api={preview,matchesProject,detail,toolsTable,facts,lede,tidy,split,shape,tree,views};if(typeof module!=='undefined')module.exports=api;else{root.HorsemenPreview=api;root.HorsemenViews=views}

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

    /* ---- HTML pieces ---- */
    const A=(href,cls,label,title)=>'<a class="'+cls+'" href="'+esc(href)+'" target="_blank" rel="noopener noreferrer"'+(title?' title="'+esc(title)+'"':'')+'>'+label+'</a>';
    const time=(iso,now)=>{const r=relative(iso,now);return r?'<time datetime="'+r.iso+'" title="'+r.iso+'">'+esc(r.text)+'</time>':''};
    const chips=proof=>proof&&proof.length?'<span class="proof">'+proof.map(p=>A(p.href,'chip '+p.kind,esc(p.label),p.href)).join('')+'</span>':'';
    const src=(ctx,line)=>{const u=sourceLink(ctx.url,line);return u?A(u,'src','L'+line,'Open line '+line+' in the source'):''};
    const when=(i,now)=>i.date?'<span class="when">'+(i.dateLabel?esc(i.dateLabel)+' ':'')+time(i.date,now)+'</span>':i.when?'<span class="when">'+esc(i.when)+'</span>':'';
    const EYEBROW={vision:'I · Conquest · Direction',progress:'II · War · Campaign',brain:'III · Famine · Knowledge',structure:'IV · Death · Skeleton',readme:'Supporting record · The front door',changelog:'Supporting record · Delivery proof',techstack:'Supporting record · How the parts fit'};
    const RICH={vision:'Brief',progress:'Board',brain:'Library',structure:'Map',changelog:'Timeline',techstack:'Cards',readme:'Guide'};
    const LAYOUT={vision:'brief',progress:'board',brain:'library',structure:'map',changelog:'timeline',techstack:'tools',readme:'guide'};
    const HELP={
      progress:'The latest day comes first. Each item links to its proof and to its line in the source.',
      changelog:'Releases are newest first. Chips link to the pull requests, commits, and releases that the source names.',
      vision:'The owner’s direction, in the owner’s words. Open questions and decisions are at the end.',
      brain:'Where knowledge lives and how to reach it. A link is not access to its contents.',
      structure:'Select a path to open it on GitHub. Select Copy to copy a command.',
      techstack:'One card for each tool or service, as the source lists it.',
      readme:'The front door: what this is, what you get, and how to start.'
    };
    function toggle(key,mode){
      const rich=RICH[key]||'Sections';
      return '<div class="segmented view-toggle" role="group" aria-label="Layout" data-view-toggle>'+[['rich',rich],['list','List']].map(([v,label])=>'<button type="button" data-view-choice="'+v+'" aria-pressed="'+(mode===v)+'">'+label+'</button>').join('')+'</div>';
    }
    function header(key,record,ctx,title){
      const stated=facts(record.content||''),seal=['vision','progress','brain','structure'].includes(key)?'<svg class="overview-seal" aria-hidden="true"><use href="/assets/icons/seals.svg#seal-'+key+'"/></svg>':'';
      const list=stated.map(f=>{const lead=f.value.match(/^(\d{4}-\d{2}-\d{2})\s*(.*)$/),exact=lead&&isoDate(lead[1]);return '<div><dt>'+esc(f.label)+'</dt><dd>'+(exact?time(exact,ctx.now)+(lead[2]?' <small>'+esc(lead[2])+'</small>':''):esc(f.value))+'</dd></div>'});
      if(ctx.links)list.push('<div><dt>Links</dt><dd>'+ctx.links+'</dd></div>');
      return '<header class="page-head">'+seal+'<div class="detail-eyebrow">'+esc(EYEBROW[key]||'Connected document')+'</div><h2>'+esc(title||record.name||'Untitled')+'</h2>'+(list.length?'<dl class="facts">'+list.join('')+'</dl>':'')+'<div class="view-bar">'+toggle(key,ctx.mode)+(HELP[key]?'<p class="view-help">'+esc(HELP[key])+'</p>':'')+'</div></header>';
    }
    const open=(key,mode,extra='')=>'<div class="artifact-overview views views-'+(LAYOUT[key]||'document')+extra+'" data-layout="'+(LAYOUT[key]||'document')+'" data-density="'+mode+'">';
    const generic=(list,ctx)=>list.length?'<div class="blocks rows">'+list.map(s=>'<section class="block'+(/boundar|never|access|permission/i.test(s.title)?' boundary':'')+'" data-outline="'+esc(s.title)+'"><header class="block-head"><h3 class="block-title">'+esc(s.title)+'</h3>'+src(ctx,s.line)+'</header><div class="block-body">'+block(s.raw,ctx.url)+'</div></section>').join('')+'</div>':'';
    const textItem=(i,ctx,cls='')=>'<li class="'+cls+'">'+(i.name?'<strong>'+inline(i.name,ctx.url)+'</strong> ':'')+'<span>'+inline(i.text,ctx.url)+'</span>'+(i.body?block(i.body,ctx.url):'')+'<span class="item-meta">'+when(i,ctx.now)+chips(i.proof)+src(ctx,i.line)+'</span></li>';
    const capNote=ctx=>ctx.skipped?'<p class="cap-note">'+ctx.skipped+' more items are in the Full document.</p>':'';
    const take=ctx=>{if(ctx.budget>0){ctx.budget--;return true}ctx.skipped++;return false};

    /* ---- Views ---- */
    function itemCard(i,ctx,lane){
      if(!take(ctx))return '';
      const ev=i.evidence?'<details class="evidence"><summary>Evidence</summary><div>'+inline(i.evidence.text,ctx.url)+' '+src(ctx,i.evidence.line)+'</div></details>':'';
      return '<li class="item" data-status="'+lane+'">'+(i.name||when(i,ctx.now)?'<div class="item-head">'+(i.name?'<strong class="item-name">'+inline(i.name,ctx.url)+'</strong>':'')+when(i,ctx.now)+'</div>':'')+(i.text?'<div class="item-text">'+inline(i.text,ctx.url)+'</div>':'')+(i.body?'<div class="item-body">'+block(i.body,ctx.url)+'</div>':'')+'<div class="item-meta">'+chips(i.proof)+ev+src(ctx,i.line)+'</div></li>';
    }
    function board(d,ctx,compactEmpty){
      const lanes=Object.keys(LANE_LABEL).filter(l=>!compactEmpty||d.lanes[l].length);
      let html='<div class="board4">'+lanes.map(l=>'<section class="lane" data-status="'+l+'"><header class="lane-head"><h4 class="lane-title">'+LANE_LABEL[l]+'</h4><span class="lane-count">'+d.lanes[l].length+'</span></header>'+(d.lanes[l].length?'<ul class="lane-items">'+d.lanes[l].map(i=>itemCard(i,ctx,l)).join('')+'</ul>':'<p class="lane-empty">Nothing listed for this day.</p>')+'</section>').join('')+'</div>';
      if(d.decisions.length)html+='<section class="day-extra"><h4 class="extra-title">Decisions</h4><ul>'+d.decisions.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      if(d.orphanProof.length)html+='<section class="day-extra"><h4 class="extra-title">Other proof</h4><ul>'+d.orphanProof.map(o=>'<li><strong>'+esc(o.name)+'</strong> <span>'+inline(o.text,ctx.url)+'</span><span class="item-meta">'+chips(o.proof)+src(ctx,o.line)+'</span></li>').join('')+'</ul></section>';
      for(const n of d.notes)html+='<section class="day-extra note"><h4 class="extra-title">'+esc(n.title||'Notes')+' '+src(ctx,n.line)+'</h4><div class="block-body">'+block(n.text,ctx.url)+'</div></section>';
      if(d.tracking)html+='<p class="day-tracking">Task tracking: '+inline(d.tracking,ctx.url)+'</p>';
      return html;
    }
    function progressView(record,ctx){
      const m=progress(record.content,ctx.url);if(m.empty)return null;
      const [latest,...earlier]=m.days;
      let html=open('progress','rich')+header('progress',record,ctx,m.title);
      if(m.next)html+='<div class="detail-hero" data-outline="Next action"><span>Next action</span><p>'+inline(m.next.text,ctx.url)+'</p>'+src(ctx,m.next.line)+'</div>';
      if(latest)html+='<section class="day latest" data-outline="Latest day"><header class="day-head"><h3 class="day-title">Latest day</h3>'+(latest.date?'<span class="day-when">'+time(latest.date,ctx.now)+'<small>'+latest.date+'</small></span>':'')+'</header>'+board(latest,ctx,false)+'</section>';
      if(earlier.length)html+='<section class="days" data-outline="Earlier days"><h3 class="group-title">Earlier days <small>'+earlier.length+'</small></h3>'+earlier.map(d=>{
        const n=count(d),shipped=d.lanes.shipped.length;
        return '<details class="day fold"><summary><span class="day-title">'+(d.date?time(d.date,ctx.now):'Undated')+'</span>'+(d.date?'<code class="day-date">'+d.date+'</code>':'')+'<small>'+(shipped?shipped+' shipped':n+(n===1?' item':' items'))+'</small></summary><div class="day-body">'+board(d,ctx,true)+'</div></details>';
      }).join('')+'</section>';
      if(m.roadmap.length){
        const tiers=[...new Set(m.roadmap.map(r=>r.tier))];
        html+='<section class="roadmap" data-outline="Coming up"><h3 class="group-title">Coming up</h3><div class="road-lanes">'+tiers.map(t=>'<section class="road-lane"><h4 class="lane-title">'+esc(t)+'</h4><ul>'+m.roadmap.filter(r=>r.tier===t).map(r=>'<li><span>'+inline(r.text,ctx.url)+'</span><span class="item-meta">'+chips(r.proof)+src(ctx,r.line)+'</span></li>').join('')+'</ul></section>').join('')+'</div></section>';
      }
      return html+capNote(ctx)+'</div>';
    }
    function changelogView(record,ctx){
      const m=changelog(record.content,ctx.url);if(m.empty)return null;
      let html=open('changelog','rich')+header('changelog',record,ctx,m.title)+(m.lede?'<div class="lede">'+block(m.lede.text,ctx.url)+'</div>':'')+'<div class="timeline releases">';
      for(const r of m.releases){
        let group=null,list='';
        for(const e of r.entries){if(!take(ctx))continue;if(e.group!==group){group=e.group;if(group)list+='<li class="release-group">'+esc(group)+'</li>'}list+='<li class="release-item"><span>'+inline(e.text,ctx.url)+'</span>'+(e.body?block(e.body,ctx.url):'')+'<span class="item-meta">'+chips(e.proof)+src(ctx,e.line)+'</span></li>'}
        html+='<section class="timeline-entry release" data-outline="'+esc(r.title)+'"><header class="release-head">'+(r.version?'<span class="version">'+esc(r.version)+'</span>':'')+'<h3 class="block-title">'+esc(r.date?r.title.replace(r.version||'\u0000','').replace(r.date,'').replace(/^[\s\-–—·:]+|[\s\-–—·:]+$/g,'')||r.date:r.title)+'</h3>'+(r.date?'<span class="when">'+time(r.date,ctx.now)+'</span>':'')+src(ctx,r.line)+'</header>'+(list?'<ul class="release-items">'+list+'</ul>':'<p class="lane-empty">No entries under this heading.</p>')+'</section>';
      }
      return html+'</div>'+capNote(ctx)+'</div>';
    }
    function visionView(record,ctx){
      const m=vision(record.content,ctx.url);if(m.empty)return null;
      const S=m.sections,prose=(role,cls='')=>S[role]?'<section class="brief-card '+cls+'" data-outline="'+esc(S[role].title)+'"><header class="block-head"><h3 class="block-title">'+esc(S[role].title)+'</h3>'+src(ctx,S[role].line)+'</header><div class="block-body">'+block(S[role].raw,ctx.url)+'</div></section>':'';
      const list=(role,items,cls,tag='ul')=>S[role]&&items.length?'<section class="brief-list '+cls+'" data-outline="'+esc(S[role].title)+'"><header class="block-head"><h3 class="block-title">'+esc(S[role].title)+'</h3>'+src(ctx,S[role].line)+'</header><'+tag+'>'+items.map(i=>textItem(i,ctx)).join('')+'</'+tag+'></section>':prose(role);
      let html=open('vision','rich')+header('vision',record,ctx,m.title);
      if(m.declaration)html+='<div class="detail-hero declaration" data-outline="In short"><span>In short</span>'+block(m.declaration.text,ctx.url)+src(ctx,m.declaration.line)+'</div>';
      html+='<div class="brief-grid">'+prose('why')+prose('world')+'</div>'+prose('who','wide');
      html+=list('beliefs',m.beliefs,'beliefs','ol');
      if(S.path)html+=m.path.length?'<section class="brief-list path" data-outline="'+esc(S.path.title)+'"><header class="block-head"><h3 class="block-title">'+esc(S.path.title)+'</h3>'+src(ctx,S.path.line)+'</header><ol class="path-steps">'+m.path.map(p=>'<li class="path-step"><span class="path-stage">'+esc(p.stage||'Step')+'</span><span>'+inline(p.text,ctx.url)+'</span>'+src(ctx,p.line)+'</li>').join('')+'</ol></section>':prose('path');
      html+=list('never',m.never,'boundary')+prose('sustain','wide');
      if(m.bets.length||m.questions.length||S.bets||S.questions){
        html+='<section class="open-panel" data-outline="Still open"><h3 class="group-title">Still open</h3><p class="view-help">Bets are not proven yet. Questions wait for a decision.</p><div class="open-grid">'+[['bets',m.bets],['questions',m.questions]].filter(([r])=>S[r]).map(([r,items])=>'<section><h4 class="lane-title">'+esc(S[r].title)+' '+src(ctx,S[r].line)+'</h4>'+(items.length?'<ul>'+items.map(i=>textItem(i,ctx)).join('')+'</ul>':block(S[r].raw,ctx.url))+'</section>').join('')+'</div></section>';
      }
      if(S.changes)html+='<section class="decisions-log" data-outline="'+esc(S.changes.title)+'"><h3 class="group-title">'+esc(S.changes.title)+' '+src(ctx,S.changes.line)+'</h3>'+(m.changes.length?'<div class="timeline">'+m.changes.map(c=>'<div class="timeline-entry"><span class="when">'+(c.date?time(c.date,ctx.now):'Undated')+'</span><div>'+inline(c.text,ctx.url)+'</div>'+src(ctx,c.line)+'</div>').join('')+'</div>':block(S.changes.raw,ctx.url))+'</section>';
      return html+generic(m.other,ctx)+'</div>';
    }
    function brainView(record,ctx){
      const m=brain(record.content,ctx.url);if(m.empty)return null;
      const card=(p,cls)=>'<section class="provider-card '+cls+'">'+(p.role?'<span class="provider-role">'+esc(p.role)+'</span>':'')+'<h4>'+esc(p.title)+'</h4>'+(p.fields.length?'<dl>'+p.fields.map(f=>'<dt>'+esc(f.label)+'</dt><dd>'+inline(f.value,ctx.url)+'</dd>').join('')+'</dl>':p.text?'<p>'+inline(p.text,ctx.url)+'</p>':'')+'<div class="item-meta">'+(p.hasVerified?(p.verified?'<span class="badge ok">Verified '+time(p.verified,ctx.now)+'</span>':'<span class="badge warn">Not verified</span>'):'')+chips(p.proof)+src(ctx,p.line)+'</div></section>';
      let html=open('brain','rich')+header('brain',record,ctx,m.title)+(m.lede?'<div class="lede">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.providers.length||m.sourcesNote)html+='<section class="library" data-outline="Sources"><h3 class="group-title">Sources</h3>'+(m.sourcesNote?'<div class="block-body sources-note">'+block(m.sourcesNote.text,ctx.url)+src(ctx,m.sourcesNote.line)+'</div>':'')+(m.providers.length?'<div class="provider-grid">'+m.providers.map(p=>card(p,'')).join('')+'</div>':'')+'</section>';
      html+='<div data-connections-slot></div>';
      if(m.shelves.length)html+='<section class="library" data-outline="What lives where"><h3 class="group-title">What lives where</h3><div class="provider-grid shelves">'+m.shelves.map(p=>card(p,'shelf')).join('')+'</div></section>';
      if(m.steps.length)html+='<section class="brief-list" data-outline="How to find things"><h3 class="group-title">How to find things</h3><ol class="steps">'+m.steps.map(i=>textItem(i,ctx)).join('')+'</ol></section>';
      if(m.saves.cards)html+='<section class="library" data-outline="Where to save"><h3 class="group-title">Where to save '+src(ctx,m.saves.line)+'</h3><div class="provider-grid">'+m.saves.cards.map(p=>card(p,'shelf')).join('')+'</div>'+(m.saves.notes.length?'<ul class="plain-list">'+m.saves.notes.map(i=>textItem(i,ctx)).join('')+'</ul>':'')+'</section>';
      for(const r of m.rules)html+='<section class="block boundary rule" data-outline="'+esc(r.title)+'"><header class="block-head"><h3 class="block-title">'+esc(r.title)+'</h3>'+src(ctx,r.line)+'</header><div class="block-body">'+(r.items.length?'<ul>'+r.items.map(i=>textItem(i,ctx)).join('')+'</ul>':block(r.raw,ctx.url))+'</div></section>';
      if(m.questions.length)html+='<section class="open-panel" data-outline="Still open"><h3 class="group-title">Still open</h3><ul>'+m.questions.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      return html+generic(m.other,ctx)+'</div>';
    }
    function commandsHTML(list,ctx){return list.length?'<ul class="commands">'+list.map(c=>'<li><code>'+esc(c.text)+'</code><button type="button" class="copy" data-copy="'+esc(c.text)+'" aria-label="Copy '+esc(c.text)+'">Copy</button>'+src(ctx,c.line)+'</li>').join('')+'</ul>':''}
    function treeHTML(t){
      return '<div class="tree">'+t.nodes.map(n=>'<div class="tree-line'+(n.dir?' dir':'')+'"><span class="tree-path"><span class="tree-guide">'+esc(n.guide)+'</span>'+(n.href?'<a href="'+esc(n.href)+'" target="_blank" rel="noopener noreferrer" title="Open '+esc(n.full)+' on GitHub">'+esc(n.path)+'</a>':esc(n.path))+'</span><span class="tree-side"><span class="tree-note">'+esc(n.note)+'</span>'+n.tags.map(tag=>'<span class="tag'+(/start|entry/i.test(tag)?' start':/do not|generated|history/i.test(tag)?' hold':'')+'">'+esc(tag)+'</span>').join('')+'</span></div>').join('')+'</div>';
    }
    function structureView(record,ctx){
      const m=structure(record.content,ctx.url);if(m.empty)return null;
      let html=open('structure','rich')+header('structure',record,ctx,m.title)+(m.lede?'<div class="lede">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.readFirst.length)html+='<section class="detail-hero start" data-outline="Read first"><span>Read first</span><ul>'+m.readFirst.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      html+='<div class="blocks rows">'+m.trees.map(t=>'<section class="block directory" data-outline="'+esc(t.title)+'"><header class="block-head"><h3 class="block-title">'+esc(t.title)+'</h3>'+src(ctx,t.line)+'</header><div class="block-body">'+treeHTML(t)+'</div></section>').join('')+'</div>';
      if(m.commands.length)html+='<section class="commands-panel" data-outline="Commands"><h3 class="group-title">Commands</h3>'+commandsHTML(m.commands,ctx)+'</section>';
      for(const f of m.flows)html+='<section class="flow-panel" data-outline="'+esc(f.title)+'"><h3 class="group-title">'+esc(f.title)+' '+src(ctx,f.line)+'</h3><ol class="flow">'+f.edges.map(([a,b])=>'<li><span>'+esc(a)+'</span><i aria-hidden="true">→</i><span>'+esc(b)+'</span></li>').join('')+'</ol></section>';
      for(const t of m.tables)html+='<section class="block wide" data-outline="'+esc(t.title)+'"><header class="block-head"><h3 class="block-title">'+esc(t.title)+'</h3>'+src(ctx,t.line)+'</header><dl class="pairs">'+t.rows.map(r=>'<div><dt>'+inline(r.cells[0]||'',ctx.url)+'</dt><dd>'+inline(r.cells.slice(1).join(' · '),ctx.url)+'</dd></div>').join('')+'</dl></section>';
      return html+generic(m.other,ctx)+'</div>';
    }
    function techstackView(record,ctx){
      const m=techstack(record.content,ctx.url);if(m.empty)return null;
      let html=open('techstack','rich')+header('techstack',record,ctx,m.title)+(m.lede?'<div class="lede">'+block(m.lede.text,ctx.url)+'</div>':'');
      if(m.gaps.length)html+='<section class="block card warning gaps" data-outline="To verify"><header class="block-head"><h3 class="block-title">To verify</h3></header><ul>'+m.gaps.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      for(const g of m.groups){
        html+='<section class="tool-group" data-outline="'+esc(g.title)+'"><h3 class="group-title">'+esc(g.title)+' <small>'+g.cards.length+'</small> '+src(ctx,g.line)+'</h3><div class="tool-grid">'+g.cards.map(c=>take(ctx)?'<section class="tool-card'+(c.unknown?' unknown':'')+'"><div class="tool-top"><div class="tool-mark" aria-hidden="true">'+esc(c.name.slice(0,2).toUpperCase())+'</div>'+(c.version?'<span class="version">'+esc(c.version)+'</span>':'')+(c.unknown?'<span class="badge warn">Not confirmed</span>':'')+'</div><h4>'+esc(c.name)+'</h4><dl>'+c.fields.map(f=>'<dt>'+esc(f.label)+'</dt><dd>'+inline(f.value,ctx.url)+'</dd>').join('')+'</dl><div class="item-meta">'+src(ctx,c.line)+'</div></section>':'').join('')+'</div>'+(g.notes.trim()?'<div class="block-body tool-notes">'+block(g.notes,ctx.url)+'</div>':'')+'</section>';
      }
      if(m.evidence.length)html+='<section class="brief-list" data-outline="Evidence"><h3 class="group-title">Evidence</h3><ul>'+m.evidence.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      return html+generic(m.other,ctx)+capNote(ctx)+'</div>';
    }
    function readmeView(record,ctx){
      const m=readme(record.content,ctx.url);if(m.empty)return null;
      let html=open('readme','rich')+header('readme',record,ctx,m.title);
      if(m.pitch)html+='<div class="detail-hero" data-outline="What this is"><span>What this is</span>'+block(m.pitch.text,ctx.url)+src(ctx,m.pitch.line)+'</div>';
      if(m.gets.length)html+='<section class="gets" data-outline="What you get"><h3 class="group-title">What you get</h3><ul class="get-grid">'+m.gets.map(i=>textItem(i,ctx,'get')).join('')+'</ul></section>';
      if(m.steps.length)html+='<ol class="guide-steps">'+m.steps.map(s=>'<li class="guide-step" data-outline="'+esc(s.title)+'"><header class="block-head"><h3 class="block-title">'+esc(s.title)+'</h3>'+src(ctx,s.line)+'</header><div class="block-body">'+block(s.raw,ctx.url)+'</div>'+commandsHTML(m.commands.filter(c=>c.line>s.line&&s.raw.includes(c.text)),ctx)+'</li>').join('')+'</ol>';
      html+=generic(m.other,ctx);
      if(m.records.length)html+='<section class="brief-list" data-outline="Project records"><h3 class="group-title">Project records</h3><ul class="plain-list">'+m.records.map(i=>textItem(i,ctx)).join('')+'</ul></section>';
      return html+'</div>';
    }
    function listView(key,record,ctx){
      const list=rows(key,record.content,ctx.url),title=scan(record.content).title;
      let html=open(key,'list',' list-density')+header(key,record,ctx,title)+'<div class="rows-list">',group=null,shown=0;
      for(const r of list){
        if(shown>=LIST_LIMIT){ctx.skipped++;continue}shown++;
        if(r.group!==group){if(group!==null)html+='</ol></section>';group=r.group;html+='<section class="rows-group"'+(group?' data-outline="'+esc(group)+'"':'')+'>'+(group?'<h3 class="rows-group-title">'+esc(group)+(r.groupDate&&r.groupDate!==group?' '+time(r.groupDate,ctx.now):r.groupDate?' <small>'+time(r.groupDate,ctx.now)+'</small>':'')+'</h3>':'')+'<ol class="rows">'}
        const tag=r.status?'<span class="pill" data-status="'+r.status+'">'+esc(r.tag||LANE_LABEL[r.status]||r.status)+'</span>':r.tag?'<span class="pill">'+esc(r.tag)+'</span>':'';
        html+='<li class="row"'+(r.status?' data-status="'+r.status+'"':'')+'>'+tag+'<span class="row-main"><strong>'+esc(r.label)+'</strong>'+(r.text?' <span class="row-text">'+esc(r.text)+'</span>':'')+'</span><span class="row-meta">'+(r.date?time(r.date,ctx.now):r.when?'<span class="when">'+esc(r.when)+'</span>':'')+chips(r.proof)+(r.copy?'<button type="button" class="copy" data-copy="'+esc(r.copy)+'" aria-label="Copy '+esc(r.copy)+'">Copy</button>':'')+src(ctx,r.line)+'</span></li>';
      }
      if(group!==null)html+='</ol></section>';
      return html+'</div>'+capNote(ctx)+'</div>';
    }
    const VIEWS={progress:progressView,changelog:changelogView,vision:visionView,brain:brainView,structure:structureView,techstack:techstackView,readme:readmeView};
    /* HTML for a record, or null when the record does not follow its template and the generic overview fits better. */
    function render(key,record,opts={}){
      if(!record||record.error||typeof record.content!=='string')return null;
      const mode=opts.mode==='list'?'list':'rich',ctx={url:record.url,now:opts.now??Date.now(),mode,links:opts.links||0,budget:RICH_LIMIT,skipped:0};
      if(mode==='list')return listView(key,record,ctx);
      return VIEWS[key]?VIEWS[key](record,ctx):null;
    }
    return {isoDate,relative,proofKind,linksIn,sourceLink,prRef,progress,changelog,vision,brain,structure,techstack,readme,rows,render,toggle};
  }
})(globalThis);
