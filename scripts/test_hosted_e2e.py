"""End-to-end check of the hosted viewer against a disposable fake GitHub.

Runs the real Worker with `wrangler dev`, signs in through a fake OAuth flow,
reads a fictional project, detects a new commit, and signs out. Saves
screenshots and the command log to --output (outside the repository).

    python3 scripts/test_hosted_e2e.py --output /tmp/horsemen-hosted-check
"""
import argparse
import base64
import hashlib
import json
import os
import signal
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import parse_qs, urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--port', type=int, default=8788)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]

SOURCES = {
    'VISION.md': '# Vision\n## Why we exist\nHelp small teams keep decisions close to their work.\n## Who we build for\nIndependent builders.',
    'PROGRESS.md': '# Progress\nNext action: Invite three operators to the pilot.\n## Shipped\n- Search is available to the pilot group.',
    'BRAIN.md': '# Brain\n## Providers\n- [Research notebook](docs/research.md): interviews.',
    'STRUCTURE.md': '# Structure\n## Map\n```text\napp/ — workspace\n```',
    'docs/research.md': ('# Research notebook\nOperators need a clear next step.\n## Flow\n```mermaid\nflowchart LR\n  Operator --> Notebook[Research notebook]\n  Notebook --> Decision\n```\n'
                         '## Interviews\n```mermaid\npie title Interviews\n  "Operators" : 6\n  "Builders" : 4\n```\n## Draft\n```mermaid\nflowchart LR\n  A[Open --> B\n```\n'
                         '## Screens\n![Pilot board](img/board.png) ![Pilot logo](img/logo.svg)\n\n![Old screen](img/missing.png)'),
}
def png(width, height, rgb):
    """A small solid PNG, built here so the fixture needs no binary file."""
    import struct, zlib
    chunk = lambda kind, data: struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    rows = b''.join(b'\x00' + bytes(rgb) * width for _ in range(height))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')
# Fictional images: a PNG, and an SVG with a script that must never run. docs/img/missing.png does not exist.
IMAGES = {'docs/img/board.png': png(48, 24, (51, 64, 122)),
          'docs/img/logo.svg': b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="window.pwned=1"><script>window.pwned=1</script><circle cx="20" cy="20" r="18" fill="#a8301d"/></svg>'}
UPDATED = '# Progress\nNext action: Publish the pilot results.\n## Shipped\n- Pilot results reached all operators.'
world = {'app_calls': 0, 'rev': 'a' * 40, 'sources': dict(SOURCES), 'revoked': 0, 'tokens': 0, 'not_modified': 0}
def sha(text): return hashlib.sha1(text.encode()).hexdigest()


class FakeGitHub(BaseHTTPRequestHandler):
    def log_message(self, *_): pass

    def send(self, status, body=None, headers=None):
        raw = json.dumps(body).encode() if body is not None else b''
        self.send_response(status)
        for k, v in (headers or {}).items(): self.send_header(k, v)
        if body is not None: self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        url = urlsplit(self.path); q = parse_qs(url.query); p = url.path
        if p == '/login/oauth/authorize':
            return self.send(302, None, {'Location': q['redirect_uri'][0] + '?code=fictional&state=' + q['state'][0]})
        auth = self.headers.get('Authorization', '')
        if auth == '':
            # No credentials: public data only. example/open is public; example/alpha is private.
            world['app_calls'] += 1
            if p == '/repos/example/alpha': return self.send(404, {'message': 'Not Found'})
            if p == '/repos/example/open': return self.send(200, {'id': 9, 'full_name': 'example/open', 'default_branch': 'main', 'private': False, 'visibility': 'public', 'archived': False})
            if not p.startswith('/repos/example/open/'): return self.send(404, {'message': 'Not Found'})
            p = p.replace('/repos/example/open/', '/repos/example/alpha/', 1)
        elif auth != 'Bearer ghu_fictional': return self.send(401, {'message': 'Bad credentials'})
        if p == '/user': return self.send(200, {'login': 'operator'})
        if p == '/user/installations': return self.send(200, {'installations': [{'id': 1}]})
        if p == '/user/installations/1/repositories':
            return self.send(200, {'repositories': [{'id': 1, 'full_name': 'example/alpha', 'default_branch': 'main', 'private': True, 'archived': False, 'pushed_at': '2026-11-19T00:00:00Z'}]})
        if p == '/repos/example/alpha/commits/main':
            etag = f'"{world["rev"]}"'
            if self.headers.get('If-None-Match') == etag: world['not_modified'] += 1; return self.send(304, None, {'ETag': etag})
            return self.send(200, {'sha': world['rev'], 'commit': {'tree': {'sha': world['rev'][:1] * 40}}}, {'ETag': etag})
        if p.startswith('/repos/example/alpha/git/trees/'):
            return self.send(200, {'truncated': False, 'tree': [{'path': k, 'type': 'blob', 'mode': '100644', 'sha': sha(v), 'size': len(v)} for k, v in world['sources'].items()]})
        if p.startswith('/repos/example/alpha/git/blobs/'):
            for v in world['sources'].values():
                if sha(v) == p.rsplit('/', 1)[1]: return self.send(200, {'encoding': 'base64', 'content': base64.b64encode(v.encode()).decode()})
        if p.startswith('/repos/example/alpha/contents/') and p.split('/contents/', 1)[1] in IMAGES:
            data = IMAGES[p.split('/contents/', 1)[1]]
            return self.send(200, {'type': 'file', 'sha': hashlib.sha1(data).hexdigest(), 'size': len(data), 'encoding': 'base64', 'content': base64.b64encode(data).decode()})
        if p.startswith('/repos/example/alpha/contents/'):
            v = world['sources'].get(p.split('/contents/', 1)[1])
            if v: return self.send(200, {'type': 'file', 'sha': sha(v), 'size': len(v), 'encoding': 'base64', 'content': base64.b64encode(v.encode()).decode()})
        return self.send(404, {'message': 'Not Found'})

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if self.path == '/login/oauth/access_token':
            world['tokens'] += 1
            return self.send(200, {'access_token': 'ghu_fictional', 'refresh_token': 'ghr_fictional', 'expires_in': 28800, 'refresh_token_expires_in': 15897600})
        return self.send(404, {'message': 'Not Found'})

    def do_DELETE(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if self.path.startswith('/applications/'): world['revoked'] += 1; return self.send(204)
        return self.send(404, {'message': 'Not Found'})


fake = ThreadingHTTPServer(('127.0.0.1', 0), FakeGitHub)
threading.Thread(target=fake.serve_forever, daemon=True).start()
github = f'http://127.0.0.1:{fake.server_port}'
origin = f'http://localhost:{args.port}'
log = []
variables = {'GITHUB_API': github, 'GITHUB_WEB': github, 'GITHUB_CLIENT_ID': 'Iv1.fictional', 'GITHUB_CLIENT_SECRET': 'fictional',
             'GITHUB_APP_SLUG': 'horsemen-fictional', 'SESSION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(), 'POLL_SECONDS': '5'}
local_wrangler = root / 'worker/node_modules/.bin/wrangler'
command = [str(local_wrangler) if local_wrangler.exists() else 'bunx', *([] if local_wrangler.exists() else ['wrangler']), 'dev', '--port', str(args.port), '--ip', '127.0.0.1', '--local', '--local-upstream', f'localhost:{args.port}', '--show-interactive-dev-session=false', '--persist-to', str(args.output / 'wrangler-state')]  # fresh cache and state per run
for k, v in variables.items(): command += ['--var', f'{k}:{v}']
dev = subprocess.Popen(command, cwd=root / 'worker', stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)


def browser(*parts):
    p = subprocess.run(['agent-browser', '--session', 'horsemen-hosted-test', *parts], capture_output=True, text=True, timeout=60)
    log.append(f'$ agent-browser {" ".join(parts)[:160]}\n{p.stdout}{p.stderr}')
    if p.returncode: raise AssertionError(p.stderr or p.stdout)
    return p.stdout


def value(code):
    result = json.loads(browser('eval', code))
    return json.loads(result) if isinstance(result, str) else result


def until(code, seconds=30):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if value(code): return
        time.sleep(0.5)
    raise AssertionError('Timed out waiting for: ' + code + ' at ' + str(value('location.href+" | "+document.body.innerText.slice(0,300)')))


try:
    for _ in range(120):
        try:
            with urllib.request.urlopen(origin + '/healthz', timeout=2) as r:
                if r.status == 200: break
        except Exception: time.sleep(0.5)
    else: raise AssertionError('wrangler dev did not start')

    browser('open', origin)
    desktop = [str(n) for n in value('JSON.stringify([innerWidth, innerHeight])')]  # The phone step returns to this size.
    assert value("document.body.innerText.includes('Sign in with GitHub')"), 'signed-out visitors see the sign-in page'
    browser('screenshot', str(args.output / '01-sign-in.png'))
    browser('click', 'a.btn')
    until("document.querySelector('meta[name=horsemen-mode]')?.content==='hosted'")
    until("document.querySelector('#project-name')?.textContent==='alpha'")
    until("!document.querySelector('[data-artifact=progress]').disabled")
    assert value("!window.mermaid && !document.querySelector('script[src*=mermaid]')"), 'Mermaid does not load before a page needs it'
    browser('eval', 'window.__csp=[];document.addEventListener("securitypolicyviolation",e=>window.__csp.push(e.violatedDirective+" "+e.blockedURI))')
    assert value("document.querySelector('#account').textContent.includes('operator')")
    assert value("!document.querySelector('#privacy').hidden"), 'a private repository shows a lock next to its name'
    assert value("document.querySelector('#menu #choose-repos') && document.querySelector('#menu #sign-out') && !document.querySelector('.demo,.notice')"), 'hosted items sit in the account menu'
    assert value("!!document.querySelector('#sign-out') && document.querySelector('#choose-repos').href.includes('/apps/horsemen-fictional/installations/new')")
    assert value("document.querySelector('[data-artifact=progress]').innerText.includes('Invite three operators')")
    browser('screenshot', str(args.output / '02-project.png'))
    browser('dblclick', '[data-artifact="brain"]')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Research notebook')")
    # Diagrams and images in a linked document: Mermaid comes from /vendor through the Worker, images through the proxy.
    browser('click', '.connection-card')
    until("document.querySelectorAll('figure.diagram[data-state=drawn]').length===2 && document.querySelectorAll('figure.diagram[data-state=error]').length===1", 30)
    assert value("JSON.stringify([...document.querySelectorAll('figure.diagram[data-state=drawn] .diagram-canvas')].map(c=>c.getAttribute('aria-label')))") == ['Flowchart', 'Pie chart: Interviews']
    assert value("document.querySelector('figure.diagram[data-state=error] .diagram-error').textContent.startsWith('This diagram could not be drawn.')")
    browser('eval', 'document.querySelector(".md-image").scrollIntoView({block:"center"})')
    until("document.querySelectorAll('.md-image[data-state=shown]').length===2 && document.querySelectorAll('.md-image[data-state=error]').length===1", 20)
    assert value("JSON.stringify([...document.querySelectorAll('.md-image[data-state=shown] img')].map(i=>[i.alt,i.src.startsWith('blob:'),i.naturalWidth>0]))") == [['Pilot board', True, True], ['Pilot logo', True, True]]
    assert value("JSON.stringify(document.querySelector('.md-image[data-state=error] .md-image-note').textContent)") == 'Image not shown: The image is not in the repository at this commit.'
    assert value("JSON.stringify([window.pwned ?? null, window.__csp])") == [None, []], 'no script ran from diagram or SVG source, and nothing broke the CSP'
    browser('eval', 'document.querySelector("figure.diagram").scrollIntoView({block:"start"})')
    browser('screenshot', str(args.output / '02b-diagrams.png'))
    browser('eval', 'document.querySelector(".md-image").scrollIntoView({block:"center"})')
    browser('screenshot', str(args.output / '02c-images.png'))
    browser('press', 'Escape')
    until("!document.querySelector('#peek').open")
    deadline = time.time() + 20  # The first check stores the ETag; the next one sends it.
    while world['not_modified'] < 1 and time.time() < deadline: time.sleep(0.5)
    assert world['not_modified'] >= 1, 'an unchanged branch uses a conditional request'
    # Canvases: the rail lists Home and each record; a record opens as a canvas of its sections, and the address names the place.
    place = "JSON.stringify(location.pathname + location.search)"
    shown = "JSON.stringify([canvasKey, [...selected], document.querySelector('#peek').open])"
    assert value("JSON.stringify([...document.querySelectorAll('#canvases [data-canvas]')].map(b => b.dataset.canvas))") == ['home', 'vision', 'progress', 'brain', 'structure'], 'the rail lists Home and the records that are found'
    assert value("JSON.stringify([document.querySelector('#workspace-name').textContent, document.querySelector('#connect-repo').href.includes('/apps/horsemen-fictional/installations/new')])") == ['alpha', True], 'the switcher names the project and leads to the page that adds a repository'
    browser('focus', '[data-canvas="progress"]'); browser('press', 'Enter')
    until("document.querySelector('#project-name').textContent === 'Progress' && document.querySelectorAll('.section-card').length === 1")
    assert value(place) == '/example/alpha?canvas=progress', 'the address names the canvas'
    browser('focus', '[data-node="s-shipped"]'); browser('press', 'Enter')
    assert value(shown) == ['progress', ['s-shipped'], False] and value(place) == '/example/alpha?canvas=progress&node=s-shipped', 'Enter selects a card and the address names it'
    browser('screenshot', str(args.output / '02d-canvas.png'))
    browser('press', 'Enter')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Search is available')")
    assert value(place) == '/example/alpha?canvas=progress&node=s-shipped&record=progress', 'the address keeps the canvas, the card, and the open record'
    browser('press', 'Escape')
    until("!document.querySelector('#peek').open && document.activeElement.dataset.node === 's-shipped' && location.search === '?canvas=progress&node=s-shipped'")
    # A new commit reloads the open canvas and keeps the place.
    world['rev'] = 'b' * 40; world['sources']['PROGRESS.md'] = UPDATED
    until("document.querySelector('[data-node=s-shipped]')?.innerText.includes('Pilot results reached all operators')", 30)
    assert value(shown) == ['progress', ['s-shipped'], False] and value(place) == '/example/alpha?canvas=progress&node=s-shipped', 'a live update keeps the canvas and the selected card'
    browser('click', '[data-canvas="home"]')
    assert value(place) == '/example/alpha'
    until("document.querySelector('[data-artifact=progress]').innerText.includes('Publish the pilot results')", 30)
    assert value("document.querySelector('#project-description').textContent.includes('bbbbbbb')")
    browser('screenshot', str(args.output / '03-live-update.png'))

    # A reload shows projects from the saved index at once; the index never holds record text.
    assert value("(t=>t.includes('example/alpha') && t.includes('PROGRESS.md') && !t.includes('Publish the pilot') && !t.includes('Invite three'))(localStorage.getItem('horsemen.discovery.v1')||'')"), 'index has paths, not record text'
    browser('eval', 'location.reload()')
    until("document.querySelector('[data-artifact=progress]') && !document.querySelector('[data-artifact=progress]').disabled && document.querySelector('[data-artifact=progress]').innerText.includes('Publish the pilot results')", 15)
    until("document.querySelector('#scan-status').textContent.includes('Checked')", 20)

    browser('click', '#menu-toggle'); browser('click', '#sign-out')
    until("document.body.innerText.includes('Sign in with GitHub')")
    assert world['revoked'] == 1, 'sign-out revokes the token'
    assert value("localStorage.getItem('horsemen.discovery.v1')") is None, 'sign-out removes the saved index'
    cookies = browser('cookies')
    assert '__Host-horsemen=' not in cookies or 'ghu_' not in cookies
    browser('screenshot', str(args.output / '04-signed-out.png'))

    # Share links: a signed-out visitor signs in and lands on the shared record.
    browser('open', origin + '/example/alpha?record=brain')
    assert value("document.body.innerText.includes('Sign in to open example/alpha')"), 'the sign-in page names the shared project'
    browser('click', 'a.btn')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Research notebook')", 20)
    assert value("location.pathname + location.search === '/example/alpha?record=brain'"), 'the shared link survives sign-in'
    assert value("!!document.querySelector('#share-record') && !!document.querySelector('#share-link')"), 'copy link buttons exist'
    browser('click', '#share-record')
    until("['Link copied','Copy failed'].some(t => document.querySelector('#toast').textContent.includes(t))", 5)
    browser('screenshot', str(args.output / '05-shared-record.png'))
    browser('press', 'Escape')
    until("location.pathname + location.search === '/example/alpha'", 5)
    # Canvas links: a signed-out visitor signs in and lands on the same canvas and card.
    browser('click', '#menu-toggle'); browser('click', '#sign-out')
    until("document.body.innerText.includes('Sign in with GitHub')")
    link = '/example/alpha?canvas=progress&node=s-shipped'
    browser('open', origin + link)
    assert value("document.body.innerText.includes('Sign in to open example/alpha')")
    browser('click', 'a.btn')
    until("typeof canvasKey !== 'undefined' && document.body.dataset.state === 'ready' && canvasKey === 'progress' && selected.has('s-shipped')", 20)
    assert value(place) == link and value("JSON.stringify(document.querySelector('#project-name').textContent)") == 'Progress', 'the canvas link survives sign-in'
    assert value("JSON.stringify(document.activeElement.dataset.node)") == 's-shipped', 'the card a link names has focus'
    browser('screenshot', str(args.output / '05b-shared-canvas.png'))
    # The same link on a phone: the canvas is a list of its sections, and nothing scrolls sideways.
    browser('set', 'viewport', '390', '844'); browser('eval', 'location.reload()')
    until("typeof canvasKey !== 'undefined' && document.body.dataset.state === 'ready' && canvasKey === 'progress' && selected.has('s-shipped')", 20)
    assert value("JSON.stringify([document.querySelector('#map').classList.contains('list'), document.documentElement.scrollWidth <= innerWidth, (r => r.scrollWidth <= r.clientWidth + 1)(document.querySelector('.rail')), [...document.querySelectorAll('.section-card')].every(e => e.getBoundingClientRect().right <= innerWidth)])") == [True, True, True, True], 'a canvas fits a phone as a list'
    assert value(place) == link
    browser('press', 'Enter')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Pilot results reached all operators')")
    assert value("JSON.stringify((r => [Math.round(r.width), Math.round(r.height)])(document.querySelector('#peek').getBoundingClientRect()))") == [390, 844] and value(place) == link + '&record=progress', 'on a phone a section opens the reading view on the full screen'
    browser('screenshot', str(args.output / '05c-shared-canvas-phone.png'))
    browser('press', 'Escape')
    until("!document.querySelector('#peek').open")
    browser('set', 'viewport', *desktop)
    # A link to a repository this account cannot read says why.
    browser('open', origin + '/example/private-elsewhere')
    until("document.querySelector('#issues') && document.querySelector('#issues').textContent.includes('cannot open example/private-elsewhere')", 20)
    browser('screenshot', str(args.output / '06-no-access.png'))
    browser('click', '#menu-toggle'); browser('click', '#sign-out')
    until("document.body.innerText.includes('Sign in with GitHub')")
    # Public view: a public repository opens without sign-in, keeps nothing in the browser, and offers sign-in.
    browser('open', origin + '/example/open?record=progress')
    until("document.querySelector('meta[name=horsemen-mode]')?.content === 'public'")
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Publish the pilot results')", 20)
    assert value("!!document.querySelector('#public-sign-in') && !document.querySelector('#sign-out')"), 'public view offers sign-in, not sign-out'
    assert value("localStorage.getItem('horsemen.discovery.v1') === null"), 'public view saves no index'
    assert value("location.pathname + location.search === '/example/open?record=progress'")
    browser('screenshot', str(args.output / '07-public-view.png'))
    # Public view of a canvas link: the same canvas and card, with no sign-in and nothing saved.
    public = '/example/open?canvas=vision&node=s-who-we-build-for'
    browser('open', origin + public)
    until("document.querySelector('meta[name=horsemen-mode]')?.content === 'public' && typeof canvasKey !== 'undefined' && document.body.dataset.state === 'ready' && canvasKey === 'vision' && selected.has('s-who-we-build-for')", 20)
    assert value("JSON.stringify([...document.querySelectorAll('.section-card')].map(e => e.dataset.node))") == ['s-why-we-exist', 's-who-we-build-for']
    assert value(place) == public and value("!document.querySelector('#connect-repo') && localStorage.getItem('horsemen.discovery.v1') === null"), 'public view keeps the canvas link, offers no repository page, and saves no index'
    browser('press', 'Enter')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Independent builders')")
    assert value(place) == public + '&record=vision'
    browser('screenshot', str(args.output / '08-public-canvas.png'))
    assert world['app_calls'] > 0
    print('Hosted E2E passed:', args.output)
finally:
    try: browser('close')
    except Exception: pass
    try: os.killpg(dev.pid, signal.SIGTERM)  # wrangler starts workerd children
    except ProcessLookupError: pass
    try: out, _ = dev.communicate(timeout=10)
    except subprocess.TimeoutExpired: os.killpg(dev.pid, signal.SIGKILL); out, _ = dev.communicate()
    fake.shutdown()
    (args.output / 'browser.log').write_text('\n'.join(log))
    (args.output / 'wrangler.log').write_text(out.replace(variables['SESSION_KEY'], '<session key>'))
