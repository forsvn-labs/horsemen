"""Measure hosted viewer speed against a fake GitHub with realistic latency.

Starts `wrangler dev` and a fake GitHub with many repositories and a fixed
delay per API call. Signs in with agent-browser, then measures, for a first
visit and a reload: time until the first project's records show, time until
discovery finishes, and the number of GitHub calls. Prints JSON.

    python3 scripts/bench_hosted.py --repos 80 --latency 150 --output /tmp/horsemen-bench
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
import threading
import time
import urllib.request
from urllib.parse import parse_qs, urlsplit

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=Path)
parser.add_argument('--repos', type=int, default=80)
parser.add_argument('--projects', type=int, default=6)
parser.add_argument('--latency', type=int, default=150, help='milliseconds per GitHub API call')
parser.add_argument('--port', type=int, default=8789)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]

RECORDS = {'VISION.md': '# Vision\n## Why we exist\nFictional purpose.', 'PROGRESS.md': '# Progress\nNext action: Ship the fictional pilot.\n## Shipped\n- A fictional result.',
           'BRAIN.md': '# Brain\n## Providers\n- None.', 'STRUCTURE.md': '# Structure\n## Map\n```text\napp/ — code\n```'}
FILLER = [{'path': f'src/module{i}/file{j}.ts', 'type': 'blob', 'mode': '100644', 'sha': f'{i:04d}{j:036d}', 'size': 100} for i in range(40) for j in range(10)]
def sha(text): return hashlib.sha1(text.encode()).hexdigest()
REPOS = [{'id': i + 1, 'full_name': f'example/repo{i:03d}', 'default_branch': 'main', 'private': True, 'archived': False,
          'pushed_at': f'2026-11-{19 - i % 18:02d}T00:00:00Z'} for i in range(args.repos)]
PROJECT_REPOS = {r['full_name'] for r in REPOS[::max(1, args.repos // args.projects)][:args.projects]}
calls = {'count': 0}
lock = threading.Lock()


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
        with lock: calls['count'] += 1
        time.sleep(args.latency / 1000)
        if p == '/user': return self.send(200, {'login': 'operator'})
        if p == '/user/installations': return self.send(200, {'installations': [{'id': 1}, {'id': 2}]})
        if p.startswith('/user/installations/'):
            inst = int(p.split('/')[3]); page = int(q.get('page', ['1'])[0]); per = int(q.get('per_page', ['30'])[0])
            mine = REPOS[inst - 1::2]
            return self.send(200, {'total_count': len(mine), 'repositories': mine[(page - 1) * per: page * per]})
        parts = p.split('/')
        if len(parts) > 4 and parts[1] == 'repos':
            name = parts[2] + '/' + parts[3]; has = name in PROJECT_REPOS
            rev = sha(name)
            if parts[4] == 'commits':
                etag = f'"{rev}"'
                if self.headers.get('If-None-Match') == etag: return self.send(304, None, {'ETag': etag})
                return self.send(200, {'sha': rev, 'commit': {'tree': {'sha': rev}}}, {'ETag': etag})
            if parts[4] == 'git' and parts[5] == 'trees':
                tree = list(FILLER) + ([{'path': k, 'type': 'blob', 'mode': '100644', 'sha': sha(v), 'size': len(v)} for k, v in RECORDS.items()] if has else [])
                return self.send(200, {'truncated': False, 'tree': tree})
            if parts[4] == 'git' and parts[5] == 'blobs':
                for v in RECORDS.values():
                    if sha(v) == parts[6]: return self.send(200, {'encoding': 'base64', 'content': base64.b64encode(v.encode()).decode()})
        return self.send(404, {'message': 'Not Found'})

    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if self.path == '/login/oauth/access_token':
            return self.send(200, {'access_token': 'ghu_fictional', 'refresh_token': 'ghr_fictional', 'expires_in': 28800, 'refresh_token_expires_in': 15897600})
        return self.send(404, {'message': 'Not Found'})


fake = ThreadingHTTPServer(('127.0.0.1', 0), FakeGitHub)
fake.daemon_threads = True
threading.Thread(target=fake.serve_forever, daemon=True).start()
github = f'http://127.0.0.1:{fake.server_port}'
origin = f'http://localhost:{args.port}'
variables = {'GITHUB_API': github, 'GITHUB_WEB': github, 'GITHUB_CLIENT_ID': 'Iv1.fictional', 'GITHUB_CLIENT_SECRET': 'fictional',
             'GITHUB_APP_SLUG': 'horsemen-fictional', 'SESSION_KEY': base64.b64encode(secrets.token_bytes(32)).decode(), 'POLL_SECONDS': '60'}
local_wrangler = root / 'worker/node_modules/.bin/wrangler'
command = [str(local_wrangler) if local_wrangler.exists() else 'bunx', *([] if local_wrangler.exists() else ['wrangler']), 'dev', '--port', str(args.port), '--ip', '127.0.0.1', '--local', '--local-upstream', f'localhost:{args.port}', '--show-interactive-dev-session=false']
for k, v in variables.items(): command += ['--var', f'{k}:{v}']
dev = subprocess.Popen(command, cwd=root / 'worker', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True, start_new_session=True)


def browser(*parts):
    p = subprocess.run(['agent-browser', '--session', 'horsemen-bench', *parts], capture_output=True, text=True, timeout=120)
    if p.returncode: raise AssertionError(p.stderr or p.stdout)
    return p.stdout


def value(code):
    result = json.loads(browser('eval', code))
    return json.loads(result) if isinstance(result, str) else result


def measure(label, checked=False):
    """Seconds from this page's navigation start to the first project's records and to the end of discovery."""
    start = time.time(); before = calls['count']; first = done = None
    probe = ("JSON.stringify({app:!!document.querySelector('meta[name=horsemen-mode]') && !window.__benchSeen, t:(Date.now()-performance.timeOrigin)/1000,"
             "ready:(document.querySelector('[data-artifact=progress]')?.innerText||'').includes('Ship the fictional pilot'),"
             "status:document.querySelector('#scan-status')?.textContent||''})")
    while time.time() - start < 180:
        state = value(probe)
        if not state['app']: time.sleep(0.05); continue
        if first is None and state['ready']: first = state['t']
        if f'{args.repos} / {args.repos} repositories checked' in state['status'] and 'Scanning' not in state['status'] and (not checked or 'Checked' in state['status']):
            done = state['t']; break
        time.sleep(0.05)
    browser('eval', 'window.__benchSeen=1')
    return {'visit': label, 'first_project_s': round(first, 2) if first else None, 'discovery_done_s': round(done, 2) if done else None, 'github_calls': calls['count'] - before}


try:
    for _ in range(120):
        try:
            with urllib.request.urlopen(origin + '/healthz', timeout=2) as r:
                if r.status == 200: break
        except Exception: time.sleep(0.5)
    browser('open', origin)
    browser('eval', 'localStorage.clear()')
    browser('eval', "document.querySelector('a.btn').click()")
    results = [measure('first')]
    browser('eval', 'location.reload()')
    results.append(measure('reload', checked=True))
    report = {'repos': args.repos, 'projects': len(PROJECT_REPOS), 'latency_ms': args.latency, 'results': results}
    (args.output / 'bench.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report))
finally:
    try: browser('close')
    except Exception: pass
    try: os.killpg(dev.pid, signal.SIGTERM)  # wrangler starts workerd children
    except ProcessLookupError: pass
    try: dev.wait(timeout=10)
    except subprocess.TimeoutExpired: os.killpg(dev.pid, signal.SIGKILL)
    fake.shutdown()
