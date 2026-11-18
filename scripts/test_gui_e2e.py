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
        'vision':'# Record\n\nActual source.\n## Why we exist\nHelp small teams keep decisions close to their work.\n## Who we build for\nIndependent builders and project operators.\n## The world we are building\nA clear view of every active project.',
        'progress':'# Progress\nNext action: Invite three operators to the pilot.\n## Shipped\n- Search is available to the pilot group.\n## Gates\n- Review the pilot feedback before wider access.',
        'brain':'# Brain\n## Providers\n- [Research notebook](docs/research.md): interviews and decisions.\n- [External reference](https://example.com/reference)\n## Access\nRead originals within existing permissions.\n## Save and cleanup\nKeep owner decisions with their source.',
        'techstack':'# Tech stack\n## Tools\n| Tool | Purpose | Needs |\n| --- | --- | --- |\n| Python | Local reader | Python 3.10+ |\n| GitHub CLI | Read project records | Existing sign-in |',
        'changelog':'# Changelog\n## 2026-11-18\nSearch reached the fictional pilot.\n## 2026-11-10\nFirst walkthrough delivered.',
        'structure':'# Structure\n## Map\n```text\napp/ — operator workspace\ndocs/ — decisions and references\ntests/ — verification\n```\n## Read before changing\nStart with the current progress snapshot.\n## Commands\npython3 scripts/serve_gui.py'
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

    assert 'PRIVATE' in browser('get','text','#privacy')
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
    browser('click','#hand-tool')
    camera_before=value('JSON.stringify(camera)');before=value('JSON.stringify(position("vision"))')
    box=value('JSON.stringify((()=>{const r=document.querySelector("[data-artifact=vision]").getBoundingClientRect();return {x:r.x,y:r.y}})())')
    drag_points((box['x']+40,box['y']+40),(box['x']+70,box['y']+60))
    assert value('JSON.stringify(position("vision"))')==before and value('camera.x')>camera_before['x'], 'Hand pans over a card without moving it'
    browser('click','#select-tool');browser('click','#fit')
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


    browser('fill','#project-search','no-match')
    assert 'No matching projects' in browser('get','text','#no-projects')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='0'
    browser('fill','#project-search','EXAMPLE alpha')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='1'
    assert 'Help small teams' in browser('get','text','[data-artifact="vision"]')
    assert 'Invite three operators' in browser('get','text','[data-artifact="progress"]')
    browser('fill','#project-search','')
    browser('dblclick','[data-artifact="vision"]');browser('wait','#peek[open]')
    assert 'Help small teams' in browser('get','text','#peek-content')
    browser('click','#document-tab');assert 'Actual source.' in browser('get','text','#peek-content')
    browser('click','#source-tab');assert '# Record' in browser('get','text','#source-content')
    browser('press','Escape')
    browser('dblclick','[data-artifact="brain"]')
    assert browser('eval','Boolean(document.querySelector("[data-layout=library]"))').strip()=='true'
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'brain-peek.png'))
    browser('click','.connection-card:first-child')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    assert 'Operators need a clear next step.' in browser('get','text','#peek-content')
    browser('eval','document.querySelector(".connection-card").scrollIntoView({block:"center"})')
    browser('click','.connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "decision.md"')
    browser('click','#peek-back');assert 'research.md' in browser('get','text','#peek-title')
    browser('click','#peek-back');assert 'BRAIN.md' in browser('get','text','#peek-title')
    browser('click','.connection-card:last-child')
    assert 'have not been loaded' in browser('get','text','#peek-content')
    browser('click','#peek-back')
    browser('click','.connections-heading button')
    assert browser('eval','document.querySelectorAll(".connected-node").length').strip()=='2'
    browser('click','[data-artifact="brain"]');browser('click','[data-card-toggle="brain"]')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='0'
    browser('click','[data-card-toggle="brain"]')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='2'
    browser('click','#collapse-all')
    assert browser('eval','document.querySelectorAll(".connected-node:not([hidden])").length').strip()=='0'
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
    for key,layout in [('vision','brief'),('progress','board'),('structure','map'),('changelog','timeline'),('techstack','tools')]:
        browser('dblclick',f'[data-artifact="{key}"]')
        assert browser('eval',f'Boolean(document.querySelector("[data-layout={layout}]"))').strip()=='true'
        browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
        browser('screenshot',str(args.output/(key+'-peek.png')))
        if key=='techstack':assert browser('eval','document.querySelectorAll(".tool-card").length').strip()=='2'
        browser('press','Escape')
    browser('click','#list-view')
    assert 'list' in browser('get','attr','#map','class')
    was_expanded=browser('get','attr','[data-card-toggle="brain"]','aria-expanded').strip()
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
    browser('dblclick','[data-artifact="brain"]');browser('click','.connection-card:first-child')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "research.md"')
    browser('eval','document.querySelector(".connection-card").scrollIntoView({block:"center"})')
    browser('click','.connection-card')
    browser('wait','--fn','document.querySelector("#peek-title").textContent === "decision.md"')
    browser('eval','document.querySelector(".connections-heading button").scrollIntoView({block:"center"})')
    browser('click','.connections-heading button')
    assert browser('eval','[...document.querySelectorAll(".connected-node:not([hidden]) strong")].some(e=>e.textContent === "Delivery")').strip()=='true', 'Exploring a deep document reveals its ancestor path'
    browser('click','#collapse-all');browser('click','#fit')

    browser('set','viewport','390','844');browser('click','#fit')
    assert browser('eval','document.documentElement.scrollWidth <= innerWidth').strip()=='true'
    browser('screenshot','--full',str(args.output/'mobile.png'))
    browser('dblclick','[data-artifact="brain"]')
    browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/'mobile-brain-peek.png'))
    browser('press','Escape')
    browser('set','viewport','1440','1100');browser('click','#fit');browser('screenshot',str(args.output/'desktop.png'))
    scheme=value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')
    browser('click','#theme-toggle')
    other=value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')
    assert {scheme,other}=={'light','dark'} and value('JSON.stringify(localStorage.getItem("horsemen-theme"))')==other, 'Theme switch changes and saves the theme'
    browser('screenshot',str(args.output/('desktop-'+other+'.png')))
    browser('dblclick','[data-artifact="brain"]');browser('wait','--fn','document.getAnimations().every(a=>a.playState === "finished")')
    browser('screenshot',str(args.output/('brain-peek-'+other+'.png')));browser('press','Escape')
    browser('click','#theme-toggle')
    assert value('JSON.stringify(getComputedStyle(document.documentElement).colorScheme)')==scheme
    dock=value('JSON.stringify((()=>{const d=document.querySelector(".canvas-controls").getBoundingClientRect();return [...document.querySelectorAll("[data-artifact]")].filter(e=>!e.hidden).every(e=>e.getBoundingClientRect().bottom<=d.top)})())')
    assert dock, 'Fit keeps every card clear of the tool dock'
    browser('dblclick','[data-artifact="vision"]');browser('press','Escape');browser('click','#clear')
    browser('wait','--fn','document.body.dataset.state === "idle"')
    assert browser('get','text','#source-content').strip()==''
    assert browser('get','text','#peek-content').strip()==''
    assert browser('get','text','#crumb').strip()==''
    assert not browser('errors').strip()
    print('PASS: local sign-in scan, real-provider adapter, record peek/source/missing states, safe Markdown, canvas/list, mobile bounds, no browser errors.')
finally:
    release_scan.set();browser('close');server.shutdown();server.server_close();thread.join();(args.output/'output.txt').write_text('\n'.join(log))
