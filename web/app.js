'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const names={vision:'VISION.md',progress:'PROGRESS.md',brain:'BRAIN.md',structure:'STRUCTURE.md',readme:'README.md',changelog:'CHANGELOG.md',techstack:'TECHSTACK.md'};
let projects=[],current=0,zoom=1,records={},opener=null,request=0,scanRun=0;
const session=$('meta[name="horsemen-session"]').content;
const riders=['vision','progress','brain','structure'];
const icon=(name,cls='icon')=>'<svg class="'+cls+'" aria-hidden="true"><use href="/assets/icons/'+(name.startsWith('seal-')?'seals':'icons')+'.svg#'+name+'"/></svg>';
const kindIcon=kind=>kind==='document'?'document':kind==='external'?'external':'link';
const {escapeHTML,safeURL}=HorsemenMarkdown;
const renderMarkdown=(text,base)=>HorsemenMarkdown.render(text,base);
const hosted=!!window.HorsemenHosted, copy=(local,remote)=>hosted?remote:local;
async function api(path,method='GET'){if(hosted)return HorsemenHosted.api(path,method);const r=await fetch(path,{method,headers:{'X-Horsemen-Session':session},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function showToast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500)}
let peekTrail=[],peekRequest=0,peekMode='overview';
let pendingLink=(m=>m?{p:m[1],r:m[2]}:null)(location.hash.match(/^#p=([a-f0-9]{24})(?:&r=([a-z]+))?$/));
function syncHash(){
  const p=projects[current],key=$('#peek').open?peekTrail[0]?.key:null,hash=p?'#p='+p.id+(Object.hasOwn(names,key||'')?'&r='+key:''):'';
  if(location.hash!==hash)try{history.replaceState(null,'',hash||location.pathname)}catch{}
}
function setTab(source){setPeekMode(source?'source':'overview')}
function setPeekMode(mode){
  peekMode=mode;$('#peek-content').hidden=mode==='source';$('#source-content').hidden=mode!=='source';
  for(const [id,value] of [['reading-tab','overview'],['document-tab','document'],['source-tab','source']]){const b=$('#'+id);b.classList.toggle('active',mode===value);b.setAttribute('aria-pressed',mode===value)}
  renderPeek();
}
function openPeek(key,button){const r=records[key];if(!r)return;opener=button;peekRequest++;peekTrail=[{key,record:r,nodeId:key}];peekMode='overview';renderPeek();if(!$('#peek').open)$('#peek').showModal();markOutline();$('.peek-content').focus({preventScroll:true});syncHash()}
const riderLine={vision:'I · Conquest · Direction',progress:'II · War · Campaign',brain:'III · Famine · Knowledge',structure:'IV · Death · Skeleton',readme:'Supporting record · The front door',changelog:'Supporting record · Delivery proof',techstack:'Supporting record · How the parts fit'};
const two=n=>String(n).padStart(2,'0');
/* One section of a record: a numbered heading, what it holds, and its content. */
function blockHTML(section,record,opts={}){
  const info=HorsemenPreview.shape(section.body),count=info.kind==='list'?info.count+(info.count===1?' item':' items'):info.kind==='table'?info.count+(info.count===1?' row':' rows'):'';
  return '<section class="block '+(opts.cls||'')+'" data-outline="'+escapeHTML(section.title)+'"><header class="block-head">'+(opts.no?'<span class="block-no">'+opts.no+'</span>':'')+'<h3 class="block-title">'+escapeHTML(section.title)+'</h3>'+(count?'<span class="block-count">'+count+'</span>':'')+'</header><div class="block-body">'+(opts.body??renderMarkdown(section.body,record.url))+'</div></section>';
}
const rowsHTML=(sections,record,cls=()=>'',start=0)=>sections.length?'<div class="blocks rows">'+sections.map((s,i)=>blockHTML(s,record,{no:two(start+i+1),cls:cls(s)})).join('')+'</div>':'';
const timelineHTML=(entries,record,outline)=>'<div class="timeline">'+entries.map(s=>'<section class="timeline-entry"'+(outline?' data-outline="'+escapeHTML(s.title)+'"':'')+'><h3 class="block-title">'+escapeHTML(s.title)+'</h3><div class="block-body">'+renderMarkdown(s.body,record.url)+'</div></section>').join('')+'</div>';
function treeHTML(body,record){
  const fence=body.match(/```[^\n]*\n([\s\S]*?)\n\s*```/);if(!fence)return null;
  const rest=(body.slice(0,fence.index)+body.slice(fence.index+fence[0].length)).trim();
  return '<div class="tree">'+HorsemenPreview.tree(fence[1]).map(l=>'<div class="tree-line'+(l.path.endsWith('/')?' dir':'')+'"><span class="tree-path"><span class="tree-guide">'+escapeHTML(l.guide)+'</span>'+escapeHTML(l.path)+'</span><span class="tree-note">'+escapeHTML(l.note)+'</span></div>').join('')+'</div>'+(rest?renderMarkdown(rest,record.url):'');
}
/* The layout choice (rich or list) is saved for each record type. Only these two values are kept. */
const viewChoices=()=>{try{const saved=JSON.parse(localStorage.getItem('horsemen-peek-views')||'{}');return saved&&typeof saved==='object'?saved:{}}catch{return {}}};
const viewMode=key=>viewChoices()[key]==='list'?'list':'rich';
function setViewMode(key,mode){const saved=viewChoices();saved[key]=mode==='list'?'list':'rich';try{localStorage.setItem('horsemen-peek-views',JSON.stringify(saved))}catch{}}
function overviewHTML(key,record){
  const shown=HorsemenViews.render(key,record,{mode:viewMode(key),now:Date.now(),links:record.connections?.length||0});
  if(shown)return shown;
  const P=HorsemenPreview,text=record.content||'',model=P.detail(key,text),stated=P.facts(text);
  let sections=model.sections,hero=null,lede=P.lede(text);
  if(key==='progress'){const next=P.preview(key,text).items.find(i=>i.label==='Next action');if(next)hero={label:'Next action',html:'<p>'+escapeHTML(next.text)+'</p>'}}
  if(key==='vision'){const purpose=sections.find(s=>/why|purpose|mission/i.test(s.title));if(purpose&&purpose.kind==='prose'&&purpose.body.length<420){hero={label:purpose.title,html:renderMarkdown(purpose.body,record.url)};sections=sections.filter(s=>s!==purpose)}}
  const withoutNext=body=>hero&&key==='progress'?body.split('\n').filter(l=>!/^\s*(?:\*\*)?Next action:/i.test(l)).join('\n').trim():body;
  lede=withoutNext(lede);
  const facts=[...stated,...(model.sections.length?[{label:'Sections',value:String(model.sections.length)}]:[]),...(record.connections?.length?[{label:'Links',value:String(record.connections.length)}]:[])];
  let html='<div class="artifact-overview '+model.layout+'" data-layout="'+model.layout+'"><header class="page-head">'+(riders.includes(key)?icon('seal-'+key,'overview-seal'):'')+'<div class="detail-eyebrow">'+escapeHTML(riderLine[key]||'Connected document')+'</div><h2>'+escapeHTML(model.title||record.name||'Untitled')+'</h2>'+(facts.length?'<dl class="facts">'+facts.map(f=>'<div><dt>'+escapeHTML(f.label)+'</dt><dd>'+escapeHTML(f.value)+'</dd></div>').join('')+'</dl>':'')+'<div class="view-bar">'+HorsemenViews.toggle(key,'rich')+'</div></header>';
  if(hero)html+='<div class="detail-hero"><span>'+escapeHTML(hero.label)+'</span>'+hero.html+'</div>';
  if(lede)html+='<div class="lede">'+renderMarkdown(lede,record.url)+'</div>';
  if(key==='brain')html+='<p class="detail-intro">Knowledge stays with its original source. Open a connection to explore it, or read the access rules below.</p><div data-connections-slot></div>';
  if(key==='progress'){
    const past=s=>/^(historical|history|upcoming|roadmap|archive)/i.test(s.title),cards=[],wide=[];
    const place=(title,body)=>{if(body)(P.shape(body).kind==='table'?wide:cards).push({title,body})};
    for(const s of sections.filter(s=>!past(s))){const parts=P.split(withoutNext(s.body));place(s.title,parts.lead);for(const sub of parts.subs)place(sub.title,sub.body)}
    if(cards.length)html+='<div class="blocks board">'+cards.map(c=>blockHTML(c,record,{cls:'card'+(/gate|block|risk/i.test(c.title)?' warning':'')})).join('')+'</div>';
    html+=rowsHTML(wide,record,()=>'wide');
    for(const s of sections.filter(past)){
      const parts=P.split(s.body);
      html+='<details class="fold" data-outline="'+escapeHTML(s.title)+'"><summary><span>'+escapeHTML(s.title)+'</span>'+(parts.subs.length?'<small>'+parts.subs.length+(parts.subs.length===1?' entry':' entries')+'</small>':'')+'</summary>'+(parts.lead?'<div class="block-body">'+renderMarkdown(parts.lead,record.url)+'</div>':'')+(parts.subs.length?timelineHTML(parts.subs,record,false):'')+'</details>';
    }
  }else if(key==='structure'){
    const map=sections.find(s=>/^map$|tree|layout|structure/i.test(s.title)),tree=map&&treeHTML(map.body,record);
    if(tree)html+='<div class="blocks rows">'+blockHTML(map,record,{no:'01',cls:'directory',body:tree})+'</div>';
    html+=rowsHTML(sections.filter(s=>!tree||s!==map),record,()=>'',tree?1:0);
  }else if(key==='changelog'){
    html+=timelineHTML(sections,record,true);
  }else if(key==='techstack'){
    html+='<div class="blocks rows">'+sections.map((section,i)=>{
      const table=P.toolsTable(section.body);if(!table.rows.length)return blockHTML(section,record,{no:two(i+1)});
      const notes=section.body.split('\n').filter(line=>!line.includes('|')).join('\n').trim();
      return blockHTML(section,record,{no:two(i+1),cls:'wide',body:'<div class="tool-grid">'+table.rows.map(row=>'<section class="tool-card"><div class="tool-mark" aria-hidden="true">'+escapeHTML(row[0].slice(0,2).toUpperCase())+'</div><h4>'+escapeHTML(row[0])+'</h4><dl>'+row.slice(1).map((cell,j)=>'<dt>'+escapeHTML(table.headers[j+1]||'Details')+'</dt><dd>'+escapeHTML(cell)+'</dd>').join('')+'</dl></section>').join('')+'</div>'+(notes?renderMarkdown(notes,record.url):'')});
    }).join('')+'</div>';
  }else{
    html+=rowsHTML(sections,record,s=>/boundar|never|access|permission/i.test(s.title)?'boundary':'');
  }
  if(!lede&&!hero&&!model.sections.length)html+='<p class="empty-record">This record is empty.</p>';
  return html+'</div>';
}
function renderPeek(){
  const entry=peekTrail.at(-1);if(!entry)return;
  const r=entry.record;$('#peek').dataset.kind=entry.key;$('#peek-kind').innerHTML=icon(Object.hasOwn(names,entry.key)?entry.key:kindIcon(entry.link?.kind||'document'));$('#peek-title').textContent=r.name||entry.link?.title||'Document';
  $('#peek-back').hidden=peekTrail.length<2;
  renderPeekPath();
  $('#source-content').textContent=r.content||r.error||'This external document has not been loaded.';
  $('#peek-content').hidden=peekMode==='source';$('#source-content').hidden=peekMode!=='source';
  for(const [id,mode] of [['reading-tab','overview'],['document-tab','document'],['source-tab','source']]){const b=$('#'+id);b.classList.toggle('active',peekMode===mode);b.setAttribute('aria-pressed',peekMode===mode)}
  const content=$('#peek-content');content.replaceChildren();content.dataset.mode=peekMode;$('.peek-content').scrollTo({top:0,behavior:'instant'});
  if(entry.link&&entry.link.kind!=='document'){
    const ref=HorsemenViews.proofKind(entry.link.href),pr=HorsemenViews.prRef(entry.link.href),kinds={pr:'Pull request',commit:'Commit',release:'Release',checks:'Checks',issue:'Issue'};
    content.innerHTML='<div class="external-document"><span class="detail-eyebrow">'+escapeHTML(kinds[ref?.kind]||entry.link.kind)+'</span><h2>'+escapeHTML(entry.link.title)+'</h2>'+(ref&&kinds[ref.kind]?'<p class="ref-chip"><span class="chip '+ref.kind+'">'+escapeHTML(ref.label)+'</span></p>':'')+'<p>Linked from '+escapeHTML(entry.link.source)+'. The contents have not been loaded into Horsemen.</p><p class="external-address">'+escapeHTML(entry.link.href)+'</p></div>';
    if(pr&&pr.repo===projects[current]?.repo){const area=document.createElement('section');area.className='evidence-block';area.innerHTML='<h3>Pull request details</h3><p>Load the title, merge state, and description from GitHub. A merged PR alone does not prove delivery.</p>';area.append(prButton(area,pr.number));content.firstChild.append(area)}
  }else if(r.error)content.innerHTML='<div class="callout amber">'+escapeHTML(r.error)+'</div>';
  else content.innerHTML=peekMode==='document'?renderMarkdown(r.content||'',r.url):overviewHTML(entry.key,r);
  const href=r.url||entry.link?.href;
  if(href&&safeURL(href,location.href)){
    const a=document.createElement('a');a.className='original-source';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.innerHTML=(entry.link?.kind==='external'?'Open external source':'Open original source')+icon('arrow-up-right');content.prepend(a);
  }
  if(r.connections?.length){
    const panel=document.createElement('section');panel.className='connections-panel';
    panel.dataset.outline='Connected artifacts';panel.innerHTML='<div class="connections-heading"><h3>Connected artifacts <span>'+r.connections.length+'</span></h3></div><div class="connection-grid"></div>';
    const graph=document.createElement('button');graph.className='btn';graph.textContent='Explore on canvas';graph.onclick=()=>{expandConnections(entry.nodeId,r);$('#peek').close();fitCanvas()};panel.querySelector('.connections-heading').append(graph);
    if(expandedConnections.has(entry.nodeId)){const collapse=document.createElement('button');collapse.className='btn';collapse.textContent='Collapse links';collapse.onclick=()=>{expandedConnections.delete(entry.nodeId);refreshGraph();renderPeek()};panel.querySelector('.connections-heading').append(collapse)}
    for(const link of r.connections){const b=document.createElement('button');b.className='connection-card';b.dataset.connection=link.id;b.innerHTML='<span class="connection-type">'+icon(kindIcon(link.kind))+escapeHTML(link.kind==='document'?'Markdown document':link.kind)+'</span><strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+'</small>';b.onclick=()=>openConnection(link,entry.nodeId);panel.querySelector('.connection-grid').append(b)}
    const slot=content.querySelector('[data-connections-slot]');if(slot)slot.replaceWith(panel);else content.append(panel);
    content.querySelectorAll('a').forEach(a=>{const link=r.connections.find(l=>l.href===a.href);if(link&&!a.classList.contains('original-source'))a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();openConnection(link,entry.nodeId)}});
  }else if(entry.key==='brain'&&!r.error){const slot=content.querySelector('[data-connections-slot]');if(slot)slot.innerHTML='<div class="connection-empty">No Markdown links found in this record. Add source links to BRAIN.md to connect documents here.</div>'}
  if(entry.key==='changelog'&&!r.error&&peekMode==='overview')addEvidence(r);
  renderPeekNav();
}
/* The path to this document. Each earlier step is a way back. */
function renderPeekPath(){
  const path=$('#peek-meta');path.replaceChildren();
  const add=(text,go)=>{if(path.childNodes.length)path.append(Object.assign(document.createElement('span'),{className:'sep',textContent:'/'}));const el=document.createElement(go?'button':'span');el.textContent=text;if(go)el.onclick=go;else el.className='here';path.append(el)};
  if(projects[current])path.append(Object.assign(document.createElement('span'),{className:'root',textContent:projects[current].name}));
  peekTrail.forEach((e,i)=>add(e.record.name||e.link?.title||'Document',i<peekTrail.length-1?()=>{peekRequest++;peekTrail.length=i+1;peekMode='overview';renderPeek()}:null));
}
const readable=()=>Object.keys(names).filter(key=>records[key]&&!records[key].error);
function stepRecord(delta){const order=readable(),at=order.indexOf(peekTrail[0]?.key);if(order.length<2)return;const key=order[(Math.max(at,0)+delta+order.length)%order.length];openPeek(key,$('[data-artifact="'+key+'"]'))}
let outlineTargets=[];
function renderPeekNav(){
  const list=$('#peek-records'),root=peekTrail[0]?.key;list.replaceChildren();
  for(const key of Object.keys(names)){
    const r=records[key],b=document.createElement('button');b.className='peek-record '+key+(r?.error?' missing':'');b.dataset.record=key;b.disabled=!r;
    b.innerHTML=icon(key)+'<span>'+escapeHTML(names[key])+'<small>'+escapeHTML(r?.error?'Missing or unreadable':riderLine[key].split(' · ').at(-1))+'</small></span>';
    if(key===root)b.setAttribute('aria-current',peekTrail.length===1?'page':'true');
    b.onclick=()=>openPeek(key,$('[data-artifact="'+key+'"]'));list.append(b);
  }
  const order=readable(),at=order.indexOf(root);
  for(const [id,delta] of [['#peek-prev',-1],['#peek-next',1]]){const b=$(id);b.hidden=order.length<2;if(!b.hidden)b.querySelector('span').textContent=names[order[(Math.max(at,0)+delta+order.length)%order.length]]}
  const outline=$('#peek-outline');outline.replaceChildren();
  outlineTargets=peekMode==='source'?[]:[...$('#peek-content').querySelectorAll(peekMode==='document'?'h1,h2,h3':'[data-outline]')];
  outlineTargets.forEach((el,i)=>{
    el.id='peek-section-'+i;const b=document.createElement('button');b.textContent=el.dataset.outline||el.textContent;b.dataset.target=el.id;if(el.tagName==='H3'&&!el.dataset.outline)b.className='sub';
    b.onclick=()=>{if(el.tagName==='DETAILS')el.open=true;el.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})};outline.append(b);
  });
  $('#peek-outline-nav').hidden=outlineTargets.length<2;markOutline();
}
function markOutline(){
  const area=$('.peek-content'),top=area.getBoundingClientRect().top;let active=outlineTargets[0];
  /* Before the sheet is shown nothing has a position, so the first section stays marked. */
  if(area.clientHeight)for(const el of outlineTargets)if(el.getBoundingClientRect().top-top<=120)active=el;
  for(const b of $('#peek-outline').children){const on=b.dataset.target===active?.id;if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')}
}
let outlineFrame=0;$('.peek-content').addEventListener('scroll',()=>{cancelAnimationFrame(outlineFrame);outlineFrame=requestAnimationFrame(markOutline)},{passive:true});
$('#peek-prev').onclick=()=>stepRecord(-1);$('#peek-next').onclick=()=>stepRecord(1);
$('#peek').addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||!['ArrowLeft','ArrowRight'].includes(e.key)||e.target.closest('input,textarea,select,.table-wrap,pre'))return;
  e.preventDefault();stepRecord(e.key==='ArrowLeft'?-1:1);
});
async function openConnection(link,parentId){
  const nodeId=ensureConnectionNode(parentId,link,false),existing=Object.entries(records).find(([,r])=>r.path===link.path);
  if(peekTrail.length>=32){showToast('Return to an earlier document before going deeper.');return}
  const entry={key:existing?.[0]||'document',record:existing?.[1]||{name:link.title,error:link.kind==='document'?'Loading linked document…':null},link,nodeId};
  peekTrail.push(entry);peekMode='overview';const version=++peekRequest,projectVersion=request;renderPeek();if(!$('#peek').open)$('#peek').showModal();markOutline();
  if(existing||link.kind!=='document')return;
  try{const record=await api('/api/document?id='+projects[current].id+'&link='+link.id);if(version!==peekRequest||projectVersion!==request||!$('#peek').open)return;entry.record=record;const node=connectionNodes.get(nodeId);if(node)node.record=record;renderPeek()}
  catch(e){if(version!==peekRequest||projectVersion!==request)return;entry.record={name:link.title,error:e.message};renderPeek()}
}
$('#peek-back').onclick=()=>{peekRequest++;peekTrail.pop();peekMode='overview';renderPeek()};
$('#document-tab').onclick=()=>setPeekMode('document');

function prButton(area,n){const p=projects[current],b=document.createElement('button');b.className='btn';b.textContent='Load PR #'+n;b.onclick=async()=>{const version=request;b.disabled=true;try{const pr=await api('/api/pr?project='+p.id+'&number='+n);if(version!==request)return;const box=document.createElement('div');box.innerHTML='<h3>'+escapeHTML(pr.title)+'</h3><p>'+escapeHTML(pr.merged?'Merged · '+pr.merged_at:pr.state)+' · '+escapeHTML(pr.merge_commit_sha||'No merge commit')+'</p>'+renderMarkdown(pr.body||'No PR description.',pr.html_url);area.append(box);b.remove()}catch(e){b.disabled=false;showToast(e.message)}};return b}
function addEvidence(record){const p=projects[current],area=document.createElement('section');area.className='evidence-block';area.dataset.outline='Delivery evidence';area.innerHTML='<h3>Delivery evidence & PRs</h3><p>The source above owns the delivery claim. A merged PR alone does not prove delivery. Attachments below come from the PR description; comments are not scanned.</p>';const urls=[...record.content.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g)].filter(m=>m[1]===p.repo);for(const n of new Set(urls.map(m=>m[2])))area.append(prButton(area,n));if(!urls.length)area.insertAdjacentHTML('beforeend','<p>No same-repository PR links found in this record.</p>');$('#peek-content').append(area)}
/* View toggle and Copy buttons inside the peek. The content is replaced on each render, so the handler sits on its container. */
$('#peek-content').addEventListener('click',e=>{
  const choice=e.target.closest('[data-view-toggle] [data-view-choice]');
  if(choice){const key=peekTrail.at(-1)?.key;if(key){setViewMode(key,choice.dataset.viewChoice);renderPeek();$('#peek-content [data-view-choice="'+viewMode(key)+'"]')?.focus({preventScroll:true})}return}
  const copy=e.target.closest('[data-copy]');
  if(copy){const text=copy.dataset.copy;Promise.resolve(navigator.clipboard?.writeText(text)).then(()=>{if(!navigator.clipboard)throw Error();copy.textContent='Copied';setTimeout(()=>{copy.textContent='Copy'},1600)}).catch(()=>showToast('Copy is not available. Select the command and copy it.'))}
});
$('#reading-tab').onclick=()=>setTab(false);$('#source-tab').onclick=()=>setTab(true);$('#close-peek').onclick=()=>$('#peek').close();$('#peek').addEventListener('close',()=>{peekRequest++;opener?.focus({preventScroll:true});syncHash()});
for(const b of $$('[data-artifact]')){b.disabled=true;bindArtifact(b)}
function filter(){const q=$('#search').value.toLowerCase();let count=0;for(const b of $$('[data-artifact]')){b.hidden=!b.textContent.toLowerCase().includes(q);if(!b.hidden)count++}refreshGraph();$('#empty').hidden=$$('[data-artifact]').some(b=>!b.hidden)}
$('#search').oninput=filter;
function clearRecords(){request++;records={};clearConnections();if($('#peek').open)$('#peek').close();for(const id of ['#peek-title','#peek-meta','#peek-content','#source-content','#peek-records','#peek-outline'])$(id).replaceChildren();for(const b of $$('[data-artifact]')){b.disabled=true;const body=b.querySelector('.cardbody');if(body)body.innerHTML='<p>Waiting for source…</p>';const foot=b.querySelector('.cardfoot');if(foot)foot.textContent='Not loaded'}}
async function selectProject(index){clearRecords();const version=request;current=index;const p=projects[index];$('#project-name').textContent=p.name;$('#crumb').textContent=p.name;$('#project-description').textContent=p.repo+(p.root?' / '+p.root:'')+' · '+p.revision.slice(0,7);$('#privacy').textContent=p.private?'PRIVATE':'PUBLIC SOURCE';$$('[data-project]').forEach(b=>b.classList.toggle('active',+b.dataset.project===index));syncHash();document.body.dataset.state='loading';$('#search').value='';filter();loadCanvas();try{const data=await api('/api/project?id='+p.id);if(version!==request)return;records=data.records;for(const b of $$('[data-artifact]')){const r=records[b.dataset.artifact];b.disabled=false;const body=b.querySelector('.cardbody'),foot=b.querySelector('.cardfoot');if(body)body.innerHTML=previewHTML(b.dataset.artifact,r);
if(foot)foot.textContent=r.error?names[b.dataset.artifact]+' · missing or unreadable':names[b.dataset.artifact]+' · pinned '+p.revision.slice(0,7);
if(b.classList.contains('supporter')){
  b.querySelector('small').textContent=r.error?'Missing or unreadable':(HorsemenPreview.preview(b.dataset.artifact,r.content).items[0]?.text||'Empty record');
}
}installRecordLinks();refreshGraph();document.body.dataset.state='ready';loadCanvas();if(pendingLink?.p===p.id){const key=pendingLink.r;pendingLink=null;if(key&&records[key])openPeek(key,$('[data-artifact="'+key+'"]'))}}catch(e){if(version!==request)return;document.body.dataset.state='error';$('#scan-status').textContent=e.message}}
function previewHTML(key,record){
  if(record.error)return '<h2>Not available</h2><p>'+escapeHTML(record.error)+'</p>';
  const model=HorsemenPreview.preview(key,record.content);
  return model.items.length?model.items.map(item=>'<div class="preview-field"><strong>'+escapeHTML(item.label)+'</strong><p>'+escapeHTML(item.text)+'</p></div>').join(''):'<p>This record is empty. Open the source to inspect it.</p>';
}
function renderProjects(){
  const nav=$('#projects'),query=$('#project-search').value;nav.replaceChildren();let shown=0;
  projects.forEach((p,i)=>{
    if(!HorsemenPreview.matchesProject(p,query))return;shown++;
    const b=document.createElement('button');b.className='project';b.dataset.project=i;
    b.classList.toggle('active',i===current);b.setAttribute('aria-pressed',i===current);
    b.innerHTML='<strong>'+escapeHTML(p.name)+'</strong><small>'+escapeHTML(p.repo+(p.root?' / '+p.root:''))+'</small>';
    b.onclick=()=>{pendingLink=null;selectProject(i)};nav.append(b);
  });
  $('#project-count').textContent=shown+' of '+projects.length+' projects';$('#no-projects').hidden=shown!==0||!query.trim();
}
$('#project-search').oninput=renderProjects;
function receiveProjects(found){
  const selected=projects[current]?.id;
  projects=found.sort((a,b)=>a.repo.localeCompare(b.repo)||a.root.localeCompare(b.root));
  const index=projects.findIndex(p=>p.id===selected);current=Math.max(0,index);renderProjects();
  const wanted=pendingLink?projects.findIndex(p=>p.id===pendingLink.p):-1;
  if(wanted>=0&&projects[current]?.id!==pendingLink.p)selectProject(wanted);
  else if(index<0&&projects.length)selectProject(0);
}
async function scan(){const run=++scanRun;clearRecords();projects=[];renderProjects();$('#connect').disabled=true;$('#crumb').textContent='';$('#privacy').textContent=copy('LOCAL','READ-ONLY');$('#account').textContent=copy('Local GitHub workspace','GitHub workspace');$('#project-name').textContent='Discovering your projects';$('#project-description').textContent=copy('Reading default branches. Your files stay on this machine.','Reading default branches. Horsemen stores none of your project data.');document.body.dataset.state='scanning';try{await api('/api/scan','POST');while(run===scanRun){const state=await api('/api/status');if(run!==scanRun)return;$('#account').textContent=state.account?'GitHub · '+state.account:copy('Local GitHub workspace','GitHub workspace');$('#scan-status').textContent=state.phase==='error'?'Discovery failed':state.completed+' / '+state.total+' repositories checked · '+state.projects.length+' projects found'+(state.phase==='scanning'?' · Scanning…':'');$('#issues').hidden=!state.issues.length;$('#issues').textContent=state.issues.map(i=>(i.repo?i.repo+': ':'')+i.message).join('\n');receiveProjects(state.projects);if(state.phase!=='scanning'){if(!projects.length){document.body.dataset.state=state.phase;$('#project-name').textContent=state.phase==='error'?'GitHub needs attention':'No Horsemen projects found';$('#project-description').textContent='Projects need at least two core records, including VISION or PROGRESS (legacy STATUS is supported).'}break}await new Promise(r=>setTimeout(r,1000))}}catch(e){if(run===scanRun){$('#scan-status').textContent=e.message;document.body.dataset.state='error'}}finally{if(run===scanRun)$('#connect').disabled=false}}
$('#connect').onclick=scan;$('#clear').onclick=async()=>{scanRun++;clearRecords();projects=[];renderProjects();await api('/api/clear','POST');$('#connect').disabled=false;$('#account').textContent=copy('Local GitHub workspace','GitHub workspace');$('#crumb').textContent='';$('#issues').textContent='';$('#project-name').textContent='Workspace cleared';$('#project-description').textContent='Refresh GitHub to load your projects again.';$('#scan-status').textContent=copy('Local memory cleared. GitHub sign-in is unchanged.','Workspace cleared from this tab. You are still signed in.');$('#privacy').textContent=copy('LOCAL','READ-ONLY');$('#issues').hidden=true;document.body.dataset.state='idle';syncHash()};
const canvas=$('.canvas'), world=$('#map');
const defaults={vision:[0,0],progress:[440,0],brain:[0,400],structure:[440,400],readme:[0,800],changelog:[280,800],techstack:[560,800]};
let layouts={},camera={x:30,y:30,z:1},gesture=null,spaceDown=false,suppressClick=null,pinch=null;
const pointers=new Map();let highestLayer=2;
let selected=new Set(),tool='select';const expandedConnections=new Map(),baseRelations=[],loadingLinks=new Set();
try{const saved=JSON.parse(localStorage.getItem('horsemen-local-layouts-v1')||'{}');for(const [id,layout] of Object.entries(saved)){const clean={};for(const key of Object.keys(layout)){if(!Object.hasOwn(defaults,key)&&!/^link-[a-f0-9]{24}$/.test(key))continue;const pos=layout[key];if(Array.isArray(pos)&&pos.length===2&&pos.every(n=>Number.isFinite(n)&&Math.abs(n)<1e7))clean[key]=pos}layouts[id]=clean}}catch{}
function positions(){return layouts[projects[current]?.id || "empty"]??(layouts[projects[current]?.id || "empty"]={})}
function position(key){return positions()[key]??defaults[key]}
function saveLayout(){try{localStorage.setItem('horsemen-local-layouts-v1',JSON.stringify(layouts))}catch{}}
const wires=document.createElementNS('http://www.w3.org/2000/svg','svg');wires.classList.add('wires');wires.setAttribute('aria-hidden','true');world.prepend(wires);
const relations=[];
const connectionNodes=new Map(),cardToggles=new Map();
function clearConnections(){
  for(const control of cardToggles.values())control.remove();cardToggles.clear();
  for(const node of connectionNodes.values()){node.element?.remove();delete defaults[node.id]}
  connectionNodes.clear();relations.length=0;baseRelations.length=0;expandedConnections.clear();loadingLinks.clear();selected.clear();peekTrail=[];peekRequest++;updateSelection();drawWires();
}
function ensureConnectionNode(parentId,link,visible){
  const core=Object.entries(records).find(([,r])=>r.path&&r.path===link.path);
  let id=core?.[0];
  if(!id){
    let node=[...connectionNodes.values()].find(n=>n.link.href===link.href);
    if(!node){id='link-'+link.id;node={id,link,parentId,element:null};connectionNodes.set(id,node)}else id=node.id;
    if(visible&&!node.element){
      const parent=position(parentId)||[0,0];const siblings=[...connectionNodes.values()].filter(n=>n.parentId===parentId&&n.element).length;
      defaults[id]=[parent[0]-350,parent[1]+siblings*210];
      const b=document.createElement('button');b.className='artifact connected-node';b.dataset.artifact=id;b.dataset.documentPath=link.path||'';
      b.innerHTML='<span class="connection-type">'+icon(kindIcon(link.kind))+escapeHTML(link.kind)+'</span><strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+'</small><span class="node-open">Double-click to open</span>';
      bindArtifact(b);world.append(b);node.element=b;
    }
  }
  if(visible&&parentId!==id){if(!expandedConnections.has(parentId))expandedConnections.set(parentId,new Set());expandedConnections.get(parentId).add(id)}
  return id;
}
function connectionTrail(parentId){
  const trail=[],seen=new Set();let id=parentId;
  while(id&&!seen.has(id)&&trail.length<31){seen.add(id);if(records[id]){trail.unshift({key:id,record:records[id],nodeId:id});break}const node=connectionNodes.get(id);if(!node)break;if(node.record)trail.unshift({key:'document',record:node.record,nodeId:id,link:node.link});id=node.parentId}
  return trail;
}
const shownLinks=()=>new Set([...connectionNodes.values()].filter(n=>n.element&&!n.element.hidden).map(n=>n.id));
/* Linked cards that just appeared take free space beside their parent. Cards already on the canvas and cards the operator moved stay put. */
function arrangeLinked(before){
  if(world.classList.contains('list'))return;
  const saved=positions(),moving=new Set([...shownLinks()].filter(id=>!before.has(id)&&!Object.hasOwn(saved,id)));if(!moving.size)return;
  const box=id=>{const el=$('[data-artifact="'+id+'"]'),p=position(id);return{x:p[0],y:p[1],w:el.offsetWidth,h:el.offsetHeight}};
  const fixed=$$('[data-artifact]').filter(el=>!el.hidden&&!moving.has(el.dataset.artifact)).map(el=>box(el.dataset.artifact));
  const groups=[],seen=new Set(Object.keys(names)),queue=[...seen];
  for(let i=0;i<queue.length;i++){
    const parent=queue[i],children=[];
    for(const child of expandedConnections.get(parent)||[]){if(seen.has(child))continue;seen.add(child);queue.push(child);if(moving.has(child)){const el=connectionNodes.get(child).element;children.push({id:child,w:el.offsetWidth,h:el.offsetHeight})}}
    if(children.length)groups.push(moving.has(parent)?{parentId:parent,children}:{parent:box(parent),children});
  }
  for(const [id,spot] of HorsemenCanvas.arrange(fixed,groups,40))defaults[id]=spot;
}
function expandConnections(parentId,record){
  const before=shownLinks();
  for(const id of HorsemenCanvas.pathToRoot(parentId,connectionNodes,Object.keys(names))){const node=connectionNodes.get(id);if(node)ensureConnectionNode(node.parentId,node.link,true)}
  for(const link of record.connections||[])ensureConnectionNode(parentId,link,true);
  $('#search').value='';refreshGraph();arrangeLinked(before);renderPositions();
}
function installRecordLinks(){
  for(const [key,r] of Object.entries(records)){
    for(const link of r.connections||[]){const target=Object.entries(records).find(([,v])=>v.path&&v.path===link.path);if(target&&target[0]!==key)baseRelations.push([key,target[0],'links to'])}

  }
}

function refreshGraph(){
  const visible=HorsemenCanvas.visibleGraph(Object.keys(names),expandedConnections),query=$('#search').value.toLowerCase();
  for(const node of connectionNodes.values())if(node.element)node.element.hidden=!visible.has(node.id)||!node.element.textContent.toLowerCase().includes(query);
  relations.length=0;
  for(const edge of baseRelations)relations.push(edge);
  for(const [parent,children] of expandedConnections){if(!visible.has(parent))continue;for(const child of children)if(child!==parent&&visible.has(child)&&!relations.some(([a,b])=>a===parent&&b===child))relations.push([parent,child,'links to'])}
  setSelection(selected);drawWires();
}
async function toggleConnections(id){
  if(expandedConnections.has(id)){expandedConnections.delete(id);refreshGraph();return}
  const version=request,token=version+':'+id,node=connectionNodes.get(id);let record=records[id]||node?.record;
  if(loadingLinks.has(token))return;loadingLinks.add(token);updateSelection();
  try{
    if(!record&&node?.link.kind==='document'){record=await api('/api/document?id='+projects[current].id+'&link='+node.link.id);if(version!==request)return;node.record=record}
    if(!record?.connections?.length){showToast(record?.error||'No linked documents found in this artifact.');return}
    expandConnections(id,record);
  }catch(error){if(version===request)showToast(error.message)}
  finally{loadingLinks.delete(token);if(version===request)updateSelection()}
}

function drawWires(){wires.replaceChildren();if(world.classList.contains('list'))return;for(const [a,b,label] of relations){const ea=$('[data-artifact="'+a+'"]'),eb=$('[data-artifact="'+b+'"]');if(!ea||!eb||ea.hidden||eb.hidden)continue;const pa=position(a),pb=position(b);const ca={x:pa[0]+ea.offsetWidth/2,y:pa[1]+ea.offsetHeight/2},cb={x:pb[0]+eb.offsetWidth/2,y:pb[1]+eb.offsetHeight/2};const horizontal=Math.abs(cb.x-ca.x)>Math.abs(cb.y-ca.y);const x1=ca.x+(horizontal?Math.sign(cb.x-ca.x)*ea.offsetWidth/2:0),y1=ca.y+(horizontal?0:Math.sign(cb.y-ca.y)*ea.offsetHeight/2),x2=cb.x-(horizontal?Math.sign(cb.x-ca.x)*eb.offsetWidth/2:0),y2=cb.y-(horizontal?0:Math.sign(cb.y-ca.y)*eb.offsetHeight/2);const path=document.createElementNS(wires.namespaceURI,'path');path.setAttribute('d',horizontal?`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`:`M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`);const title=document.createElementNS(wires.namespaceURI,'title');title.textContent=label;path.append(title);wires.append(path);for(const [x,y] of [[x1,y1],[x2,y2]]){const dot=document.createElementNS(wires.namespaceURI,'circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',3.5);wires.append(dot)}}}
function renderPositions(){for(const el of $$('[data-artifact]')){const p=position(el.dataset.artifact);el.style.left=p[0]+'px';el.style.top=p[1]+'px'}drawWires();renderCardToggles()}
function renderCamera(){const list=world.classList.contains('list');world.style.transform=list?'none':`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;zoom=camera.z;$('#zoom-label').textContent=Math.round(zoom*100)+'%';$('#zoom-out').disabled=list||zoom<=.15;$('#zoom-in').disabled=list||zoom>=3.5;$('#fit').disabled=list;$('#reset-layout').disabled=list;canvas.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;canvas.style.backgroundPosition=`${camera.x}px ${camera.y}px`}
function zoomAt(next,x=canvas.clientWidth/2,y=canvas.clientHeight/2){next=Math.max(.15,Math.min(3.5,next));const wx=(x-camera.x)/camera.z,wy=(y-camera.y)/camera.z;camera={x:x-wx*next,y:y-wy*next,z:next};renderCamera()}
function fitCanvas(onlySelected=false){if(world.classList.contains('list'))return;const nodes=$$('[data-artifact]').filter(e=>!e.hidden&&(!onlySelected||selected.has(e.dataset.artifact)));if(!nodes.length)return;const minX=Math.min(...nodes.map(e=>position(e.dataset.artifact)[0])),minY=Math.min(...nodes.map(e=>position(e.dataset.artifact)[1])),maxX=Math.max(...nodes.map(e=>position(e.dataset.artifact)[0]+e.offsetWidth)),maxY=Math.max(...nodes.map(e=>position(e.dataset.artifact)[1]+e.offsetHeight));const top=56,bottom=84,room=Math.max(120,canvas.clientHeight-top-bottom),z=Math.max(.15,Math.min(1,(canvas.clientWidth-60)/(maxX-minX),room/(maxY-minY)));/* Keep clear of the legend and the tool dock. */camera={x:(canvas.clientWidth-(maxX-minX)*z)/2-minX*z,y:top+(room-(maxY-minY)*z)/2-minY*z,z};renderCamera()}
function loadCanvas(){gesture=null;pointers.clear();pinch=null;renderPositions();fitCanvas()}
function setView(list){cancelGesture();$('.canvas-controls').hidden=list;world.classList.toggle('list',list);canvas.classList.toggle('list-mode',list);$('#canvas-view').setAttribute('aria-pressed',!list);$('#list-view').setAttribute('aria-pressed',list);renderCamera();drawWires();renderCardToggles()}
$('#list-view').onclick=()=>setView(true);$('#canvas-view').onclick=()=>setView(false);
$('#zoom-out').onclick=()=>zoomAt(camera.z/1.2);$('#zoom-in').onclick=()=>zoomAt(camera.z*1.2);$('#fit').onclick=()=>fitCanvas();
$('#reset-layout').onclick=()=>{layouts[projects[current]?.id || "empty"]={};saveLayout();arrangeLinked(new Set());loadCanvas();showToast('Layout reset for '+(projects[current]?.name || 'workspace')+'.')};
function openArtifact(id,button){
  if(records[id])return openPeek(id,button);
  const node=connectionNodes.get(id);if(!node)return;
  opener=button;peekTrail=connectionTrail(node.parentId);openConnection(node.link,node.parentId);
}
function bindArtifact(button){
  button.title='Click to select · Double-click or Enter to open · Shift-click to add to selection';
  button.onclick=e=>{if(world.classList.contains('list'))openArtifact(button.dataset.artifact,button);else if(e.detail===0)setSelection(HorsemenCanvas.hitSelection(selected,button.dataset.artifact,e.shiftKey))};
  button.ondblclick=e=>{if(tool==='hand'||spaceDown)return;e.preventDefault();openArtifact(button.dataset.artifact,button)};
}
function setSelection(next){selected=new Set([...next].filter(id=>{const el=$('[data-artifact="'+id+'"]');return el&&!el.hidden&&!el.disabled}));updateSelection()}
function renderCardToggles(){
  const list=world.classList.contains('list'),origin=world.getBoundingClientRect(),scale=list?1:camera.z;
  for(const card of $$('[data-artifact]')){
    const id=card.dataset.artifact,node=connectionNodes.get(id),record=records[id]||node?.record;
    const state=HorsemenCanvas.branchControl({count:record?.connections?.length||0,canLoad:node?.link.kind==='document'&&!record,expanded:expandedConnections.has(id),loading:loadingLinks.has(request+':'+id)});
    let control=cardToggles.get(id);
    if(!state.visible){control?.remove();cardToggles.delete(id);card.classList.remove('has-link-control');continue}
    if(!control){
      control=document.createElement('button');control.type='button';control.className='card-links-toggle';control.dataset.cardToggle=id;
      // This is a sibling, visually placed on the card: never nest a button in a button.
      control.onpointerdown=e=>e.stopPropagation();
      control.onkeydown=e=>e.stopPropagation();
      control.onclick=e=>{e.stopPropagation();toggleConnections(id)};
      control.ondblclick=e=>e.stopPropagation();
      world.append(control);cardToggles.set(id,control);
    }
    card.classList.add('has-link-control');
    control.hidden=card.hidden||card.disabled;control.disabled=state.disabled;
    const face=state.label+'|'+state.disabled;if(control.dataset.face!==face){control.dataset.face=face;control.innerHTML=icon(state.disabled?'refresh':'chevron-right')+'<span>'+escapeHTML(state.label)+'</span>'}
    control.setAttribute('aria-expanded',state.expanded);
    control.setAttribute('aria-busy',state.disabled);
    const name=record?.name||node?.link.title||names[id];
    const action=state.expanded?'Collapse':'Expand';
    control.setAttribute('aria-label',action+' linked items for '+name);control.title=action+' linked items';
    if(control.hidden)continue;
    const rect=card.getBoundingClientRect(),inset=card.classList.contains('plate')?8:10;
    control.style.left=((rect.right-origin.left)/scale-control.offsetWidth-12)+'px';
    control.style.top=((rect.bottom-origin.top)/scale-control.offsetHeight-inset)+'px';
    control.style.zIndex=String((Number(card.style.zIndex)||1)+1);
  }
}

function updateSelection(){
  for(const el of $$('[data-artifact]')){el.classList.toggle('canvas-selected',selected.has(el.dataset.artifact));el.setAttribute('aria-pressed',selected.has(el.dataset.artifact))}
  const id=selected.size===1?[...selected][0]:null,record=records[id]||connectionNodes.get(id)?.record;
  $('#selection-label').textContent=selected.size===0?'Select an artifact':selected.size>1?selected.size+' artifacts selected':(record?.name||connectionNodes.get(id)?.link.title||names[id]);
  $('#open-selected').disabled=!id;
  $('#collapse-all').disabled=expandedConnections.size===0;renderCardToggles();
}
function setTool(next){cancelGesture();tool=next;canvas.dataset.tool=next;$('#select-tool').setAttribute('aria-pressed',next==='select');$('#hand-tool').setAttribute('aria-pressed',next==='hand')}
$('#select-tool').onclick=()=>setTool('select');$('#hand-tool').onclick=()=>setTool('hand');
$('#open-selected').onclick=()=>{const id=[...selected][0];if(id)openArtifact(id,$('[data-artifact="'+id+'"]'))};
$('#collapse-all').onclick=()=>{expandedConnections.clear();refreshGraph()};
const marquee=document.createElement('div');marquee.className='selection-marquee';marquee.hidden=true;canvas.append(marquee);
function localPoint(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.x,y:e.clientY-r.y}}
function worldPoint(pt){return{x:(pt.x-camera.x)/camera.z,y:(pt.y-camera.y)/camera.z}}
function cancelGesture(){
  if(gesture?.origins){for(const [id,p] of Object.entries(gesture.origins))positions()[id]=p;renderPositions()}
  if(gesture?.kind==='pan'){camera={...gesture.camera};renderCamera()}
  gesture=null;pointers.clear();pinch=null;marquee.hidden=true;canvas.classList.remove('grabbing');
}
canvas.addEventListener('pointerdown',e=>{
  if(e.target.closest('[data-card-toggle]'))return;
  if(world.classList.contains('list')||![0,1,2].includes(e.button))return;
  const node=e.target.closest('[data-artifact]');if(node?.disabled)return;
  const pt=localPoint(e);pointers.set(e.pointerId,pt);suppressClick=null;
  if(e.isTrusted)(node||canvas).setPointerCapture(e.pointerId);
  if(pointers.size===2){
    const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
    pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),z:camera.z,wx:(mid.x-camera.x)/camera.z,wy:(mid.y-camera.y)/camera.z};
    gesture=null;marquee.hidden=true;suppressClick={at:performance.now()};e.preventDefault();return;
  }
  const pan=spaceDown||tool==='hand'||e.button!==0||(!node&&e.pointerType==='touch');
  if(pan){gesture={id:e.pointerId,kind:'pan',start:pt,camera:{...camera},moved:false};canvas.classList.add('grabbing')}
  else if(node){
    const id=node.dataset.artifact;node.style.zIndex=++highestLayer;setSelection(HorsemenCanvas.hitSelection(selected,id,e.shiftKey));
    gesture={id:e.pointerId,kind:'move',start:pt,moved:false,origins:Object.fromEntries([...selected].map(key=>[key,[...position(key)]]))};node.focus({preventScroll:true});
  }else{
    const before=e.shiftKey?new Set(selected):new Set();setSelection(before);canvas.focus({preventScroll:true});
    gesture={id:e.pointerId,kind:'marquee',start:pt,moved:false,before};
  }
  e.preventDefault();
});
window.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId))return;
  const pt=localPoint(e);pointers.set(e.pointerId,pt);
  if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},z=Math.max(.15,Math.min(3.5,pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));camera={x:mid.x-pinch.wx*z,y:mid.y-pinch.wy*z,z};renderCamera();return}
  if(!gesture||gesture.id!==e.pointerId)return;
  const dx=pt.x-gesture.start.x,dy=pt.y-gesture.start.y;if(Math.hypot(dx,dy)>4)gesture.moved=true;if(!gesture.moved)return;
  if(gesture.kind==='move'){for(const [id,origin] of Object.entries(gesture.origins))positions()[id]=[origin[0]+dx/camera.z,origin[1]+dy/camera.z];renderPositions()}
  else if(gesture.kind==='pan'){camera.x=gesture.camera.x+dx;camera.y=gesture.camera.y+dy;renderCamera()}
  else{
    const left=Math.min(pt.x,gesture.start.x),top=Math.min(pt.y,gesture.start.y),width=Math.abs(dx),height=Math.abs(dy);
    Object.assign(marquee.style,{left:left+'px',top:top+'px',width:width+'px',height:height+'px'});marquee.hidden=false;
    const origin=worldPoint({x:left,y:top}),rect={...origin,w:width/camera.z,h:height/camera.z},next=new Set(gesture.before);
    for(const el of $$('[data-artifact]')){if(el.hidden||el.disabled)continue;const p=position(el.dataset.artifact);if(HorsemenCanvas.insideRect({x:p[0],y:p[1],w:el.offsetWidth,h:el.offsetHeight},rect))next.add(el.dataset.artifact)}
    setSelection(next);
  }
});
function finishPointer(e){
  if(!pointers.has(e.pointerId))return;
  const wasPinch=!!pinch;pointers.delete(e.pointerId);
  if(gesture?.moved||wasPinch)suppressClick={at:performance.now()};saveLayout();gesture=null;pinch=null;marquee.hidden=true;canvas.classList.remove('grabbing');
  if(pointers.size){const [id,pt]=[...pointers.entries()][0];gesture={id,kind:'pan',start:pt,camera:{...camera},moved:true}}
}
window.addEventListener('pointerup',finishPointer);window.addEventListener('pointercancel',cancelGesture);
canvas.addEventListener('contextmenu',e=>{if(!world.classList.contains('list'))e.preventDefault()});
canvas.addEventListener('click',e=>{if(e.target.closest('[data-card-toggle]'))return;if(e.isTrusted&&suppressClick&&performance.now()-suppressClick.at<450){e.preventDefault();e.stopImmediatePropagation();suppressClick=null}},true);
canvas.addEventListener('wheel',e=>{
  if(world.classList.contains('list'))return;e.preventDefault();const factor=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight:1;
  if(e.ctrlKey||e.metaKey||e.buttons===4){const p=localPoint(e);zoomAt(camera.z*Math.exp(-e.deltaY*factor*.002),p.x,p.y)}
  else{camera.x-=(e.shiftKey&&!e.deltaX?e.deltaY:e.deltaX)*factor;camera.y-=(e.shiftKey&&!e.deltaX?0:e.deltaY)*factor;renderCamera()}
},{passive:false});
window.addEventListener('keydown',e=>{
  if(e.target.closest('dialog,input,textarea,select,[contenteditable=true]')||world.classList.contains('list'))return;
  if(e.code==='Space'){e.preventDefault();spaceDown=true;canvas.classList.add('pan-ready');return}
  if(e.key.toLowerCase()==='h'&&!e.ctrlKey&&!e.metaKey){setTool('hand');return}
  if((e.key.toLowerCase()==='v'||e.key==='1')&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){setTool('select');return}
  const active=canvas.contains(e.target)||$('.canvas-controls').contains(e.target);if(!active)return;
  if(e.key==='Escape'){e.preventDefault();cancelGesture();setSelection(new Set());setTool('select');return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelection(new Set($$('[data-artifact]').filter(b=>!b.hidden&&!b.disabled).map(b=>b.dataset.artifact)));return}
  if(e.key==='Enter'&&selected.size===1){e.preventDefault();$('#open-selected').click();return}
  const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(d){e.preventDefault();const focused=e.target.closest('[data-artifact]');if(e.altKey&&focused)setSelection(new Set([focused.dataset.artifact]));if(selected.size){const step=e.altKey?20:e.shiftKey?10:1;for(const id of selected){const p=position(id);positions()[id]=[p[0]+d[0]*step,p[1]+d[1]*step]}renderPositions();saveLayout()}else{camera.x-=d[0]*60;camera.y-=d[1]*60;renderCamera()}return}
  if(e.shiftKey&&e.code==='Digit1'){e.preventDefault();fitCanvas();return}
  if(e.shiftKey&&e.code==='Digit2'){e.preventDefault();fitCanvas(true);return}
  if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')zoomAt(1);else zoomAt(camera.z*(e.key==='-'?1/1.2:1.2))}
});
window.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;canvas.classList.remove('pan-ready')}});
window.addEventListener('blur',()=>{spaceDown=false;canvas.classList.remove('pan-ready');cancelGesture()});
canvas.dataset.tool='select';
const themeMenu=$('#theme-menu'),themeQuery=matchMedia('(prefers-color-scheme: dark)');
function applyTheme(choice){
  if(choice!==undefined)try{if(choice==='system')localStorage.removeItem('horsemen-theme');else localStorage.setItem('horsemen-theme',choice)}catch{}
  let saved=null;try{saved=localStorage.getItem('horsemen-theme')}catch{}
  const id=HorsemenThemes.resolve(saved,themeQuery.matches),chosen=saved&&HorsemenThemes.resolve(saved,false)===HorsemenThemes.resolve(saved,true)?id:'system';
  document.documentElement.dataset.theme=id;
  for(const b of themeMenu.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-checked',b.dataset.themeChoice===chosen);
  return id;
}
/* Type sets change fonts only. The default set is not saved, so a later default can change it. */
function applyType(choice){
  if(choice!==undefined)try{if(choice===HorsemenThemes.types[0].id)localStorage.removeItem('horsemen-type');else localStorage.setItem('horsemen-type',choice)}catch{}
  let saved=null;try{saved=localStorage.getItem('horsemen-type')}catch{}
  const id=HorsemenThemes.resolveType(saved);
  document.documentElement.dataset.type=id;
  for(const b of themeMenu.querySelectorAll('[data-type-choice]'))b.setAttribute('aria-checked',b.dataset.typeChoice===id);
  return id;
}
function menuGroup(label){const g=document.createElement('div');g.setAttribute('role','group');g.setAttribute('aria-label',label);g.innerHTML='<span class="menu-label" aria-hidden="true">'+escapeHTML(label)+'</span>';themeMenu.append(g);return g}
const colourGroup=menuGroup('Colours'),typeGroup=menuGroup('Type');
for(const t of [{id:'system',label:'System',note:'Follows this device'},...HorsemenThemes.themes]){
  const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.dataset.themeChoice=t.id;
  const chips=t.id==='system'?['bone','ink']:[t.id];
  b.innerHTML='<span class="swatch">'+chips.map(id=>'<span data-swatch="'+id+'"><i></i><i></i><i></i><i></i></span>').join('')+'</span><span class="theme-name">'+escapeHTML(t.label)+'<small>'+escapeHTML(t.note)+'</small></span>'+icon('check');
  b.onclick=()=>applyTheme(t.id);colourGroup.append(b);
}
for(const t of HorsemenThemes.types){
  const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.dataset.typeChoice=t.id;
  /* The sample uses the set's own fonts. A font downloads only when the menu shows its sample. */
  b.innerHTML='<span class="type-sample" data-type-sample="'+t.id+'" aria-hidden="true">Aa</span><span class="theme-name">'+escapeHTML(t.label)+'<small>'+escapeHTML(t.note)+'</small></span>'+icon('check');
  b.onclick=()=>applyType(t.id);typeGroup.append(b);
}
const menuItems=()=>[...themeMenu.querySelectorAll('[role=menuitemradio]')];
function toggleThemeMenu(open=themeMenu.hidden){
  themeMenu.hidden=!open;$('#theme-toggle').setAttribute('aria-expanded',open);
  if(open)(themeMenu.querySelector('[data-theme-choice][aria-checked=true]')||menuItems()[0]).focus();
}
$('#theme-toggle').onclick=()=>toggleThemeMenu();
themeMenu.addEventListener('keydown',e=>{
  const items=menuItems(),at=items.indexOf(document.activeElement);
  if(e.key==='Escape'){e.stopPropagation();toggleThemeMenu(false);$('#theme-toggle').focus()}
  else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();e.stopPropagation();items[(at+(e.key==='ArrowDown'?1:-1)+items.length)%items.length].focus()}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();e.stopPropagation();items[e.key==='Home'?0:items.length-1].focus()}
});
document.addEventListener('pointerdown',e=>{if(!themeMenu.hidden&&!e.target.closest('#theme-menu,#theme-toggle'))toggleThemeMenu(false)});
applyType();
themeQuery.addEventListener('change',()=>applyTheme());applyTheme();

/* Jump: one field that reaches every project, record, view, theme, and type set. */
const palette=$('#palette');let paletteShown=[],paletteAt=0;
function paletteItems(){
  const items=[],leave=()=>{if($('#peek').open)$('#peek').close()},list=world.classList.contains('list');
  for(const key of readable())items.push({group:'Records',icon:key,label:names[key],hint:riderLine[key].split(' · ').at(-1),run:()=>openPeek(key,$('[data-artifact="'+key+'"]'))});
  projects.forEach((p,i)=>{if(i!==current)items.push({group:'Projects',icon:'layers',label:p.name,hint:p.repo+(p.root?' / '+p.root:''),run:()=>{leave();pendingLink=null;selectProject(i)}})});
  items.push({group:'Actions',icon:list?'canvas':'list',label:list?'Show the canvas':'Show the list',hint:'View',run:()=>{leave();setView(!list)}},
    {group:'Actions',icon:'fit',label:'Fit all cards',hint:'Shift + 1',run:()=>{leave();setView(false);fitCanvas()}},
    {group:'Actions',icon:'collapse',label:'Collapse all linked branches',hint:'Canvas',run:()=>{leave();expandedConnections.clear();refreshGraph()}},
    {group:'Actions',icon:'refresh',label:'Refresh GitHub',hint:'Scan again',run:()=>{leave();scan()}});
  for(const t of HorsemenThemes.themes)items.push({group:'Themes',icon:t.scheme==='dark'?'moon':'sun',label:t.label,hint:t.note,run:()=>applyTheme(t.id)});
  for(const t of HorsemenThemes.types)items.push({group:'Type',icon:'type',label:t.label+' type',hint:t.note,run:()=>applyType(t.id)});
  return items;
}
function renderPalette(){
  const words=$('#palette-input').value.toLocaleLowerCase().split(/\s+/).filter(Boolean),list=$('#palette-list');
  paletteShown=paletteItems().filter(item=>{const hay=(item.group+' '+item.label+' '+item.hint).toLocaleLowerCase();return words.every(word=>hay.includes(word))});
  paletteAt=Math.min(paletteAt,Math.max(0,paletteShown.length-1));list.replaceChildren();let group='';
  paletteShown.forEach((item,i)=>{
    if(item.group!==group){group=item.group;list.append(Object.assign(document.createElement('p'),{className:'navlabel',textContent:group}))}
    const b=document.createElement('button');b.type='button';b.id='palette-option-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected',i===paletteAt);b.tabIndex=-1;
    b.innerHTML=icon(item.icon)+'<span>'+escapeHTML(item.label)+'</span><small>'+escapeHTML(item.hint)+'</small>';
    b.onclick=()=>{palette.close();item.run()};b.onpointermove=()=>{if(paletteAt!==i){paletteAt=i;markPalette()}};list.append(b);
  });
  if(!paletteShown.length)list.append(Object.assign(document.createElement('p'),{className:'palette-empty',textContent:'Nothing matches. Try a project name, a record, “theme”, or “type”.'}));
  markPalette();
}
function markPalette(){
  $$('#palette-list [role=option]').forEach((b,i)=>{b.setAttribute('aria-selected',i===paletteAt);if(i===paletteAt)b.scrollIntoView({block:'nearest'})});
  if(paletteShown.length)$('#palette-input').setAttribute('aria-activedescendant','palette-option-'+paletteAt);else $('#palette-input').removeAttribute('aria-activedescendant');
}
function openPalette(){if(palette.open)return;toggleThemeMenu(false);$('#palette-input').value='';paletteAt=0;renderPalette();palette.showModal();$('#palette-input').focus()}
$('#jump').onclick=openPalette;$('#palette-input').oninput=()=>{paletteAt=0;renderPalette()};
$('#palette-input').onkeydown=e=>{
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(paletteShown.length){paletteAt=(paletteAt+(e.key==='ArrowDown'?1:-1)+paletteShown.length)%paletteShown.length;markPalette()}}
  else if(e.key==='Enter'){e.preventDefault();const item=paletteShown[paletteAt];if(item){palette.close();item.run()}}
};
palette.addEventListener('click',e=>{if(e.target===palette)palette.close()});
window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();if(palette.open)palette.close();else openPalette()}},true);
if(/Mac|iPhone|iPad/.test(navigator.platform))$('#jump-key').textContent='⌘ K';

new ResizeObserver(()=>{drawWires();renderCardToggles()}).observe(world);
renderPositions();fitCanvas();


async function boot(){
  try{
    const state=await api('/api/status');
    if(['ready','partial'].includes(state.phase)){
      projects=state.projects.sort((a,b)=>a.repo.localeCompare(b.repo)||a.root.localeCompare(b.root));renderProjects();
      $('#account').textContent='GitHub · '+state.account;
      $('#scan-status').textContent=state.completed+' / '+state.total+' repositories checked · '+projects.length+' projects found · Last scan '+new Date(state.finished_at).toLocaleTimeString();
      $('#issues').hidden=!state.issues.length;$('#issues').textContent=state.issues.map(i=>(i.repo?i.repo+': ':'')+i.message).join('\n');
      if(projects.length){await selectProject(Math.max(0,pendingLink?projects.findIndex(p=>p.id===pendingLink.p):0));return}
    }
    await scan();
  }catch(e){$('#scan-status').textContent=e.message;document.body.dataset.state='error'}
}
/* Hosted mode: an open project moved to a new commit. Reload it, but never under an open record. */
document.addEventListener('horsemen:updated',event=>{
  const next=event.detail,index=projects.findIndex(p=>p.id===next.id);if(index<0)return;
  projects[index]={...projects[index],...next};if(index!==current)return;
  const reload=()=>{if(projects[current]?.id!==next.id)return;selectProject(current);showToast('Updated to commit '+next.revision.slice(0,7)+'.')};
  if($('#peek').open){showToast('A new commit is ready. It loads when you close this record.');$('#peek').addEventListener('close',reload,{once:true})}else reload();
});
/* Phone: Fit would shrink canvas cards below reading size, so the list comes first. The canvas stays one tap away. */
if(matchMedia('(max-width: 640px)').matches)setView(true);
boot();
