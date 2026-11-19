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
    'docs/research.md': '# Research notebook\nOperators need a clear next step.',
}
UPDATED = '# Progress\nNext action: Publish the pilot results.\n## Shipped\n- Pilot results reached all operators.'
world = {'rev': 'a' * 40, 'sources': dict(SOURCES), 'revoked': 0, 'tokens': 0, 'not_modified': 0}
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
        if self.headers.get('Authorization') != 'Bearer ghu_fictional': return self.send(401, {'message': 'Bad credentials'})
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
command = [str(local_wrangler) if local_wrangler.exists() else 'bunx', *([] if local_wrangler.exists() else ['wrangler']), 'dev', '--port', str(args.port), '--ip', '127.0.0.1', '--local', '--local-upstream', f'localhost:{args.port}', '--show-interactive-dev-session=false']
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
    assert value("document.body.innerText.includes('Sign in with GitHub')"), 'signed-out visitors see the sign-in page'
    browser('screenshot', str(args.output / '01-sign-in.png'))
    browser('click', 'a.btn')
    until("document.querySelector('meta[name=horsemen-mode]')?.content==='hosted'")
    until("document.querySelector('#project-name')?.textContent==='alpha'")
    until("!document.querySelector('[data-artifact=progress]').disabled")
    assert value("document.querySelector('#account').textContent.includes('operator')")
    assert value("document.querySelector('#privacy').textContent==='PRIVATE'")
    assert value("!!document.querySelector('#sign-out') && document.querySelector('#choose-repos').href.includes('/apps/horsemen-fictional/installations/new')")
    assert value("document.querySelector('[data-artifact=progress]').innerText.includes('Invite three operators')")
    browser('screenshot', str(args.output / '02-project.png'))
    browser('dblclick', '[data-artifact="brain"]')
    until("document.querySelector('#peek').open && document.querySelector('#peek').innerText.includes('Research notebook')")
    browser('press', 'Escape')
    until("!document.querySelector('#peek').open")
    deadline = time.time() + 20  # The first check stores the ETag; the next one sends it.
    while world['not_modified'] < 1 and time.time() < deadline: time.sleep(0.5)
    assert world['not_modified'] >= 1, 'an unchanged branch uses a conditional request'
    world['rev'] = 'b' * 40; world['sources']['PROGRESS.md'] = UPDATED
    until("document.querySelector('[data-artifact=progress]').innerText.includes('Publish the pilot results')", 30)
    assert value("document.querySelector('#project-description').textContent.includes('bbbbbbb')")
    browser('screenshot', str(args.output / '03-live-update.png'))

    # A reload shows projects from the saved index at once; the index never holds record text.
    assert value("(t=>t.includes('example/alpha') && t.includes('PROGRESS.md') && !t.includes('Publish the pilot') && !t.includes('Invite three'))(localStorage.getItem('horsemen.discovery.v1')||'')"), 'index has paths, not record text'
    browser('eval', 'location.reload()')
    until("document.querySelector('[data-artifact=progress]') && !document.querySelector('[data-artifact=progress]').disabled && document.querySelector('[data-artifact=progress]').innerText.includes('Publish the pilot results')", 15)
    until("document.querySelector('#scan-status').textContent.includes('Checked')", 20)

    browser('click', '#sign-out')
    until("document.body.innerText.includes('Sign in with GitHub')")
    assert world['revoked'] == 1, 'sign-out revokes the token'
    assert value("localStorage.getItem('horsemen.discovery.v1')") is None, 'sign-out removes the saved index'
    cookies = browser('cookies')
    assert '__Host-horsemen=' not in cookies or 'ghu_' not in cookies
    browser('screenshot', str(args.output / '04-signed-out.png'))
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
