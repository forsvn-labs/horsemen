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

parser=argparse.ArgumentParser();parser.add_argument('--output',required=True,type=Path);args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
root=Path(__file__).resolve().parents[1]
release_scan=threading.Event()
class ProgressiveFake(Fake):
    sources={
        'vision':'# Record\n\nOwner: A fictional team · Confirmed: 2026-11-02\n\nActual source.\n## Why we exist\nHelp small teams keep decisions close to their work.\n## Who we build for\nIndependent builders and project operators.\n## The world we are building\nA clear view of every active project.\n## How we get there\n- Now: Prove the pilot with three operators.\n- Next: Shared team spaces.\n- Later: Every project has a clear next step.\n## Open questions\n- Pricing for teams? The owner decides.\n## Direction changes\n- 2026-11-02: Narrowed the pilot to operators. Previous: all builders.',
        'progress':'# Progress\n\nUpdated: 2026-11-18 · Stage: pilot · Health: On track\n\nNext action: Invite three operators to the pilot.\n\n## Latest day\n\n<details open>\n<summary>Latest day · 2026-11-18</summary>\n\n## Shipped\n\n- **Search** (2026-11-18): Search is available to the pilot group.\n\n## In progress\n\n- **Export** (started 2026-11-12): Operators can save a board as a PDF.\n\n## Up next\n\n- **Saved views** (target December 2026): Keep a filter between visits.\n\n## Gates\n\n- Review the pilot feedback before wider access.\n\n### Technical details\n\n| Item | Evidence |\n| --- | --- |\n| Search | [PR #12](https://github.com/example/alpha/pull/12) and the [release note](https://example.com/notes/search). |\n\n</details>\n\n## Historical ships\n\n<details>\n<summary>Historical ships · newest first</summary>\n\n### 2026-11-10\n\n- **Walkthrough** (2026-11-10): The first walkthrough reached two operators.\n\n#### Technical details\n\n| Item | Evidence |\n| --- | --- |\n| Walkthrough | [PR #9](https://github.com/example/alpha/pull/9), commit [a1b2c3d](https://github.com/example/alpha/commit/a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0). |\n\n</details>\n\n## Upcoming roadmap\n\n<details>\n<summary>Upcoming roadmap</summary>\n\n- Next: Shared team spaces.\n- Later: A hosted reader.\n\n</details>',
        'brain':'# Brain\n## Providers\n- [Research notebook](docs/research.md): interviews and decisions.\n- [External reference](https://example.com/reference)\n## Access\nRead originals within existing permissions.\n## Save and cleanup\nKeep owner decisions with their source.',
        'techstack':'# Tech stack\n## Tools\n| Tool | Purpose | Needs |\n| --- | --- | --- |\n| Python 3.10+ | Local reader | Python 3.10+ |\n| GitHub CLI | Read project records | Existing sign-in |',
        'changelog':'# Changelog\n## 2026-11-18\n- Search reached the fictional pilot. [PR #12](https://github.com/example/alpha/pull/12)\n## 2026-11-10\nFirst walkthrough delivered.',
        'structure':'# Structure\n## Map\n```text\napp/ — operator workspace (start here)\ndocs/ — decisions and references\ntests/ — verification\n```\n## Read before changing\nStart with the current progress snapshot.\n## Commands\npython3 scripts/serve_gui.py'
    }
    def __call__(self,path,paginate=False):
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
        if path.startswith('/user/repos'):
            second=dict(result[0],id=2,full_name='example/aardvark');return result+[second]
        if '/repos/example/aardvark/commits/' in path:release_scan.wait(45)
        return result
server=make_server(0,ScanState(GitHubReader(ProgressiveFake())),root/'web')
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
    scheme=value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')
    other='ember' if scheme=='light' else 'pale'
    browser('click','#menu-toggle')
    assert value('document.querySelectorAll("#menu [data-theme-choice]").length')==7, 'System and six themes'
    assert value('document.querySelectorAll("#menu [role=group] [role=menuitemradio]").length')==10, 'Colours and type sets share one menu, in labelled groups'
    assert value('JSON.stringify([...document.querySelectorAll("#menu [role=menuitem]")].map(b=>b.id))')==['connect','clear'], 'The menu holds Refresh GitHub and Clear workspace'
    assert browser('get','attr','[data-theme-choice="system"]','aria-checked').strip()=='true'
    browser('click',f'[data-theme-choice="{other}"]')
    assert value('JSON.stringify([document.documentElement.dataset.theme,localStorage.getItem("horsemen-theme")])')==[other,other], 'Theme choice applies and is saved'
    assert value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')!=scheme
    browser('screenshot',str(args.output/('desktop-'+other+'.png')))
    browser('dblclick','[data-artifact="progress"]');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/('progress-peek-'+other+'.png')));browser('press','Escape')
    browser('click','#menu-toggle');browser('click','[data-theme-choice="system"]')
    assert value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')==scheme and value('JSON.stringify(localStorage.getItem("horsemen-theme"))') is None, 'System follows the device again'
    browser('press','Escape')
    assert browser('eval','document.querySelector("#menu").hidden').strip()=='true', 'Escape closes the menu'
    browser('click','#fit')
    dock=value('JSON.stringify((()=>{const d=document.querySelector(".zoom").getBoundingClientRect();return [...document.querySelectorAll("[data-artifact]")].filter(e=>!e.hidden).every(e=>{const r=e.getBoundingClientRect();return r.bottom<=d.top||r.right<=d.left})})())')
    assert dock, 'Fit keeps every card clear of the zoom control'
    # Type sets: one choice for every colour theme. It is saved, and it loads before first paint.
    browser('click','#menu-toggle')
    assert value('document.querySelectorAll("#menu [data-type-choice]").length')==3, 'Engraved, Modern, and System'
    assert browser('get','attr','[data-type-choice="engraved"]','aria-checked').strip()=='true', 'Engraved is the default'
    browser('click','[data-type-choice="modern"]')
    assert value('JSON.stringify([document.documentElement.dataset.type,localStorage.getItem("horsemen-type")])')==['modern','modern'], 'Type choice applies and is saved'
    assert browser('get','attr','[data-type-choice="modern"]','aria-checked').strip()=='true' and browser('get','attr','[data-type-choice="engraved"]','aria-checked').strip()=='false'
    browser('press','Escape')
    fonts='JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name.split("/").pop()).filter(n=>n.endsWith(".woff2")).sort())'
    head='JSON.stringify((()=>{const links=[...document.querySelectorAll("link[rel=preload][as=font]")],css=document.querySelector("link[rel=stylesheet]");return [links.map(l=>l.getAttribute("href")),links.every(l=>l.compareDocumentPosition(css)&Node.DOCUMENT_POSITION_FOLLOWING)]})())'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','--fn','document.fonts.status === "loaded"')
    assert value('JSON.stringify(document.documentElement.dataset.type)')=='modern', 'The type choice survives a reload'
    assert value(head)==[['/assets/fonts/beacon.woff2'],True], 'Only the active set is preloaded, before the stylesheet'
    assert 'Beacon' in value('JSON.stringify(getComputedStyle(document.querySelector("#project-name")).fontFamily)')
    assert not set(value(fonts))&{'cleft.woff2','gravure.woff2','halden.woff2','vellum.woff2'}, 'Modern downloads no Engraved fonts'
    browser('click','#fit');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'desktop-modern.png'))
    browser('dblclick','[data-artifact="progress"]');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    assert browser('eval',fits).strip()=='true', 'Progress fits with the wider Modern letters'
    browser('screenshot',str(args.output/'progress-peek-modern.png'));browser('press','Escape')
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','system type');browser('press','Enter')
    assert value('JSON.stringify([document.documentElement.dataset.type,localStorage.getItem("horsemen-type")])')==['system','system'], 'Jump to reaches the type sets'
    browser('reload');browser('wait','--fn','document.body.dataset.state === "ready"');browser('wait','--fn','document.fonts.status === "loaded"')
    assert value(head)==[[],True] and value(fonts)==[], 'System preloads and downloads no font files'
    browser('click','#fit');browser('screenshot',str(args.output/'desktop-system.png'))
    browser('press','Control+k');browser('wait','#palette[open]');browser('fill','#palette-input','engraved type');browser('press','Enter')
    assert value('JSON.stringify([document.documentElement.dataset.type,localStorage.getItem("horsemen-type")])')==['engraved',None], 'Engraved is the default again'
    browser('click','#menu-toggle')
    assert value('JSON.stringify(document.activeElement.dataset.themeChoice)')=='system', 'The menu opens on the chosen colour'
    browser('press','End')
    assert value('JSON.stringify(document.activeElement.id)')=='clear', 'End reaches the last menu item'
    browser('press','ArrowDown')
    assert value('JSON.stringify(document.activeElement.id)')=='connect', 'Arrow keys wrap across every group'
    browser('press','Escape')
    assert value('JSON.stringify([document.querySelector("#menu").hidden,document.activeElement.id])')==[True,'menu-toggle'], 'Escape closes the menu and returns focus'
    browser('dblclick','[data-artifact="vision"]');browser('press','Escape');browser('click','#menu-toggle');browser('click','#clear')
    browser('wait','--fn','document.body.dataset.state === "idle"')
    assert browser('get','text','#source-content').strip()==''
    assert browser('get','text','#peek-content').strip()==''
    assert browser('get','text','#project-name').strip()=='Workspace cleared'
    assert not browser('errors').strip()
    print('PASS: local sign-in scan, real-provider adapter, record peek/source/missing states, safe Markdown, canvas/list, mobile bounds, themes and type sets, no browser errors.')
except BaseException:
    try:
        browser('screenshot',str(args.output/'failure.png'))
        print('At failure:',browser('eval','JSON.stringify({toggle:document.querySelector("[data-card-toggle=brain]")?.getBoundingClientRect(),card:document.querySelector("[data-artifact=brain]").getBoundingClientRect(),canvas:document.querySelector(".canvas").getBoundingClientRect(),scroll:[document.querySelector(".canvas").scrollTop,scrollY],title:document.querySelector("#peek-title").textContent})'))
    except Exception:pass
    raise
finally:
    release_scan.set();browser('close');server.shutdown();server.server_close();thread.join();(args.output/'output.txt').write_text('\n'.join(log))
