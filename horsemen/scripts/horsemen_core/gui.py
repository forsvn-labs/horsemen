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
from .gui_links import canvas_links, connections

FILES = {'vision': 'VISION.md', 'progress': 'PROGRESS.md', 'brain': 'BRAIN.md',
         'structure': 'STRUCTURE.md', 'readme': 'README.md', 'changelog': 'CHANGELOG.md', 'techstack': 'TECHSTACK.md'}
EXCLUDED = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'vendor'}
MAX_FILE = 512 * 1024

# Canvas files: <project root>/.horsemen/canvas/<name>.canvas. The browser checks and draws the text.
CANVAS_DIR = '.horsemen/canvas'
CANVAS_NAME = re.compile(r'[a-z0-9][a-z0-9-]{0,63}')
MAX_CANVASES = 20
CANVAS_TOO_LARGE = 'The canvas file is larger than 512 KiB.'
CANVAS_UNREADABLE = 'The canvas file could not be decoded as UTF-8 text.'

# Repository images: GitHub's contents API returns inline base64 only for files up to 1 MB, so 1 MiB is the limit.
IMAGE_TYPES = {'.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.svg':'image/svg+xml'}
MAX_IMAGE = 1024 * 1024
IMAGE_TOO_LARGE = 'Image is larger than 1 MiB. Open it on GitHub.'
IMAGE_MISSING = 'The image is not in the repository at this commit.'

def image_type(path):
    return IMAGE_TYPES.get(PurePosixPath(path or '').suffix.lower())

def _image_matches(kind, data):
    if kind == 'image/png': return data.startswith(b'\x89PNG\r\n\x1a\n')
    if kind == 'image/jpeg': return data.startswith(b'\xff\xd8\xff')
    if kind == 'image/gif': return data[:6] in (b'GIF87a', b'GIF89a')
    if kind == 'image/webp': return data[:4] == b'RIFF' and data[8:12] == b'WEBP'
    return b'<svg' in data[:4096].lower()

def decode_image(blob, path):
    """Bytes and content type of a contents-API response. The bytes must match the file's image type."""
    kind = image_type(path)
    if not isinstance(blob, dict) or blob.get('type') != 'file': raise ProviderError('The linked path is not a readable file.', 422)
    if not kind: raise ProviderError('The file is not a supported image type.', 415)
    size = blob.get('size')
    if not isinstance(size, int) or isinstance(size, bool) or size < 0: raise ProviderError('The linked path is not a readable file.', 422)
    if size > MAX_IMAGE or blob.get('encoding') == 'none': raise ProviderError(IMAGE_TOO_LARGE, 413)
    if blob.get('encoding') != 'base64' or not isinstance(blob.get('content'), str): raise ProviderError('Unsupported image encoding.')
    encoded = re.sub(r'\s', '', blob['content'])
    if len(encoded) > MAX_IMAGE * 2: raise ProviderError(IMAGE_TOO_LARGE, 413)
    try: data = base64.b64decode(encoded, validate=True)
    except ValueError as error: raise ProviderError('The image could not be decoded.') from error
    if len(data) > MAX_IMAGE: raise ProviderError(IMAGE_TOO_LARGE, 413)
    if not _image_matches(kind, data): raise ProviderError('The file does not match its image type.', 415)
    return kind, data

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

def discover_canvases(entries, roots):
    """Canvas files of each project root, by name. At most 20 for a root, in name order."""
    found = {root:{} for root in roots}
    for entry in entries:
        if entry.get('type') != 'blob' or entry.get('mode') not in ('100644', '100755'): continue
        folder, _, filename = str(entry['path']).rpartition('/')
        if not filename.endswith('.canvas') or not CANVAS_NAME.fullmatch(filename[:-7]): continue
        if folder == CANVAS_DIR: root = ''
        elif folder.endswith('/' + CANVAS_DIR): root = folder[:-len(CANVAS_DIR) - 1]
        else: continue
        if root in found: found[root][filename[:-7]] = {k:entry.get(k) for k in ('path','sha','size')}
    return {root:dict(sorted(files.items())[:MAX_CANVASES]) for root,files in found.items()}

def public(project):
    """A project without its file lists, for the project list and a loaded project."""
    return {k:v for k,v in project.items() if k not in ('files','canvases')}

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
        roots = discover_roots(tree.get('tree', [] ))
        canvases = discover_canvases(tree.get('tree', []), roots)
        for root, files in roots.items():
            key = hashlib.sha256(f'{repo["id"]}:{root}'.encode()).hexdigest()[:24]
            output.append({'id':key, 'repo':name, 'root':root, 'name':root.split('/')[-1] if root else name.split('/')[-1],
                           'private':bool(repo.get('private')), 'archived':bool(repo.get('archived')), 'branch':branch,
                           'revision':revision, 'files':files, 'canvases':canvases.get(root, {}), 'missing':[k for k in ('vision','progress','brain','structure') if k not in files], 'scanned_at':now()})
        return output
    def load(self, project):
        # Network latency dominates: read independent immutable blobs in parallel.
        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = {key:pool.submit(self.load_record, project, key, default) for key,default in FILES.items()}
            drawings = {name:pool.submit(self.load_canvas, project, name) for name in project.get('canvases', {})}
            records = {key:job.result() for key,job in jobs.items()}
            canvases = {name:job.result() for name,job in drawings.items()}
        return {'project':public(project), 'records':records, 'canvases':canvases, 'loaded_at':now()}
    def load_canvas(self, project, name):
        """The text of one canvas file and the files that it names. A failure stays with this canvas."""
        file = project['canvases'][name]; path = file['path']
        rec = {'name':name, 'path':path, 'url':f'https://github.com/{project["repo"]}/blob/{project["revision"]}/{quote(path, safe="/")}', 'blob':file['sha']}
        try:
            size = file.get('size')
            if not isinstance(size, int) or isinstance(size, bool) or size > MAX_FILE: raise ProviderError(CANVAS_TOO_LARGE, 413)
            blob = self.api(f'/repos/{project["repo"]}/git/blobs/{file["sha"]}')
            if blob.get('encoding') != 'base64': raise ProviderError('Unsupported canvas encoding.')
            encoded = re.sub(r'\s', '', blob['content'])
            if len(encoded) > MAX_FILE * 2: raise ProviderError(CANVAS_TOO_LARGE, 413)
            content = base64.b64decode(encoded, validate=True)
            if len(content) > MAX_FILE: raise ProviderError(CANVAS_TOO_LARGE, 413)
            text = content.decode('utf-8-sig')
            rec.update(content=text, connections=canvas_links(text, path, project['root'], project['repo'], project['revision']))
        except ProviderError as error: rec['error'] = str(error)
        except (ValueError, UnicodeError, KeyError, TypeError, AttributeError): rec['error'] = CANVAS_UNREADABLE
        return rec
    def load_record(self, project, key, default, blob=None):
        file = project['files'].get(key)
        if not file:
            return {'name':default, 'error':'Record is missing from this project root.'}
        path = file['path']; name = PurePosixPath(path).name
        rec = {'name':name, 'path':path, 'url':f'https://github.com/{project["repo"]}/blob/{project["revision"]}/{quote(path, safe="/")}', 'blob':file['sha']}
        try:
            if file.get('size') is None or file['size'] > MAX_FILE: raise ProviderError('Record exceeds the 512 KiB size limit.', 413)
            if blob is None:blob = self.api(f'/repos/{project["repo"]}/git/blobs/{file["sha"]}')
            if blob.get('encoding') != 'base64': raise ProviderError('Unsupported record encoding.')
            encoded = re.sub(r'\s', '', blob['content'])
            if len(encoded) > MAX_FILE * 2: raise ProviderError('Record exceeds the size limit.', 413)
            content = base64.b64decode(encoded, validate=True)
            if len(content) > MAX_FILE: raise ProviderError('Record exceeds the size limit.', 413)
            text = content.decode('utf-8-sig')
            rec.update(content=text, sections=dict(sections(text)), connections=connections(text,path,project["repo"],project["revision"]))
        except ProviderError as error: rec['error'] = str(error)
        except (ValueError, UnicodeError, KeyError): rec['error'] = 'Record could not be decoded as UTF-8 Markdown.'
        return rec
    def load_document(self, project, link):
        path=link['path']
        blob=self.api(f'/repos/{project["repo"]}/contents/{quote(path,safe="/")}?ref={project["revision"]}')
        if not isinstance(blob,dict) or blob.get('type')!='file':raise ProviderError('The linked path is not a readable file.',422)
        nested=dict(project,files={'document':{'path':path,'size':blob.get('size'),'sha':blob.get('sha')}})
        return self.load_record(nested,'document',PurePosixPath(path).name,blob)

    def load_image(self, project, link):
        path=link['path']
        if not image_type(path): raise ProviderError('The file is not a supported image type.', 415)
        try: blob=self.api(f'/repos/{project["repo"]}/contents/{quote(path,safe="/")}?ref={project["revision"]}')
        except ProviderError as error:
            if error.status==404: raise ProviderError(IMAGE_MISSING,404) from error
            raise
        kind,data=decode_image(blob,path)
        return {'type':kind,'bytes':data,'size':len(data)}

    def pull_request(self, project, number):
        if not re.fullmatch(r'[1-9][0-9]{0,8}', str(number)): raise ProviderError('Invalid PR number.', 400)
        data = self.api(f'/repos/{project["repo"]}/pulls/{number}')
        return {k:data.get(k) for k in ('number','title','html_url','body','state','merged','merged_at','merge_commit_sha')}

class ScanState:
    def __init__(self, reader):
        self.reader=reader;self.lock=threading.RLock();self.generation=0;self.worker=None
        self.data={'phase':'idle','account':None,'projects':[],'issues':[],'completed':0,'total':0,'finished_at':None}
        self.projects={};self.cache={};self.links={}
    def snapshot(self):
        with self.lock: return copy.deepcopy(self.data)
    def clear(self):
        with self.lock:
            self.generation+=1;self.projects={};self.cache={};self.links={}
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
                        self.data['projects']=[public(p) for p in self.projects.values()]
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
            self.register_links(key,[*result['records'].values(),*result['canvases'].values()])
            # Bound memory to 16 projects; never cache transient record or canvas failures.
            if all('content' in result['records'][key] for key in project['files']) and all('content' in canvas for canvas in result['canvases'].values()):
                if len(self.cache)>=16:self.cache.pop(next(iter(self.cache)))
                self.cache[key]=copy.deepcopy(result)
        return result

    def register_links(self, key, records):
        known=self.links.setdefault(key,{})
        for record in records:
            for link in record.get('connections',[]):
                if len(known)<4000:known[link['id']]=link
    def load_document(self, key, link_id):
        with self.lock:generation=self.generation
        project=self.project(key)
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
            link=copy.deepcopy(self.links.get(key,{}).get(link_id))
            if not link or link['kind']!='document':raise ProviderError('Open a document linked from a loaded record.',404)
        record=self.reader.load_document(project,link)
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
            self.register_links(key,[record])
        return record

    def load_image(self, key, link_id):
        """Bytes of an image that a loaded record links to, in the same repository at the scanned revision."""
        with self.lock:generation=self.generation
        project=self.project(key)
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
            link=copy.deepcopy(self.links.get(key,{}).get(link_id))
            if not link or link['kind']!='attachment' or not image_type(link.get('path')):raise ProviderError('Open an image linked from a loaded record.',404)
        image=self.reader.load_image(project,link)
        with self.lock:
            if generation!=self.generation:raise ProviderError('Discovery changed. Open the project again.',409)
        return image

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

ASSET_NAME=re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]*')
ASSET_TYPES={'.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8'}

# Repository images show as blob: URLs. Script stays same-origin only, with no eval.
PAGE_CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
# Image bytes never run as a document, even an SVG opened on its own.
IMAGE_CSP="default-src 'none'; style-src 'unsafe-inline'; sandbox"

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_): pass  # No personal project paths or URLs in request logs.
    def respond(self, status, body, kind='application/json', csp=PAGE_CSP):
        raw = json.dumps(body).encode() if kind=='application/json' else body
        self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)))
        self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        self.send_header('Content-Security-Policy',csp)
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
            if path=='/api/document':
                return self.respond(200,self.server.state.load_document(query.get('id',[''])[0],query.get('link',[''])[0]))
            if path=='/api/image':
                image=self.server.state.load_image(query.get('id',[''])[0],query.get('link',[''])[0])
                return self.respond(200,image['bytes'],image['type'],IMAGE_CSP)
            if path=='/api/pr':
                project=self.server.state.project(query.get('project',[''])[0])
                generation=self.server.state.generation
                result=self.server.state.reader.pull_request(project,query.get('number',[''])[0])
                if generation!=self.server.state.generation:raise ProviderError('Discovery changed. Open the project again.',409)
                return self.respond(200,result)
            files={'/':('index.html','text/html; charset=utf-8'),'/canvas-state.js':('canvas-state.js','text/javascript; charset=utf-8'),'/canvas-sections.js':('canvas-sections.js','text/javascript; charset=utf-8'),'/canvas-format.js':('canvas-format.js','text/javascript; charset=utf-8'),'/canvas-view.js':('canvas-view.js','text/javascript; charset=utf-8'),'/previews.js':('previews.js','text/javascript; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8'),'/theme.js':('theme.js','text/javascript; charset=utf-8'),'/markdown.js':('markdown.js','text/javascript; charset=utf-8'),'/media.js':('media.js','text/javascript; charset=utf-8'),'/vendor/mermaid.min.js':('vendor/mermaid.min.js','text/javascript; charset=utf-8')}
            if path.startswith('/assets/'):
                # Bundled fonts and icons only: plain names, known types, no traversal or links.
                parts=path[len('/assets/'):].split('/')
                target=(self.server.assets/'assets').joinpath(*parts) if all(ASSET_NAME.fullmatch(part) for part in parts) else None
                kind=ASSET_TYPES.get(target.suffix) if target else None
                if not kind or target.is_symlink() or not target.is_file():return self.respond(404,{'error':'Not found.'})
                return self.respond(200,target.read_bytes(),kind)
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

class WorkspaceServer(ThreadingHTTPServer):
    # A browser opens several connections at once for the page files. The default queue of 5 refuses some of them.
    request_queue_size=128
def make_server(port, state, assets):
    server=WorkspaceServer(('127.0.0.1',port),Handler)
    server.daemon_threads=True;server.state=state;server.assets=Path(assets);server.session=secrets.token_urlsafe(32)
    return server
