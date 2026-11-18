'use strict';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const names={vision:'VISION.md',progress:'PROGRESS.md',brain:'BRAIN.md',structure:'STRUCTURE.md',readme:'README.md',changelog:'CHANGELOG.md',techstack:'TECHSTACK.md'};
let projects=[],current=0,zoom=1,records={},opener=null,request=0,scanRun=0;
const session=$('meta[name="horsemen-session"]').content;
const escapeHTML=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
function safeURL(value,base){try{const u=new URL(value,base);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
function inline(text,base){return text.split(/(!?\[[^\]]*\]\([^\s)]+\)|`[^`]+`)/g).map(part=>{const m=part.match(/^(!?)\[([^\]]*)\]\(([^\s)]+)\)$/);if(m){const url=safeURL(m[3],base);return url?'<a target="_blank" rel="noopener noreferrer" href="'+escapeHTML(url)+'">'+(m[1]?'Attachment: ':'')+escapeHTML(m[2]||url)+'</a>':escapeHTML(m[2])}if(part.startsWith('`')&&part.endsWith('`'))return '<code>'+escapeHTML(part.slice(1,-1))+'</code>';return escapeHTML(part).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')}).join('')}
function renderMarkdown(text,base){
  const lines=text.split('\n'),out=[];let code=null,list=false,disclosures=0;
  const close=()=>{if(list){out.push('</ul>');list=false}};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(/^\s*```/.test(line)){close();if(code!==null){out.push('<pre><code>'+escapeHTML(code.join('\n'))+'</code></pre>');code=null}else code=[];continue}
    if(code!==null){code.push(line);continue}
    if(/^<details(?: open)?>\s*$/.test(line)){close();out.push(line.includes('open')?'<details open>':'<details>');disclosures++;continue}
    if(/^<\/details>\s*$/.test(line)&&disclosures){close();out.push('</details>');disclosures--;continue}
    const summary=line.match(/^<summary>(.*?)<\/summary>\s*$/);
    if(summary&&disclosures){close();out.push('<summary>'+inline(summary[1],base)+'</summary>');continue}
    if(line.includes('|')&&i+1<lines.length&&/^\s*\|?\s*:?-{3,}/.test(lines[i+1])&&cells(lines[i+1]).every(c=>/^:?-{3,}:?$/.test(c))){
      close();out.push('<table><thead><tr>'+cells(line).map(c=>'<th>'+inline(c,base)+'</th>').join('')+'</tr></thead><tbody>');i++;
      while(i+1<lines.length&&lines[i+1].includes('|')&&lines[i+1].trim()){i++;out.push('<tr>'+cells(lines[i]).map(c=>'<td>'+inline(c,base)+'</td>').join('')+'</tr>')}
      out.push('</tbody></table>');continue;
    }
    const h=line.match(/^(#{1,6})\s+(.*)/),li=line.match(/^\s*(?:[-*+] |\d+\. )(.*)/);
    if(li){if(!list){out.push('<ul>');list=true}out.push('<li>'+inline(li[1],base)+'</li>');continue}
    close();if(h)out.push('<h'+h[1].length+'>'+inline(h[2],base)+'</h'+h[1].length+'>');else if(line.trim())out.push('<p>'+inline(line,base)+'</p>');
  }
  close();if(code!==null)out.push('<pre>'+escapeHTML(code.join('\n'))+'</pre>');while(disclosures-->0)out.push('</details>');return out.join('');
}
async function api(path,method='GET'){const r=await fetch(path,{method,headers:{'X-Horsemen-Session':session},cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'Request failed');return data}
function showToast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3500)}
let peekTrail=[],peekRequest=0,peekMode='overview';
function setTab(source){setPeekMode(source?'source':'overview')}
function setPeekMode(mode){
  peekMode=mode;$('#peek-content').hidden=mode==='source';$('#source-content').hidden=mode!=='source';
  for(const [id,value] of [['reading-tab','overview'],['document-tab','document'],['source-tab','source']]){const b=$('#'+id);b.classList.toggle('active',mode===value);b.setAttribute('aria-pressed',mode===value)}
  renderPeek();
}
function openPeek(key,button){const r=records[key];if(!r)return;opener=button;peekRequest++;peekTrail=[{key,record:r,nodeId:key}];peekMode='overview';renderPeek();if(!$('#peek').open)$('#peek').showModal();$('#close-peek').focus()}
function sectionCard(section,record,extra=''){return '<section class="detail-section '+extra+'"><h3>'+escapeHTML(section.title)+'</h3>'+renderMarkdown(section.body,record.url)+'</section>'}
function overviewHTML(key,record){
  const model=HorsemenPreview.detail(key,record.content),summary=HorsemenPreview.preview(key,record.content);
  const intro=model.intro.replace(/^#\s+.*$/m,'').trim();
  let hero=summary.items[0];
  if(key==='progress')hero=summary.items.find(i=>i.label==='Next action')||hero;
  let html='<div class="artifact-overview '+model.layout+'" data-layout="'+model.layout+'"><div class="detail-eyebrow">'+escapeHTML(key==='document'?'Connected document':key)+' · Source snapshot</div><h2>'+escapeHTML(model.title||record.name)+'</h2>';
  if(hero&&['vision','progress','readme'].includes(key))html+='<div class="detail-hero"><span>'+escapeHTML(hero.label)+'</span><p>'+escapeHTML(hero.text)+'</p></div>';
  if(key==='brain')html+='<p class="detail-intro">Knowledge stays with its original source. Open a connection to explore it, or inspect the access rules below.</p><div data-connections-slot></div>';
  if(key==='progress'){
    const current=model.sections.filter(s=>!/^historical|history|upcoming/i.test(s.title));
    html+='<div class="status-board">'+current.map(s=>sectionCard(s,record,/gate|block/i.test(s.title)?'warning':'')).join('')+'</div>';
    const history=model.sections.filter(s=>/^historical|history|upcoming/i.test(s.title));
    if(history.length)html+='<details class="detail-history"><summary>History and roadmap</summary>'+history.map(s=>sectionCard(s,record)).join('')+'</details>';
  }else if(key==='structure'){
    const map=model.sections.find(s=>/^map$|tree|layout|structure/i.test(s.title));
    if(map)html+=sectionCard(map,record,'directory-panel');
    html+='<div class="detail-grid">'+model.sections.filter(s=>s!==map).map(s=>sectionCard(s,record)).join('')+'</div>';
  }else if(key==='changelog'){
    html+='<div class="release-timeline">'+model.sections.map(s=>sectionCard(s,record,'release-entry')).join('')+'</div>';
  }else if(key==='techstack'){
    for(const section of model.sections){
      const table=HorsemenPreview.toolsTable(section.body);
      if(!table.rows.length){html+=sectionCard(section,record,'tool-section');continue}
      html+='<h3>'+escapeHTML(section.title)+' · '+table.rows.length+' tools</h3><div class="tool-grid">'+table.rows.map(row=>'<section class="tool-card"><div class="tool-mark">'+escapeHTML(row[0].slice(0,2).toUpperCase())+'</div><h3>'+escapeHTML(row[0])+'</h3><dl>'+row.slice(1).map((cell,i)=>'<dt>'+escapeHTML(table.headers[i+1]||'Details')+'</dt><dd>'+escapeHTML(cell)+'</dd>').join('')+'</dl></section>').join('')+'</div>';
      const notes=section.body.split('\n').filter(line=>!line.includes('|')).join('\n');if(notes.trim())html+=renderMarkdown(notes,record.url);
    }
  }else{
    html+='<div class="detail-grid">'+model.sections.map(s=>sectionCard(s,record,/boundar|never|access|permission/i.test(s.title)?'boundary':'')).join('')+'</div>';
  }
  if(intro)html+='<details class="detail-history" '+(!model.sections.length?'open':'')+'><summary>Document introduction</summary>'+renderMarkdown(intro,record.url)+'</details>';
  if(!intro&&!model.sections.length)html+='<p>This record is empty.</p>';
  return html+'</div>';
}
function renderPeek(){
  const entry=peekTrail.at(-1);if(!entry)return;
  const r=entry.record;$('#peek').dataset.kind=entry.key;$('#peek-title').textContent=r.name||entry.link?.title||'Document';
  $('#peek-back').hidden=peekTrail.length<2;
  $('#peek-meta').textContent=peekTrail.map(e=>e.record.name||e.link?.title).join(' / ');
  $('#source-content').textContent=r.content||r.error||'This external document has not been loaded.';
  $('#peek-content').hidden=peekMode==='source';$('#source-content').hidden=peekMode!=='source';
  for(const [id,mode] of [['reading-tab','overview'],['document-tab','document'],['source-tab','source']]){const b=$('#'+id);b.classList.toggle('active',peekMode===mode);b.setAttribute('aria-pressed',peekMode===mode)}
  const content=$('#peek-content');content.replaceChildren();$('.peek-content').scrollTop=0;
  if(entry.link&&entry.link.kind!=='document'){
    content.innerHTML='<div class="external-document"><span class="detail-eyebrow">'+escapeHTML(entry.link.kind)+'</span><h2>'+escapeHTML(entry.link.title)+'</h2><p>Linked from '+escapeHTML(entry.link.source)+'. The contents have not been loaded into Horsemen.</p><p class="external-address">'+escapeHTML(entry.link.href)+'</p></div>';
  }else if(r.error)content.innerHTML='<div class="callout amber">'+escapeHTML(r.error)+'</div>';
  else content.innerHTML=peekMode==='document'?renderMarkdown(r.content||'',r.url):overviewHTML(entry.key,r);
  const href=r.url||entry.link?.href;
  if(href&&safeURL(href,location.href)){
    const a=document.createElement('a');a.className='original-source';a.href=href;a.target='_blank';a.rel='noopener noreferrer';a.textContent=entry.link?.kind==='external'?'Open external source ↗':'Open original source ↗';content.prepend(a);
  }
  if(r.connections?.length){
    const panel=document.createElement('section');panel.className='connections-panel';
    panel.innerHTML='<div class="connections-heading"><h3>Connected artifacts <span>'+r.connections.length+'</span></h3></div><div class="connection-grid"></div>';
    const graph=document.createElement('button');graph.className='btn';graph.textContent='Explore on canvas';graph.onclick=()=>{expandConnections(entry.nodeId,r);$('#peek').close();fitCanvas()};panel.querySelector('.connections-heading').append(graph);
    if(expandedConnections.has(entry.nodeId)){const collapse=document.createElement('button');collapse.className='btn';collapse.textContent='Collapse links';collapse.onclick=()=>{expandedConnections.delete(entry.nodeId);refreshGraph();renderPeek()};panel.querySelector('.connections-heading').append(collapse)}
    for(const link of r.connections){const b=document.createElement('button');b.className='connection-card';b.dataset.connection=link.id;b.innerHTML='<span class="connection-type">'+escapeHTML(link.kind==='document'?'Markdown document':link.kind)+'</span><strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+' →</small>';b.onclick=()=>openConnection(link,entry.nodeId);panel.querySelector('.connection-grid').append(b)}
    const slot=content.querySelector('[data-connections-slot]');if(slot)slot.replaceWith(panel);else content.append(panel);
    content.querySelectorAll('a').forEach(a=>{const link=r.connections.find(l=>l.href===a.href);if(link&&!a.classList.contains('original-source'))a.onclick=e=>{if(e.metaKey||e.ctrlKey||e.shiftKey)return;e.preventDefault();openConnection(link,entry.nodeId)}});
  }else if(entry.key==='brain'&&!r.error){const slot=content.querySelector('[data-connections-slot]');if(slot)slot.innerHTML='<div class="connection-empty">No Markdown links found in this record. Add source links to BRAIN.md to connect documents here.</div>'}
  if(entry.key==='changelog'&&!r.error&&peekMode==='overview')addEvidence(r);
}
async function openConnection(link,parentId){
  const nodeId=ensureConnectionNode(parentId,link,false),existing=Object.entries(records).find(([,r])=>r.path===link.path);
  if(peekTrail.length>=32){showToast('Return to an earlier document before going deeper.');return}
  const entry={key:existing?.[0]||'document',record:existing?.[1]||{name:link.title,error:link.kind==='document'?'Loading linked document…':null},link,nodeId};
  peekTrail.push(entry);peekMode='overview';const version=++peekRequest,projectVersion=request;renderPeek();if(!$('#peek').open)$('#peek').showModal();
  if(existing||link.kind!=='document')return;
  try{const record=await api('/api/document?id='+projects[current].id+'&link='+link.id);if(version!==peekRequest||projectVersion!==request||!$('#peek').open)return;entry.record=record;const node=connectionNodes.get(nodeId);if(node)node.record=record;renderPeek()}
  catch(e){if(version!==peekRequest||projectVersion!==request)return;entry.record={name:link.title,error:e.message};renderPeek()}
}
$('#peek-back').onclick=()=>{peekRequest++;peekTrail.pop();peekMode='overview';renderPeek()};
$('#document-tab').onclick=()=>setPeekMode('document');

function addEvidence(record){const p=projects[current],area=document.createElement('section');area.className='evidence-block';area.innerHTML='<h3>Delivery evidence & PRs</h3><p>The source above owns the delivery claim. A merged PR alone does not prove delivery. Attachments below come from the PR description; comments are not scanned.</p>';const urls=[...record.content.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g)].filter(m=>m[1]===p.repo);for(const n of new Set(urls.map(m=>m[2]))){const b=document.createElement('button');b.className='btn';b.textContent='Load PR #'+n;b.onclick=async()=>{const version=request;b.disabled=true;try{const pr=await api('/api/pr?project='+p.id+'&number='+n);if(version!==request)return;const box=document.createElement('div');box.innerHTML='<h3>'+escapeHTML(pr.title)+'</h3><p>'+escapeHTML(pr.merged?'Merged · '+pr.merged_at:pr.state)+' · '+escapeHTML(pr.merge_commit_sha||'No merge commit')+'</p>'+renderMarkdown(pr.body||'No PR description.',pr.html_url);area.append(box);b.remove()}catch(e){b.disabled=false;showToast(e.message)}};area.append(b)}if(!urls.length)area.insertAdjacentHTML('beforeend','<p>No same-repository PR links found in this record.</p>');$('#peek-content').append(area)}
$('#reading-tab').onclick=()=>setTab(false);$('#source-tab').onclick=()=>setTab(true);$('#close-peek').onclick=()=>$('#peek').close();$('#peek').addEventListener('close',()=>{peekRequest++;opener?.focus({preventScroll:true})});
for(const b of $$('[data-artifact]')){b.disabled=true;bindArtifact(b)}
function filter(){const q=$('#search').value.toLowerCase();let count=0;for(const b of $$('[data-artifact]')){b.hidden=!b.textContent.toLowerCase().includes(q);if(!b.hidden)count++}refreshGraph();$('#empty').hidden=$$('[data-artifact]').some(b=>!b.hidden)}
$('#search').oninput=filter;
function clearRecords(){request++;records={};clearConnections();if($('#peek').open)$('#peek').close();for(const id of ['#peek-title','#peek-meta','#peek-content','#source-content'])$(id).replaceChildren();for(const b of $$('[data-artifact]')){b.disabled=true;const body=b.querySelector('.cardbody');if(body)body.innerHTML='<p>Waiting for source…</p>';const foot=b.querySelector('.cardfoot');if(foot)foot.textContent='Not loaded'}}
async function selectProject(index){clearRecords();const version=request;current=index;const p=projects[index];$('#project-name').textContent=p.name;$('#crumb').textContent=p.name;$('#project-description').textContent=p.repo+(p.root?' / '+p.root:'')+' · '+p.revision.slice(0,7);$('#privacy').textContent=p.private?'PRIVATE':'PUBLIC SOURCE';$$('[data-project]').forEach(b=>b.classList.toggle('active',+b.dataset.project===index));document.body.dataset.state='loading';$('#search').value='';filter();loadCanvas();try{const data=await api('/api/project?id='+p.id);if(version!==request)return;records=data.records;for(const b of $$('[data-artifact]')){const r=records[b.dataset.artifact];b.disabled=false;const body=b.querySelector('.cardbody'),foot=b.querySelector('.cardfoot');if(body)body.innerHTML=previewHTML(b.dataset.artifact,r);
if(foot)foot.textContent=r.error?'Missing or unreadable':'Pinned source · '+p.revision.slice(0,7);
if(b.classList.contains('supporter')){
  b.querySelector('small').textContent=r.error?'Missing or unreadable':(HorsemenPreview.preview(b.dataset.artifact,r.content).items[0]?.text||'Empty record');
}
}installRecordLinks();refreshGraph();document.body.dataset.state='ready';loadCanvas()}catch(e){if(version!==request)return;document.body.dataset.state='error';$('#scan-status').textContent=e.message}}
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
    b.onclick=()=>selectProject(i);nav.append(b);
  });
  $('#project-count').textContent=shown+' of '+projects.length+' projects';$('#no-projects').hidden=shown!==0||!query.trim();
}
$('#project-search').oninput=renderProjects;
function receiveProjects(found){
  const selected=projects[current]?.id;
  projects=found.sort((a,b)=>a.repo.localeCompare(b.repo)||a.root.localeCompare(b.root));
  const index=projects.findIndex(p=>p.id===selected);current=Math.max(0,index);renderProjects();
  if(index<0&&projects.length)selectProject(0);
}
async function scan(){const run=++scanRun;clearRecords();projects=[];renderProjects();$('#connect').disabled=true;$('#crumb').textContent='';$('#privacy').textContent='LOCAL';$('#account').textContent='Local GitHub workspace';$('#project-name').textContent='Discovering your projects';$('#project-description').textContent='Reading default branches. Your files stay on this machine.';document.body.dataset.state='scanning';try{await api('/api/scan','POST');while(run===scanRun){const state=await api('/api/status');if(run!==scanRun)return;$('#account').textContent=state.account?'GitHub · '+state.account:'Local GitHub workspace';$('#scan-status').textContent=state.phase==='error'?'Discovery failed':state.completed+' / '+state.total+' repositories checked · '+state.projects.length+' projects found'+(state.phase==='scanning'?' · Scanning…':'');$('#issues').hidden=!state.issues.length;$('#issues').textContent=state.issues.map(i=>(i.repo?i.repo+': ':'')+i.message).join('\n');receiveProjects(state.projects);if(state.phase!=='scanning'){if(!projects.length){document.body.dataset.state=state.phase;$('#project-name').textContent=state.phase==='error'?'GitHub needs attention':'No Horsemen projects found';$('#project-description').textContent='Projects need at least two core records, including VISION or PROGRESS (legacy STATUS is supported).'}break}await new Promise(r=>setTimeout(r,1000))}}catch(e){if(run===scanRun){$('#scan-status').textContent=e.message;document.body.dataset.state='error'}}finally{if(run===scanRun)$('#connect').disabled=false}}
$('#connect').onclick=scan;$('#clear').onclick=async()=>{scanRun++;clearRecords();projects=[];renderProjects();await api('/api/clear','POST');$('#connect').disabled=false;$('#account').textContent='Local GitHub workspace';$('#crumb').textContent='';$('#issues').textContent='';$('#project-name').textContent='Workspace cleared';$('#project-description').textContent='Refresh GitHub to load your projects again.';$('#scan-status').textContent='Local memory cleared. GitHub sign-in is unchanged.';$('#privacy').textContent='LOCAL';$('#issues').hidden=true;document.body.dataset.state='idle'};
const canvas=$('.canvas'), world=$('#map');
const defaults={vision:[0,0],progress:[420,0],brain:[0,355],structure:[420,355],readme:[0,660],changelog:[280,660],techstack:[560,660]};
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
      b.innerHTML='<span class="connection-type">'+escapeHTML(link.kind)+'</span><strong>'+escapeHTML(link.title)+'</strong><small>'+escapeHTML(link.path||new URL(link.href).hostname)+'</small><span class="node-open">Open connection ↗</span>';
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
function expandConnections(parentId,record){
  for(const id of HorsemenCanvas.pathToRoot(parentId,connectionNodes,Object.keys(names))){const node=connectionNodes.get(id);if(node)ensureConnectionNode(node.parentId,node.link,true)}
  for(const link of record.connections||[])ensureConnectionNode(parentId,link,true);
  $('#search').value='';refreshGraph();renderPositions();
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

function drawWires(){wires.replaceChildren();if(world.classList.contains('list'))return;for(const [a,b,label] of relations){const ea=$('[data-artifact="'+a+'"]'),eb=$('[data-artifact="'+b+'"]');if(!ea||!eb||ea.hidden||eb.hidden)continue;const pa=position(a),pb=position(b);const ca={x:pa[0]+ea.offsetWidth/2,y:pa[1]+ea.offsetHeight/2},cb={x:pb[0]+eb.offsetWidth/2,y:pb[1]+eb.offsetHeight/2};const horizontal=Math.abs(cb.x-ca.x)>Math.abs(cb.y-ca.y);const x1=ca.x+(horizontal?Math.sign(cb.x-ca.x)*ea.offsetWidth/2:0),y1=ca.y+(horizontal?0:Math.sign(cb.y-ca.y)*ea.offsetHeight/2),x2=cb.x-(horizontal?Math.sign(cb.x-ca.x)*eb.offsetWidth/2:0),y2=cb.y-(horizontal?0:Math.sign(cb.y-ca.y)*eb.offsetHeight/2);const path=document.createElementNS(wires.namespaceURI,'path');path.setAttribute('d',horizontal?`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`:`M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`);wires.append(path);const text=document.createElementNS(wires.namespaceURI,'text');text.setAttribute('x',(x1+x2)/2);text.setAttribute('y',(y1+y2)/2-8);text.textContent=label;wires.append(text)}}
function renderPositions(){for(const el of $$('[data-artifact]')){const p=position(el.dataset.artifact);el.style.left=p[0]+'px';el.style.top=p[1]+'px'}drawWires();renderCardToggles()}
function renderCamera(){const list=world.classList.contains('list');world.style.transform=list?'none':`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;zoom=camera.z;$('#zoom-label').textContent=Math.round(zoom*100)+'%';$('#zoom-out').disabled=list||zoom<=.15;$('#zoom-in').disabled=list||zoom>=3.5;$('#fit').disabled=list;$('#reset-layout').disabled=list;canvas.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;canvas.style.backgroundPosition=`${camera.x}px ${camera.y}px`}
function zoomAt(next,x=canvas.clientWidth/2,y=canvas.clientHeight/2){next=Math.max(.15,Math.min(3.5,next));const wx=(x-camera.x)/camera.z,wy=(y-camera.y)/camera.z;camera={x:x-wx*next,y:y-wy*next,z:next};renderCamera()}
function fitCanvas(onlySelected=false){if(world.classList.contains('list'))return;const nodes=$$('[data-artifact]').filter(e=>!e.hidden&&(!onlySelected||selected.has(e.dataset.artifact)));if(!nodes.length)return;const minX=Math.min(...nodes.map(e=>position(e.dataset.artifact)[0])),minY=Math.min(...nodes.map(e=>position(e.dataset.artifact)[1])),maxX=Math.max(...nodes.map(e=>position(e.dataset.artifact)[0]+e.offsetWidth)),maxY=Math.max(...nodes.map(e=>position(e.dataset.artifact)[1]+e.offsetHeight));const z=Math.min(1,(canvas.clientWidth-60)/(maxX-minX),(canvas.clientHeight-60)/(maxY-minY));camera={x:(canvas.clientWidth-(maxX-minX)*z)/2-minX*z,y:(canvas.clientHeight-(maxY-minY)*z)/2-minY*z,z:Math.max(.15,z)};renderCamera()}
function loadCanvas(){gesture=null;pointers.clear();pinch=null;renderPositions();fitCanvas()}
function setView(list){cancelGesture();$('.canvas-controls').hidden=list;world.classList.toggle('list',list);canvas.classList.toggle('list-mode',list);$('#canvas-view').setAttribute('aria-pressed',!list);$('#list-view').setAttribute('aria-pressed',list);renderCamera();drawWires();renderCardToggles()}
$('#list-view').onclick=()=>setView(true);$('#canvas-view').onclick=()=>setView(false);
$('#zoom-out').onclick=()=>zoomAt(camera.z/1.2);$('#zoom-in').onclick=()=>zoomAt(camera.z*1.2);$('#fit').onclick=()=>fitCanvas();
$('#reset-layout').onclick=()=>{layouts[projects[current]?.id || "empty"]={};saveLayout();loadCanvas();showToast('Layout reset for '+(projects[current]?.name || 'workspace')+'.')};
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
    control.textContent=(state.disabled?'':state.expanded?'▾ ':'▸ ')+state.label;
    control.setAttribute('aria-expanded',state.expanded);
    control.setAttribute('aria-busy',state.disabled);
    const name=record?.name||node?.link.title||names[id];
    const action=state.expanded?'Collapse':'Expand';
    control.setAttribute('aria-label',action+' linked items for '+name);control.title=action+' linked items';
    if(control.hidden)continue;
    const rect=card.getBoundingClientRect(),bottom=card.classList.contains('supporter')||card.classList.contains('connected-node');
    control.style.left=((rect.right-origin.left)/scale-control.offsetWidth-12)+'px';
    control.style.top=(bottom?(rect.bottom-origin.top)/scale-control.offsetHeight-10:(rect.top-origin.top)/scale+8)+'px';
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
      if(projects.length){await selectProject(0);return}
    }
    await scan();
  }catch(e){$('#scan-status').textContent=e.message;document.body.dataset.state='error'}
}
boot();
