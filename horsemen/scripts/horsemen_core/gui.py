"""Read-only, loopback-only GitHub workspace. Credentials stay in the gh CLI."""
import base64
import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path, PurePosixPath
import re
import secrets
import subprocess
import threading
import time
from urllib.parse import parse_qs, quote, urlsplit
from .legacy import sections

FILES = {'vision': 'VISION.md', 'progress': 'PROGRESS.md', 'brain': 'BRAIN.md',
         'structure': 'STRUCTURE.md', 'readme': 'README.md', 'changelog': 'CHANGELOG.md', 'techstack': 'TECHSTACK.md'}
EXCLUDED = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'vendor'}
MAX_FILE = 512 * 1024

def now(): return datetime.now(timezone.utc).isoformat(timespec='seconds')

class ProviderError(Exception):
    def __init__(self, message, status=502): super().__init__(message); self.status = status

def gh_json(path, paginate=False):
    args = ['gh', 'api', '--hostname', 'github.com', '-H', 'Accept: application/vnd.github+json', path]
    if paginate: args += ['--paginate', '--slurp']
    try:
        result = subprocess.run(args, text=True, capture_output=True, timeout=90 if paginate else 35)
    except FileNotFoundError as error:
        raise ProviderError('Install GitHub CLI (gh), then run gh auth login on this machine.', 401) from error
    except subprocess.TimeoutExpired as error:
        raise ProviderError('GitHub request timed out. Retry the scan or reopen the project.', 504) from error
    if result.returncode:
        # Never echo provider stderr: it can include private URLs or credential material.
        err = result.stderr.lower()
        if '401' in err or 'auth login' in err: raise ProviderError('GitHub sign-in is required. Run gh auth login on this machine.', 401)
        if '403' in err or 'rate limit' in err: raise ProviderError('GitHub denied access or reached a rate limit. Check access, then retry.', 403)
        if '404' in err: raise ProviderError('Repository or record is no longer accessible.', 404)
        if '409' in err: raise ProviderError('Empty repository.', 409)
        raise ProviderError('GitHub request failed. Check the local gh sign-in and retry.')
    try: data = json.loads(result.stdout)
    except (ValueError, TypeError) as error: raise ProviderError('GitHub returned an unreadable response.') from error
    if paginate: return [item for page in data for item in page]
    return data

def discover_roots(entries):
    reverse = {v:k for k,v in FILES.items()}; reverse['STATUS.md'] = 'progress'
    roots = {}
    for entry in entries:
        path = PurePosixPath(entry['path'])
        if entry.get('type') != 'blob' or entry.get('mode') not in ('100644', '100755'): continue
        if any(part in EXCLUDED for part in path.parts) or path.name not in reverse: continue
        root = '' if str(path.parent) == '.' else str(path.parent)
        files = roots.setdefault(root, {})
        key = reverse[path.name]
        if key == 'progress' and key in files and path.name == 'STATUS.md': continue
        files[key] = {k:entry.get(k) for k in ('path','sha','size')}
    return {root:files for root,files in roots.items()
            if len(set(files) & {'vision','progress','brain','structure'}) >= 2
            and ('vision' in files or 'progress' in files)}

def credential_identity():
    """Detect local account/token switches without a network round trip."""
    try:
        result=subprocess.run(['gh','auth','token','--hostname','github.com'],capture_output=True,timeout=10)
    except (FileNotFoundError,subprocess.TimeoutExpired) as error:
        raise ProviderError('GitHub sign-in could not be checked. Run gh auth status.',401) from error
    if result.returncode or not result.stdout.strip():
        raise ProviderError('GitHub sign-in is required. Run gh auth login.',401)
    return hashlib.sha256(result.stdout.strip()).digest()

class GitHubReader:
    def __init__(self, api=gh_json, credential_identity=None):
        self.api=api
        self.identity=credential_identity or (globals()['credential_identity'] if api is gh_json else None)
        self.profile_lock=threading.Lock();self.profile_cache=None
    def profile(self):
        if self.identity is None:return self.api('/user')['login']
        identity=self.identity()
        with self.profile_lock:
            cached=self.profile_cache
            if cached and cached[0]==identity and time.monotonic()-cached[1]<30:return cached[2]
            login=self.api('/user')['login']
            self.profile_cache=(identity,time.monotonic(),login)
            return login
    def repositories(self):
        return self.api('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', paginate=True)
    def scan_repo(self, repo):
        name = repo['full_name']; branch = repo.get('default_branch')
        if not branch: return []
        commit = self.api(f'/repos/{name}/commits/{quote(branch, safe="")}')
        revision = commit['sha']; tree_sha = commit['commit']['tree']['sha']
        tree = self.api(f'/repos/{name}/git/trees/{tree_sha}?recursive=1')
        if tree.get('truncated'):
            raise ProviderError('Repository tree is too large for a complete scan. Use a smaller repository or a future explicit-root import.', 422)
        output = []
        for root, files in discover_roots(tree.get('tree', [] )).items():
            key = hashlib.sha256(f'{repo["id"]}:{root}'.encode()).hexdigest()[:24]
            output.append({'id':key, 'repo':name, 'root':root, 'name':root.split('/')[-1] if root else name.split('/')[-1],
                           'private':bool(repo.get('private')), 'archived':bool(repo.get('archived')), 'branch':branch,
                           'revision':revision, 'files':files, 'missing':[k for k in ('vision','progress','brain','structure') if k not in files], 'scanned_at':now()})
        return output
    def load(self, project):
        # Network latency dominates: read independent immutable blobs in parallel.
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = {key:pool.submit(self.load_record, project, key, default) for key,default in FILES.items()}
            records = {key:job.result() for key,job in jobs.items()}
        return {'project':{k:v for k,v in project.items() if k!='files'}, 'records':records, 'loaded_at':now()}
    def load_record(self, project, key, default):
        file = project['files'].get(key)
        if not file:
            return {'name':default, 'error':'Record is missing from this project root.'}
        path = file['path']; name = PurePosixPath(path).name
        rec = {'name':name, 'path':path, 'url':f'https://github.com/{project["repo"]}/blob/{project["revision"]}/{quote(path, safe="/")}', 'blob':file['sha']}
        try:
            if file.get('size') is None or file['size'] > MAX_FILE: raise ProviderError('Record exceeds the 512 KiB size limit.', 413)
            blob = self.api(f'/repos/{project["repo"]}/git/blobs/{file["sha"]}')
            if blob.get('encoding') != 'base64': raise ProviderError('Unsupported record encoding.')
            encoded = re.sub(r'\s', '', blob['content'])
            if len(encoded) > MAX_FILE * 2: raise ProviderError('Record exceeds the size limit.', 413)
            content = base64.b64decode(encoded, validate=True)
            if len(content) > MAX_FILE: raise ProviderError('Record exceeds the size limit.', 413)
            text = content.decode('utf-8-sig')
            rec.update(content=text, sections=dict(sections(text)))
        except ProviderError as error: rec['error'] = str(error)
        except (ValueError, UnicodeError, KeyError): rec['error'] = 'Record could not be decoded as UTF-8 Markdown.'
        return rec
    def pull_request(self, project, number):
        if not re.fullmatch(r'[1-9][0-9]{0,8}', str(number)): raise ProviderError('Invalid PR number.', 400)
        data = self.api(f'/repos/{project["repo"]}/pulls/{number}')
        return {k:data.get(k) for k in ('number','title','html_url','body','state','merged','merged_at','merge_commit_sha')}

class ScanState:
    def __init__(self, reader):
        self.reader=reader;self.lock=threading.RLock();self.generation=0;self.worker=None
        self.data={'phase':'idle','account':None,'projects':[],'issues':[],'completed':0,'total':0,'finished_at':None}
        self.projects={};self.cache={}
    def snapshot(self):
        with self.lock: return copy.deepcopy(self.data)
    def clear(self):
        with self.lock:
            self.generation+=1;self.projects={};self.cache={}
            self.data={'phase':'idle','account':None,'projects':[],'issues':[],'completed':0,'total':0,'finished_at':None}
    def _begin(self):
        with self.lock:
            if self.data['phase']=='scanning': return None
            self.clear();self.data['phase']='scanning';return self.generation
    def start(self):
        generation=self._begin()
        if generation is None:return False
        self.worker=threading.Thread(target=self._scan,args=(generation,),daemon=True);self.worker.start();return True
    def scan_sync(self):
        generation=self._begin()
        if generation is not None:self._scan(generation)
    def _scan(self, generation):
        try:
            account=self.reader.profile();repos=self.reader.repositories()
            with self.lock:
                if generation!=self.generation:return
                self.data.update(account=account,total=len(repos))
            with ThreadPoolExecutor(max_workers=4) as pool:
                jobs={pool.submit(self.reader.scan_repo,repo):repo for repo in repos}
                for future in as_completed(jobs):
                    with self.lock:
                        if generation!=self.generation:
                            for job in jobs:job.cancel()
                            return
                    try: found=future.result();issue=None
                    except ProviderError as error:
                        found=[];issue=None if error.status==409 else {'repo':jobs[future]['full_name'],'message':str(error)}
                    except Exception:
                        found=[];issue={'repo':jobs[future]['full_name'],'message':'Could not inspect repository. Retry the scan.'}
                    with self.lock:
                        if generation!=self.generation:return
                        for project in found:self.projects[project['id']]=project
                        if issue:self.data['issues'].append(issue)
                        self.data['completed']+=1
                        self.data['projects']=[{k:v for k,v in p.items() if k!='files'} for p in self.projects.values()]
            with self.lock:
                if generation==self.generation:self.data.update(phase='partial' if self.data['issues'] else 'ready',finished_at=now())
        except Exception as error:
            with self.lock:
                if generation==self.generation:
                    self.projects={};self.data.update(phase='error',projects=[],account=None,issues=[{'message':str(error) if isinstance(error,ProviderError) else 'Discovery failed. Retry the scan.'}],finished_at=now())
    def load_project(self, key):
        with self.lock:generation=self.generation
        project=self.project(key)  # Revalidate the account even on a cache hit.
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
            if key in self.cache:return copy.deepcopy(self.cache[key])
        result=self.reader.load(project)
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
            # Bound memory to 16 projects; never cache transient record failures.
            if all('content' in result['records'][key] for key in project['files']):
                if len(self.cache)>=16:self.cache.pop(next(iter(self.cache)))
                self.cache[key]=copy.deepcopy(result)
        return result

    def project(self, key):
        with self.lock:
            project=self.projects.get(key);account=self.data['account'];generation=self.generation
            if project is None:raise ProviderError('Project is not in the current discovery result. Scan again.',404)
            project=copy.deepcopy(project)
        try: active=self.reader.profile()
        except ProviderError:
            with self.lock:
                if generation==self.generation:self.clear()
            raise
        with self.lock:
            if generation!=self.generation:
                raise ProviderError('Discovery changed. Open the project again.',409)
            if active!=account:
                self.clear();raise ProviderError('GitHub account changed. Scan again before opening a project.',409)
        return project

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # No personal project paths or URLs in request logs.
    def respond(self, status, body, kind='application/json'):
        raw = json.dumps(body).encode() if kind=='application/json' else body
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
        self.end_headers();self.wfile.write(raw)
    def allowed(self, api=False):
        host=self.headers.get('Host','');expected=f'127.0.0.1:{self.server.server_port}'
        if host!=expected:return False
        origin=self.headers.get('Origin')
        if origin and origin!='http://'+expected:return False
        if api and not secrets.compare_digest(self.headers.get('X-Horsemen-Session',''),self.server.session):return False
        return True
    def do_GET(self):
        path=urlsplit(self.path).path;api=path.startswith('/api/')
        if not self.allowed(api):return self.respond(403,{'error':'Local session required.'})
        try:
            if path=='/api/status': return self.respond(200,self.server.state.snapshot())
            query=parse_qs(urlsplit(self.path).query)
            if path=='/api/project':
                return self.respond(200,self.server.state.load_project(query.get('id',[''])[0]))
            if path=='/api/pr':
                project=self.server.state.project(query.get('project',[''])[0])
                generation=self.server.state.generation
                result=self.server.state.reader.pull_request(project,query.get('number',[''])[0])
                if generation!=self.server.state.generation:raise ProviderError('Discovery changed. Open the project again.',409)
                return self.respond(200,result)
            files={'/':('index.html','text/html; charset=utf-8'),'/previews.js':('previews.js','text/javascript; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8')}
            if path not in files:return self.respond(404,{'error':'Not found.'})
            filename,kind=files[path];body=(self.server.assets/filename).read_bytes()
            if path=='/':body=body.replace(b'__SESSION__',self.server.session.encode())
            return self.respond(200,body,kind)
        except ProviderError as error:return self.respond(error.status,{'error':str(error)})
        except (BrokenPipeError,ConnectionResetError):return
        except Exception:return self.respond(500,{'error':'Local reader failed. Retry the request.'})
    def do_POST(self):
        if not self.allowed(True):return self.respond(403,{'error':'Local session required.'})
        if self.path=='/api/scan':return self.respond(202,{'started':self.server.state.start()})
        if self.path=='/api/clear':self.server.state.clear();return self.respond(200,{'cleared':True})
        self.respond(404,{'error':'Not found.'})
    def do_OPTIONS(self): self.respond(403,{'error':'Cross-origin requests are not allowed.'})

def make_server(port, state, assets):
    server=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    server.daemon_threads=True;server.state=state;server.assets=Path(assets);server.session=secrets.token_urlsafe(32)
    return server
