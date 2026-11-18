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
function setTab(source){$('#peek-content').hidden=source;$('#source-content').hidden=!source;$('#reading-tab').classList.toggle('active',!source);$('#source-tab').classList.toggle('active',source);$('#reading-tab').setAttribute('aria-pressed',!source);$('#source-tab').setAttribute('aria-pressed',source)}
function openPeek(key,button){const r=records[key];if(!r)return;opener=button;$('#peek-title').textContent=r.name;$('#peek-meta').textContent=(projects[current]?.repo||'')+' · '+(r.path||r.name);$('#peek-content').innerHTML=r.error?'<div class="callout amber">'+escapeHTML(r.error)+'</div>':renderMarkdown(r.content,r.url);$('#source-content').textContent=r.content||r.error;setTab(false);if(r.url){const a=document.createElement('a');a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open pinned source on GitHub ↗';$('#peek-content').prepend(a)}if(key==='changelog'&&!r.error)addEvidence(r);$('#peek').showModal();$('#close-peek').focus()}
function addEvidence(record){const p=projects[current],area=document.createElement('section');area.className='evidence-block';area.innerHTML='<h3>Delivery evidence & PRs</h3><p>The source above owns the delivery claim. A merged PR alone does not prove delivery. Attachments below come from the PR description; comments are not scanned.</p>';const urls=[...record.content.matchAll(/https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/g)].filter(m=>m[1]===p.repo);for(const n of new Set(urls.map(m=>m[2]))){const b=document.createElement('button');b.className='btn';b.textContent='Load PR #'+n;b.onclick=async()=>{const version=request;b.disabled=true;try{const pr=await api('/api/pr?project='+p.id+'&number='+n);if(version!==request)return;const box=document.createElement('div');box.innerHTML='<h3>'+escapeHTML(pr.title)+'</h3><p>'+escapeHTML(pr.merged?'Merged · '+pr.merged_at:pr.state)+' · '+escapeHTML(pr.merge_commit_sha||'No merge commit')+'</p>'+renderMarkdown(pr.body||'No PR description.',pr.html_url);area.append(box);b.remove()}catch(e){b.disabled=false;showToast(e.message)}};area.append(b)}if(!urls.length)area.insertAdjacentHTML('beforeend','<p>No same-repository PR links found in this record.</p>');$('#peek-content').append(area)}
$('#reading-tab').onclick=()=>setTab(false);$('#source-tab').onclick=()=>setTab(true);$('#close-peek').onclick=()=>$('#peek').close();$('#peek').addEventListener('close',()=>opener?.focus({preventScroll:true}));
for(const b of $$('[data-artifact]')){b.disabled=true;b.onclick=()=>openPeek(b.dataset.artifact,b)}
function filter(){const q=$('#search').value.toLowerCase();let count=0;for(const b of $$('[data-artifact]')){b.hidden=!b.textContent.toLowerCase().includes(q);if(!b.hidden)count++}$('#empty').hidden=count!==0;drawWires()}
$('#search').oninput=filter;
function clearRecords(){request++;records={};if($('#peek').open)$('#peek').close();for(const id of ['#peek-title','#peek-meta','#peek-content','#source-content'])$(id).replaceChildren();for(const b of $$('[data-artifact]')){b.disabled=true;const body=b.querySelector('.cardbody');if(body)body.innerHTML='<p>Waiting for source…</p>';const foot=b.querySelector('.cardfoot');if(foot)foot.textContent='Not loaded'}}
async function selectProject(index){clearRecords();const version=request;current=index;const p=projects[index];$('#project-name').textContent=p.name;$('#crumb').textContent=p.name;$('#project-description').textContent=p.repo+(p.root?' / '+p.root:'')+' · '+p.revision.slice(0,7);$('#privacy').textContent=p.private?'PRIVATE':'PUBLIC SOURCE';$$('[data-project]').forEach(b=>b.classList.toggle('active',+b.dataset.project===index));document.body.dataset.state='loading';$('#search').value='';filter();loadCanvas();try{const data=await api('/api/project?id='+p.id);if(version!==request)return;records=data.records;for(const b of $$('[data-artifact]')){const r=records[b.dataset.artifact];b.disabled=false;const body=b.querySelector('.cardbody'),foot=b.querySelector('.cardfoot');if(body)body.innerHTML=previewHTML(b.dataset.artifact,r);
if(foot)foot.textContent=r.error?'Missing or unreadable':'Pinned source · '+p.revision.slice(0,7);
if(b.classList.contains('supporter')){
  b.querySelector('small').textContent=r.error?'Missing or unreadable':(HorsemenPreview.preview(b.dataset.artifact,r.content).items[0]?.text||'Empty record');
}
}document.body.dataset.state='ready';loadCanvas()}catch(e){if(version!==request)return;document.body.dataset.state='error';$('#scan-status').textContent=e.message}}
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
try{const saved=JSON.parse(localStorage.getItem('horsemen-local-layouts-v1')||'{}');for(const [id,layout] of Object.entries(saved)){const clean={};for(const key of Object.keys(defaults)){const pos=layout[key];if(Array.isArray(pos)&&pos.length===2&&pos.every(n=>Number.isFinite(n)&&Math.abs(n)<1e7))clean[key]=pos}layouts[id]=clean}}catch{}
function positions(){return layouts[projects[current]?.id || "empty"]??(layouts[projects[current]?.id || "empty"]={})}
function position(key){return positions()[key]??defaults[key]}
function saveLayout(){try{localStorage.setItem('horsemen-local-layouts-v1',JSON.stringify(layouts))}catch{}}
const wires=document.createElementNS('http://www.w3.org/2000/svg','svg');wires.classList.add('wires');wires.setAttribute('aria-hidden','true');world.prepend(wires);
const relations=[['vision','progress','guides'],['brain','vision','informs'],['structure','techstack','locates'],['progress','changelog','delivery evidence']];
function drawWires(){wires.replaceChildren();if(world.classList.contains('list'))return;for(const [a,b,label] of relations){const ea=$('[data-artifact="'+a+'"]'),eb=$('[data-artifact="'+b+'"]');if(ea.hidden||eb.hidden)continue;const pa=position(a),pb=position(b);const ca={x:pa[0]+ea.offsetWidth/2,y:pa[1]+ea.offsetHeight/2},cb={x:pb[0]+eb.offsetWidth/2,y:pb[1]+eb.offsetHeight/2};const horizontal=Math.abs(cb.x-ca.x)>Math.abs(cb.y-ca.y);const x1=ca.x+(horizontal?Math.sign(cb.x-ca.x)*ea.offsetWidth/2:0),y1=ca.y+(horizontal?0:Math.sign(cb.y-ca.y)*ea.offsetHeight/2),x2=cb.x-(horizontal?Math.sign(cb.x-ca.x)*eb.offsetWidth/2:0),y2=cb.y-(horizontal?0:Math.sign(cb.y-ca.y)*eb.offsetHeight/2);const path=document.createElementNS(wires.namespaceURI,'path');path.setAttribute('d',horizontal?`M ${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}`:`M ${x1} ${y1} C ${x1} ${(y1+y2)/2}, ${x2} ${(y1+y2)/2}, ${x2} ${y2}`);wires.append(path);const text=document.createElementNS(wires.namespaceURI,'text');text.setAttribute('x',(x1+x2)/2);text.setAttribute('y',(y1+y2)/2-8);text.textContent=label;wires.append(text)}}
function renderPositions(){for(const el of $$('[data-artifact]')){const p=position(el.dataset.artifact);el.style.left=p[0]+'px';el.style.top=p[1]+'px'}drawWires()}
function renderCamera(){const list=world.classList.contains('list');world.style.transform=list?'none':`translate(${camera.x}px,${camera.y}px) scale(${camera.z})`;zoom=camera.z;$('#zoom-label').textContent=Math.round(zoom*100)+'%';$('#zoom-out').disabled=list||zoom<=.15;$('#zoom-in').disabled=list||zoom>=3.5;$('#fit').disabled=list;$('#reset-layout').disabled=list;canvas.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;canvas.style.backgroundPosition=`${camera.x}px ${camera.y}px`}
function zoomAt(next,x=canvas.clientWidth/2,y=canvas.clientHeight/2){next=Math.max(.15,Math.min(3.5,next));const wx=(x-camera.x)/camera.z,wy=(y-camera.y)/camera.z;camera={x:x-wx*next,y:y-wy*next,z:next};renderCamera()}
function fitCanvas(){if(world.classList.contains('list'))return;const nodes=$$('[data-artifact]').filter(e=>!e.hidden);if(!nodes.length)return;const minX=Math.min(...nodes.map(e=>position(e.dataset.artifact)[0])),minY=Math.min(...nodes.map(e=>position(e.dataset.artifact)[1])),maxX=Math.max(...nodes.map(e=>position(e.dataset.artifact)[0]+e.offsetWidth)),maxY=Math.max(...nodes.map(e=>position(e.dataset.artifact)[1]+e.offsetHeight));const z=Math.min(1,(canvas.clientWidth-60)/(maxX-minX),(canvas.clientHeight-60)/(maxY-minY));camera={x:(canvas.clientWidth-(maxX-minX)*z)/2-minX*z,y:(canvas.clientHeight-(maxY-minY)*z)/2-minY*z,z:Math.max(.15,z)};renderCamera()}
function loadCanvas(){gesture=null;pointers.clear();pinch=null;renderPositions();fitCanvas()}
function setView(list){world.classList.toggle('list',list);canvas.classList.toggle('list-mode',list);$('#canvas-view').setAttribute('aria-pressed',!list);$('#list-view').setAttribute('aria-pressed',list);renderCamera();drawWires()}
$('#list-view').onclick=()=>setView(true);$('#canvas-view').onclick=()=>setView(false);
$('#zoom-out').onclick=()=>zoomAt(camera.z/1.2);$('#zoom-in').onclick=()=>zoomAt(camera.z*1.2);$('#fit').onclick=fitCanvas;
$('#reset-layout').onclick=()=>{layouts[projects[current]?.id || "empty"]={};saveLayout();loadCanvas();showToast('Layout reset for '+(projects[current]?.name || 'workspace')+'.')};
function localPoint(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.x,y:e.clientY-r.y}}
canvas.addEventListener('pointerdown',e=>{if(world.classList.contains('list')||![0,1].includes(e.button))return;const node=e.target.closest('[data-artifact]');if(node)node.style.zIndex=++highestLayer;suppressClick=null;const pt=localPoint(e);pointers.set(e.pointerId,pt);if(e.isTrusted)(node||canvas).setPointerCapture(e.pointerId);if(pointers.size===2){const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),z:camera.z,wx:(mid.x-camera.x)/camera.z,wy:(mid.y-camera.y)/camera.z};gesture=null;suppressClick={at:performance.now()};return}gesture={id:e.pointerId,node:!spaceDown&&e.button===0?node:null,start:pt,origin:node?[...position(node.dataset.artifact)]:null,camera:{...camera},moved:false};canvas.classList.add('grabbing');e.preventDefault()});
window.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;const pt=localPoint(e);pointers.set(e.pointerId,pt);if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},z=Math.max(.15,Math.min(3.5,pinch.z*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance)));camera={x:mid.x-pinch.wx*z,y:mid.y-pinch.wy*z,z};renderCamera();return}if(!gesture||gesture.id!==e.pointerId)return;const dx=pt.x-gesture.start.x,dy=pt.y-gesture.start.y;if(Math.hypot(dx,dy)>5)gesture.moved=true;if(!gesture.moved)return;if(gesture.node){positions()[gesture.node.dataset.artifact]=[gesture.origin[0]+dx/camera.z,gesture.origin[1]+dy/camera.z];renderPositions()}else{camera.x=gesture.camera.x+dx;camera.y=gesture.camera.y+dy;renderCamera()}});
function finishPointer(e){if(!pointers.has(e.pointerId))return;const wasPinch=!!pinch;pointers.delete(e.pointerId);if(gesture?.moved||wasPinch)suppressClick={at:performance.now()};saveLayout();gesture=null;pinch=null;canvas.classList.remove('grabbing');if(pointers.size){const [id,pt]=[...pointers.entries()][0];gesture={id,node:null,start:pt,camera:{...camera},moved:true}}}
window.addEventListener('pointerup',finishPointer);window.addEventListener('pointercancel',finishPointer);
canvas.addEventListener('click',e=>{if(e.isTrusted&&suppressClick&&performance.now()-suppressClick.at<450){e.preventDefault();e.stopImmediatePropagation();suppressClick=null}},true);
canvas.addEventListener('wheel',e=>{if(world.classList.contains('list'))return;e.preventDefault();if(e.shiftKey){camera.x-=e.deltaX||e.deltaY;camera.y-=e.deltaX?e.deltaY:0;renderCamera()}else{const p=localPoint(e);zoomAt(camera.z*Math.exp(-e.deltaY*.002),p.x,p.y)}},{passive:false});
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.target.closest('input,button,dialog'))spaceDown=true;if(e.target.closest('dialog,input')||!canvas.contains(e.target)||world.classList.contains('list'))return;const node=e.target.closest('[data-artifact]'),d={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(d){e.preventDefault();if(node&&e.altKey){const p=position(node.dataset.artifact);positions()[node.dataset.artifact]=[p[0]+d[0],p[1]+d[1]];renderPositions();saveLayout()}else{camera.x-=d[0]*3;camera.y-=d[1]*3;renderCamera()}}if(['+','=','-','0'].includes(e.key)){e.preventDefault();if(e.key==='0')fitCanvas();else zoomAt(camera.z*(e.key==='-'?1/1.2:1.2))}});
window.addEventListener('keyup',e=>{if(e.code==='Space')spaceDown=false});window.addEventListener('blur',()=>{spaceDown=false;pointers.clear();gesture=null;pinch=null;canvas.classList.remove('grabbing')});
for(const el of $$('[data-artifact]'))el.title='Click to peek · Drag to move · Alt + arrow keys to arrange';
new ResizeObserver(()=>{drawWires()}).observe(world);
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
