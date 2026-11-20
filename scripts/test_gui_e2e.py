"""Browser integration test against a disposable fake GitHub provider."""
import argparse
import base64
import json
from pathlib import Path
import subprocess
import sys
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tests'))
from test_gui import Fake
from horsemen_core.gui import GitHubReader, ScanState, make_server
from canvas_fixture import BOARDS, CANVASES, HEAVY_SIZE, MEDIA

parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]
release_scan=threading.Event()
def png(width,height,rgb):
    """A small solid PNG, built here so the fixture needs no binary file."""
    import struct,zlib
    chunk=lambda kind,data:struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    rows=b''.join(b'\x00'+bytes(rgb)*width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows))+chunk(b'IEND',b'')
# Fictional visuals: two diagrams and a chart that draw, one diagram with a syntax error, a PNG, an SVG with a script, and a missing image.
VISUALS=('\n## Runtime connections\n```mermaid\nflowchart LR\n  Operator --> App[Pilot app]\n  App -->|read only| Records[Project records]\n  App --> Board[Pilot board]\n'
         '  click App "javascript:window.pwned=1"\n```\n## Pilot usage\n```mermaid\npie title Pilot usage\n  "Search" : 5\n  "Export" : 3\n  "Saved views" : 2\n```\n'
         '## Sign-in\n```mermaid\nsequenceDiagram\n  Operator->>App: <img src=x onerror="window.pwned=1"> Open the board\n  App-->>Operator: Records\n```\n'
         '## Draft\n```mermaid\nflowchart LR\n  A[Open --> B\n```\n## Screens\n![Pilot board](img/board.png) ![Pilot logo](img/logo.svg)\n\n![Old screen](img/missing.png)')
BOARD=png(48,24,(51,64,122))
LOGO=b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="window.pwned=1"><script>window.pwned=1</script><circle cx="20" cy="20" r="18" fill="#a8301d"/></svg>'
class ProgressiveFake(Fake):
    sources={
        'vision':'# Record\n\nOwner: A fictional team · Confirmed: 2026-11-02\n\nActual source.\n## Why we exist\nHelp small teams keep decisions close to their work.\n## Who we build for\nIndependent builders and project operators.\n## The world we are building\nA clear view of every active project.\n## How we get there\n- Now: Prove the pilot with three operators.\n- Next: Shared team spaces.\n- Later: Every project has a clear next step.\n## Open questions\n- Pricing for teams? The owner decides.\n## Direction changes\n- 2026-11-02: Narrowed the pilot to operators. Previous: all builders.',
        'progress':'# Progress\n\nUpdated: 2026-11-18 · Stage: pilot · Health: On track\n\nNext action: Invite three operators to the pilot.\n\n## Latest day\n\n<details open>\n<summary>Latest day · 2026-11-18</summary>\n\n## Shipped\n\n- **Search** (2026-11-18): Search is available to the pilot group.\n\n## In progress\n\n- **Export** (started 2026-11-12): Operators can save a board as a PDF.\n\n## Up next\n\n- **Saved views** (target December 2026): Keep a filter between visits.\n\n## Gates\n\n- Review the pilot feedback before wider access.\n\n### Technical details\n\n| Item | Evidence |\n| --- | --- |\n| Search | [PR #12](https://github.com/example/alpha/pull/12) and the [release note](https://example.com/notes/search). |\n\n</details>\n\n## Historical ships\n\n<details>\n<summary>Historical ships · newest first</summary>\n\n### 2026-11-10\n\n- **Walkthrough** (2026-11-10): The first walkthrough reached two operators.\n\n#### Technical details\n\n| Item | Evidence |\n| --- | --- |\n| Walkthrough | [PR #9](https://github.com/example/alpha/pull/9), commit [a1b2c3d](https://github.com/example/alpha/commit/a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0). |\n\n</details>\n\n## Upcoming roadmap\n\n<details>\n<summary>Upcoming roadmap</summary>\n\n- Next: Shared team spaces.\n- Later: A hosted reader.\n\n</details>',
        'brain':'# Brain\n## Providers\n- [Research notebook](docs/research.md): interviews and decisions.\n- [External reference](https://example.com/reference)\n## Access\nRead originals within existing permissions.\n## Save and cleanup\nKeep owner decisions with their source.',
        'techstack':'# Tech stack\n## Tools\n| Tool | Purpose | Needs |\n| --- | --- | --- |\n| Python 3.10+ | Local reader | Python 3.10+ |\n| GitHub CLI | Read project records | Existing sign-in |'+VISUALS,
        'changelog':'# Changelog\n## 2026-11-18\n- Search reached the fictional pilot. [PR #12](https://github.com/example/alpha/pull/12)\n## 2026-11-10\nFirst walkthrough delivered.',
        'structure':'# Structure\n## Map\n```text\napp/ — operator workspace (start here)\ndocs/ — decisions and references\ntests/ — verification\n```\n## Read before changing\nStart with the current progress snapshot.\n## Commands\npython3 scripts/serve_gui.py'
    }
    def __call__(self,path,paginate=False):
        # Canvas files and the media that they name. The 2 MiB file has a size in the tree only: a request for its content is a fault.
        if '/git/blobs/canvas-' in path:
            self.calls.append(path);name=path.rsplit('/git/blobs/canvas-',1)[1]
            return {'encoding':'base64','content':base64.b64encode(CANVASES[name].encode()).decode()}
        for name,data in MEDIA.items():
            if f'/contents/{name}?' in path:return {'type':'file','sha':'3'*40,'size':len(data),'encoding':'base64','content':base64.b64encode(data).decode()}
        for name,data in [('img/board.png',BOARD),('img/logo.svg',LOGO)]:
            if f'/contents/{name}?' in path:return {'type':'file','sha':'2'*40,'size':len(data),'encoding':'base64','content':base64.b64encode(data).decode()}
        if '/contents/img/' in path:
            from horsemen_core.gui import ProviderError
            raise ProviderError('Repository or record is no longer accessible.',404)
        if '/contents/docs/research.md?' in path:
            return {'type':'file','sha':'e'*40,'size':100,'encoding':'base64','content':base64.b64encode(b'# Research notebook\n## Findings\nOperators need a clear next step.\n[Decision](decision.md)').decode()}
        if '/contents/docs/decision.md?' in path:
            return {'type':'file','sha':'f'*40,'size':80,'encoding':'base64','content':base64.b64encode(b'# Pilot decision\nKeep the first pilot small.\n[Delivery](delivery.md)').decode()}
        if '/contents/docs/delivery.md?' in path:
            return {'type':'file','sha':'1'*40,'size':50,'encoding':'base64','content':base64.b64encode(b'# Delivery\nA fictional pilot receipt.').decode()}
        if '/git/blobs/'  in path:
            key=path.rsplit('/',1)[-1]
            if key in self.sources:return {'encoding':'base64','content':base64.b64encode(self.sources[key].encode()).decode()}
        result=super().__call__(path,paginate)
        if '/git/trees/' in path:
            result['tree'] += [{'path':name,'type':'blob','mode':'100644','sha':name.split('.')[0].lower(),'size':200} for name in ['TECHSTACK.md','CHANGELOG.md']]
            for file in result['tree']:file['sha']=file['path'].split('.')[0].lower()
            result['tree'] += [{'path':f'.horsemen/canvas/{name}.canvas','type':'blob','mode':'100644','sha':'canvas-'+name,'size':len(text.encode())} for name,text in CANVASES.items()]
            result['tree'] += [{'path':'.horsemen/canvas/heavy.canvas','type':'blob','mode':'100644','sha':'canvas-heavy','size':HEAVY_SIZE},
                               {'path':'.horsemen/canvas/Bad Name.canvas','type':'blob','mode':'100644','sha':'canvas-bad','size':20},
                               {'path':'notes/.horsemen/canvas/stray.canvas','type':'blob','mode':'100644','sha':'canvas-stray','size':20}]
        if path.startswith('/user/repos'):
            second=dict(result[0],id=2,full_name='example/aardvark');return result+[second]
        if '/repos/example/aardvark/commits/' in path:release_scan.wait(45)
        return result
fake=ProgressiveFake()
server=make_server(0,ScanState(GitHubReader(fake)),root/'web')
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
log=[]
def browser(*args):
    p=subprocess.run(['agent-browser','--session','horsemen-live-test',*args],capture_output=True,text=True,timeout=60)
    log.append(p.stdout+p.stderr)
    if p.returncode:raise AssertionError(p.stderr)
    return p.stdout
def value(code):
    result=json.loads(browser('eval',code))
    return json.loads(result) if isinstance(result,str) else result

def location_ends(browser,tail):
    return json.loads(browser('eval','location.hash')).endswith(tail)

def drag_points(start,end):
    browser('mouse','move',str(round(start[0])),str(round(start[1])))
    browser('mouse','down','left')
    browser('mouse','move',str(round(end[0])),str(round(end[1])))
    browser('mouse','up','left')

try:
    browser('set','viewport' ,'1440','1100')
    browser('open',f'http://127.0.0.1:{server.server_port}')
    browser('wait','--fn','document.body.dataset.state === "ready"')
    assert server.state.snapshot()['phase']=='scanning', 'First project must open before discovery completes'
    assert value('JSON.stringify([!!window.mermaid,!!document.querySelector("script[src*=mermaid]")])')==[False,False], 'Mermaid does not load before a page needs it'
    browser('eval','window.__csp=[];document.addEventListener("securitypolicyviolation",e=>window.__csp.push(e.violatedDirective+" "+e.blockedURI))')
    assert 'alpha' in browser('get','text','#project-name')
    release_scan.set()
    browser('wait','--fn','projects.length === 2')
    assert 'alpha' in browser('get','text','#project-name'), 'New results must preserve selection'

    assert value('JSON.stringify([document.querySelector("#privacy").hidden,document.querySelector("#privacy").textContent])')==[False,'Private repository'], 'A private repository shows a lock next to its name'
    assert value('JSON.stringify(!document.querySelector(".legend,.canvas-hint,.canvas-controls,#search,#clear-button,.notice"))') is True, 'No legend, hint lines, tool dock, or second search field'
    assert value('JSON.stringify(document.querySelectorAll(".topbar button,.topbar a").length)')<=3, 'The header has at most three actions'
    assert value('JSON.stringify(document.querySelector(".project-search").hidden)') is True, 'Project search appears only for long lists'
    assert value('JSON.stringify(!document.body.innerText.match(/Conquest|Famine|Campaign|pinned/))') is True, 'Cards carry no rider lore or Git jargon'
    browser('click','[data-artifact="vision"]')
    original_position=value('JSON.stringify(position("brain"))')
    browser('click','[data-card-toggle="brain"]')
    assert browser('get','attr','[data-card-toggle="brain"]','aria-expanded').strip()=='true'
    assert value('JSON.stringify([...selected])')==['vision'], 'Inline expand does not change selection'
    assert value('JSON.stringify(position("brain"))')==original_position, 'Inline expand does not drag the card'
    assert browser('eval','document.querySelector("#peek").open').strip()=='false'
    browser('focus','[data-card-toggle="brain"]');browser('press','Enter')
    assert browser('get','attr','[data-card-toggle="brain"]','aria-expanded').strip()=='false'
    assert browser('eval','document.querySelector("#peek").open').strip()=='false', 'Enter on the branch button does not open the selected card'
    assert browser('eval','document.querySelector("[data-card-toggle]").closest("[data-artifact]") === null').strip()=='true', 'Controls are not nested inside card buttons'

    browser('click','[data-artifact="vision"]')
    assert browser('eval','document.querySelector("#peek").open').strip()=='false', 'Single click selects without opening'
    assert browser('eval','selected.has("vision")').strip()=='true'
    browser('press','Enter');browser('wait','#peek[open]');browser('press','Escape')

    boxes=value('JSON.stringify(["vision","progress"].map(id=>{const r=document.querySelector(`[data-artifact=${id}]`).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}))')
    drag_points((min(b['x'] for b in boxes)-10,min(b['y'] for b in boxes)-10),(max(b['x']+b['w'] for b in boxes)+10,max(b['y']+b['h'] for b in boxes)+10))
    assert value('JSON.stringify([...selected].sort())')==['progress','vision'], 'Marquee selects both cards'
    before=value('JSON.stringify([position("vision"),position("progress")])')
    box=boxes[0];drag_points((box['x']+box['w']/2,box['y']+50),(box['x']+box['w']/2+30,box['y']+70))
    after=value('JSON.stringify([position("vision"),position("progress")])')
    assert after[0][0]>before[0][0] and abs((after[0][0]-before[0][0])-(after[1][0]-before[1][0]))<.1, 'Group drag moves both equally'
    assert browser('eval','document.querySelector("#peek").open').strip()=='false'
    camera_before=value('JSON.stringify(camera)')
    browser('eval','document.querySelector(".canvas").dispatchEvent(new WheelEvent("wheel",{deltaY:40,bubbles:true,cancelable:true}))')
    camera_after=value('JSON.stringify(camera)')
    assert camera_after['z']==camera_before['z'] and camera_after['y']==camera_before['y']-40, 'Wheel pans without zoom'
    browser('eval','document.querySelector(".canvas").dispatchEvent(new WheelEvent("wheel",{deltaY:-40,ctrlKey:true,clientX:700,clientY:500,bubbles:true,cancelable:true}))')
    assert value('camera.z')>camera_before['z'], 'Ctrl-wheel zooms'
    browser('press','h')
    assert value('JSON.stringify(document.querySelector(".canvas").dataset.tool)')=='hand', 'H chooses the Hand tool'
    camera_before=value('JSON.stringify(camera)');before=value('JSON.stringify(position("vision"))')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-artifact=vision]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    drag_points((box['x']+40,box['y']+40),(box['x']+70,box['y']+60))
    assert value('JSON.stringify(position("vision"))')==before and value('camera.x')>camera_before['x'], 'Hand pans over a card without moving it'
    browser('press','v');browser('click','#fit')
    assert value('JSON.stringify(document.querySelector(".canvas").dataset.tool)')=='select', 'V chooses the Select tool'
    browser('focus','[data-artifact="vision"]')
    browser('eval','document.querySelector("[data-artifact=vision]").dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",bubbles:true,cancelable:true}))')
    before=value('JSON.stringify(position("vision"))');camera_before=value('JSON.stringify(camera)')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-artifact=vision]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    drag_points((box['x']+40,box['y']+40),(box['x']+60,box['y']+60))
    browser('eval','document.querySelector("[data-artifact=vision]").dispatchEvent(new KeyboardEvent("keyup",{key:" ",code:"Space",bubbles:true}))')
    assert value('JSON.stringify(position("vision"))')==before and value('camera.x')>camera_before['x'], 'Space pans even when an artifact has focus'
    browser('click','#fit')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-artifact=vision]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    browser('mouse','move',str(round(box['x']+40)),str(round(box['y']+40)));browser('mouse','down','left')
    browser('mouse','move',str(round(box['x']+80)),str(round(box['y']+70)))
    assert value('JSON.stringify(position("vision"))')!=before
    browser('press','Escape');browser('mouse','up','left')
    assert value('JSON.stringify(position("vision"))')==before, 'Escape cancels an unfinished drag'


    assert value('JSON.stringify([document.querySelector("#workspace-name").textContent,document.querySelector("#workspace-repo").textContent,document.querySelector("#workspace-pop").hidden])')==['alpha','example/alpha',True], 'The switcher names the open project; its list is closed'
    browser('click','#workspace-toggle')
    assert value('JSON.stringify([document.querySelector("#workspace-toggle").getAttribute("aria-expanded"),document.activeElement.dataset.project===String(current)])')==['true',True], 'The switcher opens on the current project'
    browser('eval','document.querySelector(".project-search").hidden=false')
    browser('fill','#project-search','no-match')
    assert 'No matching projects' in browser('get','text','#no-projects')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='0'
    browser('fill','#project-search','EXAMPLE alpha')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='1'
    assert 'Help small teams' in browser('get','text','[data-artifact="vision"]')
    assert 'Invite three operators' in browser('get','text','[data-artifact="progress"]')
    browser('fill','#project-search','')
    browser('eval','document.querySelector("#project-search").blur()')
    assert value('JSON.stringify(document.querySelector(".project-search").hidden)') is True, 'Search hides again when the query is empty'
    browser('focus','#workspace-toggle');browser('press','Escape')
    assert value('JSON.stringify([document.querySelector("#workspace-pop").hidden,document.activeElement.id])')==[True,'workspace-toggle'], 'Escape closes the project list and keeps focus on the switcher'
    browser('dblclick','[data-artifact="vision"]');browser('wait','#peek[open]')
    assert 'Help small teams' in browser('get','text','#peek-content')
    assert value('JSON.stringify(document.querySelector("#peek-title").textContent)')=='Vision', 'The record view names the record'
    assert value('JSON.stringify(!document.querySelector("#peek .detail-eyebrow,#peek .overview-seal,#peek .peek-tabs,#peek .peek-note,#peek .view-help"))') is True, 'No kicker, seal, tabs, hint line, or helper text'
    browser('click','.more-bar [data-peek-mode="document"]');assert 'Actual source.' in browser('get','text','#peek-content'), 'The full document is one click away'
    browser('click','#peek-more');browser('click','#show-source');assert '# Record' in browser('get','text','#source-content')
    browser('click','#peek-more');browser('click','#peek-menu [data-view-choice="rich"]')
    assert value('JSON.stringify(Boolean(document.querySelector("#peek-content [data-layout=brief]")))') is True, 'The menu returns to the record layout'
    browser('press','Escape')
    browser('dblclick','[data-artifact="brain"]')
    assert browser('eval','Boolean(document.querySelector("[data-layout=library]"))').strip()=='true'
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'brain-peek.png'))
    browser('click','.connection-grid li:first-child .connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    assert 'Operators need a clear next step.' in browser('get','text','#peek-content')
    browser('eval','document.querySelector(".connection-card").scrollIntoView({block:"center"})')
    browser('click','.connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "decision.md"')
    browser('click','#peek-back');assert 'research.md' in browser('get','text','#peek-title')
    browser('click','#peek-back');assert 'Brain' in browser('get','text','#peek-title')
    browser('click','.connection-grid li:last-child .connection-card')
    assert 'does not load its contents' in browser('get','text','#peek-content')
    browser('click','#peek-back')
    browser('click','.connections-heading button')
    assert browser('eval','document.querySelectorAll(".connected-node").length').strip()=='2'
    browser('click','[data-artifact="brain"]');browser('click','[data-card-toggle="brain"]')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='0'
    browser('click','[data-card-toggle="brain"]')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='2'
    browser('press','Shift+C')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='0', 'Shift + C collapses all linked branches'
    browser('click','[data-card-toggle="brain"]');browser('click','#fit')
    overlap_check='JSON.stringify((()=>{const cards=[...document.querySelectorAll("[data-artifact]")].filter(e=>!e.hidden).map(e=>({id:e.dataset.artifact,x:position(e.dataset.artifact)[0],y:position(e.dataset.artifact)[1],w:e.offsetWidth,h:e.offsetHeight}));const hits=[];for(const a of cards)for(const b of cards)if(a.id<b.id&&HorsemenCanvas.overlaps(a,b,0))hits.push(a.id+"/"+b.id);return hits})())'
    assert value(overlap_check)==[], 'Expanded links do not overlap any card'
    research=value('JSON.stringify(document.querySelector(".connected-node[data-document-path=\\"docs/research.md\\"]").dataset.artifact)')
    browser('click',f'[data-card-toggle="{research}"]')
    browser('wait','--fn','document.querySelectorAll(".connected-node:not([hidden])").length === 3')
    assert value(overlap_check)==[], 'Nested links do not overlap any card'
    browser('click','[data-card-toggle="structure"]') if value('Boolean(document.querySelector("[data-card-toggle=structure]"))') else None
    assert value(overlap_check)==[], 'A second branch does not overlap the first'
    browser('click','#fit');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'expanded.png'))

    browser('dblclick','.connected-node[data-document-path="docs/research.md"]')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    browser('press','Escape')
    browser('dblclick','[data-artifact="readme"]');assert 'missing' in browser('get','text','#peek-content')
    browser('press','Escape')
    for key,layout in [('vision','brief'),('progress','progress-list'),('structure','map'),('changelog','timeline'),('techstack','tools')]:
        browser('dblclick',f'[data-artifact="{key}"]')
        assert browser('eval',f'Boolean(document.querySelector("[data-layout={layout}]"))').strip()=='true'
        browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
        browser('screenshot',str(args.output/(key+'-peek.png')))
        if key=='techstack':assert browser('eval','document.querySelectorAll(".tool-row").length').strip()=='2', 'Tech stack is a compact table'
        browser('press','Escape')
    # Diagrams and images: Mermaid loads only for a page with a diagram, draws under the CSP, and falls back to code.
    browser('eval','applyTheme({style:"engraved",theme:"bone"})')
    browser('dblclick','[data-artifact="techstack"]');browser('wait','#peek[open]')
    browser('wait','--fn','document.querySelectorAll("figure.diagram[data-state=drawn]").length === 3 && document.querySelectorAll("figure.diagram[data-state=error]").length === 1')
    assert value('JSON.stringify([...document.querySelectorAll(".md-image")].map(s=>s.dataset.state))')==['waiting']*3, 'Images below the fold wait until they come near the view'
    browser('eval','document.querySelector(".md-image").scrollIntoView({block:"center"})')
    browser('wait','--fn','document.querySelectorAll(".md-image[data-state=shown]").length === 2 && document.querySelectorAll(".md-image[data-state=error]").length === 1')
    labels=value('JSON.stringify([...document.querySelectorAll("figure.diagram .diagram-canvas")].map(c=>[c.getAttribute("role"),c.getAttribute("aria-label"),c.tabIndex,!!c.querySelector("svg")]))')
    assert labels[:3]==[['img','Flowchart',0,True],['img','Pie chart: Pilot usage',0,True],['img','Sequence diagram',0,True]], labels
    assert value('JSON.stringify(document.querySelector("figure.diagram[data-state=drawn] .diagram-source").hidden)') is True, 'A drawn diagram hides its code'
    browser('focus','figure.diagram[data-state=drawn] .diagram-toggle');browser('press','Enter')
    assert value('JSON.stringify((f=>[f.querySelector(".diagram-source").hidden,f.querySelector(".diagram-canvas").hidden,f.querySelector(".diagram-toggle").textContent,f.querySelector(".diagram-toggle").getAttribute("aria-expanded")])(document.querySelector("figure.diagram")))')==[False,True,'View diagram','true'], 'View code shows the code'
    browser('press','Enter')
    assert value('JSON.stringify((f=>[f.querySelector(".diagram-source").hidden,f.querySelector(".diagram-canvas").hidden,f.querySelector(".diagram-toggle").textContent])(document.querySelector("figure.diagram")))')==[True,False,'View code'], 'The toggle returns to the diagram'
    broken=value('JSON.stringify((f=>[f.querySelector(".diagram-error").textContent,f.querySelector(".diagram-source").hidden,f.querySelector(".diagram-toggle").hidden,f.querySelector(".diagram-source").textContent.includes("A[Open")])(document.querySelector("figure.diagram[data-state=error]")))')
    assert broken[0].startswith('This diagram could not be drawn.') and len(broken[0])<220 and broken[1:]==[False,True,True], broken
    assert value('JSON.stringify(document.querySelectorAll("body > svg, body > div[id^=dhorsemen]").length)')==0, 'Mermaid leaves no error element on the page'
    images=value('JSON.stringify([...document.querySelectorAll(".md-image[data-state=shown] img")].map(i=>[i.alt,i.src.startsWith("blob:"),i.naturalWidth>0]))')
    assert images==[['Pilot board',True,True],['Pilot logo',True,True]], images
    missing=value('JSON.stringify((s=>[s.querySelector("a").textContent,s.querySelector("a").href.endsWith("/img/missing.png"),s.querySelector(".md-image-note").textContent,!!s.querySelector("img")])(document.querySelector(".md-image[data-state=error]")))')
    assert missing[0]=='Image: Old screen' and missing[1] and missing[2].startswith('Image not shown:') and missing[3] is False, missing
    assert value('JSON.stringify([window.pwned,window.__csp])')==[None,[]], 'No script ran from diagram or SVG source, and nothing broke the CSP'
    scroll=value('JSON.stringify((f=>{const c=f.querySelector(".diagram-canvas");return c.scrollWidth<=c.clientWidth||getComputedStyle(c).overflowX==="auto"})(document.querySelector("figure.diagram")))')
    assert scroll is True, 'A wide diagram scrolls inside the column'
    browser('eval','document.querySelector("figure.diagram").scrollIntoView({block:"start"})')
    browser('screenshot',str(args.output/'after-diagrams-bone.png'))
    browser('eval','document.querySelector(".md-image").scrollIntoView({block:"center"})')
    browser('screenshot',str(args.output/'after-images-bone.png'))
    # A theme change draws the diagrams again in the new colours.
    fill='JSON.stringify(getComputedStyle(document.querySelector("figure.diagram .diagram-canvas svg .node rect, figure.diagram .diagram-canvas svg .node path")).fill)'
    before_fill=value(fill);first_svg=value('JSON.stringify(document.querySelector("figure.diagram svg").id)')
    browser('eval','applyTheme({style:"engraved",theme:"ember"})')
    browser('wait','--fn',f'document.querySelector("figure.diagram svg")?.id !== {json.dumps(first_svg)} && document.querySelectorAll("figure.diagram[data-state=drawn]").length === 3')
    assert value(fill)!=before_fill, 'Diagram colours follow the theme'
    browser('eval','document.querySelector("figure.diagram").scrollIntoView({block:"start"})')
    browser('screenshot',str(args.output/'after-diagrams-ember.png'))
    first_svg=value('JSON.stringify(document.querySelector("figure.diagram svg").id)')
    browser('eval','applyTheme({style:"modern",mode:"dark"})')
    browser('wait','--fn',f'[...document.querySelectorAll("figure.diagram svg")].every(s=>s.id !== {json.dumps(first_svg)}) && document.querySelectorAll("figure.diagram[data-state=drawn]").length === 3')
    browser('eval','document.querySelector("figure.diagram").scrollIntoView({block:"start"})')
    browser('screenshot',str(args.output/'after-diagrams-modern-dark.png'))
    browser('eval','localStorage.removeItem("horsemen-style");localStorage.removeItem("horsemen-theme");localStorage.removeItem("horsemen-mode");applyTheme()')
    browser('press','Escape')
    # Artifact views: status board, proof links, exact dates, source lines, and a saved list choice.
    browser('dblclick','[data-artifact="progress"]');browser('wait','#peek[open]')
    order=value('JSON.stringify([...document.querySelectorAll("#peek-content .lead, #peek-content .part-title")].map(e=>e.textContent.replace(/L[0-9]+$/,"").trim().slice(0,12)))')
    assert order[:4]==['Next actionI','Now','Up next','Shipped'], 'Progress reads: next action, now, up next, shipped ('+str(order)+')'
    assert 'Export' in value('JSON.stringify(document.querySelector("#peek-content [data-outline=Now]").textContent)'), 'Now holds work in progress'
    assert value('JSON.stringify([...document.querySelectorAll("#peek-content .part.shipped .day")].map(d=>d.dataset.day))')==['2026-11-18','2026-11-10'], 'Shipped work is grouped by day, newest first'
    assert value('JSON.stringify(document.querySelector("#peek-content .part.shipped .chip.pr").getAttribute("href"))')=='https://github.com/example/alpha/pull/12', 'Proof links are small chips'
    browser('click','#peek-more');browser('click','#peek-menu [data-view-choice="rich"]')
    assert value('document.querySelectorAll("#peek-content .day.latest .lane").length')==4, 'The optional board shows four status lanes'
    assert value('document.querySelectorAll("#peek-content details.day").length')==1, 'Earlier days fold'
    assert value('JSON.stringify(document.querySelector("#peek-content .lane[data-status=shipped] .chip.pr").getAttribute("href"))')=='https://github.com/example/alpha/pull/12', 'Shipped items link to their PR'
    assert value('JSON.stringify(document.querySelector("#peek-content .lane[data-status=progress] time").getAttribute("title"))')=='2026-11-12', 'Relative dates keep the exact date'
    assert value('JSON.stringify([...document.querySelectorAll("#peek-content a.src")].every(a=>/[?]plain=1#L[0-9]+$/.test(a.href)))') is True, 'Source links point to exact lines'
    browser('press','Escape');browser('dblclick','[data-artifact="progress"]');browser('wait','#peek[open]')
    assert value('Boolean(document.querySelector("#peek-content .board4"))') is True, 'The board choice is saved'
    browser('click','[data-record="vision"]');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Vision"')
    assert value('Boolean(document.querySelector("#peek-content .items.path"))') is True, 'Each record type keeps its own choice'
    assert 'Pricing for teams' in value('JSON.stringify(document.querySelector("#peek-content [data-outline=\'Open questions\']").textContent)'), 'Vision shows open questions'
    browser('click','[data-record="progress"]');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Progress"')
    browser('click','#peek-more');browser('click','#peek-menu [data-view-choice="list"]')
    assert value('localStorage.getItem("horsemen-peek-views")')=={'vision':'rich','progress':'list'}, 'The browser saves one layout choice for each record type'
    browser('click','#peek-more');browser('click','#show-document');assert 'Search is available to the pilot group.' in browser('get','text','#peek-content')
    browser('click','#peek-more');browser('click','#show-source');assert '<summary>Latest day' in browser('get','text','#source-content'), 'Markdown source stays exact'
    browser('click','#peek-more');browser('click','#peek-menu [data-view-choice="list"]')
    browser('click','[data-record="structure"]');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Structure"')
    assert value('JSON.stringify(document.querySelector("[data-copy]").dataset.copy)')=='python3 scripts/serve_gui.py'
    assert value('JSON.stringify(document.querySelector(".tree-path a").getAttribute("href"))')=='https://github.com/example/alpha/tree/'+'a'*40+'/app/', 'Tree paths open on GitHub'
    assert value('JSON.stringify(document.querySelector(".tree .tag.start").textContent)')=='start here'
    browser('click','[data-copy]')
    browser('wait','--fn','document.querySelector("[data-copy]").textContent === "Copied" || !document.querySelector("#toast").hidden')
    browser('press','Escape')
    browser('dblclick','[data-artifact="vision"]');browser('wait','#peek[open]')
    assert value('JSON.stringify(document.querySelector("#peek-records [aria-current=page]").dataset.record)')=='vision', 'The record list marks the open record'
    assert value('JSON.stringify(document.querySelector("#peek-records").textContent)')=='VisionProgressBrainStructureREADMEChangelogTech stack', 'The record list is compact: names only'
    browser('set','viewport','1440','520');browser('wait','--fn','!document.querySelector("#peek-outline-nav").hidden')
    assert value('document.querySelectorAll("#peek-outline button").length')>=4, 'A long record lists its sections'
    assert value('JSON.stringify(document.querySelector("#peek-outline [aria-current]")===document.querySelector("#peek-outline button"))') is True, 'The outline starts on the first section'
    browser('set','viewport','1440','1100');browser('wait','--fn','document.querySelector("#peek-outline-nav").hidden')
    assert value('JSON.stringify(location.hash)').endswith('&r=vision'), 'The address keeps the open record'
    browser('press','ArrowRight');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Progress"')
    browser('click','#peek-prev');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Vision"')
    browser('click','[data-record="structure"]');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Structure"')
    assert value('JSON.stringify([...document.querySelectorAll(".tree-line")].map(e=>e.querySelector(".tree-note").textContent))')==['operator workspace','decisions and references','verification'], 'The map shows paths with their notes'
    browser('click','[data-record="brain"]');browser('click','.connection-grid li:first-child .connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    browser('click','#peek-meta button');assert 'Brain' in browser('get','text','#peek-title'), 'A path step goes back to that document'
    browser('press','Escape')
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','changelog');browser('press','Enter')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "Changelog"')
    assert browser('eval','document.querySelector("#palette").open').strip()=='false'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','#peek[open]')
    assert 'Changelog' in browser('get','text','#peek-title') and 'alpha' in browser('get','text','#project-name'), 'A reload returns to the same project and record'
    browser('press','Escape')
    assert value('JSON.stringify(getComputedStyle(document.querySelector("#scan-status")).display)')=='none', 'The status line hides when discovery is done and nothing needs attention'

    # Canvases: the rail lists Home and each record that is found. A record opens as a canvas of its sections.
    shown='JSON.stringify([canvasKey,[...selected],document.querySelector("#peek").open])'
    place='JSON.stringify(location.hash.replace(/^#p=[a-f0-9]{24}/,""))'
    # The heading of a section is at the top of the reading view, or the page is at its end.
    at_section=lambda name:value('JSON.stringify((()=>{const area=document.querySelector(".peek-content"),top=area.getBoundingClientRect().top,want=HorsemenSections.slug("'+name+'");const el=[...document.querySelectorAll("#peek-content [data-outline],#peek-content .prose h2")].find(e=>HorsemenSections.slug(e.dataset.outline||e.textContent)===want);if(!el)return "missing";const y=el.getBoundingClientRect().top-top;return (y>=-2&&y<=140)||area.scrollTop+area.clientHeight>=area.scrollHeight-2})())')
    assert value('JSON.stringify([...document.querySelectorAll("#canvases [data-canvas]")].map(b=>b.dataset.canvas))')==['home','vision','progress','brain','structure','changelog','techstack',*BOARDS], 'The rail lists Home, the records that are found, and the boards; the missing README has no canvas'
    assert value('JSON.stringify([...document.querySelectorAll("#canvases [aria-current=page]")].map(b=>b.dataset.canvas))')==['home']
    browser('click','[data-canvas="progress"]')
    assert value('JSON.stringify([...document.querySelectorAll(".section-card")].map(e=>e.dataset.node))')==['s-latest-day','s-shipped','s-in-progress','s-up-next','s-gates','s-historical-ships','s-upcoming-roadmap'], 'One card for each second-level heading, in order'
    assert value('JSON.stringify([document.querySelector("#project-name").textContent,document.querySelector("#project-description").textContent.startsWith("7 sections · example/alpha"),document.querySelector("#workspace-name").textContent])')==['Progress',True,'alpha'], 'The header names the canvas; the switcher names the project'
    assert value('JSON.stringify([[...document.querySelectorAll("#canvases [aria-current=page]")].map(b=>b.dataset.canvas),recordCards.every(e=>e.hidden),document.querySelectorAll(".wires path,.connected-node:not([hidden]),.card-links-toggle:not([hidden])").length])')==[['progress'],True,0], 'A record canvas shows its own cards only'
    assert value('JSON.stringify([...document.querySelectorAll(".section-card")].map(e=>[e.dataset.node,position(e.dataset.node),e.offsetWidth,e.offsetHeight]))')==value('JSON.stringify(HorsemenSections.canvas("progress",records.progress.content).nodes.map(n=>[n.id,[n.x,n.y],n.width,n.height]))'), 'Cards sit where the layout rule puts them'
    assert value(overlap_check)==[], 'Section cards do not overlap'
    assert value('JSON.stringify([...document.querySelectorAll(".section-card")].every(e=>{const r=e.getBoundingClientRect(),c=document.querySelector(".canvas").getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom}))') is True, 'A new canvas fits the screen'
    assert value('JSON.stringify([document.querySelector("[data-node=s-latest-day] .card-lead").textContent,document.querySelector("[data-node=s-upcoming-roadmap] .card-meta").textContent,!document.querySelector(".section-card").innerHTML.match(/<details|<summary/)])')==['Latest day · 2026-11-18','2 items',True], 'Cards show source excerpts'
    assert value(place)=='&c=progress', 'The address names the canvas'
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'canvas-progress.png'))
    browser('click','[data-node="s-gates"]')
    assert value(shown)==['progress',['s-gates'],False] and value(place)=='&c=progress&n=s-gates', 'One click selects a card and the address names it'
    spot=value('JSON.stringify(position("s-gates"))');camera_before=value('JSON.stringify(camera)')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-node=s-gates]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    drag_points((box['x']+40,box['y']+40),(box['x']+80,box['y']+70))
    assert value('JSON.stringify(position("s-gates"))')==spot and value('camera.x')>camera_before['x'], 'A drag on a section card moves the canvas; the card keeps its place'
    assert value('JSON.stringify(localStorage.getItem("horsemen-local-layouts-v1")||"")').find('s-gates')<0, 'Nothing about a section card is saved'
    browser('focus','[data-node="s-gates"]');browser('press','ArrowRight')
    assert value('JSON.stringify(position("s-gates"))')==spot, 'Arrow keys do not move a section card'
    browser('click','#fit')
    browser('dblclick','[data-node="s-gates"]');browser('wait','#peek[open]')
    assert value('JSON.stringify([document.querySelector("#peek-title").textContent,document.querySelector("#peek-content").dataset.mode])')==['Progress','document'], 'A section the layout does not name opens in the full document'
    assert at_section('Gates') is True, 'The reading view opens at the section'
    assert value(place)=='&c=progress&n=s-gates&r=progress', 'The address keeps the canvas, the card, and the open record'
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'canvas-reading-view.png'))
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "s-gates" && !location.hash.includes("&r=")')
    assert value('JSON.stringify(location.hash.endsWith("&c=progress&n=s-gates"))') is True, 'Closing returns focus to the card and the address to the canvas'
    browser('dblclick','[data-node="s-shipped"]');browser('wait','#peek[open]')
    assert value('JSON.stringify(document.querySelector("#peek-content").dataset.mode)')=='overview' and at_section('Shipped') is True, 'A section the layout names opens in that layout'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "s-shipped" && !location.hash.includes("&r=")')
    # Keyboard: a canvas from the rail, then a card. Enter selects; Enter again opens; Escape returns.
    browser('focus','[data-canvas="vision"]');browser('press','Enter')
    assert value('JSON.stringify([canvasKey,document.querySelector("#project-name").textContent,document.activeElement.dataset.canvas])')==['vision','Vision','vision'], 'Enter on a rail item opens its canvas and keeps focus'
    browser('focus','[data-canvas="brain"]');browser('press','Space')
    assert value('JSON.stringify(canvasKey)')=='brain', 'Space presses a rail item'
    browser('focus','[data-canvas="vision"]');browser('press','Enter')
    browser('focus','[data-node="s-who-we-build-for"]');browser('press','Enter')
    assert value(shown)==['vision',['s-who-we-build-for'],False], 'Enter selects the focused card'
    browser('press','Enter');browser('wait','#peek[open]')
    assert at_section('Who we build for') is True
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "s-who-we-build-for" && !location.hash.includes("&r=")')
    browser('press','Escape')
    assert value(shown)==['vision',[],False] and value(place)=='&c=vision', 'Escape clears the selection and the address'
    # List view of a canvas: the same cards in reading order; one click opens.
    browser('click','#list-view')
    order=value('JSON.stringify([...document.querySelectorAll(".section-card")].map(e=>[e.dataset.node,Math.round(e.getBoundingClientRect().top)]))')
    assert [o[0] for o in order]==value('JSON.stringify(HorsemenSections.parse(records.vision.content).map(s=>s.id))') and [o[1] for o in order]==sorted(o[1] for o in order), 'The list shows the sections in reading order'
    browser('click','[data-node="s-why-we-exist"]');browser('wait','#peek[open]')
    assert value(place)=='&c=vision&n=s-why-we-exist&r=vision' and at_section('Why we exist') is True, 'One click in the list opens the section'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "s-why-we-exist" && !location.hash.includes("&r=")');browser('click','#canvas-view')
    assert value('JSON.stringify([...document.querySelectorAll(".section-card")].every(e=>{const r=e.getBoundingClientRect(),c=document.querySelector(".canvas").getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom}))') is True, 'A canvas first seen as a list fits the screen when it opens'
    # Links: a reload returns to the same canvas, card, and record. A link from before canvases still opens its record on Home.
    browser('click','[data-canvas="progress"]');browser('click','[data-node="s-shipped"]')
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert value(shown)==['progress',['s-shipped'],False] and value('JSON.stringify(document.querySelector("#project-name").textContent)')=='Progress', 'A reload returns to the canvas and the card'
    assert value('JSON.stringify(document.activeElement.dataset.node)')=='s-shipped', 'The card a link names has focus'
    browser('press','Enter');browser('wait','#peek[open]')
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','#peek[open]')
    assert value(shown)==['progress',['s-shipped'],True] and at_section('Shipped') is True, 'A reload returns to the open section'
    browser('click','[data-record="brain"]');browser('wait','--fn','document.querySelector("#peek-title").textContent === "Brain"')
    assert value(place)=='&c=progress&n=s-shipped&r=brain', 'Another record can open over a canvas'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "s-shipped" && !location.hash.includes("&r=")')
    pid=value('JSON.stringify(projects[current].id)')
    def go(tail):
        browser('eval',f'location.hash="#p={pid}{tail}";location.reload()');browser('wait','--fn','document.body.dataset.state === "ready"')
    go('&r=vision');browser('wait','#peek[open]')
    assert value(shown)==['home',[],True] and value('JSON.stringify([document.querySelector("#peek-title").textContent,document.querySelector("#project-name").textContent])')==['Vision','alpha'], 'A link from before canvases opens its record over Home'
    browser('press','Escape')
    go('&c=progress&n=s-renamed')
    assert value(shown)==['progress',[],False] and 'not in Progress now' in browser('get','text','#toast'), 'A link to a section that is gone says so'
    go('&c=readme')
    assert value(shown)==['home',[],False] and 'README is not in this project' in browser('get','text','#toast'), 'A link to the canvas of a missing record opens Home and says so'
    # Jump reaches each canvas. A project returns to its last canvas.
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','brain canvas');browser('press','Enter')
    assert value('JSON.stringify([canvasKey,document.querySelector("#palette").open])')==['brain',False], 'Jump opens a canvas'
    browser('click','#workspace-toggle');browser('press','ArrowUp');browser('press','Enter');browser('wait','--fn','document.body.dataset.state === "ready" && projects[current].repo === "example/aardvark"')
    assert value('JSON.stringify([canvasKey,document.querySelector("#workspace-name").textContent,document.querySelector("#workspace-pop").hidden,document.activeElement.id])')==['home','aardvark',True,'workspace-toggle'], 'Arrow keys and Enter change project; a new project opens on Home'
    browser('click','#workspace-toggle');browser('click','[data-project]:not(.active)');browser('wait','--fn','document.body.dataset.state === "ready" && projects[current].repo === "example/alpha"')
    assert value('JSON.stringify(canvasKey)')=='brain', 'A project opens on its last canvas'
    browser('click','[data-canvas="home"]')
    assert value('JSON.stringify([canvasKey,recordCards.every(e=>!e.hidden),document.querySelectorAll(".section-card").length,document.querySelector("#project-name").textContent,location.hash==="#p="+projects[current].id])')==['home',True,0,'alpha',True], 'Home returns with its record cards'

    # Canvas files (.horsemen/canvas): boards in the rail, the elements of a file over the generated canvas, and a message for a file that is not valid.
    assert value('JSON.stringify([...document.querySelectorAll("#canvases > *")].map(e=>e.dataset.canvas||e.textContent))')==['home','vision','progress','brain','structure','changelog','techstack','Boards',*BOARDS], 'Boards follow the records in name order; home.canvas, a bad file name, and a file outside the project root are not boards'
    assert value('JSON.stringify([...document.querySelectorAll("#canvases .canvas-fault")].map(e=>e.closest("[data-canvas]").dataset.canvas))')==['brain','crowd','heavy'], 'A canvas file that is not valid has a mark in the rail'
    assert not any('canvas-heavy' in call for call in fake.calls), 'The 2 MiB file is refused by its listed size; its content is never requested'
    watch_csp=lambda:browser('eval','window.__csp=[];document.addEventListener("securitypolicyviolation",e=>window.__csp.push(e.violatedDirective+" "+e.blockedURI))')
    watch_csp();browser('click','[data-canvas="structure"]')
    nodes=value('JSON.stringify(Object.fromEntries([...document.querySelectorAll(".canvas-node")].map(e=>[e.dataset.node,[e.dataset.kind,e.tagName,e.classList.contains("saved")]])))')
    assert nodes=={'s-map':['section','BUTTON',True],'s-read-before-changing':['section','BUTTON',False],'s-commands':['section','BUTTON',False],'note-risk':['note','DIV',True],'g-proof':['group','DIV',True],
                   'img-board':['image','DIV',True],'img-logo':['image','DIV',True],'link-survey':['link','DIV',True],'ref-shipped':['section','BUTTON',True],'doc-research':['document','BUTTON',True],
                   'sheet-signups':['file','DIV',True],'to-launch':['portal','BUTTON',True],'odd':['unknown','DIV',True]}, 'Each element of the file shows with its kind; each section that the file does not place is a generated card'
    assert value('JSON.stringify([document.querySelector("#project-name").textContent,document.querySelector("#project-description").textContent.startsWith("3 sections · 11 elements from structure.canvas · example/alpha"),document.querySelector("#canvas-notice").hidden])')==['Structure',True,True], 'The header counts the sections and the elements of the file; a valid file has no message'
    assert value('JSON.stringify((e=>[position("s-map"),e.offsetWidth,e.offsetHeight,e.dataset.tone,e.innerText.includes("operator workspace")])(document.querySelector("[data-node=s-map]")))')==[[0,0],320,220,'4',True], 'A saved section card keeps its place, size, and colour, and shows the text of the record'
    assert value('JSON.stringify((()=>{const cards=[...document.querySelectorAll(".canvas-node:not(.group)")].map(e=>({id:e.dataset.node,x:position(e.dataset.node)[0],y:position(e.dataset.node)[1],w:e.offsetWidth,h:e.offsetHeight}));const hits=[];for(const a of cards)for(const b of cards)if(a.id<b.id&&HorsemenCanvas.overlaps(a,b,0))hits.push(a.id+"/"+b.id);return hits})())')==[], 'Generated cards do not overlap saved elements'
    assert value('JSON.stringify([...document.querySelectorAll(".canvas-node")].every(e=>{const r=e.getBoundingClientRect(),c=document.querySelector(".canvas").getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom}))') is True, 'A canvas with a file fits the screen'
    assert value('JSON.stringify((g=>[getComputedStyle(g).zIndex,g.querySelector(".group-label").textContent,[...document.querySelectorAll(".canvas-node:not(.group)")].every(e=>getComputedStyle(e).zIndex!=="0")])(document.querySelector("[data-node=g-proof]")))')==['0','Proof for the pilot',True], 'A group is a frame behind the other elements'
    # Hostile text in a note is text. A relative link goes to GitHub at the loaded commit; a script address is not a link.
    note=value('JSON.stringify((n=>[n.querySelector("strong").textContent,n.innerText.includes("<script>window.pwned=1</script>"),n.querySelectorAll("script,img,[onerror]").length,[...n.querySelectorAll("a")].map(a=>[a.textContent,a.href,a.target,a.rel]),n.dataset.tone])(document.querySelector("[data-node=note-risk]")))')
    assert note==['Risk:',True,0,[['Research','https://github.com/example/alpha/blob/'+'a'*40+'/docs/research.md','_blank','noopener noreferrer']],'1'], 'A note shows Markdown from the safe renderer'
    # Images come from blob: addresses through the reader. The SVG has a script; nothing runs.
    browser('wait','--fn','document.querySelectorAll(".file-node.image .md-image[data-state=shown] img").length === 2')
    assert value('JSON.stringify([...document.querySelectorAll(".file-node.image img")].map(i=>[i.alt,i.src.startsWith("blob:"),i.naturalWidth>0,i.closest("[data-node]").dataset.node]))')==[['Pilot board',True,True,'img-board'],['Pilot logo',True,True,'img-logo']], 'Repository images load as blob: images with their alternative text'
    assert value('JSON.stringify(document.querySelectorAll(".canvas-node svg:not(.icon), .canvas-node iframe, .canvas-node object, .canvas-node embed").length)')==0, 'No image is inline or in a frame'
    link=value('JSON.stringify((n=>[n.querySelector("b").textContent,n.querySelector(".card-line").textContent,[...n.querySelectorAll("a")].map(a=>[a.href,a.target,a.rel])])(document.querySelector("[data-node=link-survey]")))')
    assert link==['Pilot survey results','example.com',[['https://example.com/survey?round=1','_blank','noopener noreferrer']]], 'A link card shows the stored title and the host; nothing is fetched'
    assert value('JSON.stringify([document.querySelector("[data-node=sheet-signups] a").href,document.querySelector("[data-node=odd]").innerText.includes("Not supported"),document.querySelector("[data-node=ref-shipped] .card-from").textContent])')==['https://github.com/example/alpha/blob/'+'a'*40+'/.horsemen/media/signups.csv',True,'from Progress'], 'A table file is a file card; an unknown type says so; a section of another record names its record'
    # Connectors: a curve, an arrow, and a label. A hostile label is text.
    edges=value('JSON.stringify([...document.querySelectorAll(".wires .edge")].map(g=>[g.dataset.edge,g.querySelector("text").textContent,g.querySelectorAll("polygon").length,g.dataset.tone||null,/^M [-\\d.]+ [-\\d.]+ C /.test(g.querySelector("path").getAttribute("d"))]))')
    assert edges==[['e-proof','proof',1,None,True],['e-risk','blocks',1,'1',True],['e-hostile','<img src=x onerror=window.pwned=1>',2,None,True]], 'Each connector has its label and its arrows'
    assert value('JSON.stringify([document.querySelectorAll(".wires img,.wires script,.wires foreignObject,.wires circle").length,window.pwned??null,window.__csp])')==[0,None,[]], 'No script ran and nothing broke the content security policy'
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'canvas-file-structure.png'))
    # Selection, keyboard, and links. An element of a file has a fixed place. Enter selects; a note does not open.
    browser('click','[data-node="note-risk"]')
    assert value(shown)==['structure',['note-risk'],False] and value(place)=='&c=structure&n=note-risk', 'A click selects an element and the address names it'
    assert 'selected.' in browser('get','text','#selection-label') and 'Press Enter' not in browser('get','text','#selection-label'), 'The status names the selected element; a note has nothing to open'
    spot=value('JSON.stringify(position("note-risk"))');camera_before=value('JSON.stringify(camera)')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-node=note-risk]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    drag_points((box['x']+20,box['y']+12),(box['x']+60,box['y']+42))
    assert value('JSON.stringify(position("note-risk"))')==spot and value('camera.x')>camera_before['x'], 'A drag on an element of a file moves the canvas; the element keeps its place'
    browser('press','Enter')
    assert value(shown)==['structure',['note-risk'],False], 'Enter on a selected note opens nothing'
    browser('press','Escape');browser('focus','[data-node="img-board"]');browser('press','Enter')
    assert value(shown)==['structure',['img-board'],False], 'Enter selects an element that is not a button'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert value(shown)==['structure',['img-board'],False] and value('JSON.stringify(document.activeElement.dataset.node)')=='img-board', 'A reload returns to the canvas and the element'
    # A section of another record opens that record at the section. The link keeps the canvas, the card, and the record.
    browser('dblclick','[data-node="ref-shipped"]');browser('wait','#peek[open]')
    assert value('JSON.stringify(document.querySelector("#peek-title").textContent)')=='Progress' and at_section('Shipped') is True and value(place)=='&c=structure&n=ref-shipped&r=progress', 'A section card of another record opens that record at the section'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','#peek[open]')
    assert value(shown)==['structure',['ref-shipped'],True] and value('JSON.stringify(document.querySelector("#peek-title").textContent)')=='Progress' and at_section('Shipped') is True, 'A reload returns to the section of the other record'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open && document.activeElement.dataset.node === "ref-shipped"')
    # A document card opens the document in the reading view.
    browser('dblclick','[data-node="doc-research"]');browser('wait','--fn','document.querySelector("#peek").open && document.querySelector("#peek-content").innerText.includes("Operators need a clear next step.")')
    assert value('JSON.stringify(document.querySelector("#peek-title").textContent)')=='research.md', 'A document card opens its document'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open')
    # List view: the same elements in reading order, with the connectors as text. A section opens with one click; a note does not.
    browser('click','#list-view')
    assert value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>e.dataset.node))')==value('JSON.stringify(HorsemenCanvasView.listOrder(canvasView.nodes).map(n=>n.id))'), 'The list has the order of the view rules'
    tops=value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>Math.round(e.getBoundingClientRect().top)))')
    assert tops==sorted(tops) and len(set(tops))==len(tops), 'The list shows one element after the other'
    assert value('JSON.stringify([[...document.querySelectorAll("[data-node=s-map] .card-links .card-line")].map(e=>e.textContent),document.querySelector(".canvas").scrollWidth<=document.querySelector(".canvas").clientWidth,[...document.querySelectorAll(".canvas-node")].every(e=>e.scrollWidth<=e.clientWidth+1)])')==[['proof → Pilot board'],True,True], 'The list names the connectors of an element, and nothing scrolls sideways'
    order=value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>e.dataset.node))')
    assert order.index('g-proof')<order.index('img-board')<order.index('img-logo')<order.index('link-survey'), 'A group comes before its elements'
    browser('screenshot',str(args.output/'canvas-file-list.png'))
    browser('click','[data-node="note-risk"] p');assert value(shown)[2] is False, 'A click on a note in the list opens nothing'
    browser('click','[data-node="s-map"]');browser('wait','#peek[open]')
    assert value(place)=='&c=structure&n=s-map&r=structure' and at_section('Map') is True, 'One click in the list opens a saved section card at its section'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open');browser('click','#canvas-view')
    # A portal opens its canvas: a board. Elements can have the IDs of records and of built-in keys.
    browser('focus','[data-node="to-launch"]');browser('press','Enter');browser('press','Enter')
    browser('wait','--fn','canvasKey === "launch-plan"')
    assert value('JSON.stringify([document.querySelector("#project-name").textContent,document.querySelector("#project-description").textContent.startsWith("7 elements from launch-plan.canvas · example/alpha"),[...document.querySelectorAll("#canvases [aria-current=page]")].map(b=>b.dataset.canvas)])')==['Launch plan',True,['launch-plan']] and value(place)=='&c=launch-plan', 'Enter on a selected portal opens its canvas, and the rail marks the board'
    assert value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>e.dataset.node).sort())')==['constructor','g-ideas','progress','ref-gone','ref-shipped','to-nowhere','to-structure'], 'A board shows only the elements of its file'
    browser('click','[data-node="progress"]')
    assert value(shown)==['launch-plan',['progress'],False] and value(place)=='&c=launch-plan&n=progress', 'An element with the ID of a record is an element of this canvas'
    assert value('JSON.stringify([document.querySelector("#selection-label").textContent,recordCards.every(e=>e.hidden&&!e.classList.contains("canvas-selected")),document.querySelectorAll(".card-links-toggle:not([hidden]),.wires>path,.wires>circle").length])')==['Invite the pilot guests in one message. selected.',True,0], 'The hidden Home card with the same ID stays out of it'
    browser('press','Enter');assert value(shown)==['launch-plan',['progress'],False], 'Enter on that note opens nothing, also not the Progress record'
    browser('click','[data-node="constructor"]')
    assert value(shown)==['launch-plan',['constructor'],False] and value('JSON.stringify([document.querySelector("#selection-label").textContent,document.querySelector("[data-node=constructor]").dataset.tone,getComputedStyle(document.querySelector("[data-node=constructor]")).getPropertyValue("--tone")])')==['Ask two partners for a quote. selected.','hex','#33407A'], 'An element with the ID of a built-in key works; a hex colour is set as a value'
    assert value('JSON.stringify([(e=>[e.tagName,e.innerText.includes("Canvas not found")])(document.querySelector("[data-node=to-nowhere]")),(e=>[e.tagName,e.innerText.includes("Section not found. The heading is not in Progress now.")])(document.querySelector("[data-node=ref-gone]"))])')==[['DIV',True],['BUTTON',True]], 'A portal to a canvas that is not there says so; a section card whose heading is gone says so'
    browser('screenshot',str(args.output/'canvas-file-board.png'))
    browser('dblclick','[data-node="to-structure"]');browser('wait','--fn','canvasKey === "structure"')
    # A file that is not valid: a message, and the generated canvas of the record.
    browser('click','[data-canvas="brain"]')
    assert value('JSON.stringify([document.querySelector("#canvas-notice").hidden,document.querySelector("#canvas-notice").dataset.level,document.querySelector("#canvas-notice p").textContent,document.querySelector("#canvas-notice a").href])')==[False,'error','brain.canvas is not a valid canvas file: file is not valid JSON. The canvas shows the sections of the record.','https://github.com/example/alpha/blob/'+'a'*40+'/.horsemen/canvas/brain.canvas'], 'A file that is not JSON gives a clear message with a link to the file'
    assert value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>[e.dataset.node,position(e.dataset.node)]))')==value('JSON.stringify(HorsemenSections.canvas("brain",records.brain.content).nodes.map(n=>[n.id,[n.x,n.y]]))'), 'The generated canvas of the record shows in place of the file'
    browser('screenshot',str(args.output/'canvas-file-invalid.png'))
    # Hostile elements: the reader refuses a script address, CSS in a colour, and a path with "..". The others show as text.
    watch_csp();browser('click','[data-canvas="review"]')
    assert value('JSON.stringify([document.querySelector("#canvas-notice").dataset.level,document.querySelector("#canvas-notice p").textContent,[...document.querySelectorAll("#canvas-notice li")].map(e=>e.textContent.split(":")[0])])')==['warning','review.canvas has 3 elements that do not show. First fault: node evil: url must be an http or https address of 2,048 characters or less.',['node evil','node css','node up']], 'The message gives the count and each fault'
    assert value('JSON.stringify([...document.querySelectorAll(".canvas-node")].map(e=>e.dataset.node).sort())')==['label','ok','quoted'], 'The valid elements still show'
    hostile=value('JSON.stringify([document.querySelectorAll("#map script,#map [onerror],#map img:not([src^=\\"blob:\\"]),a[href^=\\"javascript\\" i]").length,[...document.querySelectorAll(".canvas-node")].some(e=>/url\\(|background:/.test(e.getAttribute("style"))),document.querySelector("[data-node=label] .group-label").textContent.startsWith("<script>"),document.querySelector("[data-node=quoted] a").href.startsWith("https://example.com/?q="),window.pwned??null,window.__csp])')
    assert hostile==[0,False,True,True,None,[]], 'Script text is text, no script address is a link, no colour carries CSS, and no script ran'
    browser('screenshot',str(args.output/'canvas-file-hostile.png'))
    for name,words in [('crowd','crowd.canvas is not a valid canvas file: more than 500 nodes. No element of this file shows.'),('heavy','heavy.canvas was not read. The canvas file is larger than 512 KiB. No element of this file shows.')]:
        browser('click',f'[data-canvas="{name}"]')
        assert value('JSON.stringify([document.querySelector("#canvas-notice p").textContent,document.querySelectorAll(".canvas-node").length,document.querySelector("#canvas-note").hidden,document.querySelector("#canvas-note").textContent])')==[words,0,False,'This canvas has no elements to show.'], name+': the file gives a message and no element'
    # A board with the name of a built-in key opens from the rail, from a link, and from Jump.
    browser('click','[data-canvas="constructor"]')
    assert value('JSON.stringify([canvasKey,document.querySelector("#project-name").textContent,document.querySelectorAll(".canvas-node").length,document.querySelector("#canvas-notice").hidden])')==['constructor','Constructor',1,True] and value(place)=='&c=constructor'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert value(shown)==['constructor',[],False], 'A reload returns to the board'
    go('&c=not-there&n=x')
    assert value(shown)==['home',[],False] and 'no canvas with the name' in browser('get','text','#toast'), 'A link to a canvas that is not in the project opens Home and says so'
    go('&c=launch-plan&n=gone')
    assert value(shown)==['launch-plan',[],False] and 'not in Launch plan now' in browser('get','text','#toast'), 'A link to an element that is gone says so'
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','review canvas');browser('press','Enter')
    assert value('JSON.stringify([canvasKey,document.querySelector("#palette").open])')==['review',False], 'Jump opens a board'
    # The SVG blob test: the image address opened as a page runs no script.
    browser('click','[data-canvas="structure"]');browser('wait','--fn','document.querySelectorAll(".file-node.image .md-image[data-state=shown] img").length === 2')
    browser('eval','location.href=document.querySelector("[data-node=img-logo] img").src');browser('wait','--fn','location.protocol === "blob:" && document.documentElement.localName === "svg"')
    assert value('JSON.stringify([document.documentElement.namespaceURI,document.querySelectorAll("script").length,window.pwned??null])')==['http://www.w3.org/2000/svg',1,None], 'The SVG opened as a page from its blob: address has its script element, and the script did not run'
    browser('open',f'http://127.0.0.1:{server.server_port}/#p={pid}');browser('wait','--fn','document.body.dataset.state === "ready"');watch_csp()
    # Shortcut sheet: from ? and from Jump.
    browser('focus','.canvas');browser('press','?');browser('wait','#shortcuts[open]')
    assert 'Collapse all linked branches' in browser('get','text','#shortcuts'), 'The shortcut sheet lists the canvas keys'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#shortcuts").open')
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','shortcuts');browser('press','Enter');browser('wait','#shortcuts[open]');browser('press','Escape')
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','hand tool');browser('press','Enter')
    assert value('JSON.stringify(document.querySelector(".canvas").dataset.tool)')=='hand', 'Jump reaches the canvas tools'
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','select tool');browser('press','Enter')
    browser('wait','--fn','!document.querySelector("#peek").open && !location.hash.includes("&r=")')
    browser('click','#list-view')
    assert 'list' in browser('get','attr','#map','class')
    was_expanded=browser('get','attr','[data-card-toggle="brain"]','aria-expanded').strip()
    browser('eval','document.querySelector("[data-card-toggle=brain]").scrollIntoView({block:"center"})')
    browser('click','[data-card-toggle="brain"]')
    assert browser('get','attr','[data-card-toggle="brain"]','aria-expanded').strip()!=was_expanded
    assert browser('eval','document.querySelector("#peek").open').strip()=='false', 'List-view toggle does not open the card'

    browser('click','#canvas-view')
    result=browser('eval', r'''(() => { const s=renderMarkdown('<script>window.pwned=1</script>\n[bad](javascript:alert(1))\n# Heading\n\n- Item','https://github.com/example/alpha/blob/abc/VISION.md'); if(s.includes('<script>')||s.includes('href="javascript:'))throw Error('unsafe rendering'); if(!s.includes('<h1>')||!s.includes('<li>'))throw Error('lost structure'); const rich=renderMarkdown('| Tool | Purpose |\n| --- | --- |\n| Python | Reader |\n<details>\n<summary>Evidence</summary>\nProof\n</details>','https://github.com'); if(!rich.includes('<table>')||!rich.includes('<summary>Evidence</summary>'))throw Error('lost table or disclosure'); return 'SAFE'; })()''')
    assert 'SAFE' in result
    before=browser('eval','JSON.stringify(position("vision"))')
    browser('eval',"document.querySelector('[data-artifact=vision]').focus()")
    browser('press','Alt+ArrowRight')
    assert browser('eval','JSON.stringify(position("vision"))')!=before
    z=browser('get','text','#zoom-label');browser('click','#zoom-in')
    assert browser('get','text','#zoom-label')!=z
    calls=len(server.state.reader.api.calls)
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert not any('/git/trees/' in p for p in server.state.reader.api.calls[calls:])
    browser('dblclick','[data-artifact="brain"]');browser('click','.connection-grid li:first-child .connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    browser('eval','document.querySelector(".connection-card").scrollIntoView({block:"center"})')
    browser('click','.connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "decision.md"')
    browser('eval','document.querySelector(".connections-heading button").scrollIntoView({block:"center"})')
    browser('click','.connections-heading button')
    assert browser('eval','[...document.querySelectorAll(".connected-node:not([hidden]) strong")].some(e=>e.textContent === "Delivery")').strip()=='true', 'Exploring a deep document reveals its ancestor path'
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','collapse');browser('press','Enter')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='0', 'Jump collapses all linked branches'
    browser('click','#fit')

    browser('set','viewport','390','844')
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert 'list' in browser('get','attr','#map','class'), 'A phone opens in List view, where cards stay readable'
    browser('screenshot','--full',str(args.output/'mobile-list.png'))
    rail=value('JSON.stringify((()=>{const row=document.querySelector("#canvases"),r=document.querySelector(".rail");return [document.documentElement.scrollWidth<=innerWidth,r.scrollWidth<=r.clientWidth+1,row.scrollWidth>=row.clientWidth,getComputedStyle(row).overflowX]})())')
    assert rail==[True,True,True,'auto'], 'On a phone the canvases are one row that scrolls inside the rail'
    browser('eval','document.querySelector("[data-canvas=progress]").scrollIntoView({inline:"center",block:"nearest"})');browser('click','[data-canvas="progress"]')
    assert value('JSON.stringify([canvasKey,document.querySelector("#map").classList.contains("list"),document.querySelectorAll(".section-card").length,document.documentElement.scrollWidth<=innerWidth])')==['progress',True,7,True], 'On a phone a canvas opens as a list of its sections'
    assert value('JSON.stringify([...document.querySelectorAll(".section-card")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1}))') is True, 'Section cards fit a phone'
    browser('screenshot','--full',str(args.output/'mobile-canvas-list.png'))
    browser('eval','document.querySelector("[data-node=s-gates]").scrollIntoView({block:"center"})');browser('click','[data-node="s-gates"]');browser('wait','#peek[open]')
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    assert value('JSON.stringify((r=>[Math.round(r.width),Math.round(r.height)])(document.querySelector("#peek").getBoundingClientRect()))')==[390,844] and location_ends(browser,'&c=progress&n=s-gates&r=progress'), 'On a phone a section opens the reading view on the full screen'
    browser('press','Escape');browser('wait','--fn','!document.querySelector("#peek").open')
    browser('eval','scrollTo(0,0)');browser('click','#workspace-toggle')
    pop=value('JSON.stringify((()=>{const r=document.querySelector("#workspace-pop").getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return [r.top>=0,r.bottom<=innerHeight,r.left>=0,r.right<=innerWidth,!!top.closest("#workspace-pop"),document.querySelectorAll("#workspace-pop [data-project]").length]})())')
    assert pop==[True,True,True,True,True,2], 'On a phone the project list opens on screen, above the page'
    browser('press','Escape')
    browser('eval','document.querySelector("[data-canvas=home]").scrollIntoView({inline:"center",block:"nearest"})');browser('click','[data-canvas="home"]')
    browser('click','#menu-toggle')
    menu=value('JSON.stringify((()=>{const r=document.querySelector("#menu").getBoundingClientRect(),top=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return [r.top>=0,r.bottom<=innerHeight,r.left>=0,r.right<=innerWidth,!!top.closest("#menu")]})())')
    assert menu==[True,True,True,True,True], 'On a phone the menu opens on screen, above the page'
    browser('press','Escape')
    browser('click','#canvas-view');browser('click','#fit')
    assert browser('eval','document.documentElement.scrollWidth <= innerWidth').strip()=='true'
    browser('screenshot','--full',str(args.output/'mobile.png'))
    browser('dblclick','[data-artifact="brain"]')
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    assert value('JSON.stringify((r=>[Math.round(r.width),Math.round(r.height)])(document.querySelector("#peek").getBoundingClientRect()))')==[390,844], 'On a phone the record view fills the screen'
    browser('screenshot',str(args.output/'mobile-brain-peek.png'))
    browser('press','Escape')
    fits='document.querySelector(".peek-content").scrollWidth <= document.querySelector(".peek-content").clientWidth'
    for key in ['progress','vision','structure','changelog','techstack']:
        browser('eval',f'openPeek("{key}",document.querySelector("[data-artifact={key}]"))');browser('wait','#peek[open]')
        assert browser('eval',fits).strip()=='true', key+' fits a phone without sideways scrolling'
        other='rich' if key=='progress' else 'list'
        browser('click','#peek-more');browser('click',f'#peek-menu [data-view-choice="{other}"]');assert browser('eval',fits).strip()=='true', key+' second layout fits a phone'
        browser('click','#peek-more');browser('click',f'#peek-menu [data-view-choice="{"list" if other=="rich" else "rich"}"]')
        if key=='progress':
            browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
            browser('screenshot',str(args.output/'mobile-progress-peek.png'))
        browser('press','Escape')
    browser('set','viewport','1440','1100');browser('click','#fit');browser('screenshot',str(args.output/'desktop.png'))
    # Themes: one gallery in the account menu. Each tile previews its theme in that theme's own fonts and colours.
    styles=value('JSON.stringify(HorsemenThemes.styles)')
    ids=[t['id'] for t in styles]
    assert len(ids)>=7 and ids[0]=='engraved', 'At least seven themes; Engraved is the default'
    browser('click','#menu-toggle')
    assert value('document.querySelectorAll("#menu [data-style-choice]").length')==len(ids), 'One tile for each theme'
    assert browser('get','attr','[data-style-choice="engraved"]','aria-checked').strip()=='true', 'Engraved is the default'
    assert value('JSON.stringify([...document.querySelectorAll("#menu [role=menuitem]")].map(b=>b.id))')==['connect','clear'], 'The menu holds Refresh GitHub and Clear workspace'
    assert value('JSON.stringify([document.querySelector("#palette-row").hidden,document.querySelector("#mode-row").hidden,document.querySelectorAll("#palette-row [data-theme-choice]").length])')==[False,True,7], 'Engraved shows its six palettes and System'
    previews=value('JSON.stringify([...document.querySelectorAll("#menu .theme-preview")].map(p=>{const t=p.querySelector(".tp-title"),c=p.querySelector(".tp-card");return [p.dataset.style,getComputedStyle(t).fontFamily.split(",")[0].replace(/\\"/g,""),getComputedStyle(p).backgroundColor,getComputedStyle(c).borderRadius,getComputedStyle(c).borderTopStyle]}))')
    assert [p[0] for p in previews]==ids, 'Previews follow the theme order'
    assert len({tuple(p[1:]) for p in previews})==len(ids), 'Each preview looks different'
    for p,t in zip(previews,styles):
        display=value(f'JSON.stringify(getComputedStyle(document.querySelector(".theme-preview[data-style={t["id"]}]")).getPropertyValue("--display").split(",")[0].trim())')
        assert p[1]==display, t['id']+' preview uses its own display font'
    scheme=value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')
    other='ember' if scheme=='light' else 'pale'
    assert browser('get','attr','[data-theme-choice="system"]','aria-checked').strip()=='true'
    browser('click',f'[data-theme-choice="{other}"]')
    assert value('JSON.stringify([document.documentElement.dataset.theme,localStorage.getItem("horsemen-theme")])')==[other,other], 'Engraved palette choice applies and is saved'
    assert value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')!=scheme
    browser('click','[data-theme-choice="system"]')
    assert value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')==scheme and value('JSON.stringify(localStorage.getItem("horsemen-theme"))') is None, 'System follows the device again'
    browser('press','Escape')
    assert browser('eval','document.querySelector("#menu").hidden').strip()=='true', 'Escape closes the menu'
    browser('click','#menu-toggle')
    assert value('JSON.stringify(document.activeElement.dataset.styleChoice)')=='engraved', 'The menu opens on the chosen theme'
    browser('press','End')
    assert value('JSON.stringify(document.activeElement.id)')=='clear', 'End reaches the last menu item'
    browser('press','ArrowDown')
    assert value('JSON.stringify(document.activeElement.id)')=='connect', 'Arrow keys wrap across every group'
    browser('press','Escape')
    assert value('JSON.stringify([document.querySelector("#menu").hidden,document.activeElement.id])')==[True,'menu-toggle'], 'Escape closes the menu and returns focus'
    browser('click','#fit')
    dock=value('JSON.stringify((()=>{const d=document.querySelector(".zoom").getBoundingClientRect();return [...document.querySelectorAll("[data-artifact]")].filter(e=>!e.hidden).every(e=>{const r=e.getBoundingClientRect();return r.bottom<=d.top||r.right<=d.left})})())')
    assert dock, 'Fit keeps every card clear of the zoom control'

    # Each theme: a click applies it at once, it survives a reload, it loads only its own fonts, and nothing overflows.
    browser('set','media','light')
    fonts='JSON.stringify([...document.fonts].filter(f=>f.status==="loaded").map(f=>f.family.replace(/\\"/g,"")))'
    roles='JSON.stringify(["display","label","ui","prose","mono"].flatMap(r=>getComputedStyle(document.documentElement).getPropertyValue("--"+r).split(",").map(f=>f.trim().replace(/\\"/g,""))))'
    head='JSON.stringify((()=>{const links=[...document.querySelectorAll("link[rel=preload][as=font]")],css=document.querySelector("link[rel=stylesheet]");return [links.map(l=>l.getAttribute("href")),links.every(l=>l.compareDocumentPosition(css)&Node.DOCUMENT_POSITION_FOLLOWING)]})())'
    no_overflow='JSON.stringify([document.documentElement.scrollWidth<=innerWidth,[".topbar",".rail",".heading-actions"].every(s=>{const e=document.querySelector(s);return e.scrollWidth<=e.clientWidth+1})])'
    # Text of a section card stays inside the card: the head and each line end before the card ends.
    card_fit='JSON.stringify([...document.querySelectorAll(".section-card")].filter(e=>{const r=e.getBoundingClientRect();return [...e.querySelectorAll(".cardhead b,.card-lead,.card-line,.card-meta,.card-note")].some(c=>{const b=c.getBoundingClientRect();return b.height&&(b.bottom>r.bottom-4||b.right>r.right-4)})}).map(e=>e.dataset.node))'
    for t in styles:
        if browser('eval','document.querySelector("#menu").hidden').strip()=='true':browser('click','#menu-toggle')
        browser('click',f'[data-style-choice="{t["id"]}"]')
        assert value('JSON.stringify([document.documentElement.dataset.style,localStorage.getItem("horsemen-style")])')==[t['id'],None if t['id']=='engraved' else t['id']], t['id']+' applies at once and is saved'
        assert browser('get','attr',f'[data-style-choice="{t["id"]}"]','aria-checked').strip()=='true' and browser('eval','document.querySelector("#menu").hidden').strip()=='false', 'The menu stays open to compare themes'
        if t['id']=='engraved':browser('screenshot',str(args.output/'theme-picker.png'))
        browser('press','Escape')
        browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','--fn','document.fonts.status === "loaded"')
        mode=value('JSON.stringify(document.documentElement.dataset.mode)')
        assert value('JSON.stringify(document.documentElement.dataset.style)')==t['id'], t['id']+' survives a reload'
        assert mode in t['modes'] and value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')==mode, t['id']+' uses a mode it supports'
        assert value(head)==[[f'/assets/fonts/{f}.woff2' for f in t['fonts']],True], t['id']+' preloads only its own fonts, before the stylesheet'
        assert set(value(fonts))<=set(value(roles)), t['id']+' downloads no font from another theme'
        browser('click','#fit');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
        browser('click','[data-canvas="progress"]');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
        assert value(no_overflow)==[True,True], t['id']+' has no overflow on a record canvas'
        assert value(card_fit)==[], t['id']+' shows section card text inside the card'
        assert value('JSON.stringify((look=>look(document.querySelector("#canvases .active"))!==look(document.querySelector("#canvases .project:not(.active)")))(e=>{const s=getComputedStyle(e);return [s.backgroundColor,s.color,s.fontWeight,s.textDecorationLine,s.boxShadow,getComputedStyle(e,"::before").content].join("|")}))') is True, t['id']+' marks the open canvas in the rail'
        browser('screenshot',str(args.output/f'theme-{t["id"]}-canvas.png'))
        browser('click','[data-canvas="home"]')
        assert value(no_overflow)==[True,True], t['id']+' has no layout overflow at desktop width'
        browser('screenshot',str(args.output/f'theme-{t["id"]}-home.png'))
        browser('eval','openPeek("progress",document.querySelector("[data-artifact=progress]"))');browser('wait','#peek[open]');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
        assert browser('eval',fits).strip()=='true', 'Progress fits in '+t['id']
        browser('screenshot',str(args.output/f'theme-{t["id"]}-progress.png'));browser('press','Escape')

    # No flash: theme.js sets the theme in <head>, before the stylesheet, and the theme does not wait for app.js.
    assert value('JSON.stringify((()=>{const s=document.querySelector("script[src=\\"/theme.js\\"]"),css=document.querySelector("link[rel=stylesheet]");return [!s.async&&!s.defer,!!(s.compareDocumentPosition(css)&Node.DOCUMENT_POSITION_FOLLOWING)]})())')==[True,True], 'theme.js blocks parsing and runs before the stylesheet loads'
    browser('eval','localStorage.setItem("horsemen-style","editorial")')
    browser('network','route','**/app.js','--abort')
    browser('reload');browser('wait','--fn','document.readyState === "complete"')
    assert value('JSON.stringify([document.documentElement.dataset.style,getComputedStyle(document.body).backgroundColor,getComputedStyle(document.querySelector("#project-name")).fontFamily.split(",")[0]])')==['editorial','rgb(243, 239, 228)','Opaline'], 'The first paint already has the saved theme'
    browser('network','unroute','**/app.js')
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')

    # System mode follows the device for a theme with light and dark; a chosen mode wins.
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','modern theme');browser('press','Enter')
    assert value('JSON.stringify([document.documentElement.dataset.style,localStorage.getItem("horsemen-style")])')==['modern','modern'], 'Jump reaches the themes'
    browser('set','media','dark')
    browser('wait','--fn','document.documentElement.dataset.mode === "dark"')
    browser('set','media','light')
    browser('wait','--fn','document.documentElement.dataset.mode === "light"')
    browser('click','#menu-toggle')
    assert value('JSON.stringify([document.querySelector("#palette-row").hidden,document.querySelector("#mode-row").hidden])')==[True,False], 'Modern shows the mode, not the Engraved palettes'
    browser('click','[data-mode-choice="dark"]')
    assert value('JSON.stringify([document.documentElement.dataset.mode,localStorage.getItem("horsemen-mode"),getComputedStyle(document.documentElement).colorScheme])')==['dark','dark','dark'], 'A chosen mode wins over the device'
    browser('click','[data-mode-choice="system"]')
    assert value('JSON.stringify([document.documentElement.dataset.mode,localStorage.getItem("horsemen-mode")])')==['light',None], 'System follows the device again'
    browser('press','Escape')
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','dark mode');browser('press','Enter')
    assert value('JSON.stringify(document.documentElement.dataset.mode)')=='dark', 'Jump reaches the mode'

    # The old type sets were for readable text. A saved Modern or System type set opens the Modern theme.
    browser('eval','localStorage.clear();localStorage.setItem("horsemen-type","system")')
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    assert value('JSON.stringify(document.documentElement.dataset.style)')=='modern', 'Readable type stays after the update'
    browser('click','#menu-toggle');browser('click','[data-style-choice="engraved"]');browser('press','Escape')
    assert value('JSON.stringify([localStorage.getItem("horsemen-style"),localStorage.getItem("horsemen-type")])')==[None,None], 'Choosing a theme replaces the old type set'

    # Phone width: every theme fits, and every record view fits without sideways scrolling.
    browser('set','viewport','390','844')
    for t in styles:
        browser('eval',f'localStorage.setItem("horsemen-style","{t["id"]}")')
        browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
        assert browser('eval','document.documentElement.scrollWidth <= innerWidth').strip()=='true', t['id']+' fits a phone'
        browser('eval','showCanvas("progress")')
        assert value('JSON.stringify([document.documentElement.scrollWidth<=innerWidth,(r=>r.scrollWidth<=r.clientWidth+1)(document.querySelector(".rail")),[...document.querySelectorAll(".section-card")].every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth)])')==[True,True,True], t['id']+' fits a record canvas on a phone'
        # A canvas with a file on a phone, in each theme: the list of its elements fits, and a preset colour is a colour of the theme.
        browser('eval','showCanvas("structure")')
        assert value('JSON.stringify([document.querySelector("#map").classList.contains("list"),document.documentElement.scrollWidth<=innerWidth,[...document.querySelectorAll(".canvas-node")].every(e=>e.scrollWidth<=e.clientWidth+1&&e.getBoundingClientRect().right<=innerWidth),document.querySelectorAll(".canvas-node").length])')==[True,True,True,13], 'A canvas with a file fits a phone as a list in '+t['id']
        tones=value('JSON.stringify(["s-map","note-risk","s-commands"].map(id=>getComputedStyle(document.querySelector("[data-node="+id+"]"),"::before").backgroundColor))')
        assert len(set(tones))==3 and tones[2]=='rgba(0, 0, 0, 0)', 'Each preset colour shows as a colour of the theme in '+t['id']
        if t['id'] in ('engraved','terminal'):browser('screenshot',str(args.output/f'canvas-file-phone-{t["id"]}.png'))
        browser('eval','showCanvas("home")')
        for key in ['progress','vision','brain','structure','changelog','techstack']:
            browser('eval',f'openPeek("{key}",document.querySelector("[data-artifact={key}]"))');browser('wait','#peek[open]')
            assert browser('eval',fits).strip()=='true', key+' fits a phone in '+t['id']
            browser('press','Escape')
        browser('click','#menu-toggle')
        menu=value('JSON.stringify((()=>{const r=document.querySelector("#menu").getBoundingClientRect();return [r.left>=0,r.right<=innerWidth,r.top>=0,r.bottom<=innerHeight]})())')
        assert menu==[True,True,True,True], 'The theme menu fits a phone in '+t['id']
        browser('press','Escape')
        if t['id']=='contrast':browser('screenshot','--full',str(args.output/'theme-contrast-phone.png'))
    browser('eval','localStorage.removeItem("horsemen-style")')
    browser('set','viewport','1440','1100');browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"')
    browser('dblclick','[data-artifact="vision"]');browser('press','Escape');browser('click','#menu-toggle');browser('click','#clear')
    browser('wait','--fn','document.body.dataset.state === "idle"')
    assert browser('get','text','#source-content').strip()==''
    assert browser('get','text','#peek-content').strip()==''
    assert browser('get','text','#project-name').strip()=='Workspace cleared'
    assert not browser('errors').strip()
    print('PASS: local sign-in scan, real-provider adapter, record peek/source/missing states, safe Markdown, canvas/list, generated canvases with section links and keyboard use, canvas files (boards, elements, connectors, list, messages, hostile content, the SVG blob test), mobile bounds, every theme at desktop and phone width, no browser errors.')
except BaseException:
    try:
        browser('screenshot',str(args.output/'failure.png'))
        print('At failure:',browser('eval','JSON.stringify({toggle:document.querySelector("[data-card-toggle=brain]")?.getBoundingClientRect(),card:document.querySelector("[data-artifact=brain]").getBoundingClientRect(),canvas:document.querySelector(".canvas").getBoundingClientRect(),scroll:[document.querySelector(".canvas").scrollTop,scrollY],title:document.querySelector("#peek-title").textContent})'))
    except Exception:pass
    raise
finally:
    release_scan.set();browser('close');server.shutdown();server.server_close();thread.join();(args.output/'output.txt').write_text('\n'.join(log))
