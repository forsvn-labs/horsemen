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
        'brain':'# Brain\n## Providers\n- Research notebook: interviews and decisions.\n## Access\nRead originals within existing permissions.\n## Save and cleanup\nKeep owner decisions with their source.',
        'structure':'# Structure\n## Map\n```text\napp/ — operator workspace\ndocs/ — decisions and references\ntests/ — verification\n```\n## Read before changing\nStart with the current progress snapshot.\n## Commands\npython3 scripts/serve_gui.py'
    }
    def __call__(self,path,paginate=False):
        if '/git/blobs/' in path:
            key=path.rsplit('/',1)[-1]
            if key in self.sources:return {'encoding':'base64','content':base64.b64encode(self.sources[key].encode()).decode()}
        result=super().__call__(path,paginate)
        if '/git/trees/' in path:
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
try:
    browser('open',f'http://127.0.0.1:{server.server_port}')
    browser('wait','--fn','document.body.dataset.state === "ready"')
    assert server.state.snapshot()['phase']=='scanning', 'First project must open before discovery completes'
    assert 'alpha' in browser('get','text','#project-name')
    release_scan.set()
    browser('wait','--fn','projects.length === 2')
    assert 'alpha' in browser('get','text','#project-name'), 'New results must preserve selection'

    assert 'PRIVATE' in browser('get','text','#privacy')
    browser('fill','#project-search','no-match')
    assert 'No matching projects' in browser('get','text','#no-projects')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='0'
    browser('fill','#project-search','EXAMPLE alpha')
    assert browser('eval','document.querySelectorAll("[data-project]").length').strip()=='1'
    assert 'Help small teams' in browser('get','text','[data-artifact="vision"]')
    assert 'Invite three operators' in browser('get','text','[data-artifact="progress"]')
    browser('fill','#project-search','')
    browser('click','[data-artifact="vision"]');browser('wait','#peek[open]')
    assert 'Actual source.' in browser('get','text','#peek-content')
    browser('click','#source-tab');assert '# Record' in browser('get','text','#source-content')
    browser('press','Escape')
    browser('click','[data-artifact="readme"]');assert 'missing' in browser('get','text','#peek-content')
    browser('press','Escape');browser('click','#list-view')
    assert 'list' in browser('get','attr','#map','class')
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
    browser('set','viewport','390','844');browser('click','#fit')
    assert browser('eval','document.documentElement.scrollWidth <= innerWidth').strip()=='true'
    browser('screenshot','--full',str(args.output/'mobile.png'))
    browser('set','viewport','1440','1100');browser('click','#fit');browser('screenshot',str(args.output/'desktop.png'))
    browser('click','[data-artifact="vision"]');browser('press','Escape');browser('click','#clear')
    browser('wait','--fn','document.body.dataset.state === "idle"')
    assert browser('get','text','#source-content').strip()==''
    assert browser('get','text','#peek-content').strip()==''
    assert browser('get','text','#crumb').strip()==''
    assert not browser('errors').strip()
    print('PASS: local sign-in scan, real-provider adapter, record peek/source/missing states, safe Markdown, canvas/list, mobile bounds, no browser errors.')
finally:
    release_scan.set();browser('close');server.shutdown();server.server_close();thread.join();(args.output/'output.txt').write_text('\n'.join(log))
