'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const names={vision:'VISION.md',progress:'PROGRESS.md',brain:'BRAIN.md',structure:'STRUCTURE.md',readme:'README.md',changelog:'CHANGELOG.md',techstack:'TECHSTACK.md'};
let projects=[],current=0,zoom=1,records={},opener=null,request=0,scanRun=0;
const session=$('meta[name="horsemen-session"]').content;
const titles={vision:'Vision',progress:'Progress',brain:'Brain',structure:'Structure',readme:'README',changelog:'Changelog',techstack:'Tech stack'};
const icon=(name,cls='icon')=>'<svg class="'+cls+'" aria-hidden="true"><use href="/assets/icons/'+(name.startsWith('seal-')?'seals':'icons')+'.svg#'+name+'"/></svg>';
const kindIcon=kind=>kind==='document'?'document':kind==='external'?'external':'link';
const {escapeHTML,safeURL}=HorsemenMarkdown;
const renderMarkdown=(text,base)=>HorsemenMarkdown.render(text,base);
const hosted=!!window.HorsemenHosted, copy=(local,remote)=>hosted?remote:local;
async function api(path,method='GET'){if(hosted)return HorsemenHosted.api(path,method);const r=await fetch(path,{method,headers:{'X-Horsemen-Session':session},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function showToast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500)}
let peekTrail=[],peekRequest=0,peekMode='overview';
/* A link to open: a local #p=<id>&r=<record> hash, or in hosted mode a readable /owner/repo?record= share link. */
let pendingLink=window.HorsemenHosted?.target?{target:HorsemenHosted.target,r:HorsemenHosted.target.record}:(m=>m?{p:m[1],r:m[2]}:null)(location.hash.match(/^#p=([a-f0-9]{24})(?:&r=([a-z]+))?$/));
const linkMatches=p=>!!(p&&pendingLink)&&(pendingLink.target?HorsemenReader.matchesTarget(p,pendingLink.target):p.id===pendingLink.p);
function syncHash(){
  const p=projects[current],key=$('#peek').open?peekTrail[0]?.key:null;
  if(window.HorsemenHosted){if(!p)return;const u=new URL(HorsemenHosted.shareURL(p,Object.hasOwn(names,key||'')?key:null));if(location.pathname+location.search!==u.pathname+u.search||location.hash)try{history.replaceState(null,'',u.pathname+u.search)}catch{}return}
  const hash=p?'#p='+p.id+(Object.hasOwn(names,key||'')?'&r='+key:''):'';
  if(location.hash!==hash)try{history.replaceState(null,'',hash||location.pathname)}catch{}
}
function setPeekMode(mode){peekMode=mode;renderPeek();$('.peek-content').focus({preventScroll:true})}
function openPeek(key,button){const r=records[key];if(!r)return;opener=button;peekRequest++;peekTrail=[{key,record:r,nodeId:key}];peekMode='overview';renderPeek();if(!$('#peek').open)$('#peek').showModal();markOutline();$('.peek-content').focus({preventScroll:true});syncHash()}
/* The layout choice is saved for each record type. Only "rich" and "list" are kept; a type without a saved choice uses its default. */
const viewChoices=()=>{try{const saved=JSON.parse(localStorage.getItem('horsemen-peek-views')||'{}');return saved&&typeof saved==='object'?saved:{}}catch{return {}}};
const viewMode=key=>['rich','list'].includes(viewChoices()[key])?viewChoices()[key]:HorsemenViews.defaultMode(key);
function setViewMode(key,mode){const saved=viewChoices();saved[key]=mode==='list'?'list':'rich';try{localStorage.setItem('horsemen-peek-views',JSON.stringify(saved))}catch{}}
/* A record that does not follow its template reads as its own document. */
const documentHTML=record=>{const text=HorsemenViews.withoutTitle(record.content||'');return '<div class="view view-document" data-layout="document">'+(text.trim()?'<div class="prose document">'+renderMarkdown(text,record.url)+'</div>':'<p class="empty-note">This record is empty.</p>')+'</div>'};
function overviewHTML(key,record){return HorsemenViews.render(key,record,{mode:viewMode(key),now:Date.now(),links:record.connections?.length||0})||documentHTML(record)}
/* Stated facts ("Updated: 2026-11-18 · Stage: pilot") form the quiet line under the record name. Dates show as relative time. */
function factsLine(record){
  const facts=HorsemenPreview.facts(record.content||'');
  return facts.map(f=>{const m=f.value.match(/^(\d{4}-\d{2}-\d{2})\b\s*(.*)$/),r=m&&HorsemenViews.relative(m[1]);return {text:r?f.label+' '+r.text.toLocaleLowerCase()+(m[2]?' '+m[2]:''):f.label+': '+f.value,title:r?r.iso:''}});
}
const entryTitle=entry=>Object.hasOwn(titles,entry.key)?titles[entry.key]:entry.record?.name||entry.link?.title||'Document';
function renderPeek(){
  const entry=peekTrail.at(-1);if(!entry)return;
  const r=entry.record,core=Object.hasOwn(names,entry.key);$('#peek').dataset.kind=entry.key;$('#peek-kind').innerHTML=icon(core?entry.key:kindIcon(entry.link?.kind||'document'));$('#peek-title').textContent=entryTitle(entry);
  /* One quiet line under the name: the file for linked documents, then the facts the record states. */
  const sub=$('#peek-sub');sub.replaceChildren();
  if(!core&&(r.path||entry.link?.path))sub.append(Object.assign(document.createElement('span'),{className:'path',textContent:r.path||entry.link.path}));
  for(const f of r.error?[]:factsLine(r)){const s=document.createElement('span');s.textContent=f.text;if(f.title)s.title=f.title;sub.append(s)}
  sub.hidden=!sub.childNodes.length;
  $('#peek-back').hidden=peekTrail.length<2;
  renderPeekPath();renderPeekMenu(entry);
  const href=r.url||entry.link?.href,open=$('#peek-open');
  if(href&&safeURL(href,location.href)){open.href=href;open.hidden=false;const label=entry.link?.kind==='external'?'Open link':'Open on GitHub';open.setAttribute('aria-label',label);open.title=label}else{open.removeAttribute('href');open.hidden=true}
  $('#source-content').textContent=r.content||r.error||'This external document has not been loaded.';
  $('#peek-content').hidden=peekMode==='source';$('#source-content').hidden=peekMode!=='source';
  const content=$('#peek-content');content.replaceChildren();content.dataset.mode=peekMode;$('.peek-content').scrollTo({top:0,behavior:'instant'});
  if(entry.link&&entry.link.kind!=='document'){
    const ref=HorsemenViews.proofKind(entry.link.href),pr=HorsemenViews.prRef(entry.link.href),kinds={pr:'Pull request',commit:'Commit',release:'Release',checks:'Checks',issue:'Issue'};
    content.innerHTML='<div class="external-document">'+(ref&&kinds[ref.kind]?'<p><span class="chip '+ref.kind+'">'+escapeHTML(ref.label)+'</span></p>':'')+'<p>'+escapeHTML(kinds[ref?.kind]||'A link')+' from '+escapeHTML(entry.link.source)+'. Horsemen does not load its contents.</p><p class="external-address">'+escapeHTML(entry.link.href)+'</p></div>';
    if(pr&&pr.repo===projects[current]?.repo){const area=document.createElement('section');area.className='part evidence-block';area.innerHTML='<h3 class="part-title">Pull request details</h3><p class="quiet">Load the title, merge state, and description from GitHub. A merged pull request alone does not prove delivery.</p>';area.append(prButton(area,pr.number));content.firstChild.append(area)}
  }else if(r.error)content.innerHTML='<div class="callout">'+escapeHTML(r.error)+'</div>';
  else if(peekMode==='document')content.innerHTML=documentHTML(r);
  else content.innerHTML=overviewHTML(entry.key,r);
  if(peekMode==='document')content.insertAdjacentHTML('afterbegin','<p class="mode-bar">Full document <button type="button" class="link-btn" data-peek-mode="overview">Show overview</button></p>');
  if(r.connections?.length&&peekMode!=='source'){
    const panel=document.createElement('section');panel.className='part connections-panel';
    panel.dataset.outline='Linked documents';panel.innerHTML='<div class="connections-heading"><h3 class="part-title">Linked documents</h3></div><ul class="connection-grid"></ul>';
    const graph=document.createElement('button');graph.className='link-btn';graph.textContent='Show on canvas';graph.onclick=()=>{expandConnections(entry.nodeId,r);$('#peek').close();fitCanvas()};panel.querySelector('.connections-heading').append(graph);
    if(expandedConnections.has(entry.nodeId)){const collapse=document.createElement('button');collapse.className='link-btn';collapse.textContent='Hide on canvas';collapse.onclick=()=>{expandedConnections.delete(entry.nodeId);refreshGraph();renderPeek()};panel.querySelector('.connections-heading').append(collapse)}
    for(const link of r.connections){const li=document.createElement('li'),b=document.createElement('button');b.className='connection-card';b.dataset.connection=link.id;b.innerHTML=icon(kindIcon(link.kind))+'<strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+'</small>';b.onclick=()=>openConnection(link,entry.nodeId);li.append(b);panel.querySelector('.connection-grid').append(li)}
    const slot=content.querySelector('[data-connections-slot]');if(slot)slot.replaceWith(panel);else content.append(panel);
    content.querySelectorAll('a').forEach(a=>{const link=r.connections.find(l=>l.href===a.href);if(link)a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();openConnection(link,entry.nodeId)}});
  }else content.querySelector('[data-connections-slot]')?.remove();
  if(entry.key==='changelog'&&!r.error&&peekMode==='overview')addEvidence(r);
  /* Code blocks get a Copy button. */
  for(const pre of content.querySelectorAll('.prose pre')){const b=document.createElement('button');b.type='button';b.className='copy';b.dataset.copy=pre.textContent.trim();b.setAttribute('aria-label','Copy code');b.textContent='Copy';pre.classList.add('has-copy');pre.append(b)}
  /* Diagrams and repository images: drawn and loaded after the content is in place. */
  HorsemenMedia.hydrate(content,{links:r.connections||[],loadImage:imageURL});
  /* The full document is one click away from an overview that is not already the document. */
  if(peekMode==='overview'&&!r.error&&!(entry.link&&entry.link.kind!=='document')&&!content.querySelector('[data-layout=document],[data-layout=guide]'))content.insertAdjacentHTML('beforeend','<p class="more-bar"><button type="button" class="link-btn" data-peek-mode="document">Read the full document</button></p>');
  renderPeekNav();
}
/* The ⋯ menu: the layouts for this record, the full document, and the Markdown source. */
function renderPeekMenu(entry){
  const menu=$('#peek-menu'),r=entry.record,core=Object.hasOwn(names,entry.key)&&!entry.link;menu.replaceChildren();
  const add=(label,on,run,attrs={})=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',on);b.innerHTML='<span>'+escapeHTML(label)+'</span>'+icon('check');for(const [k,v] of Object.entries(attrs))b.setAttribute(k,v);b.onclick=()=>{toggleMenu(menu,false);run()};menu.append(b)};
  const group=label=>menu.append(Object.assign(document.createElement('span'),{className:'menu-label',textContent:label}));
  group('Show as');
  if(core&&!r.error){const l=HorsemenViews.layouts(entry.key),mode=viewMode(entry.key);for(const v of [l.first,l.first==='list'?'rich':'list'])add(l[v],peekMode==='overview'&&mode===v,()=>{setViewMode(entry.key,v);setPeekMode('overview')},{'data-view-choice':v})}
  else add('Overview',peekMode==='overview',()=>setPeekMode('overview'),{'data-peek-mode':'overview'});
  add('Full document',peekMode==='document',()=>setPeekMode('document'),{id:'show-document','data-peek-mode':'document'});
  add('Markdown source',peekMode==='source',()=>setPeekMode('source'),{id:'show-source','data-peek-mode':'source'});
}
/* The path to this document. It appears only below the first level; each earlier step is a way back. */
function renderPeekPath(){
  const path=$('#peek-meta');path.replaceChildren();if(peekTrail.length<2)return;
  peekTrail.forEach((e,i)=>{
    if(i)path.append(Object.assign(document.createElement('span'),{className:'sep',textContent:'/'}));
    const last=i===peekTrail.length-1,el=document.createElement(last?'span':'button');el.textContent=entryTitle(e);
    if(last)el.className='here';else el.onclick=()=>{peekRequest++;peekTrail.length=i+1;peekMode='overview';renderPeek()};path.append(el);
  });
}
const readable=()=>Object.keys(names).filter(key=>records[key]&&!records[key].error);
function stepRecord(delta){const order=readable(),at=order.indexOf(peekTrail[0]?.key);if(order.length<2)return;const key=order[(Math.max(at,0)+delta+order.length)%order.length];openPeek(key,$('[data-artifact="'+key+'"]'))}
let outlineTargets=[];
function renderPeekNav(){
  const list=$('#peek-records'),root=peekTrail[0]?.key;list.replaceChildren();
  for(const key of Object.keys(names)){
    const r=records[key],b=document.createElement('button');b.className='peek-record '+key+(r?.error?' missing':'');b.dataset.record=key;b.disabled=!r||!!r.error;
    b.innerHTML=icon(key)+'<span>'+escapeHTML(titles[key])+'</span>';if(r?.error)b.title=names[key]+' is missing or unreadable';
    if(key===root)b.setAttribute('aria-current',peekTrail.length===1?'page':'true');
    b.onclick=()=>openPeek(key,$('[data-artifact="'+key+'"]'));list.append(b);
  }
  const order=readable(),at=order.indexOf(root);
  for(const [id,delta] of [['#peek-prev',-1],['#peek-next',1]]){const b=$(id);b.hidden=order.length<2||peekTrail.length>1;if(!b.hidden)b.querySelector('span').textContent=titles[order[(Math.max(at,0)+delta+order.length)%order.length]]}
  const outline=$('#peek-outline');outline.replaceChildren();
  const content=$('#peek-content'),marked=content.querySelectorAll('[data-outline]');
  outlineTargets=peekMode==='source'?[]:[...(marked.length?marked:content.querySelectorAll('.prose h2,.prose h3'))];
  outlineTargets.forEach((el,i)=>{
    el.id='peek-section-'+i;const b=document.createElement('button');b.textContent=el.dataset.outline||el.textContent;b.dataset.target=el.id;if(el.tagName==='H3'&&!el.dataset.outline)b.className='sub';
    b.onclick=()=>{if(el.tagName==='DETAILS')el.open=true;el.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})};outline.append(b);
  });
  sizeOutline();markOutline();
}
/* "On this page" appears only for long records: four or more sections on a page about twice the visible height. */
function sizeOutline(){const area=$('.peek-content');$('#peek-outline-nav').hidden=!(outlineTargets.length>=4&&area.clientHeight&&area.scrollHeight>area.clientHeight*1.8)}
function markOutline(){
  const area=$('.peek-content'),top=area.getBoundingClientRect().top;let active=outlineTargets[0];
  /* Before the sheet is shown nothing has a position, so the first section stays marked. */
  if(area.clientHeight)for(const el of outlineTargets)if(el.getBoundingClientRect().top-top<=120)active=el;
  for(const b of $('#peek-outline').children){const on=b.dataset.target===active?.id;if(on)b.setAttribute('aria-current','true');else b.removeAttribute('aria-current')}
}
let outlineFrame=0;$('.peek-content').addEventListener('scroll',()=>{cancelAnimationFrame(outlineFrame);outlineFrame=requestAnimationFrame(markOutline)},{passive:true});
new ResizeObserver(()=>sizeOutline()).observe($('.peek-content'));
$('#peek-prev').onclick=()=>stepRecord(-1);$('#peek-next').onclick=()=>stepRecord(1);
$('#peek').addEventListener('keydown',e=>{
  if(e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||!['ArrowLeft','ArrowRight'].includes(e.key)||e.target.closest('input,textarea,select,.table-wrap,pre,[role=menu]'))return;
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

/* Repository images: the app's reader returns the bytes of a registered image link; the page shows them as a blob: URL.
   URLs are kept for the open project and released when the records change. */
let imageCache=new Map();
function releaseImages(){for(const url of imageCache.values())url.then(u=>URL.revokeObjectURL(u),()=>{});imageCache=new Map()}
function imageURL(link){
  const p=projects[current],key=p.id+':'+link.id,path='/api/image?id='+encodeURIComponent(p.id)+'&link='+encodeURIComponent(link.id);
  if(!imageCache.has(key)){
    const load=hosted?api(path).then(data=>new Blob([data.bytes],{type:data.type})):fetch(path,{headers:{'X-Horsemen-Session':session},cache:'no-store'}).then(async r=>{if(r.ok)return r.blob();let message='';try{message=(await r.json()).error}catch{}throw Error(message||'It could not be loaded.')});
    const url=load.then(blob=>URL.createObjectURL(blob));url.catch(()=>imageCache.get(key)===url&&imageCache.delete(key));imageCache.set(key,url);
  }
  return imageCache.get(key);
}
function prButton(area,n){const p=projects[current],b=document.createElement('button');b.className='btn';b.textContent='Load PR #'+n;b.onclick=async()=>{const version=request;b.disabled=true;try{const pr=await api('/api/pr?project='+p.id+'&number='+n);if(version!==request)return;const box=document.createElement('div');box.className='prose';box.innerHTML='<h4>'+escapeHTML(pr.title)+'</h4><p class="quiet">'+escapeHTML(pr.merged?'Merged · '+pr.merged_at:pr.state)+' · '+escapeHTML(pr.merge_commit_sha||'No merge commit')+'</p>'+renderMarkdown(pr.body||'No PR description.',pr.html_url);area.append(box);HorsemenMedia.hydrate(box);b.remove()}catch(e){b.disabled=false;showToast(e.message)}};return b}
function addEvidence(record){const p=projects[current],urls=[...record.content.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g)].filter(m=>m[1]===p.repo);if(!urls.length)return;const area=document.createElement('section');area.className='part evidence-block';area.dataset.outline='Pull requests';area.innerHTML='<h3 class="part-title">Pull requests</h3><p class="quiet">Load a pull request’s title, merge state, and description. A merged pull request alone does not prove delivery.</p>';const row=document.createElement('div');row.className='pr-buttons';for(const n of new Set(urls.map(m=>m[2])))row.append(prButton(area,n));area.append(row);$('#peek-content').append(area)}
/* Mode links and Copy buttons inside the peek. The content is replaced on each render, so the handler sits on its container. */
$('#peek-content').addEventListener('click',e=>{
  const mode=e.target.closest('[data-peek-mode]');
  if(mode){setPeekMode(mode.dataset.peekMode);return}
  const copy=e.target.closest('[data-copy]');
  if(copy){const text=copy.dataset.copy;Promise.resolve(navigator.clipboard?.writeText(text)).then(()=>{if(!navigator.clipboard)throw Error();copy.textContent='Copied';setTimeout(()=>{copy.textContent='Copy'},1600)}).catch(()=>showToast('Copy is not available. Select the text and copy it.'))}
});
$('#close-peek').onclick=()=>$('#peek').close();$('#peek').addEventListener('close',()=>{peekRequest++;toggleMenu($('#peek-menu'),false);opener?.focus({preventScroll:true});syncHash()});
$('#peek-more').onclick=()=>toggleMenu($('#peek-menu'));
for(const b of $$('[data-artifact]')){b.disabled=true;bindArtifact(b)}
const waiting='<span class="waiting">Waiting for source…</span>';
function clearRecords(){request++;records={};releaseImages();clearConnections();if($('#peek').open)$('#peek').close();for(const id of ['#peek-title','#peek-sub','#peek-meta','#peek-content','#source-content','#peek-records','#peek-outline','#peek-menu'])$(id).replaceChildren();for(const b of $$('[data-artifact]')){b.disabled=true;const body=b.querySelector('.cardbody');if(body)body.innerHTML=waiting}}
/* The quiet line under the project name: where it lives, when Progress says it was updated, and the commit read. */
function projectMeta(p){
  const updated=records.progress&&!records.progress.error?HorsemenPreview.facts(records.progress.content).find(f=>/^updated$/i.test(f.label)):null,r=updated&&HorsemenViews.relative(updated.value.slice(0,10));
  return [p.repo+(p.root?' / '+p.root:''),r?'updated '+r.text.toLocaleLowerCase():'','commit '+p.revision.slice(0,7)].filter(Boolean).join(' · ');
}
function setPrivacy(p){$('#privacy').hidden=!p?.private;$('#privacy').title=p?.private?'Private repository':''}
async function selectProject(index){
  clearRecords();const version=request;current=index;const p=projects[index];
  $('#project-name').textContent=p.name;$('#project-description').textContent=projectMeta(p);setPrivacy(p);
  $$('[data-project]').forEach(b=>{const on=+b.dataset.project===index;b.classList.toggle('active',on);b.setAttribute('aria-current',on?'page':'false')});
  syncHash();document.body.dataset.state='loading';loadCanvas();
  try{
    const data=await api('/api/project?id='+p.id);if(version!==request)return;records=data.records;
    for(const b of $$('[data-artifact]')){const r=records[b.dataset.artifact];if(!r)continue;b.disabled=false;b.classList.toggle('missing',!!r.error);const body=b.querySelector('.cardbody');if(body)body.innerHTML=previewHTML(b.dataset.artifact,r,b.classList.contains('supporter'))}
    $('#project-description').textContent=projectMeta(p);
    installRecordLinks();refreshGraph();document.body.dataset.state='ready';loadCanvas();
    if(linkMatches(p)){const key=pendingLink.r;pendingLink=null;if(key&&records[key])openPeek(key,$('[data-artifact="'+key+'"]'))}
  }catch(e){if(version!==request)return;document.body.dataset.state='error';$('#scan-status').textContent=e.message}
}
/* A card shows a few key lines: the first one larger, the rest small. Supporting records show one line. */
function previewHTML(key,record,short){
  if(record.error)return '<span class="card-note">Not available. '+escapeHTML(record.error)+'</span>';
  const items=HorsemenPreview.preview(key,record.content).items.slice(0,short?1:3);
  if(!items.length)return '<span class="card-note">This record is empty.</span>';
  return items.map((item,i)=>'<span class="'+(i||short?'card-line':'card-lead')+'">'+(i&&!short?'<span class="card-label">'+escapeHTML(item.label)+'</span> ':'')+escapeHTML(item.text)+'</span>').join('');
}
/* The project list. Search appears only when the list is long. */
const SEARCH_FROM=9;
function renderProjects(){
  const nav=$('#projects'),query=$('#project-search').value;nav.replaceChildren();let shown=0;
  $('.project-search').hidden=projects.length<SEARCH_FROM&&!query&&document.activeElement!==$('#project-search');
  const twins=new Set(projects.map(p=>p.name).filter((n,i,all)=>all.indexOf(n)!==i));
  projects.forEach((p,i)=>{
    if(!HorsemenPreview.matchesProject(p,query))return;shown++;
    const b=document.createElement('button');b.className='project';b.dataset.project=i;b.title=p.repo+(p.root?' / '+p.root:'');
    b.classList.toggle('active',i===current);b.setAttribute('aria-current',i===current?'page':'false');
    b.innerHTML='<span>'+escapeHTML(p.name)+'</span>'+(p.private?icon('lock','icon private-mark'):'')+(twins.has(p.name)?'<small>'+escapeHTML(p.repo+(p.root?' / '+p.root:''))+'</small>':'');
    b.onclick=()=>{pendingLink=null;selectProject(i)};nav.append(b);
  });
  $('#no-projects').hidden=shown!==0||!query.trim();
}
$('#project-search').oninput=renderProjects;$('#project-search').onblur=()=>{if(!$('#project-search').value)renderProjects()};
function receiveProjects(found){
  const selected=projects[current]?.id;
  projects=found.sort((a,b)=>a.repo.localeCompare(b.repo)||a.root.localeCompare(b.root));
  const index=projects.findIndex(p=>p.id===selected);current=Math.max(0,index);renderProjects();
  const wanted=pendingLink?projects.findIndex(linkMatches):-1;
  if(wanted>=0&&!linkMatches(projects[current]))selectProject(wanted);
  else if(index<0&&projects.length)selectProject(0);
}
/* Scan status shows only while discovery runs or when something needs attention. The menu keeps the last result. */
function showStatus(state,suffix){
  $('#scan-status').textContent=state.phase==='error'?'Discovery failed':state.completed+' / '+state.total+' repositories checked · '+state.projects.length+' projects found'+suffix;
  if(state.finished_at&&state.phase!=='scanning')$('#scan-summary').textContent='Checked '+new Date(state.finished_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+' · '+state.projects.length+(state.projects.length===1?' project':' projects');
  $('#issues').hidden=!state.issues.length;$('#issues').textContent=state.issues.map(i=>(i.repo?i.repo+': ':'')+i.message).join('\n');
  if(state.account)$('#account').textContent=state.account;
}
const scanning=on=>{document.body.dataset.scan=on?'running':'done'};
async function scan(){
  const run=++scanRun;clearRecords();projects=[];renderProjects();$('#connect').disabled=true;setPrivacy(null);
  $('#project-name').textContent='Finding your projects';$('#project-description').textContent=copy('Reading default branches. Your files stay on this machine.','Reading default branches. Horsemen stores none of your project data.');
  document.body.dataset.state='scanning';scanning(true);$('#scan-status').textContent='Connecting to GitHub…';
  try{
    await api('/api/scan','POST');
    while(run===scanRun){
      const state=await api('/api/status');if(run!==scanRun)return;
      showStatus(state,state.phase==='scanning'?' · Scanning…':'');receiveProjects(state.projects);
      if(state.phase!=='scanning'){scanning(false);if(!projects.length){document.body.dataset.state=state.phase;$('#project-name').textContent=state.phase==='error'?'GitHub needs attention':'No Horsemen projects found';$('#project-description').textContent='A project needs at least two core records, including VISION or PROGRESS (legacy STATUS also works).'}break}
      await new Promise(r=>setTimeout(r,hosted?200:1000));
    }
  }catch(e){if(run===scanRun){$('#scan-status').textContent=e.message;document.body.dataset.state='error';scanning(false)}}
  finally{if(run===scanRun)$('#connect').disabled=false}
}
async function clearWorkspace(){
  scanRun++;clearRecords();projects=[];renderProjects();await api('/api/clear','POST');scanning(false);
  $('#connect').disabled=false;$('#issues').textContent='';$('#issues').hidden=true;$('#scan-summary').textContent='';setPrivacy(null);
  $('#project-name').textContent='Workspace cleared';$('#project-description').textContent='Refresh GitHub to load your projects again.';
  $('#scan-status').textContent=copy('Local memory cleared. GitHub sign-in is unchanged.','Workspace cleared from this tab. You are still signed in.');
  document.body.dataset.state='idle';syncHash();
}
$('#connect').onclick=()=>{closeMenus();scan()};$('#clear').onclick=()=>{closeMenus();clearWorkspace()};
const canvas=$('.canvas'), world=$('#map');
const defaults={vision:[0,0],progress:[360,0],brain:[0,248],structure:[360,248],readme:[0,496],changelog:[233,496],techstack:[466,496]};
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
      b.innerHTML=icon(kindIcon(link.kind))+'<strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+'</small>';b.setAttribute('aria-label','Open '+link.title);
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
  refreshGraph();arrangeLinked(before);renderPositions();
}
function installRecordLinks(){
  for(const [key,r] of Object.entries(records)){
    for(const link of r.connections||[]){const target=Object.entries(records).find(([,v])=>v.path&&v.path===link.path);if(target&&target[0]!==key)baseRelations.push([key,target[0],'links to'])}

  }
}

function refreshGraph(){
  const visible=HorsemenCanvas.visibleGraph(Object.keys(names),expandedConnections);
  for(const node of connectionNodes.values())if(node.element)node.element.hidden=!visible.has(node.id);
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
function renderCamera(){const list=world.classList.contains('list');world.style.transform=list?'none':`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;zoom=camera.z;$('#zoom-label').textContent=Math.round(zoom*100)+'%';$('#zoom-out').disabled=list||zoom<=.15;$('#zoom-in').disabled=list||zoom>=3.5;$('#fit').disabled=list;canvas.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;canvas.style.backgroundPosition=`${camera.x}px ${camera.y}px`}
function zoomAt(next,x=canvas.clientWidth/2,y=canvas.clientHeight/2){next=Math.max(.15,Math.min(3.5,next));const wx=(x-camera.x)/camera.z,wy=(y-camera.y)/camera.z;camera={x:x-wx*next,y:y-wy*next,z:next};renderCamera()}
function fitCanvas(onlySelected=false){if(world.classList.contains('list'))return;const nodes=$$('[data-artifact]').filter(e=>!e.hidden&&(!onlySelected||selected.has(e.dataset.artifact)));if(!nodes.length)return;const minX=Math.min(...nodes.map(e=>position(e.dataset.artifact)[0])),minY=Math.min(...nodes.map(e=>position(e.dataset.artifact)[1])),maxX=Math.max(...nodes.map(e=>position(e.dataset.artifact)[0]+e.offsetWidth)),maxY=Math.max(...nodes.map(e=>position(e.dataset.artifact)[1]+e.offsetHeight));const top=32,bottom=76,room=Math.max(120,canvas.clientHeight-top-bottom),z=Math.max(.15,Math.min(1,(canvas.clientWidth-60)/(maxX-minX),room/(maxY-minY)));/* Keep clear of the zoom control. */camera={x:(canvas.clientWidth-(maxX-minX)*z)/2-minX*z,y:top+(room-(maxY-minY)*z)/2-minY*z,z};renderCamera()}
function loadCanvas(){gesture=null;pointers.clear();pinch=null;renderPositions();fitCanvas()}
function setView(list){cancelGesture();world.classList.toggle('list',list);canvas.classList.toggle('list-mode',list);$('#canvas-view').setAttribute('aria-pressed',!list);$('#list-view').setAttribute('aria-pressed',list);renderCamera();drawWires();renderCardToggles()}
$('#list-view').onclick=()=>setView(true);$('#canvas-view').onclick=()=>setView(false);
$('#zoom-out').onclick=()=>zoomAt(camera.z/1.2);$('#zoom-in').onclick=()=>zoomAt(camera.z*1.2);$('#fit').onclick=()=>fitCanvas();
function resetLayout(){layouts[projects[current]?.id || "empty"]={};saveLayout();arrangeLinked(new Set());loadCanvas();showToast('Layout reset for '+(projects[current]?.name || 'workspace')+'.')}
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
      control.onkeydown=e=>{if(['Enter',' ','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))e.stopPropagation()};
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
    const rect=card.getBoundingClientRect(),inset=10;
    /* Top-right corner, level with the card title. */
    control.style.left=((rect.right-origin.left)/scale-control.offsetWidth-12)+'px';
    control.style.top=((rect.top-origin.top)/scale+inset)+'px';
    control.style.zIndex=String((Number(card.style.zIndex)||1)+1);
  }
}

function updateSelection(){
  for(const el of $$('[data-artifact]')){el.classList.toggle('canvas-selected',selected.has(el.dataset.artifact));el.setAttribute('aria-pressed',selected.has(el.dataset.artifact))}
  const id=selected.size===1?[...selected][0]:null,record=records[id]||connectionNodes.get(id)?.record;
  $('#selection-label').textContent=selected.size===0?'':selected.size>1?selected.size+' records selected.':(record?.name||connectionNodes.get(id)?.link.title||names[id])+' selected. Press Enter to open.';
  renderCardToggles();
}
function setTool(next){cancelGesture();tool=next;canvas.dataset.tool=next}
function openSelected(){const id=selected.size===1?[...selected][0]:null;if(id)openArtifact(id,$('[data-artifact="'+id+'"]'))}
function collapseAll(){expandedConnections.clear();refreshGraph()}
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
  if(e.shiftKey&&e.code==='KeyC'&&!e.ctrlKey&&!e.metaKey){e.preventDefault();collapseAll();return}
  const active=canvas.contains(e.target)||$('.zoom').contains(e.target);if(!active)return;
  if(e.key==='Escape'){e.preventDefault();cancelGesture();setSelection(new Set());setTool('select');return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();setSelection(new Set($$('[data-artifact]').filter(b=>!b.hidden&&!b.disabled).map(b=>b.dataset.artifact)));return}
  if(e.key==='Enter'&&selected.size===1){e.preventDefault();openSelected();return}
  const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
  if(d){e.preventDefault();const focused=e.target.closest('[data-artifact]');if(e.altKey&&focused)setSelection(new Set([focused.dataset.artifact]));if(selected.size){const step=e.altKey?20:e.shiftKey?10:1;for(const id of selected){const p=position(id);positions()[id]=[p[0]+d[0]*step,p[1]+d[1]*step]}renderPositions();saveLayout()}else{camera.x-=d[0]*60;camera.y-=d[1]*60;renderCamera()}return}
  if(e.shiftKey&&e.code==='Digit1'){e.preventDefault();fitCanvas();return}
  if(e.shiftKey&&e.code==='Digit2'){e.preventDefault();fitCanvas(true);return}
  if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')zoomAt(1);else zoomAt(camera.z*(e.key==='-'?1/1.2:1.2))}
});
window.addEventListener('keyup',e=>{if(e.code==='Space'){spaceDown=false;canvas.classList.remove('pan-ready')}});
window.addEventListener('blur',()=>{spaceDown=false;canvas.classList.remove('pan-ready');cancelGesture()});
canvas.dataset.tool='select';
/* Menus: the account menu in the rail and the ⋯ menu in a record. Arrow keys move, Escape closes, a click outside closes. */
const accountMenu=$('#menu'),themeQuery=matchMedia('(prefers-color-scheme: dark)');
const menuButton=menu=>menu===accountMenu?$('#menu-toggle'):$('#peek-more');
const menuItems=menu=>[...menu.querySelectorAll('[role^=menuitem]')].filter(el=>!el.hidden&&!el.closest('[hidden]'));
function toggleMenu(menu,open=menu.hidden){
  if(open&&menu.hidden===false)return;
  menu.hidden=!open;menuButton(menu).setAttribute('aria-expanded',open);
  if(open)(menu.querySelector('[aria-checked=true]')||menuItems(menu)[0])?.focus();
}
function closeMenus(){for(const m of [accountMenu,$('#peek-menu')])if(!m.hidden)toggleMenu(m,false)}
for(const menu of [accountMenu,$('#peek-menu')])menu.addEventListener('keydown',e=>{
  const items=menuItems(menu),at=items.indexOf(document.activeElement);
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();toggleMenu(menu,false);menuButton(menu).focus()}
  else if(['ArrowDown','ArrowUp','ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=e.key==='ArrowDown'||e.key==='ArrowRight'?1:-1;items[(at+step+items.length)%items.length]?.focus()}
  else if(e.key==='Home'||e.key==='End'){e.preventDefault();e.stopPropagation();items[e.key==='Home'?0:items.length-1]?.focus()}
  else if(e.key==='Tab')toggleMenu(menu,false);
});
$('#menu-toggle').onclick=()=>toggleMenu(accountMenu);
document.addEventListener('pointerdown',e=>{
  if(!accountMenu.hidden&&!e.target.closest('#menu,#menu-toggle'))toggleMenu(accountMenu,false);
  if(!$('#peek-menu').hidden&&!e.target.closest('#peek-menu,#peek-more'))toggleMenu($('#peek-menu'),false);
});
/* Themes: one choice. The selected tile shows its options: Engraved palettes, or a mode for a theme with light and dark.
   The default (Engraved, System palette, System mode) is not saved, so a later default can change it. */
const T=HorsemenThemes,root=document.documentElement,paletteChoices=[{id:'system',label:'System',note:'Follows this device'},...T.themes];
const modeChoices=[{id:'system',label:'System',icon:'device'},{id:'light',label:'Light',icon:'sun'},{id:'dark',label:'Dark',icon:'moon'}];
const readSaved=key=>{try{return localStorage.getItem(key)}catch{return null}};
const save=(key,value)=>{try{if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,value)}catch{}};
function themePrefs(){return {style:readSaved('horsemen-style'),type:readSaved('horsemen-type'),theme:readSaved('horsemen-theme'),mode:readSaved('horsemen-mode'),prefersDark:themeQuery.matches}}
function applyTheme(choice={}){
  if(choice.style!==undefined){save('horsemen-style',choice.style===T.styles[0].id?null:choice.style);save('horsemen-type',null)}
  if(choice.theme!==undefined)save('horsemen-theme',choice.theme==='system'?null:choice.theme);
  if(choice.mode!==undefined)save('horsemen-mode',choice.mode==='system'?null:choice.mode);
  const prefs=themePrefs(),now=T.attributes(prefs),style=T.styles.find(s=>s.id===now.style);
  root.dataset.style=now.style;root.dataset.mode=now.mode;if(now.theme)root.dataset.theme=now.theme;else delete root.dataset.theme;
  const palette=prefs.theme&&T.resolve(prefs.theme,false)===T.resolve(prefs.theme,true)?now.theme||T.resolve(prefs.theme,false):'system';
  const mode=style.modes.includes(prefs.mode)?prefs.mode:'system';
  for(const b of accountMenu.querySelectorAll('[data-style-choice]'))b.setAttribute('aria-checked',b.dataset.styleChoice===now.style);
  for(const b of accountMenu.querySelectorAll('[data-theme-choice]'))b.setAttribute('aria-checked',b.dataset.themeChoice===palette);
  for(const b of accountMenu.querySelectorAll('[data-mode-choice]'))b.setAttribute('aria-checked',b.dataset.modeChoice===mode);
  /* Previews show the mode that each theme would use now. */
  for(const p of document.querySelectorAll('.theme-preview,.theme-chip')){
    if(p.dataset.style==='engraved')p.dataset.swatch=T.resolve(prefs.theme,prefs.prefersDark);
    else p.dataset.mode=T.resolveMode(p.dataset.style,prefs.mode,prefs.prefersDark);
  }
  $('#palette-row').hidden=!style.palettes;$('#mode-row').hidden=style.palettes||style.modes.length<2;
  const detail=style.palettes?paletteChoices.find(t=>t.id===palette).label:style.modes.length>1?modeChoices.find(m=>m.id===mode).label:'';
  $('#theme-name').textContent=style.label+(detail?' · '+detail:'');
  return now;
}
/* A preview is a small card and a line of text, drawn by the theme's own tokens. */
/* Previews show each theme as it would look now: Engraved in the current palette, others in the current mode. */
function previewAttrs(s){const prefs=themePrefs();return 'data-style="'+s.id+'" '+(s.palettes?'data-swatch="'+T.resolve(prefs.theme,prefs.prefersDark)+'"':'data-mode="'+T.resolveMode(s.id,prefs.mode,prefs.prefersDark)+'"')}
const themePreview=s=>'<span class="theme-preview" '+previewAttrs(s)+' aria-hidden="true"><span class="tp-card"><b class="tp-title"><i></i>Progress</b><span class="tp-line">Invite three operators</span></span></span>';
const themeChip=s=>'<span class="theme-chip" '+previewAttrs(s)+' aria-hidden="true">Aa</span>';
const radio=(attrs,label)=>{const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');for(const [k,v] of Object.entries(attrs))b.dataset[k]=v;b.setAttribute('aria-label',label);return b};
for(const s of T.styles){
  const b=radio({styleChoice:s.id},s.label+': '+s.note);b.className='theme-tile';b.title=s.note;
  b.innerHTML=themePreview(s)+'<span class="tile-name"><span>'+escapeHTML(s.label)+'</span>'+icon('check')+'</span>';
  b.onclick=()=>applyTheme({style:s.id});$('#menu .theme-gallery').append(b);
}
/* Engraved palettes are swatches with their names on hover and for screen readers. */
for(const t of paletteChoices){
  const b=radio({themeChoice:t.id},t.label+': '+t.note);b.title=t.label;
  const chips=t.id==='system'?['bone','ink']:[t.id];
  b.innerHTML='<span class="swatch">'+chips.map(id=>'<span data-swatch="'+id+'"><i></i><i></i></span>').join('')+'</span>';
  b.onclick=()=>applyTheme({style:'engraved',theme:t.id});$('#palette-row').append(b);
}
for(const m of modeChoices){
  const b=radio({modeChoice:m.id},m.id==='system'?'System: follows this device':m.label);
  b.innerHTML=icon(m.icon)+'<span>'+m.label+'</span>';
  b.onclick=()=>applyTheme({mode:m.id});$('#mode-row').append(b);
}
themeQuery.addEventListener('change',()=>applyTheme());applyTheme();

/* Shortcut sheet: from Jump or the ? key. */
const sheet=$('#shortcuts');
function openShortcuts(){closeMenus();if(palette.open)palette.close();if(!sheet.open)sheet.showModal();$('#close-shortcuts').focus()}
$('#close-shortcuts').onclick=()=>sheet.close();sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.close()});
window.addEventListener('keydown',e=>{if(e.key==='?'&&!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.target.closest('input,textarea,select,[contenteditable=true]')&&!$('#peek').open&&!palette.open){e.preventDefault();sheet.open?sheet.close():openShortcuts()}});

/* Jump: one field that reaches every project, record, view, and theme. */
const palette=$('#palette');let paletteShown=[],paletteAt=0;
function paletteItems(){
  const items=[],leave=()=>{if($('#peek').open)$('#peek').close()},list=world.classList.contains('list'),one=selected.size===1?[...selected][0]:null;
  for(const key of readable())items.push({group:'Records',icon:key,label:titles[key],hint:names[key],run:()=>openPeek(key,$('[data-artifact="'+key+'"]'))});
  for(const node of connectionNodes.values())if(node.element&&!node.element.hidden)items.push({group:'Linked documents',icon:kindIcon(node.link.kind),label:node.link.title,hint:node.link.path||node.link.href,run:()=>openArtifact(node.id,node.element)});
  projects.forEach((p,i)=>{if(i!==current)items.push({group:'Projects',icon:'layers',label:p.name,hint:p.repo+(p.root?' / '+p.root:''),run:()=>{leave();pendingLink=null;selectProject(i)}})});
  const canvasOnly=run=>()=>{leave();setView(false);run()};
  items.push({group:'Actions',icon:list?'canvas':'list',label:list?'Show the canvas':'Show the list',hint:'View',run:()=>{leave();setView(!list)}});
  if(one)items.push({group:'Actions',icon:'expand',label:'Open the selected record',hint:'Enter',run:()=>{leave();openSelected()}});
  items.push({group:'Actions',icon:'fit',label:'Fit all cards',hint:'Shift + 1',run:canvasOnly(()=>fitCanvas())},
    {group:'Actions',icon:'select',label:'Select tool',hint:'V',run:canvasOnly(()=>setTool('select'))},
    {group:'Actions',icon:'hand',label:'Hand tool',hint:'H',run:canvasOnly(()=>setTool('hand'))},
    {group:'Actions',icon:'collapse',label:'Collapse all linked branches',hint:'Shift + C',run:()=>{leave();collapseAll()}},
    {group:'Actions',icon:'reset',label:'Reset layout',hint:'Canvas',run:canvasOnly(resetLayout)},
    {group:'Actions',icon:'keyboard',label:'Keyboard shortcuts',hint:'?',run:openShortcuts},
    {group:'Actions',icon:'refresh',label:'Refresh GitHub',hint:'Scan again',run:()=>{leave();scan()}},
    {group:'Actions',icon:'clear',label:'Clear workspace',hint:copy('Remove the scan from memory','Remove the scan from this tab'),run:()=>{leave();clearWorkspace()}});
  if(hosted&&projects[current])items.push({group:'Actions',icon:'link',label:'Copy link',hint:'Share',run:()=>$('#share-link')?.click()});
  const active=T.styles.find(st=>st.id===root.dataset.style);
  for(const st of T.styles)items.push({group:'Themes',chip:themeChip(st),label:st.label+' theme',hint:st.note,run:()=>applyTheme({style:st.id})});
  if(active.palettes)for(const t of paletteChoices)items.push({group:'Themes',icon:t.id==='system'?'device':t.scheme==='dark'?'moon':'sun',label:'Engraved palette: '+t.label,hint:t.note,run:()=>applyTheme({style:'engraved',theme:t.id})});
  else if(active.modes.length>1)for(const m of modeChoices)items.push({group:'Themes',icon:m.icon,label:m.id==='system'?'System mode':m.label+' mode',hint:m.id==='system'?'Follows this device':active.label,run:()=>applyTheme({mode:m.id})});
  return items;
}
function renderPalette(){
  const words=$('#palette-input').value.toLocaleLowerCase().split(/\s+/).filter(Boolean),list=$('#palette-list');
  paletteShown=paletteItems().filter(item=>{const hay=(item.group+' '+item.label+' '+item.hint).toLocaleLowerCase();return words.every(word=>hay.includes(word))});
  paletteAt=Math.min(paletteAt,Math.max(0,paletteShown.length-1));list.replaceChildren();let group='';
  paletteShown.forEach((item,i)=>{
    if(item.group!==group){group=item.group;list.append(Object.assign(document.createElement('p'),{className:'navlabel',textContent:group}))}
    const b=document.createElement('button');b.type='button';b.id='palette-option-'+i;b.setAttribute('role','option');b.setAttribute('aria-selected',i===paletteAt);b.tabIndex=-1;
    b.innerHTML=(item.chip||icon(item.icon))+'<span>'+escapeHTML(item.label)+'</span><small>'+escapeHTML(item.hint)+'</small>';
    b.onclick=()=>{palette.close();item.run()};b.onpointermove=()=>{if(paletteAt!==i){paletteAt=i;markPalette()}};list.append(b);
  });
  if(!paletteShown.length)list.append(Object.assign(document.createElement('p'),{className:'palette-empty',textContent:'Nothing matches. Try a project, a record, “theme”, or “shortcuts”.'}));
  markPalette();
}
function markPalette(){
  $$('#palette-list [role=option]').forEach((b,i)=>{b.setAttribute('aria-selected',i===paletteAt);if(i===paletteAt)b.scrollIntoView({block:'nearest'})});
  if(paletteShown.length)$('#palette-input').setAttribute('aria-activedescendant','palette-option-'+paletteAt);else $('#palette-input').removeAttribute('aria-activedescendant');
}
function openPalette(){if(palette.open)return;closeMenus();if(sheet.open)sheet.close();$('#palette-input').value='';paletteAt=0;renderPalette();palette.showModal();$('#palette-input').focus()}
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
      showStatus(state,' · Last scan '+new Date(state.finished_at).toLocaleTimeString());scanning(false);
      if(projects.length){await selectProject(Math.max(0,pendingLink?projects.findIndex(linkMatches):0));return}
    }
    await scan();
  }catch(e){$('#scan-status').textContent=e.message;document.body.dataset.state='error';scanning(false)}
}
/* Hosted mode: the background check of the saved discovery index finished. */
document.addEventListener('horsemen:projects',event=>{
  const state=event.detail;if(!['ready','partial'].includes(state.phase))return;
  receiveProjects(state.projects);
  showStatus(state,' · Checked '+new Date(state.finished_at).toLocaleTimeString());
});
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
